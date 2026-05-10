import { CronExpressionParser } from "cron-parser";

export interface TaskSinkAppendJsonl {
	type: "append_jsonl";
	path: string;
}

export interface TaskSinkWriteJson {
	type: "write_json";
	path: string;
}

export type TaskSink = TaskSinkAppendJsonl | TaskSinkWriteJson;

export interface ScheduledTriggerWindow {
	startAt?: string;
	endAt?: string;
}

export interface IntervalTrigger extends ScheduledTriggerWindow {
	type: "interval";
	everySec: number;
}

export interface CronTrigger extends ScheduledTriggerWindow {
	type: "cron";
	cron: string;
}

export type ExecTaskTrigger = IntervalTrigger | CronTrigger;

export interface ExecRun {
	type: "exec";
	command: string;
	cwd?: string;
	timeoutSec?: number;
}

export type ExecTaskRun = ExecRun;

export interface BaseExecTaskSpec {
	version: 1;
	id: string;
	enabled?: boolean;
	description?: string;
	projectId?: string;
	sink: TaskSink;
}

export interface IntervalExecTaskSpec extends BaseExecTaskSpec {
	trigger: IntervalTrigger;
	run: ExecRun;
}

export interface CronExecTaskSpec extends BaseExecTaskSpec {
	trigger: CronTrigger;
	run: ExecRun;
}

export type ScheduledExecTaskSpec = IntervalExecTaskSpec | CronExecTaskSpec;

export type ExecTaskSpec = ScheduledExecTaskSpec;

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function parseOptionalDateTime(value: unknown, key: string): string | undefined {
	if (value == null) {
		return undefined;
	}
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`${key} must be a non-empty datetime string when provided.`);
	}
	const text = value.trim();
	const timeMs = Date.parse(text);
	if (!Number.isFinite(timeMs)) {
		throw new Error(`${key} must be a valid datetime string.`);
	}
	return text;
}

function parseScheduledTriggerWindow(rawTrigger: Record<string, unknown>): ScheduledTriggerWindow {
	const startAt = parseOptionalDateTime(rawTrigger.startAt, "trigger.startAt");
	const endAt = parseOptionalDateTime(rawTrigger.endAt, "trigger.endAt");
	if (startAt && endAt && Date.parse(startAt) > Date.parse(endAt)) {
		throw new Error("trigger.startAt must be earlier than or equal to trigger.endAt.");
	}
	return { startAt, endAt };
}

function parseExecRun(rawRun: unknown): ExecRun {
	if (!isRecord(rawRun) || typeof rawRun.command !== "string") {
		throw new Error("ExecTask run.command must be a non-empty string.");
	}
	if (rawRun.type != null && rawRun.type !== "exec") {
		throw new Error(`Unsupported run type: ${String(rawRun.type)}`);
	}
	const timeoutSec = rawRun.timeoutSec;
	if (timeoutSec != null && (typeof timeoutSec !== "number" || !Number.isFinite(timeoutSec) || timeoutSec <= 0)) {
		throw new Error("run.timeoutSec must be a positive number when provided.");
	}
	return {
		type: "exec",
		command: rawRun.command.trim(),
		cwd: typeof rawRun.cwd === "string" ? rawRun.cwd : undefined,
		timeoutSec: typeof timeoutSec === "number" ? timeoutSec : undefined,
	};
}

function parseIntervalSeconds(rawTrigger: Record<string, unknown>): number {
	const everySec = rawTrigger.everySec;
	if (typeof everySec === "number" && Number.isFinite(everySec) && everySec > 0) {
		return everySec;
	}
	throw new Error("Interval execTask requires trigger.everySec > 0.");
}

export function parseExecTaskSpec(raw: unknown): ExecTaskSpec {
	if (!isRecord(raw)) {
		throw new Error("ExecTask must be an object.");
	}
	if (raw.version !== 1) {
		throw new Error("ExecTask version must be 1.");
	}
	if (typeof raw.id !== "string" || raw.id.trim() === "") {
		throw new Error("ExecTask id must be a non-empty string.");
	}
	if (!isRecord(raw.trigger) || typeof raw.trigger.type !== "string") {
		throw new Error("ExecTask trigger is required.");
	}
	if (!isRecord(raw.sink) || typeof raw.sink.type !== "string" || typeof raw.sink.path !== "string") {
		throw new Error("ExecTask sink must include type and path.");
	}

	const base = {
		version: 1 as const,
		id: raw.id.trim(),
		enabled: raw.enabled !== false,
		description: typeof raw.description === "string" ? raw.description : undefined,
		projectId: typeof raw.projectId === "string" ? raw.projectId : undefined,
		sink:
			raw.sink.type === "append_jsonl" || raw.sink.type === "write_json"
				? ({ type: raw.sink.type, path: raw.sink.path } satisfies TaskSink)
				: (() => {
						throw new Error(`Unsupported sink type: ${String(raw.sink?.type)}`);
					})(),
	};

	if (raw.trigger.type === "interval") {
		const run = parseExecRun(raw.run);
		return {
			...base,
			trigger: {
				type: "interval",
				everySec: parseIntervalSeconds(raw.trigger),
				...parseScheduledTriggerWindow(raw.trigger),
			},
			run,
		};
	}

	if (raw.trigger.type === "cron") {
		const run = parseExecRun(raw.run);
		if (typeof raw.trigger.cron !== "string" || raw.trigger.cron.trim() === "") {
			throw new Error("Cron execTask requires trigger.cron.");
		}
		const cron = raw.trigger.cron.trim();
		try {
			CronExpressionParser.parse(cron);
		} catch (error) {
			throw new Error(
				`Invalid trigger.cron: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		return {
			...base,
			trigger: {
				type: "cron",
				cron,
				...parseScheduledTriggerWindow(raw.trigger),
			},
			run,
		};
	}

	throw new Error(`Unsupported trigger type: ${String(raw.trigger.type)}`);
}

export function isIntervalExecTaskSpec(spec: ExecTaskSpec): spec is IntervalExecTaskSpec {
	return spec.trigger.type === "interval";
}

export function isCronExecTaskSpec(spec: ExecTaskSpec): spec is CronExecTaskSpec {
	return spec.trigger.type === "cron";
}
