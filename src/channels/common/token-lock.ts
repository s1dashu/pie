import { mkdirSync, openSync, closeSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

function lockPath(homeDir: string, channel: string, token: string): string {
	const digest = createHash("sha256").update(`${channel}:${token}`).digest("hex").slice(0, 24);
	return join(homeDir, "runtime", "channel-locks", `${channel}-${digest}.lock`);
}

export class ChannelTokenLock {
	private fd: number | undefined;
	private readonly path: string;

	constructor(homeDir: string, channel: string, token: string) {
		this.path = lockPath(homeDir, channel, token);
	}

	acquire(): void {
		mkdirSync(dirname(this.path), { recursive: true });
		try {
			this.fd = openSync(this.path, "wx");
			writeFileSync(this.fd, `${process.pid}\n${new Date().toISOString()}\n`, "utf8");
		} catch (error) {
			const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
			if (code === "EEXIST") {
				const pid = Number.parseInt(readFileSync(this.path, "utf8").split(/\r?\n/)[0] ?? "", 10);
				if (Number.isFinite(pid) && !isPidRunning(pid)) {
					unlinkSync(this.path);
					return this.acquire();
				}
				throw new Error("同一个渠道 token 已被另一个 Pie Agent 进程占用，请停止旧 Agent 或换用独立 token。");
			}
			throw error;
		}
	}

	release(): void {
		if (this.fd === undefined) {
			return;
		}
		try {
			closeSync(this.fd);
		} catch {
			// best effort
		}
		this.fd = undefined;
		try {
			unlinkSync(this.path);
		} catch {
			// best effort
		}
	}
}

function isPidRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
