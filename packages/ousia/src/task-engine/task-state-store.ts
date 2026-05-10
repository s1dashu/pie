import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { atomicWriteFile, ensureParentDir } from "./file-utils.js";
import { TASK_RUNS_FILE, TASK_STATE_FILE, type TaskEngineContext } from "./engine-context.js";
import { resolveEntryWorkingDirectory } from "./task-discovery.js";
import {
	buildTaskKey,
	createEmptyCounters,
	type AgentTaskRuntimeState,
	type IntervalRuntimeState,
	type LoadedAgentTask,
	type LoadedExecTask,
	type TaskCounters,
	type TaskKind,
	type TaskRunSnapshot,
} from "./runtime-types.js";

function normalizeCounters(raw: unknown): TaskCounters {
	if (!raw || typeof raw !== "object") {
		return createEmptyCounters();
	}
	const record = raw as Record<string, unknown>;
	return {
		runCount: typeof record.runCount === "number" && Number.isFinite(record.runCount) ? record.runCount : 0,
		successCount:
			typeof record.successCount === "number" && Number.isFinite(record.successCount) ? record.successCount : 0,
		failureCount:
			typeof record.failureCount === "number" && Number.isFinite(record.failureCount) ? record.failureCount : 0,
		skipCount: typeof record.skipCount === "number" && Number.isFinite(record.skipCount) ? record.skipCount : 0,
	};
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}

function normalizeRunSnapshot(raw: unknown): TaskRunSnapshot | undefined {
	if (!raw || typeof raw !== "object") {
		return undefined;
	}
	const record = raw as Record<string, unknown>;
	if (!isNonEmptyString(record.runId) || !isNonEmptyString(record.scheduledFor) || !isNonEmptyString(record.startedAt)) {
		return undefined;
	}
	const status = record.status;
	if (status !== "running" && status !== "success" && status !== "failed" && status !== "skipped") {
		return undefined;
	}
	return {
		runId: record.runId,
		scheduledFor: record.scheduledFor,
		startedAt: record.startedAt,
		finishedAt: isNonEmptyString(record.finishedAt) ? record.finishedAt : undefined,
		attempt: typeof record.attempt === "number" && Number.isFinite(record.attempt) ? record.attempt : 1,
		status,
		enginePid: typeof record.enginePid === "number" && Number.isFinite(record.enginePid) ? record.enginePid : 0,
		exitCode: typeof record.exitCode === "number" || record.exitCode === null ? record.exitCode : undefined,
		timedOut: typeof record.timedOut === "boolean" ? record.timedOut : undefined,
		error: typeof record.error === "string" || record.error === null ? record.error : undefined,
	};
}

export interface PersistedRuntimeState {
	execTaskStates: Map<string, IntervalRuntimeState>;
	agentTaskStates: Map<string, AgentTaskRuntimeState>;
}

export class TaskStateStore {
	constructor(private readonly ctx: TaskEngineContext) {}

	readPersistedRuntimeState(): PersistedRuntimeState {
		if (!existsSync(this.ctx.statePath)) {
			return {
				execTaskStates: new Map<string, IntervalRuntimeState>(),
				agentTaskStates: new Map<string, AgentTaskRuntimeState>(),
			};
		}
		try {
			const raw = JSON.parse(readFileSync(this.ctx.statePath, "utf8")) as {
				execTasks?: Array<{ id?: unknown; taskKey?: unknown; lastRunAt?: unknown }>;
				agentTasks?: Array<{ id?: unknown; taskKey?: unknown; lastDeliveredAt?: unknown; deliveryCount?: unknown }>;
			};
			const execTaskStates = new Map<string, IntervalRuntimeState>();
			for (const entry of raw.execTasks ?? []) {
				if (typeof entry.id !== "string" || entry.id.trim() === "") {
					continue;
				}
				const key = typeof entry.taskKey === "string" && entry.taskKey.trim() ? entry.taskKey : entry.id;
				const lastRunAtMs =
					typeof entry.lastRunAt === "string" && Number.isFinite(Date.parse(entry.lastRunAt))
						? Date.parse(entry.lastRunAt)
						: undefined;
				execTaskStates.set(key, {
					running: false,
					lastRunAt: lastRunAtMs,
					counters: createEmptyCounters(),
				});
			}
			const agentTaskStates = new Map<string, AgentTaskRuntimeState>();
			for (const entry of raw.agentTasks ?? []) {
				if (typeof entry.id !== "string" || entry.id.trim() === "") {
					continue;
				}
				const key = typeof entry.taskKey === "string" && entry.taskKey.trim() ? entry.taskKey : entry.id;
				const lastDeliveredAtMs =
					typeof entry.lastDeliveredAt === "string" && Number.isFinite(Date.parse(entry.lastDeliveredAt))
						? Date.parse(entry.lastDeliveredAt)
						: undefined;
				agentTaskStates.set(key, {
					delivering: false,
					lastDeliveredAt: lastDeliveredAtMs,
					deliveryCount:
						typeof entry.deliveryCount === "number" && Number.isFinite(entry.deliveryCount)
							? entry.deliveryCount
							: 0,
					counters: createEmptyCounters(),
				});
			}
			return { execTaskStates, agentTaskStates };
		} catch {
			return {
				execTaskStates: new Map<string, IntervalRuntimeState>(),
				agentTaskStates: new Map<string, AgentTaskRuntimeState>(),
			};
		}
	}

