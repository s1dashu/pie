import type { AgentHarnessKind } from "./config-store.js";
import { OUSIA_HARNESS } from "../frameworks/ousia/harness.js";
import { HERMES_HARNESS } from "../frameworks/hermes/harness.js";
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

export interface AgentHarnessRuntime {
	kind: AgentHarnessKind;
	label: string;
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

const PI_HARNESS: AgentHarnessRuntime = {
	kind: "pi",
	label: "Pi Coding Agent",
};

const CODEX_HARNESS: AgentHarnessRuntime = {
	kind: "codex",
	label: "Codex",
};

const OPENCLAW_HARNESS: AgentHarnessRuntime = {
	kind: "openclaw",
	label: "OpenClaw",
};

export function resolveAgentHarnessRuntime(kind: AgentHarnessKind | undefined): AgentHarnessRuntime {
	if (kind === "ousia") {
		return OUSIA_HARNESS;
	}
	if (kind === "codex") {
		return CODEX_HARNESS;
	}
	if (kind === "openclaw") {
		return OPENCLAW_HARNESS;
	}
	if (kind === "hermes") {
		return HERMES_HARNESS;
	}
	return PI_HARNESS;
}
