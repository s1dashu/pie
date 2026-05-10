import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import WebSocket from "ws";
import { resolveOpenClawExecutable as resolveOpenClawCliExecutable } from "../harness-services/managed-process.js";
import { normalizeOpenClawModelRef, readOpenClawGatewaySettings, toOpenClawModelRef } from "../openclaw-models.js";
import { getAgentPromptInputText } from "../types.js";
import type {
	AgentHarnessAdapter,
	AgentConversationSession,
	AgentConversationSessionPool,
	AgentPromptInputLike,
	AgentSessionCapabilities,
	AgentSessionEvent,
	AgentSessionRuntimeOptions,
	HarnessDiagnostic,
} from "../types.js";

const execFileAsync = promisify(execFile);
const OPENCLAW_PROTOCOL_VERSION = 3;
const DEFAULT_OPENCLAW_GATEWAY_URL = "ws://127.0.0.1:18789";

const OPENCLAW_CAPABILITIES: AgentSessionCapabilities = {
	supportsSteering: true,
	supportsInterrupt: true,
	supportsStreamingEvents: true,
	supportsSessionPersistence: true,
	supportsToolEvents: true,
};

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const PIE_OPENCLAW_CLIENT_ID = "gateway-client";
const PIE_OPENCLAW_CLIENT_MODE = "backend";
const PIE_OPENCLAW_ROLE = "operator";
const PIE_OPENCLAW_SCOPES = ["operator.read", "operator.write", "operator.approvals"];
const OPENCLAW_WARMUP_CONVERSATION_KEY = "__pie_openclaw_warmup__";
const OPENCLAW_SILENT_REPLY_TOKEN = "NO_REPLY";
const OPENCLAW_SESSION_CREATE_TIMEOUT_MS = 30_000;
const OPENCLAW_SESSION_SUBSCRIBE_TIMEOUT_MS = 30_000;

interface OpenClawDeviceIdentity {
	deviceId: string;
	publicKeyPem: string;
	privateKeyPem: string;
}

let deviceIdentity: OpenClawDeviceIdentity | undefined;

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
}

interface OpenClawRpcError {
	code?: unknown;
	message?: unknown;
	details?: unknown;
}

interface OpenClawResponseFrame {
	type: "res";
	id: string;
	ok: boolean;
	payload?: unknown;
	error?: OpenClawRpcError;
}

interface OpenClawEventFrame {
	type: "event";
	event: string;
	payload?: unknown;
}

type OpenClawFrame = OpenClawResponseFrame | OpenClawEventFrame;

function readRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asGatewayUrl(value: string | undefined): string {
	const raw = value?.trim() || DEFAULT_OPENCLAW_GATEWAY_URL;
	if (raw.startsWith("http://")) {
		return `ws://${raw.slice("http://".length).replace(/\/+$/, "")}`;
	}
	if (raw.startsWith("https://")) {
		return `wss://${raw.slice("https://".length).replace(/\/+$/, "")}`;
	}
	return raw.replace(/\/+$/, "");
}

function base64UrlEncode(buffer: Buffer): string {
	return buffer.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
	const spki = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
	if (spki.length === ED25519_SPKI_PREFIX.length + 32 && spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
		return spki.subarray(ED25519_SPKI_PREFIX.length);
	}
	return spki;
}

function getDeviceIdentity(): OpenClawDeviceIdentity {
	if (deviceIdentity) {
		return deviceIdentity;
	}
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
	const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
	const publicKeyRaw = derivePublicKeyRaw(publicKeyPem);
	deviceIdentity = {
		deviceId: createHash("sha256").update(publicKeyRaw).digest("hex"),
		publicKeyPem,
		privateKeyPem,
	};
	return deviceIdentity;
}

function normalizeDeviceMetadataForAuth(value: string | undefined): string {
	return value?.trim().toLowerCase() ?? "";
}

function buildDeviceAuthPayload(params: {
	deviceId: string;
	clientId: string;
	clientMode: string;
	role: string;
	scopes: string[];
	signedAtMs: number;
	token?: string;
	nonce: string;
	platform?: string;
	deviceFamily?: string;
}): string {
	return [
		"v3",
		params.deviceId,
		params.clientId,
		params.clientMode,
		params.role,
		params.scopes.join(","),
		String(params.signedAtMs),
		params.token ?? "",
		params.nonce,
		normalizeDeviceMetadataForAuth(params.platform),
		normalizeDeviceMetadataForAuth(params.deviceFamily),
	].join("|");
}

function signDevicePayload(privateKeyPem: string, payload: string): string {
	const key = createPrivateKey(privateKeyPem);
	return base64UrlEncode(sign(null, Buffer.from(payload, "utf8"), key));
}

function createDeviceAuth(nonce: string, token: string | undefined): {
	id: string;
	publicKey: string;
	signature: string;
	signedAt: number;
	nonce: string;
} {
	const identity = getDeviceIdentity();
	const signedAt = Date.now();
	const payload = buildDeviceAuthPayload({
		deviceId: identity.deviceId,
		clientId: PIE_OPENCLAW_CLIENT_ID,
		clientMode: PIE_OPENCLAW_CLIENT_MODE,
		role: PIE_OPENCLAW_ROLE,
		scopes: PIE_OPENCLAW_SCOPES,
		signedAtMs: signedAt,
		token,
		nonce,
		platform: process.platform,
	});
	return {
		id: identity.deviceId,
		publicKey: base64UrlEncode(derivePublicKeyRaw(identity.publicKeyPem)),
		signature: signDevicePayload(identity.privateKeyPem, payload),
		signedAt,
		nonce,
	};
}

function resolveGatewayUrl(options: AgentSessionRuntimeOptions): string {
	const config = options.harnessConfig ?? {};
	const configuredUrl = readString(config.gatewayUrl) ?? readString(config.url) ?? process.env.OPENCLAW_GATEWAY_URL;
	const settings = readOpenClawGatewaySettings({
		stateDir: readString(config.stateDir),
		configPath: readString(config.configPath),
		gatewayUrl: configuredUrl,
	});
	return configuredUrl ? asGatewayUrl(configuredUrl) : settings.gatewayUrl;
}