	restoreExecTaskState(filePath: string, fallback?: IntervalRuntimeState): IntervalRuntimeState {
		const raw = this.readTaskStateFile(filePath);
		if (!raw) {
			return fallback ?? { running: false, counters: createEmptyCounters() };
		}
		const schedule = raw.schedule && typeof raw.schedule === "object" ? (raw.schedule as Record<string, unknown>) : {};
		const lastRunAt = isNonEmptyString(schedule.lastCompletedAt)
			? Date.parse(schedule.lastCompletedAt)
			: isNonEmptyString(schedule.lastCompletedScheduledFor)
				? Date.parse(schedule.lastCompletedScheduledFor)
				: undefined;
		const lastRunAtMs = Number.isFinite(lastRunAt) ? lastRunAt : fallback?.lastRunAt;
		return {
			running: false,
			lastRunAt: lastRunAtMs,
			lastStartedScheduledFor: isNonEmptyString(schedule.lastStartedScheduledFor)
				? schedule.lastStartedScheduledFor
				: fallback?.lastStartedScheduledFor,
			lastCompletedScheduledFor: isNonEmptyString(schedule.lastCompletedScheduledFor)
				? schedule.lastCompletedScheduledFor
				: fallback?.lastCompletedScheduledFor,
			lastSkippedScheduledFor: isNonEmptyString(schedule.lastSkippedScheduledFor)
				? schedule.lastSkippedScheduledFor
				: fallback?.lastSkippedScheduledFor,
			currentRun: undefined,
			lastRun: normalizeRunSnapshot(raw.lastRun) ?? fallback?.lastRun,
			counters: normalizeCounters(raw.counters ?? fallback?.counters),
			lastError: typeof raw.lastError === "string" || raw.lastError === null ? raw.lastError : fallback?.lastError,
		};
	}

	restoreAgentTaskState(filePath: string, fallback?: AgentTaskRuntimeState): AgentTaskRuntimeState {
		const raw = this.readTaskStateFile(filePath);
		if (!raw) {
			return fallback ?? { delivering: false, deliveryCount: 0, counters: createEmptyCounters() };
		}
		const schedule = raw.schedule && typeof raw.schedule === "object" ? (raw.schedule as Record<string, unknown>) : {};
		const lastDeliveredAt = isNonEmptyString(schedule.lastCompletedAt)
			? Date.parse(schedule.lastCompletedAt)
			: isNonEmptyString(schedule.lastCompletedScheduledFor)
				? Date.parse(schedule.lastCompletedScheduledFor)
				: undefined;
		const counters = normalizeCounters(raw.counters ?? fallback?.counters);
		return {
			delivering: false,
			lastDeliveredAt: Number.isFinite(lastDeliveredAt) ? lastDeliveredAt : fallback?.lastDeliveredAt,
			deliveryCount:
				typeof raw.deliveryCount === "number" && Number.isFinite(raw.deliveryCount)
					? raw.deliveryCount
					: fallback?.deliveryCount ?? counters.runCount,
			lastStartedScheduledFor: isNonEmptyString(schedule.lastStartedScheduledFor)
				? schedule.lastStartedScheduledFor
				: fallback?.lastStartedScheduledFor,
			lastCompletedScheduledFor: isNonEmptyString(schedule.lastCompletedScheduledFor)
				? schedule.lastCompletedScheduledFor
				: fallback?.lastCompletedScheduledFor,
			lastSkippedScheduledFor: isNonEmptyString(schedule.lastSkippedScheduledFor)
				? schedule.lastSkippedScheduledFor
				: fallback?.lastSkippedScheduledFor,
			currentRun: undefined,
			lastRun: normalizeRunSnapshot(raw.lastRun) ?? fallback?.lastRun,
			counters,
			lastError: typeof raw.lastError === "string" || raw.lastError === null ? raw.lastError : fallback?.lastError,
		};
	}

	appendTaskRunEvent(filePath: string, event: Record<string, unknown>): void {
		const runsPath = join(resolveEntryWorkingDirectory(filePath), TASK_RUNS_FILE);
		ensureParentDir(runsPath);
		appendFileSync(runsPath, `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`, "utf8");
	}

	writeExecTaskState(entry: LoadedExecTask, status?: "active" | "archived" | "disabled"): void {
		this.writeTaskStateFile({
			kind: "exec",
			taskKey: buildTaskKey("exec", entry.spec),
			id: entry.spec.id,
			projectId: entry.spec.projectId,
			filePath: entry.filePath,
			trigger: entry.spec.trigger,
			state: entry.state,
			status,
		});
	}

