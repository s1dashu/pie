import { app, BrowserWindow, Tray, dialog, ipcMain, nativeImage, powerSaveBlocker, screen, shell } from "electron";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { totalmem } from "node:os";
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
import {
	getPrimaryFeishuChannel,
	getPrimaryDiscordChannel,
	getPrimarySlackChannel,
	getPrimaryTelegramChannel,
	getPrimaryWechatChannel,
	getProfileModel,
	normalizeConfigStore,
	setProfileModel,
	upsertFeishuChannel,
	upsertDiscordChannel,
	upsertSlackChannel,
	upsertTelegramChannel,
	upsertWechatChannel,
	type AgentConfigStore,
} from "../../core/config-store.js";
import { appendAgentLogEntry, pruneAgentLogEntries, readAgentLogEntries } from "../../core/agent-logs.js";
import { appendAgentUsageEvent, pruneAgentUsageEvents, readAgentUsageEvents, summarizeAgentUsage } from "../../core/usage-stats.js";
import { resolveSkillSources } from "../../agents/skills.js";
import {
	clearRuntimeProcessRecord,
	isPidRunning,
	readRuntimeProcessRecord,
	readRuntimeStateRecord,
	writeRuntimeStateRecord,
} from "../../core/runtime-process.js";
import { LarkClient } from "../../channels/feishu/platform/core/lark-client.js";
import type {
	AgentCreationDraft,
	AgentAvatarUpload,
	AgentDeleteEvent,
	AgentDetails,
	AgentDesiredState,
	AgentDraft,
	AgentLogEntry,
	AgentOnboardEvent,
	AgentResourceStats,
	AgentSkillSource,
	AgentSystemPromptSource,
	AgentSummary,
	BotAvatarOption,
	DesktopCodexDiagnostic,
	DesktopModelCatalog,
	DesktopFeishuAppCredentials,
	DesktopRuntimeDiagnostic,
	DesktopWechatCredentials,
	DesktopSettings,
	DesktopSettingsDraft,
	ProviderCredentialReuse,
	RuntimeEnvironmentSummary,
} from "../shared/types.js";
import {
	beginAgentCreation as beginCreationSession,
	checkCodexEnvironmentForDesktop,
	checkHermesEnvironmentForDesktop,
	completeAgentCreation as completeCreationSession,
	createFeishuAppForSession,
	createWechatLoginForSession,
	deriveHermesApiServerPort,
	getProviderCredentialEnv,
	installCodexForDesktop,
	installHermesForDesktop,
	loadHermesModelCatalog,
	loadCodexModelCatalog,
	loadModelCatalog,
	loadModelOptions,
	openCodexLoginForDesktop,
	toHermesInferenceProvider,
} from "./onboard-service.js";
import { OUSIA_SYSTEM_PROMPT_FILE } from "../../frameworks/ousia/framework.js";
import { AgentProcessManager } from "./agent-process-manager.js";
import { readDesktopSettings, retentionToDays, updateDesktopSettings } from "./desktop-settings.js";
import { createRuntimeEnvironment } from "../../runtime/environment.js";
import { getAgentBackendDefinition } from "../../agents/backend-registry.js";
import type { AgentFrameworkRuntime } from "../../core/backend-framework.js";

const agentOperations = new Map<string, Promise<unknown>>();
const storageStatsCache = new Map<string, { value: Pick<AgentResourceStats, "storageBytes" | "diskTotalBytes" | "diskAvailableBytes">; expiresAt: number }>();
const cpuStatsCache = new Map<string, { cpuTimeSeconds: number; sampledAt: number }>();
const PROFILE_AVATAR_STEM = "avatar";
const PROFILE_AVATAR_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"] as const;
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

