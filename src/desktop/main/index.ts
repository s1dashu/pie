import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, totalmem } from "node:os";
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
import {
	clearRuntimeProcessRecord,
	isPidRunning,
	readRuntimeProcessRecord,
} from "../../core/runtime-process.js";
import { LarkClient } from "../../channels/feishu/platform/core/lark-client.js";
import type {
	AgentCreationDraft,
	AgentAvatarUpload,
	AgentDeleteEvent,
	AgentDetails,
	AgentDraft,
	AgentLogEntry,
	AgentOnboardEvent,
	AgentResourceStats,
	AgentSkillSource,
	AgentSystemPromptSource,
	AgentSummary,
	BotAvatarOption,
	DesktopModelCatalog,
	DesktopFeishuAppCredentials,
	DesktopWechatCredentials,
	DesktopSettings,
	DesktopSettingsDraft,
	ProviderCredentialReuse,
	RuntimeEnvironmentSummary,
} from "../shared/types.js";
import {
	beginAgentCreation as beginCreationSession,
	completeAgentCreation as completeCreationSession,
	createFeishuAppForSession,
	createWechatLoginForSession,
	getProviderCredentialEnv,
	loadModelCatalog,
	loadModelOptions,
} from "./onboard-service.js";
import { OUSIA_SYSTEM_PROMPT_FILE } from "../../frameworks/ousia/framework.js";
import { AgentProcessManager } from "./agent-process-manager.js";
import { readDesktopSettings, retentionToDays, updateDesktopSettings } from "./desktop-settings.js";
import { createRuntimeEnvironment } from "../../runtime/environment.js";

const agentOperations = new Map<string, Promise<unknown>>();
const storageStatsCache = new Map<string, { value: Pick<AgentResourceStats, "storageBytes" | "diskTotalBytes" | "diskAvailableBytes">; expiresAt: number }>();
const cpuStatsCache = new Map<string, { cpuTimeSeconds: number; sampledAt: number }>();
const PROFILE_AVATAR_STEM = "avatar";
const PROFILE_AVATAR_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"] as const;
let isQuitting = false;
let didStopAgentsForQuit = false;
let isRestoringEnabledAgents = true;

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

function getAgentTypeSkillDir(profile: AgentConfigStore["profile"]): { label: string; path: string } {
	const kind = String(profile?.backend.kind ?? "pi");
	if (kind === "codex") {
		return { label: "Codex 共享 Skills", path: join(homedir(), ".codex", "skills") };
	}
	if (kind === "claude" || kind === "claude-code") {
		return { label: "Claude 共享 Skills", path: join(homedir(), ".claude", "skills") };
	}
	if (kind === "ousia" || kind === "pi") {
		return { label: "Pi Agent Skills", path: join(homedir(), ".pi", "skills") };
	}
	return { label: `${kind} 共享 Skills`, path: join(homedir(), `.${kind}`, "skills") };
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

function resolveSystemPromptPath(profile: AgentConfigStore["profile"], env: Record<string, string>): { label: string; description: string; path: string } {
	const kind = String(profile?.backend.kind ?? "pi");
	if (kind === "ousia") {
		return {
			label: "系统提示词",
			description: "Ousia runtime 当前注入到 Agent session 的系统提示词。",
			path: resolve(env.FEISHU_BOT_SYSTEM_PROMPT_FILE?.trim() || getDefaultOusiaSystemPromptPath()),
		};
	}
	if (kind === "pi") {
		return {
			label: "系统提示词",
			description: "Pi Coding Agent 原版系统提示词由上游运行时提供；只有 Ousia framework 会注入 Ousia system prompt。",
			path: resolve(env.PI_CODING_AGENT_SYSTEM_PROMPT_FILE?.trim() || join(homedir(), ".pi", "system-prompt.md")),
		};
	}
	return {
		label: "系统提示词",
		description: `${kind} runtime 的系统提示词路径。`,
		path: resolve(env.SYSTEM_PROMPT_FILE?.trim() || join(homedir(), `.${kind}`, "system-prompt.md")),
	};
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

function statusForProfile(id: string, enabled: boolean): AgentSummary["status"] {
	if (agentProcesses.isReady(id)) {
		return "running";
	}
	if (agentProcesses.isRunning(id)) {
		return "starting";
	}
	if (enabled) {
		const agent = getAgentSummaryHome(id);
		if (agent && hasLiveRuntimeProcess(agent)) {
			return "running";
		}
		if (isRestoringEnabledAgents) {
			return "starting";
		}
	}
	return enabled ? "paused" : "terminated";
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
		return false;
	}
	return true;
}

function runtimeLifecycleForProfile(id: string, enabled: boolean): RuntimeEnvironmentSummary["lifecycle"] {
	const active = agentProcesses.getLifecycleSnapshot(id);
	if (active) {
		return active;
	}
	return {
		state: enabled ? "stopped" : "stopped",
		updatedAt: new Date().toISOString(),
		...(enabled ? { reason: "paused" } : { reason: "not-started" }),
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
		runtimeEnvironment.lifecycle = runtimeLifecycleForProfile(id, entry.enabled);
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
			status: statusForProfile(id, entry.enabled),
			avatarSeed: id,
			avatarUrl: readProfileAvatarUrl(home),
			enabled: entry.enabled,
			active: registry.activeProfile === id,
			home,
			runtimeEnvironment,
			createdAt: entry.createdAt,
			updatedAt: entry.updatedAt,
			frameworkKind,
			modelLabel,
			channelKinds,
			appId: channel?.appId,
		};
	});
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
	pruneStoredRuntimeData(settings);
	return settings;
}

