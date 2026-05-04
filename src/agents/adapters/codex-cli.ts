import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import chalk from "chalk";
import { sanitizePathSegment } from "../../channels/feishu/messages.js";
import { getAgentRoundInputText } from "../types.js";
import type {
	AgentBackendAdapter,
	AgentConversationSession,
	AgentConversationSessionPool,
	AgentRoundInputLike,
	AgentSessionCapabilities,
	AgentSessionEvent,
	AgentSessionRuntimeOptions,
	BackendDiagnostic,
} from "../types.js";

type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
type CodexWebSearchMode = "disabled" | "cached" | "live";

interface JsonRpcMessage {
	id?: number;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { message?: string };
}

interface PendingRequest {
	method: string;
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
}

interface ActiveTurn {
	prompt: string;
	startedAt: number;
	assistantText: string;
	resolve: () => void;
	reject: (error: Error) => void;
}

interface CodexAppServerLoginResult {
	authUrl: string;
	loginId: string;
}

interface CodexAppServerLoginCompletion {
	success: boolean;
	loginId?: string | null;
	error?: string | null;
}

const FALLBACK_CODEX_MODEL = "gpt-5.5";
const PIE_CODEX_DEVELOPER_INSTRUCTIONS = [
	"You are a Codex agent running inside Pie, a personal agent client.",
	"The current working directory is the agent profile workDir. Treat it as your active workspace.",
	"Pie may launch you from the Pie application source tree; paths in process argv are runtime implementation details, not necessarily the user's working project.",
	"When describing the environment, distinguish the agent profile home/workDir from the Pie client source path.",
].join("\n");

const CODEX_CAPABILITIES: AgentSessionCapabilities = {
	supportsSteering: true,
	supportsInterrupt: true,
	supportsStreamingEvents: true,
	supportsSessionPersistence: true,
	supportsToolEvents: true,
};

class CodexAppServerSession implements AgentConversationSession {
	readonly capabilities = CODEX_CAPABILITIES;
	readonly state: { messages: unknown[] } = { messages: [] };
	private readonly listeners = new Set<(event: AgentSessionEvent) => void>();
	private readonly pending = new Map<number, PendingRequest>();
	private process?: ChildProcessWithoutNullStreams;
	private stderr = "";
	private nextRequestId = 0;
	private initialized = false;
	private threadId: string | undefined;
	private activeTurnId: string | undefined;
	private activeTurn: ActiveTurn | undefined;
	private starting?: Promise<void>;
	private aborted = false;
	private roundIndex = 0;
	private turnIndex = 0;
	private currentRoundId = "";
	private currentTurnId = "";
	private readonly tokenUsageByTurnId = new Map<string, unknown>();
	private readonly completedTurnIds = new Set<string>();
	private readonly flushedTokenUsageTurnIds = new Set<string>();
	private readonly pieTurnByCodexTurnId = new Map<string, { roundId: string; turnId: string }>();

	constructor(
		private readonly options: {
			homeDir: string;
			conversationKey: string;
			model?: string;
			thinkingLevel?: ThinkingLevel;
			sandboxMode: CodexSandboxMode;
			webSearchMode: CodexWebSearchMode;
			systemPrompt?: string;
			resumeSessions: boolean;
			verboseLogs: boolean;
			debug: boolean;
		},
	) {
		this.threadId = this.options.resumeSessions ? this.readPersistedThreadId() : undefined;
	}

	get isStreaming(): boolean {
		return Boolean(this.activeTurn);
	}

	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async abort(): Promise<void> {
		this.aborted = true;
		this.process?.kill("SIGTERM");
	}

	async steer(text: string): Promise<void> {
		const prompt = text.trim();
		if (!prompt) {
			throw new Error("Prompt is empty.");
		}
		await this.ensureStarted();
		if (!this.threadId || !this.activeTurnId) {
			throw new Error("Codex has no active turn to steer.");
		}
		this.state.messages.push({ role: "user", content: prompt });
		await this.request("turn/steer", {
			threadId: this.threadId,
			expectedTurnId: this.activeTurnId,
			input: [{ type: "text", text: prompt }],
		});
		if (this.options.verboseLogs) {
			console.log(chalk.gray(`> codex_steer thread=${this.threadId} turn=${this.activeTurnId}`));
		}
	}

