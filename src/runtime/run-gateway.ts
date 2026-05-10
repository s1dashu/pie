import { createServer, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { AgentRunInput, AgentRunOutput } from "./types.js";
import type { AgentSessionStatus } from "./types.js";

export interface RuntimeRunGatewayOptions {
	port: number;
	secret?: string;
	onRun: (request: AgentRunInput) => Promise<AgentRunOutput>;
	onCreateSession?: (sessionKey: string) => Promise<void>;
	onGetSessionStatus?: (sessionKey: string) => Promise<AgentSessionStatus>;
	onCompactSession?: (sessionKey: string) => Promise<{ summary?: string }>;
	onClearSession?: (sessionKey: string) => Promise<void>;
}

export interface RuntimeRunGatewayServer {
	start(): Promise<void>;
	stop(): Promise<void>;
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
	res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(payload));
}

function readBody(req: NodeJS.ReadableStream): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = "";
		req.setEncoding("utf8");
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => resolve(body));
		req.on("error", reject);
	});
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseRunRequest(raw: unknown, routeKind: AgentRunInput["kind"]): AgentRunInput {
	const record = readRecord(raw);
	const prompt = readString(record.prompt);
	if (!prompt) {
		throw new Error("prompt is required");
	}
	return {
		sessionKey: readString(record.sessionKey) ?? "desktop",
		prompt,
		source: readString(record.source) ?? "desktop",
		origin: "human",
		kind: routeKind,
		metadata: readRecord(record.metadata),
	};
}

function parseSessionKeyRequest(raw: unknown): string {
	const record = readRecord(raw);
	return readString(record.sessionKey) ?? "desktop";
}

function parseOptionalSessionKeyRequest(raw: unknown): string {
	const record = readRecord(raw);
	return readString(record.sessionKey) ?? `desktop-${randomUUID()}`;
}

export function createRuntimeRunGatewayServer(options: RuntimeRunGatewayOptions): RuntimeRunGatewayServer {
	const server = createServer(async (req, res) => {
		try {
			if ((req.method ?? "GET").toUpperCase() !== "POST") {
				sendJson(res, 405, { ok: false, error: "only POST supported" });
				return;
			}
			const url = new URL(req.url ?? "/", "http://127.0.0.1");
			if (
				url.pathname !== "/agent/run" &&
				url.pathname !== "/agent/task" &&
				url.pathname !== "/agent/session/new" &&
				url.pathname !== "/agent/session/status" &&
				url.pathname !== "/agent/session/compact" &&
				url.pathname !== "/agent/session/clear"
			) {
				sendJson(res, 404, { ok: false, error: "route not found" });
				return;
			}
			if (options.secret && req.headers["x-pie-runtime-secret"] !== options.secret) {
				sendJson(res, 401, { ok: false, error: "invalid secret" });
				return;
			}
			const raw = await readBody(req);
			if (url.pathname === "/agent/session/new") {
				if (!options.onCreateSession) {
					sendJson(res, 501, { ok: false, error: "session creation is not supported" });
					return;
				}
				const sessionKey = parseOptionalSessionKeyRequest(raw.trim() ? JSON.parse(raw) as unknown : {});
				await options.onCreateSession(sessionKey);
				sendJson(res, 200, { ok: true, sessionKey });
				return;
			}
			if (url.pathname === "/agent/session/status") {
				if (!options.onGetSessionStatus) {
					sendJson(res, 501, { ok: false, error: "session status is not supported" });
					return;
				}
				const sessionKey = parseSessionKeyRequest(raw.trim() ? JSON.parse(raw) as unknown : {});
				const status = await options.onGetSessionStatus(sessionKey);
				sendJson(res, 200, { ok: true, sessionKey, status });
				return;
			}
			if (url.pathname === "/agent/session/compact") {
				if (!options.onCompactSession) {
					sendJson(res, 501, { ok: false, error: "session compact is not supported" });
					return;
				}
				const sessionKey = parseSessionKeyRequest(raw.trim() ? JSON.parse(raw) as unknown : {});
				const result = await options.onCompactSession(sessionKey);
				sendJson(res, 200, { ok: true, sessionKey, summary: result.summary });
				return;
			}
			if (url.pathname === "/agent/session/clear") {
				if (!options.onClearSession) {
					sendJson(res, 501, { ok: false, error: "session clear is not supported" });
					return;
				}
				const sessionKey = parseSessionKeyRequest(raw.trim() ? JSON.parse(raw) as unknown : {});
				await options.onClearSession(sessionKey);
				sendJson(res, 200, { ok: true, sessionKey });
				return;
			}
			const routeKind = url.pathname === "/agent/task" ? "agent_task" : "agent_run";
			const request = parseRunRequest(raw.trim() ? JSON.parse(raw) as unknown : {}, routeKind);
			const result = await options.onRun(request);
			sendJson(res, 200, { ok: true, sessionKey: result.sessionKey, assistantText: result.assistantText });
		} catch (error) {
			sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
		}
	});
	return {
		start(): Promise<void> {
			return new Promise((resolve, reject) => {
				server.once("error", reject);
				server.listen(options.port, "127.0.0.1", () => {
					server.off("error", reject);
					resolve();
				});
			});
		},
		stop(): Promise<void> {
			return new Promise((resolve) => {
				server.close(() => resolve());
			});
		},
	};
}
