#!/usr/bin/env node

import process from "node:process";
import { getAgentBackendDefinition, type AgentBackendDefinition } from "../agents/backend-registry.js";
import { ensureAgentHomeLayout } from "../core/agent-home-layout.js";
import { loadAgentEnvIntoProcess, resolveAgentHomeDir } from "../core/agent-home.js";
import { getStoredProfile, loadConfigStore, type ChannelKind } from "../core/config-store.js";
import { writeRuntimeStateRecord } from "../core/runtime-process.js";
import { createRuntimeEnvironment, ensureRuntimeEnvironment, RuntimeEnvironmentLifecycle, type AgentRuntimeEnvironment } from "./environment.js";
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
	environment: AgentRuntimeEnvironment;
	lifecycle: RuntimeEnvironmentLifecycle;
	backend: AgentBackendDefinition;
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
	const profile = getStoredProfile(loadConfigStore());
	const lifecycle = new RuntimeEnvironmentLifecycle();
	const environment = createRuntimeEnvironment({ homeDir, profile, lifecycle });
	ensureRuntimeEnvironment(environment);
	ensureAgentHomeLayout(homeDir);
	const backend = getAgentBackendDefinition(profile?.backend.kind ?? "pi");
	const framework = backend.frameworkRuntime;
	framework.ensureAgentHomeLayout?.(homeDir);
	const enabledChannels = profile?.channels.filter((channel) => channel.enabled !== false) ?? [];
	const channelKinds: ChannelKind[] = enabledChannels.length
		? enabledChannels.map((channel) => channel.kind)
		: ["feishu"];
	const channelRuntimes = createChannelRuntimes(channelKinds);
	if (!channelRuntimes.length) {
		throw new Error("No enabled channel runtime is available for this profile.");
	}
	return { homeDir, environment, lifecycle, backend, channelRuntimes };
}

export async function runPie(): Promise<number> {
	const plan = createRuntimePlan();
	const { homeDir, environment, lifecycle, backend, channelRuntimes } = plan;
	const framework = backend.frameworkRuntime;
	process.chdir(environment.workDir);
	const primaryRuntime = channelRuntimes[0]!;
	const persistLifecycle = (): void => {
		writeRuntimeStateRecord(homeDir, {
			homeDir: environment.homeDir,
			workDir: environment.workDir,
			lifecycle: lifecycle.snapshot,
			process: {
				pid: process.pid,
				agentHome: homeDir,
				startedAt: lifecycle.snapshot.updatedAt,
				command: process.argv,
				gatewayPort,
			},
		});
	};

	const gatewayPort = readPort(
		process.env.PIE_GATEWAY_PORT,
		8766,
	);
	const gatewaySecret =
		process.env.PIE_GATEWAY_SECRET?.trim() ||
		undefined;
	const taskEngine = framework.createTaskEngineProcessManager
		? framework.createTaskEngineProcessManager({
				homeDir,
				environment,
				channel: primaryRuntime.identity.channel,
				gatewayPort,
				gatewaySecret,
			})
		: undefined;
	const backendService = backend.createManagedServiceManager
		? backend.createManagedServiceManager({
				homeDir,
				environment,
				config: getStoredProfile(loadConfigStore())?.backend.config,
			})
		: undefined;
	const turnGateway = framework.createTurnGatewayServer
		? framework.createTurnGatewayServer({
				homeDir,
				environment,
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
		backendService?.stop();
		void turnGateway?.stop();
		for (const runtime of channelRuntimes) {
			void runtime.stop();
		}
	};
	const onSigint = (): void => stopRuntime(130);
	const onSigterm = (): void => stopRuntime(143);
	process.once("SIGINT", onSigint);
	process.once("SIGTERM", onSigterm);
	lifecycle.mark("starting");
	persistLifecycle();
	await turnGateway?.start();
	await backendService?.start();
	await taskEngine?.start();

	let failure: unknown;
	try {
		lifecycle.mark("running");
		persistLifecycle();
		return await Promise.race(channelRuntimes.map((runtime) => runtime.start()));
	} catch (error) {
		failure = error;
		lifecycle.mark("failed", error instanceof Error ? error.message : String(error));
		writeRuntimeStateRecord(homeDir, {
			homeDir: environment.homeDir,
			workDir: environment.workDir,
			lifecycle: lifecycle.snapshot,
		});
		throw error;
	} finally {
		if (!failure) {
			lifecycle.mark("stopping");
			persistLifecycle();
		}
		process.off("SIGINT", onSigint);
		process.off("SIGTERM", onSigterm);
		taskEngine?.stop();
		backendService?.stop();
		await turnGateway?.stop();
		await Promise.all(channelRuntimes.map((runtime) => runtime.stop()));
		if (!failure) {
			lifecycle.mark("stopped");
			writeRuntimeStateRecord(homeDir, {
				homeDir: environment.homeDir,
				workDir: environment.workDir,
				lifecycle: lifecycle.snapshot,
			});
		}
	}
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
	const code = await runPie().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	});
	process.exit(code);
}
