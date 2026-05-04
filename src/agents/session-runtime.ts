import { getAgentBackendDefinition } from "./backend-registry.js";
import { appendAgentUsageEvent } from "../core/usage-stats.js";
import { AgentEventNormalizer } from "./event-normalizer.js";
import { createProfileAgentEventSink } from "./event-sink.js";
import { attachAgentSessionLogging, logAgentPrompt } from "./session-logging.js";
import {
	extractAssistantText,
	extractLastAssistantError,
	wasLastAssistantMessageAborted,
} from "./messages.js";
import { getAgentRoundInputText } from "./types.js";
import type {
	AgentConversationSession,
	AgentConversationSessionPool,
	AgentRoundInputLike,
	AgentSessionEvent,
	AgentSessionRuntimeOptions,
} from "./types.js";

export type {
	AgentBackendAdapter,
	AgentConversationSession,
	AgentConversationSessionPool,
	AgentSessionCapabilities,
	AgentSessionEvent,
	AgentSessionRuntimeOptions,
	BackendDiagnostic,
} from "./types.js";

class LoggedAgentSession implements AgentConversationSession {
	private readonly listeners = new Set<(event: AgentSessionEvent) => void>();
	private readonly normalizer: AgentEventNormalizer;
	private readonly eventSink;
	private promptStartedAt: number | undefined;
	private hasRecordedTtfs = false;

	constructor(
		private readonly inner: AgentConversationSession,
		private readonly homeDir: string,
		private readonly conversationKey: string,
	) {
		this.normalizer = new AgentEventNormalizer(this);
		this.eventSink = createProfileAgentEventSink({ homeDir: this.homeDir, conversationKey: this.conversationKey });
		this.inner.subscribe((event) => {
			for (const normalized of this.normalizer.normalize(event)) {
				this.recordTtfsIfNeeded(normalized);
				try {
					this.eventSink.emit(normalized);
				} catch (error) {
					if (this.inner.capabilities.supportsStreamingEvents) {
						console.warn(`Failed to append agent event: ${error instanceof Error ? error.message : String(error)}`);
					}
				}
				for (const listener of this.listeners) {
					listener(normalized);
				}
			}
		});
		attachAgentSessionLogging(this, homeDir);
	}

	get isStreaming(): boolean {
		return this.inner.isStreaming;
	}

	get capabilities() {
		return this.inner.capabilities;
	}

	get state() {
		return this.inner.state;
	}

	async prompt(input: AgentRoundInputLike): Promise<void> {
		const text = getAgentRoundInputText(input);
		logAgentPrompt(this.homeDir, text);
		this.promptStartedAt = Date.now();
		this.hasRecordedTtfs = false;
		await this.inner.prompt(input);
	}

	async abort(): Promise<void> {
		await this.inner.abort();
	}

	async steer(text: string): Promise<void> {
		logAgentPrompt(this.homeDir, text);
		await this.inner.steer?.(text);
	}

	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private recordTtfsIfNeeded(event: AgentSessionEvent): void {
		if (this.promptStartedAt === undefined || this.hasRecordedTtfs) {
			return;
		}
		if (!isFirstResponseSignal(event)) {
			return;
		}
		this.hasRecordedTtfs = true;
		appendAgentUsageEvent(this.homeDir, {
			type: "latency",
			ttfsMs: Math.max(0, Date.now() - this.promptStartedAt),
		});
	}
}

function isFirstResponseSignal(event: AgentSessionEvent): boolean {
	if (event.type === "text_delta" || event.type === "thinking_delta") {
		return Boolean(event.delta);
	}
	return event.type === "text_start" || event.type === "thinking_start" || event.type === "tool_call_started";
}

class LoggedAgentSessionPool implements AgentConversationSessionPool {
	readonly capabilities;
	private readonly sessions = new WeakMap<AgentConversationSession, LoggedAgentSession>();

	constructor(
		private readonly inner: AgentConversationSessionPool,
		private readonly homeDir: string,
	) {
		this.capabilities = inner.capabilities;
	}

	async getSession(conversationKey: string): Promise<AgentConversationSession> {
		const session = await this.inner.getSession(conversationKey);
		const existing = this.sessions.get(session);
		if (existing) {
			return existing;
		}
		const logged = new LoggedAgentSession(session, this.homeDir, conversationKey);
		this.sessions.set(session, logged);
		return logged;
	}
}

export { extractAssistantText, extractLastAssistantError, wasLastAssistantMessageAborted };

export function createAgentSessionPool(options: AgentSessionRuntimeOptions): AgentConversationSessionPool {
	const adapter = getAgentBackendDefinition(options.backendKind).adapter;
	return new LoggedAgentSessionPool(adapter.createSessionPool(options), options.homeDir);
}

export function canSteerSession(session: AgentConversationSession): boolean {
	return session.capabilities.supportsSteering && typeof session.steer === "function";
}
