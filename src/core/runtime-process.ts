import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { RuntimeEnvironmentLifecycleSnapshot } from "../runtime/environment.js";

export interface RuntimeProcessRecord {
	pid: number;
	agentHome: string;
	startedAt: string;
	command: string[];
	gatewayPort?: number;
	webhookPort?: number;
}

export interface RuntimeStateRecord {
	version: 1;
	homeDir: string;
	workDir: string;
	lifecycle: RuntimeEnvironmentLifecycleSnapshot;
	process?: RuntimeProcessRecord;
	updatedAt: string;
}

export function getRuntimeProcessRecordPath(homeDir: string): string {
	return join(homeDir, "runtime", "process.json");
}

export function getRuntimeStateRecordPath(homeDir: string): string {
	return join(homeDir, "runtime", "runtime-state.json");
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

export function readRuntimeStateRecord(homeDir: string): RuntimeStateRecord | undefined {
	const path = getRuntimeStateRecordPath(homeDir);
	if (!existsSync(path)) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<RuntimeStateRecord>;
		if (!parsed.lifecycle || typeof parsed.lifecycle.state !== "string") {
			return undefined;
		}
		return {
			version: 1,
			homeDir: typeof parsed.homeDir === "string" && parsed.homeDir.trim() ? resolve(parsed.homeDir) : resolve(homeDir),
			workDir: typeof parsed.workDir === "string" && parsed.workDir.trim() ? resolve(parsed.workDir) : resolve(homeDir),
			lifecycle: {
				state: parsed.lifecycle.state,
				updatedAt: typeof parsed.lifecycle.updatedAt === "string" ? parsed.lifecycle.updatedAt : new Date(0).toISOString(),
				reason: typeof parsed.lifecycle.reason === "string" ? parsed.lifecycle.reason : undefined,
			} as RuntimeEnvironmentLifecycleSnapshot,
			process: parsed.process && typeof parsed.process.pid === "number"
				? {
						pid: parsed.process.pid,
						agentHome: typeof parsed.process.agentHome === "string" ? resolve(parsed.process.agentHome) : resolve(homeDir),
						startedAt: typeof parsed.process.startedAt === "string" ? parsed.process.startedAt : new Date(0).toISOString(),
						command: Array.isArray(parsed.process.command)
							? parsed.process.command.filter((item): item is string => typeof item === "string")
							: [],
						gatewayPort: typeof parsed.process.gatewayPort === "number" ? parsed.process.gatewayPort : undefined,
						webhookPort: typeof parsed.process.webhookPort === "number" ? parsed.process.webhookPort : undefined,
					}
				: undefined,
			updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
		};
	} catch {
		return undefined;
	}
}

export function writeRuntimeStateRecord(homeDir: string, record: Omit<RuntimeStateRecord, "version" | "updatedAt">): void {
	const path = getRuntimeStateRecordPath(homeDir);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(
		path,
		`${JSON.stringify({
			version: 1,
			...record,
			homeDir: resolve(record.homeDir),
			workDir: resolve(record.workDir),
			updatedAt: new Date().toISOString(),
		}, null, 2)}\n`,
		"utf8",
	);
}

export function isPidRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
