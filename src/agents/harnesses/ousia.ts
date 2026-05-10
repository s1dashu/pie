import type { AgentSession } from "@mariozechner/pi-coding-agent";
import {
	createRuntimeRunGatewayServer,
	createTaskEngineProcessManager,
	ensureDailySessionDistillationTask,
	ensureOusiaAgentHomeLayout,
	getOusiaSystemPromptFile,
	OusiaPiSessionPool,
	type OusiaPromptInputLike,
} from "@pie/ousia";
import type { HarnessLifecycleHooks } from "../../core/agent-harness.js";
import type {
	AgentConversationSession,
	AgentConversationSessionPool,
	AgentHarnessAdapter,
	AgentPromptInputLike,
	AgentSessionCapabilities,
	AgentSessionRuntimeOptions,
} from "../types.js";

const OUSIA_CAPABILITIES: AgentSessionCapabilities = {
	supportsSteering: false,
	supportsInterrupt: true,
	supportsStreamingEvents: true,
	supportsSessionPersistence: true,
	supportsToolEvents: true,
};

function toOusiaPromptInput(input: AgentPromptInputLike): OusiaPromptInputLike {
	return input;
}

function wrapOusiaSession(session: AgentSession, pool: OusiaPiSessionPool, sessionKey: string): AgentConversationSession {
	return {
		get isStreaming() {
			return session.isStreaming;
		},
		capabilities: OUSIA_CAPABILITIES,
		get state() {
			return session.state;
		},
		async prompt(input: AgentPromptInputLike) {
			await pool.prompt(sessionKey, toOusiaPromptInput(input));
		},
		abort() {
			return session.abort();
		},
		subscribe(listener) {
			return (session as any).subscribe(listener);
		},
	};
}

class OusiaAdapterSessionPool implements AgentConversationSessionPool {
	readonly capabilities = OUSIA_CAPABILITIES;
	private readonly pool: OusiaPiSessionPool;
	private readonly wrappedSessions = new WeakMap<AgentSession, AgentConversationSession>();

	constructor(options: AgentSessionRuntimeOptions) {
		this.pool = new OusiaPiSessionPool({
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

	async getSession(sessionKey: string): Promise<AgentConversationSession> {
		const session = await this.pool.getSession(sessionKey);
		const existing = this.wrappedSessions.get(session);
		if (existing) {
			return existing;
		}
		const wrapped = wrapOusiaSession(session, this.pool, sessionKey);
		this.wrappedSessions.set(session, wrapped);
		return wrapped;
	}

	compactSession(sessionKey: string): Promise<{ summary?: string }> {
		return this.pool.compactSession(sessionKey);
	}

	getSessionStatus(sessionKey: string) {
		return this.pool.getSessionStatus(sessionKey);
	}

	resetSession(sessionKey: string): Promise<void> {
		return this.pool.resetSession(sessionKey);
	}
}

export const ousiaAgentHarnessAdapter: AgentHarnessAdapter = {
	kind: "ousia",
	label: "Ousia",
	capabilities: OUSIA_CAPABILITIES,
	createSessionPool(options) {
		return new OusiaAdapterSessionPool(options);
	},
};

export const OUSIA_LIFECYCLE_HOOKS: HarnessLifecycleHooks = {
	systemPrompt: {
		label: "Ousia system prompt",
		defaultPath: getOusiaSystemPromptFile(),
	},
	ensureAgentHomeLayout(homeDir) {
		ensureOusiaAgentHomeLayout(homeDir);
		ensureDailySessionDistillationTask(homeDir);
	},
	createTaskEngineProcessManager(options) {
		return createTaskEngineProcessManager({
			homeDir: options.homeDir,
			workDir: options.environment.workDir,
			channel: options.channel,
			gatewayPort: options.gatewayPort,
			gatewaySecret: options.gatewaySecret,
		});
	},
	createRunGatewayServer(options) {
		return createRuntimeRunGatewayServer({
			homeDir: options.homeDir,
			hostPaths: {
				homeDir: options.environment.homeDir,
				workDir: options.environment.workDir,
			},
			port: options.port,
			secret: options.secret,
			onRun: options.onRun,
			onCreateSession: options.onCreateSession,
			onGetSessionStatus: options.onGetSessionStatus,
			onCompactSession: options.onCompactSession,
			onClearSession: options.onClearSession,
		});
	},
};