	async prompt(input: AgentRoundInputLike): Promise<void> {
		const prompt = getAgentRoundInputText(input).trim();
		if (!prompt) {
			throw new Error("Prompt is empty.");
		}
		if (this.activeTurn) {
			throw new Error("Codex turn is already running.");
		}
		await this.ensureStarted();
		const threadId = await this.ensureThread();
		this.state.messages.push({ role: "user", content: prompt });

		const startedAt = Date.now();
		this.aborted = false;
		this.roundIndex += 1;
		this.turnIndex = 0;
		this.currentRoundId = `round_${this.roundIndex}`;
		this.currentTurnId = "";
		this.emit({ type: "round_started", roundId: this.currentRoundId });
		await new Promise<void>((resolve, reject) => {
			this.activeTurn = { prompt, startedAt, assistantText: "", resolve, reject };
			this.request("turn/start", {
				threadId,
				input: [{ type: "text", text: prompt }],
			}).catch((error) => {
				this.activeTurn = undefined;
				reject(error);
			});
		});
	}

	private async ensureStarted(): Promise<void> {
		if (this.process && this.initialized) {
			return;
		}
		if (this.starting) {
			return this.starting;
		}
		this.starting = this.startProcess();
		try {
			await this.starting;
		} finally {
			this.starting = undefined;
		}
	}

