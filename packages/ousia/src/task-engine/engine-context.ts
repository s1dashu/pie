import { appendFileSync, mkdirSync } from "node:fs";
import { hostname } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { OUSIA_ENV } from "../runtime/env.js";

export const TASK_SPEC_FILE = "task.json";
export const TASK_STATE_FILE = "state.json";
export const TASK_RUNS_FILE = "runs.jsonl";
export const TASK_ENGINE_RELOAD_MS = 5_000;

export interface TaskEngineContext {
	homeDir: string;
	parentPid: number;
	channel: string;
	taskDir: string;
	taskArchiveDir: string;
	projectsDir: string;
	runtimeDir: string;
	eventLogPath: string;
	statePath: string;
	engineLockDir: string;
	gatewayPort: number;
	gatewaySecret?: string;
}

function readPort(value: string | undefined, defaultValue: number): number {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isFinite(parsed) ? parsed : defaultValue;
}

export function createTaskEngineContext(env: NodeJS.ProcessEnv = process.env): TaskEngineContext {
	const homeDir =
		env[OUSIA_ENV.home]?.trim() ||
		env[OUSIA_ENV.workDir]?.trim() ||
		process.cwd();
	const parentPid = Number.parseInt(env[OUSIA_ENV.parentPid] ?? "", 10);
	const channel = env[OUSIA_ENV.hostChannel]?.trim() || "unknown";
	const taskDir = join(homeDir, "tasks");
	const runtimeDir = join(homeDir, "runtime");
	return {
		homeDir,
		parentPid,
		channel,
		taskDir,
		taskArchiveDir: join(taskDir, "archive"),
		projectsDir: join(homeDir, "projects"),
		runtimeDir,
		eventLogPath: join(runtimeDir, "task-engine-events.jsonl"),
		statePath: join(runtimeDir, "task-engine-state.json"),
		engineLockDir: join(runtimeDir, "task-engine.lock"),
		gatewayPort: readPort(env[OUSIA_ENV.runGatewayPort], 8766),
		gatewaySecret: env[OUSIA_ENV.runGatewaySecret]?.trim() || undefined,
	};
}

export function ensureTaskEngineDirs(ctx: TaskEngineContext): void {
	mkdirSync(ctx.taskDir, { recursive: true });
	mkdirSync(ctx.taskArchiveDir, { recursive: true });
	mkdirSync(ctx.runtimeDir, { recursive: true });
}

export function appendEngineEvent(ctx: TaskEngineContext, event: Record<string, unknown>): void {
	const payload = {
		timestamp: new Date().toISOString(),
		source: "ousia-task-engine",
		host: hostname(),
		channel: ctx.channel,
		parentPid: ctx.parentPid,
		enginePid: process.pid,
		...event,
	};
	appendFileSync(ctx.eventLogPath, `${JSON.stringify(payload)}\n`, "utf8");
}

export function isProcessAlive(pid: number): boolean {
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

export function resolveRelativeToHome(ctx: TaskEngineContext, filePath: string): string {
	return isAbsolute(filePath) ? filePath : resolve(ctx.homeDir, filePath);
}