function resolveGatewayToken(options: AgentSessionRuntimeOptions): string | undefined {
	const config = options.harnessConfig ?? {};
	const settings = readOpenClawGatewaySettings({
		stateDir: readString(config.stateDir),
		configPath: readString(config.configPath),
		gatewayUrl: readString(config.gatewayUrl) ?? readString(config.url) ?? process.env.OPENCLAW_GATEWAY_URL,
	});
	return readString(config.token) ??
		(process.env.OPENCLAW_GATEWAY_TOKEN?.trim() || undefined) ??
		settings.token;
}

function resolveGatewayPassword(options: AgentSessionRuntimeOptions): string | undefined {
	const config = options.harnessConfig ?? {};
	const settings = readOpenClawGatewaySettings({
		stateDir: readString(config.stateDir),
		configPath: readString(config.configPath),
		gatewayUrl: readString(config.gatewayUrl) ?? readString(config.url) ?? process.env.OPENCLAW_GATEWAY_URL,
	});
	return readString(config.password) ??
		(process.env.OPENCLAW_GATEWAY_PASSWORD?.trim() || undefined) ??
		settings.password;
}

function resolveAgentId(options: AgentSessionRuntimeOptions): string | undefined {
	const config = options.harnessConfig ?? {};
	return readString(config.agentId) ?? (process.env.OPENCLAW_AGENT_ID?.trim() || undefined);
}

function resolveModelRef(options: AgentSessionRuntimeOptions): string | undefined {
	const config = options.harnessConfig ?? {};
	const configuredModel = readString(config.model) ?? readString(config.modelRef) ?? (process.env.PIE_OPENCLAW_MODEL?.trim() || undefined);
	if (configuredModel) {
		return normalizeOpenClawModelRef(configuredModel);
	}
	if (options.modelId?.trim()) {
		return normalizeOpenClawModelRef(options.modelId.trim());
	}
	const provider = typeof options.model?.provider === "string" ? options.model.provider.trim() : "";
	const modelId = typeof options.model?.id === "string" ? options.model.id.trim() : "";
	if (provider && modelId) {
		return toOpenClawModelRef(provider, modelId);
	}
	return modelId || undefined;
}

function isUnknownModelError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /unknown model|model_not_found/i.test(message);
}

function isSessionLabelAlreadyInUseError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /label already in use/i.test(message);
}

function isInvalidOpenClawHandshakeError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /invalid handshake|first request must be connect/i.test(message);
}

function isDisconnectedOpenClawGatewayError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message === "OpenClaw gateway is not connected.";
}

function isNonRetryableOpenClawConnectError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /unauthorized|forbidden|auth_token|token_missing|token missing|password/i.test(message);
}

function normalizeConversationKey(conversationKey: string | undefined): string {
	const key = conversationKey?.trim();
	return key || "conversation";
}

function makeSessionKey(conversationKey: string | undefined): string {
	const safe = normalizeConversationKey(conversationKey).replace(/[^a-zA-Z0-9._:-]/g, "_");
	return `pie:${safe || "conversation"}`;
}

function textFromUnknown(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (value == null) {
		return "";
	}
	if (Array.isArray(value)) {
		return value.map((item) => textFromUnknown(readRecord(item)?.text ?? item)).join("");
	}
	const record = readRecord(value);
	if (record) {
		return textFromUnknown(record.text ?? record.content ?? record.output ?? record.message);
	}
	return String(value);
}

function extractMessageText(message: unknown): string {
	const record = readRecord(message);
	if (!record) {
		return textFromUnknown(message);
	}
	return textFromUnknown(record.content ?? record.text ?? record.message);
}

function isSilentOpenClawReplyText(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) {
		return false;
	}
	if (new RegExp(`^\\s*${OPENCLAW_SILENT_REPLY_TOKEN}\\s*$`, "i").test(trimmed)) {
		return true;
	}
	if (!trimmed.startsWith("{") || !trimmed.endsWith("}") || !trimmed.includes(OPENCLAW_SILENT_REPLY_TOKEN)) {
		return false;
	}
	try {
		const parsed = JSON.parse(trimmed) as { action?: unknown };
		return parsed
			&& typeof parsed === "object"
			&& !Array.isArray(parsed)
			&& Object.keys(parsed).length === 1
			&& typeof parsed.action === "string"
			&& parsed.action.trim() === OPENCLAW_SILENT_REPLY_TOKEN;
	} catch {
		return false;
	}
}

function extractAssistantTextFromWaitResult(value: unknown): string {
	const record = readRecord(value);
	if (!record) {
		return "";
	}
	const messages = Array.isArray(record.messages) ? record.messages : Array.isArray(record.finalMessages) ? record.finalMessages : undefined;
	if (messages) {
		for (const message of [...messages].reverse()) {
			const messageRecord = readRecord(message);
			if (readString(messageRecord?.role) === "assistant") {
				const text = extractMessageText(message);
				if (text.trim()) {
					return text;
				}
			}
		}
	}
	const messageText = extractMessageText(record.message ?? record.finalMessage ?? record.assistantMessage ?? record.response);
	if (messageText.trim()) {
		return messageText;
	}
	return textFromUnknown(record.output ?? record.finalOutput ?? record.text ?? record.content).trim();
}

