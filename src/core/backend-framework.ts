import type { AgentBackendKind } from "./config-store.js";
import { OUSIA_FRAMEWORK } from "../frameworks/ousia/framework.js";
import { HERMES_FRAMEWORK } from "../frameworks/hermes/framework.js";
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
	start(): void | Promise<void>;
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

export interface AgentFrameworkRuntime {
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

const PI_FRAMEWORK: AgentFrameworkRuntime = {
	kind: "pi",
	label: "Pi Coding Agent",
};

const CODEX_FRAMEWORK: AgentFrameworkRuntime = {
	kind: "codex",
	label: "Codex",
};

export function resolveAgentFrameworkRuntime(kind: AgentBackendKind | undefined): AgentFrameworkRuntime {
	if (kind === "ousia") {
		return OUSIA_FRAMEWORK;
	}
	if (kind === "codex") {
		return CODEX_FRAMEWORK;
	}
	if (kind === "hermes") {
		return HERMES_FRAMEWORK;
	}
	return PI_FRAMEWORK;
}
