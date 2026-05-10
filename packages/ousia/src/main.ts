#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
	createRuntimeRunGatewayServer,
	createTaskEngineProcessManager,
	ensureDailySessionDistillationTask,
	ensureOusiaAgentHomeLayout,
	extractOusiaAssistantText,
	getOusiaSystemPromptFile,
	OusiaPiSessionPool,
} from "./index.js";

function readArg(name: string): string | undefined {
	const prefix = `${name}=`;
	for (let i = 2; i < process.argv.length; i++) {
		const arg = process.argv[i]!;
		if (arg === name && process.argv[i + 1]) {
			return process.argv[i + 1];
		}
		if (arg.startsWith(prefix)) {
			return arg.slice(prefix.length);
		}
	}
	return undefined;
}

function readPort(value: string | undefined, fallback: number): number {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function readSystemPrompt(): string | undefined {
	try {
		return readFileSync(getOusiaSystemPromptFile(), "utf8");
	} catch {
		return undefined;
	}
}

function getDefaultOusiaHomeDir(): string {
	return join(homedir(), ".ousia");
}

export async function runOusiaStandalone(): Promise<void> {
	const homeDir = readArg("--home") ?? process.env.OUSIA_HOME ?? getDefaultOusiaHomeDir();
	const workDir = readArg("--work-dir") ?? process.env.OUSIA_WORK_DIR ?? homeDir;
	const port = readPort(readArg("--port") ?? process.env.OUSIA_RUN_GATEWAY_PORT, 8766);
	const secret = readArg("--secret") ?? process.env.OUSIA_RUN_GATEWAY_SECRET;
	ensureOusiaAgentHomeLayout(homeDir);
	ensureDailySessionDistillationTask(homeDir);

	const sessions = new OusiaPiSessionPool({
		homeDir,
		assistantSystemPrompt: readSystemPrompt(),
		thinkingLevel: "off",
		tools: ["read", "write", "edit", "bash", "grep", "find", "ls"],
		debug: process.env.OUSIA_DEBUG === "1",
		verboseLogs: process.env.OUSIA_VERBOSE === "1",
		resumeSessions: process.env.OUSIA_RESUME_SESSIONS !== "0",
	});
	const gateway = createRuntimeRunGatewayServer({
		homeDir,
		hostPaths: { homeDir, workDir },
		port,
		secret,
		onRun: async (request) => {
			const session = await sessions.prompt(request.sessionKey, request.prompt);
			return { sessionKey: request.sessionKey, assistantText: extractOusiaAssistantText(session) };
		},
	});
	const taskEngine = createTaskEngineProcessManager({
		homeDir,
		workDir,
		channel: "standalone",
		gatewayPort: port,
		gatewaySecret: secret,
	});
	await gateway.start();
	taskEngine.start();
	console.log(`Ousia standalone runtime ready at http://127.0.0.1:${port}/agent/run`);

	const stop = async (): Promise<void> => {
		taskEngine.stop();
		await gateway.stop();
	};
	process.once("SIGINT", () => {
		void stop().finally(() => process.exit(130));
	});
	process.once("SIGTERM", () => {
		void stop().finally(() => process.exit(143));
	});
	setInterval(() => undefined, 60_000).unref();
}

const invokedEntryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";

if (import.meta.url === invokedEntryPoint) {
	runOusiaStandalone().catch((error: unknown) => {
		console.error(error instanceof Error ? error.stack ?? error.message : String(error));
		process.exit(1);
	});
}
