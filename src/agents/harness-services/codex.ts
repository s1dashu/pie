import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { resolveNodeCliLaunchCommand, type NodeCliLaunchCommand } from "./managed-process.js";

export interface CodexCliRuntimeDiagnostic {
	installed: boolean;
	ready: boolean;
	executablePath?: string;
	version?: string;
	error?: string;
}

export function getCodexCliCandidatePaths(command = "codex"): string[] {
	return [
		join(homedir(), ".local", "bin", command),
		"/opt/homebrew/bin/codex",
		"/usr/local/bin/codex",
		"/Applications/Codex.app/Contents/Resources/codex",
	];
}

export function resolveCodexLaunchCommand(command = "codex"): NodeCliLaunchCommand | undefined {
	try {
		const resolved = resolveNodeCliLaunchCommand(command, {
			candidatePaths: getCodexCliCandidatePaths(command),
		});
		return existsSync(resolved.executablePath) ? resolved : undefined;
	} catch {
		return undefined;
	}
}

export function getCodexDisplayExecutablePath(command: NodeCliLaunchCommand): string {
	return command.argsPrefix[0] ?? command.executablePath;
}

export async function runCodexCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
	const command = resolveCodexLaunchCommand();
	if (!command) {
		return { code: 127, stdout: "", stderr: "codex command not found in login shell PATH" };
	}
	return runResolvedCommand(command.executablePath, [...command.argsPrefix, ...args], { pathEnv: command.pathEnv });
}

export async function checkCodexCliRuntime(commandName = "codex"): Promise<CodexCliRuntimeDiagnostic> {
	const command = resolveCodexLaunchCommand(commandName);
	if (!command) {
		return {
			installed: false,
			ready: false,
			error: "codex command not found in login shell PATH",
		};
	}
	const executablePath = getCodexDisplayExecutablePath(command);
	const version = await runResolvedCommand(command.executablePath, [...command.argsPrefix, "--version"], { pathEnv: command.pathEnv });
	const versionText = stripAnsi(version.stdout || version.stderr).trim();
	return {
		installed: true,
		ready: version.code === 0,
		executablePath,
		version: versionText || undefined,
		error: version.code === 0 ? undefined : stripAnsi(version.stderr || version.stdout).trim() || "Codex CLI exists but did not run successfully.",
	};
}

function runResolvedCommand(command: string, args: string[], options: { pathEnv?: string } = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		const child = spawn(command, args, {
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, ...(options.pathEnv ? { PATH: options.pathEnv } : {}) },
		});
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});
		child.on("error", (error) => resolve({ code: 1, stdout, stderr: error.message }));
		child.on("close", (code) => resolve({ code, stdout, stderr }));
	});
}

function stripAnsi(text: string): string {
	return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}
