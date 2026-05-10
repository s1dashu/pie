export type OusiaRunOrigin =
	| "human"
	| "im"
	| "scheduled_task"
	| "cli"
	| "http"
	| "system"
	| "peer";

export interface OusiaRunRequest {
	sessionKey: string;
	prompt: string;
	source?: string;
	origin?: OusiaRunOrigin;
	kind?: "agent_run" | "agent_task";
	metadata?: Record<string, unknown>;
}

export interface OusiaRunResult {
	sessionKey: string;
	assistantText: string;
}

export interface OusiaHostPaths {
	homeDir: string;
	workDir?: string;
}
