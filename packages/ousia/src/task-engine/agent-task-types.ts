import { CronExpressionParser } from "cron-parser";

export interface AgentTaskOnceTrigger {
	type: "once";
	runAt: string;
}

export interface AgentTaskIntervalTrigger {
	type: "interval";
	everySec: number;
	startAt?: string;
	endAt?: string;
}

export interface AgentTaskCronTrigger {
	type: "cron";
	cron: string;
	startAt?: string;
	endAt?: string;
}

export type AgentTaskTrigger = AgentTaskOnceTrigger | AgentTaskIntervalTrigger | AgentTaskCronTrigger;

export interface AgentTaskSpec {
	version: 1;
	id: string;
	trigger: AgentTaskTrigger;
	prompt: string;
	enabled?: boolean;
	sessionKey?: string;
	deliveryMode?: "owner" | "silent";
	projectId?: string;
	taskId?: string;
	deleteAfterRun?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function readNonEmptyString(record: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim() !== "") {
			return value.trim();
		}
	}
	return undefined;
}

function normalizeVersion(record: Record<string, unknown>): 1 {
	if (record.version !== 1) {
		throw new Error("Agent task version must be 1.");
	}
	return 1;
}

function normalizePrompt(record: Record<string, unknown>): string {
	const prompt = readNonEmptyString(record, ["prompt"]);
	if (prompt) {
		return prompt;
	}
	const message = readNonEmptyString(record, ["message"]);
	if (message) {
		return `Scheduled reminder: ${message}`;
	}
	const description = readNonEmptyString(record, ["description"]);
	if (description) {
		return `Scheduled agent task: ${description}`;
	}
	throw new Error("Agent task prompt must be a non-empty string.");
}

function parseDateTime(value: unknown, key: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`${key} must be a non-empty ISO timestamp.`);
	}
	const text = value.trim();
	const runAtMs = Date.parse(text);
	if (!Number.isFinite(runAtMs)) {
		throw new Error(`${key} must be a valid ISO timestamp.`);
	}
	return text;
}

function parseOptionalDateTime(value: unknown, key: string): string | undefined {
	if (value == null) {
		return undefined;
	}
	return parseDateTime(value, key);
}

function parseIntervalSeconds(trigger: Record<string, unknown>): number {
	const everySec = trigger.everySec;
	if (typeof everySec === "number" && Number.isFinite(everySec) && everySec > 0) {
		return everySec;
	}
	throw new Error("Interval agent task requires trigger.everySec > 0.");
}

function parseScheduledWindow(trigger: Record<string, unknown>): { startAt?: string; endAt?: string } {
	const startAt = parseOptionalDateTime(trigger.startAt, "trigger.startAt");
	const endAt = parseOptionalDateTime(trigger.endAt, "trigger.endAt");
	if (startAt && endAt && Date.parse(startAt) > Date.parse(endAt)) {
		throw new Error("trigger.startAt must be earlier than or equal to trigger.endAt.");
	}
	return { startAt, endAt };
}

function normalizeTrigger(record: Record<string, unknown>): AgentTaskTrigger {
	if (isRecord(record.trigger) && typeof record.trigger.type === "string") {
		const trigger = record.trigger;
		if (trigger.type === "once") {
			return {
				type: "once",
				runAt: parseDateTime(trigger.runAt, "trigger.runAt"),
			};
		}
		if (trigger.type === "interval") {
			return {
				type: "interval",
				everySec: parseIntervalSeconds(trigger),
				...parseScheduledWindow(trigger),
			};
		}
		if (trigger.type === "cron") {
			if (typeof trigger.cron !== "string" || trigger.cron.trim() === "") {
				throw new Error("Cron agent task requires trigger.cron.");
			}
			const cron = trigger.cron.trim();
			try {
				CronExpressionParser.parse(cron);
			} catch (error) {
				throw new Error(
					`Invalid trigger.cron: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			return {
				type: "cron",
				cron,
				...parseScheduledWindow(trigger),
			};
		}
		throw new Error(`Unsupported agent task trigger type: ${String(trigger.type)}`);
	}
	throw new Error("Agent task trigger is required.");
}

function normalizeEnabled(record: Record<string, unknown>): boolean {
	if (record.enabled === false) {
		return false;
	}
	if (typeof record.status === "string") {
		const normalized = record.status.trim().toLowerCase();
		if (["done", "completed", "cancelled", "archived", "disabled"].includes(normalized)) {
			return false;
		}
	}
	return true;
}

export function parseAgentTaskSpec(raw: unknown): AgentTaskSpec {
	if (!isRecord(raw)) {
		throw new Error("Agent task must be an object.");
	}
	const version = normalizeVersion(raw);
	const id = readNonEmptyString(raw, ["id"]);
	if (!id) {
		throw new Error("Agent task id must be a non-empty string.");
	}
	const trigger = normalizeTrigger(raw);
	return {
		version,
		id,
		trigger,
		prompt: normalizePrompt(raw),
		enabled: normalizeEnabled(raw),
		sessionKey: typeof raw.sessionKey === "string" ? raw.sessionKey : undefined,
		deliveryMode: raw.deliveryMode === "silent" ? "silent" : undefined,
		projectId: typeof raw.projectId === "string" ? raw.projectId : undefined,
		taskId: typeof raw.taskId === "string" ? raw.taskId : undefined,
		deleteAfterRun: raw.deleteAfterRun !== false,
	};
}
