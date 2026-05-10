import type { AgentRuntimeEnvironment } from "../runtime/environment.js";
import type { AgentRunInput, AgentRunOutput, AgentSessionStatus, PieChannelKind } from "../runtime/types.js";

export interface HarnessTaskEngineProcessManagerOptions {
	homeDir: string;
	environment: AgentRuntimeEnvironment;
	channel: PieChannelKind;
	gatewayPort: number;
	gatewaySecret?: string;
}

export interface HarnessTaskEngineProcessManager {
	start(): void | Promise<void>;
	stop(): void;
}

export interface HarnessRunGatewayOptions {
	homeDir: string;
	environment: AgentRuntimeEnvironment;
	port: number;
	secret?: string;
	onRun: (request: AgentRunInput) => Promise<AgentRunOutput>;
	onCreateSession?: (sessionKey: string) => Promise<void>;
	onGetSessionStatus?: (sessionKey: string) => Promise<AgentSessionStatus>;
	onCompactSession?: (sessionKey: string) => Promise<{ summary?: string }>;
	onClearSession?: (sessionKey: string) => Promise<void>;
}

export interface HarnessRunGatewayServer {
	start(): Promise<void>;
	stop(): Promise<void>;
}

export interface HarnessLifecycleHooks {
	systemPrompt?: {
		label: string;
		defaultPath: string;
	};
	ensureAgentHomeLayout?: (homeDir: string) => void;
	createTaskEngineProcessManager?: (
		options: HarnessTaskEngineProcessManagerOptions,
	) => HarnessTaskEngineProcessManager;
	createRunGatewayServer?: (options: HarnessRunGatewayOptions) => HarnessRunGatewayServer;
}
