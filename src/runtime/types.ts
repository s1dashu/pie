export type AgentBackendKind = "ousia" | "pi" | "openclaw" | "hermes";

export type PieChannelKind = "feishu" | "wechat" | "slack" | "discord" | "telegram";

export interface AgentRuntimeIdentity {
	backend: AgentBackendKind;
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

export interface AgentTurnInput {
	sessionKey: string;
	prompt: string;
	source?: string;
	kind?: "agent_turn" | "agent_task";
	metadata?: Record<string, unknown>;
}

export interface AgentTurnOutput {
	sessionKey: string;
	assistantText: string;
}

export interface AgentTurnPort {
	deliverTurn(request: AgentTurnInput): Promise<AgentTurnOutput>;
}
