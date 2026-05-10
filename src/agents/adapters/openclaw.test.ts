import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { WebSocketServer, type WebSocket } from "ws";
import { openClawAgentHarnessAdapter } from "./openclaw.js";
import type { AgentSessionEvent } from "../types.js";

function getAvailablePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			server.close(() => {
				if (typeof address === "object" && address?.port) {
					resolve(address.port);
					return;
				}
				reject(new Error("Unable to allocate test port."));
			});
		});
	});
}

function send(socket: WebSocket, frame: unknown): void {
	socket.send(JSON.stringify(frame));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error(message)), timeoutMs);
			}),
		]);
	} finally {
		if (timer) {
			clearTimeout(timer);
		}
	}
}

describe("openClawAgentHarnessAdapter", () => {
	it("creates and sends a session through a shared gateway using the configured OpenClaw agentId", async () => {
		const port = await getAvailablePort();
		const gateway = new WebSocketServer({ host: "127.0.0.1", port });
		const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
		const sockets = new Set<WebSocket>();
		gateway.on("connection", (socket) => {
			sockets.add(socket);
			socket.once("close", () => sockets.delete(socket));
			send(socket, { type: "event", event: "connect.challenge", payload: { nonce: "test-nonce" } });
			socket.on("message", (raw) => {
				const request = JSON.parse(raw.toString("utf8")) as { id: string; method: string; params?: Record<string, unknown> };
				requests.push({ method: request.method, params: request.params ?? {} });
				if (request.method === "connect") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { connected: true } });
					return;
				}
				if (request.method === "sessions.create") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { key: request.params?.key } });
					return;
				}
				if (request.method === "sessions.messages.subscribe") {
					send(socket, { type: "res", id: request.id, ok: true, payload: {} });
					return;
				}
				if (request.method === "sessions.send") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { runId: "run-1" } });
					return;
				}
				if (request.method === "agent.wait") {
					send(socket, {
						type: "event",
						event: "session.message",
						payload: {
							sessionKey: request.params?.key,
							runId: "run-1",
							state: "final",
							message: { role: "assistant", content: "done" },
						},
					});
					send(socket, { type: "res", id: request.id, ok: true, payload: { status: "success" } });
				}
			});
		});
		try {
			const pool = openClawAgentHarnessAdapter.createSessionPool({
				harnessKind: "openclaw",
				harnessConfig: {
					gatewayUrl: `ws://127.0.0.1:${port}`,
					agentId: "pie-alpha",
					modelRef: "kimi-coding/k2p5",
				},
				homeDir: "/tmp/pie-openclaw-test",
				modelId: "kimi-coding/k2p5",
				thinkingLevel: "off",
				tools: [],
				debug: false,
				verboseLogs: false,
				resumeSessions: true,
			});
			const session = await pool.getSession("chat-a");
			const events: AgentSessionEvent[] = [];
			session.subscribe((event) => events.push(event));
			await session.prompt("hello");

			const create = requests.find((request) => request.method === "sessions.create");
			assert.equal(create?.params.agentId, "pie-alpha");
			assert.equal(create?.params.model, "kimi-coding/k2p5");
			assert.equal(requests.some((request) => request.method === "sessions.send"), true);
			assert.equal(events.find((event) => event.type === "agent_run_finished")?.finalText, "done");
		} finally {
			for (const socket of sockets) {
				socket.close();
			}
			await new Promise<void>((resolve) => gateway.close(() => resolve()));
		}
	});

	it("finishes a prompt from the final session.message event even when agent.wait stays pending", async () => {
		const port = await getAvailablePort();
		const gateway = new WebSocketServer({ host: "127.0.0.1", port });
		const sockets = new Set<WebSocket>();
		let createdKey = "";
		let waitObserved = false;
		gateway.on("connection", (socket) => {
			sockets.add(socket);
			socket.once("close", () => sockets.delete(socket));
			send(socket, { type: "event", event: "connect.challenge", payload: { nonce: "test-nonce" } });
			socket.on("message", (raw) => {
				const request = JSON.parse(raw.toString("utf8")) as { id: string; method: string; params?: Record<string, unknown> };
				if (request.method === "connect") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { connected: true } });
					return;
				}
				if (request.method === "sessions.create") {
					createdKey = String(request.params?.key ?? "");
					send(socket, { type: "res", id: request.id, ok: true, payload: { key: createdKey } });
					return;
				}
				if (request.method === "sessions.messages.subscribe") {
					send(socket, { type: "res", id: request.id, ok: true, payload: {} });
					return;
				}
				if (request.method === "sessions.send") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { runId: "run-1" } });
					return;
				}
				if (request.method === "agent.wait") {
					waitObserved = true;
					send(socket, {
						type: "event",
						event: "session.message",
						payload: {
							sessionKey: createdKey,
							runId: "run-1",
							state: "final",
							message: { role: "assistant", content: "done from event" },
						},
					});
				}
			});
		});
		try {
			const pool = openClawAgentHarnessAdapter.createSessionPool({
				harnessKind: "openclaw",
				harnessConfig: {
					gatewayUrl: `ws://127.0.0.1:${port}`,
				},
				homeDir: "/tmp/pie-openclaw-test",
				modelId: "kimi-coding/k2p5",
				thinkingLevel: "off",
				tools: [],
				debug: false,
				verboseLogs: false,
				resumeSessions: true,
			});
			const session = await pool.getSession("chat-a");
			const events: AgentSessionEvent[] = [];
			session.subscribe((event) => events.push(event));
			await withTimeout(session.prompt("hello"), 500, "prompt did not finish from final session.message");

			assert.equal(waitObserved, true);
			assert.equal(events.find((event) => event.type === "agent_run_finished")?.finalText, "done from event");
		} finally {
			for (const socket of sockets) {
				socket.close();
			}
			await new Promise<void>((resolve) => gateway.close(() => resolve()));
		}
	});

	it("reconnects when the shared OpenClaw gateway restarts", async () => {
		const port = await getAvailablePort();
		const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
		const startGateway = (): { gateway: WebSocketServer; sockets: Set<WebSocket> } => {
			const gateway = new WebSocketServer({ host: "127.0.0.1", port });
			const sockets = new Set<WebSocket>();
			gateway.on("connection", (socket) => {
				sockets.add(socket);
				socket.once("close", () => sockets.delete(socket));
				send(socket, { type: "event", event: "connect.challenge", payload: { nonce: "test-nonce" } });
				socket.on("message", (raw) => {
					const request = JSON.parse(raw.toString("utf8")) as { id: string; method: string; params?: Record<string, unknown> };
					requests.push({ method: request.method, params: request.params ?? {} });
					if (request.method === "connect") {
						send(socket, { type: "res", id: request.id, ok: true, payload: { connected: true } });
						return;
					}
					if (request.method === "sessions.create") {
						send(socket, { type: "res", id: request.id, ok: true, payload: { key: request.params?.key } });
						return;
					}
					if (request.method === "sessions.messages.subscribe") {
						send(socket, { type: "res", id: request.id, ok: true, payload: {} });
						return;
					}
					if (request.method === "sessions.send") {
						send(socket, { type: "res", id: request.id, ok: true, payload: { runId: String(request.params?.key) } });
						return;
					}
					if (request.method === "agent.wait") {
						send(socket, { type: "res", id: request.id, ok: true, payload: { status: "success", message: { role: "assistant", content: "done" } } });
					}
				});
			});
			return { gateway, sockets };
		};
		let current = startGateway();
		const closeCurrentGateway = async (): Promise<void> => {
			for (const socket of current.sockets) {
				socket.close();
			}
			await new Promise<void>((resolve) => current.gateway.close(() => resolve()));
		};
		try {
			const pool = openClawAgentHarnessAdapter.createSessionPool({
				harnessKind: "openclaw",
				harnessConfig: {
					gatewayUrl: `ws://127.0.0.1:${port}`,
				},
				homeDir: "/tmp/pie-openclaw-test",
				modelId: "kimi-coding/k2p5",
				thinkingLevel: "off",
				tools: [],
				debug: false,
				verboseLogs: false,
				resumeSessions: true,
			});
			await (await pool.getSession("chat-a")).prompt("before restart");
			await closeCurrentGateway();
			current = startGateway();
			await (await pool.getSession("chat-b")).prompt("after restart");

			assert.equal(requests.filter((request) => request.method === "connect").length, 2);
			assert.equal(requests.filter((request) => request.method === "sessions.send").length, 2);
		} finally {
			await closeCurrentGateway().catch(() => undefined);
		}
	});

	it("uses the local OpenClaw gateway token when connecting to an existing token-protected gateway", async () => {
		const port = await getAvailablePort();
		const gateway = new WebSocketServer({ host: "127.0.0.1", port });
		const sockets = new Set<WebSocket>();
		const tempDir = await mkdtemp(join(tmpdir(), "pie-openclaw-config-"));
		const configPath = join(tempDir, "openclaw.json");
		const previousConfigPath = process.env.OPENCLAW_CONFIG_PATH;
		let connectAuthToken: unknown;
		await writeFile(configPath, JSON.stringify({
			gateway: {
				auth: {
					mode: "token",
					token: "test-token",
				},
			},
		}), "utf8");
		process.env.OPENCLAW_CONFIG_PATH = configPath;
		gateway.on("connection", (socket) => {
			sockets.add(socket);
			socket.once("close", () => sockets.delete(socket));
			send(socket, { type: "event", event: "connect.challenge", payload: { nonce: "test-nonce" } });
			socket.on("message", (raw) => {
				const request = JSON.parse(raw.toString("utf8")) as { id: string; method: string; params?: Record<string, unknown> };
				if (request.method === "connect") {
					connectAuthToken = (request.params?.auth as { token?: unknown } | undefined)?.token;
					send(socket, { type: "res", id: request.id, ok: true, payload: { connected: true } });
					return;
				}
				if (request.method === "sessions.create") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { key: request.params?.key } });
					return;
				}
				if (request.method === "sessions.messages.subscribe") {
					send(socket, { type: "res", id: request.id, ok: true, payload: {} });
					return;
				}
				if (request.method === "sessions.send") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { runId: "run-1" } });
					return;
				}
				if (request.method === "agent.wait") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { status: "success", message: { role: "assistant", content: "done" } } });
				}
			});
		});
		try {
			const pool = openClawAgentHarnessAdapter.createSessionPool({
				harnessKind: "openclaw",
				harnessConfig: {
					gatewayUrl: `ws://127.0.0.1:${port}`,
				},
				homeDir: "/tmp/pie-openclaw-test",
				modelId: "kimi-coding/k2p5",
				thinkingLevel: "off",
				tools: [],
				debug: false,
				verboseLogs: false,
				resumeSessions: true,
			});
			const session = await pool.getSession("chat-a");
			await session.prompt("hello");

			assert.equal(connectAuthToken, "test-token");
		} finally {
			if (previousConfigPath === undefined) {
				delete process.env.OPENCLAW_CONFIG_PATH;
			} else {
				process.env.OPENCLAW_CONFIG_PATH = previousConfigPath;
			}
			for (const socket of sockets) {
				socket.close();
			}
			await new Promise<void>((resolve) => gateway.close(() => resolve()));
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	it("steers active runs through chat.send without interrupting the original prompt run", async () => {
		const port = await getAvailablePort();
		const gateway = new WebSocketServer({ host: "127.0.0.1", port });
		const sockets = new Set<WebSocket>();
		let waitRequestId: string | undefined;
		let resolveWaitObserved: (() => void) | undefined;
		const waitObserved = new Promise<void>((resolve) => {
			resolveWaitObserved = resolve;
		});
		gateway.on("connection", (socket) => {
			sockets.add(socket);
			socket.once("close", () => sockets.delete(socket));
			send(socket, { type: "event", event: "connect.challenge", payload: { nonce: "test-nonce" } });
			socket.on("message", (raw) => {
				const request = JSON.parse(raw.toString("utf8")) as { id: string; method: string; params?: Record<string, unknown> };
				if (request.method === "connect") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { connected: true } });
					return;
				}
				if (request.method === "sessions.create") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { key: request.params?.key } });
					return;
				}
				if (request.method === "sessions.messages.subscribe") {
					send(socket, { type: "res", id: request.id, ok: true, payload: {} });
					return;
				}
				if (request.method === "sessions.send") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { runId: "run-1" } });
					return;
				}
				if (request.method === "chat.send") {
					assert.equal(request.params?.deliver, false);
					send(socket, { type: "res", id: request.id, ok: true, payload: { runId: "run-2" } });
					setTimeout(() => {
						send(socket, {
								type: "event",
								event: "session.message",
								payload: {
									sessionKey: request.params?.key,
									runId: "run-2",
									state: "final",
									message: { role: "assistant", content: "steered result" },
								},
							});
						if (waitRequestId) {
							send(socket, { type: "res", id: waitRequestId, ok: true, payload: { status: "success" } });
						}
					}, 0);
					return;
				}
				if (request.method === "agent.wait") {
					waitRequestId = request.id;
					resolveWaitObserved?.();
				}
			});
		});
		try {
			const pool = openClawAgentHarnessAdapter.createSessionPool({
				harnessKind: "openclaw",
				harnessConfig: {
					gatewayUrl: `ws://127.0.0.1:${port}`,
				},
				homeDir: "/tmp/pie-openclaw-test",
				modelId: "kimi-coding/k2p5",
				thinkingLevel: "off",
				tools: [],
				debug: false,
				verboseLogs: false,
				resumeSessions: true,
			});
			const session = await pool.getSession("chat-a");
			const events: AgentSessionEvent[] = [];
			session.subscribe((event) => events.push(event));
			const prompt = session.prompt("hello");
			await waitObserved;
			await session.steer?.("extra context");
			await prompt;

			assert.equal(events.find((event) => event.type === "agent_run_finished")?.finalText, "steered result");
		} finally {
			for (const socket of sockets) {
				socket.close();
			}
			await new Promise<void>((resolve) => gateway.close(() => resolve()));
		}
	});

	it("uses assistant text returned by agent.wait when no message event is emitted", async () => {
		const port = await getAvailablePort();
		const gateway = new WebSocketServer({ host: "127.0.0.1", port });
		const sockets = new Set<WebSocket>();
		gateway.on("connection", (socket) => {
			sockets.add(socket);
			socket.once("close", () => sockets.delete(socket));
			send(socket, { type: "event", event: "connect.challenge", payload: { nonce: "test-nonce" } });
			socket.on("message", (raw) => {
				const request = JSON.parse(raw.toString("utf8")) as { id: string; method: string; params?: Record<string, unknown> };
				if (request.method === "connect") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { connected: true } });
					return;
				}
				if (request.method === "sessions.create") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { key: request.params?.key } });
					return;
				}
				if (request.method === "sessions.messages.subscribe") {
					send(socket, { type: "res", id: request.id, ok: true, payload: {} });
					return;
				}
				if (request.method === "sessions.send") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { runId: "run-1" } });
					return;
				}
				if (request.method === "agent.wait") {
					send(socket, {
						type: "res",
						id: request.id,
						ok: true,
						payload: {
							status: "success",
							message: { role: "assistant", content: "wait result" },
						},
					});
				}
			});
		});
		try {
			const pool = openClawAgentHarnessAdapter.createSessionPool({
				harnessKind: "openclaw",
				harnessConfig: {
					gatewayUrl: `ws://127.0.0.1:${port}`,
				},
				homeDir: "/tmp/pie-openclaw-test",
				modelId: "kimi-coding/k2p5",
				thinkingLevel: "off",
				tools: [],
				debug: false,
				verboseLogs: false,
				resumeSessions: true,
			});
			const session = await pool.getSession("chat-a");
			const events: AgentSessionEvent[] = [];
			session.subscribe((event) => events.push(event));
			await session.prompt("hello");

			assert.equal(events.find((event) => event.type === "agent_run_finished")?.finalText, "wait result");
		} finally {
			for (const socket of sockets) {
				socket.close();
			}
			await new Promise<void>((resolve) => gateway.close(() => resolve()));
		}
	});

	it("uses agent.wait assistant text after an empty final session message", async () => {
		const port = await getAvailablePort();
		const gateway = new WebSocketServer({ host: "127.0.0.1", port });
		const sockets = new Set<WebSocket>();
		gateway.on("connection", (socket) => {
			sockets.add(socket);
			socket.once("close", () => sockets.delete(socket));
			send(socket, { type: "event", event: "connect.challenge", payload: { nonce: "test-nonce" } });
			socket.on("message", (raw) => {
				const request = JSON.parse(raw.toString("utf8")) as { id: string; method: string; params?: Record<string, unknown> };
				if (request.method === "connect") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { connected: true } });
					return;
				}
				if (request.method === "sessions.create") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { key: request.params?.key } });
					return;
				}
				if (request.method === "sessions.messages.subscribe") {
					send(socket, { type: "res", id: request.id, ok: true, payload: {} });
					return;
				}
				if (request.method === "sessions.send") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { runId: "run-1" } });
					return;
				}
				if (request.method === "agent.wait") {
					send(socket, {
						type: "event",
						event: "session.message",
						payload: {
							sessionKey: request.params?.key,
							runId: "run-1",
							state: "final",
							message: { role: "assistant", content: "" },
						},
					});
					send(socket, {
						type: "res",
						id: request.id,
						ok: true,
						payload: {
							status: "success",
							message: { role: "assistant", content: "wait result after empty final" },
						},
					});
				}
			});
		});
		try {
			const pool = openClawAgentHarnessAdapter.createSessionPool({
				harnessKind: "openclaw",
				harnessConfig: {
					gatewayUrl: `ws://127.0.0.1:${port}`,
				},
				homeDir: "/tmp/pie-openclaw-test",
				modelId: "kimi-coding/k2p5",
				thinkingLevel: "off",
				tools: [],
				debug: false,
				verboseLogs: false,
				resumeSessions: true,
			});
			const session = await pool.getSession("chat-a");
			const events: AgentSessionEvent[] = [];
			session.subscribe((event) => events.push(event));
			await session.prompt("hello");

			assert.equal(events.find((event) => event.type === "agent_run_finished")?.finalText, "wait result after empty final");
		} finally {
			for (const socket of sockets) {
				socket.close();
			}
			await new Promise<void>((resolve) => gateway.close(() => resolve()));
		}
	});

	it("reconnects and retries once when the gateway rejects a stale socket handshake", async () => {
		const port = await getAvailablePort();
		const gateway = new WebSocketServer({ host: "127.0.0.1", port });
		const sockets = new Set<WebSocket>();
		let createAttempts = 0;
		gateway.on("connection", (socket) => {
			sockets.add(socket);
			socket.once("close", () => sockets.delete(socket));
			send(socket, { type: "event", event: "connect.challenge", payload: { nonce: "test-nonce" } });
			socket.on("message", (raw) => {
				const request = JSON.parse(raw.toString("utf8")) as { id: string; method: string; params?: Record<string, unknown> };
				if (request.method === "connect") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { connected: true } });
					return;
				}
				if (request.method === "sessions.create") {
					createAttempts += 1;
					if (createAttempts === 1) {
						send(socket, {
							type: "res",
							id: request.id,
							ok: false,
							error: { message: "invalid handshake: first request must be connect" },
						});
						return;
					}
					send(socket, { type: "res", id: request.id, ok: true, payload: { key: request.params?.key } });
					return;
				}
				if (request.method === "sessions.messages.subscribe") {
					send(socket, { type: "res", id: request.id, ok: true, payload: {} });
					return;
				}
				if (request.method === "sessions.send") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { runId: "run-1" } });
					return;
				}
				if (request.method === "agent.wait") {
					send(socket, {
						type: "res",
						id: request.id,
						ok: true,
						payload: {
							status: "success",
							message: { role: "assistant", content: "reconnected" },
						},
					});
				}
			});
		});
		try {
			const pool = openClawAgentHarnessAdapter.createSessionPool({
				harnessKind: "openclaw",
				harnessConfig: {
					gatewayUrl: `ws://127.0.0.1:${port}`,
				},
				homeDir: "/tmp/pie-openclaw-test",
				modelId: "kimi-coding/k2p5",
				thinkingLevel: "off",
				tools: [],
				debug: false,
				verboseLogs: false,
				resumeSessions: true,
			});
			const session = await pool.getSession("chat-a");
			const events: AgentSessionEvent[] = [];
			session.subscribe((event) => events.push(event));
			await session.prompt("hello");

			assert.equal(createAttempts, 2);
			assert.equal(events.find((event) => event.type === "agent_run_finished")?.finalText, "reconnected");
		} finally {
			for (const socket of sockets) {
				socket.close();
			}
			await new Promise<void>((resolve) => gateway.close(() => resolve()));
		}
	});

	it("treats OpenClaw NO_REPLY as a silent assistant reply", async () => {
		const port = await getAvailablePort();
		const gateway = new WebSocketServer({ host: "127.0.0.1", port });
		const sockets = new Set<WebSocket>();
		gateway.on("connection", (socket) => {
			sockets.add(socket);
			socket.once("close", () => sockets.delete(socket));
			send(socket, { type: "event", event: "connect.challenge", payload: { nonce: "test-nonce" } });
			socket.on("message", (raw) => {
				const request = JSON.parse(raw.toString("utf8")) as { id: string; method: string; params?: Record<string, unknown> };
				if (request.method === "connect") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { connected: true } });
					return;
				}
				if (request.method === "sessions.create") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { key: request.params?.key } });
					return;
				}
				if (request.method === "sessions.messages.subscribe") {
					send(socket, { type: "res", id: request.id, ok: true, payload: {} });
					return;
				}
				if (request.method === "sessions.send") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { runId: "run-1" } });
					return;
				}
				if (request.method === "agent.wait") {
					send(socket, {
						type: "event",
						event: "session.message",
						payload: {
							sessionKey: request.params?.key,
							runId: "run-1",
							state: "final",
							message: { role: "assistant", content: "NO_REPLY" },
						},
					});
					send(socket, { type: "res", id: request.id, ok: true, payload: { status: "success" } });
				}
			});
		});
		try {
			const pool = openClawAgentHarnessAdapter.createSessionPool({
				harnessKind: "openclaw",
				harnessConfig: {
					gatewayUrl: `ws://127.0.0.1:${port}`,
				},
				homeDir: "/tmp/pie-openclaw-test",
				modelId: "kimi-coding/k2p5",
				thinkingLevel: "off",
				tools: [],
				debug: false,
				verboseLogs: false,
				resumeSessions: true,
			});
			const session = await pool.getSession("chat-a");
			const events: AgentSessionEvent[] = [];
			session.subscribe((event) => events.push(event));
			await session.prompt("hello");

			assert.equal(events.find((event) => event.type === "agent_run_finished")?.finalText, "");
			assert.equal(events.some((event) => event.type === "text_delta"), false);
		} finally {
			for (const socket of sockets) {
				socket.close();
			}
			await new Promise<void>((resolve) => gateway.close(() => resolve()));
		}
	});

	it("treats an empty successful OpenClaw run as a silent assistant reply", async () => {
		const port = await getAvailablePort();
		const gateway = new WebSocketServer({ host: "127.0.0.1", port });
		const sockets = new Set<WebSocket>();
		gateway.on("connection", (socket) => {
			sockets.add(socket);
			socket.once("close", () => sockets.delete(socket));
			send(socket, { type: "event", event: "connect.challenge", payload: { nonce: "test-nonce" } });
			socket.on("message", (raw) => {
				const request = JSON.parse(raw.toString("utf8")) as { id: string; method: string; params?: Record<string, unknown> };
				if (request.method === "connect") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { connected: true } });
					return;
				}
				if (request.method === "sessions.create") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { key: request.params?.key } });
					return;
				}
				if (request.method === "sessions.messages.subscribe") {
					send(socket, { type: "res", id: request.id, ok: true, payload: {} });
					return;
				}
				if (request.method === "sessions.send") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { runId: "run-1" } });
					return;
				}
				if (request.method === "agent.wait") {
					send(socket, {
						type: "event",
						event: "session.message",
						payload: {
							sessionKey: request.params?.key,
							runId: "run-1",
							state: "final",
							message: { role: "assistant", content: "" },
						},
					});
					send(socket, { type: "res", id: request.id, ok: true, payload: { status: "success" } });
				}
			});
		});
		try {
			const pool = openClawAgentHarnessAdapter.createSessionPool({
				harnessKind: "openclaw",
				harnessConfig: {
					gatewayUrl: `ws://127.0.0.1:${port}`,
				},
				homeDir: "/tmp/pie-openclaw-test",
				modelId: "kimi-coding/k2p5",
				thinkingLevel: "off",
				tools: [],
				debug: false,
				verboseLogs: false,
				resumeSessions: true,
			});
			const session = await pool.getSession("chat-a");
			const events: AgentSessionEvent[] = [];
			session.subscribe((event) => events.push(event));
			await session.prompt("hello");

			assert.equal(events.find((event) => event.type === "agent_run_finished")?.finalText, "");
			assert.equal(events.find((event) => event.type === "turn_finished")?.status, "success");
			assert.equal(events.some((event) => event.type === "text_delta"), false);
		} finally {
			for (const socket of sockets) {
				socket.close();
			}
			await new Promise<void>((resolve) => gateway.close(() => resolve()));
		}
	});

	it("reuses a persistent session when OpenClaw reports the label already exists", async () => {
		const port = await getAvailablePort();
		const gateway = new WebSocketServer({ host: "127.0.0.1", port });
		const sockets = new Set<WebSocket>();
		const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
		gateway.on("connection", (socket) => {
			sockets.add(socket);
			socket.once("close", () => sockets.delete(socket));
			send(socket, { type: "event", event: "connect.challenge", payload: { nonce: "test-nonce" } });
			socket.on("message", (raw) => {
				const request = JSON.parse(raw.toString("utf8")) as { id: string; method: string; params?: Record<string, unknown> };
				requests.push({ method: request.method, params: request.params ?? {} });
				if (request.method === "connect") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { connected: true } });
					return;
				}
				if (request.method === "sessions.create") {
					send(socket, {
						type: "res",
						id: request.id,
						ok: false,
						error: { message: "label already in use: chat-a" },
					});
					return;
				}
				if (request.method === "sessions.messages.subscribe") {
					send(socket, { type: "res", id: request.id, ok: true, payload: {} });
					return;
				}
				if (request.method === "sessions.send") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { runId: "run-1" } });
					return;
				}
				if (request.method === "agent.wait") {
					send(socket, {
						type: "res",
						id: request.id,
						ok: true,
						payload: {
							status: "success",
							message: { role: "assistant", content: "resumed" },
						},
					});
				}
			});
		});
		try {
			const pool = openClawAgentHarnessAdapter.createSessionPool({
				harnessKind: "openclaw",
				harnessConfig: {
					gatewayUrl: `ws://127.0.0.1:${port}`,
				},
				homeDir: "/tmp/pie-openclaw-test",
				modelId: "kimi-coding/k2p5",
				thinkingLevel: "off",
				tools: [],
				debug: false,
				verboseLogs: false,
				resumeSessions: true,
			});
			const session = await pool.getSession("chat-a");
			const events: AgentSessionEvent[] = [];
			session.subscribe((event) => events.push(event));
			await session.prompt("hello again");

			assert.equal(requests.find((request) => request.method === "sessions.create")?.params.key, "pie:chat-a");
			assert.equal(requests.find((request) => request.method === "sessions.messages.subscribe")?.params.key, "pie:chat-a");
			assert.equal(requests.find((request) => request.method === "sessions.send")?.params.key, "pie:chat-a");
			assert.equal(events.find((event) => event.type === "agent_run_finished")?.finalText, "resumed");
		} finally {
			for (const socket of sockets) {
				socket.close();
			}
			await new Promise<void>((resolve) => gateway.close(() => resolve()));
		}
	});

	it("uses a fresh OpenClaw session key for ephemeral session pools", async () => {
		const port = await getAvailablePort();
		const gateway = new WebSocketServer({ host: "127.0.0.1", port });
		const sockets = new Set<WebSocket>();
		const createdKeys: string[] = [];
		const createdLabels: string[] = [];
		gateway.on("connection", (socket) => {
			sockets.add(socket);
			socket.once("close", () => sockets.delete(socket));
			send(socket, { type: "event", event: "connect.challenge", payload: { nonce: "test-nonce" } });
			socket.on("message", (raw) => {
				const request = JSON.parse(raw.toString("utf8")) as { id: string; method: string; params?: Record<string, unknown> };
				if (request.method === "connect") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { connected: true } });
					return;
				}
				if (request.method === "sessions.create") {
					createdKeys.push(String(request.params?.key ?? ""));
					createdLabels.push(String(request.params?.label ?? ""));
					send(socket, { type: "res", id: request.id, ok: true, payload: { key: request.params?.key } });
					return;
				}
				if (request.method === "sessions.messages.subscribe") {
					send(socket, { type: "res", id: request.id, ok: true, payload: {} });
					return;
				}
				if (request.method === "sessions.send") {
					send(socket, { type: "res", id: request.id, ok: true, payload: { runId: `run-${createdKeys.length}` } });
					return;
				}
				if (request.method === "agent.wait") {
					send(socket, {
						type: "res",
						id: request.id,
						ok: true,
						payload: {
							status: "success",
							message: { role: "assistant", content: "ok" },
						},
					});
				}
			});
		});
		const baseOptions = {
			harnessKind: "openclaw" as const,
			harnessConfig: {
				gatewayUrl: `ws://127.0.0.1:${port}`,
			},
			homeDir: "/tmp/pie-openclaw-test",
			modelId: "kimi-coding/k2p5",
			thinkingLevel: "off" as const,
			tools: [],
			debug: false,
			verboseLogs: false,
		};
		try {
			const firstPool = openClawAgentHarnessAdapter.createSessionPool({ ...baseOptions, resumeSessions: false });
			const secondPool = openClawAgentHarnessAdapter.createSessionPool({ ...baseOptions, resumeSessions: false });
			await (await firstPool.getSession("chat-a")).prompt("hello");
			await (await secondPool.getSession("chat-a")).prompt("hello");

			assert.equal(createdKeys.length, 2);
			assert.notEqual(createdKeys[0], createdKeys[1]);
			assert.equal(createdKeys.every((key) => key.startsWith("pie:chat-a:ephemeral:")), true);
			assert.equal(createdLabels.length, 2);
			assert.notEqual(createdLabels[0], createdLabels[1]);
			assert.equal(createdLabels.every((label) => label.startsWith("chat-a:ephemeral:")), true);
		} finally {
			for (const socket of sockets) {
				socket.close();
			}
			await new Promise<void>((resolve) => gateway.close(() => resolve()));
		}
	});
});
