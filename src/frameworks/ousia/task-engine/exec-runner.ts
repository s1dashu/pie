import { spawn } from "node:child_process";
import { appendEngineEvent, resolveRelativeToHome, TASK_ENGINE_RELOAD_MS, type TaskEngineContext } from "./engine-context.js";
import { resolveEntryWorkingDirectory } from "./task-discovery.js";
import { emitToSink } from "./task-sink.js";
import { TaskStateStore } from "./task-state-store.js";
import type { ScheduledExecTaskSpec } from "./task-types.js";
import { isCronExecTaskSpec, isIntervalExecTaskSpec } from "./task-types.js";
import { buildTaskKey, makeRunId, type LoadedExecTask, type RunStatus } from "./runtime-types.js";
import { getDueCronRunAtMs as getDueCronScheduleRunAtMs, getDueIntervalRunAtMs } from "./schedule.js";

function runCommand(command: string, workdir: string, timeoutSec: number): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }> {
	return new Promise((resolvePromise, reject) => {
		const shell = process.env.SHELL?.trim() || "/bin/bash";
		const child = spawn(shell, ["-lc", command], {
			cwd: workdir,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, timeoutSec * 1000);
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});
		child.on("error", reject);
		child.on("exit", (code, signal) => {
			clearTimeout(timer);
			resolvePromise({
				stdout,
				stderr,
				exitCode: signal ? null : code,
				timedOut,
			});
		});
	});
}

export async function executeScheduledExecTaskRun(
	ctx: TaskEngineContext,
	stateStore: TaskStateStore,
	allExecTasks: Iterable<LoadedExecTask>,
	allAgentTasks: Iterable<unknown>,
	entry: LoadedExecTask,
	{
		triggerType,
		scheduledFor,
	}: {
		triggerType: "interval" | "cron";
		scheduledFor?: string;
	},
): Promise<void> {
	const entrySpec = entry.spec;
	if (entrySpec.trigger.type !== "interval" && entrySpec.trigger.type !== "cron") {
		return;
	}
	const spec = entrySpec as ScheduledExecTaskSpec;
	const scheduledForIso = scheduledFor ?? new Date().toISOString();
	const attempt = entry.state.lastRun?.scheduledFor === scheduledForIso ? entry.state.lastRun.attempt + 1 : 1;
	const taskKey = buildTaskKey("exec", spec);
	const runId = makeRunId(taskKey, scheduledForIso, attempt);
	const startedAt = new Date().toISOString();
	entry.state.running = true;
	entry.state.lastStartedScheduledFor = scheduledForIso;
	entry.state.currentRun = {
		runId,
		scheduledFor: scheduledForIso,
		startedAt,
		attempt,
		status: "running",
		enginePid: process.pid,
	};
	entry.state.lastError = null;
	stateStore.writeExecTaskState(entry);
	stateStore.writeRuntimeSnapshot(allExecTasks, allAgentTasks as Iterable<any>);
	stateStore.appendTaskRunEvent(entry.filePath, {
		event: "run_started",
		taskId: spec.id,
		taskKey,
		runId,
		scheduledFor: scheduledForIso,
		attempt,
		triggerType,
	});
	appendEngineEvent(ctx, {
		type: "execTask_run_start",
		execTaskId: spec.id,
		runId,
		triggerType,
		command: spec.run.command,
		scheduledFor: scheduledForIso,
	});
	try {
		const result = await runCommand(
			spec.run.command,
			spec.run.cwd ? resolveRelativeToHome(ctx, spec.run.cwd) : resolveEntryWorkingDirectory(entry.filePath),
			spec.run.timeoutSec ?? 30,
		);
		const status: RunStatus = result.exitCode === 0 && !result.timedOut ? "success" : "failed";
		const finishedAt = new Date().toISOString();
		entry.state.lastRunAt = Date.now();
		entry.state.lastCompletedScheduledFor = scheduledForIso;
		entry.state.counters.runCount += 1;
		if (status === "success") {
			entry.state.counters.successCount += 1;
			entry.state.lastError = null;
		} else {
			entry.state.counters.failureCount += 1;
			entry.state.lastError = result.timedOut ? "Command timed out." : `Command exited with code ${String(result.exitCode)}.`;
		}
		entry.state.lastRun = {
			runId,
			scheduledFor: scheduledForIso,
			startedAt,
			finishedAt,
			attempt,
			status,
			enginePid: process.pid,
			exitCode: result.exitCode,
			timedOut: result.timedOut,
			error: entry.state.lastError,
		};
		entry.state.currentRun = undefined;
		emitToSink(ctx, spec.sink, {
			timestamp: new Date().toISOString(),
			execTaskId: spec.id,
			runId,
			triggerType,
			command: spec.run.command,
			exitCode: result.exitCode,
			timedOut: result.timedOut,
			stdout: result.stdout,
			stderr: result.stderr,
			scheduledFor: scheduledForIso,
		});
		stateStore.appendTaskRunEvent(entry.filePath, {
			event: "run_finished",
			taskId: spec.id,
			taskKey,
			runId,
			scheduledFor: scheduledForIso,
			status,
			exitCode: result.exitCode,
			timedOut: result.timedOut,
		});
		appendEngineEvent(ctx, {
			type: "execTask_run_end",
			execTaskId: spec.id,
			runId,
			triggerType,
			exitCode: result.exitCode,
			timedOut: result.timedOut,
			scheduledFor: scheduledForIso,
		});
	} catch (error) {
		const finishedAt = new Date().toISOString();
		const errorMessage = error instanceof Error ? error.message : String(error);
		entry.state.counters.runCount += 1;
		entry.state.counters.failureCount += 1;
		entry.state.lastError = errorMessage;
		entry.state.lastRun = {
			runId,
			scheduledFor: scheduledForIso,
			startedAt,
			finishedAt,
			attempt,
			status: "failed",
			enginePid: process.pid,
			error: errorMessage,
		};
		entry.state.currentRun = undefined;
		stateStore.appendTaskRunEvent(entry.filePath, {
			event: "run_failed",
			taskId: spec.id,
			taskKey,
			runId,
			scheduledFor: scheduledForIso,
			error: errorMessage,
		});
		appendEngineEvent(ctx, {
			type: "execTask_run_error",
			execTaskId: spec.id,
			runId,
			triggerType,
			error: errorMessage,
			scheduledFor: scheduledForIso,
		});
	} finally {
		entry.state.running = false;
		entry.state.currentRun = undefined;
		stateStore.writeExecTaskState(entry);
		stateStore.writeRuntimeSnapshot(allExecTasks, allAgentTasks as Iterable<any>);
	}
}

