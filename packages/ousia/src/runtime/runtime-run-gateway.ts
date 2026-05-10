import { appendFileSync, mkdirSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { hostname } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { OUSIA_RUNTIME_SECRET_HEADER } from "./env.js";
import type { OusiaHostPaths, OusiaRunOrigin, OusiaRunRequest, OusiaRunResult } from "./types.js";

export type RuntimeRunRequest = OusiaRunRequest;
export type RuntimeRunResult = OusiaRunResult;

export interface RuntimeRunGatewayOptions {
	homeDir: string;
	hostPaths?: OusiaHostPaths;
	port: number;
	secret?: string;
	onRun: (request: RuntimeRunRequest) => Promise<RuntimeRunResult>;
	onCreateSession?: (sessionKey: string) => Promise<void>;
	onGetSessionStatus?: (sessionKey: string) => Promise<unknown>;
	onCompactSession?: (sessionKey: string) => Promise<{ summary?: string }>;
	onClearSession?: (sessionKey: string) => Promise<void>;
}

export interface RuntimeRunGatewayServer {
	start(): Promise<void>;
	stop(): Promise<void>;
}

function sendJson(res: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
	res.statusCode = statusCode;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.end(`${JSON.stringify(payload)}\n`);
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		let body = "";
		req.setEncoding("utf8");
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => resolvePromise(body));
		req.on("error", reject);
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function parseOrigin(value: unknown, fallback: OusiaRunOrigin): OusiaRunOrigin {
	return value === "human" ||
		value === "im" ||
		value === "scheduled_task" ||
		value === "cli" ||
		value === "http" ||
		value === "system" ||
		value === "peer"
		? value
		: fallback;
}

function parseRunRequest(raw: unknown, routeKind: "agent_run" | "agent_task"): RuntimeRunRequest {
	if (!isRecord(raw)) {
		throw new Error("Request body must be an object.");
	}
	if (typeof raw.sessionKey !== "string" || raw.sessionKey.trim() === "") {
		throw new Error("sessionKey is required.");
	}
	if (typeof raw.prompt !== "string" || raw.prompt.trim() === "") {
		throw new Error("prompt is required.");
	}
	return {
		sessionKey: raw.sessionKey.trim(),
		prompt: raw.prompt.trim(),
		source: typeof raw.source === "string" ? raw.source.trim() || routeKind : routeKind,
		origin: parseOrigin(raw.origin, routeKind === "agent_task" ? "scheduled_task" : "http"),
		kind: raw.kind === "agent_task" ? "agent_task" : routeKind,
		metadata: isRecord(raw.metadata) ? raw.metadata : undefined,
	};
}

function parseSessionKeyRequest(raw: unknown): string {
	if (!isRecord(raw)) {
		throw new Error("Request body must be an object.");
	}
	return typeof raw.sessionKey === "string" && raw.sessionKey.trim() ? raw.sessionKey.trim() : "desktop";
}

function parseOptionalSessionKeyRequest(raw: unknown): string {
	if (!isRecord(raw)) {
		throw new Error("Request body must be an object.");
	}
	return typeof raw.sessionKey === "string" && raw.sessionKey.trim() ? raw.sessionKey.trim() : `desktop-${randomUUID()}`;
}

export function createRuntimeRunGatewayServer(options: RuntimeRunGatewayOptions): RuntimeRunGatewayServer {
	const runtimeDir = join(options.homeDir, "runtime");
	const logPath = join(runtimeDir, "runtime-run-gateway.jsonl");
	mkdirSync(runtimeDir, { recursive: true });

	function appendEvent(event: Record<string, unknown>): void {
		appendFileSync(
			logPath,
			`${JSON.stringify({
				timestamp: new Date().toISOString(),
				source: "ousia-runtime-run-gateway",
				host: hostname(),
				...event,
			})}\n`,
			"utf8",
		);
	}

	const server: Server = createServer(async (req, res) => {
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
			if (options.secret) {
				const provided = req.headers[OUSIA_RUNTIME_SECRET_HEADER];
				if (provided !== options.secret) {
					sendJson(res, 401, { ok: false, error: "invalid secret" });
					return;
				}
			}
			const body = await readBody(req);
			const raw = body.trim() ? (JSON.parse(body) as unknown) : {};
			if (url.pathname === "/agent/session/new") {
				if (!options.onCreateSession) {
					sendJson(res, 501, { ok: false, error: "session creation is not supported" });
					return;
				}
				const sessionKey = parseOptionalSessionKeyRequest(raw);
				await options.onCreateSession(sessionKey);
				appendEvent({ type: "session_created", sessionKey });
				sendJson(res, 200, { ok: true, sessionKey });
				return;
			}
			if (url.pathname === "/agent/session/status") {
				if (!options.onGetSessionStatus) {
					sendJson(res, 501, { ok: false, error: "session status is not supported" });
					return;
				}
				const sessionKey = parseSessionKeyRequest(raw);
				const status = await options.onGetSessionStatus(sessionKey);
				sendJson(res, 200, { ok: true, sessionKey, status });
				return;
			}
			if (url.pathname === "/agent/session/compact") {
				if (!options.onCompactSession) {
					sendJson(res, 501, { ok: false, error: "session compact is not supported" });
					return;
				}
				const sessionKey = parseSessionKeyRequest(raw);
				const result = await options.onCompactSession(sessionKey);
				appendEvent({ type: "session_compacted", sessionKey });
				sendJson(res, 200, { ok: true, sessionKey, summary: result.summary });
				return;
			}
			if (url.pathname === "/agent/session/clear") {
				if (!options.onClearSession) {
					sendJson(res, 501, { ok: false, error: "session clear is not supported" });
					return;
				}
				const sessionKey = parseSessionKeyRequest(raw);
				await options.onClearSession(sessionKey);
				appendEvent({ type: "session_cleared", sessionKey });
				sendJson(res, 200, { ok: true, sessionKey });
				return;
			}
			const routeKind = url.pathname === "/agent/task" ? "agent_task" : "agent_run";
			const runRequest = parseRunRequest(raw, routeKind);
			appendEvent({
				type: "agent_run_started",
				kind: runRequest.kind,
				sessionKey: runRequest.sessionKey,
				origin: runRequest.origin,
				sourceLabel: runRequest.source,
				metadata: runRequest.metadata,
			});
			const result = await options.onRun(runRequest);
			appendEvent({
				type: "agent_run_finished",
				kind: runRequest.kind,
				sessionKey: result.sessionKey,
				origin: runRequest.origin,
				sourceLabel: runRequest.source,
				assistantText: result.assistantText,
			});
			sendJson(res, 200, {
				ok: true,
				sessionKey: result.sessionKey,
				assistantText: result.assistantText,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			appendEvent({ type: "agent_run_failed", error: message });
			sendJson(res, 500, { ok: false, error: message });
		}
	});

	return {
		start(): Promise<void> {
			return new Promise((resolvePromise, reject) => {
				server.once("error", reject);
				server.listen(options.port, "127.0.0.1", () => {
					server.off("error", reject);
					appendEvent({ type: "runtime_run_gateway_listening", port: options.port });
					resolvePromise();
				});
			});
		},
		stop(): Promise<void> {
			return new Promise((resolvePromise) => {
				let settled = false;
				const finish = (): void => {
					if (settled) {
						return;
					}
					settled = true;
					appendEvent({ type: "runtime_run_gateway_stopped" });
					resolvePromise();
				};
				server.close(finish);
				setTimeout(() => {
					try {
						(server as Server & { closeAllConnections?: () => void }).closeAllConnections?.();
					} catch {
						// ignore
					}
					finish();
				}, 1500).unref();
			});
		},
	};
}
