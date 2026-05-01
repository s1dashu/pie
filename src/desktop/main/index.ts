import { app, BrowserWindow, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	deleteProfileRegistryEntry,
	getDefaultPieRootDir,
	loadProfileRegistry,
	registerProfileHome,
	updateProfileRegistryEntry,
} from "../../core/profile-registry.js";
import { getAgentEnvFilePath, readAgentEnvFile, upsertAgentEnv } from "../../core/agent-home.js";
import {
	getPrimaryFeishuChannel,
	getProfileModel,
	normalizeConfigStore,
	setProfileModel,
	upsertFeishuChannel,
	type AgentConfigStore,
} from "../../core/config-store.js";
import { appendAgentUsageEvent, readAgentUsageEvents, summarizeAgentUsage } from "../../core/usage-stats.js";
import { LarkClient } from "../../channels/feishu/platform/core/lark-client.js";
import type {
	AgentCreationDraft,
	AgentDetails,
	AgentDraft,
	AgentOnboardEvent,
	AgentSummary,
	DesktopModelCatalog,
	DesktopFeishuAppCredentials,
} from "../shared/types.js";
import {
	beginAgentCreation as beginCreationSession,
	completeAgentCreation as completeCreationSession,
	createFeishuAppForSession,
	loadModelCatalog,
} from "./onboard-service.js";
import { AgentProcessManager } from "./agent-process-manager.js";

const agentOperations = new Map<string, Promise<unknown>>();

function getAppRoot(): string {
	return app.isPackaged ? app.getAppPath() : process.cwd();
}

function getNodeExecPath(): string {
	const npmNodeExecPath = process.env.npm_node_execpath?.trim();
	if (npmNodeExecPath && existsSync(npmNodeExecPath)) {
		return npmNodeExecPath;
	}
	const argvNodePath = process.argv.find((arg) => /(?:^|[/\\])node(?:\.exe)?$/.test(arg));
	if (argvNodePath && existsSync(argvNodePath)) {
		return argvNodePath;
	}
	return "node";
}

function readProfileConfig(homeDir: string): AgentConfigStore | undefined {
	const path = join(homeDir, "config.json");
	if (!existsSync(path)) {
		return undefined;
	}
	return normalizeConfigStore(JSON.parse(readFileSync(path, "utf8")) as unknown);
}

