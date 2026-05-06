import type { AgentRuntimeEnvironment } from "../runtime/environment.js";
import type { AgentTurnInput, AgentTurnOutput, PieChannelKind } from "../runtime/types.js";

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

export interface HarnessTurnGatewayOptions {
	homeDir: string;
	environment: AgentRuntimeEnvironment;
	port: number;
	secret?: string;
	onTurn: (request: AgentTurnInput) => Promise<AgentTurnOutput>;
}

export interface HarnessTurnGatewayServer {
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
	createTurnGatewayServer?: (options: HarnessTurnGatewayOptions) => HarnessTurnGatewayServer;
}
