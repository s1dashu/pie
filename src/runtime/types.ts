export type AgentHarnessKind = "ousia" | "pi" | "codex" | "claude-code" | "openclaw" | "hermes";

export type PieChannelKind = "feishu" | "wechat" | "slack" | "discord" | "telegram" | "dingtalk";

export interface AgentRuntimeIdentity {
	harness: AgentHarnessKind;
	channel: PieChannelKind;
	homeDir: string;
	workDir?: string;
	profileId?: string;
}

export interface ManagedRuntime {
	readonly identity: AgentRuntimeIdentity;
	start(): Promise<number>;
	stop(): Promise<void>;
}

export type AgentInputOrigin =
	| "human"
	| "im"
	| "scheduled_task"
	| "cli"
	| "http"
	| "system"
	| "peer";

export interface AgentRunInput {
	sessionKey: string;
	prompt: string;
	source?: string;
	origin?: AgentInputOrigin;
	kind?: "agent_run" | "agent_task";
	metadata?: Record<string, unknown>;
}

export interface AgentRunOutput {
	sessionKey: string;
	assistantText: string;
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

export interface AgentRunPort {
	deliverRun(request: AgentRunInput): Promise<AgentRunOutput>;
	createSession?(sessionKey: string): Promise<void>;
	getSessionStatus?(sessionKey: string): Promise<AgentSessionStatus>;
	compactSession?(sessionKey: string): Promise<{ summary?: string }>;
	clearSession?(sessionKey: string): Promise<void>;
}
