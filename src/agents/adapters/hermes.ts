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

interface HermesChatCompletionResponse {
	choices?: Array<{
		message?: {
			content?: unknown;
		};
		text?: unknown;
	}>;
	usage?: {
		prompt_tokens?: unknown;
		completion_tokens?: unknown;
		total_tokens?: unknown;
	};
}

interface HermesRunStartResponse {
	run_id?: unknown;
	status?: unknown;
}

interface HermesRunEvent {
	sseEvent?: string;
	event?: unknown;
	run_id?: unknown;
	delta?: unknown;
	output?: unknown;
	usage?: unknown;
	tool?: unknown;
	preview?: unknown;
	label?: unknown;
	status?: unknown;
	error?: unknown;
	duration?: unknown;
	text?: unknown;
}

interface HermesChatStreamChunk {
	choices?: Array<{
		delta?: {
			content?: unknown;
		};
		finish_reason?: unknown;
	}>;
	usage?: unknown;
}

const HERMES_CAPABILITIES: AgentSessionCapabilities = {
	supportsSteering: false,
	supportsInterrupt: true,
	supportsStreamingEvents: true,
	supportsSessionPersistence: true,
	supportsToolEvents: true,
};

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveEndpoint(options: AgentSessionRuntimeOptions): string {
	const config = options.backendConfig ?? {};
	return (
		asString(config.endpoint) ??
		process.env.HERMES_ENDPOINT?.trim() ??
		`http://127.0.0.1:${process.env.API_SERVER_PORT?.trim() || process.env.HERMES_PORT?.trim() || "8642"}`
	).replace(/\/+$/, "");
}

function resolveTurnPath(options: AgentSessionRuntimeOptions): string {
	const config = options.backendConfig ?? {};
	const path = asString(config.turnPath) ?? process.env.HERMES_TURN_PATH?.trim() ?? "/v1/chat/completions";
	return path.startsWith("/") ? path : `/${path}`;
}

function resolveRunPath(options: AgentSessionRuntimeOptions): string {
	const config = options.backendConfig ?? {};
	const path = asString(config.runPath) ?? process.env.HERMES_RUN_PATH?.trim() ?? "/v1/runs";
	return path.startsWith("/") ? path : `/${path}`;
}

function resolveRunEventsPath(options: AgentSessionRuntimeOptions, runId: string): string {
	const config = options.backendConfig ?? {};
	const path = asString(config.runEventsPath) ?? process.env.HERMES_RUN_EVENTS_PATH?.trim();
	if (path) {
		return (path.startsWith("/") ? path : `/${path}`).replace("{run_id}", encodeURIComponent(runId));
	}
	return `${resolveRunPath(options).replace(/\/+$/, "")}/${encodeURIComponent(runId)}/events`;
}

function resolveHealthPath(options: AgentSessionRuntimeOptions): string {
	const config = options.backendConfig ?? {};
	const path = asString(config.healthPath) ?? process.env.HERMES_HEALTH_PATH?.trim() ?? "/health";
	return path.startsWith("/") ? path : `/${path}`;
}

function resolveApiKey(options: AgentSessionRuntimeOptions): string | undefined {
	const config = options.backendConfig ?? {};
	return asString(config.apiKey) ?? process.env.API_SERVER_KEY?.trim() ?? process.env.HERMES_API_SERVER_KEY?.trim() ?? undefined;
}

function useChatCompletionsTransport(options: AgentSessionRuntimeOptions): boolean {
	const config = options.backendConfig ?? {};
	return asString(config.transport) === "chat_completions";
}

function extractAssistantText(response: HermesChatCompletionResponse): string {
	const first = response.choices?.[0];
	const value = first?.message?.content ?? first?.text;
	if (typeof value === "string") {
		return value;
	}
	if (value == null) {
		return "";
	}
	return JSON.stringify(value);
}

async function readErrorText(response: Response): Promise<string> {
	const text = await response.text().catch(() => "");
	return text.trim() || `${response.status} ${response.statusText}`.trim();
}

