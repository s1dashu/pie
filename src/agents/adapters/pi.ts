import { SessionPool as PiSessionPool } from "./pi/session.js";
import { forwardPiPrompt } from "./pi/prompt-input.js";
import type {
	AgentHarnessAdapter,
	AgentConversationSession,
	AgentConversationSessionPool,
	AgentPromptInputLike,
	AgentSessionCapabilities,
	AgentSessionRuntimeOptions,
} from "../types.js";

const PI_CAPABILITIES: AgentSessionCapabilities = {
	supportsSteering: false,
	supportsInterrupt: true,
	supportsStreamingEvents: true,
	supportsSessionPersistence: true,
	supportsToolEvents: true,
};

function withCapabilities(session: AgentConversationSession): AgentConversationSession {
	return {
		get isStreaming() {
			return session.isStreaming;
		},
		capabilities: PI_CAPABILITIES,
		get state() {
			return session.state;
		},
		prompt(input: AgentPromptInputLike) {
			return forwardPiPrompt(session, input);
		},
		abort() {
			return session.abort();
		},
		...(session.steer ? { steer: (text: string) => session.steer?.(text) ?? Promise.resolve() } : {}),
		subscribe(listener) {
			return session.subscribe(listener);
		},
	};
}

class PiAdapterSessionPool implements AgentConversationSessionPool {
	readonly capabilities = PI_CAPABILITIES;
	private readonly pool: PiSessionPool;
	private readonly wrappedSessions = new WeakMap<AgentConversationSession, AgentConversationSession>();

	constructor(options: AgentSessionRuntimeOptions) {
		this.pool = new PiSessionPool({
			homeDir: options.homeDir,
			model: options.model,
			assistantSystemPrompt: options.assistantSystemPrompt,
			thinkingLevel: options.thinkingLevel,
			tools: options.tools,
			debug: options.debug,
			verboseLogs: options.verboseLogs,
			resumeSessions: options.resumeSessions,
		});
	}

	async getSession(conversationKey: string): Promise<AgentConversationSession> {
		const session = (await this.pool.getSession(conversationKey)) as unknown as AgentConversationSession;
		const existing = this.wrappedSessions.get(session);
		if (existing) {
			return existing;
		}
		const wrapped = withCapabilities(session);
		this.wrappedSessions.set(session, wrapped);
		return wrapped;
	}

	compactSession(conversationKey: string): Promise<{ summary?: string }> {
		return this.pool.compactSession(conversationKey);
	}

	getSessionStatus(conversationKey: string) {
		return this.pool.getSessionStatus(conversationKey);
	}

	resetSession(conversationKey: string): Promise<void> {
		return this.pool.resetSession(conversationKey);
	}
}

export const piAgentHarnessAdapter: AgentHarnessAdapter = {
	kind: "pi",
	label: "Pi Coding Agent",
	capabilities: PI_CAPABILITIES,
	createSessionPool(options) {
		return new PiAdapterSessionPool(options);
	},
};
