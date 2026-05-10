import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { OUSIA_RUNTIME_SECRET_HEADER } from "../runtime/env.js";
import { appendEngineEvent, type TaskEngineContext } from "./engine-context.js";
import type { AgentTaskSpec } from "./agent-task-types.js";
import { getDueCronRunAtMs as getDueCronScheduleRunAtMs, getDueIntervalRunAtMs, getDueOnceRunAtMs } from "./schedule.js";
import { type LoadedAgentTask, type LoadedExecTask } from "./runtime-types.js";
import { TaskStateStore } from "./task-state-store.js";
import {
	failAgentTaskRun,
	finalizeAgentTaskRun,
	finishAgentTaskRun,
	startAgentTaskRun,
} from "./task-run-lifecycle.js";

function buildAgentTaskPrompt(spec: AgentTaskSpec, scheduledFor: string): string {
	const lines = [
		`Scheduled agentTask fired: ${spec.id}`,
		`Scheduled for: ${scheduledFor}`,
		`Trigger type: ${spec.trigger.type}`,
		spec.projectId ? `Project: ${spec.projectId}` : "",
		spec.taskId ? `Task: ${spec.taskId}` : "",
		"",
		spec.prompt,
	];
	return lines.filter(Boolean).join("\n");
}

function getDueAgentTaskRunAt(entry: LoadedAgentTask): { runAtMs: number; scheduledFor: string } | undefined {
	const now = Date.now();
	const trigger = entry.spec.trigger;
	if (trigger.type === "once") {
		const runAtMs = getDueOnceRunAtMs(trigger, now, entry.state.deliveryCount);
		if (runAtMs == null) {
			return undefined;
		}
		return { runAtMs, scheduledFor: trigger.runAt };
	}
	if (trigger.type === "interval") {
		const nextRunAtMs = getDueIntervalRunAtMs({
			trigger,
			nowMs: now,
			lastRunAt: entry.state.lastDeliveredAt,
			fallbackAnchorMs: entry.mtimeMs,
		});
		if (nextRunAtMs == null) {
			return undefined;
		}
		return { runAtMs: nextRunAtMs, scheduledFor: new Date(nextRunAtMs).toISOString() };
	}
	try {
		const nextRunAtMs = getDueCronScheduleRunAtMs({
			trigger,
			nowMs: now,
			lastRunAt: entry.state.lastDeliveredAt,
			fallbackCurrentDateMs: entry.mtimeMs - 1000,
		});
		if (nextRunAtMs == null) {
			return undefined;
		}
		return { runAtMs: nextRunAtMs, scheduledFor: new Date(nextRunAtMs).toISOString() };
	} catch {
		return undefined;
	}
}

async function deliverAgentTask(params: {
	ctx: TaskEngineContext;
	stateStore: TaskStateStore;
	agentTasks: Map<string, LoadedAgentTask>;
	allExecTasks: Iterable<LoadedExecTask>;
	entry: LoadedAgentTask;
}): Promise<void> {
	const { ctx, stateStore, agentTasks, allExecTasks, entry } = params;
	if (entry.state.delivering) {
		return;
	}
	const due = getDueAgentTaskRunAt(entry);
	if (!due) {
		return;
	}
	const run = startAgentTaskRun(entry, due.scheduledFor);
	stateStore.writeAgentTaskState(entry);
	stateStore.writeRuntimeSnapshot(allExecTasks, agentTasks.values());
	stateStore.appendTaskRunEvent(entry.filePath, {
		event: "run_started",
		taskId: entry.spec.id,
		taskKey: run.taskKey,
		runId: run.runId,
		scheduledFor: due.scheduledFor,
		attempt: run.attempt,
		triggerType: entry.spec.trigger.type,
	});
	appendEngineEvent(ctx, {
		type: "agent_task_delivery_start",
		agentTaskId: entry.spec.id,
		runId: run.runId,
		triggerType: entry.spec.trigger.type,
		scheduledFor: due.scheduledFor,
	});
	try {
		const response = await fetch(`http://127.0.0.1:${ctx.gatewayPort}/agent/task`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(ctx.gatewaySecret
					? {
							[OUSIA_RUNTIME_SECRET_HEADER]: ctx.gatewaySecret,
						}
					: {}),
			},
			body: JSON.stringify({
				kind: "agent_task",
				source: "agent_task",
				origin: "scheduled_task",
				sessionKey: entry.spec.sessionKey ?? `task:${entry.spec.id}`,
				prompt: buildAgentTaskPrompt(entry.spec, due.scheduledFor),
					metadata: {
						agentTaskId: entry.spec.id,
						projectId: entry.spec.projectId,
						taskId: entry.spec.taskId,
						trigger: entry.spec.trigger,
						scheduledFor: due.scheduledFor,
						runId: run.runId,
						filePath: entry.filePath,
						deliveryMode: entry.spec.deliveryMode,
					},
			}),
		});
			if (!response.ok) {
				throw new Error(`Gateway responded with ${response.status}`);
			}
			finishAgentTaskRun(entry.state, run);
			stateStore.appendTaskRunEvent(entry.filePath, {
				event: "run_finished",
				taskId: entry.spec.id,
				taskKey: run.taskKey,
				runId: run.runId,
				scheduledFor: due.scheduledFor,
				status: "success",
			});
		appendEngineEvent(ctx, {
				type: "agent_task_delivery_end",
				agentTaskId: entry.spec.id,
				runId: run.runId,
				triggerType: entry.spec.trigger.type,
				scheduledFor: due.scheduledFor,
			});
		stateStore.writeAgentTaskState(entry);
		if (entry.spec.trigger.type === "once" && entry.spec.deleteAfterRun !== false && existsSync(entry.filePath)) {
			const archivePath = join(ctx.taskArchiveDir, `${new Date().toISOString().replace(/[:.]/g, "-")}--${entry.spec.id}.json`);
			renameSync(entry.filePath, archivePath);
			agentTasks.delete(run.taskKey);
				appendEngineEvent(ctx, {
					type: "agent_task_archived",
					agentTaskId: entry.spec.id,
					taskKey: run.taskKey,
					filePath: entry.filePath,
					archivePath,
				});
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			failAgentTaskRun(entry.state, run, errorMessage);
			stateStore.appendTaskRunEvent(entry.filePath, {
				event: "run_failed",
				taskId: entry.spec.id,
				taskKey: run.taskKey,
				runId: run.runId,
				scheduledFor: due.scheduledFor,
				error: errorMessage,
			});
		appendEngineEvent(ctx, {
				type: "agent_task_delivery_error",
				agentTaskId: entry.spec.id,
				runId: run.runId,
				triggerType: entry.spec.trigger.type,
				scheduledFor: due.scheduledFor,
				error: errorMessage,
			});
		} finally {
			finalizeAgentTaskRun(entry.state);
			stateStore.writeAgentTaskState(entry);
			stateStore.writeRuntimeSnapshot(allExecTasks, agentTasks.values());
		}
}

export async function tickAgentTasks(params: {
	ctx: TaskEngineContext;
	stateStore: TaskStateStore;
	agentTasks: Map<string, LoadedAgentTask>;
	execTasks: Iterable<LoadedExecTask>;
}): Promise<void> {
	for (const entry of params.agentTasks.values()) {
		await deliverAgentTask({
			ctx: params.ctx,
			stateStore: params.stateStore,
			agentTasks: params.agentTasks,
			allExecTasks: params.execTasks,
			entry,
		});
	}
}
