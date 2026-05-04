import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import WebSocket from "ws";
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
	const config = options.backendConfig ?? {};
	return asGatewayUrl(readString(config.gatewayUrl) ?? readString(config.url) ?? process.env.OPENCLAW_GATEWAY_URL);
}

function resolveGatewayToken(options: AgentSessionRuntimeOptions): string | undefined {
	const config = options.backendConfig ?? {};
	return readString(config.token) ?? (process.env.OPENCLAW_GATEWAY_TOKEN?.trim() || undefined);
}

function resolveGatewayPassword(options: AgentSessionRuntimeOptions): string | undefined {
	const config = options.backendConfig ?? {};
	return readString(config.password) ?? (process.env.OPENCLAW_GATEWAY_PASSWORD?.trim() || undefined);
}

function resolveAgentId(options: AgentSessionRuntimeOptions): string | undefined {
	const config = options.backendConfig ?? {};
	return readString(config.agentId) ?? (process.env.OPENCLAW_AGENT_ID?.trim() || undefined);
}

function resolveModelRef(options: AgentSessionRuntimeOptions): string | undefined {
	const config = options.backendConfig ?? {};
	const configuredModel = readString(config.model) ?? readString(config.modelRef) ?? (process.env.PIE_OPENCLAW_MODEL?.trim() || undefined);
	if (configuredModel) {
		return configuredModel;
	}
	if (options.modelId?.trim()) {
		return options.modelId.trim();
	}
	const provider = typeof options.model?.provider === "string" ? options.model.provider.trim() : "";
	const modelId = typeof options.model?.id === "string" ? options.model.id.trim() : "";
	if (provider && modelId) {
		return `${provider}/${modelId}`;
	}
	return modelId || undefined;
}

function isUnknownModelError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /unknown model|model_not_found/i.test(message);
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