	private async startProcess(): Promise<void> {
		this.stderr = "";
		const codexPath = await resolveCodexExecutable();
		if (!codexPath) {
			throw new Error("Codex CLI was not found. Install Codex and run `codex login` in a terminal.");
		}
		const args = [
			"app-server",
			"--listen",
			"stdio://",
			"-c",
			`web_search="${this.options.webSearchMode}"`,
		];
		const child = spawn(codexPath, args, {
			cwd: process.cwd(),
			env: process.env,
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.process = child;
		const rl = createInterface({ input: child.stdout });
		rl.on("line", (line) => this.handleLine(line));
		child.stderr.on("data", (chunk: Buffer) => {
			this.stderr += chunk.toString("utf8");
			if (this.stderr.length > 8_000) {
				this.stderr = this.stderr.slice(-8_000);
			}
			if (this.options.debug) {
				process.stderr.write(chunk);
			}
		});
		child.on("error", (error) => this.failProcess(error));
		child.on("close", (code, signal) => {
			rl.close();
			this.failProcess(new Error(`codex app-server exited${signal ? ` (${signal})` : ""}: ${this.stderr.trim() || `exit ${code}`}`));
		});
		await this.request("initialize", {
			clientInfo: { name: "pie", version: "1.0.0" },
			capabilities: { experimentalApi: true },
		});
		this.notify("initialized", {});
		this.initialized = true;
	}

	private async ensureThread(): Promise<string> {
		if (this.threadId) {
			try {
				const result = await this.request("thread/resume", this.threadParams({ threadId: this.threadId }));
				const resumedThreadId = extractThreadId(result) ?? this.threadId;
				this.threadId = resumedThreadId;
				this.persistThreadId(resumedThreadId);
				return resumedThreadId;
			} catch (error) {
				console.warn(chalk.gray(`Codex thread resume failed; starting a fresh thread: ${formatError(error)}`));
				this.threadId = undefined;
			}
		}
		const result = await this.request("thread/start", this.threadParams());
		const threadId = extractThreadId(result);
		if (!threadId) {
			throw new Error("Codex thread/start returned no thread id.");
		}
		this.threadId = threadId;
		this.persistThreadId(threadId);
		return threadId;
	}

	private threadParams(extra?: Record<string, unknown>): Record<string, unknown> {
		const config: Record<string, unknown> = {};
		if (this.options.thinkingLevel && this.options.thinkingLevel !== "off" && this.options.thinkingLevel !== "minimal") {
			config.model_reasoning_effort = this.options.thinkingLevel;
		}
		return {
			...extra,
			cwd: process.cwd(),
			model: this.options.model || undefined,
			approvalPolicy: "never",
			sandbox: this.options.sandboxMode,
			developerInstructions: this.options.systemPrompt || PIE_CODEX_DEVELOPER_INSTRUCTIONS,
			config: Object.keys(config).length ? config : undefined,
		};
	}

	private handleLine(line: string): void {
		if (this.options.debug) {
			console.log(chalk.gray(`[codex:stdout] ${line}`));
		}
		let message: JsonRpcMessage;
		try {
			message = JSON.parse(line) as JsonRpcMessage;
		} catch {
			return;
		}
		if (message.id !== undefined) {
			this.handleResponse(message);
			return;
		}
		this.handleNotification(message);
	}

	private handleResponse(message: JsonRpcMessage): void {
		if (message.id === undefined) {
			return;
		}
		const pending = this.pending.get(message.id);
		if (!pending) {
			return;
		}
		this.pending.delete(message.id);
		if (message.error) {
			pending.reject(new Error(message.error.message || `${pending.method} failed`));
			return;
		}
		const threadId = extractThreadId(message.result);
		if (threadId) {
			this.threadId = threadId;
			this.persistThreadId(threadId);
		}
		const turnId = extractTurnId(message.result);
		if (turnId) {
			this.activeTurnId = turnId;
		}
		pending.resolve(message.result);
	}

	private handleNotification(message: JsonRpcMessage): void {
		switch (message.method) {
			case "thread/started": {
				const threadId = extractThreadId(message.params);
				if (threadId) {
					this.threadId = threadId;
					this.persistThreadId(threadId);
				}
				break;
			}
			case "turn/started": {
				const turnId = extractTurnId(message.params);
				this.activeTurnId = turnId ?? this.activeTurnId;
				this.startNextTurn();
				if (turnId) {
					this.pieTurnByCodexTurnId.set(turnId, { roundId: this.ensureRound(), turnId: this.ensureTurn() });
				}
				break;
			}
			case "thread/tokenUsage/updated": {
				const turnId = extractTurnId(message.params);
				const usage = extractCodexTokenUsagePayload(message.params);
				if (turnId && usage) {
					this.tokenUsageByTurnId.set(turnId, usage);
					this.flushTokenUsage(turnId);
				}
				break;
			}
			case "item/agentMessage/delta": {
				const delta = extractStringField(message.params, "delta");
				if (delta) {
					this.activeTurn!.assistantText += delta;
					this.emit({ type: "text_delta", roundId: this.ensureRound(), turnId: this.ensureTurn(), textId: "text_0", delta });
				}
				break;
			}
			case "item/reasoning/summaryTextDelta":
			case "item/reasoning/textDelta": {
				const delta = extractStringField(message.params, "delta");
				if (delta) {
					this.emit({ type: "thinking_delta", roundId: this.ensureRound(), turnId: this.ensureTurn(), thinkingId: "thinking_0", delta });
				}
				break;
			}
			case "item/started":
			case "item/completed":
				this.handleItemNotification(message);
				break;
			case "turn/completed":
				this.completeActiveTurn(message.params);
				break;
			case "error":
				this.failActiveTurn(new Error(extractErrorMessage(message.params) || "Unknown Codex app-server error"));
				break;
		}
	}

	private handleItemNotification(message: JsonRpcMessage): void {
		const item = message.params && typeof message.params === "object" ? (message.params as { item?: unknown }).item : undefined;
		if (!item || typeof item !== "object") {
			return;
		}
		const typedItem = item as Record<string, unknown>;
		const type = typedItem.type;
		if (type === "agentMessage" && message.method === "item/completed") {
			const text = typeof typedItem.text === "string" ? typedItem.text : "";
			if (text && !this.activeTurn?.assistantText) {
				this.activeTurn!.assistantText = text;
				this.emit({ type: "text_delta", roundId: this.ensureRound(), turnId: this.ensureTurn(), textId: "text_0", delta: text });
			}
			return;
		}
		if (type === "reasoning" && message.method === "item/completed") {
			const text = joinStringArray(typedItem.summary) || joinStringArray(typedItem.content);
			if (text) {
				this.emit({ type: "thinking_delta", roundId: this.ensureRound(), turnId: this.ensureTurn(), thinkingId: "thinking_0", delta: text });
			}
			return;
		}
		if (type === "commandExecution") {
			const command = typeof typedItem.command === "string" ? typedItem.command : "";
			if (message.method === "item/started") {
				this.emit({ type: "tool_call_started", roundId: this.ensureRound(), turnId: this.ensureTurn(), toolCallId: makeToolCallId(typedItem), name: "bash", args: { command } });
			} else {
				this.emit({ type: "tool_call_finished", roundId: this.ensureRound(), turnId: this.ensureTurn(), toolCallId: makeToolCallId(typedItem), name: "bash", result: typedItem.output ?? "", isError: Boolean(typedItem.error) });
			}
			return;
		}
		if (type === "webSearch" && message.method === "item/started") {
			this.emit({ type: "tool_call_started", roundId: this.ensureRound(), turnId: this.ensureTurn(), toolCallId: makeToolCallId(typedItem), name: "web_search", args: { query: typedItem.query } });
		}
	}

	private completeActiveTurn(params: unknown): void {
		const turn = params && typeof params === "object" ? (params as { turn?: { status?: string; error?: { message?: string } } }).turn : undefined;
		if (turn?.status === "failed") {
			this.failActiveTurn(new Error(turn.error?.message || "Codex turn failed."));
			return;
		}
		const active = this.activeTurn;
		if (!active) {
			this.activeTurnId = undefined;
			return;
		}
		const assistantText = active.assistantText.trim();
		const turnId = extractTurnId(params) ?? this.activeTurnId;
		if (turnId) {
			const usage = extractUsagePayload(params);
			if (usage && !this.tokenUsageByTurnId.has(turnId)) {
				this.tokenUsageByTurnId.set(turnId, usage);
			}
			this.completedTurnIds.add(turnId);
			this.flushTokenUsage(turnId);
		}
		this.state.messages.push({ role: "assistant", content: assistantText });
		this.emit({ type: "text_finished", roundId: this.ensureRound(), turnId: this.ensureTurn(), textId: "text_0", text: assistantText });
		this.emit({ type: "turn_finished", roundId: this.ensureRound(), turnId: this.ensureTurn(), status: "success" });
		this.emit({ type: "round_finished", roundId: this.ensureRound(), status: "success", finalText: assistantText });
		if (this.options.verboseLogs) {
			console.log(chalk.gray(`> codex_app_server complete elapsed=${Date.now() - active.startedAt}ms chars=${assistantText.length}`));
		}
		this.activeTurn = undefined;
		this.activeTurnId = undefined;
		this.currentTurnId = "";
		this.currentRoundId = "";
		active.resolve();
	}

	private failActiveTurn(error: Error): void {
		const active = this.activeTurn;
		if (!active) {
			return;
		}
		this.state.messages.push({
			role: "assistant",
			content: "",
			stopReason: this.aborted ? "aborted" : "error",
			errorMessage: this.aborted ? undefined : error.message,
		});
		this.activeTurn = undefined;
		this.activeTurnId = undefined;
		const status = this.aborted ? "aborted" : "error";
		this.emit({ type: "turn_finished", roundId: this.ensureRound(), turnId: this.ensureTurn(), status });
		this.emit({ type: "round_finished", roundId: this.ensureRound(), status });
		this.currentTurnId = "";
		this.currentRoundId = "";
		if (this.aborted) {
			active.resolve();
		} else {
			active.reject(error);
		}
	}

	private failProcess(error: Error): void {
		for (const pending of this.pending.values()) {
			pending.reject(error);
		}
		this.pending.clear();
		this.initialized = false;
		this.process = undefined;
		this.failActiveTurn(error);
	}

	private request(method: string, params: unknown): Promise<unknown> {
		if (!this.process?.stdin.writable) {
			return Promise.reject(new Error("Codex app-server is not running."));
		}
		const id = ++this.nextRequestId;
		const payload = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { method, resolve, reject });
			this.process!.stdin.write(payload, (error) => {
				if (error) {
					this.pending.delete(id);
					reject(error);
				}
			});
		});
	}

	private notify(method: string, params: unknown): void {
		this.process?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
	}

	private emit(event: Record<string, unknown>): void {
		for (const listener of this.listeners) {
			listener(event as AgentSessionEvent);
		}
	}

	private ensureRound(): string {
		if (!this.currentRoundId) {
			this.roundIndex += 1;
			this.currentRoundId = `round_${this.roundIndex}`;
		}
		return this.currentRoundId;
	}

	private ensureTurn(): string {
		this.ensureRound();
		if (!this.currentTurnId) {
			this.startNextTurn();
		}
		return this.currentTurnId;
	}

	private startNextTurn(): void {
		const roundId = this.ensureRound();
		if (this.currentTurnId) {
			this.emit({ type: "turn_finished", roundId, turnId: this.currentTurnId, status: "success" });
		}
		this.turnIndex += 1;
		this.currentTurnId = `turn_${this.turnIndex}`;
		this.emit({ type: "turn_started", roundId, turnId: this.currentTurnId, index: this.turnIndex });
	}

	private flushTokenUsage(turnId: string): void {
		if (!this.completedTurnIds.has(turnId) || this.flushedTokenUsageTurnIds.has(turnId)) {
			return;
		}
		const usage = this.tokenUsageByTurnId.get(turnId);
		if (!usage) {
			return;
		}
		this.flushedTokenUsageTurnIds.add(turnId);
		this.tokenUsageByTurnId.delete(turnId);
		const pieTurn = this.pieTurnByCodexTurnId.get(turnId);
		this.emit({ type: "token_usage", ...(pieTurn ?? {}), usage });
	}

	private sessionDir(): string {
		return join(this.options.homeDir, "sessions", sanitizePathSegment(this.options.conversationKey), "codex");
	}

	private readPersistedThreadId(): string | undefined {
		const path = join(this.sessionDir(), "thread.json");
		if (!existsSync(path)) {
			return undefined;
		}
		try {
			const parsed = JSON.parse(readFileSync(path, "utf8")) as { threadId?: unknown };
			return typeof parsed.threadId === "string" && parsed.threadId.trim() ? parsed.threadId.trim() : undefined;
		} catch {
			return undefined;
		}
	}

	private persistThreadId(threadId: string): void {
		if (!this.options.resumeSessions) {
			return;
		}
		mkdirSync(this.sessionDir(), { recursive: true });
		writeFileSync(join(this.sessionDir(), "thread.json"), `${JSON.stringify({ threadId }, null, 2)}\n`, "utf8");
	}
}

