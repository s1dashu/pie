import { getAgentBackendAdapter } from "./adapters/registry.js";
import {
	extractAssistantText,
	extractLastAssistantError,
	wasLastAssistantMessageAborted,
} from "./messages.js";
import type {
	AgentConversationSession,
	AgentConversationSessionPool,
	AgentSessionEvent,
	AgentSessionRuntimeOptions,
} from "./types.js";

export type {
	AgentBackendAdapter,
	AgentConversationSession,
	AgentConversationSessionPool,
	AgentSessionCapabilities,
	AgentSessionEvent,
	AgentSessionRuntimeOptions,
	BackendDiagnostic,
} from "./types.js";

export { extractAssistantText, extractLastAssistantError, wasLastAssistantMessageAborted };

export function createAgentSessionPool(options: AgentSessionRuntimeOptions): AgentConversationSessionPool {
	const adapter = getAgentBackendAdapter(options.backendKind);
	return adapter.createSessionPool(options);
}

export function canSteerSession(session: AgentConversationSession): boolean {
	return session.capabilities.supportsSteering && typeof session.steer === "function";
}