function makeRpcError(error: OpenClawRpcError | undefined): Error {
	const message = readString(error?.message) ?? readString(error?.code) ?? "OpenClaw gateway request failed.";
	const details = error?.details ? ` ${JSON.stringify(error.details)}` : "";
	return new Error(`${message}${details}`);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldLogOpenClawTiming(options: AgentSessionRuntimeOptions): boolean {
	return options.debug || options.verboseLogs || process.env.PIE_OPENCLAW_TIMING === "1";
}

function isOpenClawSessionPrewarmEnabled(): boolean {
	return process.env.PIE_OPENCLAW_PREWARM_SESSION === "1";
}

function readOpenClawPrewarmPrompt(): string | undefined {
	const prompt = process.env.PIE_OPENCLAW_PREWARM_PROMPT?.trim();
	return prompt || undefined;
}

function formatTimingDetails(details: Record<string, string | number | boolean | undefined>): string {
	const parts = Object.entries(details)
		.filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
		.map(([key, value]) => `${key}=${String(value).replace(/\s+/g, "_")}`);
	return parts.length ? ` ${parts.join(" ")}` : "";
}

function logOpenClawTiming(
	options: AgentSessionRuntimeOptions,
	conversationKey: string,
	stage: string,
	startedAt: number,
	details: Record<string, string | number | boolean | undefined> = {},
): void {
	const elapsedMs = Math.max(0, Date.now() - startedAt);
	appendOpenClawRunLog(options.homeDir, {
		ts: new Date().toISOString(),
		conversationKey,
		stage,
		elapsedMs,
		...details,
	});
	if (shouldLogOpenClawTiming(options)) {
		console.log(`> openclaw_timing ${conversationKey} stage=${stage} elapsed=${elapsedMs}ms${formatTimingDetails(details)}`);
	}
}

function appendOpenClawRunLog(homeDir: string | undefined, entry: Record<string, unknown>): void {
	if (!homeDir) {
		return;
	}
	try {
		const runtimeDir = join(homeDir, "runtime");
		mkdirSync(runtimeDir, { recursive: true });
		appendFileSync(join(runtimeDir, "openclaw-runs.jsonl"), `${JSON.stringify(entry)}\n`);
	} catch {
		// File diagnostics must never affect agent runs.
	}
}

class OpenClawGatewayClient {
	private socket?: WebSocket;
	private connected?: Promise<void>;
	private readonly pending = new Map<string, PendingRequest>();
	private readonly eventListeners = new Set<(frame: OpenClawEventFrame) => void>();

	constructor(private readonly options: AgentSessionRuntimeOptions) {}

	onEvent(listener: (frame: OpenClawEventFrame) => void): () => void {
		this.eventListeners.add(listener);
		return () => {
			this.eventListeners.delete(listener);
		};
	}

	async request(
		method: string,
		params: Record<string, unknown>,
		timeoutMs = 30_000,
		options: { signal?: AbortSignal } = {},
	): Promise<unknown> {
		const startedAt = Date.now();
		appendOpenClawRunLog(this.options.homeDir, {
			ts: new Date().toISOString(),
			stage: "rpc_start",
			method,
			timeoutMs,
		});
		await this.ensureConnectedWithRetry();
		try {
			const response = await this.sendRequest(method, params, timeoutMs, options);
			appendOpenClawRunLog(this.options.homeDir, {
				ts: new Date().toISOString(),
				stage: "rpc_done",
				method,
				elapsedMs: Date.now() - startedAt,
			});
			return response;
		} catch (error) {
			if (!isInvalidOpenClawHandshakeError(error) && !isDisconnectedOpenClawGatewayError(error)) {
				appendOpenClawRunLog(this.options.homeDir, {
					ts: new Date().toISOString(),
					stage: "rpc_error",
					method,
					elapsedMs: Date.now() - startedAt,
					error: error instanceof Error ? error.message : String(error),
				});
				throw error;
			}
			appendOpenClawRunLog(this.options.homeDir, {
				ts: new Date().toISOString(),
				stage: isDisconnectedOpenClawGatewayError(error) ? "rpc_disconnected_retry" : "rpc_stale_handshake_retry",
				method,
				elapsedMs: Date.now() - startedAt,
				error: error instanceof Error ? error.message : String(error),
			});
			this.resetConnection(error instanceof Error ? error : new Error(String(error)));
			await this.ensureConnectedWithRetry(15_000);
			try {
				const response = await this.sendRequest(method, params, timeoutMs, options);
				appendOpenClawRunLog(this.options.homeDir, {
					ts: new Date().toISOString(),
					stage: "rpc_retry_done",
					method,
					elapsedMs: Date.now() - startedAt,
				});
				return response;
			} catch (retryError) {
				appendOpenClawRunLog(this.options.homeDir, {
					ts: new Date().toISOString(),
					stage: "rpc_retry_error",
					method,
					elapsedMs: Date.now() - startedAt,
					error: retryError instanceof Error ? retryError.message : String(retryError),
				});
				throw retryError;
			}
		}
	}

	private async sendRequest(
		method: string,
		params: Record<string, unknown>,
		timeoutMs: number,
		options: { signal?: AbortSignal } = {},
	): Promise<unknown> {
		const socket = this.socket;
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			throw new Error("OpenClaw gateway is not connected.");
		}
		if (options.signal?.aborted) {
			throw new Error(`OpenClaw gateway request aborted: ${method}`);
		}
		const id = randomUUID();
		return await new Promise<unknown>((resolve, reject) => {
			const cleanup = (): void => {
				clearTimeout(timer);
				options.signal?.removeEventListener("abort", onAbort);
			};
			const onAbort = (): void => {
				this.pending.delete(id);
				cleanup();
				reject(new Error(`OpenClaw gateway request aborted: ${method}`));
			};
			const timer = setTimeout(() => {
				this.pending.delete(id);
				options.signal?.removeEventListener("abort", onAbort);
				reject(new Error(`OpenClaw gateway request timed out: ${method}`));
			}, timeoutMs);
			options.signal?.addEventListener("abort", onAbort, { once: true });
			this.pending.set(id, {
				resolve: (value) => {
					cleanup();
					resolve(value);
				},
				reject: (error) => {
					cleanup();
					reject(error);
				},
				timer,
			});
			socket.send(JSON.stringify({ type: "req", id, method, params }));
		});
	}

	async warmup(retryForMs = 120_000): Promise<void> {
		await this.ensureConnectedWithRetry(retryForMs);
	}

	private async ensureConnectedWithRetry(retryForMs = 120_000): Promise<void> {
		const deadline = Date.now() + retryForMs;
		let lastError: unknown;
		while (Date.now() < deadline) {
			try {
				await this.ensureConnected();
				return;
			} catch (error) {
				lastError = error;
				if (isNonRetryableOpenClawConnectError(error)) {
					appendOpenClawRunLog(this.options.homeDir, {
						ts: new Date().toISOString(),
						stage: "connect_non_retryable_error",
						error: error instanceof Error ? error.message : String(error),
					});
					throw error;
				}
				await delay(1_000);
			}
		}
		throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "OpenClaw gateway warmup failed."));
	}

	close(): void {
		this.resetConnection(new Error("OpenClaw gateway connection closed."));
	}

	private resetConnection(error: Error): void {
		for (const [id, pending] of this.pending) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
		this.socket?.removeAllListeners();
		this.socket?.close();
		this.socket = undefined;
		this.connected = undefined;
	}

	private async ensureConnected(): Promise<void> {
		if (this.socket?.readyState === WebSocket.OPEN) {
			return;
		}
		if (this.connected) {
			return await this.connected;
		}
		this.connected = this.connect();
		try {
			await this.connected;
		} catch (error) {
			this.connected = undefined;
			throw error;
		}
	}

	private async connect(): Promise<void> {
		const socket = new WebSocket(resolveGatewayUrl(this.options));
		this.socket = socket;
		let handshakeSent = false;
		let handshakeResolved = false;
		const sendHandshake = (nonce?: string): void => {
			if (handshakeSent || socket.readyState !== WebSocket.OPEN) {
				return;
			}
			if (!nonce) {
				return;
			}
			handshakeSent = true;
			const token = resolveGatewayToken(this.options);
			const password = resolveGatewayPassword(this.options);
			const auth = token ? { token } : password ? { password } : {};
			const device = createDeviceAuth(nonce, token ?? password);
			socket.send(JSON.stringify({
				type: "req",
				id: "connect",
				method: "connect",
				params: {
					minProtocol: OPENCLAW_PROTOCOL_VERSION,
					maxProtocol: OPENCLAW_PROTOCOL_VERSION,
					client: {
						id: PIE_OPENCLAW_CLIENT_ID,
						version: "pie",
						platform: process.platform,
						mode: PIE_OPENCLAW_CLIENT_MODE,
					},
					role: PIE_OPENCLAW_ROLE,
					scopes: PIE_OPENCLAW_SCOPES,
					caps: [],
					commands: [],
					permissions: {},
					auth,
					device,
				},
			}));
		};

		await new Promise<void>((resolve, reject) => {
			const fail = (error: Error): void => {
				if (handshakeResolved) {
					return;
				}
				handshakeResolved = true;
				reject(error);
			};
			const challengeTimer = setTimeout(() => fail(new Error("OpenClaw gateway connect challenge timed out.")), 15_000);
			const connectTimer = setTimeout(() => fail(new Error("OpenClaw gateway connect timed out.")), 15_000);
			socket.on("message", (data) => {
				const frame = this.parseFrame(data);
				if (!frame) {
					return;
				}
				if (!handshakeSent && frame.type === "event" && frame.event === "connect.challenge") {
					clearTimeout(challengeTimer);
					sendHandshake(readString(readRecord(frame.payload)?.nonce));
					return;
				}
				if (frame.type === "res" && frame.id === "connect") {
					clearTimeout(challengeTimer);
					clearTimeout(connectTimer);
					if (!frame.ok) {
						fail(makeRpcError(frame.error));
						return;
					}
					handshakeResolved = true;
					resolve();
					return;
				}
				this.handleFrame(frame);
			});
			socket.once("error", (error) => fail(error instanceof Error ? error : new Error(String(error))));
			socket.once("close", () => {
				if (!handshakeResolved) {
					fail(new Error("OpenClaw gateway connection closed during handshake."));
					return;
				}
				if (this.socket === socket) {
					this.resetConnection(new Error("OpenClaw gateway connection closed."));
				}
			});
		});
	}

	private parseFrame(data: WebSocket.RawData): OpenClawFrame | undefined {
		try {
			const text = typeof data === "string" ? data : data.toString("utf8");
			const parsed = JSON.parse(text) as OpenClawFrame;
			return readRecord(parsed) ? parsed : undefined;
		} catch {
			return undefined;
		}
	}

	private handleFrame(frame: OpenClawFrame): void {
		if (frame.type === "res") {
			const pending = this.pending.get(frame.id);
			if (!pending) {
				return;
			}
			this.pending.delete(frame.id);
			clearTimeout(pending.timer);
			if (frame.ok) {
				pending.resolve(frame.payload);
			} else {
				pending.reject(makeRpcError(frame.error));
			}
			return;
		}
		for (const listener of this.eventListeners) {
			listener(frame);
		}
	}
}