function makeRpcError(error: OpenClawRpcError | undefined): Error {
	const message = readString(error?.message) ?? readString(error?.code) ?? "OpenClaw gateway request failed.";
	const details = error?.details ? ` ${JSON.stringify(error.details)}` : "";
	return new Error(`${message}${details}`);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
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

	async request(method: string, params: Record<string, unknown>, timeoutMs = 30_000): Promise<unknown> {
		await this.ensureConnected();
		const socket = this.socket;
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			throw new Error("OpenClaw gateway is not connected.");
		}
		const id = randomUUID();
		return await new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`OpenClaw gateway request timed out: ${method}`));
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			socket.send(JSON.stringify({ type: "req", id, method, params }));
		});
	}

	async warmup(retryForMs = 120_000): Promise<void> {
		const deadline = Date.now() + retryForMs;
		let lastError: unknown;
		while (Date.now() < deadline) {
			try {
				await this.ensureConnected();
				return;
			} catch (error) {
				lastError = error;
				await delay(1_000);
			}
		}
		throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "OpenClaw gateway warmup failed."));
	}

	close(): void {
		for (const [id, pending] of this.pending) {
			clearTimeout(pending.timer);
			pending.reject(new Error(`OpenClaw gateway request cancelled: ${id}`));
		}
		this.pending.clear();
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
	private canonicalSessionKey?: string;
	private unsubscribeGatewayEvents?: () => void;
	private activeRunId?: string;
	private activeAbort?: AbortController;
	private roundIndex = 0;
	private turnIndex = 0;
	private currentRoundId = "";
	private currentTurnId = "";
	private assistantText = "";
	private textStarted = false;
	private toolIds = new Set<string>();

	constructor(
		private readonly options: AgentSessionRuntimeOptions,
		private readonly client: OpenClawGatewayClient,
		private readonly conversationKey: string,
	) {
		this.sessionKey = makeSessionKey(conversationKey);
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

	async prompt(input: AgentRoundInputLike): Promise<void> {
		const prompt = getAgentRoundInputText(input).trim();
		if (!prompt) {
			throw new Error("Prompt is empty.");
		}
		if (this.activeAbort) {
			throw new Error("OpenClaw turn is already running.");
		}
		await this.ensureSession();
		this.state.messages.push({ role: "user", content: prompt });
		this.startRound();
		const abort = new AbortController();
		this.activeAbort = abort;
		try {
			const response = await this.client.request("sessions.send", {
				key: this.canonicalSessionKey ?? this.sessionKey,
				message: prompt,
				thinking: this.options.thinkingLevel === "off" ? undefined : this.options.thinkingLevel,
				idempotencyKey: randomUUID(),
			});
			const sendResponse = readRecord(response);
			this.activeRunId = readString(sendResponse?.runId);
			if (this.activeRunId) {
				await this.waitForRun(this.activeRunId, abort);
			} else {
				const errorMessage = textFromUnknown(sendResponse?.error ?? sendResponse?.runError).trim();
				this.finishRound("error");
				throw new Error(errorMessage || "OpenClaw did not start a run.");
			}
		} catch (error) {
			if (abort.signal.aborted) {
				this.finishRound("aborted");
				return;
			}
			this.finishRound("error");
			throw error;
		} finally {
			if (this.activeAbort === abort) {
				this.activeAbort = undefined;
				this.activeRunId = undefined;
			}
		}
	}

	async steer(text: string): Promise<void> {
		const prompt = text.trim();
		if (!prompt) {
			throw new Error("Prompt is empty.");
		}
		await this.ensureSession();
		this.state.messages.push({ role: "user", content: prompt });
		const response = await this.client.request("sessions.steer", {
			key: this.canonicalSessionKey ?? this.sessionKey,
			message: prompt,
			idempotencyKey: randomUUID(),
		});
		this.activeRunId = readString(readRecord(response)?.runId) ?? this.activeRunId;
	}

	async abort(): Promise<void> {
		this.activeAbort?.abort();
		await this.client.request("sessions.abort", {
			key: this.canonicalSessionKey ?? this.sessionKey,
			...(this.activeRunId ? { runId: this.activeRunId } : {}),
		}).catch(() => undefined);
	}

	private async ensureSession(): Promise<void> {
		if (this.canonicalSessionKey) {
			return;
		}
		const modelRef = resolveModelRef(this.options);
		const createParams = {
			key: this.sessionKey,
			label: this.conversationKey,
			...(resolveAgentId(this.options) ? { agentId: resolveAgentId(this.options) } : {}),
			...(modelRef ? { model: modelRef } : {}),
		};
		let created: unknown;
		try {
			created = await this.client.request("sessions.create", createParams, 120_000);
		} catch (error) {
			if (!modelRef || !isUnknownModelError(error)) {
				throw error;
			}
			console.warn(`OpenClaw model ${modelRef} is not available; retrying with the OpenClaw default model.`);
			const { model: _model, ...defaultModelParams } = createParams;
			created = await this.client.request("sessions.create", defaultModelParams, 120_000);
		}
		this.canonicalSessionKey = readString(readRecord(created)?.key) ?? this.sessionKey;
		await this.client.request("sessions.messages.subscribe", { key: this.canonicalSessionKey });
		this.unsubscribeGatewayEvents = this.client.onEvent((frame) => this.handleGatewayEvent(frame));
	}

	private startRound(): void {
		this.roundIndex += 1;
		this.turnIndex += 1;
		this.currentRoundId = `round_${this.roundIndex}`;
		this.currentTurnId = `turn_${this.turnIndex}`;
		this.assistantText = "";
		this.textStarted = false;
		this.toolIds.clear();
		this.emit({ type: "round_started", roundId: this.currentRoundId });
		this.emit({ type: "turn_started", roundId: this.currentRoundId, turnId: this.currentTurnId, index: this.turnIndex });
	}

	private finishRound(status: "success" | "error" | "aborted"): void {
		if (!this.currentRoundId || !this.currentTurnId) {
			return;
		}
		if (!this.textStarted) {
			this.emit({ type: "text_start", roundId: this.currentRoundId, turnId: this.currentTurnId, textId: "text_0" });
		}
		this.emit({
			type: "text_finished",
			roundId: this.currentRoundId,
			turnId: this.currentTurnId,
			textId: "text_0",
			text: this.assistantText,
		});
		const assistantMessage = { role: "assistant", content: this.assistantText };
		this.state.messages.push(assistantMessage);
		this.emit({ type: "turn_finished", roundId: this.currentRoundId, turnId: this.currentTurnId, status });
		this.emit({ type: "round_finished", roundId: this.currentRoundId, status, finalText: this.assistantText });
		this.currentRoundId = "";
		this.currentTurnId = "";
		this.activeAbort = undefined;
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
		if (runId && this.activeRunId && runId !== this.activeRunId) {
			return;
		}
		const state = readString(record.state);
		if (state === "error") {
			this.finishRound("error");
			return;
		}
		if (state === "aborted") {
			this.finishRound("aborted");
			return;
		}
		const message = readRecord(record.message);
		const role = readString(message?.role);
		const text = extractMessageText(record.message);
		if (!text || !this.currentRoundId || !this.currentTurnId) {
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
			this.finishRound("success");
		}
	}

	private handleSessionTool(payload: unknown): void {
		const record = readRecord(payload);
		if (!record || !this.currentRoundId || !this.currentTurnId) {
			return;
		}
		const runId = readString(record.runId);
		if (runId && this.activeRunId && runId !== this.activeRunId) {
			return;
		}
		const data = readRecord(record.data) ?? record;
		const phase = readString(data.phase) ?? readString(record.phase);
		const name = readString(data.name) ?? readString(data.toolName) ?? readString(record.toolName) ?? "tool";
		const toolCallId = readString(data.id) ?? readString(record.id) ?? `${name}:${readString(record.runId) ?? this.turnIndex}`;
		if (phase === "start" || !this.toolIds.has(toolCallId)) {
			this.toolIds.add(toolCallId);
			this.emit({
				type: "tool_call_started",
				roundId: this.currentRoundId,
				turnId: this.currentTurnId,
				toolCallId,
				name,
				args: data.args ?? data.input,
			});
			return;
		}
		if (phase === "end" || phase === "finish" || phase === "finished") {
			this.emit({
				type: "tool_call_finished",
				roundId: this.currentRoundId,
				turnId: this.currentTurnId,
				toolCallId,
				name,
				result: data.result ?? data.output,
				isError: Boolean(data.error ?? record.error),
			});
			return;
		}
		this.emit({
			type: "tool_call_updated",
			roundId: this.currentRoundId,
			turnId: this.currentTurnId,
			toolCallId,
			name,
			args: data.args ?? data.input,
			partialResult: data.result ?? data.output ?? data,
		});
	}

	private emitTextDelta(delta: string): void {
		if (!this.currentRoundId || !this.currentTurnId) {
			return;
		}
		if (!delta) {
			return;
		}
		if (!this.textStarted) {
			this.textStarted = true;
			this.emit({ type: "text_start", roundId: this.currentRoundId, turnId: this.currentTurnId, textId: "text_0" });
		}
		this.assistantText += delta;
		this.emit({
			type: "text_delta",
			roundId: this.currentRoundId,
			turnId: this.currentTurnId,
			textId: "text_0",
			delta,
		});
	}

	private async waitForRun(runId: string, abort: AbortController): Promise<void> {
		const wait = this.client.request("agent.wait", { runId, timeoutMs: 10 * 60_000 }, 10 * 60_000 + 5_000);
		const abortWait = new Promise<undefined>((resolve) => abort.signal.addEventListener("abort", () => resolve(undefined), { once: true }));
		const result = await Promise.race([wait, abortWait]);
		if (abort.signal.aborted) {
			return;
		}
		const waitResult = readRecord(result);
		const status = readString(waitResult?.status);
		const errorMessage = textFromUnknown(waitResult?.error ?? waitResult?.finalError).trim();
		if (!this.currentRoundId) {
			return;
		}
		if (errorMessage || status === "error" || readString(waitResult?.stopReason) === "error") {
			this.finishRound("error");
			throw new Error(errorMessage || "OpenClaw run failed.");
		}
		if (status === "aborted") {
			this.finishRound("aborted");
			return;
		}
		if (!this.assistantText.trim()) {
			await delay(300);
			if (!this.currentRoundId) {
				return;
			}
			if (!this.assistantText.trim()) {
				this.finishRound("error");
				throw new Error("OpenClaw run finished without assistant text.");
			}
		}
		this.finishRound("success");
	}

	private emit(event: AgentSessionEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}

class OpenClawSessionPool implements AgentConversationSessionPool {
	readonly capabilities = OPENCLAW_CAPABILITIES;
	private readonly client: OpenClawGatewayClient;
	private readonly sessions = new Map<string, OpenClawSession>();

	constructor(private readonly options: AgentSessionRuntimeOptions) {
		this.client = new OpenClawGatewayClient(options);
		void this.client.warmup().catch((error) => {
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
		const session = new OpenClawSession(this.options, this.client, normalizedConversationKey);
		this.sessions.set(normalizedConversationKey, session);
		return session;
	}

	async resetSession(conversationKey: string): Promise<void> {
		const normalizedConversationKey = normalizeConversationKey(conversationKey);
		const existing = this.sessions.get(normalizedConversationKey);
		if (existing?.isStreaming) {
			await existing.abort();
		}
		this.sessions.delete(normalizedConversationKey);
	}
}

async function resolveOpenClawExecutable(): Promise<string | undefined> {
	for (const command of ["openclaw"]) {
		try {
			const { stdout } = await execFileAsync("which", [command]);
			const path = stdout.trim();
			if (path) {
				return path;
			}
		} catch {
			// Try the next candidate.
		}
	}
	return undefined;
}

async function checkOpenClawEnvironment(options: AgentSessionRuntimeOptions): Promise<BackendDiagnostic> {
	const executablePath = await resolveOpenClawExecutable();
	let version: string | undefined;
	if (executablePath) {
		try {
			const { stdout, stderr } = await execFileAsync(executablePath, ["--version"]);
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
			installed: Boolean(executablePath),
			authenticated: true,
			executablePath: executablePath ?? resolveGatewayUrl(options),
			version,
			authMethod: resolveGatewayToken(options) ? "env" : resolveGatewayPassword(options) ? "env" : "unknown",
		};
	} catch (error) {
		client.close();
		return {
			installed: Boolean(executablePath),
			authenticated: false,
			executablePath: executablePath ?? resolveGatewayUrl(options),
			version,
			authMethod: resolveGatewayToken(options) || resolveGatewayPassword(options) ? "env" : "unknown",
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export const openClawAgentBackendAdapter: AgentBackendAdapter = {
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