class CodexAppServerSessionPool implements AgentConversationSessionPool {
	readonly capabilities = CODEX_CAPABILITIES;
	private readonly sessions = new Map<string, CodexAppServerSession>();
	private readonly codexModels = readCodexModelIds();

	constructor(private readonly options: AgentSessionRuntimeOptions) {}

	async getSession(conversationKey: string): Promise<AgentConversationSession> {
		const existing = this.sessions.get(conversationKey);
		if (existing) {
			return existing;
		}
		const requestedModel = this.options.modelId ?? (this.options.model?.id ? String(this.options.model.id) : undefined);
		const model = this.resolveModel(requestedModel);
		const session = new CodexAppServerSession({
			homeDir: this.options.homeDir,
			conversationKey,
			model,
			thinkingLevel: this.options.thinkingLevel,
			sandboxMode: readCodexSandboxMode(this.options.backendConfig),
			webSearchMode: readCodexWebSearchMode(this.options.backendConfig),
			systemPrompt: this.options.assistantSystemPrompt,
			resumeSessions: this.options.resumeSessions,
			verboseLogs: this.options.verboseLogs,
			debug: this.options.debug,
		});
		this.sessions.set(conversationKey, session);
		return session;
	}

	private resolveModel(requestedModel: string | undefined): string {
		const normalized = requestedModel?.trim();
		if (normalized && (!this.codexModels.size || this.codexModels.has(normalized))) {
			return normalized;
		}
		const fallback = this.codexModels.values().next().value as string | undefined;
		const resolved = fallback ?? FALLBACK_CODEX_MODEL;
		if (normalized) {
			console.warn(chalk.yellow(`Codex model "${normalized}" is not in Codex model catalog; using "${resolved}".`));
		}
		return resolved;
	}
}