	writeAgentTaskState(entry: LoadedAgentTask, status?: "active" | "archived" | "disabled"): void {
		this.writeTaskStateFile({
			kind: "agent",
			taskKey: buildTaskKey("agent", entry.spec),
			id: entry.spec.id,
			projectId: entry.spec.projectId,
			filePath: entry.filePath,
			trigger: entry.spec.trigger,
			state: entry.state,
			status,
		});
	}

	writeRuntimeSnapshot(execTasks: Iterable<LoadedExecTask>, agentTasks: Iterable<LoadedAgentTask>): void {
		const snapshot = {
			timestamp: new Date().toISOString(),
			tasks: [
				...[...execTasks].map((entry) => ({
					id: entry.spec.id,
					taskKey: buildTaskKey("exec", entry.spec),
					kind: "exec",
					projectId: entry.spec.projectId,
					filePath: entry.filePath,
					trigger: entry.spec.trigger,
					sink: entry.spec.sink,
					running: entry.state.running,
					lastRunAt: entry.state.lastRunAt ? new Date(entry.state.lastRunAt).toISOString() : undefined,
				})),
				...[...agentTasks].map((entry) => ({
					id: entry.spec.id,
					taskKey: buildTaskKey("agent", entry.spec),
					kind: "agent",
					filePath: entry.filePath,
					trigger: entry.spec.trigger,
					sessionKey: entry.spec.sessionKey,
					projectId: entry.spec.projectId,
					taskId: entry.spec.taskId,
					delivering: entry.state.delivering,
					lastDeliveredAt: entry.state.lastDeliveredAt ? new Date(entry.state.lastDeliveredAt).toISOString() : undefined,
					deliveryCount: entry.state.deliveryCount,
				})),
			],
			execTasks: [...execTasks].map((entry) => ({
				id: entry.spec.id,
				taskKey: buildTaskKey("exec", entry.spec),
				projectId: entry.spec.projectId,
				filePath: entry.filePath,
				trigger: entry.spec.trigger,
				sink: entry.spec.sink,
				running: entry.state.running,
				lastRunAt: entry.state.lastRunAt ? new Date(entry.state.lastRunAt).toISOString() : undefined,
			})),
			agentTasks: [...agentTasks].map((entry) => ({
				id: entry.spec.id,
				taskKey: buildTaskKey("agent", entry.spec),
				filePath: entry.filePath,
				trigger: entry.spec.trigger,
				sessionKey: entry.spec.sessionKey,
				projectId: entry.spec.projectId,
				taskId: entry.spec.taskId,
				delivering: entry.state.delivering,
				lastDeliveredAt: entry.state.lastDeliveredAt ? new Date(entry.state.lastDeliveredAt).toISOString() : undefined,
				deliveryCount: entry.state.deliveryCount,
			})),
		};
		atomicWriteFile(this.ctx.statePath, `${JSON.stringify(snapshot, null, 2)}\n`);
	}

	private readTaskStateFile(filePath: string): Record<string, unknown> | undefined {
		const stateFilePath = join(resolveEntryWorkingDirectory(filePath), TASK_STATE_FILE);
		if (!existsSync(stateFilePath)) {
			return undefined;
		}
		try {
			const parsed = JSON.parse(readFileSync(stateFilePath, "utf8")) as unknown;
			return parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: undefined;
		} catch {
			return undefined;
		}
	}

	private writeTaskStateFile(params: {
		kind: TaskKind;
		taskKey: string;
		id: string;
		projectId?: string;
		filePath: string;
		trigger: unknown;
		state: IntervalRuntimeState | AgentTaskRuntimeState;
		status?: "active" | "archived" | "disabled";
	}): void {
		const statePathForTask = join(resolveEntryWorkingDirectory(params.filePath), TASK_STATE_FILE);
		const lastCompletedAt =
			params.kind === "exec"
				? toIso((params.state as IntervalRuntimeState).lastRunAt)
				: toIso((params.state as AgentTaskRuntimeState).lastDeliveredAt);
		const payload = {
			version: 1,
			taskId: params.id,
			taskKey: params.taskKey,
			kind: params.kind,
			projectId: params.projectId,
			filePath: relative(this.ctx.homeDir, params.filePath),
			status: params.status ?? "active",
			updatedAt: new Date().toISOString(),
			trigger: params.trigger,
			schedule: {
				lastStartedScheduledFor: params.state.lastStartedScheduledFor,
				lastCompletedScheduledFor: params.state.lastCompletedScheduledFor,
				lastSkippedScheduledFor: params.state.lastSkippedScheduledFor,
				lastCompletedAt,
			},
			currentRun: params.state.currentRun ?? null,
			lastRun: params.state.lastRun ?? null,
			counters: params.state.counters,
			lastError: params.state.lastError ?? null,
		};
		atomicWriteFile(statePathForTask, `${JSON.stringify(payload, null, 2)}\n`);
	}
}

function toIso(ms: number | undefined): string | undefined {
	return ms != null ? new Date(ms).toISOString() : undefined;
}
