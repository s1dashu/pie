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

function scopeContentId(runId: string, turnId: string, id: string): string {
	return `${runId}:${turnId}:${id}`;
}

export class AgentEventNormalizer {
	private runIndex = 0;
	private currentRunId = "";
	private currentTurnId = "";
	private currentTurnIndex = 0;
	private nextImplicitTextIndex = 0;
	private activeImplicitTextId = "";
	private activeImplicitText = "";

	constructor(private readonly session: AgentConversationSession) {}

	normalize(event: PiAgentSessionEvent | AgentSessionEvent): AgentSessionEvent[] {
		if (isPieEvent(event)) {
			return [event];
		}
		return this.normalizePiEvent(event);
	}

	private ensureRun(): string {
		if (!this.currentRunId) {
			this.runIndex += 1;
			this.currentRunId = `run_${this.runIndex}`;
		}
		return this.currentRunId;
	}

	private ensureTurn(): string {
		this.ensureRun();
		if (!this.currentTurnId) {
			this.currentTurnIndex += 1;
			this.currentTurnId = `turn_${this.currentTurnIndex}`;
		}
		return this.currentTurnId;
	}

	private normalizePiEvent(event: PiAgentSessionEvent): AgentSessionEvent[] {
		switch (event.type) {
			case "agent_start": {
				this.runIndex += 1;
				this.currentRunId = `run_${this.runIndex}`;
				this.currentTurnId = "";
				this.currentTurnIndex = 0;
				this.resetImplicitTextBlock();
				return [{ type: "agent_run_started", runId: this.currentRunId }];
			}
			case "agent_end": {
				const runId = this.ensureRun();
				const finalText = extractAssistantText(this.session);
				const status = wasLastAssistantMessageAborted(this.session)
					? "aborted"
					: extractLastAssistantError(this.session)
						? "error"
						: "success";
				this.currentRunId = "";
				this.currentTurnId = "";
				this.resetImplicitTextBlock();
				return [{ type: "agent_run_finished", runId, status, finalText, usage: extractLastAssistantUsage(this.session) }];
			}
			case "turn_start": {
				const runId = this.ensureRun();
				const source = readObject(event);
				const index = typeof source?.turnIndex === "number" ? source.turnIndex : this.currentTurnIndex + 1;
				this.currentTurnIndex = index;
				this.currentTurnId = `turn_${index}`;
				this.resetImplicitTextBlock();
				return [{ type: "turn_started", runId, turnId: this.currentTurnId, index }];
			}
			case "turn_end": {
				const runId = this.ensureRun();
				const turnId = this.ensureTurn();
				const status = wasLastAssistantMessageAborted(this.session)
					? "aborted"
					: extractLastAssistantError(this.session)
						? "error"
						: "success";
				const events = this.finishImplicitTextBlock();
				this.currentTurnId = "";
				return [...events, { type: "turn_finished", runId, turnId, status }];
			}
			case "message_update":
				return this.normalizeAssistantMessageEvent(event);
			case "tool_execution_start": {
				const source = readObject(event);
				const runId = this.ensureRun();
				const turnId = this.ensureTurn();
				return [...this.finishImplicitTextBlock(), {
					type: "tool_call_started",
					runId,
					turnId,
					toolCallId: makeId("tool", source?.toolCallId, `${this.currentTurnIndex}`),
					name: String(source?.toolName ?? "tool"),
					args: source?.args,
				}];
			}
			case "tool_execution_update": {
				const source = readObject(event);
				const runId = this.ensureRun();
				const turnId = this.ensureTurn();
				return [{
					type: "tool_call_updated",
					runId,
					turnId,
					toolCallId: makeId("tool", source?.toolCallId, `${this.currentTurnIndex}`),
					name: String(source?.toolName ?? "tool"),
					args: source?.args,
					partialResult: source?.partialResult,
				}];
			}
			case "tool_execution_end": {
				const source = readObject(event);
				const runId = this.ensureRun();
				const turnId = this.ensureTurn();
				return [{
					type: "tool_call_finished",
					runId,
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
		const runId = this.ensureRun();
		const turnId = this.ensureTurn();
		const textId = this.resolveTextId(runId, turnId, contentIndex);
		const thinkingId = scopeContentId(runId, turnId, makeId("thinking", contentIndex, "0"));
		if (assistantType === "text_start") {
			return [{ type: "text_start", runId, turnId, textId }];
		}
		if (assistantType === "text_delta") {
			const delta = String(assistantEvent.delta ?? "");
			if (contentIndex === undefined) {
				this.activeImplicitText += delta;
			}
			return [{ type: "text_delta", runId, turnId, textId, delta }];
		}
		if (assistantType === "text_end") {
			const text = contentIndex === undefined && this.activeImplicitTextId === textId
				? this.activeImplicitText || String(assistantEvent.content ?? "")
				: String(assistantEvent.content ?? "");
			if (contentIndex === undefined && this.activeImplicitTextId === textId) {
				this.resetActiveImplicitTextBlock();
			}
			return [{ type: "text_finished", runId, turnId, textId, text }];
		}
		if (assistantType === "thinking_start") {
			return [{ type: "thinking_start", runId, turnId, thinkingId }];
		}
		if (assistantType === "thinking_delta") {
			return [{ type: "thinking_delta", runId, turnId, thinkingId, delta: String(assistantEvent.delta ?? "") }];
		}
		if (assistantType === "thinking_end") {
			return [{ type: "thinking_finished", runId, turnId, thinkingId, thinking: String(assistantEvent.content ?? "") }];
		}
		return [];
	}

	private resolveTextId(runId: string, turnId: string, contentIndex: unknown): string {
		if (contentIndex !== undefined) {
			return scopeContentId(runId, turnId, makeId("text", contentIndex, "0"));
		}
		if (!this.activeImplicitTextId) {
			this.activeImplicitTextId = scopeContentId(runId, turnId, `text_${this.nextImplicitTextIndex}`);
			this.nextImplicitTextIndex += 1;
			this.activeImplicitText = "";
		}
		return this.activeImplicitTextId;
	}

	private finishImplicitTextBlock(): AgentSessionEvent[] {
		if (!this.activeImplicitTextId) {
			return [];
		}
		const event: AgentSessionEvent = {
			type: "text_finished",
			runId: this.ensureRun(),
			turnId: this.ensureTurn(),
			textId: this.activeImplicitTextId,
			text: this.activeImplicitText,
		};
		this.resetActiveImplicitTextBlock();
		return [event];
	}

	private resetActiveImplicitTextBlock(): void {
		this.activeImplicitTextId = "";
		this.activeImplicitText = "";
	}

	private resetImplicitTextBlock(): void {
		this.nextImplicitTextIndex = 0;
		this.resetActiveImplicitTextBlock();
	}
}

function isPieEvent(event: PiAgentSessionEvent | AgentSessionEvent): event is AgentSessionEvent {
	return [
		"agent_run_started",
		"agent_run_finished",
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