export async function tickExecTasks(params: {
	ctx: TaskEngineContext;
	stateStore: TaskStateStore;
	execTasks: Iterable<LoadedExecTask>;
	agentTasks: Iterable<unknown>;
}): Promise<void> {
	const execTaskList = [...params.execTasks];
	for (const entry of execTaskList) {
		if (entry.spec.trigger.type !== "interval" || !isIntervalExecTaskSpec(entry.spec) || entry.state.running) {
			continue;
		}
		const dueRunAtMs = getDueIntervalRunAtMs({
			trigger: entry.spec.trigger,
			nowMs: Date.now(),
			lastRunAt: entry.state.lastRunAt,
		});
		if (dueRunAtMs != null) {
			await executeScheduledExecTaskRun(params.ctx, params.stateStore, execTaskList, params.agentTasks, entry, { triggerType: "interval" });
		}
	}

	for (const entry of execTaskList) {
		if (entry.spec.trigger.type !== "cron" || !isCronExecTaskSpec(entry.spec) || entry.state.running) {
			continue;
		}
		try {
			const nowMs = Date.now();
			const dueRunAtMs = getDueCronScheduleRunAtMs({
				trigger: entry.spec.trigger,
				nowMs,
				lastRunAt: entry.state.lastRunAt,
				fallbackCurrentDateMs: nowMs - TASK_ENGINE_RELOAD_MS - 1000,
			});
			if (dueRunAtMs != null) {
				await executeScheduledExecTaskRun(params.ctx, params.stateStore, execTaskList, params.agentTasks, entry, {
					triggerType: "cron",
					scheduledFor: new Date(dueRunAtMs).toISOString(),
				});
			}
		} catch (error) {
			appendEngineEvent(params.ctx, {
				type: "execTask_run_error",
				execTaskId: entry.spec.id,
				triggerType: "cron",
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}
