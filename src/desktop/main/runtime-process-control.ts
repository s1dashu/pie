import { clearRuntimeProcessRecord, isPidRunning, readLiveRuntimeProcessRecord, type RuntimeProcessRecord } from "../../core/runtime-process.js";

export interface StopLiveRuntimeProcessOptions {
	homeDir: string;
	forceKillMs?: number;
	afterSignalMs?: number;
}

export interface StopLiveRuntimeProcessResult {
	record?: RuntimeProcessRecord;
	stopped: boolean;
	forceKilled: boolean;
}

export function signalRuntimeProcess(pid: number, signal: NodeJS.Signals): void {
	if (process.platform !== "win32") {
		try {
			process.kill(-pid, signal);
			return;
		} catch {
			// Fall back to the direct process. The runtime may not be a process-group leader.
		}
	}
	try {
		process.kill(pid, signal);
	} catch {
		// best effort
	}
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!isPidRunning(pid)) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return !isPidRunning(pid);
}

export async function stopLiveRuntimeProcessRecord(
	options: StopLiveRuntimeProcessOptions,
): Promise<StopLiveRuntimeProcessResult> {
	const record = readLiveRuntimeProcessRecord(options.homeDir);
	if (!record) {
		clearRuntimeProcessRecord(options.homeDir);
		return { stopped: false, forceKilled: false };
	}
	const forceKillMs = options.forceKillMs ?? 5_000;
	const afterSignalMs = options.afterSignalMs ?? 500;
	signalRuntimeProcess(record.pid, "SIGTERM");
	let exited = await waitForProcessExit(record.pid, forceKillMs);
	let forceKilled = false;
	if (!exited && isPidRunning(record.pid)) {
		forceKilled = true;
		signalRuntimeProcess(record.pid, "SIGKILL");
		exited = await waitForProcessExit(record.pid, afterSignalMs);
	}
	clearRuntimeProcessRecord(options.homeDir);
	return { record, stopped: exited, forceKilled };
}
