import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ensureOpenClawModelState, normalizeOpenClawModelRef, toOpenClawModelRef } from "../openclaw-models.js";
import type {
	AgentHarnessManagedServiceManager,
	AgentHarnessManagedServiceManagerOptions,
} from "../harness-service.js";

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isManagedDisabled(value: unknown): boolean {
	if (typeof value === "boolean") {
		return !value;
	}
	if (typeof value !== "string") {
		return false;
	}
	return ["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function parseGatewayPort(gatewayUrl: string | undefined): number {
	const raw = gatewayUrl?.trim() || "ws://127.0.0.1:18789";
	try {
		const url = new URL(raw.startsWith("ws://") || raw.startsWith("wss://") ? raw : `ws://${raw}`);
		const port = Number.parseInt(url.port, 10);
		return Number.isFinite(port) ? port : 18789;
	} catch {
		return 18789;
	}
}

function canConnect(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = net.createConnection({ host: "127.0.0.1", port });
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("error", () => resolve(false));
		socket.setTimeout(500, () => {
			socket.destroy();
			resolve(false);
		});
	});
}

function stripAnsiControlSequences(text: string): string {
	return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

async function waitForPort(port: number, timeoutMs = 90_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastError = "";
	while (Date.now() < deadline) {
		try {
			if (await canConnect(port)) {
				return;
			}
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`OpenClaw gateway did not listen on 127.0.0.1:${port}${lastError ? `: ${lastError}` : ""}`);
}

function pipePrefixedLogs(
	stream: NodeJS.ReadableStream | null,
	target: NodeJS.WritableStream,
	prefix: string,
	onLine?: (line: string) => void,
): void {
	if (!stream) {
		return;
	}
	let buffer = "";
	stream.on("data", (chunk: Buffer | string) => {
		buffer += chunk.toString();
		const lines = buffer.split(/\r?\n/);
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			const cleanLine = stripAnsiControlSequences(line);
			if (cleanLine.trim()) {
				onLine?.(cleanLine);
				target.write(`${prefix}${cleanLine}\n`);
			}
		}
	});
}

export function createOpenClawServiceProcessManager(
	options: AgentHarnessManagedServiceManagerOptions,
): AgentHarnessManagedServiceManager {
	let child: ChildProcess | undefined;
	const config = options.config ?? {};
	const gatewayUrl = asString(config.gatewayUrl) ?? process.env.OPENCLAW_GATEWAY_URL?.trim() ?? "ws://127.0.0.1:18789";
	const port = parseGatewayPort(gatewayUrl);
	const command = asString(config.command) ?? process.env.OPENCLAW_COMMAND?.trim() ?? "openclaw";
	const managedDisabled = isManagedDisabled(config.managed) || isManagedDisabled(process.env.OPENCLAW_MANAGED);
	const stateDir = process.env.OPENCLAW_STATE_DIR || join(options.homeDir, "openclaw", "state");
	const modelRef =
		normalizeOpenClawModelRef(asString(config.model) ?? asString(config.modelRef) ?? process.env.PIE_OPENCLAW_MODEL?.trim()) ??
		toOpenClawModelRef(options.model?.provider, options.model?.model);

	const stop = (): void => {
		if (!child) {
			return;
		}
		child.kill("SIGTERM");
		child = undefined;
	};

	return {
		async start(): Promise<void> {
			if (managedDisabled || !command) {
				return;
			}
			mkdirSync(join(options.homeDir, "runtime"), { recursive: true });
			ensureOpenClawModelState(stateDir, modelRef);
			const env = {
				...process.env,
				PIE_AGENT_HOME: options.homeDir,
				OPENCLAW_STATE_DIR: stateDir,
			};
			if (await canConnect(port)) {
				console.log(`OpenClaw gateway already reachable at ${gatewayUrl}`);
				return;
			}
			child = spawn(command, ["gateway", "run", "--allow-unconfigured", "--auth", "none", "--port", String(port), "--ws-log", "compact"], {
				cwd: options.environment.workDir,
				env,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let sawGatewayReady = false;
			const waitForGatewayReady = new Promise<void>((resolve) => {
				const markReady = (line: string) => {
					if (sawGatewayReady) {
						return;
					}
					if (
						line.includes("[gateway] ready") ||
						line.includes("[gateway] listening on") ||
						line.includes("[gateway] http server listening")
					) {
						sawGatewayReady = true;
						resolve();
					}
				};
				pipePrefixedLogs(child?.stdout ?? null, process.stdout, "[openclaw] ", markReady);
				pipePrefixedLogs(child?.stderr ?? null, process.stdout, "[openclaw] ", markReady);
				setTimeout(resolve, 30_000);
			});
			child.on("exit", () => {
				child = undefined;
			});
			child.on("error", (error) => {
				console.error(`OpenClaw gateway failed to start: ${error.message}`);
				child = undefined;
			});
			await waitForPort(port);
			await waitForGatewayReady;
			console.log(`OpenClaw gateway ready at ${gatewayUrl}`);
		},
		stop,
	};
}
