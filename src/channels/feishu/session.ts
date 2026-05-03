import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	ModelRegistry,
	SessionManager,
} from "@mariozechner/pi-coding-agent";
import chalk from "chalk";
import { appendAgentUsageEvent, estimateTokensFromText } from "../../core/usage-stats.js";
import { sanitizePathSegment } from "./messages.js";

function getLegacySessionHistoryDir(conversationDir: string, cwd: string): string {
	const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return join(conversationDir, "sessions", safePath);
}

function getLatestSessionFile(sessionDir: string): string | undefined {
	if (!existsSync(sessionDir)) {
		return undefined;
	}

	const files = readdirSync(sessionDir)
		.filter((name) => name.endsWith(".jsonl"))
		.sort((left, right) => left.localeCompare(right));
	const latest = files.at(-1);
	return latest ? join(sessionDir, latest) : undefined;
}

export interface SessionPoolOptions {
	homeDir: string;
	model?: Model<any>;
	assistantSystemPrompt?: string;
	thinkingLevel: ThinkingLevel;
	tools: string[];
	debug: boolean;
	verboseLogs: boolean;
	resumeSessions: boolean;
}

function overrideBaseSystemPrompt(
	basePrompt: string | undefined,
	assistantSystemPrompt: string | undefined,
	configuredModel: Model<any> | undefined,
): string | undefined {
	if (!assistantSystemPrompt) {
		return basePrompt;
	}
	const head = assistantSystemPrompt.trim();
	const backend =
		configuredModel != null
			? `\n\n## Session backend\nRequests use provider \`${String(configuredModel.provider)}\` and model id \`${configuredModel.id}\` (OpenAI-compatible transport only describes the HTTP API; the underlying engine may differ). Do not insist you are a particular vendor-branded chatbot unless the user asks or the model id clearly names that vendor.`
			: "";
	if (!basePrompt) {
		return `${head}${backend}`;
	}
	const toolsSection = "\n\nAvailable tools:\n";
	const toolsIndex = basePrompt.indexOf(toolsSection);
	if (toolsIndex === -1) {
		return `${head}${backend}`;
	}
	return `${head}${backend}${basePrompt.slice(toolsIndex)}`;
}

function formatUserText(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.flatMap((part) => {
			if (!part || typeof part !== "object") {
				return [];
			}
			const typedPart = part as { type?: unknown; text?: unknown };
			return typedPart.type === "text" && typeof typedPart.text === "string" ? [typedPart.text] : [];
		})
		.join("");
}

function truncate(text: string, max = 160): string {
	return text.length > max ? `${text.slice(0, max)}...` : text;
}

const TOOL_DEBUG_MAX_CHARS = 500;
const TASK_PREFIX = "Task:";

