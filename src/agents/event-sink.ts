import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentSessionEvent } from "./types.js";

const AGENT_EVENTS_FILE = "agent-events.jsonl";

export interface AgentEventSinkContext {
	homeDir: string;
	conversationKey?: string;
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

export function createProfileAgentEventSink(context: AgentEventSinkContext): AgentEventSink {
	return {
		emit(event) {
			appendAgentSessionEvent(context, event);
		},
	};
}