function authHeaders(options: AgentSessionRuntimeOptions): Record<string, string> {
	const apiKey = resolveApiKey(options);
	return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

function textFromUnknown(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (value == null) {
		return "";
	}
	return JSON.stringify(value);
}

function stripMarkdownCode(text: string): string {
	const trimmed = text.trim();
	if (trimmed.startsWith("`") && trimmed.endsWith("`") && trimmed.length > 1) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

function parseHermesToolDisplayLine(line: string): { toolName: string; args: Record<string, unknown> } | undefined {
	const normalized = line.trim();
	const match = normalized.match(/^(?:[💻🖥️]\s*)+(.+)$/u);
	if (!match) {
		return undefined;
	}
	const command = stripMarkdownCode(match[1] ?? "");
	if (!command) {
		return undefined;
	}
	return { toolName: "bash", args: { command } };
}

function routeHermesAssistantDelta(
	delta: string,
	onText: (text: string) => void,
	onTool: (tool: { toolName: string; args: Record<string, unknown> }) => void,
): string {
	let assistantDelta = "";
	const parts = delta.split(/(\r?\n)/);
	for (let index = 0; index < parts.length; index += 1) {
		const part = parts[index] ?? "";
		if (!part || part === "\n" || part === "\r\n") {
			assistantDelta += part;
			continue;
		}
		const tool = parseHermesToolDisplayLine(part);
		if (tool) {
			onTool(tool);
			const next = parts[index + 1];
			if (next === "\n" || next === "\r\n") {
				index += 1;
			}
			continue;
		}
		assistantDelta += part;
	}
	if (assistantDelta) {
		onText(assistantDelta);
	}
	return assistantDelta;
}

function parseSseEvents(buffer: string): { events: HermesRunEvent[]; rest: string } {
	const events: HermesRunEvent[] = [];
	const normalized = buffer.replace(/\r\n/g, "\n");
	const parts = normalized.split("\n\n");
	const rest = parts.pop() ?? "";
	for (const part of parts) {
		let sseEvent: string | undefined;
		const dataLines: string[] = [];
		for (const line of part.split("\n")) {
			if (line.startsWith("event:")) {
				sseEvent = line.slice("event:".length).trim();
			}
			if (line.startsWith("data:")) {
				dataLines.push(line.slice("data:".length).trim());
			}
		}
		const data = dataLines.join("\n");
		if (!data) {
			continue;
		}
		if (data === "[DONE]") {
			events.push({ sseEvent, event: "done" });
			continue;
		}
		try {
			events.push({ sseEvent, ...(JSON.parse(data) as HermesRunEvent) });
		} catch {
			// Keep malformed SSE payloads out of the agent event stream.
		}
	}
	return { events, rest };
}

class HermesSession implements AgentConversationSession {
	readonly capabilities = HERMES_CAPABILITIES;
	readonly state: { messages: unknown[] } = { messages: [] };
	private readonly listeners = new Set<(event: AgentSessionEvent) => void>();
	private readonly emittedToolStarts = new Set<string>();
	private activeAbort?: AbortController;
	private activeRunId?: string;

	constructor(
		private readonly options: AgentSessionRuntimeOptions,
		private readonly conversationKey: string,
	) {}

	get isStreaming(): boolean {
		return Boolean(this.activeAbort);
	}

	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private emit(event: Record<string, unknown>): void {
		for (const listener of this.listeners) {
			listener(event as AgentSessionEvent);
		}
	}

	private emitToolStart(toolName: string, args: Record<string, unknown>): void {
		const key = `${toolName}:${textFromUnknown(args.command ?? args.preview ?? args.label)}`;
		if (this.emittedToolStarts.has(key)) {
			return;
		}
		this.emittedToolStarts.add(key);
		this.emit({ type: "tool_execution_start", toolName, args });
	}

	async abort(): Promise<void> {
		this.activeAbort?.abort();
		if (this.activeRunId) {
			await this.stopRun(this.activeRunId).catch(() => undefined);
		}
		this.activeAbort = undefined;
		this.activeRunId = undefined;
	}

	async prompt(input: AgentRoundInputLike): Promise<void> {
		const prompt = getAgentRoundInputText(input).trim();
		if (!prompt) {
			throw new Error("Prompt is empty.");
		}
		if (this.activeAbort) {
			throw new Error("Hermes turn is already running.");
		}
		this.emittedToolStarts.clear();
		this.state.messages.push({ role: "user", content: prompt });

		const abort = new AbortController();
		this.activeAbort = abort;
		try {
			if (useChatCompletionsTransport(this.options)) {
				await this.promptViaChatCompletions(prompt, abort);
			} else {
				await this.promptViaRunEvents(prompt, abort);
			}
		} finally {
			if (this.activeAbort === abort) {
				this.activeAbort = undefined;
				this.activeRunId = undefined;
			}
		}
	}

	private conversationHistory(): Array<{ role: string; content: string }> {
		return this.state.messages.slice(0, -1).flatMap((message) => {
			if (!message || typeof message !== "object") {
				return [];
			}
			const role = (message as { role?: unknown }).role;
			if (role !== "user" && role !== "assistant") {
				return [];
			}
			const content = textFromUnknown((message as { content?: unknown }).content).trim();
			return content ? [{ role, content }] : [];
		});
	}

	private async promptViaRunEvents(prompt: string, abort: AbortController): Promise<void> {
		const endpoint = resolveEndpoint(this.options);
		const response = await fetch(`${endpoint}${resolveRunPath(this.options)}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				...authHeaders(this.options),
			},
			body: JSON.stringify({
				model: this.options.modelId || "hermes-agent",
				input: prompt,
				session_id: this.conversationKey,
				conversation_history: this.conversationHistory(),
				...(this.options.assistantSystemPrompt ? { instructions: this.options.assistantSystemPrompt } : {}),
			}),
			signal: abort.signal,
		});
		if (!response.ok) {
			if (response.status === 404) {
				await this.promptViaChatCompletions(prompt, abort);
				return;
			}
			throw new Error(`Hermes run failed to start: ${await readErrorText(response)}`);
		}
		const started = (await response.json().catch(() => ({}))) as HermesRunStartResponse;
		const runId = asString(started.run_id);
		if (!runId) {
			throw new Error("Hermes run failed to start: missing run_id.");
		}
		this.activeRunId = runId;
		await this.consumeRunEvents(runId, abort);
	}

	private async consumeRunEvents(runId: string, abort: AbortController): Promise<void> {
		const response = await fetch(`${resolveEndpoint(this.options)}${resolveRunEventsPath(this.options, runId)}`, {
			method: "GET",
			headers: authHeaders(this.options),
			signal: abort.signal,
		});
		if (!response.ok || !response.body) {
			throw new Error(`Hermes run event stream failed: ${await readErrorText(response)}`);
		}
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		let assistantText = "";
		let usage: unknown;
		let sawMessageStart = false;
		let sawTextDelta = false;
		const emitMessageStart = (): void => {
			if (sawMessageStart) {
				return;
			}
			sawMessageStart = true;
			this.emit({ type: "message_start", message: { role: "assistant", content: "" } });
		};
		try {
			for (;;) {
				const { value, done } = await reader.read();
				if (done) {
					break;
				}
				buffer += decoder.decode(value, { stream: true });
				const parsed = parseSseEvents(buffer);
				buffer = parsed.rest;
				for (const event of parsed.events) {
					const eventType = asString(event.event);
					if (eventType === "message.delta") {
						const delta = textFromUnknown(event.delta);
						if (delta) {
								emitMessageStart();
								sawTextDelta = true;
								const assistantDelta = routeHermesAssistantDelta(
									delta,
									(textDelta) => this.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: textDelta } }),
									(tool) => this.emitToolStart(tool.toolName, tool.args),
								);
								assistantText += assistantDelta;
							}
						} else if (eventType === "tool.started") {
							this.emitToolStart(
								asString(event.tool) ?? "tool",
								event.preview || event.label ? { preview: event.preview, label: event.label } : {},
							);
					} else if (eventType === "tool.completed") {
						this.emit({
							type: "tool_execution_end",
							toolName: asString(event.tool) ?? "tool",
							result: { duration: event.duration },
							isError: Boolean(event.error),
						});
					} else if (eventType === "run.completed") {
						assistantText = textFromUnknown(event.output) || assistantText;
						usage = event.usage;
					} else if (eventType === "run.failed") {
						throw new Error(textFromUnknown(event.error) || "Hermes run failed.");
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
		emitMessageStart();
		const assistantMessage = { role: "assistant", content: assistantText, ...(usage ? { usage } : {}) };
		if (assistantText && !sawTextDelta) {
			this.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: assistantText } });
		}
		this.emit({ type: "message_update", assistantMessageEvent: { type: "text_end", content: assistantText } });
		this.state.messages.push(assistantMessage);
		this.emit({ type: "message_end", message: assistantMessage });
	}

	private async promptViaChatCompletions(prompt: string, abort: AbortController): Promise<void> {
		const response = await fetch(`${resolveEndpoint(this.options)}${resolveTurnPath(this.options)}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				...authHeaders(this.options),
				"X-Hermes-Session-Id": this.conversationKey,
			},
			body: JSON.stringify({
				model: this.options.modelId || "hermes-agent",
				stream: true,
				messages: [
					...(this.options.assistantSystemPrompt
						? [{ role: "system", content: this.options.assistantSystemPrompt }]
						: []),
					...this.conversationHistory(),
					{ role: "user", content: prompt },
				],
			}),
			signal: abort.signal,
		});
		if (!response.ok) {
			throw new Error(`Hermes turn failed: ${await readErrorText(response)}`);
		}
		if (response.body && response.headers.get("content-type")?.includes("text/event-stream")) {
			await this.consumeChatCompletionEvents(response, abort);
			return;
		}
		const result = (await response.json().catch(() => ({}))) as HermesChatCompletionResponse;
		const assistantText = extractAssistantText(result);
		const assistantMessage = { role: "assistant", content: assistantText };
		this.emit({ type: "message_start", message: assistantMessage });
		if (assistantText) {
			this.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: assistantText } });
			this.emit({ type: "message_update", assistantMessageEvent: { type: "text_end", content: assistantText } });
		}
		this.state.messages.push(assistantMessage);
		this.emit({ type: "message_end", message: assistantMessage });
	}

	private async consumeChatCompletionEvents(response: Response, abort: AbortController): Promise<void> {
		if (!response.body) {
			throw new Error("Hermes streaming response had no body.");
		}
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		let assistantText = "";
		let usage: unknown;
		let sawMessageStart = false;
		const emitMessageStart = (): void => {
			if (sawMessageStart) {
				return;
			}
			sawMessageStart = true;
			this.emit({ type: "message_start", message: { role: "assistant", content: "" } });
		};
		try {
			for (;;) {
				if (abort.signal.aborted) {
					break;
				}
				const { value, done } = await reader.read();
				if (done) {
					break;
				}
				buffer += decoder.decode(value, { stream: true });
				const parsed = parseSseEvents(buffer);
				buffer = parsed.rest;
				for (const event of parsed.events) {
					if (event.sseEvent === "hermes.tool.progress") {
						const toolName = asString(event.tool) ?? "tool";
							const status = asString(event.status);
							if (status === "running") {
								this.emitToolStart(
									toolName,
									event.preview || event.label ? { preview: event.preview, label: event.label } : {},
								);
						} else if (status === "completed") {
							this.emit({
								type: "tool_execution_end",
								toolName,
								result: {},
								isError: Boolean(event.error),
							});
						}
						continue;
					}
					if (event.event === "done") {
						continue;
					}
					const chunk = event as HermesChatStreamChunk;
					const delta = textFromUnknown(chunk.choices?.[0]?.delta?.content);
					if (delta) {
							emitMessageStart();
							const assistantDelta = routeHermesAssistantDelta(
								delta,
								(textDelta) => this.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: textDelta } }),
								(tool) => this.emitToolStart(tool.toolName, tool.args),
							);
							assistantText += assistantDelta;
					}
					if (chunk.usage) {
						usage = chunk.usage;
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
		emitMessageStart();
		const assistantMessage = { role: "assistant", content: assistantText, ...(usage ? { usage } : {}) };
		this.emit({ type: "message_update", assistantMessageEvent: { type: "text_end", content: assistantText } });
		this.state.messages.push(assistantMessage);
		this.emit({ type: "message_end", message: assistantMessage });
	}

	private async stopRun(runId: string): Promise<void> {
		await fetch(`${resolveEndpoint(this.options)}${resolveRunPath(this.options).replace(/\/+$/, "")}/${encodeURIComponent(runId)}/stop`, {
			method: "POST",
			headers: authHeaders(this.options),
		});
	}
}

