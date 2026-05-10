import { app, BrowserWindow, Tray, dialog, ipcMain, nativeImage, powerSaveBlocker, screen, shell } from "electron";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
	deleteProfileRegistryEntry,
	getDefaultPieRootDir,
	getProfileHomeDir,
	loadProfileRegistry,
	registerProfileHome,
	updateProfileRegistryEntry,
} from "../../core/profile-registry.js";
import { getAgentEnvFilePath, readAgentEnvFile, upsertAgentEnv } from "../../core/agent-home.js";
import { getDefaultResumeSessionsForHarness } from "../../core/session-policy.js";
import {
	getPrimaryFeishuChannel,
	getPrimaryDiscordChannel,
	getPrimarySlackChannel,
	getPrimaryTelegramChannel,
	getPrimaryWechatChannel,
	getImBehavior,
	getProfileModel,
	loadConfigStore,
	saveConfigStore,
	upsertFeishuChannel,
	upsertDiscordChannel,
	type AgentConfigStore,
} from "../../core/config-store.js";
import { appendAgentLogEntry, pruneAgentLogEntries, readAgentLogEntries } from "../../core/agent-logs.js";
import { appendAgentUsageEvent, pruneAgentUsageEvents, readAgentUsageEvents, summarizeAgentUsage } from "../../core/usage-stats.js";
import { appendAgentSessionEvent, clearAgentSessionEvents, readAgentSessionEvents } from "../../agents/event-sink.js";
import { resolveSkillSources } from "../../agents/skills.js";
import {
	clearRuntimeProcessRecord,
	readLiveRuntimeProcessRecord,
	readRuntimeStateRecord,
} from "../../core/runtime-process.js";
import { LarkClient } from "../../channels/feishu/platform/core/lark-client.js";
import type {
	AgentChangeEvent,
	AgentCreationDraft,
	AgentAvatarUpload,
	AgentChatClearResult,
	AgentChatSendResult,
	AgentChatSessionCommandResult,
	AgentDeleteEvent,
	AgentDetails,
	AgentDesiredState,
	AgentDraft,
	AgentEventLogEntry,
	AgentLogEntry,
	AgentOnboardEvent,
	AgentResourceStats,
	AgentSkillSource,
	AgentSystemPromptSource,
	AgentSummary,
	BotAvatarOption,
	DesktopCodexDiagnostic,
	DesktopQuitEvent,
	DesktopModelCatalog,
	DesktopFeishuAppCredentials,
	DesktopManagedRuntimeKind,
	DesktopManagedRuntimeStatus,
	DesktopRuntimeDiagnostic,
	DesktopWechatCredentials,
	DesktopSettings,
	DesktopSettingsDraft,
	DesktopBootstrap,
	ProviderCredentialReuse,
	RuntimeEnvironmentSummary,
} from "../shared/types.js";
import {
	beginAgentCreation as beginCreationSession,
	checkCodexEnvironmentForDesktop,
	checkHermesEnvironmentForDesktop,
	cancelAllHermesInstallsForDesktop,
	cancelHermesInstallForDesktop,
	checkManagedRuntimeForDesktop,
	completeAgentCreation as completeCreationSession,
	createFeishuAppForSession,
	fetchDiscordBotProfileForSession,
	createWechatLoginForSession,
	deriveHermesApiServerPort,
	getProviderCredentialEnv,
	installCodexForDesktop,
	installHermesForDesktop,
	uninstallManagedRuntimeForDesktop,
	upgradeManagedRuntimeForDesktop,
	findPieProfileClaimingHermesHome,
	loadHermesModelCatalog,
	loadCodexModelCatalog,
	loadOpenClawModelCatalog,
	loadModelCatalog,
	loadModelOptions,
	listImportableHarnessProfiles,
	openCodexLoginForDesktop,
	toHermesInferenceProvider,
} from "./onboard-service.js";
import { AgentProcessManager } from "./agent-process-manager.js";
import { AgentStartLimiter } from "./agent-start-limiter.js";
import {
	calculateAgentStartBudget,
	getAgentStartWeight,
	readAgentStartResourceSnapshot,
	shouldDeferAutoStartForResources,
} from "./agent-start-policy.js";
import { readDesktopSettings, retentionToDays, updateDesktopSettings } from "./desktop-settings.js";
import { createRuntimeEnvironment } from "../../runtime/environment.js";
import { getAgentHarnessDefinition } from "../../agents/harness-registry.js";
import type { HarnessLifecycleHooks } from "../../core/agent-harness.js";
import { readAgentProcessResourceStats, readAgentStorageResourceStats } from "./resource-observer.js";
import { writeAgentRuntimeLifecycle, writeRuntimeLifecycle } from "./runtime-lifecycle-state.js";
import { planAgentProfileMutation } from "./agent-profile-mutation.js";
import { getRestoreDelayMs } from "./agent-restore-schedule.js";
import { getSharedHarnessServiceInfo, sharedHarnessServices } from "./shared-harness-services.js";
import { stopLiveRuntimeProcessRecord } from "./runtime-process-control.js";

const agentOperations = new Map<string, Promise<unknown>>();
const profileAvatarDataUrlCache = new Map<string, { mtimeMs: number; size: number; dataUrl: string }>();
const PROFILE_AVATAR_STEM = "avatar";
const PROFILE_AVATAR_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"] as const;
const RUNTIME_STOP_FORCE_KILL_MS = 5000;
const RESTORE_AGENTS_ON_LAUNCH_DELAY_MS = 500;
const STORED_RUNTIME_DATA_PRUNE_DELAY_MS = 3_000;
const agentStartLimiter = new AgentStartLimiter({
	limits: { hermes: 1, openclaw: 1 },
	getWeight: (harnessKind) => {
		const serviceState = getSharedHarnessServiceInfo(harnessKind)?.lifecycle.state;
		if (harnessKind === "openclaw" && serviceState === "running") {
			return 1;
		}
		return getAgentStartWeight(harnessKind);
	},
	getBudget: () => calculateAgentStartBudget(readAgentStartResourceSnapshot()),
});
let isQuitting = false;
let didStopAgentsForQuit = false;
const restoringAgentIds = new Set<string>();
let mainWindow: BrowserWindow | undefined;
let menuBarWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let keepAwakeBlockerId: number | undefined;

function logUnhandledMainProcessError(kind: string, error: unknown): void {
	console.error(`[desktop] ${kind}:`, error);
}

process.on("unhandledRejection", (reason) => {
	logUnhandledMainProcessError("unhandled rejection", reason);
});

process.on("uncaughtException", (error) => {
	logUnhandledMainProcessError("uncaught exception", error);
});

function getAppRoot(): string {
	return app.isPackaged ? app.getAppPath() : process.cwd();
}

function getBotAvatarsDir(): string {
	return join(getAppRoot(), "resources", "bot-avatars");
}

function imageMimeFromPath(path: string): string {
	const ext = extname(path).toLowerCase();
	if (ext === ".jpg" || ext === ".jpeg") {
		return "image/jpeg";
	}
	if (ext === ".webp") {
		return "image/webp";
	}
	return "image/png";
}

function readImageDataUrl(path: string): string | undefined {
	if (!existsSync(path)) {
		return undefined;
	}
	const data = readFileSync(path).toString("base64");
	return `data:${imageMimeFromPath(path)};base64,${data}`;
}

function avatarExtensionFromUpload(upload: AgentAvatarUpload): string {
	const mime = upload.dataUrl.match(/^data:([^;,]+);base64,/)?.[1]?.toLowerCase();
	if (mime === "image/png") {
		return ".png";
	}
	if (mime === "image/jpeg" || mime === "image/jpg") {
		return ".jpg";
	}
	if (mime === "image/webp") {
		return ".webp";
	}
	const fileExt = extname(upload.fileName).toLowerCase();
	if (PROFILE_AVATAR_EXTENSIONS.includes(fileExt as (typeof PROFILE_AVATAR_EXTENSIONS)[number])) {
		return fileExt === ".jpeg" ? ".jpg" : fileExt;
	}
	throw new Error("头像仅支持 PNG、JPG、JPEG 或 WebP 图片");
}

