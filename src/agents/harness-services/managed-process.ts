import { spawnSync, type ChildProcess } from "node:child_process";
import net from "node:net";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, sep } from "node:path";

export interface ResolvedExecutable {
	executablePath: string;
	pathEnv?: string;
}

export interface NodeCliLaunchCommand extends ResolvedExecutable {
	argsPrefix: string[];
	electronRunAsNode: boolean;
}

export interface PythonCliLaunchCommand extends ResolvedExecutable {
	argsPrefix: string[];
}

const DEFAULT_OPENCLAW_PREFIX = join(homedir(), ".openclaw");
const loginShellPathCache = new Map<string, string | undefined>();

export function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function asStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	return value
		.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
		.map((item) => item.trim());
}

export function parseArgs(value: string | undefined): string[] | undefined {
	if (!value?.trim()) {
		return undefined;
	}
	return value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, "")) ?? undefined;
}

export function isManagedDisabled(value: unknown): boolean {
	if (typeof value === "boolean") {
		return !value;
	}
	if (typeof value !== "string") {
		return false;
	}
	return ["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

export function resolveExecutable(
	command: string,
	options: { candidatePaths?: string[]; env?: NodeJS.ProcessEnv } = {},
): ResolvedExecutable {
	const env = options.env ?? process.env;
	const loginPath = resolveLoginShellPath(env);
	const pathEnv = combinePath(loginPath, env.PATH);
	if (command.includes("/") || command.includes("\\")) {
		return { executablePath: command, pathEnv };
	}
	const shell = env.SHELL?.trim() || "/bin/zsh";
	const found = spawnSync(shell, ["-lc", `command -v ${shellQuote(command)}`], {
		encoding: "utf8",
		env: { ...env, ...(pathEnv ? { PATH: pathEnv } : {}) },
	});
	const shellPath = found.stdout.trim().split(/\r?\n/)[0]?.trim();
	if (found.status === 0 && shellPath) {
		return { executablePath: shellPath, pathEnv };
	}
	for (const candidate of [
		join(homedir(), ".local", "bin", command),
		...(options.candidatePaths ?? []),
		...getNodeGlobalCliFallbacks(command),
		`/opt/homebrew/bin/${command}`,
		`/usr/local/bin/${command}`,
	]) {
		if (existsSync(candidate)) {
			return { executablePath: candidate, pathEnv };
		}
	}
	return { executablePath: command, pathEnv };
}

export function getOpenClawCliCandidatePaths(env: NodeJS.ProcessEnv = process.env): string[] {
	const configuredPrefix = env.OPENCLAW_PREFIX?.trim();
	return uniqueStrings([
		...(configuredPrefix ? [join(configuredPrefix, "bin", "openclaw")] : []),
		join(DEFAULT_OPENCLAW_PREFIX, "bin", "openclaw"),
	]);
}

export function resolveOpenClawExecutable(env: NodeJS.ProcessEnv = process.env): ResolvedExecutable | undefined {
	const command = env.OPENCLAW_COMMAND?.trim() || "openclaw";
	const configuredPrefix = env.OPENCLAW_PREFIX?.trim();
	if (configuredPrefix && !command.includes("/") && !command.includes("\\")) {
		const prefixedExecutable = join(configuredPrefix, "bin", "openclaw");
		if (existsSync(prefixedExecutable)) {
			return resolveExecutable(prefixedExecutable, { env });
		}
	}
	const resolved = resolveExecutable(command, {
		env,
		candidatePaths: getOpenClawCliCandidatePaths(env),
	});
	if (command.includes("/") || command.includes("\\") || resolved.executablePath !== command || existsSync(resolved.executablePath)) {
		return resolved;
	}
	return undefined;
}

export function resolveNodeCliLaunchCommand(command: string, options: { candidatePaths?: string[] } = {}): NodeCliLaunchCommand {
	const resolved = resolveExecutable(command, options);
	if (process.versions.electron && isNodeCli(resolved.executablePath)) {
		const nodeExecutablePath = resolveNodeExecutable(process.env, resolved.pathEnv, resolved.executablePath);
		if (nodeExecutablePath) {
			return {
				executablePath: nodeExecutablePath,
				argsPrefix: [resolved.executablePath],
				pathEnv: resolved.pathEnv,
				electronRunAsNode: false,
			};
		}
		throw new Error(`Unable to find a Node.js executable for ${resolved.executablePath}. Install Node.js or make it available in PATH.`);
	}
	return {
		executablePath: resolved.executablePath,
		argsPrefix: [],
		pathEnv: resolved.pathEnv,
		electronRunAsNode: false,
	};
}

export function resolvePythonCliLaunchCommand(command: string, options: { candidatePaths?: string[] } = {}): PythonCliLaunchCommand {
	const resolved = resolveExecutable(command, {
		...options,
		candidatePaths: [
			...(options.candidatePaths ?? []),
			...getPythonGlobalCliFallbacks(command),
		],
	});
	if (!isPythonCli(resolved.executablePath)) {
		return {
			executablePath: resolved.executablePath,
			argsPrefix: [],
			pathEnv: resolved.pathEnv,
		};
	}
	const pythonExecutablePath = resolvePythonExecutable(process.env, resolved.pathEnv, resolved.executablePath);
	if (!pythonExecutablePath) {
		throw new Error(`Unable to find a Python executable for ${resolved.executablePath}. Reinstall ${command} or make Python available in PATH.`);
	}
	return {
		executablePath: pythonExecutablePath,
		argsPrefix: [resolved.executablePath],
		pathEnv: resolved.pathEnv,
	};
}

function resolveNodeExecutable(env: NodeJS.ProcessEnv, pathEnv: string | undefined, cliPath?: string): string | undefined {
	for (const nodePath of getNodeExecutableCandidatesForCli(cliPath)) {
		if (existsSync(nodePath)) {
			return nodePath;
		}
	}
	const npmNodeExecPath = env.npm_node_execpath?.trim();
	if (npmNodeExecPath && isNodeExecutableName(npmNodeExecPath) && existsSync(npmNodeExecPath)) {
		return npmNodeExecPath;
	}
	if (!process.execPath.includes("Electron.app") && isNodeExecutableName(process.execPath)) {
		return process.execPath;
	}
	const shell = env.SHELL?.trim() || "/bin/zsh";
	const found = spawnSync(shell, ["-lc", "command -v node"], {
		encoding: "utf8",
		env: { ...env, ...(pathEnv ? { PATH: pathEnv } : {}) },
	});
	const nodePath = found.stdout.trim().split(/\r?\n/)[0]?.trim();
	if (found.status === 0 && nodePath && isNodeExecutableName(nodePath) && existsSync(nodePath)) {
		return nodePath;
	}
	for (const nodePath of getNodeExecutableFallbacks(env)) {
		if (existsSync(nodePath)) {
			return nodePath;
		}
	}
	return undefined;
}

function resolvePythonExecutable(env: NodeJS.ProcessEnv, pathEnv: string | undefined, cliPath: string): string | undefined {
	for (const pythonPath of getPythonExecutableCandidatesForCli(cliPath)) {
		if (existsSync(pythonPath)) {
			return pythonPath;
		}
	}
	const shebangPythonPath = getPythonExecutableFromShebang(cliPath);
	if (shebangPythonPath && existsSync(shebangPythonPath)) {
		return shebangPythonPath;
	}
	const shell = env.SHELL?.trim() || "/bin/zsh";
	for (const name of ["python3", "python"]) {
		const found = spawnSync(shell, ["-lc", `command -v ${name}`], {
			encoding: "utf8",
			env: { ...env, ...(pathEnv ? { PATH: pathEnv } : {}) },
		});
		const pythonPath = found.stdout.trim().split(/\r?\n/)[0]?.trim();
		if (found.status === 0 && pythonPath && isPythonExecutableName(pythonPath) && existsSync(pythonPath)) {
			return pythonPath;
		}
	}
	for (const pythonPath of getPythonExecutableFallbacks()) {
		if (existsSync(pythonPath)) {
			return pythonPath;
		}
	}
	return undefined;
}

function getNodeExecutableCandidatesForCli(cliPath: string | undefined): string[] {
	if (!cliPath) {
		return [];
	}
	const candidates = [
		join(dirname(cliPath), "node"),
		...getOpenClawNodeExecutableCandidatesFromWrapperPath(cliPath),
		...getNodeExecutableCandidatesFromNpmModulePath(cliPath),
	];
	try {
		const realCliPath = realpathSync(cliPath);
		candidates.push(
			join(dirname(realCliPath), "node"),
			...getOpenClawNodeExecutableCandidatesFromWrapperPath(realCliPath),
			...getNodeExecutableCandidatesFromNpmModulePath(realCliPath),
		);
	} catch {
		// The direct CLI path is enough when the symlink target is unavailable.
	}
	return uniqueStrings(candidates).filter(isNodeExecutableName);
}

function getOpenClawNodeExecutableCandidatesFromWrapperPath(cliPath: string): string[] {
	if (!/(?:^|[/\\])openclaw(?:\.cmd)?$/.test(cliPath) || dirname(cliPath).split(sep).at(-1) !== "bin") {
		return [];
	}
	const prefix = dirname(dirname(cliPath));
	return getVersionedNodeExecutableFallbacks(join(prefix, "tools"), "bin/node");
}

function getPythonExecutableCandidatesForCli(cliPath: string): string[] {
	const candidates = [
		join(dirname(cliPath), "python3"),
		join(dirname(cliPath), "python"),
	];
	try {
		const realCliPath = realpathSync(cliPath);
		candidates.push(join(dirname(realCliPath), "python3"), join(dirname(realCliPath), "python"));
	} catch {
		// The direct CLI path is enough when the symlink target is unavailable.
	}
	return uniqueStrings(candidates).filter(isPythonExecutableName);
}

function getNodeExecutableCandidatesFromNpmModulePath(cliPath: string): string[] {
	const marker = `${sep}lib${sep}node_modules${sep}`;
	const markerIndex = cliPath.indexOf(marker);
	if (markerIndex < 0) {
		return [];
	}
	return [join(cliPath.slice(0, markerIndex), "bin", "node")];
}

function getPythonExecutableFromShebang(cliPath: string): string | undefined {
	try {
		const firstLine = readFileSync(cliPath, "utf8").split(/\r?\n/, 1)[0] ?? "";
		const match = firstLine.match(/^#!\s*(\S+)/);
		const interpreter = match?.[1];
		return interpreter && isPythonExecutableName(interpreter) && !interpreter.endsWith("/env") ? interpreter : undefined;
	} catch {
		return undefined;
	}
}

function getNodeExecutableFallbacks(env: NodeJS.ProcessEnv = process.env): string[] {
	const configuredPrefix = env.OPENCLAW_PREFIX?.trim();
	const candidates = [
		join(homedir(), ".nvm", "current", "bin", "node"),
		...(configuredPrefix ? getVersionedNodeExecutableFallbacks(join(configuredPrefix, "tools"), "bin/node") : []),
		...getVersionedNodeExecutableFallbacks(join(DEFAULT_OPENCLAW_PREFIX, "tools"), "bin/node"),
		join(homedir(), ".volta", "bin", "node"),
		...getVersionedNodeExecutableFallbacks(join(homedir(), ".fnm", "node-versions"), "installation/bin/node"),
		...getVersionedNodeExecutableFallbacks(join(homedir(), ".local", "share", "mise", "installs", "node"), "bin/node"),
		...getVersionedNodeExecutableFallbacks(join(homedir(), ".asdf", "installs", "nodejs"), "bin/node"),
		"/opt/homebrew/bin/node",
		"/usr/local/bin/node",
		"/usr/bin/node",
	];
	const nvmVersionsDir = join(homedir(), ".nvm", "versions", "node");
	try {
		candidates.unshift(
			...readdirSync(nvmVersionsDir)
				.filter((entry) => entry.startsWith("v"))
				.sort(compareNodeVersionDescending)
				.map((entry) => join(nvmVersionsDir, entry, "bin", "node")),
		);
	} catch {
		// nvm is optional.
	}
	return candidates;
}

function getPythonExecutableFallbacks(): string[] {
	return [
		"/opt/homebrew/bin/python3",
		"/usr/local/bin/python3",
		"/usr/bin/python3",
		"/opt/homebrew/bin/python",
		"/usr/local/bin/python",
		"/usr/bin/python",
	];
}

function getNodeGlobalCliFallbacks(command: string): string[] {
	return [
		...getVersionedNodeGlobalCliFallbacks(join(homedir(), ".nvm", "versions", "node"), command),
		join(homedir(), ".volta", "bin", command),
		...getVersionedNodeGlobalCliFallbacks(join(homedir(), ".fnm", "node-versions"), command, "installation/bin"),
		...getVersionedNodeGlobalCliFallbacks(join(homedir(), ".local", "share", "mise", "installs", "node"), command),
		...getVersionedNodeGlobalCliFallbacks(join(homedir(), ".asdf", "installs", "nodejs"), command),
	];
}

function getPythonGlobalCliFallbacks(command: string): string[] {
	return [
		join(homedir(), ".local", "bin", command),
		join(homedir(), ".local", "pipx", "venvs", command, "bin", command),
		join(homedir(), ".local", "share", "pipx", "venvs", command, "bin", command),
		join(homedir(), ".local", "share", "uv", "tools", command, "bin", command),
		join(homedir(), ".local", "share", "uv", "tools", `${command}-agent`, "bin", command),
		`/opt/homebrew/bin/${command}`,
		`/usr/local/bin/${command}`,
	];
}

function getVersionedNodeExecutableFallbacks(rootDir: string, nodeRelativePath: string): string[] {
	try {
		return readdirSync(rootDir)
			.filter(isVersionedRuntimeDir)
			.sort(compareNodeVersionDescending)
			.map((entry) => join(rootDir, entry, nodeRelativePath));
	} catch {
		return [];
	}
}

function getVersionedNodeGlobalCliFallbacks(rootDir: string, command: string, binRelativePath = "bin"): string[] {
	try {
		return readdirSync(rootDir)
			.filter(isVersionedRuntimeDir)
			.sort(compareNodeVersionDescending)
			.map((entry) => join(rootDir, entry, binRelativePath, command));
	} catch {
		return [];
	}
}

function uniqueStrings(values: string[]): string[] {
	return [...new Set(values)];
}

function compareNodeVersionDescending(left: string, right: string): number {
	const parse = (value: string): number[] => value.replace(/^node-v/, "").replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
	const leftParts = parse(left);
	const rightParts = parse(right);
	for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
		const delta = (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
		if (delta !== 0) {
			return delta;
		}
	}
	return 0;
}

function isVersionedRuntimeDir(entry: string): boolean {
	return entry.startsWith("v") || entry.startsWith("node-v") || /^\d/.test(entry);
}

export function pipePrefixedLogs(
	stream: NodeJS.ReadableStream | null,
	target: NodeJS.WritableStream,
	prefix: string,
	options: { onLine?: (line: string) => void; stripAnsi?: boolean; forwardLine?: (line: string) => boolean } = {},
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
			const outputLine = options.stripAnsi ? stripAnsiControlSequences(line) : line;
			if (outputLine.trim()) {
				options.onLine?.(outputLine);
				if (options.forwardLine?.(outputLine) ?? true) {
					target.write(`${prefix}${outputLine}\n`);
				}
			}
		}
	});
	stream.on("end", () => {
		const outputLine = options.stripAnsi ? stripAnsiControlSequences(buffer) : buffer;
		if (outputLine.trim()) {
			options.onLine?.(outputLine);
			if (options.forwardLine?.(outputLine) ?? true) {
				target.write(`${prefix}${outputLine}\n`);
			}
		}
		buffer = "";
	});
}

