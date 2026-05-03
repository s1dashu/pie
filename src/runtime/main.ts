#!/usr/bin/env node

import { mkdirSync } from "node:fs";
import process from "node:process";
import { resolveBackendFramework, type BackendFrameworkDefinition } from "../core/backend-framework.js";
import { ensureAgentHomeLayout } from "../core/agent-home-layout.js";
import { loadAgentEnvIntoProcess, resolveAgentHomeDir } from "../core/agent-home.js";
import { getStoredProfile, loadConfigStore, type ChannelKind } from "../core/config-store.js";
import { loadConfig } from "../channels/feishu/config.js";
import { createFeishuBotRuntime } from "../channels/feishu/main.js";
import { loadConfig as loadWechatConfig } from "../channels/wechat/config.js";
import { createWechatBotRuntime } from "../channels/wechat/main.js";
import { loadConfig as loadSlackConfig } from "../channels/slack/config.js";
import { createSlackBotRuntime } from "../channels/slack/main.js";
import { loadConfig as loadDiscordConfig } from "../channels/discord/config.js";
import { createDiscordBotRuntime } from "../channels/discord/main.js";
import { loadConfig as loadTelegramConfig } from "../channels/telegram/config.js";
import { createTelegramBotRuntime } from "../channels/telegram/main.js";
import { createRuntimeTurnGatewayServer } from "./runtime-turn-gateway.js";
import { createTaskEngineProcessManager } from "./task-engine-process.js";
import type { AgentTurnPort, ManagedRuntime } from "./types.js";

function readPort(value: string | undefined, defaultValue: number): number {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isFinite(parsed) ? parsed : defaultValue;
}

function parseAgentHomeFromArgv(argv: string[]): string | undefined {
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		if (arg === "--home" && argv[i + 1]) {
			return argv[i + 1];
		}
		if (arg.startsWith("--home=")) {
			return arg.slice("--home=".length);
		}
	}
	return undefined;
}

type ChannelRuntime = ManagedRuntime & AgentTurnPort & { setShutdownExitCode?: (code: number) => void };

interface RuntimePlan {
	homeDir: string;
	framework: BackendFrameworkDefinition;
	channelRuntimes: ChannelRuntime[];
}

function createChannelRuntimes(channelKinds: ChannelKind[]): ChannelRuntime[] {
	const runtimes: ChannelRuntime[] = [];
	for (const kind of channelKinds) {
		if (kind === "feishu") {
			runtimes.push(createFeishuBotRuntime(loadConfig()));
			continue;
		}
		if (kind === "wechat") {
			runtimes.push(createWechatBotRuntime(loadWechatConfig()));
			continue;
		}
		if (kind === "slack") {
			runtimes.push(createSlackBotRuntime(loadSlackConfig()));
			continue;
		}
		if (kind === "discord") {
			runtimes.push(createDiscordBotRuntime(loadDiscordConfig()));
			continue;
		}
		if (kind === "telegram") {
			runtimes.push(createTelegramBotRuntime(loadTelegramConfig()));
		}
	}
	return runtimes;
}

function createRuntimePlan(): RuntimePlan {
	loadAgentEnvIntoProcess({ agentHome: parseAgentHomeFromArgv(process.argv.slice(2)) });
	const homeDir = resolveAgentHomeDir();
	mkdirSync(homeDir, { recursive: true });
	ensureAgentHomeLayout(homeDir);
	const profile = getStoredProfile(loadConfigStore());
	const framework = resolveBackendFramework(profile?.backend.kind);
	const enabledChannels = profile?.channels.filter((channel) => channel.enabled !== false) ?? [];
	const channelKinds: ChannelKind[] = enabledChannels.length
		? enabledChannels.map((channel) => channel.kind)
		: ["feishu"];
	const channelRuntimes = createChannelRuntimes(channelKinds);
	if (!channelRuntimes.length) {
		throw new Error("No enabled channel runtime is available for this profile.");
	}
	return { homeDir, framework, channelRuntimes };
}

export async function runPie(): Promise<number> {
	const plan = createRuntimePlan();
	const { homeDir, framework, channelRuntimes } = plan;
	const primaryRuntime = channelRuntimes[0]!;

	const gatewayPort = readPort(
		process.env.PIE_GATEWAY_PORT,
		8766,
	);
	const gatewaySecret =
		process.env.PIE_GATEWAY_SECRET?.trim() ||
		undefined;
	const taskEngine = framework.startTaskEngine
		? createTaskEngineProcessManager({
				homeDir,
				channel: primaryRuntime.identity.channel,
				gatewayPort,
				gatewaySecret,
			})
		: undefined;
	const turnGateway = framework.startTurnGateway
		? createRuntimeTurnGatewayServer({
				homeDir,
				port: gatewayPort,
				secret: gatewaySecret,
				onTurn: (request) => primaryRuntime.deliverTurn(request),
			})
		: undefined;

	const stopRuntime = (code: number): void => {
		for (const runtime of channelRuntimes) {
			runtime.setShutdownExitCode?.(code);
		}
		taskEngine?.stop();
		void turnGateway?.stop();
		for (const runtime of channelRuntimes) {
			void runtime.stop();
		}
	};
	const onSigint = (): void => stopRuntime(130);
	const onSigterm = (): void => stopRuntime(143);
	process.once("SIGINT", onSigint);
	process.once("SIGTERM", onSigterm);
	await turnGateway?.start();
	taskEngine?.start();

	try {
		return await Promise.race(channelRuntimes.map((runtime) => runtime.start()));
	} finally {
		process.off("SIGINT", onSigint);
		process.off("SIGTERM", onSigterm);
		taskEngine?.stop();
		await turnGateway?.stop();
		await Promise.all(channelRuntimes.map((runtime) => runtime.stop()));
	}
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
	const code = await runPie().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	});
	process.exit(code);
}