function getDefaultOusiaSystemPromptPath(): string {
	return OUSIA_SYSTEM_PROMPT_FILE;
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
		console.warn("[desktop] failed to download Feishu app avatar:", error);
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

function copyDefaultAvatarToProfile(avatarId: string | undefined, homeDir: string): string | undefined {
	if (!avatarId?.trim()) {
		return undefined;
	}
	const source = resolveBotAvatarPath(avatarId.trim());
	copyImageToProfileAvatar(source, homeDir);
	return basename(profileAvatarPath(homeDir) ?? "");
}

function readProfileAvatarUrl(homeDir: string): string | undefined {
	const source = profileAvatarPath(homeDir);
	return source ? readImageDataUrl(source) : undefined;
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

function readDirectorySize(path: string): number {
	if (!existsSync(path)) {
		return 0;
	}
	try {
		const stat = lstatSync(path);
		if (!stat.isDirectory()) {
			return stat.size;
		}
		return readdirSync(path).reduce((total, child) => total + readDirectorySize(join(path, child)), 0);
	} catch {
		return 0;
	}
}

function readDiskStats(path: string): { diskTotalBytes?: number; diskAvailableBytes?: number } {
	const df = spawnSync("df", ["-k", path], { encoding: "utf8" });
	if (df.status !== 0 || !df.stdout.trim()) {
		return {};
	}
	const line = df.stdout.trim().split("\n").at(-1);
	if (!line) {
		return {};
	}
	const parts = line.trim().split(/\s+/);
	const totalKb = Number(parts[1]);
	const availableKb = Number(parts[3]);
	return {
		...(Number.isFinite(totalKb) ? { diskTotalBytes: totalKb * 1024 } : {}),
		...(Number.isFinite(availableKb) ? { diskAvailableBytes: availableKb * 1024 } : {}),
	};
}

interface ProcessResourceRow {
	pid: number;
	ppid: number;
	rssKb: number;
	cpuPercent: number;
	cpuTimeSeconds: number;
	command: string;
}

function readProcessResourceRows(): ProcessResourceRow[] {
	const ps = spawnSync("ps", ["-axo", "pid=,ppid=,rss=,%cpu=,time=,command="], { encoding: "utf8" });
	if (ps.status !== 0 || !ps.stdout.trim()) {
		return [];
	}
	return ps.stdout.split("\n").flatMap((line) => {
		const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(.+)$/);
		if (!match) {
			return [];
		}
		const [, pidText, ppidText, rssText, cpuText, timeText, command] = match;
		const pid = Number(pidText);
		const ppid = Number(ppidText);
		const rssKb = Number(rssText);
		const cpuPercent = Number(cpuText);
		const cpuTimeSeconds = parseCpuTimeSeconds(timeText);
		if (![pid, ppid, rssKb, cpuPercent, cpuTimeSeconds].every(Number.isFinite)) {
			return [];
		}
		return [{ pid, ppid, rssKb, cpuPercent, cpuTimeSeconds, command }];
	});
}

function parseCpuTimeSeconds(value: string): number {
	const [dayOrTime, rest] = value.includes("-") ? value.split("-", 2) : ["0", value];
	const days = Number(dayOrTime);
	const parts = rest.split(":").map(Number);
	if (parts.some((part) => !Number.isFinite(part))) {
		return 0;
	}
	const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, parts[0] ?? 0, parts[1] ?? 0];
	return days * 86_400 + hours * 3_600 + minutes * 60 + seconds;
}

function readExpandedProcessCommand(pid: number): string {
	const ps = spawnSync("ps", ["eww", "-p", String(pid), "-o", "command="], { encoding: "utf8", maxBuffer: 1024 * 1024 });
	return ps.status === 0 ? ps.stdout : "";
}

function findDescendantPids(rootPid: number, rows: ProcessResourceRow[]): Set<number> {
	const descendants = new Set<number>([rootPid]);
	let changed = true;
	while (changed) {
		changed = false;
		for (const row of rows) {
			if (!descendants.has(row.pid) && descendants.has(row.ppid)) {
				descendants.add(row.pid);
				changed = true;
			}
		}
	}
	return descendants;
}

