import { getAgentHarnessDefinition } from "./harness-registry.js";
import { appendAgentUsageEvent } from "../core/usage-stats.js";
import { AgentEventNormalizer } from "./event-normalizer.js";
import { createProfileAgentEventSink } from "./event-sink.js";
import { attachAgentSessionLogging, logAgentPrompt } from "./session-logging.js";
import {
	extractAssistantText,
	extractLastAssistantError,
	wasLastAssistantMessageAborted,
} from "./messages.js";
import { getAgentPromptInputText, isFirstResponseSignal } from "./types.js";
import type {
	AgentConversationSession,
	AgentConversationSessionPool,
	AgentPromptInputLike,
	AgentSessionStatus,
	AgentSessionEvent,
	AgentSessionRuntimeOptions,
} from "./types.js";

export type {
	AgentHarnessAdapter,
	AgentConversationSession,
	AgentConversationSessionPool,
	AgentSessionCapabilities,
	AgentSessionEvent,
	AgentSessionStatus,
	AgentSessionRuntimeOptions,
	HarnessDiagnostic,
} from "./types.js";
export { isFirstResponseSignal } from "./types.js";

function normalizeConversationKey(conversationKey: string | undefined): string {
	const key = conversationKey?.trim();
	return key || "conversation";
}

const PI_IDLE_COMPACT_AFTER_MS = 2 * 60 * 60 * 1000;
const SESSION_MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

