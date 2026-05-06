import { spawn } from "node:child_process";
import { appendEngineEvent, resolveRelativeToHome, TASK_ENGINE_RELOAD_MS, type TaskEngineContext } from "./engine-context.js";
import { resolveEntryWorkingDirectory } from "./task-discovery.js";
import { emitToSink } from "./task-sink.js";
import { TaskStateStore } from "./task-state-store.js";
import type { ScheduledExecTaskSpec } from "./task-types.js";
import { isCronExecTaskSpec, isIntervalExecTaskSpec } from "./task-types.js";
import { type LoadedExecTask, type RunStatus } from "./runtime-types.js";
import { getDueCronRunAtMs as getDueCronScheduleRunAtMs, getDueIntervalRunAtMs } from "./schedule.js";
import {
	failExecTaskRun,
	finalizeExecTaskRun,
	finishExecTaskRun,
	startExecTaskRun,
} from "./task-run-lifecycle.js";

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
	const run = startExecTaskRun(entry, scheduledForIso);
	stateStore.writeExecTaskState(entry);
	stateStore.writeRuntimeSnapshot(allExecTasks, allAgentTasks as Iterable<any>);
	stateStore.appendTaskRunEvent(entry.filePath, {
		event: "run_started",
		taskId: spec.id,
		taskKey: run.taskKey,
		runId: run.runId,
		scheduledFor: scheduledForIso,
		attempt: run.attempt,
		triggerType,
	});
	appendEngineEvent(ctx, {
		type: "execTask_run_start",
		execTaskId: spec.id,
		runId: run.runId,
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
		const runError = status === "success"
			? null
			: result.timedOut ? "Command timed out." : `Command exited with code ${String(result.exitCode)}.`;
		finishExecTaskRun(entry.state, run, {
			status,
			exitCode: result.exitCode,
			timedOut: result.timedOut,
			error: runError,
		});
		emitToSink(ctx, spec.sink, {
			timestamp: new Date().toISOString(),
			execTaskId: spec.id,
			runId: run.runId,
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
			taskKey: run.taskKey,
			runId: run.runId,
			scheduledFor: scheduledForIso,
			status,
			exitCode: result.exitCode,
			timedOut: result.timedOut,
		});
		appendEngineEvent(ctx, {
			type: "execTask_run_end",
			execTaskId: spec.id,
			runId: run.runId,
			triggerType,
			exitCode: result.exitCode,
			timedOut: result.timedOut,
			scheduledFor: scheduledForIso,
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		failExecTaskRun(entry.state, run, errorMessage);
		stateStore.appendTaskRunEvent(entry.filePath, {
			event: "run_failed",
			taskId: spec.id,
			taskKey: run.taskKey,
			runId: run.runId,
			scheduledFor: scheduledForIso,
			error: errorMessage,
		});
		appendEngineEvent(ctx, {
			type: "execTask_run_error",
			execTaskId: spec.id,
			runId: run.runId,
			triggerType,
			error: errorMessage,
			scheduledFor: scheduledForIso,
		});
	} finally {
		finalizeExecTaskRun(entry.state);
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
