import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import { readOpenClawGatewaySettings } from "../openclaw-models.js";
import { appendStartupSpan, type StartupSpanEvent } from "../../core/startup-spans.js";
import type {
	AgentHarnessManagedServiceManager,
	AgentHarnessManagedServiceManagerOptions,
} from "../harness-service.js";
import {
	asString,
	isManagedDisabled,
	pipePrefixedLogs,
	getOpenClawCliCandidatePaths,
	resolveNodeCliLaunchCommand,
	resolveOpenClawExecutable,
	stopManagedChildProcess,
	waitForLocalPort,
} from "./managed-process.js";

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

function shouldForwardOpenClawStartupLog(line: string): boolean {
	const lower = line.toLowerCase();
	return (
		line.includes("[gateway] ready") ||
		line.includes("[gateway] listening on") ||
		line.includes("[gateway] http server listening") ||
		lower.includes("error") ||
		lower.includes("failed") ||
		lower.includes("warn")
	);
}

export async function isOpenClawGatewayReachable(gatewayUrl: string, timeoutMs = 2_000): Promise<boolean> {
	return new Promise((resolve) => {
		let settled = false;
		let socket: WebSocket;
		try {
			socket = new WebSocket(gatewayUrl);
		} catch {
			resolve(false);
			return;
		}
		const finish = (reachable: boolean): void => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			socket.close();
			resolve(reachable);
		};
		const timer = setTimeout(() => finish(false), timeoutMs);
		socket.once("message", (data) => {
			try {
				const parsed = JSON.parse(data.toString()) as { type?: unknown; event?: unknown };
				finish(parsed.type === "event" && parsed.event === "connect.challenge");
			} catch {
				finish(false);
			}
		});
		socket.once("error", () => finish(false));
		socket.once("close", () => finish(false));
	});
}

export function createOpenClawServiceProcessManager(
	options: AgentHarnessManagedServiceManagerOptions,
): AgentHarnessManagedServiceManager {
	let child: ChildProcess | undefined;
	let stopped = false;
	let stopWaiters: Array<() => void> = [];
	const config = options.config ?? {};
	const gatewaySettings = readOpenClawGatewaySettings({
		stateDir: asString(config.stateDir),
		configPath: asString(config.configPath),
		gatewayUrl: asString(config.gatewayUrl) ?? process.env.OPENCLAW_GATEWAY_URL?.trim(),
	});
	const gatewayUrl = gatewaySettings.gatewayUrl;
	const port = parseGatewayPort(gatewayUrl);
	const configuredCommand = asString(config.command) ?? process.env.OPENCLAW_COMMAND?.trim();
	const command = configuredCommand ?? resolveOpenClawExecutable()?.executablePath ?? "openclaw";
	const managedDisabled = isManagedDisabled(config.managed) || isManagedDisabled(process.env.OPENCLAW_MANAGED);

	const stop = async (): Promise<void> => {
		stopped = true;
		if (!child) {
			for (const resolveStop of stopWaiters) {
				resolveStop();
			}
			stopWaiters = [];
			return;
		}
		const stoppingChild = child;
		child = undefined;
		await stopManagedChildProcess(stoppingChild);
		for (const resolveStop of stopWaiters) {
			resolveStop();
		}
		stopWaiters = [];
	};
	const waitForStop = (): Promise<void> => {
		if (stopped) {
			return Promise.resolve();
		}
		return new Promise((resolve) => {
			stopWaiters.push(resolve);
		});
	};

	return {
		async start(): Promise<void> {
			stopped = false;
			const startedAt = Date.now();
			const span = (name: string, meta?: StartupSpanEvent["meta"]): void => {
				try {
					appendStartupSpan(options.homeDir, {
						name,
						harnessKind: "openclaw",
						elapsedMs: Date.now() - startedAt,
						meta,
					});
				} catch {
					// Startup telemetry must not affect gateway launch.
				}
			};
			span("openclaw_service_start");
			if (managedDisabled || !command) {
				span("openclaw_service_disabled");
				return;
			}
			mkdirSync(join(options.homeDir, "runtime"), { recursive: true });
			const launchCommand = resolveNodeCliLaunchCommand(command, { candidatePaths: getOpenClawCliCandidatePaths() });
			span("openclaw_command_resolved", { executablePath: launchCommand.executablePath });
			const env = {
				...process.env,
				...(launchCommand.pathEnv ? { PATH: launchCommand.pathEnv } : {}),
				...(launchCommand.electronRunAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
				PIE_AGENT_HOME: options.homeDir,
			};
			if (stopped) {
				span("openclaw_gateway_start_cancelled", { port });
				return;
			}
			if (await isOpenClawGatewayReachable(gatewayUrl)) {
				console.log(`OpenClaw gateway already reachable at ${gatewayUrl}`);
				span("openclaw_gateway_already_reachable", { port });
				return;
			}
			if (stopped) {
				span("openclaw_gateway_start_cancelled", { port });
				return;
			}
			child = spawn(
				launchCommand.executablePath,
				[
					...launchCommand.argsPrefix,
					"gateway",
					"run",
					"--allow-unconfigured",
					"--port",
					String(port),
					"--ws-log",
					"compact",
				],
				{
					cwd: options.environment.workDir,
					env,
					stdio: ["ignore", "pipe", "pipe"],
					detached: process.platform !== "win32",
				},
			);
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
				const pipeOptions = { onLine: markReady, stripAnsi: true, forwardLine: shouldForwardOpenClawStartupLog };
				pipePrefixedLogs(child?.stdout ?? null, process.stdout, "[openclaw] ", pipeOptions);
				pipePrefixedLogs(child?.stderr ?? null, process.stdout, "[openclaw] ", pipeOptions);
				const readyLogTimer = setTimeout(() => {
					span("openclaw_gateway_ready_log_timeout", { port });
					resolve();
				}, 30_000);
				readyLogTimer.unref?.();
			});
			child.on("exit", () => {
				child = undefined;
			});
			child.on("error", (error) => {
				console.error(`OpenClaw gateway failed to start: ${error.message}`);
				child = undefined;
			});
			await Promise.race([
				waitForLocalPort(port, { label: `OpenClaw gateway 127.0.0.1:${port}` }),
				waitForStop(),
			]);
			if (stopped) {
				span("openclaw_gateway_start_cancelled", { port });
				return;
			}
			span("openclaw_gateway_port_reachable", { port });
			await Promise.race([waitForGatewayReady, waitForStop()]);
			if (stopped) {
				span("openclaw_gateway_start_cancelled", { port });
				return;
			}
			span("openclaw_gateway_ready", { port });
			console.log(`OpenClaw gateway ready at ${gatewayUrl}`);
		},
		stop,
	};
}
