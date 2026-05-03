import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { AgentBackendKind } from "../core/config-store.js";

export type AgentSessionEvent = Parameters<AgentSession["subscribe"]>[0] extends (event: infer TEvent) => void
	? TEvent
	: never;

export interface AgentSessionCapabilities {
	supportsSteering: boolean;
	supportsInterrupt: boolean;
	supportsStreamingEvents: boolean;
	supportsSessionPersistence: boolean;
	supportsToolEvents: boolean;
}

export interface AgentConversationSession {
	readonly isStreaming: boolean;
	readonly capabilities: AgentSessionCapabilities;
	readonly state?: { messages: unknown[] };
	prompt(text: string): Promise<void>;
	abort(): Promise<void>;
	steer?(text: string): Promise<void>;
	subscribe(listener: (event: AgentSessionEvent) => void): () => void;
}

export interface AgentConversationSessionPool {
	readonly capabilities: AgentSessionCapabilities;
	getSession(conversationKey: string): Promise<AgentConversationSession>;
}

export interface AgentSessionRuntimeOptions {
	backendKind: AgentBackendKind;
	backendConfig?: Record<string, unknown>;
	homeDir: string;
	model?: Model<any>;
	modelId?: string;
	assistantSystemPrompt?: string;
	thinkingLevel: ThinkingLevel;
	tools: string[];
	debug: boolean;
	verboseLogs: boolean;
	resumeSessions: boolean;
}

export interface BackendDiagnostic {
	installed: boolean;
	authenticated: boolean;
	executablePath?: string;
	version?: string;
	authMethod?: "cli" | "env" | "unknown";
	error?: string;
	loginCommand?: string[];
}

export interface AgentBackendAdapter {
	readonly kind: AgentBackendKind;
	readonly label: string;
	readonly capabilities: AgentSessionCapabilities;
	checkEnvironment?(options: AgentSessionRuntimeOptions): Promise<BackendDiagnostic>;
	createSessionPool(options: AgentSessionRuntimeOptions): AgentConversationSessionPool;
	explainError?(error: unknown): string;
}

export const NO_STEER_SESSION_CAPABILITIES: AgentSessionCapabilities = {
	supportsSteering: false,
	supportsInterrupt: true,
	supportsStreamingEvents: true,
	supportsSessionPersistence: true,
	supportsToolEvents: true,
};
