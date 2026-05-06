import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, sep } from "node:path";
import type { AgentRuntimeEnvironment } from "../../../runtime/environment.js";

export interface TaskEngineProcessManagerOptions {
	homeDir: string;
	environment?: AgentRuntimeEnvironment;
	channel: string;
	gatewayPort: number;
	gatewaySecret?: string;
}

export interface TaskEngineProcessManager {
	start(): void;
	stop(): void;
}

function resolveTsxNodeArgs(currentFile: string): string[] | undefined {
	const inheritedTsxArgs = process.execArgv.filter((arg) => arg.includes("tsx/dist/") || arg.endsWith("tsx"));
	if (inheritedTsxArgs.length) {
		return inheritedTsxArgs;
	}
	const rootDir = join(dirname(currentFile), "..", "..", "..", "..");
	const preflight = join(rootDir, "node_modules", "tsx", "dist", "preflight.cjs");
	const loader = join(rootDir, "node_modules", "tsx", "dist", "loader.mjs");
	if (existsSync(preflight) && existsSync(loader)) {
		return ["--require", preflight, "--import", `file://${loader}`];
	}
	return undefined;
}

function resolveTaskEngineEntry(entryName: "runtime" | "engine"): { command: string; args: string[] } {
	const currentFile = fileURLToPath(import.meta.url);
	if (currentFile.includes(`${sep}src${sep}`)) {
		const script = fileURLToPath(new URL(`../task-engine/${entryName}.ts`, import.meta.url));
		const tsxNodeArgs = resolveTsxNodeArgs(currentFile);
		if (tsxNodeArgs) {
			return {
				command: process.execPath,
				args: [...tsxNodeArgs, script],
			};
		}
		return {
			command: "tsx",
			args: [script],
		};
	}
	return {
		command: process.execPath,
		args: [fileURLToPath(new URL(`../task-engine/${entryName}.js`, import.meta.url))],
	};
}

function shouldRunAsElectronNode(command: string): boolean {
	if (!process.versions.electron) {
		return false;
	}
	return !/(?:^|[/\\])node(?:\.exe)?$/.test(command);
}

function stopProcess(child: ChildProcess | undefined): void {
	if (!child?.pid) {
		return;
	}
	try {
		child.kill("SIGTERM");
	} catch {
		// Ignore cleanup failures during shutdown.
	}
}

export function createTaskEngineProcessManager(
	options: TaskEngineProcessManagerOptions,
): TaskEngineProcessManager {
	let runtimeProcess: ChildProcess | undefined;
	let engineProcess: ChildProcess | undefined;

	function spawnEntry(entryName: "runtime" | "engine"): ChildProcess {
		const entry = resolveTaskEngineEntry(entryName);
		const child = spawn(entry.command, entry.args, {
			cwd: options.environment?.workDir ?? options.homeDir,
			env: {
				...process.env,
				...(shouldRunAsElectronNode(entry.command) ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
				PIE_AGENT_HOME: options.homeDir,
				PIE_PARENT_PID: String(process.pid),
				PIE_CHANNEL: options.channel,
				PIE_GATEWAY_PORT: String(options.gatewayPort),
				...(options.gatewaySecret ? { PIE_GATEWAY_SECRET: options.gatewaySecret } : {}),
			},
			stdio: "ignore",
		});
		return child;
	}

	return {
		start(): void {
			if (!runtimeProcess) {
				runtimeProcess = spawnEntry("runtime");
				runtimeProcess.on("exit", () => {
					runtimeProcess = undefined;
				});
			}
			if (!engineProcess) {
				engineProcess = spawnEntry("engine");
				engineProcess.on("exit", () => {
					engineProcess = undefined;
				});
			}
		},
		stop(): void {
			stopProcess(runtimeProcess);
			stopProcess(engineProcess);
		},
	};
}
