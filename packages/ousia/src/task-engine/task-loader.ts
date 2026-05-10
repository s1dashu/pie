import { buildTaskKey, type LoadedAgentTask, type LoadedExecTask } from "./runtime-types.js";
import { appendEngineEvent, type TaskEngineContext } from "./engine-context.js";
import { inferProjectIdFromFilePath, listTaskSpecFiles, parseTaskSpec, readTaskSpecFile } from "./task-discovery.js";
import type { PersistedRuntimeState, TaskStateStore } from "./task-state-store.js";

export function loadExecTasks(params: {
	ctx: TaskEngineContext;
	execTasks: Map<string, LoadedExecTask>;
	stateStore: TaskStateStore;
	persistedRuntimeState: PersistedRuntimeState;
}): void {
	const { ctx, execTasks, stateStore, persistedRuntimeState } = params;
	const files = listTaskSpecFiles(ctx);
	const seenKeys = new Set<string>();

	for (const filePath of files) {
		try {
			const file = readTaskSpecFile(filePath);
			const isRecordRaw = file.raw !== null && typeof file.raw === "object";
			const parsedSpec = isRecordRaw ? parseTaskSpec(file.raw).execTask : undefined;
			if (!parsedSpec) {
				continue;
			}
			const spec = parsedSpec.projectId ? parsedSpec : { ...parsedSpec, projectId: inferProjectIdFromFilePath(ctx, filePath) };
			if (!spec.enabled) {
				continue;
			}
			const taskKey = buildTaskKey("exec", spec);
			if (seenKeys.has(taskKey)) {
				throw new Error(`Duplicate execTask key: ${taskKey}`);
			}
			seenKeys.add(taskKey);
			const existing = execTasks.get(taskKey);
			if (existing && existing.filePath === filePath && existing.mtimeMs === file.mtimeMs) {
				continue;
			}
			execTasks.set(taskKey, {
				spec,
				filePath,
				mtimeMs: file.mtimeMs,
				state:
					existing?.state ??
					stateStore.restoreExecTaskState(
						filePath,
						persistedRuntimeState.execTaskStates.get(taskKey) ?? persistedRuntimeState.execTaskStates.get(spec.id),
					),
			});
			stateStore.writeExecTaskState(execTasks.get(taskKey)!);
			appendEngineEvent(ctx, {
				type: "execTask_loaded",
				execTaskId: spec.id,
				taskKey,
				projectId: spec.projectId,
				trigger: spec.trigger.type,
				filePath,
			});
		} catch (error) {
			appendEngineEvent(ctx, {
				type: "execTask_load_error",
				filePath,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	for (const [taskKey, execTask] of execTasks.entries()) {
		if (seenKeys.has(taskKey)) {
			continue;
		}
		execTasks.delete(taskKey);
		appendEngineEvent(ctx, { type: "execTask_removed", execTaskId: execTask.spec.id, taskKey, filePath: execTask.filePath });
	}
}

export function loadAgentTasks(params: {
	ctx: TaskEngineContext;
	agentTasks: Map<string, LoadedAgentTask>;
	stateStore: TaskStateStore;
	persistedRuntimeState: PersistedRuntimeState;
}): void {
	const { ctx, agentTasks, stateStore, persistedRuntimeState } = params;
	const files = listTaskSpecFiles(ctx);
	const seenKeys = new Set<string>();

	for (const filePath of files) {
		try {
			const file = readTaskSpecFile(filePath);
			const isRecordRaw = file.raw !== null && typeof file.raw === "object";
			const parsedSpec = isRecordRaw ? parseTaskSpec(file.raw).agentTask : undefined;
			if (!parsedSpec) {
				continue;
			}
			const spec = parsedSpec.projectId ? parsedSpec : { ...parsedSpec, projectId: inferProjectIdFromFilePath(ctx, filePath) };
			if (!spec.enabled) {
				continue;
			}
			const taskKey = buildTaskKey("agent", spec);
			if (seenKeys.has(taskKey)) {
				throw new Error(`Duplicate agentTask key: ${taskKey}`);
			}
			seenKeys.add(taskKey);
			const existing = agentTasks.get(taskKey);
			if (existing && existing.filePath === filePath && existing.mtimeMs === file.mtimeMs) {
				continue;
			}
			agentTasks.set(taskKey, {
				spec,
				filePath,
				mtimeMs: file.mtimeMs,
				state:
					existing && existing.filePath === filePath && existing.mtimeMs === file.mtimeMs
						? existing.state
						: stateStore.restoreAgentTaskState(
								filePath,
								persistedRuntimeState.agentTaskStates.get(taskKey) ??
									persistedRuntimeState.agentTaskStates.get(spec.id),
							),
			});
			stateStore.writeAgentTaskState(agentTasks.get(taskKey)!);
			appendEngineEvent(ctx, {
				type: "agent_task_loaded",
				agentTaskId: spec.id,
				taskKey,
				projectId: spec.projectId,
				filePath,
				trigger: spec.trigger,
			});
		} catch (error) {
			appendEngineEvent(ctx, {
				type: "agent_task_load_error",
				filePath,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	for (const [taskKey, agentTask] of agentTasks.entries()) {
		if (seenKeys.has(taskKey)) {
			continue;
		}
		agentTasks.delete(taskKey);
		appendEngineEvent(ctx, { type: "agent_task_removed", agentTaskId: agentTask.spec.id, taskKey, filePath: agentTask.filePath });
	}
}