class OpenClawSession implements AgentConversationSession {
	readonly capabilities = OPENCLAW_CAPABILITIES;
	readonly state: { messages: unknown[] } = { messages: [] };
	private readonly listeners = new Set<(event: AgentSessionEvent) => void>();
	private readonly sessionKey: string;
	private readonly sessionLabel: string;
	private canonicalSessionKey?: string;
	private unsubscribeGatewayEvents?: () => void;
	private activeRunId?: string;
	private activeMessageRunIds = new Set<string>();
	private acceptUntrackedActiveRunMessages = false;
	private activeAbort?: AbortController;
	private runIndex = 0;
	private turnIndex = 0;
	private currentRunId = "";
	private currentTurnId = "";
	private assistantText = "";
	private textBlockIndex = 0;
	private currentTextId = "";
	private currentText = "";
	private toolIds = new Set<string>();
	private activePromptStartedAt?: number;
	private runFinished?: { promise: Promise<void>; resolve: () => void };

	constructor(
		private readonly options: AgentSessionRuntimeOptions,
		private readonly client: OpenClawGatewayClient,
		private readonly conversationKey: string,
		sessionKey?: string,
		sessionLabel?: string,
	) {
		this.sessionKey = sessionKey ?? makeSessionKey(conversationKey);
		this.sessionLabel = sessionLabel ?? conversationKey;
	}