function readPositiveIntEnv(name: string, fallback: number): number {
	const raw = process.env[name]?.trim();
	if (!raw) {
		return fallback;
	}
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function shouldRunIdleCompact(options: AgentSessionRuntimeOptions): boolean {
	if (options.harnessKind !== "pi" && options.harnessKind !== "ousia") {
		return false;
	}
	if (process.env.PIE_DISABLE_IDLE_COMPACT === "1") {
		return false;
	}
	return true;
}

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
		private readonly recordPromptLifecycle: (runPrompt: () => Promise<void>) => Promise<void>,
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

	async prompt(input: AgentPromptInputLike): Promise<void> {
		const text = getAgentPromptInputText(input);
		logAgentPrompt(this.homeDir, text);
		this.promptStartedAt = Date.now();
		this.hasRecordedTtfs = false;
		await this.recordPromptLifecycle(() => this.inner.prompt(input));
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

class LoggedAgentSessionPool implements AgentConversationSessionPool {
	readonly capabilities;
	private readonly sessions = new WeakMap<AgentConversationSession, LoggedAgentSession>();
	private readonly trackedSessions = new Map<
		string,
		{
			session: AgentConversationSession;
			lastPromptAt?: number;
			lastFinishedAt?: number;
			lastCompactedAt?: number;
			runsSinceCompact: number;
			compacting: boolean;
		}
	>();
	private readonly idleCompactAfterMs: number;
	private readonly maintenanceTimer: ReturnType<typeof setInterval> | undefined;

	constructor(
		private readonly inner: AgentConversationSessionPool,
		private readonly homeDir: string,
		private readonly options: AgentSessionRuntimeOptions,
	) {
		this.capabilities = inner.capabilities;
		this.idleCompactAfterMs = readPositiveIntEnv("PIE_IDLE_COMPACT_AFTER_MS", PI_IDLE_COMPACT_AFTER_MS);
		if (shouldRunIdleCompact(options) && inner.compactSession) {
			const intervalMs = readPositiveIntEnv("PIE_SESSION_MAINTENANCE_INTERVAL_MS", SESSION_MAINTENANCE_INTERVAL_MS);
			this.maintenanceTimer = setInterval(() => {
				void this.runIdleCompactMaintenance();
			}, intervalMs);
			this.maintenanceTimer.unref?.();
		}
	}

	async getSession(conversationKey: string): Promise<AgentConversationSession> {
		const normalizedConversationKey = normalizeConversationKey(conversationKey);
		const session = await this.inner.getSession(normalizedConversationKey);
		const existing = this.sessions.get(session);
		if (existing) {
			return existing;
		}
		const logged = new LoggedAgentSession(session, this.homeDir, normalizedConversationKey, (runPrompt) =>
			this.recordPromptLifecycle(normalizedConversationKey, runPrompt),
		);
		this.sessions.set(session, logged);
		if (!this.trackedSessions.has(normalizedConversationKey)) {
			this.trackedSessions.set(normalizedConversationKey, {
				session: logged,
				runsSinceCompact: 0,
				compacting: false,
			});
		}
		return logged;
	}

	async recordPromptLifecycle(conversationKey: string, runPrompt: () => Promise<void>): Promise<void> {
		const normalizedConversationKey = normalizeConversationKey(conversationKey);
		const entry = this.trackedSessions.get(normalizedConversationKey);
		if (entry) {
			entry.lastPromptAt = Date.now();
		}
		try {
			await runPrompt();
		} finally {
			if (entry) {
				entry.lastFinishedAt = Date.now();
				entry.runsSinceCompact += 1;
			}
		}
	}

	async compactSession(conversationKey: string): Promise<{ summary?: string }> {
		const compactSession = this.inner.compactSession;
		if (!compactSession) {
			throw new Error("This agent harness does not support /compact yet. Use /new to start a fresh session.");
		}
		const normalizedConversationKey = normalizeConversationKey(conversationKey);
		const result = await compactSession.call(this.inner, normalizedConversationKey);
		const entry = this.trackedSessions.get(normalizedConversationKey);
		if (entry) {
			entry.lastCompactedAt = Date.now();
			entry.runsSinceCompact = 0;
		}
		return result;
	}

	async getSessionStatus(conversationKey: string): Promise<AgentSessionStatus> {
		const normalizedConversationKey = normalizeConversationKey(conversationKey);
		const getSessionStatus = this.inner.getSessionStatus;
		if (getSessionStatus) {
			return getSessionStatus.call(this.inner, normalizedConversationKey);
		}
		const session = await this.getSession(normalizedConversationKey);
		return {
			totalMessages: session.state?.messages.length ?? 0,
		};
	}

	async resetSession(conversationKey: string): Promise<void> {
		const resetSession = this.inner.resetSession;
		if (!resetSession) {
			throw new Error("This agent harness does not support /new yet.");
		}
		const normalizedConversationKey = normalizeConversationKey(conversationKey);
		await resetSession.call(this.inner, normalizedConversationKey);
		this.trackedSessions.delete(normalizedConversationKey);
	}

	private async runIdleCompactMaintenance(): Promise<void> {
		const compactSession = this.inner.compactSession;
		if (!compactSession) {
			return;
		}
		const now = Date.now();
		for (const [conversationKey, entry] of this.trackedSessions) {
			if (entry.compacting || entry.session.isStreaming || entry.runsSinceCompact <= 0 || !entry.lastFinishedAt) {
				continue;
			}
			if (now - entry.lastFinishedAt < this.idleCompactAfterMs) {
				continue;
			}
			if (entry.lastCompactedAt && entry.lastCompactedAt >= entry.lastFinishedAt) {
				continue;
			}
			entry.compacting = true;
			try {
				await compactSession.call(this.inner, conversationKey);
				entry.lastCompactedAt = Date.now();
				entry.runsSinceCompact = 0;
				if (this.options.verboseLogs) {
					console.log(`> session_idle_compact ${conversationKey}`);
				}
			} catch (error) {
				if (this.options.verboseLogs) {
					console.warn(`> session_idle_compact_failed ${conversationKey} ${error instanceof Error ? error.message : String(error)}`);
				}
			} finally {
				entry.compacting = false;
			}
		}
	}
}

export { extractAssistantText, extractLastAssistantError, wasLastAssistantMessageAborted };

export function createAgentSessionPool(options: AgentSessionRuntimeOptions): AgentConversationSessionPool {
	const adapter = getAgentHarnessDefinition(options.harnessKind).adapter;
	const pool = new LoggedAgentSessionPool(adapter.createSessionPool(options), options.homeDir, options);
	return pool;
}

export function canSteerSession(session: AgentConversationSession): boolean {
	return session.capabilities.supportsSteering && typeof session.steer === "function";
}