async function restoreEnabledAgents(): Promise<void> {
	try {
		if (!readDesktopSettings().restoreRunningAgentsOnLaunch) {
			return;
		}
		const agents = await listAgents();
		await Promise.all(
			agents
				.filter((agent) => agent.enabled && !hasLiveRuntimeProcess(agent.home))
				.map((agent) => withAgentOperation(agent.id, () => startAgent(agent.id)).catch((error) => {
					console.error(`[desktop] failed to restore agent ${agent.id}:`, error);
				})),
		);
	} finally {
		isRestoringEnabledAgents = false;
	}
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
					signingSecret: env.SLACK_SIGNING_SECRET ?? "",
					teamId: slackChannel.teamId,
					appId: slackChannel.appId,
					botUserId: slackChannel.botUserId,
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
	return loadModelCatalog(agent.home);
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
	const typeSource = getAgentTypeSkillDir(profile);
	return [
		describeSkillSource({
			id: "profile",
			kind: "profile",
			label: "Agent 独有 Skills",
			description: "只属于这个 Agent profile 的 Skills。",
			path: join(agent.home, "skills"),
		}),
		describeSkillSource({
			id: "agent-type",
			kind: "agent-type",
			label: typeSource.label,
			description: "",
			path: typeSource.path,
		}),
		describeSkillSource({
			id: "universal",
			kind: "universal",
			label: "通用 Skills",
			description: "",
			path: join(homedir(), ".agents", "skills"),
		}),
	];
}

async function getAgentSystemPrompt(id: string): Promise<AgentSystemPromptSource> {
	const agent = await getAgent(id);
	const profile = readProfileConfig(agent.home)?.profile;
	const env = readProfileEnv(agent.home);
	return describeSystemPromptSource(resolveSystemPromptPath(profile, env));
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

async function openAgentSystemPrompt(id: string): Promise<AgentSystemPromptSource> {
	const source = await getAgentSystemPrompt(id);
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
	const hasFeishuUpdate = draft.appId !== undefined || draft.appSecret !== undefined || draft.brand !== undefined;
	const hasWechatUpdate =
		draft.wechatAccountId !== undefined ||
		draft.wechatBaseUrl !== undefined ||
		draft.wechatBotToken !== undefined;
	const hasSlackUpdate =
		draft.slackBotToken !== undefined ||
		draft.slackAppToken !== undefined ||
		draft.slackSigningSecret !== undefined ||
		draft.slackTeamId !== undefined ||
		draft.slackAppId !== undefined ||
		draft.slackBotUserId !== undefined;
	const hasDiscordUpdate =
		draft.discordBotToken !== undefined ||
		draft.discordApplicationId !== undefined ||
		draft.discordGuildId !== undefined;
	const hasTelegramUpdate = draft.telegramBotToken !== undefined || draft.telegramBotUsername !== undefined;
	const nextAppId = draft.appId ?? feishuChannel?.appId ?? "";
	const nextBrand = draft.brand ?? feishuChannel?.brand ?? "feishu";
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
			teamId: draft.slackTeamId ?? slackChannel?.teamId,
			appId: draft.slackAppId ?? slackChannel?.appId,
			botUserId: draft.slackBotUserId ?? slackChannel?.botUserId,
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
			...(draft.slackSigningSecret !== undefined ? { SLACK_SIGNING_SECRET: draft.slackSigningSecret.trim() } : {}),
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
	const apiKeyEnv = nextProvider ? getProviderCredentialEnv(nextProvider) : undefined;
	if (apiKeyEnv && draft.apiKey !== undefined) {
		upsertAgentEnv({ [apiKeyEnv]: draft.apiKey.trim() }, agent.home);
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
	const existing = await getAgent(id);
	if (hasLiveRuntimeProcess(existing.home)) {
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
	const agent = await getAgent(id);
	if (!agentProcesses.isRunning(id)) {
		const record = readRuntimeProcessRecord(agent.home);
		if (record && resolve(record.agentHome) === resolve(agent.home) && isPidRunning(record.pid)) {
			try {
				process.kill(record.pid, "SIGTERM");
			} catch {
				// best effort
			}
			await new Promise((resolveStop) => setTimeout(resolveStop, 1500));
			if (isPidRunning(record.pid)) {
				try {
					process.kill(record.pid, "SIGKILL");
				} catch {
					// best effort
				}
			}
		}
		clearRuntimeProcessRecord(agent.home);
		updateProfileRegistryEntry(id, { enabled: false });
		return;
	}
	await agentProcesses.stop(id, "paused");
	updateProfileRegistryEntry(id, { enabled: false });
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

function createWindow(): void {
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
		const settings = readDesktopSettings();
		if (settings.closeWindowBehavior === "hide") {
			event.preventDefault();
			win.hide();
			return;
		}
		isQuitting = true;
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
	const settings = readDesktopSettings();
	applyOpenAtLoginSetting(settings);
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
	createWindow();
	void restoreEnabledAgents().catch((error) => {
		console.error("[desktop] failed to restore enabled agents:", error);
	});
});

app.on("window-all-closed", () => {
	if (readDesktopSettings().closeWindowBehavior === "quit" || process.platform !== "darwin") {
		app.quit();
	}
});

app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) {
		createWindow();
	}
});

app.on("before-quit", (event) => {
	isQuitting = true;
	if (readDesktopSettings().quitTerminatesAgents && !didStopAgentsForQuit) {
		event.preventDefault();
		void agentProcesses.stopAll("quit").finally(() => {
			didStopAgentsForQuit = true;
			app.quit();
		});
	}
});
