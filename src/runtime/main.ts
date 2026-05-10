#!/usr/bin/env node

import process from "node:process";
import { getAgentHarnessDefinition, type AgentHarnessDefinition } from "../agents/harness-registry.js";
import { ensureAgentHomeLayout } from "../core/agent-home-layout.js";
import { loadAgentEnvIntoProcess, resolveAgentHomeDir } from "../core/agent-home.js";
import { getStoredProfile, loadConfigStore, type AgentProfile } from "../core/config-store.js";
import { writeRuntimeStateRecord } from "../core/runtime-process.js";
import { appendStartupSpan } from "../core/startup-spans.js";
import { createRuntimeEnvironment, ensureRuntimeEnvironment, RuntimeEnvironmentLifecycle, type AgentRuntimeEnvironment } from "./environment.js";
import { createChannelRuntimes, type ChannelRuntime } from "./channel-runtimes.js";
import { createRuntimeRunGatewayServer } from "./run-gateway.js";

function readPort(value: string | undefined, defaultValue: number): number {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isFinite(parsed) ? parsed : defaultValue;
}

function readBooleanEnv(value: string | undefined): boolean {
	if (!value) {
		return false;
	}
	return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
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

interface RuntimePlan {
	homeDir: string;
	profile: AgentProfile | undefined;
	environment: AgentRuntimeEnvironment;
	lifecycle: RuntimeEnvironmentLifecycle;
	harnessDefinition: AgentHarnessDefinition;
	channelRuntimes: ChannelRuntime[];
}

function createRuntimePlan(): RuntimePlan {
	loadAgentEnvIntoProcess({ agentHome: parseAgentHomeFromArgv(process.argv.slice(2)) });
	const homeDir = resolveAgentHomeDir();
	const profile = getStoredProfile(loadConfigStore());
	const lifecycle = new RuntimeEnvironmentLifecycle();
	const environment = createRuntimeEnvironment({ homeDir, profile, lifecycle });
	ensureRuntimeEnvironment(environment);
	ensureAgentHomeLayout(homeDir);
	const harnessDefinition = getAgentHarnessDefinition(profile?.harness.kind ?? "pi");
	const lifecycleHooks = harnessDefinition.lifecycleHooks;
	lifecycleHooks?.ensureAgentHomeLayout?.(homeDir);
	const channelRuntimes = createChannelRuntimes(profile, {
		developerMode: readBooleanEnv(process.env.PIE_DEVELOPER_MODE),
	});
	if (!channelRuntimes.length) {
		throw new Error("No enabled channel runtime is available for this profile.");
	}
	return { homeDir, profile, environment, lifecycle, harnessDefinition, channelRuntimes };
}

export async function runPie(): Promise<number> {
	const startedAt = Date.now();
	const plan = createRuntimePlan();
	const { homeDir, profile, environment, lifecycle, harnessDefinition, channelRuntimes } = plan;
	const lifecycleHooks = harnessDefinition.lifecycleHooks;
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
	const managedHarnessServiceExternal = process.env.PIE_MANAGED_HARNESS_SERVICE === "external";
	const taskEngine = lifecycleHooks?.createTaskEngineProcessManager
		? lifecycleHooks.createTaskEngineProcessManager({
				homeDir,
				environment,
				channel: primaryRuntime.identity.channel,
				gatewayPort,
				gatewaySecret,
			})
		: undefined;
	const harnessService = !managedHarnessServiceExternal && lifecycleHooks?.createManagedServiceManager
		? lifecycleHooks.createManagedServiceManager({
				homeDir,
				environment,
				config: profile?.harness.config,
				model: profile?.harness.model,
			})
		: undefined;
	const runGateway = lifecycleHooks?.createRunGatewayServer
		? lifecycleHooks.createRunGatewayServer({
				homeDir,
				environment,
				port: gatewayPort,
				secret: gatewaySecret,
				onRun: (request) => primaryRuntime.deliverRun(request),
				onCreateSession: primaryRuntime.createSession ? (sessionKey) => primaryRuntime.createSession!(sessionKey) : undefined,
				onGetSessionStatus: primaryRuntime.getSessionStatus ? (sessionKey) => primaryRuntime.getSessionStatus!(sessionKey) : undefined,
				onCompactSession: primaryRuntime.compactSession ? (sessionKey) => primaryRuntime.compactSession!(sessionKey) : undefined,
				onClearSession: primaryRuntime.clearSession ? (sessionKey) => primaryRuntime.clearSession!(sessionKey) : undefined,
			})
		: createRuntimeRunGatewayServer({
				port: gatewayPort,
				secret: gatewaySecret,
				onRun: (request) => primaryRuntime.deliverRun(request),
				onCreateSession: primaryRuntime.createSession ? (sessionKey) => primaryRuntime.createSession!(sessionKey) : undefined,
				onGetSessionStatus: primaryRuntime.getSessionStatus ? (sessionKey) => primaryRuntime.getSessionStatus!(sessionKey) : undefined,
				onCompactSession: primaryRuntime.compactSession ? (sessionKey) => primaryRuntime.compactSession!(sessionKey) : undefined,
				onClearSession: primaryRuntime.clearSession ? (sessionKey) => primaryRuntime.clearSession!(sessionKey) : undefined,
			});
	const keepAlive = setInterval(() => undefined, 60_000);
	const span = (name: string, meta?: Record<string, string | number | boolean | undefined>): void => {
		try {
			appendStartupSpan(homeDir, {
				name,
				harnessKind: harnessDefinition.kind,
				elapsedMs: Date.now() - startedAt,
				meta,
			});
		} catch {
			// Startup telemetry must never prevent runtime launch.
		}
	};

	const stopRuntime = (code: number): void => {
		for (const runtime of channelRuntimes) {
			runtime.setShutdownExitCode?.(code);
		}
		taskEngine?.stop();
		void harnessService?.stop();
		void runGateway?.stop();
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
	span("runtime_starting", { channelCount: channelRuntimes.length });
	await runGateway?.start();
	span("run_gateway_started", { enabled: Boolean(runGateway) });
	if (harnessService && harnessDefinition.kind === "openclaw") {
		void Promise.resolve(harnessService.start()).then(() => {
			span("harness_service_started", { enabled: true, background: true });
		}).catch((error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			lifecycle.mark("degraded", `harness-service-failed: ${message}`);
			persistLifecycle();
			span("harness_service_failed", { enabled: true, background: true, message });
			console.error(`[runtime] OpenClaw managed service failed: ${message}`);
		});
		span("harness_service_background_start", { enabled: true });
	} else {
		await harnessService?.start();
		span("harness_service_started", { enabled: Boolean(harnessService), background: false });
	}
	await taskEngine?.start();
	span("task_engine_started", { enabled: Boolean(taskEngine) });

	let failure: unknown;
	try {
		lifecycle.mark("running");
		persistLifecycle();
		span("runtime_running");
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
		clearInterval(keepAlive);
		taskEngine?.stop();
		await harnessService?.stop();
		await runGateway?.stop();
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
