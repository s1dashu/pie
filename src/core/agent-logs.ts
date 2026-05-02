import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentLogEntry } from "../desktop/shared/types.js";

const LOG_FILE = "agent-logs.jsonl";

export function getAgentLogsFilePath(homeDir: string): string {
	return join(homeDir, "runtime", LOG_FILE);
}

export function appendAgentLogEntry(homeDir: string, entry: AgentLogEntry): void {
	const filePath = getAgentLogsFilePath(homeDir);
	mkdirSync(dirname(filePath), { recursive: true });
	appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf8");
}

export function readAgentLogEntries(homeDir: string, limit = 1000): AgentLogEntry[] {
	const filePath = getAgentLogsFilePath(homeDir);
	if (!existsSync(filePath)) {
		return [];
	}
	const entriesById = new Map<number, AgentLogEntry>();
	for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		try {
			const parsed = JSON.parse(trimmed) as AgentLogEntry;
			if (
				typeof parsed.id === "number" &&
				typeof parsed.agentId === "string" &&
				typeof parsed.text === "string" &&
				typeof parsed.timestamp === "string" &&
				(parsed.stream === "stdout" || parsed.stream === "stderr" || parsed.stream === "system")
			) {
				entriesById.set(parsed.id, parsed);
			}
		} catch {
			// Ignore malformed append-only log lines.
		}
	}
	return [...entriesById.values()].sort((left, right) => left.id - right.id).slice(-limit);
}

export function pruneAgentLogEntries(homeDir: string, retentionDays?: number, now = Date.now()): void {
	pruneJsonlFile(getAgentLogsFilePath(homeDir), retentionDays, now);
}

export function pruneJsonlFile(filePath: string, retentionDays?: number, now = Date.now()): void {
	if (retentionDays === undefined || !existsSync(filePath)) {
		return;
	}
	const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
	const kept: string[] = [];
	for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		try {
			const parsed = JSON.parse(trimmed) as { timestamp?: unknown };
			if (typeof parsed.timestamp === "string") {
				const at = Date.parse(parsed.timestamp);
				if (Number.isFinite(at) && at >= cutoff) {
					kept.push(trimmed);
				}
			}
		} catch {
			// Drop malformed lines during compaction.
		}
	}
	const tempPath = `${filePath}.tmp`;
	mkdirSync(dirname(filePath), { recursive: true });
	if (kept.length) {
		writeFileSync(tempPath, `${kept.join("\n")}\n`, "utf8");
		renameSync(tempPath, filePath);
		return;
	}
	rmSync(filePath, { force: true });
	rmSync(tempPath, { force: true });
}
