import chalk from "chalk";
import { appendAgentUsageEvent, estimateTokensFromText } from "../core/usage-stats.js";
import { extractAssistantText, extractLastAssistantUsage } from "./messages.js";
import type { AgentConversationSession, AgentSessionEvent } from "./types.js";

const loggedSessions = new WeakSet<object>();

function truncate(text: string, max = 160): string {
	return text.length > max ? `${text.slice(0, max)}...` : text;
}

function formatDebugValue(value: unknown): string {
	if (typeof value === "string") {
		return truncate(value, 500);
	}
	try {
		return truncate(JSON.stringify(value ?? {}), 500);
	} catch {
		return truncate(String(value), 500);
	}
}

function formatToolStartLine(toolName: string, args: unknown): string {
	const path = args && typeof args === "object" ? (args as Record<string, unknown>).path : undefined;
	const command = args && typeof args === "object" ? (args as Record<string, unknown>).command : undefined;
	const target =
		typeof path === "string" ? ` path=${path}` : typeof command === "string" ? ` command=${truncate(command, 120)}` : "";
	return `Tool started: ${toolName}${target}`;
}

function formatToolEndLine(toolName: string, isError: boolean, result: unknown): string {
	if (!isError) {
		return `Tool finished: ${toolName}`;
	}
	return `Tool failed: ${toolName} ${formatDebugValue(result)}`;
}

export function logAgentPrompt(homeDir: string, text: string): void {
	const prompt = text.trim();
	if (!prompt) {
		return;
	}
	appendAgentUsageEvent(homeDir, {
		type: "message",
		direction: "incoming",
		textChars: Array.from(prompt).length,
		estimatedTokens: estimateTokensFromText(prompt),
	});
	console.log(`${chalk.cyan("User:")} ${truncate(prompt)}`);
}

export function attachAgentSessionLogging(session: AgentConversationSession, homeDir: string): void {
	if (typeof session !== "object" || loggedSessions.has(session)) {
		return;
	}
	loggedSessions.add(session);

	let activeStream: "assistant" | "thinking" | null = null;
	let sawAssistantTextDelta = false;
	let assistantStreamText = "";

	function flushStream(): void {
		activeStream = null;
	}

	function logStreamDelta(stream: "assistant" | "thinking", label: string, text: string, color: typeof chalk.green): void {
		if (activeStream !== stream) {
			flushStream();
			activeStream = stream;
		}
		for (const line of text.split(/\r?\n/)) {
			if (line) {
				console.log(`${color(label)} ${color(line)}`);
			}
		}
	}

	function formatDuration(ms: number): string {
		if (ms < 1000) {
			return `${ms}ms`;
		}
		return `${(ms / 1000).toFixed(1)}s`;
	}

	session.subscribe((event: AgentSessionEvent) => {
		switch (event.type) {
			case "compaction_start": {
				const compactionEvent = event as { reason?: string };
				flushStream();
				console.log(chalk.yellow(`> context_compaction start reason=${compactionEvent.reason ?? "unknown"}`));
				break;
			}
			case "compaction_end": {
				const compactionEvent = event as { reason?: string; aborted?: boolean; willRetry?: boolean; errorMessage?: string };
				flushStream();
				console.log(
					chalk.yellow(
						`> context_compaction end reason=${compactionEvent.reason ?? "unknown"} aborted=${compactionEvent.aborted ? "yes" : "no"} retry=${compactionEvent.willRetry ? "yes" : "no"}${compactionEvent.errorMessage ? ` error=${truncate(compactionEvent.errorMessage)}` : ""}`,
					),
				);
				break;
			}
			case "auto_retry_start": {
				const retryEvent = event as { attempt?: number; maxAttempts?: number; delayMs?: number; errorMessage?: string };
				flushStream();
				console.log(
					chalk.yellow(
						`> provider_retry start attempt=${retryEvent.attempt ?? "?"}/${retryEvent.maxAttempts ?? "?"} delay=${formatDuration(retryEvent.delayMs ?? 0)} error=${truncate(retryEvent.errorMessage ?? "")}`,
					),
				);
				break;
			}
			case "auto_retry_end": {
				const retryEvent = event as { success?: boolean; attempt?: number; finalError?: string };
				flushStream();
				console.log(
					chalk.yellow(
						`> provider_retry end success=${retryEvent.success ? "yes" : "no"} attempt=${retryEvent.attempt ?? "?"}${retryEvent.finalError ? ` error=${truncate(retryEvent.finalError)}` : ""}`,
					),
				);
				break;
			}
			case "turn_started": {
				sawAssistantTextDelta = false;
				assistantStreamText = "";
				break;
			}
			case "turn_finished": {
				appendAgentUsageEvent(homeDir, {
					type: "turn",
				});
				break;
			}
			case "thinking_delta": {
				if (event.delta) {
					logStreamDelta("thinking", "> Thinking", event.delta, chalk.gray);
				}
				break;
			}
			case "text_delta": {
				if (event.delta) {
					sawAssistantTextDelta = true;
					assistantStreamText += event.delta;
					logStreamDelta("assistant", "Agent:", event.delta, chalk.green);
				}
				break;
			}
			case "text_finished": {
				const finalText = event.text ?? "";
				if (finalText && finalText !== assistantStreamText) {
					const missingText = finalText.startsWith(assistantStreamText) ? finalText.slice(assistantStreamText.length) : finalText;
					if (missingText) {
						sawAssistantTextDelta = true;
						logStreamDelta("assistant", "Agent:", missingText, chalk.green);
					}
				}
				assistantStreamText = finalText || assistantStreamText;
				break;
			}
			case "round_finished": {
				flushStream();
				const finalText = event.finalText ?? extractAssistantText(session);
				const usage = normalizeUsagePayload(event.usage ?? extractLastAssistantUsage(session));
				appendAgentUsageEvent(homeDir, {
					type: "message",
					direction: "outgoing",
					textChars: Array.from(finalText).length,
					...(usage ?? { estimatedTokens: estimateTokensFromText(finalText) }),
				});
				if (finalText && !sawAssistantTextDelta) {
					console.log(`${chalk.green("Agent:")} ${truncate(finalText)}`);
				}
				break;
			}
			case "token_usage": {
				const usage = normalizeUsagePayload(event.usage);
				if (usage) {
					appendAgentUsageEvent(homeDir, {
						type: "token_usage",
						...usage,
					});
				}
				break;
			}
			case "tool_call_started": {
				flushStream();
				console.log(chalk.gray(formatToolStartLine(event.name, event.args)));
				break;
			}
			case "tool_call_finished": {
				flushStream();
				appendAgentUsageEvent(homeDir, {
					type: "action",
					actionName: event.name,
					status: event.isError ? "error" : "success",
				});
				const line = formatToolEndLine(event.name, event.isError, event.result);
				console.log(event.isError ? chalk.red(line) : chalk.blue(line));
				break;
			}
		}
	});
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}
	}
	return undefined;
}