function profileAvatarPath(homeDir: string): string | undefined {
	for (const ext of PROFILE_AVATAR_EXTENSIONS) {
		const candidate = join(homeDir, `${PROFILE_AVATAR_STEM}${ext}`);
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

function clearProfileAvatarFiles(homeDir: string): void {
	profileAvatarDataUrlCache.delete(homeDir);
	for (const ext of PROFILE_AVATAR_EXTENSIONS) {
		rmSync(join(homeDir, `${PROFILE_AVATAR_STEM}${ext}`), { force: true });
	}
}

function copyImageToProfileAvatar(source: string, homeDir: string): void {
	const ext = extname(source).toLowerCase();
	if (!PROFILE_AVATAR_EXTENSIONS.includes(ext as (typeof PROFILE_AVATAR_EXTENSIONS)[number])) {
		throw new Error("头像仅支持 PNG、JPG、JPEG 或 WebP 图片");
	}
	mkdirSync(homeDir, { recursive: true });
	clearProfileAvatarFiles(homeDir);
	copyFileSync(source, join(homeDir, `${PROFILE_AVATAR_STEM}${ext}`));
}

function writeUploadToProfileAvatar(upload: AgentAvatarUpload, homeDir: string): void {
	const ext = avatarExtensionFromUpload(upload);
	const base64 = upload.dataUrl.replace(/^data:[^;,]+;base64,/, "");
	if (!base64 || base64 === upload.dataUrl) {
		throw new Error("头像图片数据无效");
	}
	const data = Buffer.from(base64, "base64");
	if (!data.length) {
		throw new Error("头像图片为空");
	}
	mkdirSync(homeDir, { recursive: true });
	clearProfileAvatarFiles(homeDir);
	writeFileSync(join(homeDir, `${PROFILE_AVATAR_STEM}${ext}`), data);
}

function avatarExtensionFromContent(contentType: string | null, url: string): ".png" | ".jpg" | ".webp" {
	const type = contentType?.split(";")[0]?.trim().toLowerCase();
	if (type === "image/png") {
		return ".png";
	}
	if (type === "image/jpeg" || type === "image/jpg") {
		return ".jpg";
	}
	if (type === "image/webp") {
		return ".webp";
	}
	const pathExt = extname(new URL(url).pathname).toLowerCase();
	if (PROFILE_AVATAR_EXTENSIONS.includes(pathExt as (typeof PROFILE_AVATAR_EXTENSIONS)[number])) {
		return pathExt === ".jpeg" ? ".jpg" : pathExt as ".png" | ".jpg" | ".webp";
	}
	return ".png";
}

async function downloadRemoteAvatarToProfile(url: string | undefined, homeDir: string): Promise<boolean> {
	if (!url?.trim()) {
		return false;
	}
	try {
		const response = await fetch(url.trim());
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
		const contentType = response.headers.get("content-type");
		const mediaType = contentType?.split(";")[0]?.trim().toLowerCase();
		if (mediaType === "image/gif") {
			throw new Error("GIF avatars are not supported for profile storage");
		}
		const ext = avatarExtensionFromContent(contentType, url.trim());
		const data = Buffer.from(await response.arrayBuffer());
		if (!data.length) {
			throw new Error("empty response");
		}
		mkdirSync(homeDir, { recursive: true });
		clearProfileAvatarFiles(homeDir);
		writeFileSync(join(homeDir, `${PROFILE_AVATAR_STEM}${ext}`), data);
		return true;
	} catch (error) {
		console.warn("[desktop] failed to download remote app avatar:", error);
		return false;
	}
}

function botAvatarLabel(fileName: string): string {
	const stem = fileName.replace(/\.[^.]+$/, "");
	return stem
		.split("-")
		.map((part) => {
			if (part.toLowerCase() === "y2k") {
				return "Y2K";
			}
			if (!part) {
				return part;
			}
			return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
		})
		.join(" ");
}

/** Old Chinese filenames still referenced in saved profile config. */
const LEGACY_BOT_AVATAR_IDS: Record<string, string> = {
	"复古港风.png": "retro-hong-kong.png",
	"多巴胺Y2K风格女秘书1.png": "y2k-pop.png",
	"多巴胺Y2K风格女秘书2.png": "y2k-candy.png",
	"学院风.png": "preppy.png",
	"彩色针织西装.png": "knit-blazer.png",
	"洛丽塔洋装.png": "lolita.png",
	"甜酷机车风格.png": "moto-cool.png",
	"田园风.png": "cottagecore.png",
};

function listBotAvatarFiles(): Array<{ id: string; fileName: string; path: string }> {
	const dir = getBotAvatarsDir();
	if (!existsSync(dir)) {
		return [];
	}
	return readdirSync(dir)
		.filter((fileName) => /\.(png|jpe?g|webp)$/i.test(fileName))
		.sort((left, right) => left.localeCompare(right))
		.map((fileName) => ({
			id: fileName,
			fileName,
			path: join(dir, fileName),
		}));
}

async function listBotAvatars(): Promise<BotAvatarOption[]> {
	return listBotAvatarFiles().map((entry) => ({
		id: entry.id,
		fileName: entry.fileName,
		label: botAvatarLabel(entry.fileName),
		dataUrl: readImageDataUrl(entry.path) ?? "",
	}));
}

function resolveBotAvatarPath(id: string): string {
	const legacy = LEGACY_BOT_AVATAR_IDS[id];
	const resolvedId = legacy ?? id;
	const match = listBotAvatarFiles().find((entry) => entry.id === resolvedId);
	if (!match) {
		throw new Error(`Unknown bot avatar: ${id}`);
	}
	return match.path;
}

async function downloadBotAvatar(id: string): Promise<void> {
	const source = resolveBotAvatarPath(id);
	const defaultPath = join(app.getPath("downloads"), basename(source));
	const result = await (dialog.showSaveDialog as unknown as (options: Electron.SaveDialogOptions) => Promise<Electron.SaveDialogReturnValue | string>)({
		title: "下载头像",
		defaultPath,
		filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
	});
	const filePath = typeof result === "string" ? result : result.canceled ? undefined : result.filePath;
	if (!filePath) {
		return;
	}
	copyFileSync(source, filePath);
}

function readProfileAvatarUrl(homeDir: string): string | undefined {
	const source = profileAvatarPath(homeDir);
	if (!source) {
		profileAvatarDataUrlCache.delete(homeDir);
		return undefined;
	}
	try {
		const stat = statSync(source);
		const cached = profileAvatarDataUrlCache.get(homeDir);
		if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
			return cached.dataUrl;
		}
		const dataUrl = readImageDataUrl(source);
		if (!dataUrl) {
			profileAvatarDataUrlCache.delete(homeDir);
			return undefined;
		}
		profileAvatarDataUrlCache.set(homeDir, { mtimeMs: stat.mtimeMs, size: stat.size, dataUrl });
		return dataUrl;
	} catch {
		profileAvatarDataUrlCache.delete(homeDir);
		return undefined;
	}
}

async function uploadAgentAvatar(id: string, upload: AgentAvatarUpload): Promise<AgentDetails> {
	const agent = await getAgent(id);
	writeUploadToProfileAvatar(upload, agent.home);
	return getAgent(id);
}

async function downloadAgentAvatar(id: string): Promise<void> {
	const agent = await getAgent(id);
	const source = profileAvatarPath(agent.home);
	if (!source) {
		throw new Error("当前 Agent 还没有可下载的头像文件");
	}
	const defaultPath = join(app.getPath("downloads"), `${agent.id}-${basename(source)}`);
	const result = await dialog.showSaveDialog({
		title: "下载头像",
		defaultPath,
		filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
	});
	const filePath = result.canceled ? undefined : result.filePath;
	if (!filePath) {
		return;
	}
	copyFileSync(source, filePath);
}

function getNodeExecPath(): string {
	if (app.isPackaged) {
		const executableName = basename(process.execPath);
		const contentsDir = dirname(dirname(process.execPath));
		const helperExecPath = join(
			contentsDir,
			"Frameworks",
			`${executableName} Helper.app`,
			"Contents",
			"MacOS",
			`${executableName} Helper`,
		);
		return existsSync(helperExecPath) ? helperExecPath : process.execPath;
	}
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
	return loadConfigStore(homeDir);
}

function writeProfileConfig(homeDir: string, store: AgentConfigStore): void {
	saveConfigStore(store, homeDir);
}

function readProfileEnv(homeDir: string): Record<string, string> {
	return readAgentEnvFile(getAgentEnvFilePath(homeDir));
}

function readSkillNames(path: string): string[] {
	if (!existsSync(path)) {
		return [];
	}
	try {
		return readdirSync(path)
			.filter((name) => !name.startsWith("."))
			.filter((name) => {
				try {
					return statSync(join(path, name)).isDirectory();
				} catch {
					return false;
				}
			})
			.sort((left, right) => left.localeCompare(right));
	} catch {
		return [];
	}
}

function describeSkillSource(source: Omit<AgentSkillSource, "exists" | "skillCount" | "skills">): AgentSkillSource {
	const skills = readSkillNames(source.path);
	return {
		...source,
		exists: existsSync(source.path),
		skillCount: skills.length,
		skills,
	};
}

function getSystemPromptEnvKeys(profile: AgentConfigStore["profile"]): string[] {
	const channelKeys = (profile?.channels ?? []).map((channel) => `${channel.kind.toUpperCase()}_BOT_SYSTEM_PROMPT_FILE`);
	return [...channelKeys, "SYSTEM_PROMPT_FILE"];
}

function getConfiguredSystemPromptPath(profile: AgentConfigStore["profile"], env: Record<string, string>): string | undefined {
	for (const key of getSystemPromptEnvKeys(profile)) {
		const value = env[key]?.trim();
		if (value) {
			return resolve(value);
		}
	}
	return undefined;
}

function resolveSystemPromptSource(profile: AgentConfigStore["profile"], env: Record<string, string>): AgentSystemPromptSource {
	const harness: { label: string; systemPrompt?: HarnessLifecycleHooks["systemPrompt"] } = (() => {
		try {
			const definition = getAgentHarnessDefinition(profile?.harness.kind ?? "pi");
			return {
				label: definition.label,
				systemPrompt: definition.lifecycleHooks?.systemPrompt,
			};
		} catch {
			const label = String(profile?.harness.kind ?? "harness");
			return { label };
		}
	})();
	if (!harness.systemPrompt) {
		return {
			label: "系统提示词",
			description: `${harness.label} 的系统提示词由 harness runtime 内置或自行管理，Pie 当前没有注入可编辑的系统提示词文件。`,
			path: "",
			exists: true,
			content: `${harness.label} 使用 harness runtime 提供的系统提示词；这里没有需要打开的本地提示词文件。`,
		};
	}

	const configuredPath = getConfiguredSystemPromptPath(profile, env);
	const path = configuredPath ?? harness.systemPrompt.defaultPath;
	return describeSystemPromptSource({
		label: "系统提示词",
		description: `${harness.systemPrompt.label} 当前注入到 Agent session。`,
		path,
	});
}

function describeSystemPromptSource(source: { label: string; description: string; path: string }): AgentSystemPromptSource {
	const exists = existsSync(source.path);
	return {
		...source,
		exists,
		content: exists ? readFileSync(source.path, "utf8") : "",
	};
}

const agentProcesses = new AgentProcessManager({
	getAppRoot,
	getNodeExecPath,
	async getAgentHome(agentId) {
		return (await getAgent(agentId)).home;
	},
	async getAgentName(agentId) {
		return (await getAgent(agentId)).name;
	},
	async getAgentHarnessKind(agentId) {
		return (await getAgent(agentId)).harnessKind;
	},
	async getAgentStartLabel(agentId) {
		const agent = await getAgent(agentId);
		return `名称=${agent.name} id=${agent.id} Agent Harness=${agent.harnessKind ?? "unknown"} 渠道=${agent.channelKinds?.join(",") || "none"}`;
	},
	getDeveloperMode() {
		return readDesktopSettings().developerMode;
	},
	async getRuntimeEnvironment(agentId) {
		const agent = await getAgent(agentId);
		const profile = readProfileConfig(agent.home)?.profile;
		return createRuntimeEnvironment({ homeDir: agent.home, profile });
	},
	async recordRuntimeEvent(agentId, event, reason) {
		const agent = await getAgent(agentId);
		appendAgentUsageEvent(agent.home, {
			type: "runtime",
			runtimeEvent: event,
			...(reason ? { reason } : {}),
		});
	},
	recordRuntimeStateChange(agentId, reason) {
		emitAgentChangeEvent({ agentIds: [agentId], ...(reason ? { reason } : {}) });
	},
	async recordLogEntry(entry) {
		const agent = await getAgent(entry.agentId);
		appendAgentLogEntry(agent.home, entry);
	},
});

function statusForProfile(id: string, desiredState: AgentDesiredState): AgentSummary["status"] {
	const desiredRunning = desiredState === "running";
	if (agentProcesses.isReady(id)) {
		return "running";
	}
	if (agentProcesses.isRunning(id)) {
		return "starting";
	}
	if (desiredRunning) {
		const agent = getAgentSummaryHome(id);
		if (agent && hasLiveRuntimeProcess(agent)) {
			return "running";
		}
		if (restoringAgentIds.has(id)) {
			return "starting";
		}
	}
	return desiredRunning ? "paused" : "terminated";
}

function getAgentSummaryHome(id: string): string | undefined {
	const registry = loadProfileRegistry();
	const entry = registry.profiles[id];
	return entry ? profileHomeFromEntry(getDefaultPieRootDir(), entry.home) : undefined;
}

function hasLiveRuntimeProcess(home: string): boolean {
	if (readLiveRuntimeProcessRecord(home)) {
		return true;
	}
	const persisted = readRuntimeStateRecord(home);
	if (
		persisted?.lifecycle.state === "running" ||
		persisted?.lifecycle.state === "starting" ||
		persisted?.lifecycle.state === "degraded"
	) {
		writeRuntimeLifecycle(home, persisted.homeDir, persisted.workDir, "stopped", "stale-process");
	}
	return false;
}

function runtimeLifecycleForProfile(id: string, home: string, desiredState: AgentDesiredState): RuntimeEnvironmentSummary["lifecycle"] {
	const activeLifecycle = agentProcesses.getLifecycleSnapshot(id);
	if (activeLifecycle) {
		return activeLifecycle;
	}
	const persisted = readRuntimeStateRecord(home);
	if (persisted) {
		if (
			(persisted.lifecycle.state === "running" ||
				persisted.lifecycle.state === "starting" ||
				persisted.lifecycle.state === "degraded") &&
			!hasLiveRuntimeProcess(home)
		) {
			return {
				state: "stopped",
				updatedAt: new Date().toISOString(),
				reason: "stale-process",
			};
		}
		return persisted.lifecycle;
	}
	const desiredRunning = desiredState === "running";
	return {
		state: "stopped",
		updatedAt: new Date().toISOString(),
		reason: desiredRunning ? "not-running" : "paused",
	};
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

function displayModelId(modelId: string | undefined): string | undefined {
	const value = modelId?.trim();
	if (!value) {
		return undefined;
	}
	return value.split("/").filter(Boolean).at(-1) ?? value;
}

function readAgentSummary(
	id: string,
	entry: ReturnType<typeof loadProfileRegistry>["profiles"][string],
	rootDir: string,
	selectedProfileId?: string,
): AgentSummary {
	const home = profileHomeFromEntry(rootDir, entry.home);
	const config = readProfileConfig(home);
	const profile = config?.profile;
	const runtimeEnvironment = createRuntimeEnvironment({ homeDir: home, profile });
	runtimeEnvironment.lifecycle = runtimeLifecycleForProfile(id, home, entry.desiredState);
	const model = getProfileModel(profile);
	const channel = getPrimaryFeishuChannel(profile);
	const channelKinds = profile?.channels
		.filter((profileChannel) => profileChannel.enabled !== false)
		.map((profileChannel) => profileChannel.kind);
		const harnessKind = profile?.harness.kind ? String(profile.harness.kind) : undefined;
		const harnessService = getSharedHarnessServiceInfo(harnessKind);
	const selectedModelId = displayModelId(model?.model);
	const modelOption = model?.provider && model?.model
		? loadModelOptions(home).find((item) => item.provider === model.provider && item.id === selectedModelId)
		: undefined;
	const modelLabel = model?.provider && model?.model ? modelOption?.name || selectedModelId : undefined;
	return {
		id,
		name: entry.displayName || id,
		status: statusForProfile(id, entry.desiredState),
		avatarSeed: id,
		avatarUrl: readProfileAvatarUrl(home),
		desiredState: entry.desiredState,
		selected: selectedProfileId === id,
		home,
		runtimeEnvironment,
		createdAt: entry.createdAt,
		updatedAt: entry.updatedAt,
			harnessKind,
			harnessService,
			modelLabel,
		channelKinds,
		appId: channel?.appId,
	};
}

async function listAgents(): Promise<AgentSummary[]> {
	const registry = loadProfileRegistry();
	const rootDir = getDefaultPieRootDir();
	return Object.entries(registry.profiles)
		.map(([id, entry]) => readAgentSummary(id, entry, rootDir, registry.selectedProfile))
		.sort((left, right) => agentSortTimestamp(right) - agentSortTimestamp(left));
}

function agentSortTimestamp(agent: Pick<AgentSummary, "createdAt" | "updatedAt">): number {
	const timestamp = Date.parse(agent.createdAt ?? agent.updatedAt ?? "");
	return Number.isFinite(timestamp) ? timestamp : 0;
}

function listAgentHomes(): string[] {
	const registry = loadProfileRegistry();
	const rootDir = getDefaultPieRootDir();
	return Object.values(registry.profiles).map((entry) => profileHomeFromEntry(rootDir, entry.home));
}

function applyOpenAtLoginSetting(settings: DesktopSettings): void {
	if (!app.isPackaged) {
		return;
	}
	app.setLoginItemSettings({ openAtLogin: settings.openAtLogin });
}

function applyKeepAwakeSetting(settings: DesktopSettings): void {
	if (settings.keepAwakeWhileOpen) {
		if (keepAwakeBlockerId === undefined || !powerSaveBlocker.isStarted(keepAwakeBlockerId)) {
			keepAwakeBlockerId = powerSaveBlocker.start("prevent-display-sleep");
		}
		return;
	}
	if (keepAwakeBlockerId !== undefined && powerSaveBlocker.isStarted(keepAwakeBlockerId)) {
		powerSaveBlocker.stop(keepAwakeBlockerId);
	}
	keepAwakeBlockerId = undefined;
}

function pruneStoredRuntimeData(settings: DesktopSettings): void {
	const runtimeLogDays = retentionToDays(settings.runtimeLogRetention);
	const usageDays = retentionToDays(settings.usageEventRetention);
	for (const home of listAgentHomes()) {
		pruneAgentLogEntries(home, runtimeLogDays);
		pruneAgentUsageEvents(home, usageDays);
	}
}

function scheduleStoredRuntimeDataPrune(settings: DesktopSettings): void {
	setTimeout(() => {
		try {
			pruneStoredRuntimeData(settings);
		} catch (error) {
			console.error("[desktop] failed to prune stored runtime data:", error);
		}
	}, STORED_RUNTIME_DATA_PRUNE_DELAY_MS);
}

async function saveDesktopSettings(draft: DesktopSettingsDraft): Promise<DesktopSettings> {
	const settings = updateDesktopSettings(draft);
	applyOpenAtLoginSetting(settings);
	applyKeepAwakeSetting(settings);
	pruneStoredRuntimeData(settings);
	return settings;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function restoreAgentOnLaunch(agent: AgentSummary): Promise<void> {
	try {
		await withAgentOperation(agent.id, () => startAgent(agent.id));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		writeAgentRuntimeLifecycle(agent, "failed", `restore-failed: ${message}`);
		console.error(`[desktop] failed to restore agent ${agent.id}:`, error);
	} finally {
		restoringAgentIds.delete(agent.id);
		emitAgentChangeEvent({ agentIds: [agent.id], reason: "restore-finished" });
	}
}

async function restoreDesiredRunningAgents(): Promise<void> {
	if (!readDesktopSettings().restoreRunningAgentsOnLaunch) {
		return;
	}
	const agents = await listAgents();
	const snapshot = readAgentStartResourceSnapshot();
	const budget = calculateAgentStartBudget(snapshot);
	const desiredCandidates = agents.filter((agent) => agent.desiredState === "running" && !hasLiveRuntimeProcess(agent.home));
	const deferredCandidates = desiredCandidates.filter((agent) =>
		(getSharedHarnessServiceInfo(agent.harnessKind)?.lifecycle.state === "running"
			? false
			: shouldDeferAutoStartForResources(agent.harnessKind, snapshot)),
	);
	const candidates = desiredCandidates.filter((agent) => !deferredCandidates.includes(agent));
	console.log(
		`[desktop] restore start budget maxConcurrent=${budget.maxConcurrent} maxWeight=${budget.maxWeight} ` +
			`freeMemGb=${(snapshot.freeMemoryBytes / 1024 ** 3).toFixed(1)} load=${snapshot.loadAverage1m.toFixed(2)}/${snapshot.cpuCount}`,
	);
	for (const agent of deferredCandidates) {
		writeAgentRuntimeLifecycle(agent, "stopped", "restore-deferred-low-resources");
		console.warn(`[desktop] deferred auto-start for ${agent.id} (${agent.harnessKind}) because system resources are low.`);
	}
	for (const agent of candidates) {
		restoringAgentIds.add(agent.id);
		writeAgentRuntimeLifecycle(agent, "starting", "restore-scheduled");
	}
	if (candidates.length) {
		emitAgentChangeEvent({ agentIds: candidates.map((agent) => agent.id), reason: "restore-scheduled" });
	}
	await Promise.allSettled(
		candidates.map(async (agent, index) => {
			const restoreDelayMs = getRestoreDelayMs(agent, index);
			if (restoreDelayMs > 0) {
				await delay(restoreDelayMs);
			}
			await restoreAgentOnLaunch(agent);
		}),
	);
}

async function getAgent(id: string): Promise<AgentDetails> {
	const registry = loadProfileRegistry();
	const entry = registry.profiles[id];
	if (!entry) {
		throw new Error(`Unknown agent: ${id}`);
	}
	const summary = readAgentSummary(id, entry, getDefaultPieRootDir(), registry.selectedProfile);
	const config = readProfileConfig(summary.home);
	const env = readProfileEnv(summary.home);
	const profile = config?.profile;
	const channel = getPrimaryFeishuChannel(profile);
	const wechatChannel = getPrimaryWechatChannel(profile);
	const slackChannel = getPrimarySlackChannel(profile);
	const discordChannel = getPrimaryDiscordChannel(profile);
	const telegramChannel = getPrimaryTelegramChannel(profile);
	const model = getProfileModel(profile);
	const apiKeyEnv = model?.provider ? getProviderCredentialEnv(model.provider) : undefined;
	return {
		...summary,
		brand: channel?.brand,
		feishuMessageOutputMode: channel?.messageOutputMode,
		imGroupResponseMode: getImBehavior(profile).groupResponseMode,
		feishuCredentialState: channel?.credentialState ?? "active",
		feishuCredentialInvalidatedReason: channel?.credentialInvalidatedReason,
		appSecret: env.FEISHU_APP_SECRET,
		wechat: wechatChannel
			? {
					accountId: wechatChannel.accountId,
					baseUrl: wechatChannel.baseUrl,
					botToken: env.WECHAT_BOT_TOKEN ?? "",
				}
			: undefined,
		slack: slackChannel
			? {
					botToken: env.SLACK_BOT_TOKEN ?? "",
					appToken: env.SLACK_APP_TOKEN ?? "",
				}
			: undefined,
		discord: discordChannel
			? {
					botToken: env.DISCORD_BOT_TOKEN ?? "",
					applicationId: discordChannel.applicationId,
					guildId: discordChannel.guildId,
				}
			: undefined,
		telegram: telegramChannel
			? {
					botToken: env.TELEGRAM_BOT_TOKEN ?? "",
					botUsername: telegramChannel.botUsername,
				}
			: undefined,
		model: {
			...(model ?? {}),
			resumeSessions: model?.resumeSessions ?? getDefaultResumeSessionsForHarness(profile?.harness.kind),
			...(apiKeyEnv ? { apiKeyEnv, apiKey: env[apiKeyEnv] ?? "" } : {}),
		},
	};
}

async function getDesktopBootstrap(): Promise<DesktopBootstrap> {
	const settings = readDesktopSettings();
	const agents = await listAgents();
	const selectedSummary = agents.find((agent) => agent.selected) ?? agents[0];
	const selectedAgent = selectedSummary ? await getAgent(selectedSummary.id) : undefined;
	return {
		settings,
		agents,
		...(selectedAgent ? { selectedAgent } : {}),
	};
}

async function getAgentUsage(id: string) {
	const agent = await getAgent(id);
	return summarizeAgentUsage(readAgentUsageEvents(agent.home), { runningSince: agentProcesses.getStartedAt(id) });
}

async function invalidateFeishuCredentialsOwnedByOtherAgents(ownerId: string, appId: string): Promise<void> {
	const targetAppId = appId.trim();
	if (!targetAppId) {
		return;
	}
	const registry = loadProfileRegistry();
	const rootDir = getDefaultPieRootDir();
	const invalidatedAt = new Date().toISOString();
	for (const [agentId, entry] of Object.entries(registry.profiles)) {
		if (agentId === ownerId) {
			continue;
		}
		const home = profileHomeFromEntry(rootDir, entry.home);
		const current = readProfileConfig(home);
		const profile = current?.profile;
		const channel = getPrimaryFeishuChannel(profile);
		if (!current || !profile || !channel || channel.appId.trim() !== targetAppId) {
			continue;
		}
		if (channel.credentialState === "invalidated" && channel.credentialInvalidatedReason === `transferred:${ownerId}`) {
			continue;
		}
		const nextProfile = upsertFeishuChannel(profile, {
			...channel,
			credentialState: "invalidated",
			credentialInvalidatedAt: invalidatedAt,
			credentialInvalidatedReason: `transferred:${ownerId}`,
		});
		writeProfileConfig(home, {
			...current,
			version: 3,
			profile: nextProfile,
		});
		upsertAgentEnv({ FEISHU_APP_SECRET: undefined }, home);
		await stopRunningAgent(agentId);
		writeRuntimeLifecycle(
			home,
			home,
			createRuntimeEnvironment({ homeDir: home, profile: nextProfile }).workDir,
			"failed",
			`feishu-credential-invalidated: transferred to ${ownerId}`,
			{ updatedAt: invalidatedAt },
		);
		console.warn(`[desktop] invalidated Feishu credentials for ${agentId}; App ID ${targetAppId} is now owned by ${ownerId}.`);
	}
}

async function getAgentLogs(id: string) {
	const agent = await getAgent(id);
	const persisted = readAgentLogEntries(agent.home);
	const live = agentProcesses.getLogs(id);
	const byKey = new Map(persisted.map((entry) => [agentLogEntryKey(entry), entry]));
	for (const entry of live) {
		byKey.set(agentLogEntryKey(entry), entry);
	}
	return [...byKey.values()].sort(compareAgentLogEntries).slice(-1000);
}

async function getAgentEvents(id: string): Promise<AgentEventLogEntry[]> {
	const agent = await getAgent(id);
	return readAgentSessionEvents(agent.home).map((entry) => ({
		timestamp: entry.timestamp,
		conversationKey: entry.conversationKey,
		event: entry.event,
		sequence: entry.sequence,
	}));
}

async function sendAgentChatMessage(id: string, prompt: string, sessionKey = "desktop", clientMessageId?: string): Promise<AgentChatSendResult> {
	const agent = await getAgent(id);
	const text = prompt.trim();
	if (!text) {
		throw new Error("Message is required.");
	}
	const userEvent = {
		type: "user_message" as const,
		messageId: clientMessageId,
		text,
		status: "sent" as const,
		source: "desktop",
	};
	const sentEntry = { timestamp: new Date().toISOString(), conversationKey: sessionKey, event: userEvent };
	appendAgentSessionEvent({ homeDir: agent.home, conversationKey: sessionKey }, sentEntry.event);
	emitAgentEvent(id, sentEntry);
	const unavailableMessage = chatUnavailableMessage(agent);
	if (unavailableMessage) {
		const entry = { timestamp: new Date().toISOString(), conversationKey: sessionKey, event: { ...userEvent, status: "failed" as const, errorText: unavailableMessage } };
		appendAgentSessionEvent({ homeDir: agent.home, conversationKey: sessionKey }, entry.event);
		emitAgentEvent(id, entry);
		throw new Error(unavailableMessage);
	}
	const record = readLiveRuntimeProcessRecord(agent.home);
	if (!record?.gatewayPort) {
		const errorText = "Agent is not started yet.";
		const entry = { timestamp: new Date().toISOString(), conversationKey: sessionKey, event: { ...userEvent, status: "failed" as const, errorText } };
		appendAgentSessionEvent({ homeDir: agent.home, conversationKey: sessionKey }, entry.event);
		emitAgentEvent(id, entry);
		throw new Error(errorText);
	}
	let response: Response;
	try {
		response = await fetch(`http://127.0.0.1:${record.gatewayPort}/agent/run`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				sessionKey,
				prompt: text,
				source: "desktop",
				origin: "human",
				metadata: { surface: "desktop-chat", ...(clientMessageId ? { clientMessageId } : {}) },
			}),
		});
	} catch (error) {
		const errorText = error instanceof Error ? error.message : String(error);
		const entry = { timestamp: new Date().toISOString(), conversationKey: sessionKey, event: { ...userEvent, status: "failed" as const, errorText } };
		appendAgentSessionEvent({ homeDir: agent.home, conversationKey: sessionKey }, entry.event);
		emitAgentEvent(id, entry);
		throw new Error(errorText);
	}
	const payload = await response.json().catch(() => undefined) as Partial<AgentChatSendResult> & { error?: string } | undefined;
	if (!response.ok) {
		const errorText = payload?.error ?? `Agent runtime returned HTTP ${response.status}`;
		const entry = { timestamp: new Date().toISOString(), conversationKey: sessionKey, event: { ...userEvent, status: "failed" as const, errorText } };
		appendAgentSessionEvent({ homeDir: agent.home, conversationKey: sessionKey }, entry.event);
		emitAgentEvent(id, entry);
		throw new Error(payload?.error ?? `Agent runtime returned HTTP ${response.status}`);
	}
	return {
		sessionKey: typeof payload?.sessionKey === "string" ? payload.sessionKey : sessionKey,
		assistantText: typeof payload?.assistantText === "string" ? payload.assistantText : "",
		clientMessageId,
	};
}