class CodexAppServerAuthClient {
	private readonly pending = new Map<number, PendingRequest>();
	private readonly loginWaiters = new Map<string, {
		resolve: (value: CodexAppServerLoginCompletion) => void;
		reject: (error: Error) => void;
	}>();
	private process?: ChildProcessWithoutNullStreams;
	private stderr = "";
	private nextRequestId = 0;
	private closing = false;

	constructor(private readonly options: { debug?: boolean } = {}) {}

	async start(): Promise<void> {
		const codexPath = await resolveCodexExecutable();
		if (!codexPath) {
			throw new Error("Codex CLI was not found. Install Codex and run `codex login` in a terminal.");
		}
		const child = spawn(codexPath, ["app-server", "--listen", "stdio://"], {
			cwd: process.cwd(),
			env: process.env,
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.process = child;
		const rl = createInterface({ input: child.stdout });
		rl.on("line", (line) => this.handleLine(line));
		child.stderr.on("data", (chunk: Buffer) => {
			this.stderr += chunk.toString("utf8");
			if (this.stderr.length > 8_000) {
				this.stderr = this.stderr.slice(-8_000);
			}
			if (this.options.debug) {
				process.stderr.write(chunk);
			}
		});
		child.on("error", (error) => this.fail(error));
		child.on("close", (code, signal) => {
			rl.close();
			if (!this.closing) {
				this.fail(new Error(`codex app-server exited${signal ? ` (${signal})` : ""}: ${this.stderr.trim() || `exit ${code}`}`));
			}
		});
		await this.request("initialize", {
			clientInfo: { name: "pie", version: "1.0.0" },
			capabilities: { experimentalApi: true },
		});
	}

	close(): void {
		this.closing = true;
		this.process?.kill("SIGTERM");
		this.process = undefined;
	}

	async readAccount(): Promise<unknown> {
		return this.request("account/read", { refreshToken: true });
	}

	async startLogin(): Promise<CodexAppServerLoginResult> {
		const result = await this.request("account/login/start", {
			type: "chatgpt",
			codexStreamlinedLogin: true,
		});
		if (!result || typeof result !== "object") {
			throw new Error("Codex account/login/start returned no result.");
		}
		const record = result as Record<string, unknown>;
		const authUrl = typeof record.authUrl === "string" ? record.authUrl : "";
		const loginId = typeof record.loginId === "string" ? record.loginId : "";
		if (!authUrl || !loginId) {
			throw new Error("Codex account/login/start returned no auth URL.");
		}
		return { authUrl, loginId };
	}

	waitForLogin(loginId: string): Promise<CodexAppServerLoginCompletion> {
		return new Promise((resolve, reject) => {
			this.loginWaiters.set(loginId, { resolve, reject });
		});
	}

	private handleLine(line: string): void {
		if (this.options.debug) {
			console.log(chalk.gray(`[codex-auth:stdout] ${line}`));
		}
		let message: JsonRpcMessage;
		try {
			message = JSON.parse(line) as JsonRpcMessage;
		} catch {
			return;
		}
		if (message.id !== undefined) {
			this.handleResponse(message);
			return;
		}
		this.handleNotification(message);
	}

	private handleResponse(message: JsonRpcMessage): void {
		if (message.id === undefined) {
			return;
		}
		const pending = this.pending.get(message.id);
		if (!pending) {
			return;
		}
		this.pending.delete(message.id);
		if (message.error) {
			pending.reject(new Error(message.error.message || `${pending.method} failed`));
			return;
		}
		pending.resolve(message.result);
	}

	private handleNotification(message: JsonRpcMessage): void {
		if (message.method !== "account/login/completed") {
			return;
		}
		const params = message.params && typeof message.params === "object" ? message.params as Record<string, unknown> : {};
		const completion: CodexAppServerLoginCompletion = {
			success: params.success === true,
			loginId: typeof params.loginId === "string" ? params.loginId : null,
			error: typeof params.error === "string" ? params.error : null,
		};
		const waiter = completion.loginId ? this.loginWaiters.get(completion.loginId) : undefined;
		if (waiter && completion.loginId) {
			this.loginWaiters.delete(completion.loginId);
			waiter.resolve(completion);
		}
	}

	private request(method: string, params: unknown): Promise<unknown> {
		if (!this.process?.stdin.writable) {
			return Promise.reject(new Error("Codex app-server is not running."));
		}
		const id = ++this.nextRequestId;
		const payload = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { method, resolve, reject });
			this.process!.stdin.write(payload, (error) => {
				if (error) {
					this.pending.delete(id);
					reject(error);
				}
			});
		});
	}

	private fail(error: Error): void {
		for (const pending of this.pending.values()) {
			pending.reject(error);
		}
		this.pending.clear();
		for (const waiter of this.loginWaiters.values()) {
			waiter.reject(error);
		}
		this.loginWaiters.clear();
		this.process = undefined;
	}
}