function formatDebugValue(value: unknown): string {
	if (typeof value === "string") {
		return truncate(value, TOOL_DEBUG_MAX_CHARS);
	}
	try {
		return truncate(JSON.stringify(value ?? {}), TOOL_DEBUG_MAX_CHARS);
	} catch {
		return truncate(String(value), TOOL_DEBUG_MAX_CHARS);
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

function extractTaskText(content: unknown): string | undefined {
	const text = formatUserText(content).trim();
	if (text.startsWith(TASK_PREFIX)) {
		return text.slice(TASK_PREFIX.length).trim();
	}
	return undefined;
}

function readNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function extractModelUsage(message: unknown): {
	actualTokens: number;
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
} | undefined {
	if (!message || typeof message !== "object") {
		return undefined;
	}
	const usage = (message as { usage?: unknown }).usage;
	if (!usage || typeof usage !== "object") {
		return undefined;
	}
	const typedUsage = usage as Record<string, unknown>;
	const inputTokens = readNumber(typedUsage.input);
	const outputTokens = readNumber(typedUsage.output);
	const cacheReadTokens = readNumber(typedUsage.cacheRead);
	const cacheWriteTokens = readNumber(typedUsage.cacheWrite);
	const totalTokens = readNumber(typedUsage.totalTokens);
	const calculatedTokens = (inputTokens ?? 0) + (outputTokens ?? 0) + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0);
	const actualTokens = totalTokens ?? calculatedTokens;
	if (!Number.isFinite(actualTokens) || actualTokens <= 0) {
		return undefined;
	}
	return {
		actualTokens,
		...(inputTokens !== undefined ? { inputTokens } : {}),
		...(outputTokens !== undefined ? { outputTokens } : {}),
		...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
		...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
	};
}

function attachSessionLogging(session: AgentSession, homeDir: string): void {
	let activeStream: "assistant" | "thinking" | null = null;
	let sawAssistantTextDelta = false;

	function formatDuration(ms: number): string {
		if (ms < 1000) {
			return `${ms}ms`;
		}
		return `${(ms / 1000).toFixed(1)}s`;
	}

	function getObjectNumber(value: unknown, key: string): number | undefined {
		if (!value || typeof value !== "object") {
			return undefined;
		}
		const maybeValue = (value as Record<string, unknown>)[key];
		return typeof maybeValue === "number" && Number.isFinite(maybeValue) ? maybeValue : undefined;
	}

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

	session.subscribe((event) => {
		switch (event.type) {
			case "compaction_start":
				flushStream();
				console.log(chalk.yellow(`> context_compaction start reason=${event.reason}`));
				break;
			case "compaction_end":
				flushStream();
				console.log(
					chalk.yellow(
						`> context_compaction end reason=${event.reason} aborted=${event.aborted ? "yes" : "no"} retry=${event.willRetry ? "yes" : "no"}${event.errorMessage ? ` error=${truncate(event.errorMessage)}` : ""}`,
					),
				);
				break;
			case "auto_retry_start":
				flushStream();
				console.log(
					chalk.yellow(
						`> provider_retry start attempt=${event.attempt}/${event.maxAttempts} delay=${formatDuration(event.delayMs)} error=${truncate(event.errorMessage)}`,
					),
				);
				break;
			case "auto_retry_end":
				flushStream();
				console.log(
					chalk.yellow(
						`> provider_retry end success=${event.success ? "yes" : "no"} attempt=${event.attempt}${event.finalError ? ` error=${truncate(event.finalError)}` : ""}`,
					),
				);
				break;
			case "message_start": {
				const message = event.message as { role?: string; content?: unknown };
				if (message.role === "user") {
					flushStream();
					const taskText = extractTaskText(message.content);
					const label = taskText != null ? chalk.magenta("Task:") : chalk.cyan("User:");
					const text = taskText ?? formatUserText(message.content);
					appendAgentUsageEvent(homeDir, {
						type: "message",
						direction: "incoming",
						textChars: Array.from(text).length,
						estimatedTokens: estimateTokensFromText(text),
					});
					console.log(`${label} ${truncate(text)}`);
				} else if (message.role === "assistant") {
					sawAssistantTextDelta = false;
				}
				break;
			}
			case "message_update": {
				const assistantEvent = event.assistantMessageEvent as { type?: string; delta?: string } | undefined;
				if (assistantEvent?.type === "thinking_delta" && assistantEvent.delta) {
					logStreamDelta("thinking", "> Thinking", assistantEvent.delta, chalk.gray);
				}
				if (assistantEvent?.type === "text_delta" && assistantEvent.delta) {
					sawAssistantTextDelta = true;
					logStreamDelta("assistant", "Agent:", assistantEvent.delta, chalk.green);
				}
				break;
			}
			case "message_end": {
				const message = event.message as { role?: string; content?: unknown; usage?: unknown };
				if (message.role === "assistant") {
					flushStream();
					const finalText = extractAssistantText(session);
					const modelUsage = extractModelUsage(message);
					appendAgentUsageEvent(homeDir, {
						type: "message",
						direction: "outgoing",
						textChars: Array.from(finalText).length,
						...(modelUsage ?? { estimatedTokens: estimateTokensFromText(finalText) }),
					});
					if (finalText && !sawAssistantTextDelta) {
						console.log(`${chalk.green("Agent:")} ${truncate(finalText)}`);
					}
				}
				break;
			}
			case "tool_execution_start":
				flushStream();
				console.log(chalk.gray(formatToolStartLine(event.toolName, event.args)));
				break;
			case "tool_execution_end":
				flushStream();
				appendAgentUsageEvent(homeDir, {
					type: "action",
					actionName: event.toolName,
					status: event.isError ? "error" : "success",
				});
				const line = formatToolEndLine(event.toolName, event.isError, event.result);
				console.log(event.isError ? chalk.red(line) : chalk.blue(line));
				break;
		}
	});
}

function logSessionInitTiming(
	conversationKey: string,
	steps: Array<{ label: string; durationMs: number }>,
	totalMs: number,
): void {
	const formattedSteps = steps.map((step) => `${step.label}=${step.durationMs}ms`).join(" ");
	console.log(chalk.gray(`> session_init ${conversationKey} total=${totalMs}ms ${formattedSteps}`));
}

export class SessionPool {
	private readonly options: SessionPoolOptions;
	private readonly authStorage: AuthStorage;
	private readonly modelRegistry: ModelRegistry;
	private readonly sessions = new Map<string, AgentSession>();

	constructor(options: SessionPoolOptions) {
		this.options = options;
		this.authStorage = AuthStorage.inMemory();
		this.modelRegistry = ModelRegistry.create(this.authStorage, join(options.homeDir, "models.json"));
	}

	async getSession(conversationKey: string): Promise<AgentSession> {
		const existing = this.sessions.get(conversationKey);
		if (existing) {
			if (this.options.verboseLogs) {
				console.log(chalk.gray(`> session_reuse ${conversationKey}`));
			}
			return existing;
		}

		const initStartedAt = Date.now();
		const initSteps: Array<{ label: string; durationMs: number }> = [];
		const conversationDir = join(this.options.homeDir, "sessions", sanitizePathSegment(conversationKey));
		mkdirSync(conversationDir, { recursive: true });
		const sessionHistoryDir = getLegacySessionHistoryDir(conversationDir, this.options.homeDir);
		mkdirSync(sessionHistoryDir, { recursive: true });
		const resourceLoader = new DefaultResourceLoader({
			cwd: this.options.homeDir,
			agentDir: conversationDir,
			...(this.options.assistantSystemPrompt
				? {
						systemPromptOverride: (basePrompt: string | undefined) =>
							overrideBaseSystemPrompt(basePrompt, this.options.assistantSystemPrompt, this.options.model),
					}
				: {}),
		});
		const reloadStartedAt = Date.now();
		await resourceLoader.reload();
		initSteps.push({ label: "reload", durationMs: Date.now() - reloadStartedAt });
		const latestSessionFile = this.options.resumeSessions ? getLatestSessionFile(sessionHistoryDir) : undefined;
		const sessionManagerStartedAt = Date.now();
		const sessionManager = this.options.resumeSessions
			? latestSessionFile
				? SessionManager.open(latestSessionFile, sessionHistoryDir)
				: SessionManager.create(this.options.homeDir, sessionHistoryDir)
			: SessionManager.inMemory();
		initSteps.push({
			label: latestSessionFile ? "session_open" : this.options.resumeSessions ? "session_create" : "session_memory",
			durationMs: Date.now() - sessionManagerStartedAt,
		});
		const createStartedAt = Date.now();
		const { session, modelFallbackMessage } = await createAgentSession({
			authStorage: this.authStorage,
			cwd: this.options.homeDir,
			agentDir: conversationDir,
			model: this.options.model,
			modelRegistry: this.modelRegistry,
			thinkingLevel: this.options.thinkingLevel,
			tools: this.options.tools,
			customTools: [],
			resourceLoader,
			sessionManager,
		});
		initSteps.push({ label: "create_agent_session", durationMs: Date.now() - createStartedAt });

		if (modelFallbackMessage) {
			console.warn(chalk.yellow(`Model fallback: ${modelFallbackMessage}`));
		}
		if (this.options.verboseLogs) {
			logSessionInitTiming(conversationKey, initSteps, Date.now() - initStartedAt);
		}
		if (this.options.debug) {
			console.log(
				chalk.gray(
					`Session: ${this.options.resumeSessions ? "persistent" : "ephemeral"}, history ${session.state.messages.length}`,
				),
			);
		}
		attachSessionLogging(session, this.options.homeDir);

		this.sessions.set(conversationKey, session);
		return session;
	}
}

export function extractAssistantText(session: AgentSession): string {
	const messages = [...session.state.messages].reverse();
	for (const message of messages) {
		if ((message as { role?: string }).role !== "assistant") {
			continue;
		}

		const content = (message as { content?: unknown }).content;
		if (typeof content === "string") {
			return content.trim();
		}
		if (!Array.isArray(content)) {
			return "";
		}

		return content
			.flatMap((part) => {
				if (!part || typeof part !== "object") {
					return [];
				}
				const typedPart = part as { type?: unknown; text?: unknown };
				return typedPart.type === "text" && typeof typedPart.text === "string" ? [typedPart.text] : [];
			})
			.join("")
			.trim();
	}

	return "";
}

export function extractLastAssistantError(session: AgentSession): string | undefined {
	const messages = [...session.state.messages].reverse();
	for (const message of messages) {
		const typedMessage = message as { role?: string; stopReason?: string; errorMessage?: unknown };
		if (typedMessage.role !== "assistant") {
			continue;
		}
		if (typedMessage.stopReason !== "error") {
			return undefined;
		}
		return typeof typedMessage.errorMessage === "string" && typedMessage.errorMessage.trim()
			? typedMessage.errorMessage.trim()
			: "Model provider returned an error without details.";
	}
	return undefined;
}
