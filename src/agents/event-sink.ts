import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentSessionEvent } from "./types.js";

const AGENT_EVENTS_FILE = "agent-events.jsonl";

export interface AgentEventSinkContext {
	homeDir: string;
	conversationKey?: string;
}

export interface AgentEventLogEntry {
	timestamp: string;
	conversationKey?: string;
	event: AgentSessionEvent;
	sequence?: number;
}

export interface AgentEventSink {
	emit(event: AgentSessionEvent): void;
}

export function getAgentEventsFilePath(homeDir: string): string {
	return join(homeDir, "runtime", AGENT_EVENTS_FILE);
}

export function appendAgentSessionEvent(context: AgentEventSinkContext, event: AgentSessionEvent): void {
	const filePath = getAgentEventsFilePath(context.homeDir);
	mkdirSync(dirname(filePath), { recursive: true });
	appendFileSync(
		filePath,
		`${JSON.stringify({
			timestamp: new Date().toISOString(),
			...(context.conversationKey ? { conversationKey: context.conversationKey } : {}),
			event,
		})}\n`,
		"utf8",
	);
}

export function readAgentSessionEvents(homeDir: string, limit = 1000): AgentEventLogEntry[] {
	const filePath = getAgentEventsFilePath(homeDir);
	if (!existsSync(filePath)) {
		return [];
	}
	const entries: AgentEventLogEntry[] = [];
	for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		try {
			const parsed = JSON.parse(trimmed) as Partial<AgentEventLogEntry>;
			if (typeof parsed.timestamp === "string" && parsed.event && typeof parsed.event === "object") {
				entries.push({
					timestamp: parsed.timestamp,
					conversationKey: typeof parsed.conversationKey === "string" ? parsed.conversationKey : undefined,
					event: parsed.event as AgentSessionEvent,
					sequence: entries.length,
				});
			}
		} catch {
			// Ignore malformed append-only event lines.
		}
	}
	return entries.slice(-limit);
}

export function clearAgentSessionEvents(homeDir: string, conversationKey: string): number {
	const filePath = getAgentEventsFilePath(homeDir);
	if (!existsSync(filePath)) {
		return 0;
	}
	const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
	const keptLines: string[] = [];
	let clearedCount = 0;
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		try {
			const parsed = JSON.parse(trimmed) as Partial<AgentEventLogEntry>;
			if (parsed.conversationKey === conversationKey) {
				clearedCount += 1;
				continue;
			}
		} catch {
			// Keep malformed lines; the reader will continue ignoring them.
		}
		keptLines.push(line);
	}
	const tempPath = `${filePath}.tmp`;
	writeFileSync(tempPath, keptLines.length ? `${keptLines.join("\n")}\n` : "", "utf8");
	renameSync(tempPath, filePath);
	return clearedCount;
}

export function createProfileAgentEventSink(context: AgentEventSinkContext): AgentEventSink {
	return {
		emit(event) {
			appendAgentSessionEvent(context, event);
		},
	};
}