function extractThreadId(value: unknown): string | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (typeof record.threadId === "string") {
		return record.threadId;
	}
	const thread = record.thread && typeof record.thread === "object" ? record.thread as Record<string, unknown> : undefined;
	return typeof thread?.id === "string" ? thread.id : undefined;
}

function extractTurnId(value: unknown): string | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (typeof record.turnId === "string") {
		return record.turnId;
	}
	const turn = record.turn && typeof record.turn === "object" ? record.turn as Record<string, unknown> : undefined;
	return typeof turn?.id === "string" ? turn.id : undefined;
}

function makeToolCallId(item: Record<string, unknown>): string {
	const id = item.id ?? item.callId ?? item.call_id;
	return typeof id === "string" && id.trim() ? id.trim() : `tool_${String(item.type ?? "call")}`;
}

function extractStringField(value: unknown, key: string): string {
	if (!value || typeof value !== "object") {
		return "";
	}
	const field = (value as Record<string, unknown>)[key];
	return typeof field === "string" ? field : "";
}

function extractErrorMessage(value: unknown): string | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (typeof record.message === "string") {
		return record.message;
	}
	const error = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : undefined;
	return typeof error?.message === "string" ? error.message : undefined;
}

function extractUsagePayload(value: unknown): unknown | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (record.usage && typeof record.usage === "object") {
		return record.usage;
	}
	const turn = record.turn && typeof record.turn === "object" ? record.turn as Record<string, unknown> : undefined;
	if (turn?.usage && typeof turn.usage === "object") {
		return turn.usage;
	}
	return undefined;
}

