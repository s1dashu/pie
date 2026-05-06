import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { totalmem } from "node:os";
import { join, resolve } from "node:path";
import type { AgentResourceStats } from "../shared/types.js";

type ProcessStats = Pick<AgentResourceStats, "cpuPercent" | "memoryBytes" | "memoryPercent" | "pid" | "running">;
type StorageStats = Pick<AgentResourceStats, "storageBytes" | "diskTotalBytes" | "diskAvailableBytes">;

interface ProcessResourceRow {
	pid: number;
	ppid: number;
	rssKb: number;
	cpuPercent: number;
	cpuTimeSeconds: number;
	command: string;
}

interface CpuStatsSample {
	cpuTimeSeconds: number;
	sampledAt: number;
}

const storageStatsCache = new Map<string, { value: StorageStats; expiresAt: number }>();
const cpuStatsCache = new Map<string, CpuStatsSample>();

export function readAgentProcessResourceStats(pid: number | undefined, homeDir: string): ProcessStats {
	const rows = readProcessResourceRows();
	if (!rows.length) {
		return { cpuPercent: 0, memoryBytes: 0, memoryPercent: 0, running: false };
	}
	const selectedPids = pid ? findDescendantPids(pid, rows) : new Set<number>();
	for (const row of rows) {
		if (isAgentProcessForHome(row, homeDir)) {
			for (const descendantPid of findDescendantPids(row.pid, rows)) {
				selectedPids.add(descendantPid);
			}
		}
	}
	const selectedRows = rows.filter((row) => selectedPids.has(row.pid));
	if (!selectedRows.length) {
		return { cpuPercent: 0, memoryBytes: 0, memoryPercent: 0, ...(pid ? { pid } : {}), running: false };
	}
	const memoryBytes = selectedRows.reduce((total, row) => total + row.rssKb * 1024, 0);
	const cpuTimeSeconds = selectedRows.reduce((total, row) => total + row.cpuTimeSeconds, 0);
	const fallbackCpuPercent = selectedRows.reduce((total, row) => total + row.cpuPercent, 0);
	const previousCpuStats = cpuStatsCache.get(homeDir);
	const sampledAt = Date.now();
	const elapsedSeconds = previousCpuStats ? (sampledAt - previousCpuStats.sampledAt) / 1000 : 0;
	const cpuPercent =
		previousCpuStats && elapsedSeconds > 0
			? ((cpuTimeSeconds - previousCpuStats.cpuTimeSeconds) / elapsedSeconds) * 100
			: fallbackCpuPercent;
	cpuStatsCache.set(homeDir, { cpuTimeSeconds, sampledAt });
	const primaryPid =
		pid ??
		selectedRows.find((row) => row.command.includes("src/runtime/main.ts") || row.command.includes("dist/runtime/main.js"))?.pid ??
		selectedRows[0]?.pid;
	return {
		cpuPercent: Math.max(0, cpuPercent),
		memoryBytes: Math.max(0, memoryBytes),
		memoryPercent: Math.max(0, (memoryBytes / totalmem()) * 100),
		...(primaryPid ? { pid: primaryPid } : {}),
		running: true,
	};
}

export function readAgentStorageResourceStats(path: string, options: { refresh?: boolean } = {}): StorageStats {
	const cached = storageStatsCache.get(path);
	if (options.refresh === false) {
		return cached?.value ?? { storageBytes: 0 };
	}
	if (cached && cached.expiresAt > Date.now()) {
		return cached.value;
	}
	const value = {
		storageBytes: readDirectorySize(path),
		...readDiskStats(path),
	};
	storageStatsCache.set(path, { value, expiresAt: Date.now() + 15_000 });
	return value;
}

function readDirectorySize(path: string): number {
	if (!existsSync(path)) {
		return 0;
	}
	try {
		const stat = lstatSync(path);
		if (!stat.isDirectory()) {
			return stat.size;
		}
		return readdirSync(path).reduce((total, child) => total + readDirectorySize(join(path, child)), 0);
	} catch {
		return 0;
	}
}

function readDiskStats(path: string): { diskTotalBytes?: number; diskAvailableBytes?: number } {
	const df = spawnSync("df", ["-k", path], { encoding: "utf8" });
	if (df.status !== 0 || !df.stdout.trim()) {
		return {};
	}
	const line = df.stdout.trim().split("\n").at(-1);
	if (!line) {
		return {};
	}
	const parts = line.trim().split(/\s+/);
	const totalKb = Number(parts[1]);
	const availableKb = Number(parts[3]);
	return {
		...(Number.isFinite(totalKb) ? { diskTotalBytes: totalKb * 1024 } : {}),
		...(Number.isFinite(availableKb) ? { diskAvailableBytes: availableKb * 1024 } : {}),
	};
}

function readProcessResourceRows(): ProcessResourceRow[] {
	const ps = spawnSync("ps", ["-axo", "pid=,ppid=,rss=,%cpu=,time=,command="], { encoding: "utf8" });
	if (ps.status !== 0 || !ps.stdout.trim()) {
		return [];
	}
	return ps.stdout.split("\n").flatMap((line) => {
		const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(.+)$/);
		if (!match) {
			return [];
		}
		const [, pidText, ppidText, rssText, cpuText, timeText, command] = match;
		const pid = Number(pidText);
		const ppid = Number(ppidText);
		const rssKb = Number(rssText);
		const cpuPercent = Number(cpuText);
		const cpuTimeSeconds = parseCpuTimeSeconds(timeText);
		if (![pid, ppid, rssKb, cpuPercent, cpuTimeSeconds].every(Number.isFinite)) {
			return [];
		}
		return [{ pid, ppid, rssKb, cpuPercent, cpuTimeSeconds, command }];
	});
}

function parseCpuTimeSeconds(value: string): number {
	const [dayOrTime, rest] = value.includes("-") ? value.split("-", 2) : ["0", value];
	const days = Number(dayOrTime);
	const parts = rest.split(":").map(Number);
	if (parts.some((part) => !Number.isFinite(part))) {
		return 0;
	}
	const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, parts[0] ?? 0, parts[1] ?? 0];
	return days * 86_400 + hours * 3_600 + minutes * 60 + seconds;
}

function readExpandedProcessCommand(pid: number): string {
	const ps = spawnSync("ps", ["eww", "-p", String(pid), "-o", "command="], { encoding: "utf8", maxBuffer: 1024 * 1024 });
	return ps.status === 0 ? ps.stdout : "";
}

function findDescendantPids(rootPid: number, rows: ProcessResourceRow[]): Set<number> {
	const descendants = new Set<number>([rootPid]);
	let changed = true;
	while (changed) {
		changed = false;
		for (const row of rows) {
			if (!descendants.has(row.pid) && descendants.has(row.ppid)) {
				descendants.add(row.pid);
				changed = true;
			}
		}
	}
	return descendants;
}

function isAgentProcessForHome(row: ProcessResourceRow, homeDir: string): boolean {
	if (
		!/src\/runtime\/main\.ts|dist\/runtime\/main\.js|src\/frameworks\/ousia\/task-engine\/|dist\/frameworks\/ousia\/task-engine\//.test(
			row.command,
		)
	) {
		return false;
	}
	return readExpandedProcessCommand(row.pid).includes(`PIE_AGENT_HOME=${resolve(homeDir)}`);
}
