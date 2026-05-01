import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { atomicWriteFile } from "./file-utils.js";
import { appendEngineEvent, isProcessAlive, type TaskEngineContext } from "./engine-context.js";

function readJsonRecord(filePath: string): Record<string, unknown> | undefined {
	try {
		if (!existsSync(filePath)) {
			return undefined;
		}
		const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

export function acquireEngineLock(ctx: TaskEngineContext): boolean {
	const lockPayload = {
		pid: process.pid,
		parentPid: ctx.parentPid,
		host: hostname(),
		acquiredAt: new Date().toISOString(),
		homeDir: ctx.homeDir,
	};
	try {
		mkdirSync(ctx.engineLockDir);
		atomicWriteFile(join(ctx.engineLockDir, "lock.json"), `${JSON.stringify(lockPayload, null, 2)}\n`);
		return true;
	} catch {
		const lock = readJsonRecord(join(ctx.engineLockDir, "lock.json"));
		const existingPid = typeof lock?.pid === "number" ? lock.pid : undefined;
		if (existingPid != null && isProcessAlive(existingPid)) {
			appendEngineEvent(ctx, {
				type: "task_engine_lock_busy",
				lockDir: ctx.engineLockDir,
				ownerPid: existingPid,
			});
			return false;
		}
		try {
			rmSync(ctx.engineLockDir, { recursive: true, force: true });
			mkdirSync(ctx.engineLockDir);
			atomicWriteFile(join(ctx.engineLockDir, "lock.json"), `${JSON.stringify(lockPayload, null, 2)}\n`);
			appendEngineEvent(ctx, {
				type: "task_engine_lock_stolen",
				lockDir: ctx.engineLockDir,
				previousOwnerPid: existingPid,
			});
			return true;
		} catch (error) {
			appendEngineEvent(ctx, {
				type: "task_engine_lock_error",
				lockDir: ctx.engineLockDir,
				error: error instanceof Error ? error.message : String(error),
			});
			return false;
		}
	}
}

export function releaseEngineLock(ctx: TaskEngineContext): void {
	const lock = readJsonRecord(join(ctx.engineLockDir, "lock.json"));
	if (typeof lock?.pid === "number" && lock.pid !== process.pid) {
		return;
	}
	rmSync(ctx.engineLockDir, { recursive: true, force: true });
}
