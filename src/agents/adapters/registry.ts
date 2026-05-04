import type { AgentBackendKind } from "../../core/config-store.js";
import { getAgentBackendDefinition, listAgentBackendDefinitions } from "../backend-registry.js";
import type { AgentBackendAdapter } from "../types.js";

export function getAgentBackendAdapter(kind: AgentBackendKind): AgentBackendAdapter {
	return getAgentBackendDefinition(kind).adapter;
}

export function listAgentBackendAdapters(): AgentBackendAdapter[] {
	return listAgentBackendDefinitions().map((definition) => definition.adapter);
}
