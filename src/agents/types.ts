import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { ImageContent, Model } from "@mariozechner/pi-ai";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { AgentHarnessKind } from "../core/config-store.js";

export type PiAgentSessionEvent = Parameters<AgentSession["subscribe"]>[0] extends (event: infer TEvent) => void
	? TEvent
	: never;

export type AgentRunStatus = "success" | "error" | "aborted";

export type AgentSessionEvent =
	| {
			type: "user_message";
			runId?: string;
			messageId?: string;
			text: string;
			status?: "pending" | "sent" | "failed";
			errorText?: string;
			source?: string;
	  }
	| {
			type: "agent_run_started";
			runId: string;
	  }
	  | {
			type: "agent_run_finished";
			runId: string;
			status: AgentRunStatus;
			finalText?: string;
			usage?: unknown;
	  }
	| {
			type: "token_usage";
			runId?: string;
			turnId?: string;
			usage: unknown;
	  }
	| {
			type: "turn_started";
			runId: string;
			turnId: string;
			index?: number;
	  }
	| {
			type: "turn_finished";
			runId: string;
			turnId: string;
			status: AgentRunStatus;
	  }
	| {
			type: "text_start";
			runId: string;
			turnId: string;
			textId: string;
	  }
	| {
			type: "text_delta";
			runId: string;
			turnId: string;
			textId: string;
			delta: string;
	  }
	| {
			type: "text_finished";
			runId: string;
			turnId: string;
			textId: string;
			text: string;
	  }
	| {
			type: "thinking_start";
			runId: string;
			turnId: string;
			thinkingId: string;
	  }
	| {
			type: "thinking_delta";
			runId: string;
			turnId: string;
			thinkingId: string;
			delta: string;
	  }
	| {
			type: "thinking_finished";
			runId: string;
			turnId: string;
			thinkingId: string;
			thinking: string;
	  }
	| {
			type: "tool_call_started";
			runId: string;
			turnId: string;
			toolCallId: string;
			name: string;
			args?: unknown;
	  }
	| {
			type: "tool_call_updated";
			runId: string;
			turnId: string;
			toolCallId: string;
			name: string;
			args?: unknown;
			partialResult?: unknown;
	  }
	| {
			type: "tool_call_finished";
			runId: string;
			turnId: string;
			toolCallId: string;
			name: string;
			result?: unknown;
			isError: boolean;
	  }
	| {
			type: "compaction_start";
			reason?: string;
	  }
	| {
			type: "compaction_end";
			reason?: string;
			aborted?: boolean;
			willRetry?: boolean;
			errorMessage?: string;
	  }
	| {
			type: "auto_retry_start";
			attempt?: number;
			maxAttempts?: number;
			delayMs?: number;
			errorMessage?: string;
	  }
	| {
			type: "auto_retry_end";
			success?: boolean;
			attempt?: number;
			finalError?: string;
	  };

export interface AgentSessionCapabilities {
	supportsSteering: boolean;
	supportsInterrupt: boolean;
	supportsStreamingEvents: boolean;
	supportsSessionPersistence: boolean;
	supportsToolEvents: boolean;
}

export function isFirstResponseSignal(event: AgentSessionEvent): boolean {
	if (event.type === "text_delta" || event.type === "thinking_delta") {
		return Boolean(event.delta);
	}
	if (event.type === "tool_call_started") {
		return true;
	}
	if (event.type === "tool_call_updated") {
		return event.partialResult !== undefined;
	}
	return false;
}

export interface AgentPromptInput {
	text: string;
	images?: ImageContent[];
}

export type AgentPromptInputLike = string | AgentPromptInput;

export function getAgentPromptInputText(input: AgentPromptInputLike): string {
	return typeof input === "string" ? input : input.text;
}

export function normalizeAgentPromptInput(input: AgentPromptInputLike): AgentPromptInput {
	return typeof input === "string" ? { text: input } : input;
}

export interface AgentConversationSession {
	readonly isStreaming: boolean;
	readonly capabilities: AgentSessionCapabilities;
	readonly state?: { messages: unknown[] };
	prompt(input: AgentPromptInputLike): Promise<void>;
	abort(): Promise<void>;
	steer?(text: string): Promise<void>;
	subscribe(listener: (event: AgentSessionEvent) => void): () => void;
}

export interface AgentSessionContextUsage {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}

export interface AgentSessionStatus {
	totalMessages: number;
	contextUsage?: AgentSessionContextUsage;
}

export interface AgentConversationSessionPool {
	readonly capabilities: AgentSessionCapabilities;
	getSession(conversationKey: string): Promise<AgentConversationSession>;
	getSessionStatus?(conversationKey: string): Promise<AgentSessionStatus>;
	compactSession?(conversationKey: string): Promise<{ summary?: string }>;
	resetSession?(conversationKey: string): Promise<void>;
}

export interface AgentSessionRuntimeOptions {
	harnessKind: AgentHarnessKind;
	harnessConfig?: Record<string, unknown>;
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

export interface HarnessDiagnostic {
	installed: boolean;
	authenticated: boolean;
	executablePath?: string;
	version?: string;
	authMethod?: "cli" | "env" | "unknown";
	error?: string;
	loginCommand?: string[];
}

export interface AgentHarnessAdapter {
	readonly kind: AgentHarnessKind;
	readonly label: string;
	readonly capabilities: AgentSessionCapabilities;
	checkEnvironment?(options: AgentSessionRuntimeOptions): Promise<HarnessDiagnostic>;
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