class HermesSessionPool implements AgentConversationSessionPool {
	readonly capabilities = HERMES_CAPABILITIES;
	private readonly sessions = new Map<string, HermesSession>();

	constructor(private readonly options: AgentSessionRuntimeOptions) {}

	async getSession(conversationKey: string): Promise<AgentConversationSession> {
		const existing = this.sessions.get(conversationKey);
		if (existing) {
			return existing;
		}
		const session = new HermesSession(this.options, conversationKey);
		this.sessions.set(conversationKey, session);
		return session;
	}
}

export const hermesAgentBackendAdapter: AgentBackendAdapter = {
	kind: "hermes",
	label: "Hermes",
	capabilities: HERMES_CAPABILITIES,
	async checkEnvironment(options): Promise<BackendDiagnostic> {
		const endpoint = resolveEndpoint(options);
		try {
			const apiKey = resolveApiKey(options);
			const response = await fetch(`${endpoint}${resolveHealthPath(options)}`, {
				method: "GET",
				headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
			});
			return {
				installed: response.ok,
				authenticated: response.ok,
				executablePath: endpoint,
				error: response.ok ? undefined : await readErrorText(response),
			};
		} catch (error) {
			return {
				installed: false,
				authenticated: false,
				executablePath: endpoint,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	},
	createSessionPool(options) {
		return new HermesSessionPool(options);
	},
	explainError(error) {
		return error instanceof Error ? error.message : String(error);
	},
};
