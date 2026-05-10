import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@mariozechner/pi-coding-agent";
import chalk from "chalk";
import type { Model } from "@mariozechner/pi-ai";
import { getOusiaSkillsDir } from "../agent-home-layout.js";
import type { OusiaPromptInputLike, OusiaSessionRuntimeOptions, OusiaSessionStatus } from "./types.js";
import { normalizeOusiaPromptInput } from "./types.js";

const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;

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
	return toolsIndex === -1 ? `${head}${harness}` : `${head}${harness}${basePrompt.slice(toolsIndex)}`;
}

function logSessionInitTiming(
	conversationKey: string,
	steps: Array<{ label: string; durationMs: number }>,
	totalMs: number,
): void {
	const formattedSteps = steps.map((step) => `${step.label}=${step.durationMs}ms`).join(" ");
	console.log(chalk.gray(`> ousia_session_init ${conversationKey} total=${totalMs}ms ${formattedSteps}`));
}

export class OusiaPiSessionPool {
	private readonly authStorage = AuthStorage.inMemory();
	private readonly modelRegistry: ModelRegistry;
	private readonly sessions = new Map<string, AgentSession>();
	private readonly freshSessionKeys = new Set<string>();

	constructor(private readonly options: OusiaSessionRuntimeOptions) {
		this.modelRegistry = ModelRegistry.create(this.authStorage, join(options.homeDir, "models.json"));
	}

	async getSession(sessionKey: string): Promise<AgentSession> {
		const existing = this.sessions.get(sessionKey);
		if (existing) {
			if (this.options.verboseLogs) {
				console.log(chalk.gray(`> ousia_session_reuse ${sessionKey}`));
			}
			return existing;
		}

		const initStartedAt = Date.now();
		const initSteps: Array<{ label: string; durationMs: number }> = [];
		const conversationDir = join(this.options.homeDir, "sessions", sanitizePathSegment(sessionKey));
		mkdirSync(conversationDir, { recursive: true });
		const sessionHistoryDir = getLegacySessionHistoryDir(conversationDir, this.options.homeDir);
		mkdirSync(sessionHistoryDir, { recursive: true });
		const settingsManager = SettingsManager.create(this.options.homeDir, conversationDir);
		const providerRetrySettings = settingsManager.getProviderRetrySettings();
		settingsManager.applyOverrides({
			retry: {
				provider: {
					...(providerRetrySettings.maxRetries !== undefined ? { maxRetries: providerRetrySettings.maxRetries } : {}),
					maxRetryDelayMs: providerRetrySettings.maxRetryDelayMs,
					timeoutMs: providerRetrySettings.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
				},
			},
		});
		const resourceLoader = new DefaultResourceLoader({
			cwd: this.options.homeDir,
			agentDir: conversationDir,
			settingsManager,
			additionalSkillPaths: [getOusiaSkillsDir(this.options.homeDir)],
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
		const shouldCreateFreshSession = this.freshSessionKeys.delete(sessionKey);
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
			settingsManager,
		});
		initSteps.push({ label: "create_agent_session", durationMs: Date.now() - createStartedAt });

		if (modelFallbackMessage) {
			console.warn(chalk.yellow(`Model fallback: ${modelFallbackMessage}`));
		}
		if (this.options.verboseLogs) {
			logSessionInitTiming(sessionKey, initSteps, Date.now() - initStartedAt);
		}
		this.sessions.set(sessionKey, session);
		return session;
	}

	async prompt(sessionKey: string, input: OusiaPromptInputLike): Promise<AgentSession> {
		const session = await this.getSession(sessionKey);
		const content = normalizeOusiaPromptInput(input);
		await (session as any).prompt(content.text, content.images?.length ? { images: content.images } : undefined);
		return session;
	}

	async compactSession(sessionKey: string): Promise<{ summary?: string }> {
		const session = await this.getSession(sessionKey);
		if (session.isStreaming) {
			throw new Error("Agent is still responding. Wait for the current run to finish, then compact again.");
		}
		const result = await session.compact();
		return { summary: typeof result?.summary === "string" ? result.summary : undefined };
	}

	async getSessionStatus(sessionKey: string): Promise<OusiaSessionStatus> {
		const session = await this.getSession(sessionKey);
		return getOusiaSessionStatus(session);
	}

	async resetSession(sessionKey: string): Promise<void> {
		const existing = this.sessions.get(sessionKey);
		if (existing?.isStreaming) {
			await existing.abort();
		}
		this.sessions.delete(sessionKey);
		this.freshSessionKeys.add(sessionKey);
	}
}

function getOusiaSessionStatus(session: AgentSession): OusiaSessionStatus {
	const stats = (session as unknown as { getSessionStats?: () => unknown }).getSessionStats?.();
	const typedStats = stats && typeof stats === "object" ? (stats as { totalMessages?: unknown; contextUsage?: unknown }) : undefined;
	const contextUsage = normalizeContextUsage(typedStats?.contextUsage);
	return {
		totalMessages:
			typeof typedStats?.totalMessages === "number" ? typedStats.totalMessages : session.state.messages.length,
		...(contextUsage ? { contextUsage } : {}),
	};
}

function normalizeContextUsage(value: unknown): OusiaSessionStatus["contextUsage"] | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const usage = value as { tokens?: unknown; contextWindow?: unknown; percent?: unknown };
	if (typeof usage.contextWindow !== "number") {
		return undefined;
	}
	const tokens = typeof usage.tokens === "number" || usage.tokens === null ? usage.tokens : null;
	const percent = typeof usage.percent === "number" || usage.percent === null ? usage.percent : null;
	return {
		tokens,
		contextWindow: usage.contextWindow,
		percent,
	};
}

export function extractOusiaAssistantText(session: AgentSession): string {
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
