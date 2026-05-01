#!/usr/bin/env node

import { mkdirSync } from "node:fs";
import process from "node:process";
import { ensureAgentHomeLayout } from "../core/agent-home-layout.js";
import { loadConfig } from "../channels/feishu/config.js";
import { createFeishuBotRuntime } from "../channels/feishu/main.js";
import { createRuntimeTurnGatewayServer } from "./runtime-turn-gateway.js";
import { createTaskEngineProcessManager } from "./task-engine-process.js";

function readPort(value: string | undefined, defaultValue: number): number {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isFinite(parsed) ? parsed : defaultValue;
}

export async function runPie(): Promise<number> {
	const config = loadConfig();
	mkdirSync(config.homeDir, { recursive: true });
	ensureAgentHomeLayout(config.homeDir);

	const gatewayPort = readPort(
		process.env.PIE_GATEWAY_PORT,
		8766,
	);
	const gatewaySecret =
		process.env.PIE_GATEWAY_SECRET?.trim() ||
		undefined;
	const taskEngine = createTaskEngineProcessManager({
		homeDir: config.homeDir,
		channel: "feishu",
		gatewayPort,
		gatewaySecret,
	});
	const channelRuntime = createFeishuBotRuntime(config);
	const turnGateway = createRuntimeTurnGatewayServer({
		homeDir: config.homeDir,
		port: gatewayPort,
		secret: gatewaySecret,
		onTurn: (request) => channelRuntime.deliverTurn(request),
	});

	const stopRuntime = (code: number): void => {
		channelRuntime.setShutdownExitCode(code);
		taskEngine.stop();
		void turnGateway.stop();
		void channelRuntime.stop();
	};
	const onSigint = (): void => stopRuntime(130);
	const onSigterm = (): void => stopRuntime(143);
	process.once("SIGINT", onSigint);
	process.once("SIGTERM", onSigterm);
	await turnGateway.start();
	taskEngine.start();

	try {
		return await channelRuntime.start();
	} finally {
		process.off("SIGINT", onSigint);
		process.off("SIGTERM", onSigterm);
		taskEngine.stop();
		await turnGateway.stop();
		await channelRuntime.stop();
	}
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
	const code = await runPie().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	});
	process.exit(code);
}
