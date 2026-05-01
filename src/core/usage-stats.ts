import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type AgentUsageEventType = "message" | "action" | "runtime";

export interface AgentUsageEvent {
	timestamp: string;
	type: AgentUsageEventType;
	direction?: "incoming" | "outgoing";
	textChars?: number;
	estimatedTokens?: number;
	actionName?: string;
	status?: "success" | "error";
	runtimeEvent?: "start" | "stop";
	reason?: string;
}

export interface UsageBucket {
	incomingMessages: number;
	outgoingMessages: number;
	actions: number;
	failedActions: number;
	tokens: number;
	runDurationMs: number;
}

export interface AgentUsageDailyPoint extends UsageBucket {
	date: string;
}

export interface AgentUsageStats {
	today: UsageBucket;
	total: UsageBucket;
	recentDays: AgentUsageDailyPoint[];
	runningSince?: string;
	updatedAt: string;
}

const USAGE_FILE = "agent-usage-events.jsonl";

function createBucket(): UsageBucket {
	return {
		incomingMessages: 0,
		outgoingMessages: 0,
		actions: 0,
		failedActions: 0,
		tokens: 0,
		runDurationMs: 0,
	};
}

function dateKey(input: string | number | Date): string {
	const date = new Date(input);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export function getAgentUsageFilePath(homeDir: string): string {
	return join(homeDir, "runtime", USAGE_FILE);
}

export function estimateTokensFromText(text: string): number {
	const normalized = text.trim();
	if (!normalized) {
		return 0;
	}
	return Math.max(1, Math.ceil(Array.from(normalized).length / 3));
}

export function appendAgentUsageEvent(homeDir: string, event: Omit<AgentUsageEvent, "timestamp"> & { timestamp?: string }): void {
	const filePath = getAgentUsageFilePath(homeDir);
	mkdirSync(dirname(filePath), { recursive: true });
	appendFileSync(filePath, `${JSON.stringify({ timestamp: event.timestamp ?? new Date().toISOString(), ...event })}\n`, "utf8");
}

export function readAgentUsageEvents(homeDir: string): AgentUsageEvent[] {
	const filePath = getAgentUsageFilePath(homeDir);
	if (!existsSync(filePath)) {
		return [];
	}
	const events: AgentUsageEvent[] = [];
	for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		try {
			const parsed = JSON.parse(trimmed) as AgentUsageEvent;
			if (typeof parsed.timestamp === "string" && typeof parsed.type === "string") {
				events.push(parsed);
			}
		} catch {
			// Ignore malformed append-only telemetry lines.
		}
	}
	return events;
}

export function summarizeAgentUsage(events: AgentUsageEvent[], options?: { runningSince?: number; now?: number }): AgentUsageStats {
	const now = options?.now ?? Date.now();
	const todayKey = dateKey(now);
	const total = createBucket();
	const byDate = new Map<string, UsageBucket>();
	let activeRuntimeStart: number | undefined;

	function bucketFor(timestamp: string): UsageBucket {
		const key = dateKey(timestamp);
		let bucket = byDate.get(key);
		if (!bucket) {
			bucket = createBucket();
			byDate.set(key, bucket);
		}
		return bucket;
	}

	function addRuntimeDuration(startMs: number, endMs: number): void {
		if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
			return;
		}
		const durationMs = endMs - startMs;
		total.runDurationMs += durationMs;
		bucketFor(new Date(startMs).toISOString()).runDurationMs += durationMs;
	}

	for (const event of [...events].sort((left, right) => left.timestamp.localeCompare(right.timestamp))) {
		const bucket = bucketFor(event.timestamp);
		if (event.type === "message") {
			if (event.direction === "incoming") {
				total.incomingMessages += 1;
				bucket.incomingMessages += 1;
			} else if (event.direction === "outgoing") {
				total.outgoingMessages += 1;
				bucket.outgoingMessages += 1;
			}
			const tokens = typeof event.estimatedTokens === "number" && Number.isFinite(event.estimatedTokens) ? event.estimatedTokens : 0;
			total.tokens += tokens;
			bucket.tokens += tokens;
			continue;
		}
		if (event.type === "action") {
			total.actions += 1;
			bucket.actions += 1;
			if (event.status === "error") {
				total.failedActions += 1;
				bucket.failedActions += 1;
			}
			continue;
		}
		if (event.type === "runtime") {
			const at = Date.parse(event.timestamp);
			if (!Number.isFinite(at)) {
				continue;
			}
			if (event.runtimeEvent === "start") {
				activeRuntimeStart = at;
			} else if (event.runtimeEvent === "stop" && activeRuntimeStart !== undefined) {
				addRuntimeDuration(activeRuntimeStart, at);
				activeRuntimeStart = undefined;
			}
		}
	}

	if (options?.runningSince !== undefined) {
		addRuntimeDuration(options.runningSince, now);
	} else if (activeRuntimeStart !== undefined) {
		addRuntimeDuration(activeRuntimeStart, now);
	}

	return {
		today: byDate.get(todayKey) ?? createBucket(),
		total,
		recentDays: [...byDate.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.slice(-14)
			.map(([date, bucket]) => ({ date, ...bucket })),
		runningSince: options?.runningSince !== undefined ? new Date(options.runningSince).toISOString() : undefined,
		updatedAt: new Date(now).toISOString(),
	};
}