	get isStreaming(): boolean {
		return Boolean(this.activeAbort);
	}

	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async prompt(input: AgentPromptInputLike): Promise<void> {
		const prompt = getAgentPromptInputText(input).trim();
		if (!prompt) {
			throw new Error("Prompt is empty.");
		}
		if (this.activeAbort) {
			throw new Error("OpenClaw turn is already running.");
		}
		const promptStartedAt = Date.now();
		this.activePromptStartedAt = promptStartedAt;
		logOpenClawTiming(this.options, this.conversationKey, "prompt_enter", promptStartedAt, {
			promptChars: prompt.length,
		});
		try {
			const ensureStartedAt = Date.now();
			await this.ensureSession(promptStartedAt);
			logOpenClawTiming(this.options, this.conversationKey, "ensure_session_done", promptStartedAt, {
				duration: `${Date.now() - ensureStartedAt}ms`,
			});
			this.state.messages.push({ role: "user", content: prompt });
			this.startRun();
			const abort = new AbortController();
			this.activeAbort = abort;
			try {
				const sendStartedAt = Date.now();
				logOpenClawTiming(this.options, this.conversationKey, "send_start", promptStartedAt, {
					key: this.canonicalSessionKey ?? this.sessionKey,
				});
				const response = await this.client.request("sessions.send", {
					key: this.canonicalSessionKey ?? this.sessionKey,
					message: prompt,
					thinking: this.options.thinkingLevel === "off" ? undefined : this.options.thinkingLevel,
					idempotencyKey: randomUUID(),
				});
				logOpenClawTiming(this.options, this.conversationKey, "send_response", promptStartedAt, {
					duration: `${Date.now() - sendStartedAt}ms`,
				});
				const sendResponse = readRecord(response);
				this.activeRunId = readString(sendResponse?.runId);
				if (this.activeRunId) {
					this.activeMessageRunIds.add(this.activeRunId);
					const waitStartedAt = Date.now();
					logOpenClawTiming(this.options, this.conversationKey, "wait_start", promptStartedAt, {
						runId: this.activeRunId,
					});
					await this.waitForRun(this.activeRunId, abort);
					logOpenClawTiming(this.options, this.conversationKey, "wait_complete", promptStartedAt, {
						duration: `${Date.now() - waitStartedAt}ms`,
						runId: this.activeRunId,
					});
				} else {
					const errorMessage = textFromUnknown(sendResponse?.error ?? sendResponse?.runError).trim();
					this.finishRun("error");
					throw new Error(errorMessage || "OpenClaw did not start a run.");
				}
			} catch (error) {
				logOpenClawTiming(this.options, this.conversationKey, "prompt_error", promptStartedAt, {
					error: error instanceof Error ? error.message : String(error),
				});
				if (abort.signal.aborted) {
					this.finishRun("aborted");
					return;
				}
				this.finishRun("error");
				throw error;
			} finally {
				if (this.activeAbort === abort) {
					this.activeAbort = undefined;
					this.activeRunId = undefined;
				}
			}
		} catch (error) {
			logOpenClawTiming(this.options, this.conversationKey, "prompt_outer_error", promptStartedAt, {
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		} finally {
			this.activePromptStartedAt = undefined;
		}
	}

	async steer(text: string): Promise<void> {
		const prompt = text.trim();
		if (!prompt) {
			throw new Error("Prompt is empty.");
		}
		await this.ensureSession();
		this.state.messages.push({ role: "user", content: prompt });
		const isSteeringActiveRun = Boolean(this.activeAbort);
		if (isSteeringActiveRun) {
			this.acceptUntrackedActiveRunMessages = true;
		}
		const response = await this.client.request("chat.send", {
			sessionKey: this.canonicalSessionKey ?? this.sessionKey,
			message: prompt,
			deliver: false,
			idempotencyKey: randomUUID(),
		});
		const steerRunId = readString(readRecord(response)?.runId);
		if (steerRunId) {
			if (isSteeringActiveRun) {
				this.activeMessageRunIds.add(steerRunId);
			} else {
				this.activeRunId = steerRunId;
			}
		}
	}

	async abort(): Promise<void> {
		this.activeAbort?.abort();
		await this.client.request("sessions.abort", {
			key: this.canonicalSessionKey ?? this.sessionKey,
			...(this.activeRunId ? { runId: this.activeRunId } : {}),
		}).catch(() => undefined);
	}

	async prepare(): Promise<void> {
		await this.ensureSession();
	}

	dispose(): void {
		this.unsubscribeGatewayEvents?.();
		this.unsubscribeGatewayEvents = undefined;
	}

	private async ensureSession(promptStartedAt?: number): Promise<void> {
		if (this.canonicalSessionKey) {
			if (promptStartedAt !== undefined) {
				logOpenClawTiming(this.options, this.conversationKey, "session_reused", promptStartedAt);
			}
			return;
		}
		const modelRef = resolveModelRef(this.options);
		const createParams = {
			key: this.sessionKey,
			label: this.sessionLabel,
			...(resolveAgentId(this.options) ? { agentId: resolveAgentId(this.options) } : {}),
			...(modelRef ? { model: modelRef } : {}),
		};
		let created: unknown;
		const createStartedAt = Date.now();
		if (promptStartedAt !== undefined) {
			logOpenClawTiming(this.options, this.conversationKey, "session_create_start", promptStartedAt, {
				key: this.sessionKey,
				label: this.sessionLabel,
				model: modelRef,
				agentId: resolveAgentId(this.options),
				timeoutMs: OPENCLAW_SESSION_CREATE_TIMEOUT_MS,
			});
		}
		try {
			created = await this.client.request("sessions.create", createParams, OPENCLAW_SESSION_CREATE_TIMEOUT_MS);
			if (promptStartedAt !== undefined) {
				logOpenClawTiming(this.options, this.conversationKey, "session_create", promptStartedAt, {
					duration: `${Date.now() - createStartedAt}ms`,
					model: modelRef,
					agentId: resolveAgentId(this.options),
				});
			}
		} catch (error) {
			if (this.options.resumeSessions && isSessionLabelAlreadyInUseError(error)) {
				created = { key: this.sessionKey };
				if (promptStartedAt !== undefined) {
					logOpenClawTiming(this.options, this.conversationKey, "session_resume_existing_label", promptStartedAt, {
						duration: `${Date.now() - createStartedAt}ms`,
					});
				}
			} else if (!modelRef || !isUnknownModelError(error)) {
				if (promptStartedAt !== undefined) {
					logOpenClawTiming(this.options, this.conversationKey, "session_create_error", promptStartedAt, {
						duration: `${Date.now() - createStartedAt}ms`,
						error: error instanceof Error ? error.message : String(error),
					});
				}
				throw error;
			} else {
				console.warn(`OpenClaw model ${modelRef} is not available; retrying with the OpenClaw default model.`);
				const { model: _model, ...defaultModelParams } = createParams;
				const retryStartedAt = Date.now();
				if (promptStartedAt !== undefined) {
					logOpenClawTiming(this.options, this.conversationKey, "session_create_default_model_start", promptStartedAt, {
						failedModel: modelRef,
						timeoutMs: OPENCLAW_SESSION_CREATE_TIMEOUT_MS,
					});
				}
				created = await this.client.request("sessions.create", defaultModelParams, OPENCLAW_SESSION_CREATE_TIMEOUT_MS);
				if (promptStartedAt !== undefined) {
					logOpenClawTiming(this.options, this.conversationKey, "session_create_default_model", promptStartedAt, {
						duration: `${Date.now() - retryStartedAt}ms`,
						failedModel: modelRef,
						agentId: resolveAgentId(this.options),
					});
				}
			}
		}
		this.canonicalSessionKey = readString(readRecord(created)?.key) ?? this.sessionKey;
		const subscribeStartedAt = Date.now();
		if (promptStartedAt !== undefined) {
			logOpenClawTiming(this.options, this.conversationKey, "session_subscribe_start", promptStartedAt, {
				key: this.canonicalSessionKey,
				timeoutMs: OPENCLAW_SESSION_SUBSCRIBE_TIMEOUT_MS,
			});
		}
		try {
			await this.client.request("sessions.messages.subscribe", { key: this.canonicalSessionKey }, OPENCLAW_SESSION_SUBSCRIBE_TIMEOUT_MS);
		} catch (error) {
			if (promptStartedAt !== undefined) {
				logOpenClawTiming(this.options, this.conversationKey, "session_subscribe_error", promptStartedAt, {
					duration: `${Date.now() - subscribeStartedAt}ms`,
					error: error instanceof Error ? error.message : String(error),
				});
			}
			throw error;
		}
		if (promptStartedAt !== undefined) {
			logOpenClawTiming(this.options, this.conversationKey, "session_subscribe", promptStartedAt, {
				duration: `${Date.now() - subscribeStartedAt}ms`,
			});
		}
		this.unsubscribeGatewayEvents = this.client.onEvent((frame) => this.handleGatewayEvent(frame));
	}

	private startRun(): void {
		this.runIndex += 1;
		this.turnIndex += 1;
		this.currentRunId = `run_${this.runIndex}`;
		this.currentTurnId = `turn_${this.turnIndex}`;
		this.assistantText = "";
		this.resetTextBlock();
		this.toolIds.clear();
		this.activeMessageRunIds.clear();
		this.acceptUntrackedActiveRunMessages = false;
		this.runFinished = createDeferredRunFinished();
		this.emit({ type: "agent_run_started", runId: this.currentRunId });
		this.emit({ type: "turn_started", runId: this.currentRunId, turnId: this.currentTurnId, index: this.turnIndex });
	}

	private finishRun(status: "success" | "error" | "aborted"): void {
		if (!this.currentRunId || !this.currentTurnId) {
			return;
		}
		this.finishActiveToolCalls(status === "error");
		this.finishCurrentTextBlock();
		const assistantMessage = { role: "assistant", content: this.assistantText };
		this.state.messages.push(assistantMessage);
		this.emit({ type: "turn_finished", runId: this.currentRunId, turnId: this.currentTurnId, status });
		this.emit({ type: "agent_run_finished", runId: this.currentRunId, status, finalText: this.assistantText });
		this.currentRunId = "";
		this.currentTurnId = "";
		this.acceptUntrackedActiveRunMessages = false;
		this.activeAbort = undefined;
		this.runFinished?.resolve();
		this.runFinished = undefined;
	}

	private handleGatewayEvent(frame: OpenClawEventFrame): void {
		if (frame.event === "session.message" || frame.event === "chat") {
			this.handleSessionMessage(frame.payload);
			return;
		}
		if (frame.event === "session.tool") {
			this.handleSessionTool(frame.payload);
		}
	}

	private handleSessionMessage(payload: unknown): void {
		const record = readRecord(payload);
		if (!record) {
			return;
		}
		const sessionKey = readString(record.sessionKey);
		if (sessionKey && this.canonicalSessionKey && sessionKey !== this.canonicalSessionKey) {
			return;
		}
		const runId = readString(record.runId);
		if (runId && this.activeMessageRunIds.size > 0 && !this.activeMessageRunIds.has(runId) && !this.acceptUntrackedActiveRunMessages) {
			return;
		}
		const state = readString(record.state);
		if (state === "error") {
			this.finishRun("error");
			return;
		}
		if (state === "aborted") {
			this.finishRun("aborted");
			return;
		}
		const message = readRecord(record.message);
		const role = readString(message?.role);
		const text = extractMessageText(record.message);
		const isSilentReply = isSilentOpenClawReplyText(text);
		if (!this.currentRunId || !this.currentTurnId) {
			return;
		}
		if (!text) {
			return;
		}
		if (isSilentReply) {
			if (state === "final" || (!state && role === "assistant")) {
				this.finishRun("success");
			}
			return;
		}
		if (state === "delta") {
			this.emitTextDelta(text.startsWith(this.assistantText) ? text.slice(this.assistantText.length) : text);
			return;
		}
		if (state === "final" || (!state && role === "assistant")) {
			if (!this.assistantText && text) {
				this.emitTextDelta(text);
			}
			this.assistantText = text || this.assistantText;
			this.finishRun("success");
		}
	}

	private handleSessionTool(payload: unknown): void {
		const record = readRecord(payload);
		if (!record || !this.currentRunId || !this.currentTurnId) {
			return;
		}
		const runId = readString(record.runId);
		if (runId && this.activeMessageRunIds.size > 0 && !this.activeMessageRunIds.has(runId) && !this.acceptUntrackedActiveRunMessages) {
			return;
		}
		const data = readRecord(record.data) ?? record;
		const phase = readString(data.phase) ?? readString(record.phase);
		const name = readString(data.name) ?? readString(data.toolName) ?? readString(record.toolName) ?? "tool";
		const toolCallId = readString(data.id) ?? readString(record.id) ?? `${name}:${readString(record.runId) ?? this.turnIndex}`;
		if (phase === "end" || phase === "finish" || phase === "finished") {
			this.toolIds.delete(toolCallId);
			this.emit({
				type: "tool_call_finished",
				runId: this.currentRunId,
				turnId: this.currentTurnId,
				toolCallId,
				name,
				result: data.result ?? data.output,
				isError: Boolean(data.error ?? record.error),
			});
			return;
		}
		if (phase === "start" || !this.toolIds.has(toolCallId)) {
			this.finishCurrentTextBlock();
			this.toolIds.add(toolCallId);
			this.emit({
				type: "tool_call_started",
				runId: this.currentRunId,
				turnId: this.currentTurnId,
				toolCallId,
				name,
				args: data.args ?? data.input,
			});
			return;
		}
		this.emit({
			type: "tool_call_updated",
			runId: this.currentRunId,
			turnId: this.currentTurnId,
			toolCallId,
			name,
			args: data.args ?? data.input,
			partialResult: data.result ?? data.output ?? data,
		});
	}

	private finishActiveToolCalls(isError: boolean): void {
		if (!this.toolIds.size || !this.currentRunId || !this.currentTurnId) {
			return;
		}
		for (const toolCallId of this.toolIds) {
			this.emit({
				type: "tool_call_finished",
				runId: this.currentRunId,
				turnId: this.currentTurnId,
				toolCallId,
				name: "tool",
				isError,
			});
		}
		this.toolIds.clear();
	}

	private emitTextDelta(delta: string): void {
		if (!this.currentRunId || !this.currentTurnId) {
			return;
		}
		if (!delta) {
			return;
		}
		if (!this.currentTextId) {
			this.currentTextId = `text_${this.textBlockIndex}`;
			this.textBlockIndex += 1;
			this.currentText = "";
			this.emit({ type: "text_start", runId: this.currentRunId, turnId: this.currentTurnId, textId: this.currentTextId });
			if (this.activePromptStartedAt !== undefined) {
				logOpenClawTiming(this.options, this.conversationKey, "first_text_delta", this.activePromptStartedAt, {
					deltaChars: delta.length,
				});
			}
		}
		this.assistantText += delta;
		this.currentText += delta;
		this.emit({
			type: "text_delta",
			runId: this.currentRunId,
			turnId: this.currentTurnId,
			textId: this.currentTextId,
			delta,
		});
	}

	private finishCurrentTextBlock(): void {
		if (!this.currentTextId || !this.currentRunId || !this.currentTurnId) {
			return;
		}
		this.emit({
			type: "text_finished",
			runId: this.currentRunId,
			turnId: this.currentTurnId,
			textId: this.currentTextId,
			text: this.currentText,
		});
		this.currentTextId = "";
		this.currentText = "";
	}

	private resetTextBlock(): void {
		this.textBlockIndex = 0;
		this.currentTextId = "";
		this.currentText = "";
	}

	private async waitForRun(runId: string, abort: AbortController): Promise<void> {
		if (!this.currentRunId) {
			logOpenClawTiming(this.options, this.conversationKey, "wait_skipped_after_final_event", this.activePromptStartedAt ?? Date.now(), {
				runId,
			});
			return;
		}
		const waitAbort = new AbortController();
		const wait = this.client.request(
			"agent.wait",
			{ runId, timeoutMs: 10 * 60_000 },
			10 * 60_000 + 5_000,
			{ signal: waitAbort.signal },
		).catch((error: unknown) => {
			if (waitAbort.signal.aborted) {
				return undefined;
			}
			throw error;
		});
		const abortWait = new Promise<undefined>((resolve) => abort.signal.addEventListener("abort", () => resolve(undefined), { once: true }));
		const waiters: Array<Promise<unknown>> = [wait, abortWait];
		if (this.runFinished) {
			waiters.push(this.runFinished.promise);
		}
		const result = await Promise.race(waiters);
		waitAbort.abort();
		if (abort.signal.aborted) {
			return;
		}
		if (!this.currentRunId) {
			logOpenClawTiming(this.options, this.conversationKey, "wait_unblocked_by_final_event", this.activePromptStartedAt ?? Date.now(), {
				runId,
			});
			return;
		}
		const waitResult = readRecord(result);
		const status = readString(waitResult?.status);
		const errorMessage = textFromUnknown(waitResult?.error ?? waitResult?.finalError).trim();
		if (errorMessage || status === "error" || readString(waitResult?.stopReason) === "error") {
			this.finishRun("error");
			throw new Error(errorMessage || "OpenClaw run failed.");
		}
		if (status === "aborted") {
			this.finishRun("aborted");
			return;
		}
		const waitAssistantText = extractAssistantTextFromWaitResult(waitResult);
		if (!this.assistantText.trim() && waitAssistantText && !isSilentOpenClawReplyText(waitAssistantText)) {
			this.emitTextDelta(waitAssistantText);
		}
		if (!this.assistantText.trim()) {
			await delay(300);
			if (!this.currentRunId) {
				return;
			}
			if (!this.assistantText.trim()) {
				this.finishRun("success");
				return;
			}
		}
		this.finishRun("success");
	}

	private emit(event: AgentSessionEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}

function createDeferredRunFinished(): { promise: Promise<void>; resolve: () => void } {
	let resolve: () => void = () => undefined;
	const promise = new Promise<void>((nextResolve) => {
		resolve = nextResolve;
	});
	return { promise, resolve };
}

class OpenClawSessionPool implements AgentConversationSessionPool {
	readonly capabilities = OPENCLAW_CAPABILITIES;
	private readonly client: OpenClawGatewayClient;
	private readonly sessions = new Map<string, OpenClawSession>();
	private readonly sessionNamespace: string | undefined;

	constructor(private readonly options: AgentSessionRuntimeOptions) {
		this.client = new OpenClawGatewayClient(options);
		this.sessionNamespace = options.resumeSessions ? undefined : randomUUID();
		void this.client.warmup().then(() => this.prewarmIfConfigured()).catch((error) => {
			if (options.verboseLogs || options.debug) {
				console.warn(`OpenClaw gateway warmup skipped: ${error instanceof Error ? error.message : String(error)}`);
			}
		});
	}

	async getSession(conversationKey: string): Promise<AgentConversationSession> {
		const normalizedConversationKey = normalizeConversationKey(conversationKey);
		const existing = this.sessions.get(normalizedConversationKey);
		if (existing) {
			return existing;
		}
		const session = new OpenClawSession(
			this.options,
			this.client,
			normalizedConversationKey,
			this.resolveSessionKey(normalizedConversationKey),
			this.resolveSessionLabel(normalizedConversationKey),
		);
		this.sessions.set(normalizedConversationKey, session);
		return session;
	}

	private resolveSessionKey(conversationKey: string): string {
		const base = makeSessionKey(conversationKey);
		return this.sessionNamespace ? `${base}:ephemeral:${this.sessionNamespace}` : base;
	}

	private resolveSessionLabel(conversationKey: string): string {
		return this.sessionNamespace ? `${conversationKey}:ephemeral:${this.sessionNamespace}` : conversationKey;
	}

	private async prewarmIfConfigured(): Promise<void> {
		const prompt = readOpenClawPrewarmPrompt();
		if (!isOpenClawSessionPrewarmEnabled() && !prompt) {
			return;
		}
		const startedAt = Date.now();
		const session = new OpenClawSession(this.options, this.client, OPENCLAW_WARMUP_CONVERSATION_KEY);
		try {
			await session.prepare();
			logOpenClawTiming(this.options, OPENCLAW_WARMUP_CONVERSATION_KEY, "prewarm_session_ready", startedAt);
			if (prompt) {
				await session.prompt(prompt);
				logOpenClawTiming(this.options, OPENCLAW_WARMUP_CONVERSATION_KEY, "prewarm_prompt_complete", startedAt);
			}
		} finally {
			session.dispose();
		}
	}

	async resetSession(conversationKey: string): Promise<void> {
		const normalizedConversationKey = normalizeConversationKey(conversationKey);
		const existing = this.sessions.get(normalizedConversationKey);
		if (existing?.isStreaming) {
			await existing.abort();
		}
		existing?.dispose();
		this.sessions.delete(normalizedConversationKey);
	}
}

async function checkOpenClawEnvironment(options: AgentSessionRuntimeOptions): Promise<HarnessDiagnostic> {
	const executable = resolveOpenClawCliExecutable();
	let version: string | undefined;
	if (executable) {
		try {
			const { stdout, stderr } = await execFileAsync(executable.executablePath, ["--version"], {
				env: { ...process.env, ...(executable.pathEnv ? { PATH: executable.pathEnv } : {}) },
			});
			version = (stdout || stderr).trim() || undefined;
		} catch {
			version = undefined;
		}
	}
	const client = new OpenClawGatewayClient(options);
	try {
		await client.request("health", { probe: false }, 8_000);
		client.close();
		return {
			installed: Boolean(executable),
			authenticated: true,
			executablePath: executable?.executablePath ?? resolveGatewayUrl(options),
			version,
			authMethod: resolveGatewayToken(options) ? "env" : resolveGatewayPassword(options) ? "env" : "unknown",
		};
	} catch (error) {
		client.close();
		return {
			installed: Boolean(executable),
			authenticated: false,
			executablePath: executable?.executablePath ?? resolveGatewayUrl(options),
			version,
			authMethod: resolveGatewayToken(options) || resolveGatewayPassword(options) ? "env" : "unknown",
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export const openClawAgentHarnessAdapter: AgentHarnessAdapter = {
	kind: "openclaw",
	label: "OpenClaw",
	capabilities: OPENCLAW_CAPABILITIES,
	checkEnvironment: checkOpenClawEnvironment,
	createSessionPool(options) {
		return new OpenClawSessionPool(options);
	},
	explainError(error) {
		return error instanceof Error ? error.message : String(error);
	},
};