function writeProfileConfig(homeDir: string, store: AgentConfigStore): void {
	mkdirSync(homeDir, { recursive: true });
	writeFileSync(join(homeDir, "config.json"), `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function readProfileEnv(homeDir: string): Record<string, string> {
	return readAgentEnvFile(getAgentEnvFilePath(homeDir));
}

const agentProcesses = new AgentProcessManager({
	getAppRoot,
	getNodeExecPath,
	async getAgentHome(agentId) {
		return (await getAgent(agentId)).home;
	},
	async recordRuntimeEvent(agentId, event, reason) {
		const agent = await getAgent(agentId);
		appendAgentUsageEvent(agent.home, {
			type: "runtime",
			runtimeEvent: event,
			...(reason ? { reason } : {}),
		});
	},
});

function statusForProfile(id: string, enabled: boolean): AgentSummary["status"] {
	if (agentProcesses.isRunning(id)) {
		return "running";
	}
	return enabled ? "paused" : "terminated";
}

async function withAgentOperation<T>(id: string, operation: () => Promise<T>): Promise<T> {
	const previous = agentOperations.get(id) ?? Promise.resolve();
	const current = previous.catch(() => undefined).then(operation);
	agentOperations.set(id, current);
	try {
		return await current;
	} finally {
		if (agentOperations.get(id) === current) {
			agentOperations.delete(id);
		}
	}
}

function profileHomeFromEntry(rootDir: string, entryHome: string): string {
	return resolve(rootDir, entryHome);
}

async function listAgents(): Promise<AgentSummary[]> {
	const registry = loadProfileRegistry();
	const rootDir = getDefaultPieRootDir();
	return Object.entries(registry.profiles).map(([id, entry]) => {
		const home = profileHomeFromEntry(rootDir, entry.home);
		const config = readProfileConfig(home);
		const model = getProfileModel(config?.profile);
		const channel = getPrimaryFeishuChannel(config?.profile);
		const modelLabel = model?.provider && model?.model ? `${model.provider}/${model.model}` : undefined;
		return {
			id,
			name: entry.displayName || id,
			status: statusForProfile(id, entry.enabled),
			avatarSeed: id,
			enabled: entry.enabled,
			active: registry.activeProfile === id,
			home,
			createdAt: entry.createdAt,
			updatedAt: entry.updatedAt,
			modelLabel,
			appId: channel?.appId,
		};
	});
}

async function getAgent(id: string): Promise<AgentDetails> {
	const agents = await listAgents();
	const summary = agents.find((agent) => agent.id === id);
	if (!summary) {
		throw new Error(`Unknown agent: ${id}`);
	}
	const config = readProfileConfig(summary.home);
	const env = readProfileEnv(summary.home);
	const profile = config?.profile;
	const channel = getPrimaryFeishuChannel(profile);
	return {
		...summary,
		brand: channel?.brand,
		appSecret: env.FEISHU_APP_SECRET,
		model: getProfileModel(profile),
	};
}

async function getAgentUsage(id: string) {
	const agent = await getAgent(id);
	return summarizeAgentUsage(readAgentUsageEvents(agent.home), { runningSince: agentProcesses.getStartedAt(id) });
}

async function getAgentModelCatalog(id: string): Promise<DesktopModelCatalog> {
	const agent = await getAgent(id);
	return loadModelCatalog(agent.home);
}

async function validateFeishuCredentials(opts: {
	appId: string;
	appSecret: string;
	brand: "feishu" | "lark";
}): Promise<void> {
	const result = await LarkClient.fromCredentials({
		accountId: `desktop-validate-${Date.now()}`,
		appId: opts.appId,
		appSecret: opts.appSecret,
		brand: opts.brand,
	}).probe();
	if (!result.ok) {
		throw new Error(`飞书渠道验证失败：${result.error ?? "无法获取 bot 信息"}`);
	}
}

async function updateAgent(id: string, draft: AgentDraft): Promise<AgentDetails> {
	const agent = await getAgent(id);
	const current = readProfileConfig(agent.home) ?? { version: 3 };
	const currentProfile = current.profile;
	const channel = getPrimaryFeishuChannel(currentProfile) ?? {
		kind: "feishu" as const,
		id: "feishu",
		enabled: true,
		appId: "",
		brand: "feishu" as const,
	};
	const model = getProfileModel(currentProfile) ?? {};
	const hasChannelUpdate = draft.appId !== undefined || draft.appSecret !== undefined || draft.brand !== undefined;
	const nextAppId = draft.appId ?? channel.appId;
	const nextBrand = draft.brand ?? channel.brand ?? "feishu";
	const nextAppSecret = draft.appSecret ?? readProfileEnv(agent.home).FEISHU_APP_SECRET ?? "";
	if (hasChannelUpdate) {
		if (!nextAppId.trim() || !nextAppSecret.trim()) {
			throw new Error("飞书 App ID 和 App Secret 必填");
		}
		await validateFeishuCredentials({
			appId: nextAppId.trim(),
			appSecret: nextAppSecret.trim(),
			brand: nextBrand,
		});
	}
	const nextProfileWithChannel = upsertFeishuChannel(currentProfile, {
		...channel,
		appId: nextAppId.trim(),
		brand: nextBrand,
	});
	const nextProfile = setProfileModel(nextProfileWithChannel, {
		...model,
		provider: draft.provider ?? model.provider,
		model: draft.model ?? model.model,
		thinkingLevel: draft.thinkingLevel ?? model.thinkingLevel,
		outputToolCallsToIm: draft.outputToolCallsToIm ?? model.outputToolCallsToIm,
	});
	writeProfileConfig(agent.home, {
		...current,
		version: 3,
		profile: nextProfile,
	});
	if (hasChannelUpdate) {
		upsertAgentEnv({ FEISHU_APP_SECRET: nextAppSecret.trim() }, agent.home);
	}
	if (draft.name && draft.name !== agent.name) {
		registerProfileHome(id, {
			displayName: draft.name,
			enabled: agent.enabled,
			active: agent.active,
		});
	}
	return getAgent(id);
}

async function startAgent(id: string): Promise<AgentDetails> {
	if (agentProcesses.isRunning(id)) {
		updateProfileRegistryEntry(id, { enabled: true, active: true });
		return getAgent(id);
	}
	await agentProcesses.start(id);
	updateProfileRegistryEntry(id, { enabled: true, active: true });
	return getAgent(id);
}

async function pauseAgent(id: string): Promise<AgentDetails> {
	await stopRunningAgent(id);
	return getAgent(id);
}

async function stopRunningAgent(id: string): Promise<void> {
	if (!agentProcesses.isRunning(id)) {
		updateProfileRegistryEntry(id, { enabled: false });
		return;
	}
	await agentProcesses.stop(id, "paused");
	updateProfileRegistryEntry(id, { enabled: false });
}

async function deleteAgent(id: string): Promise<void> {
	const agent = await getAgent(id);
	await stopRunningAgent(id);
	deleteProfileRegistryEntry(id);
	if (agent.home.startsWith(resolve(getDefaultPieRootDir(), "profiles"))) {
		rmSync(agent.home, { recursive: true, force: true });
	}
}

async function openAgentInEditor(id: string): Promise<void> {
	const agent = await getAgent(id);
	const editor = process.env.EDITOR?.trim() || process.env.VISUAL?.trim();
	if (editor) {
		const child = spawn(editor, [agent.home], {
			cwd: getAppRoot(),
			detached: true,
			stdio: "ignore",
		});
		child.unref();
		return;
	}
	const result = await shell.openPath(agent.home);
	if (result) {
		throw new Error(result);
	}
}

async function revealAgentInFinder(id: string): Promise<void> {
	const agent = await getAgent(id);
	const result = await shell.openPath(agent.home);
	if (result) {
		throw new Error(result);
	}
}

function emitOnboardEvent(event: AgentOnboardEvent): void {
	for (const win of BrowserWindow.getAllWindows()) {
		win.webContents.send("agents:onboard-event", event);
	}
}

function createWindow(): void {
	const appRoot = app.getAppPath();
	const preloadPath = join(appRoot, "out/preload/index.cjs");
	const win = new BrowserWindow({
		width: 960,
		height: 540,
		minWidth: 800,
		minHeight: 480,
		show: false,
		title: "Pie",
		transparent: true,
		frame: false,
		hasShadow: false,
		titleBarStyle: "hiddenInset",
		trafficLightPosition: { x: 18, y: 18 },
		backgroundColor: "#00000000",
		visualEffectState: "active",
		webPreferences: {
			preload: preloadPath,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	win.once("ready-to-show", () => {
		win.show();
		win.focus();
		if (process.platform === "darwin") {
			app.focus({ steal: true });
		}
	});

	win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
		console.error(`[desktop] failed to load ${validatedURL}: ${errorCode} ${errorDescription}`);
	});

	if (process.env.ELECTRON_RENDERER_URL) {
		void win.loadURL(process.env.ELECTRON_RENDERER_URL).catch((error) => {
			console.error("[desktop] loadURL failed:", error);
		});
	} else {
		void win.loadFile(join(appRoot, "out/renderer/index.html")).catch((error) => {
			console.error("[desktop] loadFile failed:", error);
		});
	}
}

app.whenReady().then(() => {
	ipcMain.handle("agents:list", async () => {
		try {
			return await listAgents();
		} catch (error) {
			console.error("[ipc] agents:list failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:create-begin", async () => {
		try {
			return beginCreationSession();
		} catch (error) {
			console.error("[ipc] agents:create-begin failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:create-feishu-app", async (_event, sessionId: string): Promise<DesktopFeishuAppCredentials> => {
		try {
			return await createFeishuAppForSession(sessionId, emitOnboardEvent);
		} catch (error) {
			console.error("[ipc] agents:create-feishu-app failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:create-complete", async (_event, draft: AgentCreationDraft) => {
		try {
			completeCreationSession(draft);
			return await getAgent(draft.sessionId);
		} catch (error) {
			console.error("[ipc] agents:create-complete failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:get", async (_event, id: string) => {
		try {
			return await getAgent(id);
		} catch (error) {
			console.error("[ipc] agents:get failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:update", async (_event, id: string, draft: AgentDraft) => {
		try {
			return await withAgentOperation(id, () => updateAgent(id, draft));
		} catch (error) {
			console.error("[ipc] agents:update failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:start", async (_event, id: string) => {
		try {
			return await withAgentOperation(id, () => startAgent(id));
		} catch (error) {
			console.error("[ipc] agents:start failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:pause", async (_event, id: string) => {
		try {
			return await withAgentOperation(id, () => pauseAgent(id));
		} catch (error) {
			console.error("[ipc] agents:pause failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:delete", async (_event, id: string) => {
		try {
			await withAgentOperation(id, () => deleteAgent(id));
		} catch (error) {
			console.error("[ipc] agents:delete failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:open-editor", async (_event, id: string) => {
		try {
			await openAgentInEditor(id);
		} catch (error) {
			console.error("[ipc] agents:open-editor failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:reveal-finder", async (_event, id: string) => {
		try {
			await revealAgentInFinder(id);
		} catch (error) {
			console.error("[ipc] agents:reveal-finder failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:usage", async (_event, id: string) => {
		try {
			return await getAgentUsage(id);
		} catch (error) {
			console.error("[ipc] agents:usage failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:model-catalog", async (_event, id: string) => {
		try {
			return await getAgentModelCatalog(id);
		} catch (error) {
			console.error("[ipc] agents:model-catalog failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:logs", async (_event, id: string) => {
		return agentProcesses.getLogs(id);
	});
	createWindow();
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) {
		createWindow();
	}
});

app.on("before-quit", () => {
	void agentProcesses.stopAll("quit");
});