function isAgentProcessForHome(row: ProcessResourceRow, homeDir: string): boolean {
	if (
		!/src\/runtime\/main\.ts|dist\/runtime\/main\.js|src\/frameworks\/ousia\/task-engine\/|dist\/frameworks\/ousia\/task-engine\//.test(
			row.command,
		)
	) {
		return false;
	}
	return readExpandedProcessCommand(row.pid).includes(`PIE_AGENT_HOME=${homeDir}`);
}

function readProcessResourceStats(pid: number | undefined, homeDir: string): Pick<AgentResourceStats, "cpuPercent" | "memoryBytes" | "memoryPercent" | "pid" | "running"> {
	const rows = readProcessResourceRows();
	if (!rows.length) {
		return { cpuPercent: 0, memoryBytes: 0, memoryPercent: 0, running: false };
	}
	const selectedPids = pid ? findDescendantPids(pid, rows) : new Set<number>();
	for (const row of rows) {
		if (isAgentProcessForHome(row, homeDir)) {
			for (const descendantPid of findDescendantPids(row.pid, rows)) {
				selectedPids.add(descendantPid);
			}
		}
	}
	const selectedRows = rows.filter((row) => selectedPids.has(row.pid));
	if (!selectedRows.length) {
		return { cpuPercent: 0, memoryBytes: 0, memoryPercent: 0, ...(pid ? { pid } : {}), running: false };
	}
	const memoryBytes = selectedRows.reduce((total, row) => total + row.rssKb * 1024, 0);
	const cpuTimeSeconds = selectedRows.reduce((total, row) => total + row.cpuTimeSeconds, 0);
	const fallbackCpuPercent = selectedRows.reduce((total, row) => total + row.cpuPercent, 0);
	const previousCpuStats = cpuStatsCache.get(homeDir);
	const sampledAt = Date.now();
	const elapsedSeconds = previousCpuStats ? (sampledAt - previousCpuStats.sampledAt) / 1000 : 0;
	const cpuPercent = previousCpuStats && elapsedSeconds > 0
		? ((cpuTimeSeconds - previousCpuStats.cpuTimeSeconds) / elapsedSeconds) * 100
		: fallbackCpuPercent;
	cpuStatsCache.set(homeDir, { cpuTimeSeconds, sampledAt });
	const primaryPid = pid ?? selectedRows.find((row) => row.command.includes("src/runtime/main.ts") || row.command.includes("dist/runtime/main.js"))?.pid ?? selectedRows[0]?.pid;
	return {
		cpuPercent: Math.max(0, cpuPercent),
		memoryBytes: Math.max(0, memoryBytes),
		memoryPercent: Math.max(0, (memoryBytes / totalmem()) * 100),
		...(primaryPid ? { pid: primaryPid } : {}),
		running: true,
	};
}