function extractCodexTokenUsagePayload(value: unknown): unknown | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const tokenUsage = record.tokenUsage && typeof record.tokenUsage === "object" ? record.tokenUsage as Record<string, unknown> : undefined;
	const last = tokenUsage?.last && typeof tokenUsage.last === "object" ? tokenUsage.last as Record<string, unknown> : undefined;
	if (!last) {
		return undefined;
	}
	const inputTokens = readNumber(last, "inputTokens") ?? 0;
	const cachedInputTokens = readNumber(last, "cachedInputTokens") ?? 0;
	const outputTokens = readNumber(last, "outputTokens") ?? 0;
	const totalTokens = readNumber(last, "totalTokens") ?? inputTokens + outputTokens;
	const reasoningOutputTokens = readNumber(last, "reasoningOutputTokens") ?? 0;
	if (totalTokens <= 0 && inputTokens <= 0 && outputTokens <= 0 && cachedInputTokens <= 0) {
		return undefined;
	}

	return {
		input_tokens: inputTokens,
		output_tokens: outputTokens,
		total_tokens: totalTokens,
		input_tokens_details: {
			cached_tokens: cachedInputTokens,
		},
		output_tokens_details: {
			reasoning_tokens: reasoningOutputTokens,
		},
	};
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function joinStringArray(value: unknown): string {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join("\n").trim() : "";
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function readCodexModelIds(): Set<string> {
	const path = join(homedir(), ".codex", "models_cache.json");
	if (!existsSync(path)) {
		return new Set([FALLBACK_CODEX_MODEL]);
	}
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as { models?: unknown };
		if (!Array.isArray(parsed.models)) {
			return new Set([FALLBACK_CODEX_MODEL]);
		}
		const ids = parsed.models
			.map((model) =>
				model && typeof model === "object" && typeof (model as { slug?: unknown }).slug === "string"
					? (model as { slug: string }).slug.trim()
					: "",
			)
			.filter(Boolean);
		return new Set(ids.length ? ids : [FALLBACK_CODEX_MODEL]);
	} catch {
		return new Set([FALLBACK_CODEX_MODEL]);
	}
}

function readCodexSandboxMode(config: Record<string, unknown> | undefined): CodexSandboxMode {
	const value = config?.sandboxMode;
	return value === "read-only" || value === "workspace-write" || value === "danger-full-access"
		? value
		: "danger-full-access";
}

function readCodexWebSearchMode(config: Record<string, unknown> | undefined): CodexWebSearchMode {
	const value = config?.webSearchMode;
	return value === "disabled" || value === "cached" || value === "live" ? value : "cached";
}

async function runCommand(command: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});
		child.on("error", (error) => resolve({ code: 1, stdout, stderr: error.message }));
		child.on("close", (code) => resolve({ code, stdout, stderr }));
	});
}

async function runLoginShellCommand(command: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
	const shell = process.env.SHELL?.trim() || "/bin/zsh";
	return runCommand(shell, ["-lc", command]);
}

async function resolveCodexExecutable(): Promise<string | undefined> {
	const found = await runLoginShellCommand("command -v codex");
	const path = found.stdout.trim().split(/\r?\n/)[0]?.trim();
	return found.code === 0 && path ? path : undefined;
}

