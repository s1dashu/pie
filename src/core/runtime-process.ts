import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface RuntimeProcessRecord {
	pid: number;
	agentHome: string;
	startedAt: string;
	command: string[];
	gatewayPort?: number;
	webhookPort?: number;
}

export function getRuntimeProcessRecordPath(homeDir: string): string {
	return join(homeDir, "runtime", "process.json");
}

export function readRuntimeProcessRecord(homeDir: string): RuntimeProcessRecord | undefined {
	const path = getRuntimeProcessRecordPath(homeDir);
	if (!existsSync(path)) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<RuntimeProcessRecord>;
		if (typeof parsed.pid !== "number" || !Number.isFinite(parsed.pid)) {
			return undefined;
		}
		if (typeof parsed.agentHome !== "string" || !parsed.agentHome.trim()) {
			return undefined;
		}
		return {
			pid: parsed.pid,
			agentHome: resolve(parsed.agentHome),
			startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : new Date(0).toISOString(),
			command: Array.isArray(parsed.command) ? parsed.command.filter((item): item is string => typeof item === "string") : [],
			gatewayPort: typeof parsed.gatewayPort === "number" ? parsed.gatewayPort : undefined,
			webhookPort: typeof parsed.webhookPort === "number" ? parsed.webhookPort : undefined,
		};
	} catch {
		return undefined;
	}
}

export function writeRuntimeProcessRecord(homeDir: string, record: RuntimeProcessRecord): void {
	const path = getRuntimeProcessRecordPath(homeDir);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ ...record, agentHome: resolve(record.agentHome) }, null, 2)}\n`, "utf8");
}

export function clearRuntimeProcessRecord(homeDir: string): void {
	rmSync(getRuntimeProcessRecordPath(homeDir), { force: true });
}

export function isPidRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
