import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { ImageContent, Model } from "@mariozechner/pi-ai";

export interface OusiaPromptInput {
	text: string;
	images?: ImageContent[];
}

export type OusiaPromptInputLike = string | OusiaPromptInput;

export interface OusiaSessionRuntimeOptions {
	homeDir: string;
	model?: Model<any>;
	assistantSystemPrompt?: string;
	thinkingLevel: ThinkingLevel;
	tools: string[];
	debug: boolean;
	verboseLogs: boolean;
	resumeSessions: boolean;
}

export interface OusiaSessionContextUsage {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}

export interface OusiaSessionStatus {
	totalMessages: number;
	contextUsage?: OusiaSessionContextUsage;
}

export function normalizeOusiaPromptInput(input: OusiaPromptInputLike): OusiaPromptInput {
	return typeof input === "string" ? { text: input } : input;
}
