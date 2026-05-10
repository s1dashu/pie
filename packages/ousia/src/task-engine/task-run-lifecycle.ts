import {
	buildTaskKey,
	makeRunId,
	type AgentTaskRuntimeState,
	type IntervalRuntimeState,
	type LoadedAgentTask,
	type LoadedExecTask,
	type RunStatus,
} from "./runtime-types.js";

export interface StartedTaskRun {
	taskKey: string;
	runId: string;
	scheduledFor: string;
	startedAt: string;
	attempt: number;
}

export function startExecTaskRun(entry: LoadedExecTask, scheduledFor: string): StartedTaskRun {
	const taskKey = buildTaskKey("exec", entry.spec);
	const attempt = entry.state.lastRun?.scheduledFor === scheduledFor ? entry.state.lastRun.attempt + 1 : 1;
	const run = startTaskRun(entry.state, {
		taskKey,
		scheduledFor,
		attempt,
		setActive: (state) => {
			state.running = true;
		},
	});
	entry.state.lastStartedScheduledFor = scheduledFor;
	return run;
}

export function finishExecTaskRun(
	state: IntervalRuntimeState,
	run: StartedTaskRun,
	result: { status: RunStatus; exitCode?: number | null; timedOut?: boolean; error?: string | null },
): void {
	state.lastRunAt = Date.now();
	state.lastCompletedScheduledFor = run.scheduledFor;
	finishTaskRun(state, run, result);
}

export function failExecTaskRun(state: IntervalRuntimeState, run: StartedTaskRun, error: string): void {
	failTaskRun(state, run, error);
}

export function finalizeExecTaskRun(state: IntervalRuntimeState): void {
	state.running = false;
	state.currentRun = undefined;
}

export function startAgentTaskRun(entry: LoadedAgentTask, scheduledFor: string): StartedTaskRun {
	const taskKey = buildTaskKey("agent", entry.spec);
	const attempt = entry.state.lastRun?.scheduledFor === scheduledFor ? entry.state.lastRun.attempt + 1 : 1;
	const run = startTaskRun(entry.state, {
		taskKey,
		scheduledFor,
		attempt,
		setActive: (state) => {
			state.delivering = true;
		},
	});
	entry.state.lastStartedScheduledFor = scheduledFor;
	return run;
}

export function finishAgentTaskRun(state: AgentTaskRuntimeState, run: StartedTaskRun): void {
	state.lastDeliveredAt = Date.now();
	state.deliveryCount += 1;
	state.lastCompletedScheduledFor = run.scheduledFor;
	finishTaskRun(state, run, { status: "success", error: null });
}

export function failAgentTaskRun(state: AgentTaskRuntimeState, run: StartedTaskRun, error: string): void {
	failTaskRun(state, run, error);
}

export function finalizeAgentTaskRun(state: AgentTaskRuntimeState): void {
	state.delivering = false;
	state.currentRun = undefined;
}

function startTaskRun<TState extends IntervalRuntimeState | AgentTaskRuntimeState>(
	state: TState,
	params: {
		taskKey: string;
		scheduledFor: string;
		attempt: number;
		setActive: (state: TState) => void;
	},
): StartedTaskRun {
	const startedAt = new Date().toISOString();
	const runId = makeRunId(params.taskKey, params.scheduledFor, params.attempt);
	params.setActive(state);
	state.currentRun = {
		runId,
		scheduledFor: params.scheduledFor,
		startedAt,
		attempt: params.attempt,
		status: "running",
		enginePid: process.pid,
	};
	state.lastError = null;
	return {
		taskKey: params.taskKey,
		runId,
		scheduledFor: params.scheduledFor,
		startedAt,
		attempt: params.attempt,
	};
}

function finishTaskRun(
	state: IntervalRuntimeState | AgentTaskRuntimeState,
	run: StartedTaskRun,
	result: { status: RunStatus; exitCode?: number | null; timedOut?: boolean; error?: string | null },
): void {
	const finishedAt = new Date().toISOString();
	state.counters.runCount += 1;
	if (result.status === "success") {
		state.counters.successCount += 1;
		state.lastError = null;
	} else {
		state.counters.failureCount += 1;
		state.lastError = result.error ?? null;
	}
	state.lastRun = {
		runId: run.runId,
		scheduledFor: run.scheduledFor,
		startedAt: run.startedAt,
		finishedAt,
		attempt: run.attempt,
		status: result.status,
		enginePid: process.pid,
		exitCode: result.exitCode,
		timedOut: result.timedOut,
		error: result.error,
	};
	state.currentRun = undefined;
}

function failTaskRun(
	state: IntervalRuntimeState | AgentTaskRuntimeState,
	run: StartedTaskRun,
	error: string,
): void {
	finishTaskRun(state, run, { status: "failed", error });
}
