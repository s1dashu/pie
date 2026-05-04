import type { AgentConversationSession, AgentSessionEvent, PiAgentSessionEvent } from "./types.js";
import { extractAssistantText, extractLastAssistantError, extractLastAssistantUsage, wasLastAssistantMessageAborted } from "./messages.js";

function readObject(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value ? value : undefined;
}

function makeId(prefix: string, value: unknown, fallback: string): string {
	return readString(value) ?? `${prefix}_${fallback}`;
}

export class AgentEventNormalizer {
	private roundIndex = 0;
	private currentRoundId = "";
	private currentTurnId = "";
	private currentTurnIndex = 0;

	constructor(private readonly session: AgentConversationSession) {}

	normalize(event: PiAgentSessionEvent | AgentSessionEvent): AgentSessionEvent[] {
		if (isPieEvent(event)) {
			return [event];
		}
		return this.normalizePiEvent(event);
	}

	private ensureRound(): string {
		if (!this.currentRoundId) {
			this.roundIndex += 1;
			this.currentRoundId = `round_${this.roundIndex}`;
		}
		return this.currentRoundId;
	}

	private ensureTurn(): string {
		this.ensureRound();
		if (!this.currentTurnId) {
			this.currentTurnIndex += 1;
			this.currentTurnId = `turn_${this.currentTurnIndex}`;
		}
		return this.currentTurnId;
	}

	private normalizePiEvent(event: PiAgentSessionEvent): AgentSessionEvent[] {
		switch (event.type) {
			case "agent_start": {
				this.roundIndex += 1;
				this.currentRoundId = `round_${this.roundIndex}`;
				this.currentTurnId = "";
				this.currentTurnIndex = 0;
				return [{ type: "round_started", roundId: this.currentRoundId }];
			}
			case "agent_end": {
				const roundId = this.ensureRound();
				const finalText = extractAssistantText(this.session);
				const status = wasLastAssistantMessageAborted(this.session)
					? "aborted"
					: extractLastAssistantError(this.session)
						? "error"
						: "success";
				this.currentRoundId = "";
				this.currentTurnId = "";
				return [{ type: "round_finished", roundId, status, finalText, usage: extractLastAssistantUsage(this.session) }];
			}
			case "turn_start": {
				const roundId = this.ensureRound();
				const source = readObject(event);
				const index = typeof source?.turnIndex === "number" ? source.turnIndex : this.currentTurnIndex + 1;
				this.currentTurnIndex = index;
				this.currentTurnId = `turn_${index}`;
				return [{ type: "turn_started", roundId, turnId: this.currentTurnId, index }];
			}
			case "turn_end": {
				const roundId = this.ensureRound();
				const turnId = this.ensureTurn();
				const status = wasLastAssistantMessageAborted(this.session)
					? "aborted"
					: extractLastAssistantError(this.session)
						? "error"
						: "success";
				this.currentTurnId = "";
				return [{ type: "turn_finished", roundId, turnId, status }];
			}
			case "message_update":
				return this.normalizeAssistantMessageEvent(event);
			case "tool_execution_start": {
				const source = readObject(event);
				const roundId = this.ensureRound();
				const turnId = this.ensureTurn();
				return [{
					type: "tool_call_started",
					roundId,
					turnId,
					toolCallId: makeId("tool", source?.toolCallId, `${this.currentTurnIndex}`),
					name: String(source?.toolName ?? "tool"),
					args: source?.args,
				}];
			}
			case "tool_execution_update": {
				const source = readObject(event);
				const roundId = this.ensureRound();
				const turnId = this.ensureTurn();
				return [{
					type: "tool_call_updated",
					roundId,
					turnId,
					toolCallId: makeId("tool", source?.toolCallId, `${this.currentTurnIndex}`),
					name: String(source?.toolName ?? "tool"),
					args: source?.args,
					partialResult: source?.partialResult,
				}];
			}
			case "tool_execution_end": {
				const source = readObject(event);
				const roundId = this.ensureRound();
				const turnId = this.ensureTurn();
				return [{
					type: "tool_call_finished",
					roundId,
					turnId,
					toolCallId: makeId("tool", source?.toolCallId, `${this.currentTurnIndex}`),
					name: String(source?.toolName ?? "tool"),
					result: source?.result,
					isError: Boolean(source?.isError),
				}];
			}
			case "compaction_start":
			case "compaction_end":
			case "auto_retry_start":
			case "auto_retry_end":
				return [event as AgentSessionEvent];
			default:
				return [];
		}
	}

	private normalizeAssistantMessageEvent(event: Extract<PiAgentSessionEvent, { type: "message_update" }>): AgentSessionEvent[] {
		const assistantEvent = readObject((event as { assistantMessageEvent?: unknown }).assistantMessageEvent);
		if (!assistantEvent) {
			return [];
		}
		const assistantType = assistantEvent?.type;
		const contentIndex = assistantEvent?.contentIndex;
		const roundId = this.ensureRound();
		const turnId = this.ensureTurn();
		if (assistantType === "text_start") {
			return [{ type: "text_start", roundId, turnId, textId: makeId("text", contentIndex, "0") }];
		}
		if (assistantType === "text_delta") {
			return [{ type: "text_delta", roundId, turnId, textId: makeId("text", contentIndex, "0"), delta: String(assistantEvent.delta ?? "") }];
		}
		if (assistantType === "text_end") {
			return [{ type: "text_finished", roundId, turnId, textId: makeId("text", contentIndex, "0"), text: String(assistantEvent.content ?? "") }];
		}
		if (assistantType === "thinking_start") {
			return [{ type: "thinking_start", roundId, turnId, thinkingId: makeId("thinking", contentIndex, "0") }];
		}
		if (assistantType === "thinking_delta") {
			return [{ type: "thinking_delta", roundId, turnId, thinkingId: makeId("thinking", contentIndex, "0"), delta: String(assistantEvent.delta ?? "") }];
		}
		if (assistantType === "thinking_end") {
			return [{ type: "thinking_finished", roundId, turnId, thinkingId: makeId("thinking", contentIndex, "0"), thinking: String(assistantEvent.content ?? "") }];
		}
		return [];
	}
}

function isPieEvent(event: PiAgentSessionEvent | AgentSessionEvent): event is AgentSessionEvent {
	return [
		"round_started",
		"round_finished",
		"token_usage",
		"turn_started",
		"turn_finished",
		"text_start",
		"text_delta",
		"text_finished",
		"thinking_start",
		"thinking_delta",
		"thinking_finished",
		"tool_call_started",
		"tool_call_updated",
		"tool_call_finished",
		"compaction_start",
		"compaction_end",
		"auto_retry_start",
		"auto_retry_end",
	].includes((event as { type?: string }).type ?? "");
}
