import type { AgentBackendKind } from "./config-store.js";

export interface BackendFrameworkDefinition {
	kind: AgentBackendKind;
	label: string;
	injectOusiaSystemPrompt: boolean;
	startTaskEngine: boolean;
	startTurnGateway: boolean;
}

const PI_FRAMEWORK: BackendFrameworkDefinition = {
	kind: "pi",
	label: "Pi Coding Agent",
	injectOusiaSystemPrompt: false,
	startTaskEngine: false,
	startTurnGateway: false,
};

const OUSIA_FRAMEWORK: BackendFrameworkDefinition = {
	kind: "ousia",
	label: "Ousia",
	injectOusiaSystemPrompt: true,
	startTaskEngine: true,
	startTurnGateway: true,
};

export function resolveBackendFramework(kind: AgentBackendKind | undefined): BackendFrameworkDefinition {
	if (kind === "ousia") {
		return OUSIA_FRAMEWORK;
	}
	return PI_FRAMEWORK;
}
