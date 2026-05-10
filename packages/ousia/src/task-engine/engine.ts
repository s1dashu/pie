#!/usr/bin/env node

import { acquireEngineLock, releaseEngineLock } from "./engine-lock.js";
import {
	appendEngineEvent,
	createTaskEngineContext,
	ensureTaskEngineDirs,
	isProcessAlive,
	TASK_ENGINE_RELOAD_MS,
} from "./engine-context.js";
import { tickAgentTasks } from "./agent-delivery.js";
import { tickExecTasks } from "./exec-runner.js";
import { loadAgentTasks, loadExecTasks } from "./task-loader.js";
import { TaskStateStore } from "./task-state-store.js";
import type { LoadedAgentTask, LoadedExecTask } from "./runtime-types.js";

const ctx = createTaskEngineContext();
ensureTaskEngineDirs(ctx);

const execTasks = new Map<string, LoadedExecTask>();
const agentTasks = new Map<string, LoadedAgentTask>();
const stateStore = new TaskStateStore(ctx);
const persistedRuntimeState = stateStore.readPersistedRuntimeState();

function loadTasks(): void {
	loadExecTasks({ ctx, execTasks, stateStore, persistedRuntimeState });
	loadAgentTasks({ ctx, agentTasks, stateStore, persistedRuntimeState });
	stateStore.writeRuntimeSnapshot(execTasks.values(), agentTasks.values());
}

async function tickTasks(): Promise<void> {
	await tickExecTasks({
		ctx,
		stateStore,
		execTasks: execTasks.values(),
		agentTasks: agentTasks.values(),
	});
	await tickAgentTasks({
		ctx,
		stateStore,
		agentTasks,
		execTasks: execTasks.values(),
	});
}

appendEngineEvent(ctx, {
	type: "task_engine_start",
	homeDir: ctx.homeDir,
	taskDir: ctx.taskDir,
	gatewayPort: ctx.gatewayPort,
});

if (!acquireEngineLock(ctx)) {
	process.exit(0);
}

let shutdownStarted = false;
let reloadTimer: ReturnType<typeof setInterval>;

function shutdown(reason: string): void {
	if (shutdownStarted) {
		return;
	}
	shutdownStarted = true;
	clearInterval(reloadTimer);
	appendEngineEvent(ctx, { type: reason });
	releaseEngineLock(ctx);
	process.exit(0);
}

loadTasks();
reloadTimer = setInterval(() => {
	loadTasks();
	void tickTasks();
	if (!isProcessAlive(ctx.parentPid)) {
		shutdown("task_engine_parent_exit");
	}
}, TASK_ENGINE_RELOAD_MS);

process.on("SIGINT", () => {
	shutdown("task_engine_sigint");
});

process.on("SIGTERM", () => {
	shutdown("task_engine_sigterm");
});
