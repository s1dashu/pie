import { SessionPool as PiSessionPool } from "../../channels/feishu/session.js";
import type {
	AgentBackendAdapter,
	AgentConversationSession,
	AgentConversationSessionPool,
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
	return Object.defineProperty(session, "capabilities", {
		value: PI_CAPABILITIES,
		configurable: true,
		enumerable: false,
	});
}

class PiAdapterSessionPool implements AgentConversationSessionPool {
	readonly capabilities = PI_CAPABILITIES;
	private readonly pool: PiSessionPool;

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
		return session.capabilities ? session : withCapabilities(session);
	}
}

export const piAgentBackendAdapter: AgentBackendAdapter = {
	kind: "pi",
	label: "Pi Coding Agent",
	capabilities: PI_CAPABILITIES,
	createSessionPool(options) {
		return new PiAdapterSessionPool(options);
	},
};

export const ousiaAgentBackendAdapter: AgentBackendAdapter = {
	...piAgentBackendAdapter,
	kind: "ousia",
	label: "Ousia",
};
