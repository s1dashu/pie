import type { AgentBackendKind } from "./config-store.js";
import { OUSIA_FRAMEWORK } from "../frameworks/ousia/framework.js";
import type { AgentRuntimeEnvironment } from "../runtime/environment.js";
import type { AgentTurnInput, AgentTurnOutput, PieChannelKind } from "../runtime/types.js";

export interface FrameworkTaskEngineProcessManagerOptions {
	homeDir: string;
	environment: AgentRuntimeEnvironment;
	channel: PieChannelKind;
	gatewayPort: number;
	gatewaySecret?: string;
}

export interface FrameworkTaskEngineProcessManager {
	start(): void;
	stop(): void;
}

export interface FrameworkTurnGatewayOptions {
	homeDir: string;
	environment: AgentRuntimeEnvironment;
	port: number;
	secret?: string;
	onTurn: (request: AgentTurnInput) => Promise<AgentTurnOutput>;
}

export interface FrameworkTurnGatewayServer {
	start(): Promise<void>;
	stop(): Promise<void>;
}

export interface BackendFrameworkDefinition {
	kind: AgentBackendKind;
	label: string;
	systemPrompt?: {
		label: string;
		defaultPath: string;
	};
	ensureAgentHomeLayout?: (homeDir: string) => void;
	createTaskEngineProcessManager?: (
		options: FrameworkTaskEngineProcessManagerOptions,
	) => FrameworkTaskEngineProcessManager;
	createTurnGatewayServer?: (options: FrameworkTurnGatewayOptions) => FrameworkTurnGatewayServer;
}

const PI_FRAMEWORK: BackendFrameworkDefinition = {
	kind: "pi",
	label: "Pi Coding Agent",
};

const CODEX_FRAMEWORK: BackendFrameworkDefinition = {
	kind: "codex",
	label: "Codex",
};

export function resolveBackendFramework(kind: AgentBackendKind | undefined): BackendFrameworkDefinition {
	if (kind === "ousia") {
		return OUSIA_FRAMEWORK;
	}
	if (kind === "codex") {
		return CODEX_FRAMEWORK;
	}
	return PI_FRAMEWORK;
}
