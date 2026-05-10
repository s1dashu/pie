import { BrowserWindow } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import type { AgentLogEntry } from "../shared/types.js";
import {
	clearRuntimeProcessRecord,
	writeRuntimeProcessRecord,
	writeRuntimeStateRecord,
	type RuntimeProcessRecord,
} from "../../core/runtime-process.js";
import { appendStartupSpan } from "../../core/startup-spans.js";
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
import {
	getAgentRuntimeLaunchCommand,
	getDistinctAvailableLocalPorts,
} from "./agent-runtime-launcher.js";

export interface AgentProcessManagerOptions {
	getAppRoot(): string;
	getNodeExecPath(): string;
	getAgentHome(agentId: string): Promise<string>;
	getAgentName?(agentId: string): Promise<string | undefined> | string | undefined;
	getAgentHarnessKind?(agentId: string): Promise<string | undefined> | string | undefined;
	getAgentStartLabel?(agentId: string): Promise<string | undefined> | string | undefined;
	getDeveloperMode?(): Promise<boolean> | boolean;
	getRuntimeEnvironment(agentId: string): Promise<AgentRuntimeEnvironment>;
	recordRuntimeEvent(agentId: string, event: "start" | "stop", reason?: string): Promise<void> | void;
	recordRuntimeStateChange?(agentId: string, reason?: string): Promise<void> | void;
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
		const harnessKind = (await this.options.getAgentHarnessKind?.(agentId))?.trim();
		const startedAt = Date.now();
		const span = (name: string, meta?: Record<string, string | number | boolean | undefined>): void => {
			try {
				appendStartupSpan(home, {
					name,
					elapsedMs: Date.now() - startedAt,
					meta,
				});
			} catch {
				// Startup telemetry must not affect process launch.
			}
		};
		span("desktop_agent_start_begin");
		const lifecycle = new RuntimeEnvironmentLifecycle();
		this.agentLifecycles.set(agentId, lifecycle);
		lifecycle.mark("starting");
		this.recordRuntimeStateChange(agentId, "starting");
		const environment = {
			...(await this.options.getRuntimeEnvironment(agentId)),
			lifecycle: lifecycle.snapshot,
		};
		this.agentEnvironments.set(agentId, environment);
		ensureRuntimeEnvironment(environment);
		const [gatewayPort] = await getDistinctAvailableLocalPorts(1);
		const developerMode = await this.options.getDeveloperMode?.();
		this.appendAgentLog(agentId, "system", "starting bot");
		const readyPromise = this.createReadyPromise(agentId);
		span("desktop_agent_spawn_begin", { execPath: command.execPath });
		const childEnv = {
			...process.env,
			...(runsWithPackagedElectron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
			PIE_AGENT_HOME: home,
			PIE_GATEWAY_PORT: String(gatewayPort),
			PIE_DEVELOPER_MODE: developerMode ? "1" : "0",
			PIE_DESKTOP_LOGS: "1",
			...(harnessKind === "openclaw" ? { PIE_MANAGED_HARNESS_SERVICE: "external" } : {}),
		};
		const child = spawn(command.execPath, command.argv, {
			cwd: environment.workDir,
			stdio: ["ignore", "pipe", "pipe"],
			detached: process.platform !== "win32",
			env: childEnv,
		});
		span("desktop_agent_spawned", { pid: child.pid });
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
			this.appendAgentLogChunk(agentId, "stdout", text, child);
		});
		child.stderr?.on("data", (chunk) => {
			const text = String(chunk);
			this.appendAgentLogChunk(agentId, "stderr", text, child);
			console.error(`[agent:${agentId}] ${text.trimEnd()}`);
		});
		this.runningAgents.set(agentId, child);
		this.agentStartedAt.set(agentId, Date.now());
		child.once("exit", () => {
			if (this.runningAgents.get(agentId) !== child) {
				this.flushAgentLogBuffers(agentId, child);
				this.appendAgentLog(agentId, "system", "previous bot process exited", child);
				return;
			}
			lifecycle.mark("stopped", "exit");
			this.flushAgentLogBuffers(agentId, child);
			this.forgetAgentRuntimeState(agentId);
			clearRuntimeProcessRecord(home);
			this.persistRuntimeStateForEnvironment(home, environment, lifecycle.snapshot);
			this.rejectAgentReady(agentId, new Error("Bot process exited before it was ready."));
			this.recordRuntimeEvent(agentId, "stop", "exit");
			this.recordRuntimeStateChange(agentId, "exit");
			this.appendAgentLog(agentId, "system", "bot process exited");
		});
		child.once("error", (error: unknown, location: unknown) => {
			const errorMessage = error instanceof Error ? error.message : [error, location].filter(Boolean).join(": ") || String(error);
			if (this.runningAgents.get(agentId) !== child) {
				this.flushAgentLogBuffers(agentId, child);
				this.appendAgentLog(agentId, "stderr", `previous bot process error: ${errorMessage}`, child);
				return;
			}
			lifecycle.mark("failed", errorMessage);
			this.flushAgentLogBuffers(agentId, child);
			this.forgetAgentRuntimeState(agentId);
			clearRuntimeProcessRecord(home);
			this.persistRuntimeStateForEnvironment(home, environment, lifecycle.snapshot);
			this.rejectAgentReady(agentId, error instanceof Error ? error : new Error(errorMessage));
			this.recordRuntimeEvent(agentId, "stop", "error");
			this.recordRuntimeStateChange(agentId, "error");
			this.appendAgentLog(agentId, "stderr", `bot process error: ${errorMessage}`);
			console.error(`[agent:${agentId}] failed:`, error);
		});
		try {
			await readyPromise;
			lifecycle.mark("running");
			this.persistRuntimeState(agentId, lifecycle.snapshot);
			this.recordRuntimeEvent(agentId, "start");
			this.recordRuntimeStateChange(agentId, "running");
			span("desktop_agent_ready", { pid: child.pid });
			console.log(`[agent] started ${await this.getAgentStartLabel(agentId)}`);
		} catch (error) {
			lifecycle.mark("failed", error instanceof Error ? error.message : String(error));
			this.persistRuntimeStateForEnvironment(home, environment, lifecycle.snapshot);
			if (this.runningAgents.get(agentId) === child) {
				this.forgetAgentRuntimeState(agentId);
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
		this.forgetAgentRuntimeState(agentId);
		clearRuntimeProcessRecord(home);
		this.recordRuntimeEvent(agentId, "stop", reason);
		this.recordRuntimeStateChange(agentId, reason);
		this.appendAgentLog(agentId, "system", "bot stopped");
	}

	async stopAll(reason: string): Promise<void> {
		const ids = [...this.runningAgents.keys()];
		await Promise.all(ids.map((id) => this.stop(id, reason).catch(() => undefined)));
	}

	private getBotLaunchCommand(): { execPath: string; argv: string[] } {
		return getAgentRuntimeLaunchCommand({
			appRoot: this.options.getAppRoot(),
			nodeExecPath: this.options.getNodeExecPath(),
		});
	}

	private async getAgentLabel(agentId: string): Promise<string> {
		const name = (await this.options.getAgentName?.(agentId))?.trim();
		return name && name !== agentId ? `${name} (${agentId})` : agentId;
	}

	private async getAgentStartLabel(agentId: string): Promise<string> {
		const label = (await this.options.getAgentStartLabel?.(agentId))?.trim();
		return label || this.getAgentLabel(agentId);
	}

	private appendAgentLog(agentId: string, stream: AgentLogEntry["stream"], text: string, sourceChild?: ChildProcess): void {
		const cleanText = stripAnsiControlSequences(text);
		if (!cleanText) {
			return;
		}
		if (!sourceChild || this.runningAgents.get(agentId) === sourceChild) {
			this.updateLifecycleFromLog(agentId, cleanText);
		}
		if (
			stream === "stdout" &&
			isRuntimeReadyLog(cleanText) &&
			(!sourceChild || this.runningAgents.get(agentId) === sourceChild)
		) {
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

	private recordRuntimeStateChange(agentId: string, reason?: string): void {
		if (!this.options.recordRuntimeStateChange) {
			return;
		}
		Promise.resolve(this.options.recordRuntimeStateChange(agentId, reason)).catch((error) => {
			console.error(`[agent:${agentId}] failed to emit runtime state change:`, error);
		});
	}

	private forgetAgentRuntimeState(agentId: string): void {
		this.runningAgents.delete(agentId);
		this.agentStartedAt.delete(agentId);
		this.agentLifecycles.delete(agentId);
		this.agentEnvironments.delete(agentId);
		this.agentProcessRecords.delete(agentId);
		this.readyAgents.delete(agentId);
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

	private appendAgentLogChunk(agentId: string, stream: "stdout" | "stderr", chunk: string, sourceChild?: ChildProcess): void {
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
				this.appendAgentLog(agentId, stream, line, sourceChild);
			}
		}
	}

	private flushAgentLogBuffers(agentId: string, sourceChild?: ChildProcess): void {
		this.flushAgentStreamLog(agentId);
		const buffer = this.agentLogBuffers.get(agentId);
		if (!buffer) {
			return;
		}
		if (buffer.stdout.trim()) {
			this.appendAgentLog(agentId, "stdout", buffer.stdout, sourceChild);
		}
		if (buffer.stderr.trim()) {
			this.appendAgentLog(agentId, "stderr", buffer.stderr, sourceChild);
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
