import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import chalk from "chalk";

export interface CodexJsonRpcMessage {
	id?: number;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { message?: string };
}

export class CodexStdioJsonRpcClient {
	private readonly pending = new Map<number, {
		method: string;
		resolve: (value: unknown) => void;
		reject: (error: Error) => void;
	}>();
	private process?: ChildProcessWithoutNullStreams;
	private stderr = "";
	private nextRequestId = 0;
	private closing = false;

	constructor(
		private readonly options: {
			stdoutLabel: string;
			debug?: boolean;
			onNotification: (message: CodexJsonRpcMessage) => void;
			onFailure?: (error: Error) => void;
		},
	) {}

	start(command: string, args: string[], options: { pathEnv?: string } = {}): void {
		this.stderr = "";
		this.closing = false;
		const child = spawn(command, args, {
			cwd: process.cwd(),
			env: { ...process.env, ...(options.pathEnv ? { PATH: options.pathEnv } : {}) },
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.process = child;
		const rl = createInterface({ input: child.stdout });
		rl.on("line", (line) => this.handleLine(line));
		child.stderr.on("data", (chunk: Buffer) => {
			this.stderr += chunk.toString("utf8");
			if (this.stderr.length > 8_000) {
				this.stderr = this.stderr.slice(-8_000);
			}
			if (this.options.debug) {
				process.stderr.write(chunk);
			}
		});
		child.on("error", (error) => this.fail(error));
		child.on("close", (code, signal) => {
			rl.close();
			if (!this.closing) {
				this.fail(new Error(`codex app-server exited${signal ? ` (${signal})` : ""}: ${this.stderr.trim() || `exit ${code}`}`));
			}
		});
	}

	close(): void {
		this.closing = true;
		this.rejectPending(new Error("Codex app-server closed."));
		this.process?.kill("SIGTERM");
		this.process = undefined;
	}

	request(method: string, params: unknown): Promise<unknown> {
		if (!this.process?.stdin.writable) {
			return Promise.reject(new Error("Codex app-server is not running."));
		}
		const id = ++this.nextRequestId;
		const payload = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { method, resolve, reject });
			this.process!.stdin.write(payload, (error) => {
				if (error) {
					this.pending.delete(id);
					reject(error);
				}
			});
		});
	}

	notify(method: string, params: unknown): void {
		this.process?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
	}

	private handleLine(line: string): void {
		if (this.options.debug) {
			console.log(chalk.gray(`[${this.options.stdoutLabel}] ${line}`));
		}
		let message: CodexJsonRpcMessage;
		try {
			message = JSON.parse(line) as CodexJsonRpcMessage;
		} catch {
			return;
		}
		if (message.id !== undefined) {
			this.handleResponse(message);
			return;
		}
		this.options.onNotification(message);
	}

	private handleResponse(message: CodexJsonRpcMessage): void {
		if (message.id === undefined) {
			return;
		}
		const pending = this.pending.get(message.id);
		if (!pending) {
			return;
		}
		this.pending.delete(message.id);
		if (message.error) {
			pending.reject(new Error(message.error.message || `${pending.method} failed`));
			return;
		}
		pending.resolve(message.result);
	}

	private fail(error: Error): void {
		this.rejectPending(error);
		this.process = undefined;
		this.options.onFailure?.(error);
	}

	private rejectPending(error: Error): void {
		for (const pending of this.pending.values()) {
			pending.reject(error);
		}
		this.pending.clear();
	}
}
