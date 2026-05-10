import type { AgentTaskSpec } from "./agent-task-types.js";
import type { ExecTaskSpec } from "./task-types.js";

export type TaskKind = "exec" | "agent";
export type RunStatus = "running" | "success" | "failed" | "skipped";

export interface TaskRunSnapshot {
	runId: string;
	scheduledFor: string;
	startedAt: string;
	finishedAt?: string;
	attempt: number;
	status: RunStatus;
	enginePid: number;
	exitCode?: number | null;
	timedOut?: boolean;
	error?: string | null;
}

export interface TaskCounters {
	runCount: number;
	successCount: number;
	failureCount: number;
	skipCount: number;
}

export interface IntervalRuntimeState {
	lastRunAt?: number;
	running: boolean;
	lastStartedScheduledFor?: string;
	lastCompletedScheduledFor?: string;
	lastSkippedScheduledFor?: string;
	currentRun?: TaskRunSnapshot;
	lastRun?: TaskRunSnapshot;
	counters: TaskCounters;
	lastError?: string | null;
}

export interface LoadedExecTask {
	spec: ExecTaskSpec;
	filePath: string;
	mtimeMs: number;
	state: IntervalRuntimeState;
}

export interface AgentTaskRuntimeState {
	delivering: boolean;
	lastDeliveredAt?: number;
	deliveryCount: number;
	lastStartedScheduledFor?: string;
	lastCompletedScheduledFor?: string;
	lastSkippedScheduledFor?: string;
	currentRun?: TaskRunSnapshot;
	lastRun?: TaskRunSnapshot;
	counters: TaskCounters;
	lastError?: string | null;
}

export interface LoadedAgentTask {
	spec: AgentTaskSpec;
	filePath: string;
	mtimeMs: number;
	state: AgentTaskRuntimeState;
}

export function createEmptyCounters(): TaskCounters {
	return {
		runCount: 0,
		successCount: 0,
		failureCount: 0,
		skipCount: 0,
	};
}

export function buildTaskKey(kind: TaskKind, spec: { id: string; projectId?: string }): string {
	return spec.projectId ? `${kind}:project:${spec.projectId}:${spec.id}` : `${kind}:global:${spec.id}`;
}

export function makeRunId(taskKey: string, scheduledFor: string, attempt: number): string {
	return `${taskKey}:${scheduledFor}:attempt-${attempt}`.replace(/[^a-zA-Z0-9:._-]/g, "_");
}
