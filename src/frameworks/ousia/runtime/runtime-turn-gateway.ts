import { appendFileSync, mkdirSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { hostname } from "node:os";
import { join } from "node:path";
import type { AgentRuntimeEnvironment } from "../../../runtime/environment.js";
import type { AgentTurnInput, AgentTurnOutput } from "../../../runtime/types.js";

export type RuntimeTurnRequest = AgentTurnInput;
export type RuntimeTurnResult = AgentTurnOutput;

export interface RuntimeTurnGatewayOptions {
	homeDir: string;
	environment?: AgentRuntimeEnvironment;
	port: number;
	secret?: string;
	onTurn: (request: RuntimeTurnRequest) => Promise<RuntimeTurnResult>;
}

export interface RuntimeTurnGatewayServer {
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

function parseTurnRequest(raw: unknown, routeKind: "agent_turn" | "agent_task"): RuntimeTurnRequest {
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
		kind: raw.kind === "agent_task" ? "agent_task" : routeKind,
		metadata: isRecord(raw.metadata) ? raw.metadata : undefined,
	};
}

export function createRuntimeTurnGatewayServer(options: RuntimeTurnGatewayOptions): RuntimeTurnGatewayServer {
	const runtimeDir = join(options.homeDir, "runtime");
	const logPath = join(runtimeDir, "runtime-turn-gateway.jsonl");
	mkdirSync(runtimeDir, { recursive: true });

	function appendEvent(event: Record<string, unknown>): void {
		appendFileSync(
			logPath,
			`${JSON.stringify({
				timestamp: new Date().toISOString(),
				source: "ousia-runtime-turn-gateway",
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
			if (url.pathname !== "/agent/turn" && url.pathname !== "/agent/task") {
				sendJson(res, 404, { ok: false, error: "route not found" });
				return;
			}
			if (options.secret) {
				const provided =
					req.headers["x-pie-runtime-secret"] ??
					req.headers["x-pie-secret"];
				if (provided !== options.secret) {
					sendJson(res, 401, { ok: false, error: "invalid secret" });
					return;
				}
			}
			const body = await readBody(req);
			const raw = body.trim() ? (JSON.parse(body) as unknown) : {};
			const routeKind = url.pathname === "/agent/task" ? "agent_task" : "agent_turn";
			const turnRequest = parseTurnRequest(raw, routeKind);
			appendEvent({
				type: "agent_turn_start",
				kind: turnRequest.kind,
				sessionKey: turnRequest.sessionKey,
				sourceLabel: turnRequest.source,
				metadata: turnRequest.metadata,
			});
			const result = await options.onTurn(turnRequest);
			appendEvent({
				type: "agent_turn_end",
				kind: turnRequest.kind,
				sessionKey: result.sessionKey,
				sourceLabel: turnRequest.source,
				assistantText: result.assistantText,
			});
			sendJson(res, 200, {
				ok: true,
				sessionKey: result.sessionKey,
				assistantText: result.assistantText,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			appendEvent({ type: "agent_turn_error", error: message });
			sendJson(res, 500, { ok: false, error: message });
		}
	});

	return {
		start(): Promise<void> {
			return new Promise((resolvePromise, reject) => {
				server.once("error", reject);
				server.listen(options.port, "127.0.0.1", () => {
					server.off("error", reject);
					appendEvent({ type: "runtime_turn_gateway_listening", port: options.port });
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
					appendEvent({ type: "runtime_turn_gateway_stopped" });
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
