import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pruneJsonlFile } from "./agent-logs.js";

export type AgentUsageEventType = "message" | "action" | "runtime" | "latency" | "turn" | "token_usage";

export interface AgentUsageEvent {
	timestamp: string;
	type: AgentUsageEventType;
	direction?: "incoming" | "outgoing";
	textChars?: number;
	estimatedTokens?: number;
	actualTokens?: number;
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	actionName?: string;
	status?: "success" | "error";
	runtimeEvent?: "start" | "stop";
	ttfsMs?: number;
	reason?: string;
}

export interface UsageBucket {
	incomingMessages: number;
	outgoingMessages: number;
	actions: number;
	failedActions: number;
	turns: number;
	tokens: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	runDurationMs: number;
}

export interface AgentUsageDailyPoint extends UsageBucket {
	date: string;
}

export interface AgentUsageStats {
	today: UsageBucket;
	total: UsageBucket;
	currentRun: UsageBucket;
	recentDays: AgentUsageDailyPoint[];
	tokenUsageSource: "actual" | "estimated" | "none";
	averageTtfsMs?: number;
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
		turns: 0,
		tokens: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
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

export function pruneAgentUsageEvents(homeDir: string, retentionDays?: number, now = Date.now()): void {
	pruneJsonlFile(getAgentUsageFilePath(homeDir), retentionDays, now);
}

export function summarizeAgentUsage(events: AgentUsageEvent[], options?: { runningSince?: number; now?: number }): AgentUsageStats {
	const now = options?.now ?? Date.now();
	const todayKey = dateKey(now);
	const total = createBucket();
	const currentRun = createBucket();
	const runningSince = options?.runningSince;
	const byDate = new Map<string, UsageBucket>();
	const estimatedTokensByDate = new Map<string, number>();
	const actualTokensByDate = new Map<string, number>();
	const ttfsSamplesMs: number[] = [];
	let currentRunActualTokens = 0;
	let currentRunEstimatedTokens = 0;
	let activeRuntimeStart: number | undefined;
	let hasActualTokens = false;
	let hasEstimatedTokens = false;

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

	function isInCurrentRun(timestamp: string): boolean {
		if (runningSince === undefined) {
			return false;
		}
		const at = Date.parse(timestamp);
		return Number.isFinite(at) && at >= runningSince;
	}

	for (const event of [...events].sort((left, right) => left.timestamp.localeCompare(right.timestamp))) {
		const inCurrentRun = isInCurrentRun(event.timestamp);
		if (event.type === "message") {
			const bucket = bucketFor(event.timestamp);
			if (event.direction === "incoming") {
				total.incomingMessages += 1;
				bucket.incomingMessages += 1;
				if (inCurrentRun) {
					currentRun.incomingMessages += 1;
				}
			} else if (event.direction === "outgoing") {
				total.outgoingMessages += 1;
				bucket.outgoingMessages += 1;
				if (inCurrentRun) {
					currentRun.outgoingMessages += 1;
				}
			}
			const key = dateKey(event.timestamp);
			const actualTokens = typeof event.actualTokens === "number" && Number.isFinite(event.actualTokens) ? event.actualTokens : undefined;
			if (actualTokens !== undefined) {
				hasActualTokens = true;
				actualTokensByDate.set(key, (actualTokensByDate.get(key) ?? 0) + actualTokens);
				const inputTokens = typeof event.inputTokens === "number" && Number.isFinite(event.inputTokens) ? event.inputTokens : 0;
				const outputTokens = typeof event.outputTokens === "number" && Number.isFinite(event.outputTokens) ? event.outputTokens : 0;
				const cacheReadTokens = typeof event.cacheReadTokens === "number" && Number.isFinite(event.cacheReadTokens) ? event.cacheReadTokens : 0;
				const cacheWriteTokens = typeof event.cacheWriteTokens === "number" && Number.isFinite(event.cacheWriteTokens) ? event.cacheWriteTokens : 0;
				bucket.inputTokens += inputTokens;
				bucket.outputTokens += outputTokens;
				bucket.cacheReadTokens += cacheReadTokens;
				bucket.cacheWriteTokens += cacheWriteTokens;
				total.inputTokens += inputTokens;
				total.outputTokens += outputTokens;
				total.cacheReadTokens += cacheReadTokens;
				total.cacheWriteTokens += cacheWriteTokens;
				if (inCurrentRun) {
					currentRunActualTokens += actualTokens;
					currentRun.inputTokens += inputTokens;
					currentRun.outputTokens += outputTokens;
					currentRun.cacheReadTokens += cacheReadTokens;
					currentRun.cacheWriteTokens += cacheWriteTokens;
				}
			} else {
				const estimatedTokens = typeof event.estimatedTokens === "number" && Number.isFinite(event.estimatedTokens) ? event.estimatedTokens : 0;
				if (estimatedTokens > 0) {
					hasEstimatedTokens = true;
				}
				estimatedTokensByDate.set(key, (estimatedTokensByDate.get(key) ?? 0) + estimatedTokens);
				if (inCurrentRun) {
					currentRunEstimatedTokens += estimatedTokens;
				}
			}
			continue;
		}
		if (event.type === "token_usage") {
			const bucket = bucketFor(event.timestamp);
			const key = dateKey(event.timestamp);
			const actualTokens = typeof event.actualTokens === "number" && Number.isFinite(event.actualTokens) ? event.actualTokens : undefined;
			if (actualTokens !== undefined) {
				hasActualTokens = true;
				actualTokensByDate.set(key, (actualTokensByDate.get(key) ?? 0) + actualTokens);
				const inputTokens = typeof event.inputTokens === "number" && Number.isFinite(event.inputTokens) ? event.inputTokens : 0;
				const outputTokens = typeof event.outputTokens === "number" && Number.isFinite(event.outputTokens) ? event.outputTokens : 0;
				const cacheReadTokens = typeof event.cacheReadTokens === "number" && Number.isFinite(event.cacheReadTokens) ? event.cacheReadTokens : 0;
				const cacheWriteTokens = typeof event.cacheWriteTokens === "number" && Number.isFinite(event.cacheWriteTokens) ? event.cacheWriteTokens : 0;
				bucket.inputTokens += inputTokens;
				bucket.outputTokens += outputTokens;
				bucket.cacheReadTokens += cacheReadTokens;
				bucket.cacheWriteTokens += cacheWriteTokens;
				total.inputTokens += inputTokens;
				total.outputTokens += outputTokens;
				total.cacheReadTokens += cacheReadTokens;
				total.cacheWriteTokens += cacheWriteTokens;
				if (inCurrentRun) {
					currentRunActualTokens += actualTokens;
					currentRun.inputTokens += inputTokens;
					currentRun.outputTokens += outputTokens;
					currentRun.cacheReadTokens += cacheReadTokens;
					currentRun.cacheWriteTokens += cacheWriteTokens;
				}
			}
			continue;
		}
		if (event.type === "action") {
			const bucket = bucketFor(event.timestamp);
			total.actions += 1;
			bucket.actions += 1;
			if (inCurrentRun) {
				currentRun.actions += 1;
			}
			if (event.status === "error") {
				total.failedActions += 1;
				bucket.failedActions += 1;
				if (inCurrentRun) {
					currentRun.failedActions += 1;
				}
			}
			continue;
		}
		if (event.type === "turn") {
			const bucket = bucketFor(event.timestamp);
			total.turns += 1;
			bucket.turns += 1;
			if (inCurrentRun) {
				currentRun.turns += 1;
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
		if (event.type === "latency") {
			const ttfsMs = typeof event.ttfsMs === "number" && Number.isFinite(event.ttfsMs) && event.ttfsMs >= 0 ? event.ttfsMs : undefined;
			if (ttfsMs !== undefined) {
				ttfsSamplesMs.push(ttfsMs);
			}
		}
	}

	if (options?.runningSince !== undefined) {
		addRuntimeDuration(options.runningSince, now);
		currentRun.runDurationMs = Math.max(0, now - options.runningSince);
	} else if (activeRuntimeStart !== undefined) {
		addRuntimeDuration(activeRuntimeStart, now);
	}

	for (const [key, bucket] of byDate) {
		bucket.tokens = actualTokensByDate.get(key) ?? estimatedTokensByDate.get(key) ?? 0;
		total.tokens += bucket.tokens;
	}
	total.turns = [...byDate.values()].reduce((sum, bucket) => sum + bucket.turns, 0);
	currentRun.tokens = currentRunActualTokens || currentRunEstimatedTokens;
	const recentTtfsSamplesMs = ttfsSamplesMs.slice(-3);
	const averageTtfsMs = recentTtfsSamplesMs.length
		? recentTtfsSamplesMs.reduce((sum, value) => sum + value, 0) / recentTtfsSamplesMs.length
		: undefined;

	return {
		today: byDate.get(todayKey) ?? createBucket(),
		total,
		currentRun,
		recentDays: [...byDate.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.slice(-14)
			.map(([date, bucket]) => ({ date, ...bucket })),
		tokenUsageSource: hasActualTokens ? "actual" : hasEstimatedTokens ? "estimated" : "none",
		averageTtfsMs,
		runningSince: options?.runningSince !== undefined ? new Date(options.runningSince).toISOString() : undefined,
		updatedAt: new Date(now).toISOString(),
	};
}
