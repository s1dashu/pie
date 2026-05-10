#!/usr/bin/env node

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { OUSIA_ENV } from "../runtime/env.js";

const homeDir =
	process.env[OUSIA_ENV.home]?.trim() ||
	process.env[OUSIA_ENV.workDir]?.trim() ||
	process.cwd();
const parentPid = Number.parseInt(process.env[OUSIA_ENV.parentPid] ?? "", 10);
const channel = process.env[OUSIA_ENV.hostChannel]?.trim() || "unknown";
const runtimeDir = join(homeDir, "runtime");
const heartbeatLogPath = join(runtimeDir, "heartbeat.jsonl");
const latestSnapshotPath = join(runtimeDir, "heartbeat-latest.json");
const heartbeatMs = 10_000;

mkdirSync(runtimeDir, { recursive: true });
writeFileSync(latestSnapshotPath, "", "utf8");

function appendEvent(event: Record<string, unknown>): void {
	const payload = {
		timestamp: new Date().toISOString(),
	source: "ousia-task-engine",
		channel,
		parentPid,
		enginePid: process.pid,
		...event,
	};
	const line = `${JSON.stringify(payload)}\n`;
	appendFileSync(heartbeatLogPath, line, "utf8");
	writeFileSync(latestSnapshotPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function isParentAlive(pid: number): boolean {
	if (!Number.isFinite(pid) || pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function getParentSnapshot(pid: number): Record<string, unknown> {
	if (!isParentAlive(pid)) {
		return { alive: false };
	}
	if (process.platform === "win32") {
		return { alive: true };
	}
	const ps = spawnSync("ps", ["-o", "pid=,ppid=,rss=,%cpu=,etime=,state=,command=", "-p", String(pid)], {
		encoding: "utf8",
	});
	const text = ps.stdout.trim();
	return {
		alive: true,
		ps: text || undefined,
	};
}

function buildHeartbeat(): Record<string, unknown> {
	return {
		type: "runtime_heartbeat",
		host: hostname(),
		homeDir,
		engineUptimeSec: Math.round(process.uptime()),
		engineMemory: process.memoryUsage(),
		parent: getParentSnapshot(parentPid),
	};
}

function shutdown(type: string): void {
	appendEvent({
		type,
		host: hostname(),
		homeDir,
		parent: getParentSnapshot(parentPid),
	});
	process.exit(0);
}

appendEvent({
	type: "runtime_start",
	host: hostname(),
	homeDir,
	nodeVersion: process.version,
	platform: process.platform,
	parent: getParentSnapshot(parentPid),
});

const timer = setInterval(() => {
	if (!isParentAlive(parentPid)) {
		clearInterval(timer);
		shutdown("parent_exit_detected");
		return;
	}
	appendEvent(buildHeartbeat());
}, heartbeatMs);

process.on("SIGINT", () => {
	clearInterval(timer);
	shutdown("task_engine_sigint");
});

process.on("SIGTERM", () => {
	clearInterval(timer);
	shutdown("task_engine_sigterm");
});