function chatUnavailableMessage(agent: AgentDetails): string | undefined {
	const lifecycleState = agent.runtimeEnvironment?.lifecycle.state;
	if (agent.status === "starting" || lifecycleState === "starting") {
		return "Agent is still starting. Try again when it is ready.";
	}
	if (agent.status === "paused" || lifecycleState === "created" || lifecycleState === "stopped") {
		return "Agent is not started yet.";
	}
	if (lifecycleState === "failed") {
		return agent.runtimeEnvironment?.lifecycle.reason
			? `Agent failed to start: ${agent.runtimeEnvironment.lifecycle.reason}`
			: "Agent failed to start.";
	}
	return undefined;
}

async function clearAgentChatSession(id: string, sessionKey = "desktop"): Promise<AgentChatClearResult> {
	const agent = await getAgent(id);
	const key = sessionKey.trim() || "desktop";
	const record = readLiveRuntimeProcessRecord(agent.home);
	if (!record?.gatewayPort) {
		throw new Error("Agent runtime is not running.");
	}
	const response = await fetch(`http://127.0.0.1:${record.gatewayPort}/agent/session/clear`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ sessionKey: key }),
	});
	const payload = await response.json().catch(() => undefined) as { error?: string; sessionKey?: string } | undefined;
	if (!response.ok) {
		throw new Error(payload?.error ?? `Agent runtime returned HTTP ${response.status}`);
	}
	const clearedEvents = clearAgentSessionEvents(agent.home, key);
	return {
		sessionKey: typeof payload?.sessionKey === "string" ? payload.sessionKey : key,
		clearedEvents,
	};
}

