import type { AgentHarnessKind } from "../../core/config-store.js";
import { getAgentHarnessDefinition, listAgentHarnessDefinitions } from "../harness-registry.js";
import type { AgentHarnessAdapter } from "../types.js";

export function getAgentHarnessAdapter(kind: AgentHarnessKind): AgentHarnessAdapter {
	return getAgentHarnessDefinition(kind).adapter;
}

export function listAgentHarnessAdapters(): AgentHarnessAdapter[] {
	return listAgentHarnessDefinitions().map((definition) => definition.adapter);
}