function readStorageResourceStats(path: string): Pick<AgentResourceStats, "storageBytes" | "diskTotalBytes" | "diskAvailableBytes"> {
	const cached = storageStatsCache.get(path);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.value;
	}
	const value = {
		storageBytes: readDirectorySize(path),
		...readDiskStats(path),
	};
	storageStatsCache.set(path, { value, expiresAt: Date.now() + 15_000 });
	return value;
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
	const framework: Pick<AgentFrameworkRuntime, "label" | "systemPrompt"> = (() => {
		try {
			return getAgentBackendDefinition(profile?.backend.kind ?? "pi").frameworkRuntime;
		} catch {
			const label = String(profile?.backend.kind ?? "backend");
			return { label };
		}
	})();
	if (!framework.systemPrompt) {
		return {
			label: "系统提示词",
			description: `${framework.label} 的系统提示词由 backend runtime 内置或自行管理，Pie 当前没有注入可编辑的系统提示词文件。`,
			path: "",
			exists: true,
			content: `${framework.label} 使用 backend runtime 提供的系统提示词；这里没有需要打开的本地提示词文件。`,
		};
	}

	const configuredPath = getConfiguredSystemPromptPath(profile, env);
	const path = configuredPath ?? framework.systemPrompt.defaultPath;
	return describeSystemPromptSource({
		label: "系统提示词",
		description: `${framework.systemPrompt.label} 当前注入到 Agent session。`,
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
	const record = readRuntimeProcessRecord(home);
	if (!record) {
		return false;
	}
	if (resolve(record.agentHome) !== resolve(home) || !isPidRunning(record.pid)) {
		clearRuntimeProcessRecord(home);
		const persisted = readRuntimeStateRecord(home);
		if (
			persisted?.lifecycle.state === "running" ||
			persisted?.lifecycle.state === "starting" ||
			persisted?.lifecycle.state === "degraded"
		) {
			writeRuntimeStateRecord(home, {
				homeDir: persisted.homeDir,
				workDir: persisted.workDir,
				lifecycle: {
					state: "stopped",
					updatedAt: new Date().toISOString(),
					reason: "stale-process",
				},
			});
		}
		return false;
	}
	return true;
}

function signalRuntimeProcess(pid: number, signal: NodeJS.Signals): void {
	if (process.platform !== "win32") {
		try {
			process.kill(-pid, signal);
			return;
		} catch {
			// Fall back to the direct process. The runtime may not be a process-group leader.
		}
	}
	try {
		process.kill(pid, signal);
	} catch {
		// best effort
	}
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

async function listAgents(): Promise<AgentSummary[]> {
	const registry = loadProfileRegistry();
	const rootDir = getDefaultPieRootDir();
	return Object.entries(registry.profiles).map(([id, entry]) => {
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
		const frameworkKind = profile?.backend.kind ? String(profile.backend.kind) : undefined;
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
			selected: registry.selectedProfile === id,
			home,
			runtimeEnvironment,
			createdAt: entry.createdAt,
			updatedAt: entry.updatedAt,
			frameworkKind,
			modelLabel,
			channelKinds,
			appId: channel?.appId,
		};
	}).sort((left, right) => agentSortTimestamp(right) - agentSortTimestamp(left));
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

async function saveDesktopSettings(draft: DesktopSettingsDraft): Promise<DesktopSettings> {
	const settings = updateDesktopSettings(draft);
	applyOpenAtLoginSetting(settings);
	applyKeepAwakeSetting(settings);
	pruneStoredRuntimeData(settings);
	return settings;
}

async function restoreDesiredRunningAgents(): Promise<void> {
	if (!readDesktopSettings().restoreRunningAgentsOnLaunch) {
		return;
	}
	const agents = await listAgents();
	const candidates = agents.filter((agent) => agent.desiredState === "running" && !hasLiveRuntimeProcess(agent.home));
	for (const agent of candidates) {
		restoringAgentIds.add(agent.id);
	}
	await Promise.allSettled(
		candidates.map((agent) =>
			withAgentOperation(agent.id, () => startAgent(agent.id))
				.catch((error) => {
					const message = error instanceof Error ? error.message : String(error);
					writeRuntimeStateRecord(agent.home, {
						homeDir: agent.runtimeEnvironment?.homeDir ?? agent.home,
						workDir: agent.runtimeEnvironment?.workDir ?? agent.home,
						lifecycle: {
							state: "failed",
							updatedAt: new Date().toISOString(),
							reason: `restore-failed: ${message}`,
						},
					});
					console.error(`[desktop] failed to restore agent ${agent.id}:`, error);
				})
				.finally(() => {
					restoringAgentIds.delete(agent.id);
				}),
		),
	);
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
			...(apiKeyEnv ? { apiKeyEnv, apiKey: env[apiKeyEnv] ?? "" } : {}),
		},
	};
}

async function getAgentUsage(id: string) {
	const agent = await getAgent(id);
	return summarizeAgentUsage(readAgentUsageEvents(agent.home), { runningSince: agentProcesses.getStartedAt(id) });
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
	const processStats = readProcessResourceStats(agentProcesses.getPid(id), agent.home);
	return {
		...processStats,
		...readStorageResourceStats(agent.home),
		updatedAt: new Date().toISOString(),
	};
}

