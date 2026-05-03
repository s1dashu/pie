import type { AgentBackendKind } from "../../core/config-store.js";
import type { AgentBackendAdapter } from "../types.js";
import { codexCliAgentBackendAdapter } from "./codex-cli.js";
import { ousiaAgentBackendAdapter, piAgentBackendAdapter } from "./pi.js";

const AGENT_BACKEND_ADAPTERS: Partial<Record<AgentBackendKind, AgentBackendAdapter>> = {
	pi: piAgentBackendAdapter,
	ousia: ousiaAgentBackendAdapter,
	codex: codexCliAgentBackendAdapter,
};

export function getAgentBackendAdapter(kind: AgentBackendKind): AgentBackendAdapter {
	const adapter = AGENT_BACKEND_ADAPTERS[kind];
	if (!adapter) {
		throw new Error(`Agent backend "${kind}" is not supported by this Pie runtime.`);
	}
	return adapter;
}

export function listAgentBackendAdapters(): AgentBackendAdapter[] {
	return Object.values(AGENT_BACKEND_ADAPTERS).filter(Boolean) as AgentBackendAdapter[];
}
