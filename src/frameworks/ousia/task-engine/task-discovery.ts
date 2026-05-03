import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { TASK_SPEC_FILE, TASK_STATE_FILE, type TaskEngineContext } from "./engine-context.js";
import type { AgentTaskSpec } from "./agent-task-types.js";
import { parseAgentTaskSpec } from "./agent-task-types.js";
import type { ExecTaskSpec } from "./task-types.js";
import { parseExecTaskSpec } from "./task-types.js";

export interface TaskSpecFile {
	filePath: string;
	mtimeMs: number;
	raw: unknown;
}

export function resolveEntryWorkingDirectory(entryFilePath: string): string {
	if (entryFilePath.endsWith(`/${TASK_SPEC_FILE}`)) {
		return dirname(entryFilePath);
	}
	return dirname(entryFilePath);
}

function listSpecFiles(
	dir: string,
	{
		canonicalFileName,
		ignoredRootDirs = [],
	}: {
		canonicalFileName: string;
		ignoredRootDirs?: string[];
	},
): string[] {
	if (!existsSync(dir)) {
		return [];
	}
	const ignored = new Set(ignoredRootDirs);
	const results: string[] = [];

	function visit(currentDir: string, isRoot: boolean): void {
		const entries = readdirSync(currentDir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
		for (const entry of entries) {
			const filePath = join(currentDir, entry.name);
			if (entry.isDirectory()) {
				if (isRoot && ignored.has(entry.name)) {
					continue;
				}
				visit(filePath, false);
				continue;
			}
			if (!entry.isFile()) {
				continue;
			}
			if (entry.name === canonicalFileName) {
				results.push(filePath);
				continue;
			}
			if (isRoot && entry.name.endsWith(".json") && entry.name !== TASK_STATE_FILE) {
				results.push(filePath);
			}
		}
	}

	visit(dir, true);
	return results;
}

function listProjectScopedSpecFiles(
	ctx: TaskEngineContext,
	containerDirName: "tasks",
	canonicalFileName: string,
	ignoredRootDirs: string[] = [],
): string[] {
	if (!existsSync(ctx.projectsDir)) {
		return [];
	}
	const results: string[] = [];
	for (const projectName of readdirSync(ctx.projectsDir).sort((left, right) => left.localeCompare(right))) {
		const projectPath = join(ctx.projectsDir, projectName);
		if (!statSync(projectPath).isDirectory()) {
			continue;
		}
		const containerPath = join(projectPath, containerDirName);
		for (const filePath of listSpecFiles(containerPath, { canonicalFileName, ignoredRootDirs })) {
			results.push(filePath);
		}
	}
	return results;
}

export function inferProjectIdFromFilePath(ctx: TaskEngineContext, filePath: string): string | undefined {
	const relativePath = relative(ctx.projectsDir, filePath);
	if (!relativePath || relativePath.startsWith("..")) {
		return undefined;
	}
	const [projectId] = relativePath.split(sep);
	return projectId?.trim() || undefined;
}

export function listTaskSpecFiles(ctx: TaskEngineContext): string[] {
	return [
		...listSpecFiles(ctx.taskDir, {
			canonicalFileName: TASK_SPEC_FILE,
			ignoredRootDirs: ["archive"],
		}),
		...listProjectScopedSpecFiles(ctx, "tasks", TASK_SPEC_FILE, ["archive"]),
	];
}

export function readTaskSpecFile(filePath: string): TaskSpecFile {
	return {
		filePath,
		mtimeMs: statSync(filePath).mtimeMs,
		raw: JSON.parse(readFileSync(filePath, "utf8")) as unknown,
	};
}

export function parseTaskSpec(raw: unknown): { execTask?: ExecTaskSpec; agentTask?: AgentTaskSpec } {
	if (!raw || typeof raw !== "object") {
		throw new Error("Task must be an object.");
	}
	const record = raw as Record<string, unknown>;
	const action = record.action && typeof record.action === "object" ? (record.action as Record<string, unknown>) : undefined;
	const actionType = typeof action?.type === "string" ? action.type : undefined;
	if (actionType === "agent" || typeof record.prompt === "string") {
		const prompt = typeof action?.prompt === "string" ? action.prompt : record.prompt;
		return {
			agentTask: parseAgentTaskSpec({
				...record,
				prompt,
				sessionKey: typeof action?.sessionKey === "string" ? action.sessionKey : record.sessionKey,
				deleteAfterRun: action?.deleteAfterRun ?? record.deleteAfterRun,
			}),
		};
	}
	if (actionType === "exec" || record.run) {
		return {
			execTask: parseExecTaskSpec({
				...record,
				run: actionType === "exec" ? action : record.run,
			}),
		};
	}
	throw new Error("Task action must be `agent` or `exec`.");
}