async function getAgentModelCatalog(id: string): Promise<DesktopModelCatalog> {
	const agent = await getAgent(id);
	const catalog = agent.frameworkKind === "hermes" ? loadHermesModelCatalog(agent.home) : loadModelCatalog(agent.home);
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

function validateModelDraft(draft: AgentDraft): void {
	const hasModelUpdate = draft.provider !== undefined || draft.model !== undefined || draft.thinkingLevel !== undefined;
	if (!hasModelUpdate) {
		return;
	}
	if (!draft.provider?.trim()) {
		throw new Error("模型 Provider 必填");
	}
	if (!draft.model?.trim()) {
		throw new Error("模型 ID 必填");
	}
}

function hasNonEmptyDraftValue(...values: Array<string | undefined>): boolean {
	return values.some((value) => typeof value === "string" && value.trim().length > 0);
}

function writeHermesModelConfig(homeDir: string, profileId: string, provider: string, model: string): Record<string, string> {
	const hermesProvider = toHermesInferenceProvider(provider);
	const hermesApiServerPort = deriveHermesApiServerPort(profileId);
	const hermesHome = join(homeDir, "hermes");
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

async function updateAgent(id: string, draft: AgentDraft): Promise<AgentDetails> {
	const agent = await getAgent(id);
	const current = readProfileConfig(agent.home) ?? { version: 3 };
	const currentProfile = current.profile;
	const feishuChannel = getPrimaryFeishuChannel(currentProfile);
	const wechatChannel = getPrimaryWechatChannel(currentProfile);
	const slackChannel = getPrimarySlackChannel(currentProfile);
	const discordChannel = getPrimaryDiscordChannel(currentProfile);
	const telegramChannel = getPrimaryTelegramChannel(currentProfile);
	const model = getProfileModel(currentProfile) ?? {};
	const hasFeishuDraft =
		draft.appId !== undefined ||
		draft.appSecret !== undefined ||
		draft.brand !== undefined ||
		draft.feishuMessageOutputMode !== undefined;
	const hasWechatDraft =
		draft.wechatAccountId !== undefined ||
		draft.wechatBaseUrl !== undefined ||
		draft.wechatBotToken !== undefined;
	const hasSlackDraft =
		draft.slackBotToken !== undefined ||
		draft.slackAppToken !== undefined;
	const hasDiscordDraft =
		draft.discordBotToken !== undefined ||
		draft.discordApplicationId !== undefined ||
		draft.discordGuildId !== undefined;
	const hasTelegramDraft = draft.telegramBotToken !== undefined || draft.telegramBotUsername !== undefined;
	const hasModelUpdate = draft.provider !== undefined || draft.model !== undefined || draft.thinkingLevel !== undefined;
	const hasFeishuUpdate = feishuChannel
		? hasFeishuDraft
		: hasNonEmptyDraftValue(draft.appId, draft.appSecret);
	const hasWechatUpdate = wechatChannel
		? hasWechatDraft
		: hasNonEmptyDraftValue(draft.wechatAccountId, draft.wechatBotToken);
	const hasSlackUpdate = slackChannel
		? hasSlackDraft
		: hasNonEmptyDraftValue(draft.slackBotToken, draft.slackAppToken);
	const hasDiscordUpdate = discordChannel
		? hasDiscordDraft
		: hasNonEmptyDraftValue(draft.discordBotToken, draft.discordApplicationId, draft.discordGuildId);
	const hasTelegramUpdate = telegramChannel
		? hasTelegramDraft
		: hasNonEmptyDraftValue(draft.telegramBotToken, draft.telegramBotUsername);
	const nextAppId = draft.appId ?? feishuChannel?.appId ?? "";
	const nextBrand = draft.brand ?? feishuChannel?.brand ?? "feishu";
	const nextFeishuMessageOutputMode = draft.feishuMessageOutputMode ?? feishuChannel?.messageOutputMode ?? "bubble";
	const nextAppSecret = draft.appSecret ?? readProfileEnv(agent.home).FEISHU_APP_SECRET ?? "";
	if (hasFeishuUpdate) {
		if (!nextAppId.trim() || !nextAppSecret.trim()) {
			throw new Error("飞书 App ID 和 App Secret 必填");
		}
		await validateFeishuCredentials({
			appId: nextAppId.trim(),
			appSecret: nextAppSecret.trim(),
			brand: nextBrand,
		});
	}
	const nextWechatAccountId = draft.wechatAccountId ?? wechatChannel?.accountId ?? "";
	const nextWechatBaseUrl = draft.wechatBaseUrl ?? wechatChannel?.baseUrl ?? "https://ilinkai.weixin.qq.com";
	if (hasWechatUpdate && !nextWechatAccountId.trim()) {
		throw new Error("微信 Account ID 必填");
	}
	if (hasSlackUpdate) {
		const env = readProfileEnv(agent.home);
		const botToken = draft.slackBotToken ?? env.SLACK_BOT_TOKEN ?? "";
		const appToken = draft.slackAppToken ?? env.SLACK_APP_TOKEN ?? "";
		if (!botToken.trim() || !appToken.trim()) {
			throw new Error("Slack Bot Token 和 App Token 必填");
		}
	}
	if (hasDiscordUpdate) {
		const token = draft.discordBotToken ?? readProfileEnv(agent.home).DISCORD_BOT_TOKEN ?? "";
		if (!token.trim()) {
			throw new Error("Discord Bot Token 必填");
		}
	}
	if (hasTelegramUpdate) {
		const token = draft.telegramBotToken ?? readProfileEnv(agent.home).TELEGRAM_BOT_TOKEN ?? "";
		if (!token.trim()) {
			throw new Error("Telegram Bot Token 必填");
		}
	}
	validateModelDraft(draft);
	let nextProfileWithChannel = currentProfile;
	if (feishuChannel || hasFeishuUpdate) {
		nextProfileWithChannel = upsertFeishuChannel(nextProfileWithChannel, {
			...(feishuChannel ?? { kind: "feishu" as const, id: "feishu", enabled: true }),
			appId: nextAppId.trim(),
			brand: nextBrand,
			messageOutputMode: nextFeishuMessageOutputMode,
		});
	}
	if (wechatChannel || hasWechatUpdate) {
		nextProfileWithChannel = upsertWechatChannel(nextProfileWithChannel, {
			...(wechatChannel ?? { kind: "wechat" as const, id: "wechat", enabled: true }),
			accountId: nextWechatAccountId.trim(),
			baseUrl: nextWechatBaseUrl.trim(),
		});
	}
	if (slackChannel || hasSlackUpdate) {
		nextProfileWithChannel = upsertSlackChannel(nextProfileWithChannel, {
			...(slackChannel ?? { kind: "slack" as const, id: "slack", enabled: true }),
		});
	}
	if (discordChannel || hasDiscordUpdate) {
		nextProfileWithChannel = upsertDiscordChannel(nextProfileWithChannel, {
			...(discordChannel ?? { kind: "discord" as const, id: "discord", enabled: true }),
			applicationId: draft.discordApplicationId ?? discordChannel?.applicationId,
			guildId: draft.discordGuildId ?? discordChannel?.guildId,
		});
	}
	if (telegramChannel || hasTelegramUpdate) {
		nextProfileWithChannel = upsertTelegramChannel(nextProfileWithChannel, {
			...(telegramChannel ?? { kind: "telegram" as const, id: "telegram", enabled: true }),
			botUsername: draft.telegramBotUsername ?? telegramChannel?.botUsername,
		});
	}
	const nextProfile = setProfileModel(nextProfileWithChannel, {
		...model,
		provider: draft.provider ?? model.provider,
		model: draft.model ?? model.model,
		thinkingLevel: draft.thinkingLevel ?? model.thinkingLevel,
		outputToolCallsToIm: draft.outputToolCallsToIm ?? model.outputToolCallsToIm ?? true,
		outputToolCallImMaxLength: draft.outputToolCallImMaxLength ?? model.outputToolCallImMaxLength ?? 60,
		outputThinkingToIm: draft.outputThinkingToIm ?? model.outputThinkingToIm ?? false,
	});
	writeProfileConfig(agent.home, {
		...current,
		version: 3,
		profile: nextProfile,
	});
	if (hasFeishuUpdate) {
		upsertAgentEnv({ FEISHU_APP_SECRET: nextAppSecret.trim() }, agent.home);
	}
	if (hasWechatUpdate) {
		const envUpdates: Record<string, string | undefined> = {};
		if (draft.wechatBotToken !== undefined) {
			envUpdates.WECHAT_BOT_TOKEN = draft.wechatBotToken.trim();
		}
		if (draft.wechatAccountId !== undefined) {
			envUpdates.WECHAT_ACCOUNT_ID = nextWechatAccountId.trim();
		}
		if (draft.wechatBaseUrl !== undefined) {
			envUpdates.WECHAT_BASE_URL = nextWechatBaseUrl.trim();
		}
		upsertAgentEnv(envUpdates, agent.home);
	}
	if (hasSlackUpdate) {
		upsertAgentEnv({
			...(draft.slackBotToken !== undefined ? { SLACK_BOT_TOKEN: draft.slackBotToken.trim() } : {}),
			...(draft.slackAppToken !== undefined ? { SLACK_APP_TOKEN: draft.slackAppToken.trim() } : {}),
		}, agent.home);
	}
	if (hasDiscordUpdate) {
		upsertAgentEnv({
			...(draft.discordBotToken !== undefined ? { DISCORD_BOT_TOKEN: draft.discordBotToken.trim() } : {}),
		}, agent.home);
	}
	if (hasTelegramUpdate) {
		upsertAgentEnv({
			...(draft.telegramBotToken !== undefined ? { TELEGRAM_BOT_TOKEN: draft.telegramBotToken.trim() } : {}),
		}, agent.home);
	}
	const nextProvider = draft.provider ?? model.provider;
	const nextModel = draft.model ?? model.model;
	if (hasModelUpdate && currentProfile?.backend.kind === "hermes" && nextProvider?.trim() && nextModel?.trim()) {
		upsertAgentEnv(writeHermesModelConfig(agent.home, id, nextProvider.trim(), nextModel.trim()), agent.home);
	}
	const apiKeyEnv = nextProvider ? getProviderCredentialEnv(nextProvider) : undefined;
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

async function startAgent(id: string): Promise<AgentDetails> {
	if (agentProcesses.isRunning(id)) {
		updateProfileRegistryEntry(id, { desiredState: "running", selected: true });
		return getAgent(id);
	}
	const existing = await getAgent(id);
	if (hasLiveRuntimeProcess(existing.home)) {
		writeRuntimeStateRecord(existing.home, {
			homeDir: existing.runtimeEnvironment?.homeDir ?? existing.home,
			workDir: existing.runtimeEnvironment?.workDir ?? existing.home,
			lifecycle: {
				state: "running",
				updatedAt: new Date().toISOString(),
				reason: "existing-process",
			},
			...(readRuntimeProcessRecord(existing.home) ? { process: readRuntimeProcessRecord(existing.home)! } : {}),
		});
		updateProfileRegistryEntry(id, { desiredState: "running", selected: true });
		return getAgent(id);
	}
	await agentProcesses.start(id);
	updateProfileRegistryEntry(id, { desiredState: "running", selected: true });
	return getAgent(id);
}

async function pauseAgent(id: string): Promise<AgentDetails> {
	await stopRunningAgent(id);
	return getAgent(id);
}

async function stopRunningAgent(id: string): Promise<void> {
	const agent = await getAgent(id);
	if (!agentProcesses.isRunning(id)) {
		const record = readRuntimeProcessRecord(agent.home);
		if (record && resolve(record.agentHome) === resolve(agent.home) && isPidRunning(record.pid)) {
			writeRuntimeStateRecord(agent.home, {
				homeDir: agent.runtimeEnvironment?.homeDir ?? agent.home,
				workDir: agent.runtimeEnvironment?.workDir ?? agent.home,
				lifecycle: {
					state: "stopping",
					updatedAt: new Date().toISOString(),
					reason: "paused",
				},
				process: record,
			});
			signalRuntimeProcess(record.pid, "SIGTERM");
			await new Promise((resolveStop) => setTimeout(resolveStop, 1500));
			if (isPidRunning(record.pid)) {
				signalRuntimeProcess(record.pid, "SIGKILL");
			}
		}
		clearRuntimeProcessRecord(agent.home);
		writeRuntimeStateRecord(agent.home, {
			homeDir: agent.runtimeEnvironment?.homeDir ?? agent.home,
			workDir: agent.runtimeEnvironment?.workDir ?? agent.home,
			lifecycle: {
				state: "stopped",
				updatedAt: new Date().toISOString(),
				reason: "paused",
			},
		});
		updateProfileRegistryEntry(id, { desiredState: "paused" });
		return;
	}
	await agentProcesses.stop(id, "paused");
	updateProfileRegistryEntry(id, { desiredState: "paused" });
}

async function stopAgentsForQuit(): Promise<void> {
	const agents = await listAgents();
	await Promise.allSettled(
		agents.map(async (agent) => {
			if (agentProcesses.isRunning(agent.id)) {
				await agentProcesses.stop(agent.id, "quit");
				return;
			}
			const record = readRuntimeProcessRecord(agent.home);
			if (!record || resolve(record.agentHome) !== resolve(agent.home) || !isPidRunning(record.pid)) {
				clearRuntimeProcessRecord(agent.home);
				return;
			}
			writeRuntimeStateRecord(agent.home, {
				homeDir: agent.runtimeEnvironment?.homeDir ?? agent.home,
				workDir: agent.runtimeEnvironment?.workDir ?? agent.home,
				lifecycle: {
					state: "stopping",
					updatedAt: new Date().toISOString(),
					reason: "quit",
				},
				process: record,
			});
			signalRuntimeProcess(record.pid, "SIGTERM");
			await new Promise((resolveStop) => setTimeout(resolveStop, 1500));
			if (isPidRunning(record.pid)) {
				signalRuntimeProcess(record.pid, "SIGKILL");
			}
			clearRuntimeProcessRecord(agent.home);
			writeRuntimeStateRecord(agent.home, {
				homeDir: agent.runtimeEnvironment?.homeDir ?? agent.home,
				workDir: agent.runtimeEnvironment?.workDir ?? agent.home,
				lifecycle: {
					state: "stopped",
					updatedAt: new Date().toISOString(),
					reason: "quit",
				},
			});
			appendAgentUsageEvent(agent.home, {
				type: "runtime",
				runtimeEvent: "stop",
				reason: "quit",
			});
		}),
	);
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
		width: 960,
		height: 680,
		minWidth: 800,
		minHeight: 480,
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
	pruneStoredRuntimeData(settings);
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
	ipcMain.handle("agents:sync-feishu-app-profile", async (_event, id: string): Promise<AgentDetails> => {
		try {
			return await withAgentOperation(id, () => syncFeishuAppProfile(id));
		} catch (error) {
			console.error("[ipc] agents:sync-feishu-app-profile failed:", error);
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
			completeCreationSession(draft);
			const agent = await getAgent(draft.sessionId);
			if (draft.feishu?.avatarUrl) {
				await downloadRemoteAvatarToProfile(draft.feishu.avatarUrl, agent.home);
			} else if (draft.channels.includes("wechat") && draft.avatarId) {
				copyDefaultAvatarToProfile(draft.avatarId, agent.home);
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
	ipcMain.handle("menu-bar:open-agent", async (_event, id: string) => {
		menuBarWindow?.hide();
		showMainWindow(id);
	});
	createTray();
	createWindow();
	void restoreDesiredRunningAgents().catch((error) => {
		console.error("[desktop] failed to restore auto-start agents:", error);
	});
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
	if (readDesktopSettings().quitTerminatesAgents && !didStopAgentsForQuit) {
		event.preventDefault();
		void stopAgentsForQuit().finally(() => {
			didStopAgentsForQuit = true;
			app.quit();
		});
	}
});