export function canConnectToLocalPort(port: number): Promise<boolean> {
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

export async function waitForLocalPort(port: number, options: { timeoutMs?: number; label?: string } = {}): Promise<void> {
	const timeoutMs = options.timeoutMs ?? 90_000;
	const deadline = Date.now() + timeoutMs;
	let lastError = "";
	while (Date.now() < deadline) {
		try {
			if (await canConnectToLocalPort(port)) {
				return;
			}
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	const label = options.label ?? `127.0.0.1:${port}`;
	throw new Error(`${label} did not become reachable${lastError ? `: ${lastError}` : ""}`);
}

export async function stopManagedChildProcess(
	child: ChildProcess | undefined,
	options: { forceKillMs?: number } = {},
): Promise<void> {
	if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
		return;
	}
	const forceKillMs = options.forceKillMs ?? 5_000;
	const signal = (nextSignal: NodeJS.Signals): void => {
		if (!child.pid) {
			return;
		}
		if (process.platform !== "win32") {
			try {
				process.kill(-child.pid, nextSignal);
				return;
			} catch {
				// Fall back to the direct process when it is not a process group leader.
			}
		}
		try {
			child.kill(nextSignal);
		} catch {
			// best effort
		}
	};
	await new Promise<void>((resolve) => {
		let settled = false;
		const finish = (): void => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			clearTimeout(forceResolveTimer);
			resolve();
		};
		const timer = setTimeout(() => {
			signal("SIGKILL");
		}, forceKillMs);
		const forceResolveTimer = setTimeout(finish, forceKillMs + 1_000);
		child.once("exit", finish);
		signal("SIGTERM");
	});
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

function resolveLoginShellPath(env: NodeJS.ProcessEnv): string | undefined {
	const shell = env.SHELL?.trim() || "/bin/zsh";
	const cacheKey = `${shell}\0${env.PATH ?? ""}`;
	if (loginShellPathCache.has(cacheKey)) {
		return loginShellPathCache.get(cacheKey);
	}
	const result = spawnSync(shell, ["-lc", 'printf "%s" "$PATH"'], {
		encoding: "utf8",
		env,
	});
	const path = result.stdout.trim();
	const resolved = result.status === 0 && path ? path : undefined;
	loginShellPathCache.set(cacheKey, resolved);
	return resolved;
}

function combinePath(...paths: Array<string | undefined>): string | undefined {
	const seen = new Set<string>();
	const values: string[] = [];
	for (const path of paths) {
		for (const entry of path?.split(delimiter) ?? []) {
			if (!entry || seen.has(entry)) {
				continue;
			}
			seen.add(entry);
			values.push(entry);
		}
	}
	return values.length ? values.join(delimiter) : undefined;
}

function isNodeCli(executablePath: string): boolean {
	try {
		const header = readFileSync(executablePath, "utf8").slice(0, 128);
		return header.startsWith("#!") && header.includes("node");
	} catch {
		return false;
	}
}

function isPythonCli(executablePath: string): boolean {
	try {
		const header = readFileSync(executablePath, "utf8").slice(0, 128);
		return header.startsWith("#!") && header.includes("python");
	} catch {
		return false;
	}
}

function isNodeExecutableName(executablePath: string): boolean {
	return /(?:^|[/\\])node(?:\.exe)?$/.test(executablePath);
}

function isPythonExecutableName(executablePath: string): boolean {
	return /(?:^|[/\\])python(?:3(?:\.\d+)*)?(?:\.exe)?$/.test(executablePath);
}

function stripAnsiControlSequences(text: string): string {
	return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}
