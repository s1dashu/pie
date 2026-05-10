import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, sep } from "node:path";
import { OUSIA_ENV } from "./env.js";

export interface TaskEngineProcessManagerOptions {
	homeDir: string;
	workDir?: string;
	channel: string;
	gatewayPort: number;
	gatewaySecret?: string;
}

export interface TaskEngineProcessManager {
	start(): void;
	stop(): void;
}

export function resolveTsxNodeArgs(currentFile: string, execArgv: readonly string[] = process.execArgv): string[] | undefined {
	if (execArgv.some((arg) => arg.includes("tsx/dist/") || arg.endsWith("tsx"))) {
		return [...execArgv];
	}
	const rootDir = findNearestNodeModulesRoot(dirname(currentFile)) ?? process.cwd();
	const preflight = join(rootDir, "node_modules", "tsx", "dist", "preflight.cjs");
	const loader = join(rootDir, "node_modules", "tsx", "dist", "loader.mjs");
	if (existsSync(preflight) && existsSync(loader)) {
		return ["--require", preflight, "--import", `file://${loader}`];
	}
	return undefined;
}

function findNearestNodeModulesRoot(startDir: string): string | undefined {
	let current = startDir;
	for (;;) {
		if (existsSync(join(current, "node_modules"))) {
			return current;
		}
		const parent = dirname(current);
		if (parent === current) {
			return undefined;
		}
		current = parent;
	}
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
			cwd: options.workDir ?? options.homeDir,
			env: {
				...process.env,
				...(shouldRunAsElectronNode(entry.command) ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
				[OUSIA_ENV.home]: options.homeDir,
				[OUSIA_ENV.workDir]: options.workDir ?? options.homeDir,
				[OUSIA_ENV.parentPid]: String(process.pid),
				[OUSIA_ENV.hostChannel]: options.channel,
				[OUSIA_ENV.runGatewayPort]: String(options.gatewayPort),
				...(options.gatewaySecret ? { [OUSIA_ENV.runGatewaySecret]: options.gatewaySecret } : {}),
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
