import { BrowserWindow } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import type { AgentLogEntry } from "../shared/types.js";

export interface AgentProcessManagerOptions {
	getAppRoot(): string;
	getNodeExecPath(): string;
	getAgentHome(agentId: string): Promise<string>;
	recordRuntimeEvent(agentId: string, event: "start" | "stop", reason?: string): Promise<void> | void;
}

const MAX_AGENT_LOGS = 1000;

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
	private readonly activeAgentReplyLogs = new Map<string, AgentLogEntry>();
	private readonly agentStartedAt = new Map<string, number>();
	private nextLogId = 1;

	constructor(private readonly options: AgentProcessManagerOptions) {}

	isRunning(agentId: string): boolean {
		return this.runningAgents.has(agentId);
	}

	getStartedAt(agentId: string): number | undefined {
		return this.agentStartedAt.get(agentId);
	}

	getPid(agentId: string): number | undefined {
		return this.runningAgents.get(agentId)?.pid;
	}

	getLogs(agentId: string): AgentLogEntry[] {
		return this.agentLogs.get(agentId) ?? [];
	}

	async start(agentId: string): Promise<void> {
		if (this.runningAgents.has(agentId)) {
			return;
		}
		const command = this.getBotLaunchCommand();
		const home = await this.options.getAgentHome(agentId);
		const [gatewayPort, webhookPort] = await getDistinctAvailableLocalPorts(2);
		this.appendAgentLog(agentId, "system", `starting bot: ${command.execPath} ${command.argv.join(" ")}`);
		const child = spawn(command.execPath, command.argv, {
			cwd: this.options.getAppRoot(),
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				PIE_AGENT_HOME: home,
				PIE_GATEWAY_PORT: String(gatewayPort),
				PIE_WORKFLOW_WEBHOOK_PORT: String(webhookPort),
				PIE_DESKTOP_LOGS: "1",
			},
		});
		child.stdout?.on("data", (chunk) => {
			const text = String(chunk);
			this.appendAgentLogChunk(agentId, "stdout", text);
			console.log(`[agent:${agentId}] ${text.trimEnd()}`);
		});
		child.stderr?.on("data", (chunk) => {
			const text = String(chunk);
			this.appendAgentLogChunk(agentId, "stderr", text);
			console.error(`[agent:${agentId}] ${text.trimEnd()}`);
		});
		this.runningAgents.set(agentId, child);
		this.agentStartedAt.set(agentId, Date.now());
		await this.options.recordRuntimeEvent(agentId, "start");
		child.once("exit", () => {
			this.flushAgentLogBuffers(agentId);
			this.runningAgents.delete(agentId);
			this.agentStartedAt.delete(agentId);
			void this.options.recordRuntimeEvent(agentId, "stop", "exit");
			this.appendAgentLog(agentId, "system", "bot process exited");
		});
		child.once("error", (error) => {
			this.flushAgentLogBuffers(agentId);
			this.runningAgents.delete(agentId);
			this.agentStartedAt.delete(agentId);
			void this.options.recordRuntimeEvent(agentId, "stop", "error");
			this.appendAgentLog(agentId, "stderr", `bot process error: ${error instanceof Error ? error.message : String(error)}`);
			console.error(`[agent:${agentId}] failed:`, error);
		});
	}

	async stop(agentId: string, reason: string): Promise<void> {
		const child = this.runningAgents.get(agentId);
		if (!child) {
			this.agentStartedAt.delete(agentId);
			return;
		}
		this.runningAgents.delete(agentId);
		this.agentStartedAt.delete(agentId);
		this.appendAgentLog(agentId, "system", "stopping bot");
		await new Promise<void>((resolveStop) => {
			let exited = false;
			const timeout = setTimeout(() => {
				if (!exited) {
					child.kill("SIGKILL");
				}
				resolveStop();
			}, 5000);
			child.once("exit", () => {
				exited = true;
				clearTimeout(timeout);
				resolveStop();
			});
			child.kill("SIGTERM");
		});
		await this.options.recordRuntimeEvent(agentId, "stop", reason);
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

	private appendAgentLog(agentId: string, stream: AgentLogEntry["stream"], text: string): void {
		if (!text) {
			return;
		}
		if (stream === "stdout" && text.startsWith("Agent: ")) {
			this.appendAgentReplyDelta(agentId, text.slice("Agent: ".length));
			return;
		}
		if (stream !== "stdout" || !text.startsWith("Agent:")) {
			this.activeAgentReplyLogs.delete(agentId);
		}
		const entry: AgentLogEntry = {
			id: this.nextLogId++,
			agentId,
			stream,
			text,
			timestamp: new Date().toISOString(),
		};
		this.pushLogEntry(agentId, entry);
		this.emitAgentLog(entry);
	}

	private appendAgentReplyDelta(agentId: string, delta: string): void {
		const activeEntry = this.activeAgentReplyLogs.get(agentId);
		if (activeEntry) {
			activeEntry.text += delta;
			this.emitAgentLog({ ...activeEntry, updated: true });
			return;
		}

		const entry: AgentLogEntry = {
			id: this.nextLogId++,
			agentId,
			stream: "stdout",
			text: `Agent: ${delta}`,
			timestamp: new Date().toISOString(),
		};
		this.pushLogEntry(agentId, entry);
		this.activeAgentReplyLogs.set(agentId, entry);
		this.emitAgentLog(entry);
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
		for (const win of BrowserWindow.getAllWindows()) {
			win.webContents.send("agents:log", entry);
		}
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
}
