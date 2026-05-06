import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	AgentHarnessManagedServiceManager,
	AgentHarnessManagedServiceManagerOptions,
} from "../harness-service.js";
import {
	asString,
	asStringArray,
	isManagedDisabled,
	parseArgs,
	pipePrefixedLogs,
	resolvePythonCliLaunchCommand,
	type PythonCliLaunchCommand,
	stopManagedChildProcess,
} from "./managed-process.js";

function endpointFromEnv(env: Record<string, string | undefined>): string {
	const host = env.API_SERVER_HOST || "127.0.0.1";
	const port = env.API_SERVER_PORT || env.HERMES_PORT || "8642";
	return `http://${host}:${port}`;
}

function endpointPartsFromConfig(config: Record<string, unknown>): { host: string; port: string } {
	const endpoint = asString(config.endpoint);
	if (!endpoint) {
		return { host: "127.0.0.1", port: "8642" };
	}
	try {
		const url = new URL(endpoint);
		return {
			host: url.hostname || "127.0.0.1",
			port: url.port || "8642",
		};
	} catch {
		return { host: "127.0.0.1", port: "8642" };
	}
}

function healthPathFromConfig(config: Record<string, unknown>): string {
	const path = asString(config.healthPath) ?? "/health";
	return path.startsWith("/") ? path : `/${path}`;
}

export function resolveHermesHome(config: Record<string, unknown>, homeDir: string): string {
	return asString(config.hermesHome) ?? join(homeDir, "hermes");
}

export function getHermesCliCandidatePaths(command = "hermes"): string[] {
	return [
		join(homedir(), ".local", "bin", command),
		join(homedir(), ".hermes", "hermes-agent", "venv", "bin", command),
		join(homedir(), ".local", "pipx", "venvs", command, "bin", command),
		join(homedir(), ".local", "share", "pipx", "venvs", command, "bin", command),
		join(homedir(), ".local", "share", "uv", "tools", command, "bin", command),
		join(homedir(), ".local", "share", "uv", "tools", `${command}-agent`, "bin", command),
		`/opt/homebrew/bin/${command}`,
		`/usr/local/bin/${command}`,
	];
}

export function resolveHermesLaunchCommand(command = "hermes"): PythonCliLaunchCommand {
	return resolvePythonCliLaunchCommand(command, {
		candidatePaths: getHermesCliCandidatePaths(command),
	});
}

async function waitForHealth(url: string, timeoutMs = 45_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastError = "";
	while (Date.now() < deadline) {
		try {
			const response = await fetch(url);
			if (response.ok) {
				return;
			}
			lastError = `${response.status} ${response.statusText}`.trim();
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`Hermes service did not become ready at ${url}${lastError ? `: ${lastError}` : ""}`);
}

export function createHermesServiceProcessManager(
	options: AgentHarnessManagedServiceManagerOptions,
): AgentHarnessManagedServiceManager {
	let child: ChildProcess | undefined;
	const config = options.config ?? {};
	const command = asString(config.command) ?? process.env.HERMES_COMMAND?.trim() ?? "hermes";
	const args =
		asStringArray(config.args) ??
		parseArgs(process.env.HERMES_ARGS) ??
		["gateway", "run", "--replace"];
	const endpointParts = endpointPartsFromConfig(config);
	const managedDisabled =
		isManagedDisabled(config.managed) ||
		isManagedDisabled(process.env.HERMES_MANAGED);

	const stop = async (): Promise<void> => {
		if (!child) {
			return;
		}
		const stoppingChild = child;
		child = undefined;
		await stopManagedChildProcess(stoppingChild);
	};

	return {
		async start(): Promise<void> {
			if (managedDisabled || child || !command) {
				return;
			}
			mkdirSync(join(options.homeDir, "runtime"), { recursive: true });
			const hermesHome = resolveHermesHome(config, options.homeDir);
			mkdirSync(hermesHome, { recursive: true });
			const launchCommand = resolveHermesLaunchCommand(command);
			const env = {
				...process.env,
				...(launchCommand.pathEnv ? { PATH: launchCommand.pathEnv } : {}),
				PIE_AGENT_HOME: options.homeDir,
				HERMES_HOME: hermesHome,
				API_SERVER_ENABLED: process.env.API_SERVER_ENABLED || "true",
				API_SERVER_HOST: process.env.API_SERVER_HOST || endpointParts.host,
				API_SERVER_PORT: process.env.API_SERVER_PORT || process.env.HERMES_PORT || endpointParts.port,
				GATEWAY_ALLOW_ALL_USERS: process.env.GATEWAY_ALLOW_ALL_USERS || "true",
			};
			child = spawn(launchCommand.executablePath, [...launchCommand.argsPrefix, ...args], {
				cwd: options.environment.workDir,
				env,
				stdio: ["ignore", "pipe", "pipe"],
				detached: process.platform !== "win32",
			});
			let sawChildStartup = false;
			const waitForChildStartup = new Promise<void>((resolve) => {
				const markStarted = (line: string) => {
					if (sawChildStartup) {
						return;
					}
					if (
						line.includes("Hermes Gateway Starting") ||
						line.includes("Starting Hermes Gateway") ||
						line.includes("API server")
					) {
						sawChildStartup = true;
						resolve();
					}
				};
				pipePrefixedLogs(child?.stdout ?? null, process.stdout, "[hermes] ", { onLine: markStarted });
				pipePrefixedLogs(child?.stderr ?? null, process.stderr, "[hermes] ", { onLine: markStarted });
				setTimeout(resolve, 5_000);
			});
			child.on("exit", () => {
				child = undefined;
			});
			child.on("error", (error) => {
				console.error(`Hermes service failed to start: ${error.message}`);
				child = undefined;
			});
			await waitForChildStartup;
			const endpoint = endpointFromEnv(env);
			await waitForHealth(`${endpoint}${healthPathFromConfig(config)}`);
			console.log(`Hermes service ready at ${endpoint}`);
		},
		stop,
	};
}