async function runAgentChatSessionCommand(
	id: string,
	command: "new" | "status" | "compact" | "clear",
	sessionKey = "desktop",
): Promise<AgentChatSessionCommandResult> {
	if (command === "clear") {
		const result = await clearAgentChatSession(id, sessionKey);
		return { ...result, message: "Session cleared." };
	}
	const agent = await getAgent(id);
	const key = sessionKey.trim() || "desktop";
	const unavailableMessage = chatUnavailableMessage(agent);
	if (unavailableMessage) {
		throw new Error(unavailableMessage);
	}
	const record = readLiveRuntimeProcessRecord(agent.home);
	if (!record?.gatewayPort) {
		throw new Error("Agent runtime is not running.");
	}
	const route = command === "new"
		? "/agent/session/new"
		: command === "status"
			? "/agent/session/status"
			: "/agent/session/compact";
	const body = command === "new" ? {} : { sessionKey: key };
	const response = await fetch(`http://127.0.0.1:${record.gatewayPort}${route}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	const payload = await response.json().catch(() => undefined) as AgentChatSessionCommandResult & { error?: string } | undefined;
	if (!response.ok) {
		throw new Error(payload?.error ?? `Agent runtime returned HTTP ${response.status}`);
	}
	return {
		sessionKey: typeof payload?.sessionKey === "string" ? payload.sessionKey : key,
		status: payload?.status,
		summary: payload?.summary,
		message: payload?.message,
	};
}

function agentLogEntryKey(entry: AgentLogEntry): string {
	return `${entry.agentId}:${entry.id}:${entry.timestamp}`;
}

function compareAgentLogEntries(left: AgentLogEntry, right: AgentLogEntry): number {
	const timestampOrder = Date.parse(left.timestamp) - Date.parse(right.timestamp);
	if (timestampOrder !== 0) {
		return timestampOrder;
	}
	return left.id - right.id;
}

async function getAgentResources(id: string): Promise<AgentResourceStats> {
	const agent = await getAgent(id);
	const processStats = readAgentProcessResourceStats(agentProcesses.getPid(id), agent.home);
	return {
		...processStats,
		...readAgentStorageResourceStats(agent.home, { refresh: agent.status !== "starting" }),
		updatedAt: new Date().toISOString(),
	};
}

async function getAgentModelCatalog(id: string): Promise<DesktopModelCatalog> {
	const agent = await getAgent(id);
	if (agent.harnessKind === "openclaw") {
		return loadOpenClawModelCatalog();
	}
	const catalog = agent.harnessKind === "hermes" ? loadHermesModelCatalog(agent.home) : loadModelCatalog(agent.home);
	if (agent.model?.provider !== "codex-cli") {
		return catalog;
	}
	const codexModels = loadCodexModelCatalog().map((model) => ({
		id: model.id,
		name: model.name,
		provider: "codex-cli",
	}));
	return {
		models: [...codexModels, ...catalog.models.filter((model) => model.provider !== "codex-cli")],
		providers: [...new Set(["codex-cli", ...catalog.providers])].sort((left, right) => left.localeCompare(right)),
	};
}

async function findReusableProviderCredential(provider: string, excludeAgentId?: string): Promise<ProviderCredentialReuse | undefined> {
	const envKey = getProviderCredentialEnv(provider);
	if (!envKey) {
		return undefined;
	}
	const registry = loadProfileRegistry();
	const rootDir = getDefaultPieRootDir();
	const candidates = Object.entries(registry.profiles)
		.filter(([id]) => id !== excludeAgentId)
		.sort(([, left], [, right]) => Date.parse(right.updatedAt ?? right.createdAt ?? "") - Date.parse(left.updatedAt ?? left.createdAt ?? ""));
	for (const [id, entry] of candidates) {
		const value = readProfileEnv(profileHomeFromEntry(rootDir, entry.home))[envKey]?.trim();
		if (!value) {
			continue;
		}
		return {
			provider,
			envKey,
			value,
			sourceAgentId: id,
			sourceAgentName: entry.displayName || id,
		};
	}
	return undefined;
}

async function getAgentSkillSources(id: string): Promise<AgentSkillSource[]> {
	const agent = await getAgent(id);
	const profile = readProfileConfig(agent.home)?.profile;
	return resolveSkillSources({
		profile,
		profileHomeDir: agent.home,
		profileLabel: agent.name,
	}).map(describeSkillSource);
}

async function getAgentSystemPrompt(id: string): Promise<AgentSystemPromptSource> {
	const agent = await getAgent(id);
	const profile = readProfileConfig(agent.home)?.profile;
	const env = readProfileEnv(agent.home);
	return resolveSystemPromptSource(profile, env);
}

async function openAgentSkillSource(id: string, sourceId: string): Promise<AgentSkillSource[]> {
	const source = (await getAgentSkillSources(id)).find((item) => item.id === sourceId);
	if (!source) {
		throw new Error(`Unknown skills source: ${sourceId}`);
	}
	mkdirSync(source.path, { recursive: true });
	const result = await shell.openPath(source.path);
	if (result) {
		throw new Error(result);
	}
	return getAgentSkillSources(id);
}

async function openAgentSkillFolder(id: string, sourceId: string, skillName: string): Promise<void> {
	const source = (await getAgentSkillSources(id)).find((item) => item.id === sourceId);
	if (!source) {
		throw new Error(`Unknown skills source: ${sourceId}`);
	}
	if (!source.skills.includes(skillName)) {
		throw new Error(`Unknown skill: ${skillName}`);
	}
	const result = await shell.openPath(join(source.path, skillName));
	if (result) {
		throw new Error(result);
	}
}

async function openAgentSystemPrompt(id: string): Promise<AgentSystemPromptSource> {
	const source = await getAgentSystemPrompt(id);
	if (!source.path) {
		return source;
	}
	if (source.exists) {
		shell.showItemInFolder(source.path);
		return getAgentSystemPrompt(id);
	}
	const result = await shell.openPath(dirname(source.path));
	if (result) {
		throw new Error(result);
	}
	return getAgentSystemPrompt(id);
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

async function syncFeishuAppProfile(id: string): Promise<AgentDetails> {
	const agent = await getAgent(id);
	const current = readProfileConfig(agent.home);
	const channel = getPrimaryFeishuChannel(current?.profile);
	const appSecret = readProfileEnv(agent.home).FEISHU_APP_SECRET ?? "";
	if (!channel?.appId.trim() || !appSecret.trim()) {
		throw new Error("飞书 App ID 和 App Secret 必填");
	}
	const result = await LarkClient.fromCredentials({
		accountId: `desktop-sync-${id}-${Date.now()}`,
		appId: channel.appId,
		appSecret,
		brand: channel.brand ?? "feishu",
	}).probe();
	if (!result.ok) {
		throw new Error(`飞书应用信息获取失败：${result.error ?? "无法获取 bot 信息"}`);
	}
	if (result.botName?.trim()) {
		updateProfileRegistryEntry(id, {
			displayName: result.botName.trim(),
		});
	}
	if (result.botAvatarUrl?.trim()) {
		await downloadRemoteAvatarToProfile(result.botAvatarUrl, agent.home);
	}
	return getAgent(id);
}

async function syncDiscordBotProfile(id: string, botToken?: string): Promise<AgentDetails> {
	const agent = await getAgent(id);
	const current = readProfileConfig(agent.home) ?? { version: 3 };
	const channel = getPrimaryDiscordChannel(current.profile);
	if (!channel) {
		throw new Error("当前 Agent 未配置 Discord 渠道");
	}
	const token = botToken?.trim() || readProfileEnv(agent.home).DISCORD_BOT_TOKEN || "";
	if (!token.trim()) {
		throw new Error("Discord Bot Token 必填");
	}
	const result = await fetchDiscordBotProfileForSession(id, token, emitOnboardEvent);
	if (result.applicationId?.trim()) {
		const nextProfile = upsertDiscordChannel(current.profile, {
			...channel,
			applicationId: result.applicationId.trim(),
		});
		writeProfileConfig(agent.home, {
			...current,
			version: 3,
			profile: nextProfile,
		});
	}
	if (botToken !== undefined) {
		upsertAgentEnv({ DISCORD_BOT_TOKEN: token.trim() }, agent.home);
	}
	if (result.botName?.trim()) {
		updateProfileRegistryEntry(id, {
			displayName: result.botName.trim(),
		});
	}
	if (result.avatarUrl?.trim()) {
		await downloadRemoteAvatarToProfile(result.avatarUrl, agent.home);
	}
	return getAgent(id);
}

function writeHermesModelConfig(homeDir: string, profileId: string, provider: string, model: string): Record<string, string> {
	const hermesProvider = toHermesInferenceProvider(provider);
	const hermesApiServerPort = deriveHermesApiServerPort(profileId);
	const currentProfile = readProfileConfig(homeDir)?.profile;
	const configuredHermesHome = typeof currentProfile?.harness.config?.hermesHome === "string"
		? currentProfile.harness.config.hermesHome.trim()
		: "";
	const hermesHome = configuredHermesHome || join(homeDir, "hermes");
	mkdirSync(hermesHome, { recursive: true });
	writeFileSync(
		join(hermesHome, "config.yaml"),
		[
			"model:",
			`  provider: ${hermesProvider}`,
			`  default: ${model}`,
			"platforms:",
			"  api_server:",
			"    enabled: true",
			"    host: 127.0.0.1",
			`    port: ${hermesApiServerPort}`,
			"",
		].join("\n"),
		"utf8",
	);
	return {
		API_SERVER_ENABLED: "true",
		API_SERVER_HOST: "127.0.0.1",
		API_SERVER_PORT: String(hermesApiServerPort),
		GATEWAY_ALLOW_ALL_USERS: "true",
		HERMES_INFERENCE_PROVIDER: hermesProvider,
		HERMES_INFERENCE_MODEL: model,
	};
}

function getAgentHermesHome(agent: AgentDetails): string | undefined {
	if (agent.harnessKind !== "hermes") {
		return undefined;
	}
	const currentProfile = readProfileConfig(agent.home)?.profile;
	const configuredHermesHome = typeof currentProfile?.harness.config?.hermesHome === "string"
		? currentProfile.harness.config.hermesHome.trim()
		: "";
	return configuredHermesHome || join(agent.home, "hermes");
}

async function updateAgent(id: string, draft: AgentDraft): Promise<AgentDetails> {
	const agent = await getAgent(id);
	const current = readProfileConfig(agent.home) ?? { version: 3 };
	const currentProfile = current.profile;
	const plan = planAgentProfileMutation({
		currentProfile,
		draft,
		env: readProfileEnv(agent.home),
	});
	if (plan.feishu) {
		await validateFeishuCredentials({
			appId: plan.feishu.appId.trim(),
			appSecret: plan.feishu.appSecret.trim(),
			brand: plan.feishu.brand,
		});
	}
	writeProfileConfig(agent.home, {
		...current,
		version: 3,
		profile: plan.nextProfile,
	});
	if (Object.keys(plan.envUpdates).length) {
		upsertAgentEnv(plan.envUpdates, agent.home);
	}
	if (plan.shouldInvalidateFeishuCredentials && plan.feishu) {
		await invalidateFeishuCredentialsOwnedByOtherAgents(id, plan.feishu.appId);
	}
	if (plan.hermesModelUpdate) {
		upsertAgentEnv(writeHermesModelConfig(agent.home, id, plan.hermesModelUpdate.provider, plan.hermesModelUpdate.model), agent.home);
	}
	const apiKeyEnv = plan.nextProvider ? getProviderCredentialEnv(plan.nextProvider) : undefined;
	if (apiKeyEnv && draft.apiKey !== undefined) {
		upsertAgentEnv({ [apiKeyEnv]: draft.apiKey.trim() }, agent.home);
	}
	if (draft.name && draft.name !== agent.name) {
		registerProfileHome(id, {
			displayName: draft.name,
			desiredState: agent.desiredState,
			selected: agent.selected,
		});
	}
	return getAgent(id);
}

async function reauthorizeWechatAgent(id: string): Promise<AgentDetails> {
	const agent = await getAgent(id);
	if (!agent.channelKinds?.includes("wechat") && !agent.wechat) {
		throw new Error("当前 Agent 未配置微信渠道");
	}
	const shouldRestart = agent.status === "running" || agent.status === "starting";
	const wechat = await createWechatLoginForSession(id, emitOnboardEvent);
	await updateAgent(id, {
		wechatAccountId: wechat.accountId,
		wechatBaseUrl: wechat.baseUrl,
	});
	if (!shouldRestart) {
		return getAgent(id);
	}
	await stopRunningAgent(id);
	return startAgent(id);
}

async function reauthorizeFeishuAgent(id: string): Promise<AgentDetails> {
	const agent = await getAgent(id);
	if (!agent.channelKinds?.includes("feishu") && !agent.appId) {
		throw new Error("当前 Agent 未配置飞书渠道");
	}
	const shouldRestart = agent.status === "running" || agent.status === "starting";
	const feishu = await createFeishuAppForSession(id, emitOnboardEvent);
	await updateAgent(id, {
		appId: feishu.appId,
		appSecret: feishu.appSecret,
		brand: feishu.brand,
	});
	if (feishu.appName?.trim()) {
		updateProfileRegistryEntry(id, {
			displayName: feishu.appName.trim(),
		});
	}
	if (feishu.avatarUrl?.trim()) {
		await downloadRemoteAvatarToProfile(feishu.avatarUrl, agent.home);
	}
	if (!shouldRestart) {
		return getAgent(id);
	}
	await stopRunningAgent(id);
	return startAgent(id);
}

async function restartAgent(id: string): Promise<AgentDetails> {
	await stopRunningAgent(id);
	return startAgent(id);
}

async function startAgent(id: string): Promise<AgentDetails> {
	if (agentProcesses.isRunning(id)) {
		updateProfileRegistryEntry(id, { desiredState: "running", selected: true });
		return getAgent(id);
	}
	const existing = await getAgent(id);
	return startKnownAgent(existing);
}

async function startKnownAgent(existing: AgentDetails): Promise<AgentDetails> {
	if (existing.feishuCredentialState === "invalidated") {
		const message = "飞书凭证已失效，请重新授权后再启动这个 Agent。";
		writeAgentRuntimeLifecycle(existing, "failed", message);
		throw new Error(message);
	}
	if (existing.harnessKind === "hermes") {
		const diagnostic = await checkHermesEnvironmentForDesktop();
		if (!diagnostic.ready) {
			const message = diagnostic.installed
				? "Hermes 运行时不可用，请先升级或重新安装 Hermes。"
				: "未检测到 Hermes 运行时，请先安装 Hermes 后再启动这个 Agent。";
			writeAgentRuntimeLifecycle(existing, "failed", message);
			throw new Error(message);
		}
		const owner = findPieProfileClaimingHermesHome(getAgentHermesHome(existing), { excludeProfileId: existing.id });
		if (owner) {
			const message = `Hermes profile 已被 Pie Agent「${owner.displayName}」使用，不能同时启动两个共享同一 Hermes home 的 Agent。`;
			writeAgentRuntimeLifecycle(existing, "failed", message);
			throw new Error(message);
		}
	}
	if (existing.harnessKind === "openclaw") {
		const diagnostic = await checkManagedRuntimeForDesktop("openclaw");
		if (!diagnostic.ready) {
			const message = diagnostic.installed
				? "OpenClaw 运行时不可用，请先升级或重新安装官方 OpenClaw。"
				: "未检测到 OpenClaw 运行时，请先安装官方 OpenClaw 后再启动这个 Agent。";
			writeAgentRuntimeLifecycle(existing, "failed", message);
			throw new Error(message);
		}
	}
	if (hasLiveRuntimeProcess(existing.home)) {
		const record = readLiveRuntimeProcessRecord(existing.home);
		writeAgentRuntimeLifecycle(existing, "running", "existing-process", record ? { process: record } : {});
		updateProfileRegistryEntry(existing.id, { desiredState: "running", selected: true });
		return getAgent(existing.id);
	}
	updateProfileRegistryEntry(existing.id, { desiredState: "running", selected: true });
	writeAgentRuntimeLifecycle(existing, "starting", "starting");
	emitAgentChangeEvent({ agentIds: [existing.id], reason: "starting" });
	await sharedHarnessServices.ensureForProfile(existing);
	await agentStartLimiter.run(existing.harnessKind, () => agentProcesses.start(existing.id));
	return getAgent(existing.id);
}

async function pauseAgent(id: string): Promise<AgentDetails> {
	await stopRunningAgent(id);
	return getAgent(id);
}

async function stopRunningAgent(id: string): Promise<void> {
	const agent = await getAgent(id);
	if (!agentProcesses.isRunning(id)) {
		const record = readLiveRuntimeProcessRecord(agent.home);
		if (record) {
			writeAgentRuntimeLifecycle(agent, "stopping", "paused", { process: record });
			await stopLiveRuntimeProcessRecord({ homeDir: agent.home, forceKillMs: RUNTIME_STOP_FORCE_KILL_MS });
		}
		writeAgentRuntimeLifecycle(agent, "stopped", "paused");
		updateProfileRegistryEntry(id, { desiredState: "paused" });
		return;
	}
	await agentProcesses.stop(id, "paused");
	updateProfileRegistryEntry(id, { desiredState: "paused" });
}

async function stopAgentsForQuit(): Promise<void> {
	const agents = await listAgents();
	const terminatingAgentIds = agents
		.filter((agent) => {
			if (agentProcesses.isRunning(agent.id)) {
				return true;
			}
			return Boolean(readLiveRuntimeProcessRecord(agent.home));
		})
		.map((agent) => agent.id);
	if (terminatingAgentIds.length) {
		const terminatingAgents = agents
			.filter((agent) => terminatingAgentIds.includes(agent.id))
			.map((agent) => ({
				id: agent.id,
				name: agent.name,
				avatarSeed: agent.avatarSeed,
				avatarUrl: agent.avatarUrl,
			}));
		showMainWindow();
		emitDesktopQuitEvent({ phase: "terminating-agents", agentIds: terminatingAgentIds, agents: terminatingAgents });
	}
	await Promise.allSettled(
		agents.map(async (agent) => {
			if (agentProcesses.isRunning(agent.id)) {
				await agentProcesses.stop(agent.id, "quit");
				emitDesktopQuitEvent({
					phase: "agent-stopped",
					agent: {
						id: agent.id,
						name: agent.name,
						avatarSeed: agent.avatarSeed,
						avatarUrl: agent.avatarUrl,
					},
				});
				return;
			}
			const record = readLiveRuntimeProcessRecord(agent.home);
			if (!record) {
				clearRuntimeProcessRecord(agent.home);
				return;
			}
			writeAgentRuntimeLifecycle(agent, "stopping", "quit", { process: record });
			await stopLiveRuntimeProcessRecord({ homeDir: agent.home, forceKillMs: RUNTIME_STOP_FORCE_KILL_MS });
			writeAgentRuntimeLifecycle(agent, "stopped", "quit");
			appendAgentUsageEvent(agent.home, {
				type: "runtime",
				runtimeEvent: "stop",
				reason: "quit",
			});
			emitDesktopQuitEvent({
				phase: "agent-stopped",
				agent: {
					id: agent.id,
					name: agent.name,
					avatarSeed: agent.avatarSeed,
					avatarUrl: agent.avatarUrl,
				},
			});
		}),
	);
	await sharedHarnessServices.stopAll();
}

function emitDesktopQuitEvent(event: DesktopQuitEvent): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (win.isDestroyed() || win.webContents.isDestroyed()) {
			continue;
		}
		if (win.webContents.isLoading()) {
			win.webContents.once("did-finish-load", () => {
				if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
					win.webContents.send("desktop:quit-event", event);
				}
			});
		} else {
			win.webContents.send("desktop:quit-event", event);
		}
	}
}

function emitAgentChangeEvent(event: AgentChangeEvent): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (win.isDestroyed() || win.webContents.isDestroyed()) {
			continue;
		}
		win.webContents.send("agents:change", event);
	}
}

function emitAgentEvent(agentId: string, event: AgentEventLogEntry): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (win.isDestroyed() || win.webContents.isDestroyed()) {
			continue;
		}
		win.webContents.send("agents:event", { ...event, agentId });
	}
}

function emitDeleteEvent(event: AgentDeleteEvent): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (win.isDestroyed() || win.webContents.isDestroyed()) {
			continue;
		}
		win.webContents.send("agents:delete-event", event);
	}
}

function waitForMinimumStepDuration(startedAt: number, minimumMs = 500): Promise<void> {
	const remainingMs = minimumMs - (Date.now() - startedAt);
	if (remainingMs <= 0) {
		return Promise.resolve();
	}
	return new Promise((resolveWait) => setTimeout(resolveWait, remainingMs));
}

async function deleteAgent(id: string): Promise<void> {
	const registry = loadProfileRegistry();
	const entry = registry.profiles[id];
	const rootDir = getDefaultPieRootDir();
	const home = entry?.home ? profileHomeFromEntry(rootDir, entry.home) : getProfileHomeDir(id, rootDir);
	let stepStartedAt = Date.now();
	emitDeleteEvent({ agentId: id, step: "stop", message: "停止运行中的实例" });
	if (agentProcesses.isRunning(id)) {
		await agentProcesses.stop(id, "deleted");
	} else {
		await stopLiveRuntimeProcessRecord({ homeDir: home, forceKillMs: RUNTIME_STOP_FORCE_KILL_MS });
	}
	await waitForMinimumStepDuration(stepStartedAt);
	stepStartedAt = Date.now();
	emitDeleteEvent({ agentId: id, step: "files", message: "清除 Agent 文件" });
	deleteProfileRegistryEntry(id);
	if (home.startsWith(resolve(rootDir, "profiles"))) {
		rmSync(home, { recursive: true, force: true });
	}
	await waitForMinimumStepDuration(stepStartedAt);
	stepStartedAt = Date.now();
	emitDeleteEvent({ agentId: id, step: "done", message: "删除完成" });
	await waitForMinimumStepDuration(stepStartedAt);
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

function loadRendererWindow(win: BrowserWindow, options?: { mode?: "menubar" }): void {
	const appRoot = app.getAppPath();
	const query = options?.mode ? `?mode=${options.mode}` : "";
	if (process.env.ELECTRON_RENDERER_URL) {
		void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}${query}`).catch((error) => {
			console.error("[desktop] loadURL failed:", error);
		});
	} else {
		void win.loadFile(join(appRoot, "out/renderer/index.html"), {
			...(options?.mode ? { query: { mode: options.mode } } : {}),
		}).catch((error) => {
			console.error("[desktop] loadFile failed:", error);
		});
	}
}

