import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
	AgentHarnessManagedServiceManager,
	AgentHarnessManagedServiceManagerOptions,
} from "../harness-service.js";

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	return value
		.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
		.map((item) => item.trim());
}

function parseArgs(value: string | undefined): string[] | undefined {
	if (!value?.trim()) {
		return undefined;
	}
	return value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, "")) ?? undefined;
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

function endpointFromEnv(env: Record<string, string | undefined>): string {
	const host = env.API_SERVER_HOST || "127.0.0.1";
	const port = env.API_SERVER_PORT || env.HERMES_PORT || "8642";
	return `http://${host}:${port}`;
}

function healthPathFromConfig(config: Record<string, unknown>): string {
	const path = asString(config.healthPath) ?? "/health";
	return path.startsWith("/") ? path : `/${path}`;
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
			if (line.trim()) {
				onLine?.(line);
				target.write(`${prefix}${line}\n`);
			}
		}
	});
	stream.on("end", () => {
		if (buffer.trim()) {
			onLine?.(buffer);
			target.write(`${prefix}${buffer}\n`);
		}
		buffer = "";
	});
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
	const managedDisabled =
		isManagedDisabled(config.managed) ||
		isManagedDisabled(process.env.HERMES_MANAGED);

	const stop = (): void => {
		if (!child) {
			return;
		}
		child.kill("SIGTERM");
		child = undefined;
	};

	return {
		async start(): Promise<void> {
			if (managedDisabled || child || !command) {
				return;
			}
			mkdirSync(join(options.homeDir, "runtime"), { recursive: true });
			const env = {
				...process.env,
				PIE_AGENT_HOME: options.homeDir,
				HERMES_HOME: process.env.HERMES_HOME || join(options.homeDir, "hermes"),
				API_SERVER_ENABLED: process.env.API_SERVER_ENABLED || "true",
				API_SERVER_HOST: process.env.API_SERVER_HOST || "127.0.0.1",
				API_SERVER_PORT: process.env.API_SERVER_PORT || process.env.HERMES_PORT || "8642",
				GATEWAY_ALLOW_ALL_USERS: process.env.GATEWAY_ALLOW_ALL_USERS || "true",
			};
			child = spawn(command, args, {
				cwd: options.environment.workDir,
				env,
				stdio: ["ignore", "pipe", "pipe"],
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
				pipePrefixedLogs(child?.stdout ?? null, process.stdout, "[hermes] ", markStarted);
				pipePrefixedLogs(child?.stderr ?? null, process.stderr, "[hermes] ", markStarted);
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
