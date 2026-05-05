import { BrowserWindow } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import type { AgentLogEntry } from "../shared/types.js";
import {
	clearRuntimeProcessRecord,
	writeRuntimeProcessRecord,
	writeRuntimeStateRecord,
	type RuntimeProcessRecord,
} from "../../core/runtime-process.js";
import {
	ensureRuntimeEnvironment,
	RuntimeEnvironmentLifecycle,
	type AgentRuntimeEnvironment,
	type RuntimeEnvironmentLifecycleSnapshot,
} from "../../runtime/environment.js";
import {
	getRuntimeLifecycleLogTransition,
	isRuntimeReadyLog,
} from "./runtime-lifecycle-signals.js";

export interface AgentProcessManagerOptions {
	getAppRoot(): string;
	getNodeExecPath(): string;
	getAgentHome(agentId: string): Promise<string>;
	getAgentName?(agentId: string): Promise<string | undefined> | string | undefined;
	getAgentStartLabel?(agentId: string): Promise<string | undefined> | string | undefined;
	getRuntimeEnvironment(agentId: string): Promise<AgentRuntimeEnvironment>;
	recordRuntimeEvent(agentId: string, event: "start" | "stop", reason?: string): Promise<void> | void;
	recordLogEntry?(entry: AgentLogEntry): Promise<void> | void;
}

const MAX_AGENT_LOGS = 1000;
const AGENT_START_TIMEOUT_MS = 30_000;
const AGENT_STOP_FORCE_KILL_MS = 5000;
const STREAM_LOG_UPDATE_DEBOUNCE_MS = 100;

function appendStreamDelta(existing: string, incoming: string): string {
	if (!incoming) {
		return existing;
	}
	if (!existing) {
		return incoming;
	}
	if (incoming.startsWith(existing)) {
		return incoming;
	}
	return `${existing}${incoming}`;
}

function stripAnsiControlSequences(text: string): string {
	return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function signalAgentProcess(child: ChildProcess, signal: NodeJS.Signals): void {
	if (child.pid && process.platform !== "win32") {
		try {
			process.kill(-child.pid, signal);
			return;
		} catch {
			// Fall back to the direct child. Older children may not be group leaders.
		}
	}
	child.kill(signal);
}

async function getAvailableLocalPort(): Promise<number> {
	return new Promise((resolvePort, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			server.close(() => {
				if (typeof address === "object" && address?.port) {
					resolvePort(address.port);
					return;
				}
				reject(new Error("Unable to allocate a local port."));
			});
		});
	});
}

async function getDistinctAvailableLocalPorts(count: number): Promise<number[]> {
	const ports: number[] = [];
	while (ports.length < count) {
		const port = await getAvailableLocalPort();
		if (!ports.includes(port)) {
			ports.push(port);
		}
	}
	return ports;
}

export class AgentProcessManager {
	private readonly runningAgents = new Map<string, ChildProcess>();
	private readonly agentLogs = new Map<string, AgentLogEntry[]>();
	private readonly agentLogBuffers = new Map<string, { stdout: string; stderr: string }>();
	private readonly activeAgentStreamLogs = new Map<string, { prefix: string; entry: AgentLogEntry; flushTimer?: NodeJS.Timeout; dirty: boolean }>();
	private readonly agentStartedAt = new Map<string, number>();
	private readonly agentLifecycles = new Map<string, RuntimeEnvironmentLifecycle>();
	private readonly agentEnvironments = new Map<string, AgentRuntimeEnvironment>();
	private readonly agentProcessRecords = new Map<string, RuntimeProcessRecord>();
	private readonly readyAgents = new Set<string>();
	private readonly agentReadyWaiters = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
	private nextLogId = 1;

	constructor(private readonly options: AgentProcessManagerOptions) {}

	isRunning(agentId: string): boolean {
		return this.runningAgents.has(agentId);
	}

	isReady(agentId: string): boolean {
		return this.readyAgents.has(agentId);
	}

	getStartedAt(agentId: string): number | undefined {
		return this.agentStartedAt.get(agentId);
	}

	getPid(agentId: string): number | undefined {
		return this.runningAgents.get(agentId)?.pid;
	}

