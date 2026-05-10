import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUSIA_ENV } from "./env.js";

const DISTILLATION_TASK_ID = "session-distillation-daily";

function buildDistillationPrompt(): string {
	return [
		"Run Ousia daily session distillation maintenance.",
		"",
		"Inspect recent normalized agent events under runtime/agent-events.jsonl and any relevant session state under sessions/.",
		"Extract durable, useful information from the last day of user/agent work: decisions, preferences, project facts, open loops, and follow-up candidates.",
		"Do not preserve transient chatter, failed intermediate reasoning, or details that are only useful inside a single completed turn.",
		"",
		"Write the result to runtime/session-distillations/<YYYY-MM-DD>.md, using the scheduled date when available.",
		"Keep the note concise and structured. If there is nothing valuable to retain, write a short note saying no durable updates were found.",
		"Do not send an IM message; this is silent maintenance.",
	].join("\n");
}

export function ensureDailySessionDistillationTask(homeDir: string): string | undefined {
	if (process.env[OUSIA_ENV.disableDailyDistillation] === "1") {
		return undefined;
	}
	const taskDir = join(homeDir, "tasks", DISTILLATION_TASK_ID);
	const taskPath = join(taskDir, "task.json");
	if (existsSync(taskPath)) {
		return taskPath;
	}
	mkdirSync(taskDir, { recursive: true });
	writeFileSync(
		taskPath,
		`${JSON.stringify(
			{
				version: 1,
				id: DISTILLATION_TASK_ID,
				trigger: {
					type: "cron",
					cron: "0 0 * * *",
				},
				sessionKey: `maintenance:${DISTILLATION_TASK_ID}`,
				deliveryMode: "silent",
				prompt: buildDistillationPrompt(),
				deleteAfterRun: false,
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	return taskPath;
}