async function runCodexCommand(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
	const codexPath = await resolveCodexExecutable();
	if (!codexPath) {
		return { code: 127, stdout: "", stderr: "codex command not found in login shell PATH" };
	}
	return runCommand(codexPath, args);
}

async function checkCodexEnvironment(): Promise<BackendDiagnostic> {
	const codexPath = await resolveCodexExecutable();
	if (!codexPath) {
		return {
			installed: false,
			authenticated: false,
			error: "codex command not found in login shell PATH",
			loginCommand: ["codex", "login"],
		};
	}
	const version = await runCommand(codexPath, ["--version"]);
	if (version.code !== 0) {
		return {
			installed: false,
			authenticated: false,
			executablePath: codexPath,
			error: version.stderr.trim() || "codex command not found",
			loginCommand: ["codex", "login"],
		};
	}
	const auth = await runCodexCommand(["login", "status"]);
	return {
		installed: true,
		authenticated: auth.code === 0,
		executablePath: codexPath,
		version: (version.stdout || version.stderr).trim(),
		authMethod: "cli",
		error: auth.code === 0 ? undefined : auth.stderr.trim() || auth.stdout.trim() || "Codex CLI is not logged in.",
		loginCommand: ["codex", "login"],
	};
}

function diagnosticFromAccount(
	codexPath: string,
	version: string | undefined,
	accountResult: unknown,
): BackendDiagnostic {
	const result = accountResult && typeof accountResult === "object" ? accountResult as Record<string, unknown> : {};
	const account = result.account && typeof result.account === "object" ? result.account as Record<string, unknown> : undefined;
	const authenticated = Boolean(account);
	const accountType = typeof account?.type === "string" ? account.type : undefined;
	return {
		installed: true,
		authenticated,
		executablePath: codexPath,
		version,
		authMethod: accountType === "apiKey" || accountType === "chatgpt" ? "cli" : "unknown",
		error: authenticated ? undefined : "Codex CLI is not logged in.",
		loginCommand: ["codex", "login"],
	};
}

export async function checkCodexAppServerEnvironment(): Promise<BackendDiagnostic> {
	const codexPath = await resolveCodexExecutable();
	if (!codexPath) {
		return {
			installed: false,
			authenticated: false,
			error: "codex command not found in login shell PATH",
			loginCommand: ["codex", "login"],
		};
	}
	const version = await runCommand(codexPath, ["--version"]);
	if (version.code !== 0) {
		return {
			installed: false,
			authenticated: false,
			executablePath: codexPath,
			error: version.stderr.trim() || "codex command not found",
			loginCommand: ["codex", "login"],
		};
	}
	const client = new CodexAppServerAuthClient();
	try {
		await client.start();
		const account = await client.readAccount();
		return diagnosticFromAccount(codexPath, (version.stdout || version.stderr).trim(), account);
	} finally {
		client.close();
	}
}

export async function loginCodexWithAppServer(options: {
	onAuthUrl?: (authUrl: string) => void | Promise<void>;
	onCompleted?: (completion: CodexAppServerLoginCompletion) => void | Promise<void>;
	debug?: boolean;
} = {}): Promise<BackendDiagnostic> {
	const codexPath = await resolveCodexExecutable();
	if (!codexPath) {
		throw new Error("codex command not found in login shell PATH");
	}
	const version = await runCommand(codexPath, ["--version"]);
	if (version.code !== 0) {
		throw new Error(version.stderr.trim() || "codex command not found");
	}
	const client = new CodexAppServerAuthClient({ debug: options.debug });
	try {
		await client.start();
		const login = await client.startLogin();
		await options.onAuthUrl?.(login.authUrl);
		const completion = await client.waitForLogin(login.loginId);
		await options.onCompleted?.(completion);
		if (!completion.success) {
			throw new Error(completion.error || "Codex login was not completed.");
		}
		const account = await client.readAccount();
		return diagnosticFromAccount(codexPath, (version.stdout || version.stderr).trim(), account);
	} finally {
		client.close();
	}
}

export const codexCliAgentBackendAdapter: AgentBackendAdapter = {
	kind: "codex",
	label: "Codex",
	capabilities: CODEX_CAPABILITIES,
	checkEnvironment: checkCodexEnvironment,
	createSessionPool(options) {
		return new CodexAppServerSessionPool(options);
	},
	explainError(error) {
		return formatError(error);
	},
};
