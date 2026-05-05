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

function sanitizePathSegment(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

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
	const harness =
		configuredModel != null
			? `\n\n## Session harness\nRequests use provider \`${String(configuredModel.provider)}\` and model id \`${configuredModel.id}\` (OpenAI-compatible transport only describes the HTTP API; the underlying engine may differ). Do not insist you are a particular vendor-branded chatbot unless the user asks or the model id clearly names that vendor.`
			: "";
	if (!basePrompt) {
		return `${head}${harness}`;
	}
	const toolsSection = "\n\nAvailable tools:\n";
	const toolsIndex = basePrompt.indexOf(toolsSection);
	if (toolsIndex === -1) {
		return `${head}${harness}`;
	}
	return `${head}${harness}${basePrompt.slice(toolsIndex)}`;
}

function truncate(text: string, max = 160): string {
	return text.length > max ? `${text.slice(0, max)}...` : text;
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
	private readonly freshSessionKeys = new Set<string>();

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
		const shouldCreateFreshSession = this.freshSessionKeys.delete(conversationKey);
		const latestSessionFile = this.options.resumeSessions && !shouldCreateFreshSession ? getLatestSessionFile(sessionHistoryDir) : undefined;
		const sessionManagerStartedAt = Date.now();
		const sessionManager = this.options.resumeSessions
			? shouldCreateFreshSession
				? SessionManager.create(this.options.homeDir, sessionHistoryDir)
				: latestSessionFile
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
		this.sessions.set(conversationKey, session);
		return session;
	}

	async compactSession(conversationKey: string): Promise<{ summary?: string }> {
		const session = await this.getSession(conversationKey);
		if (session.isStreaming) {
			throw new Error("Agent is still responding. Wait for the current turn to finish, then send /compact again.");
		}
		const result = await session.compact();
		const summary = typeof result?.summary === "string" ? result.summary : undefined;
		return { summary };
	}

	async resetSession(conversationKey: string): Promise<void> {
		const existing = this.sessions.get(conversationKey);
		if (existing?.isStreaming) {
			await existing.abort();
		}
		this.sessions.delete(conversationKey);
		this.freshSessionKeys.add(conversationKey);
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