function showMainWindow(agentId?: string): void {
	if (!mainWindow || mainWindow.isDestroyed()) {
		createWindow();
	}
	const win = mainWindow;
	if (!win) {
		return;
	}
	if (win.isMinimized()) {
		win.restore();
	}
	win.show();
	win.focus();
	if (agentId) {
		if (win.webContents.isLoading()) {
			win.webContents.once("did-finish-load", () => {
				win.webContents.send("agents:select", agentId);
			});
		} else {
			win.webContents.send("agents:select", agentId);
		}
	}
}

function createWindow(): BrowserWindow {
	if (mainWindow && !mainWindow.isDestroyed()) {
		return mainWindow;
	}
	const appRoot = app.getAppPath();
	const preloadPath = join(appRoot, "out/preload/index.cjs");
	const win = new BrowserWindow({
		width: 1024,
		height: 576,
		minWidth: 840,
		minHeight: 520,
		show: false,
		title: "Pie",
		transparent: true,
		frame: false,
		hasShadow: true,
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

	win.on("close", (event) => {
		if (isQuitting) {
			return;
		}
		event.preventDefault();
		win.hide();
	});

	win.on("closed", () => {
		if (mainWindow === win) {
			mainWindow = undefined;
		}
	});

	mainWindow = win;
	loadRendererWindow(win);
	return win;
}

function createTrayIcon(): Electron.NativeImage {
	const image = nativeImage.createFromDataURL(
		"data:image/svg+xml;utf8," +
			encodeURIComponent(
				`<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
					<path fill="black" d="M9 1.6c4.1 0 7.4 3.3 7.4 7.4S13.1 16.4 9 16.4 1.6 13.1 1.6 9 4.9 1.6 9 1.6Zm0 2.2A5.2 5.2 0 1 0 9 14.2 5.2 5.2 0 0 0 9 3.8Zm0 2.3a2.9 2.9 0 1 1 0 5.8A2.9 2.9 0 0 1 9 6.1Z"/>
				</svg>`,
			),
	);
	image.setTemplateImage(true);
	return image;
}

function positionMenuBarWindow(): void {
	if (!tray || !menuBarWindow) {
		return;
	}
	const trayBounds = tray.getBounds();
	const display = screen.getDisplayNearestPoint({
		x: Math.round(trayBounds.x + trayBounds.width / 2),
		y: Math.round(trayBounds.y + trayBounds.height / 2),
	});
	const winBounds = menuBarWindow.getBounds();
	const workArea = display.workArea;
	const x = Math.round(Math.min(Math.max(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2, workArea.x + 8), workArea.x + workArea.width - winBounds.width - 8));
	const belowY = trayBounds.y + trayBounds.height + 8;
	const aboveY = trayBounds.y - winBounds.height - 8;
	const y = belowY + winBounds.height <= workArea.y + workArea.height ? belowY : Math.max(workArea.y + 8, aboveY);
	menuBarWindow.setPosition(x, y, false);
}

function createMenuBarWindow(): BrowserWindow {
	if (menuBarWindow && !menuBarWindow.isDestroyed()) {
		return menuBarWindow;
	}
	const appRoot = app.getAppPath();
	const preloadPath = join(appRoot, "out/preload/index.cjs");
	const win = new BrowserWindow({
		width: 320,
		height: 420,
		show: false,
		frame: false,
		resizable: false,
		fullscreenable: false,
		skipTaskbar: true,
		transparent: true,
		hasShadow: true,
		backgroundColor: "#00000000",
		alwaysOnTop: true,
		webPreferences: {
			preload: preloadPath,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	win.on("blur", () => {
		if (!win.webContents.isDevToolsOpened()) {
			win.hide();
		}
	});
	win.on("closed", () => {
		if (menuBarWindow === win) {
			menuBarWindow = undefined;
		}
	});
	menuBarWindow = win;
	loadRendererWindow(win, { mode: "menubar" });
	return win;
}

function toggleMenuBarWindow(): void {
	const win = createMenuBarWindow();
	if (win.isVisible()) {
		win.hide();
		return;
	}
	positionMenuBarWindow();
	win.show();
	win.focus();
}

function createTray(): void {
	if (tray) {
		return;
	}
	tray = new Tray(createTrayIcon());
	tray.setToolTip("Pie");
	tray.on("click", toggleMenuBarWindow);
	tray.on("right-click", toggleMenuBarWindow);
}

app.whenReady().then(() => {
	const settings = readDesktopSettings();
	applyOpenAtLoginSetting(settings);
	applyKeepAwakeSetting(settings);
	ipcMain.handle("desktop:bootstrap", async () => {
		try {
			return await getDesktopBootstrap();
		} catch (error) {
			console.error("[ipc] desktop:bootstrap failed:", error);
			throw error;
		}
	});
	ipcMain.handle("settings:get", async () => readDesktopSettings());
	ipcMain.handle("settings:update", async (_event, draft: DesktopSettingsDraft) => {
		try {
			return await saveDesktopSettings(draft);
		} catch (error) {
			console.error("[ipc] settings:update failed:", error);
			throw error;
		}
	});
	ipcMain.handle("bot-avatars:list", async () => {
		try {
			return await listBotAvatars();
		} catch (error) {
			console.error("[ipc] bot-avatars:list failed:", error);
			throw error;
		}
	});
	ipcMain.handle("bot-avatars:download", async (_event, id: string) => {
		try {
			await downloadBotAvatar(id);
		} catch (error) {
			console.error("[ipc] bot-avatars:download failed:", error);
			throw error;
		}
	});
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
	ipcMain.handle("agents:importable-harness-profiles", async (_event, kind: "openclaw" | "hermes") => {
		try {
			return listImportableHarnessProfiles(kind);
		} catch (error) {
			console.error("[ipc] agents:importable-harness-profiles failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:openclaw-model-catalog", async () => {
		try {
			return loadOpenClawModelCatalog();
		} catch (error) {
			console.error("[ipc] agents:openclaw-model-catalog failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:codex-diagnostic", async (): Promise<DesktopCodexDiagnostic> => {
		try {
			return await checkCodexEnvironmentForDesktop();
		} catch (error) {
			console.error("[ipc] agents:codex-diagnostic failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:codex-install", async (_event, sessionId: string): Promise<DesktopCodexDiagnostic> => {
		try {
			return await installCodexForDesktop(sessionId, emitOnboardEvent);
		} catch (error) {
			console.error("[ipc] agents:codex-install failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:codex-login", async (_event, sessionId: string): Promise<DesktopCodexDiagnostic> => {
		try {
			return await openCodexLoginForDesktop(sessionId, emitOnboardEvent, (url) => shell.openExternal(url));
		} catch (error) {
			console.error("[ipc] agents:codex-login failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:hermes-diagnostic", async (): Promise<DesktopRuntimeDiagnostic> => {
		try {
			return await checkHermesEnvironmentForDesktop();
		} catch (error) {
			console.error("[ipc] agents:hermes-diagnostic failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:hermes-install", async (_event, sessionId: string): Promise<DesktopRuntimeDiagnostic> => {
		try {
			return await installHermesForDesktop(sessionId, emitOnboardEvent);
		} catch (error) {
			console.error("[ipc] agents:hermes-install failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:hermes-install-cancel", async (_event, sessionId: string): Promise<void> => {
		try {
			await cancelHermesInstallForDesktop(sessionId);
		} catch (error) {
			console.error("[ipc] agents:hermes-install-cancel failed:", error);
			throw error;
		}
	});
	ipcMain.handle("runtimes:status", async (_event, kind: DesktopManagedRuntimeKind): Promise<DesktopManagedRuntimeStatus> => {
		try {
			return await checkManagedRuntimeForDesktop(kind);
		} catch (error) {
			console.error("[ipc] runtimes:status failed:", error);
			throw error;
		}
	});
	ipcMain.handle("runtimes:upgrade", async (_event, kind: DesktopManagedRuntimeKind): Promise<DesktopManagedRuntimeStatus> => {
		try {
			return await upgradeManagedRuntimeForDesktop(kind);
		} catch (error) {
			console.error("[ipc] runtimes:upgrade failed:", error);
			throw error;
		}
	});
	ipcMain.handle("runtimes:uninstall", async (_event, kind: DesktopManagedRuntimeKind): Promise<DesktopManagedRuntimeStatus> => {
		try {
			return await uninstallManagedRuntimeForDesktop(kind);
		} catch (error) {
			console.error("[ipc] runtimes:uninstall failed:", error);
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
	ipcMain.handle("agents:create-wechat-login", async (_event, sessionId: string): Promise<DesktopWechatCredentials> => {
		try {
			return await createWechatLoginForSession(sessionId, emitOnboardEvent);
		} catch (error) {
			console.error("[ipc] agents:create-wechat-login failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:create-discord-profile", async (_event, sessionId: string, botToken: string) => {
		try {
			return await fetchDiscordBotProfileForSession(sessionId, botToken, emitOnboardEvent);
		} catch (error) {
			console.error("[ipc] agents:create-discord-profile failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:sync-feishu-app-profile", async (_event, id: string): Promise<AgentDetails> => {
		try {
			return await withAgentOperation(id, () => syncFeishuAppProfile(id));
		} catch (error) {
			console.error("[ipc] agents:sync-feishu-app-profile failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:sync-discord-bot-profile", async (_event, id: string, botToken?: string): Promise<AgentDetails> => {
		try {
			return await withAgentOperation(id, () => syncDiscordBotProfile(id, botToken));
		} catch (error) {
			console.error("[ipc] agents:sync-discord-bot-profile failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:reauthorize-feishu", async (_event, id: string): Promise<AgentDetails> => {
		try {
			return await withAgentOperation(id, () => reauthorizeFeishuAgent(id));
		} catch (error) {
			console.error("[ipc] agents:reauthorize-feishu failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:reauthorize-wechat", async (_event, id: string): Promise<AgentDetails> => {
		try {
			return await withAgentOperation(id, () => reauthorizeWechatAgent(id));
		} catch (error) {
			console.error("[ipc] agents:reauthorize-wechat failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:create-complete", async (_event, draft: AgentCreationDraft) => {
		try {
			await completeCreationSession(draft);
			if (draft.channels.includes("feishu") && draft.feishu?.appId) {
				await invalidateFeishuCredentialsOwnedByOtherAgents(draft.sessionId, draft.feishu.appId);
			}
			const agent = await getAgent(draft.sessionId);
			if (draft.feishu?.avatarUrl) {
				await downloadRemoteAvatarToProfile(draft.feishu.avatarUrl, agent.home);
			} else if (draft.avatarUpload) {
				writeUploadToProfileAvatar(draft.avatarUpload, agent.home);
			} else if (draft.discord?.avatarUrl) {
				await downloadRemoteAvatarToProfile(draft.discord.avatarUrl, agent.home);
			}
			return await withAgentOperation(draft.sessionId, () => startAgent(draft.sessionId));
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
	ipcMain.handle("agents:avatar-upload", async (_event, id: string, upload: AgentAvatarUpload) => {
		try {
			return await withAgentOperation(id, () => uploadAgentAvatar(id, upload));
		} catch (error) {
			console.error("[ipc] agents:avatar-upload failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:avatar-download", async (_event, id: string) => {
		try {
			await downloadAgentAvatar(id);
		} catch (error) {
			console.error("[ipc] agents:avatar-download failed:", error);
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
	ipcMain.handle("agents:restart", async (_event, id: string) => {
		try {
			return await withAgentOperation(id, () => restartAgent(id));
		} catch (error) {
			console.error("[ipc] agents:restart failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:pause", async (_event, id: string) => {
		try {
			return await pauseAgent(id);
		} catch (error) {
			console.error("[ipc] agents:pause failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:delete", async (_event, id: string) => {
		try {
			await deleteAgent(id);
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
	ipcMain.handle("agents:resources", async (_event, id: string) => {
		try {
			return await getAgentResources(id);
		} catch (error) {
			console.error("[ipc] agents:resources failed:", error);
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
	ipcMain.handle("agents:provider-credential-reuse", async (_event, provider: string, excludeAgentId?: string) => {
		try {
			return await findReusableProviderCredential(provider, excludeAgentId);
		} catch (error) {
			console.error("[ipc] agents:provider-credential-reuse failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:skill-sources", async (_event, id: string) => {
		try {
			return await getAgentSkillSources(id);
		} catch (error) {
			console.error("[ipc] agents:skill-sources failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:skill-source-open", async (_event, id: string, sourceId: string) => {
		try {
			return await openAgentSkillSource(id, sourceId);
		} catch (error) {
			console.error("[ipc] agents:skill-source-open failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:skill-folder-open", async (_event, id: string, sourceId: string, skillName: string) => {
		try {
			return await openAgentSkillFolder(id, sourceId, skillName);
		} catch (error) {
			console.error("[ipc] agents:skill-folder-open failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:system-prompt", async (_event, id: string) => {
		try {
			return await getAgentSystemPrompt(id);
		} catch (error) {
			console.error("[ipc] agents:system-prompt failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:system-prompt-open", async (_event, id: string) => {
		try {
			return await openAgentSystemPrompt(id);
		} catch (error) {
			console.error("[ipc] agents:system-prompt-open failed:", error);
			throw error;
		}
	});
	ipcMain.handle("agents:logs", async (_event, id: string) => {
		return getAgentLogs(id);
	});
	ipcMain.handle("agents:events", async (_event, id: string) => {
		return getAgentEvents(id);
	});
	ipcMain.handle("agents:chat-send", async (_event, id: string, prompt: string, sessionKey?: string, clientMessageId?: string) => {
		return sendAgentChatMessage(id, prompt, sessionKey, clientMessageId);
	});
	ipcMain.handle("agents:chat-command", async (_event, id: string, command: "new" | "status" | "compact" | "clear", sessionKey?: string) => {
		return runAgentChatSessionCommand(id, command, sessionKey);
	});
	ipcMain.handle("agents:chat-clear", async (_event, id: string, sessionKey?: string) => {
		return clearAgentChatSession(id, sessionKey);
	});
	ipcMain.handle("menu-bar:open-agent", async (_event, id: string) => {
		menuBarWindow?.hide();
		showMainWindow(id);
	});
	createTray();
	createWindow();
	scheduleStoredRuntimeDataPrune(settings);
	setTimeout(() => {
		void restoreDesiredRunningAgents().catch((error) => {
			console.error("[desktop] failed to restore auto-start agents:", error);
		});
	}, RESTORE_AGENTS_ON_LAUNCH_DELAY_MS);
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.on("activate", () => {
	showMainWindow();
});

app.on("before-quit", (event) => {
	isQuitting = true;
	applyKeepAwakeSetting({ ...readDesktopSettings(), keepAwakeWhileOpen: false });
	cancelAllHermesInstallsForDesktop();
	if (readDesktopSettings().quitTerminatesAgents && !didStopAgentsForQuit) {
		event.preventDefault();
		void stopAgentsForQuit().finally(() => {
			didStopAgentsForQuit = true;
			app.quit();
		});
	}
});