function readNestedNumber(record: Record<string, unknown>, objectKeys: string[], numberKeys: string[]): number | undefined {
	for (const objectKey of objectKeys) {
		const nested = record[objectKey];
		if (nested && typeof nested === "object") {
			const value = readNumber(nested as Record<string, unknown>, numberKeys);
			if (value !== undefined) {
				return value;
			}
		}
	}
	return undefined;
}

function normalizeUsagePayload(usage: unknown): {
	actualTokens: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
} | undefined {
	if (!usage || typeof usage !== "object") {
		return undefined;
	}
	const record = usage as Record<string, unknown>;
	const rawInputTokens = readNumber(record, ["inputTokens", "input_tokens", "promptTokens", "prompt_tokens", "input", "prompt"]) ?? 0;
	const outputTokens = readNumber(record, ["outputTokens", "output_tokens", "completionTokens", "completion_tokens", "output", "completion"]) ?? 0;
	const topLevelCacheReadTokens = readNumber(record, ["cacheReadTokens", "cache_read_tokens", "cacheReadInputTokens", "cache_read_input_tokens", "cacheRead", "cache_read"]);
	const topLevelCachedInputTokens = readNumber(record, ["cachedInputTokens", "cached_input_tokens"]);
	const nestedCacheReadTokens = readNestedNumber(record, ["input_tokens_details", "prompt_tokens_details", "inputTokenDetails", "promptTokenDetails"], ["cached_tokens", "cachedTokens", "cache_read_tokens", "cacheReadTokens"]);
	const cacheReadTokens = topLevelCacheReadTokens ?? topLevelCachedInputTokens ?? nestedCacheReadTokens ?? 0;
	const topLevelCacheWriteTokens = readNumber(record, ["cacheWriteTokens", "cache_write_tokens", "cacheCreationInputTokens", "cache_creation_input_tokens", "cacheWrite", "cache_write"]);
	const nestedCacheWriteTokens = readNestedNumber(record, ["input_tokens_details", "prompt_tokens_details", "inputTokenDetails", "promptTokenDetails"], ["cache_write_tokens", "cacheWriteTokens", "cache_creation_input_tokens", "cacheCreationInputTokens"]);
	const cacheWriteTokens = topLevelCacheWriteTokens ?? nestedCacheWriteTokens ?? 0;
	const totalTokens = readNumber(record, ["actualTokens", "actual_tokens", "totalTokens", "total_tokens"]);
	const inputTokens = topLevelCachedInputTokens !== undefined || nestedCacheReadTokens !== undefined || nestedCacheWriteTokens !== undefined
		? Math.max(0, rawInputTokens - cacheReadTokens - cacheWriteTokens)
		: rawInputTokens;
	const actualTokens = totalTokens ?? (inputTokens + outputTokens || cacheReadTokens + cacheWriteTokens);
	if (actualTokens <= 0 && inputTokens <= 0 && outputTokens <= 0 && cacheReadTokens <= 0 && cacheWriteTokens <= 0) {
		return undefined;
	}
	return {
		actualTokens,
		inputTokens,
		outputTokens,
		cacheReadTokens,
		cacheWriteTokens,
	};
}
