import type { AgentBackendKind } from "./config-store.js";

export interface BackendFrameworkDefinition {
	kind: AgentBackendKind;
	label: string;
	injectPieSystemPrompt: boolean;
	startTaskEngine: boolean;
	startTurnGateway: boolean;
}

const PI_FRAMEWORK: BackendFrameworkDefinition = {
	kind: "pi",
	label: "Pi Coding Agent",
	injectPieSystemPrompt: false,
	startTaskEngine: false,
	startTurnGateway: false,
};

const OUSIA_FRAMEWORK: BackendFrameworkDefinition = {
	kind: "ousia",
	label: "Ousia",
	injectPieSystemPrompt: true,
	startTaskEngine: true,
	startTurnGateway: true,
};

export function resolveBackendFramework(kind: AgentBackendKind | undefined): BackendFrameworkDefinition {
	if (kind === "ousia") {
		return OUSIA_FRAMEWORK;
	}
	return PI_FRAMEWORK;
}