	getLifecycleSnapshot(agentId: string): RuntimeEnvironmentLifecycleSnapshot | undefined {
		return this.agentLifecycles.get(agentId)?.snapshot;
	}

	getLogs(agentId: string): AgentLogEntry[] {
		return this.agentLogs.get(agentId) ?? [];
	}

	async start(agentId: string): Promise<void> {
		if (this.runningAgents.has(agentId)) {
			if (this.readyAgents.has(agentId)) {
				return;
			}
			await this.waitForAgentReady(agentId);
			return;
		}
		const command = this.getBotLaunchCommand();
		const runsWithPackagedElectron = Boolean(process.versions.electron) && command.argv.some((arg) => arg.endsWith("/dist/runtime/main.js"));
		const home = await this.options.getAgentHome(agentId);
		const lifecycle = new RuntimeEnvironmentLifecycle();
		this.agentLifecycles.set(agentId, lifecycle);
		lifecycle.mark("starting");
		const environment = {
			...(await this.options.getRuntimeEnvironment(agentId)),
			lifecycle: lifecycle.snapshot,
		};
		this.agentEnvironments.set(agentId, environment);
		ensureRuntimeEnvironment(environment);
		const [gatewayPort] = await getDistinctAvailableLocalPorts(1);
		this.appendAgentLog(agentId, "system", "starting bot");
		const readyPromise = this.createReadyPromise(agentId);
		const child = spawn(command.execPath, command.argv, {
			cwd: environment.workDir,
			stdio: ["ignore", "pipe", "pipe"],
			detached: process.platform !== "win32",
			env: {
				...process.env,
				...(runsWithPackagedElectron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
				PIE_AGENT_HOME: home,
				PIE_GATEWAY_PORT: String(gatewayPort),
				PIE_DESKTOP_LOGS: "1",
			},
		});
		if (child.pid) {
			const processRecord = {
				pid: child.pid,
				agentHome: home,
				startedAt: new Date().toISOString(),
				command: [command.execPath, ...command.argv],
				gatewayPort,
			};
			this.agentProcessRecords.set(agentId, processRecord);
			writeRuntimeProcessRecord(home, processRecord);
			this.persistRuntimeState(agentId, lifecycle.snapshot);
		}
		child.stdout?.on("data", (chunk) => {
			const text = String(chunk);
			this.appendAgentLogChunk(agentId, "stdout", text);
		});
		child.stderr?.on("data", (chunk) => {
			const text = String(chunk);
			this.appendAgentLogChunk(agentId, "stderr", text);
			console.error(`[agent:${agentId}] ${text.trimEnd()}`);
		});
		this.runningAgents.set(agentId, child);
		this.agentStartedAt.set(agentId, Date.now());
		child.once("exit", () => {
			lifecycle.mark("stopped", "exit");
			this.flushAgentLogBuffers(agentId);
			this.runningAgents.delete(agentId);
			this.agentStartedAt.delete(agentId);
			this.agentLifecycles.delete(agentId);
			this.agentEnvironments.delete(agentId);
			this.agentProcessRecords.delete(agentId);
			this.readyAgents.delete(agentId);
			clearRuntimeProcessRecord(home);
			this.persistRuntimeStateForEnvironment(home, environment, lifecycle.snapshot);
			this.rejectAgentReady(agentId, new Error("Bot process exited before it was ready."));
			this.recordRuntimeEvent(agentId, "stop", "exit");
			this.appendAgentLog(agentId, "system", "bot process exited");
		});
		child.once("error", (error) => {
			lifecycle.mark("failed", error instanceof Error ? error.message : String(error));
			this.flushAgentLogBuffers(agentId);
			this.runningAgents.delete(agentId);
			this.agentStartedAt.delete(agentId);
			this.agentLifecycles.delete(agentId);
			this.agentEnvironments.delete(agentId);
			this.agentProcessRecords.delete(agentId);
			this.readyAgents.delete(agentId);
			clearRuntimeProcessRecord(home);
			this.persistRuntimeStateForEnvironment(home, environment, lifecycle.snapshot);
			this.rejectAgentReady(agentId, error instanceof Error ? error : new Error(String(error)));
			this.recordRuntimeEvent(agentId, "stop", "error");
			this.appendAgentLog(agentId, "stderr", `bot process error: ${error instanceof Error ? error.message : String(error)}`);
			console.error(`[agent:${agentId}] failed:`, error);
		});
		try {
			await readyPromise;
			lifecycle.mark("running");
			this.persistRuntimeState(agentId, lifecycle.snapshot);
			this.recordRuntimeEvent(agentId, "start");
			console.log(`[agent] started ${await this.getAgentStartLabel(agentId)}`);
		} catch (error) {
			lifecycle.mark("failed", error instanceof Error ? error.message : String(error));
			this.persistRuntimeStateForEnvironment(home, environment, lifecycle.snapshot);
			if (this.runningAgents.get(agentId) === child) {
				this.runningAgents.delete(agentId);
				this.agentStartedAt.delete(agentId);
				this.agentLifecycles.delete(agentId);
				this.agentEnvironments.delete(agentId);
				this.agentProcessRecords.delete(agentId);
				this.readyAgents.delete(agentId);
				clearRuntimeProcessRecord(home);
				signalAgentProcess(child, "SIGTERM");
			}
			throw error;
		}
	}

	async stop(agentId: string, reason: string): Promise<void> {
		const child = this.runningAgents.get(agentId);
		if (!child) {
			this.agentStartedAt.delete(agentId);
			return;
		}
		this.runningAgents.delete(agentId);
		this.agentStartedAt.delete(agentId);
		this.readyAgents.delete(agentId);
		const home = await this.options.getAgentHome(agentId);
		const lifecycle = this.agentLifecycles.get(agentId);
		lifecycle?.mark("stopping", reason);
		if (lifecycle) {
			this.persistRuntimeState(agentId, lifecycle.snapshot);
		}
		this.rejectAgentReady(agentId, new Error(`Bot start was interrupted: ${reason}.`));
		this.appendAgentLog(agentId, "system", "stopping bot");
		await new Promise<void>((resolveStop) => {
			let exited = false;
			const timeout = setTimeout(() => {
				if (!exited) {
					signalAgentProcess(child, "SIGKILL");
				}
				resolveStop();
			}, AGENT_STOP_FORCE_KILL_MS);
			child.once("exit", () => {
				exited = true;
				clearTimeout(timeout);
				resolveStop();
			});
			signalAgentProcess(child, "SIGTERM");
		});
		lifecycle?.mark("stopped", reason);
		if (lifecycle) {
			this.persistRuntimeState(agentId, lifecycle.snapshot);
		}
		this.agentLifecycles.delete(agentId);
		this.agentEnvironments.delete(agentId);
		this.agentProcessRecords.delete(agentId);
		clearRuntimeProcessRecord(home);
		this.recordRuntimeEvent(agentId, "stop", reason);
		this.appendAgentLog(agentId, "system", "bot stopped");
	}

	async stopAll(reason: string): Promise<void> {
		const ids = [...this.runningAgents.keys()];
		await Promise.all(ids.map((id) => this.stop(id, reason).catch(() => undefined)));
	}

	private getBotLaunchCommand(): { execPath: string; argv: string[] } {
		const appRoot = this.options.getAppRoot();
		const runtimeSrc = join(appRoot, "src/runtime/main.ts");
		const runtimeDist = join(appRoot, "dist/runtime/main.js");
		const tsxCli = join(appRoot, "node_modules/tsx/dist/cli.mjs");
		const nodeExecPath = this.options.getNodeExecPath();
		if (existsSync(tsxCli) && existsSync(runtimeSrc)) {
			return { execPath: nodeExecPath, argv: [tsxCli, runtimeSrc] };
		}
		if (existsSync(runtimeDist)) {
			return { execPath: nodeExecPath, argv: [runtimeDist] };
		}
		throw new Error("找不到 bot runtime 入口；请先运行 npm install 或 npm run build。");
	}

	private async getAgentLabel(agentId: string): Promise<string> {
		const name = (await this.options.getAgentName?.(agentId))?.trim();
		return name && name !== agentId ? `${name} (${agentId})` : agentId;
	}

	private async getAgentStartLabel(agentId: string): Promise<string> {
		const label = (await this.options.getAgentStartLabel?.(agentId))?.trim();
		return label || this.getAgentLabel(agentId);
	}

	private appendAgentLog(agentId: string, stream: AgentLogEntry["stream"], text: string): void {
		const cleanText = stripAnsiControlSequences(text);
		if (!cleanText) {
			return;
		}
		this.updateLifecycleFromLog(agentId, cleanText);
		if (stream === "stdout" && isRuntimeReadyLog(cleanText)) {
			this.markAgentReady(agentId);
		}
		if (stream === "stdout") {
			for (const prefix of ["Agent: ", "> Thinking "]) {
				if (cleanText.startsWith(prefix)) {
					this.appendAgentStreamDelta(agentId, prefix, cleanText.slice(prefix.length));
					return;
				}
			}
		}
		this.flushAgentStreamLog(agentId);
		const entry: AgentLogEntry = {
			id: this.nextLogId++,
			agentId,
			stream,
			text: cleanText,
			timestamp: new Date().toISOString(),
		};
		this.pushLogEntry(agentId, entry);
		this.emitAgentLog(entry);
	}

	private appendAgentStreamDelta(agentId: string, prefix: string, delta: string): void {
		const activeLog = this.activeAgentStreamLogs.get(agentId);
		if (activeLog?.prefix === prefix) {
			activeLog.entry.text = `${prefix}${appendStreamDelta(activeLog.entry.text.slice(prefix.length), delta)}`;
			activeLog.dirty = true;
			this.scheduleAgentStreamLogFlush(agentId, activeLog);
			return;
		}
		this.flushAgentStreamLog(agentId);

		const entry: AgentLogEntry = {
			id: this.nextLogId++,
			agentId,
			stream: "stdout",
			text: `${prefix}${delta}`,
			timestamp: new Date().toISOString(),
		};
		this.pushLogEntry(agentId, entry);
		this.activeAgentStreamLogs.set(agentId, { prefix, entry, dirty: false });
		this.emitAgentLog(entry);
	}

	private scheduleAgentStreamLogFlush(agentId: string, activeLog: { prefix: string; entry: AgentLogEntry; flushTimer?: NodeJS.Timeout; dirty: boolean }): void {
		if (activeLog.flushTimer) {
			return;
		}
		activeLog.flushTimer = setTimeout(() => {
			activeLog.flushTimer = undefined;
			if (!activeLog.dirty) {
				return;
			}
			activeLog.dirty = false;
			this.emitAgentLog({ ...activeLog.entry, updated: true });
		}, STREAM_LOG_UPDATE_DEBOUNCE_MS);
	}

	private flushAgentStreamLog(agentId: string): void {
		const activeLog = this.activeAgentStreamLogs.get(agentId);
		if (!activeLog) {
			return;
		}
		if (activeLog.flushTimer) {
			clearTimeout(activeLog.flushTimer);
			activeLog.flushTimer = undefined;
		}
		if (activeLog.dirty) {
			activeLog.dirty = false;
			this.emitAgentLog({ ...activeLog.entry, updated: true });
		}
		this.activeAgentStreamLogs.delete(agentId);
	}

	private pushLogEntry(agentId: string, entry: AgentLogEntry): void {
		const entries = this.agentLogs.get(agentId) ?? [];
		entries.push(entry);
		if (entries.length > MAX_AGENT_LOGS) {
			entries.splice(0, entries.length - MAX_AGENT_LOGS);
		}
		this.agentLogs.set(agentId, entries);
	}

	private emitAgentLog(entry: AgentLogEntry): void {
		this.recordLogEntry(entry);
		for (const win of BrowserWindow.getAllWindows()) {
			if (win.isDestroyed() || win.webContents.isDestroyed()) {
				continue;
			}
			try {
				win.webContents.send("agents:log", entry);
			} catch (error) {
				console.error(`[agent:${entry.agentId}] failed to emit log to renderer:`, error);
			}
		}
	}

	private recordRuntimeEvent(agentId: string, event: "start" | "stop", reason?: string): void {
		Promise.resolve(this.options.recordRuntimeEvent(agentId, event, reason)).catch((error) => {
			console.error(`[agent:${agentId}] failed to persist runtime event:`, error);
		});
	}

	private updateLifecycleFromLog(agentId: string, text: string): void {
		const lifecycle = this.agentLifecycles.get(agentId);
		if (!lifecycle) {
			return;
		}
		const transition = getRuntimeLifecycleLogTransition(lifecycle.snapshot, text);
		if (transition) {
			lifecycle.mark(transition.state, transition.reason);
			this.persistRuntimeState(agentId, lifecycle.snapshot);
		}
	}

	private persistRuntimeState(agentId: string, lifecycle: RuntimeEnvironmentLifecycleSnapshot): void {
		const environment = this.agentEnvironments.get(agentId);
		if (!environment) {
			return;
		}
		this.persistRuntimeStateForEnvironment(environment.homeDir, environment, lifecycle, this.agentProcessRecords.get(agentId));
	}

	private persistRuntimeStateForEnvironment(
		homeDir: string,
		environment: AgentRuntimeEnvironment,
		lifecycle: RuntimeEnvironmentLifecycleSnapshot,
		processRecord?: RuntimeProcessRecord,
	): void {
		try {
			writeRuntimeStateRecord(homeDir, {
				homeDir: environment.homeDir,
				workDir: environment.workDir,
				lifecycle,
				...(processRecord && lifecycle.state !== "stopped" && lifecycle.state !== "failed" ? { process: processRecord } : {}),
			});
		} catch (error) {
			console.error(`[agent] failed to persist runtime state:`, error);
		}
	}

	private recordLogEntry(entry: AgentLogEntry): void {
		if (!this.options.recordLogEntry) {
			return;
		}
		Promise.resolve(this.options.recordLogEntry(entry)).catch((error) => {
			console.error(`[agent:${entry.agentId}] failed to persist log entry:`, error);
		});
	}

	private getAgentLogBuffer(agentId: string): { stdout: string; stderr: string } {
		let buffer = this.agentLogBuffers.get(agentId);
		if (!buffer) {
			buffer = { stdout: "", stderr: "" };
			this.agentLogBuffers.set(agentId, buffer);
		}
		return buffer;
	}

	private appendAgentLogChunk(agentId: string, stream: "stdout" | "stderr", chunk: string): void {
		const buffer = this.getAgentLogBuffer(agentId);
		buffer[stream] += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

		for (;;) {
			const newlineIndex = buffer[stream].indexOf("\n");
			if (newlineIndex === -1) {
				return;
			}
			const line = buffer[stream].slice(0, newlineIndex);
			buffer[stream] = buffer[stream].slice(newlineIndex + 1);
			if (line.trim()) {
				this.appendAgentLog(agentId, stream, line);
			}
		}
	}

	private flushAgentLogBuffers(agentId: string): void {
		this.flushAgentStreamLog(agentId);
		const buffer = this.agentLogBuffers.get(agentId);
		if (!buffer) {
			return;
		}
		if (buffer.stdout.trim()) {
			this.appendAgentLog(agentId, "stdout", buffer.stdout);
		}
		if (buffer.stderr.trim()) {
			this.appendAgentLog(agentId, "stderr", buffer.stderr);
		}
		this.agentLogBuffers.delete(agentId);
	}

	private createReadyPromise(agentId: string): Promise<void> {
		return new Promise((resolveReady, rejectReady) => {
			const timeout = setTimeout(() => {
				this.agentReadyWaiters.delete(agentId);
				rejectReady(new Error("Bot did not become ready within 30s."));
			}, AGENT_START_TIMEOUT_MS);
			this.agentReadyWaiters.set(agentId, {
				resolve: () => {
					clearTimeout(timeout);
					resolveReady();
				},
				reject: (error) => {
					clearTimeout(timeout);
					rejectReady(error);
				},
			});
		});
	}

	private waitForAgentReady(agentId: string): Promise<void> {
		if (this.readyAgents.has(agentId)) {
			return Promise.resolve();
		}
		return this.createReadyPromise(agentId);
	}

	private markAgentReady(agentId: string): void {
		this.readyAgents.add(agentId);
		const waiter = this.agentReadyWaiters.get(agentId);
		if (!waiter) {
			return;
		}
		this.agentReadyWaiters.delete(agentId);
		waiter.resolve();
	}

	private rejectAgentReady(agentId: string, error: Error): void {
		const waiter = this.agentReadyWaiters.get(agentId);
		if (!waiter) {
			return;
		}
		this.agentReadyWaiters.delete(agentId);
		waiter.reject(error);
	}
}
