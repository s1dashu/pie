import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, totalmem } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
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
import { appendAgentLogEntry, pruneAgentLogEntries, readAgentLogEntries } from "../../core/agent-logs.js";
import { appendAgentUsageEvent, pruneAgentUsageEvents, readAgentUsageEvents, summarizeAgentUsage } from "../../core/usage-stats.js";
import { LarkClient } from "../../channels/feishu/platform/core/lark-client.js";
import type {
	AgentCreationDraft,
	AgentAvatarUpload,
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
	DesktopSettings,
	DesktopSettingsDraft,
} from "../shared/types.js";
import {
	beginAgentCreation as beginCreationSession,
	completeAgentCreation as completeCreationSession,
	createFeishuAppForSession,
	getProviderCredentialEnv,
	loadModelCatalog,
} from "./onboard-service.js";
import { AgentProcessManager } from "./agent-process-manager.js";
import { readDesktopSettings, retentionToDays, updateDesktopSettings } from "./desktop-settings.js";

const agentOperations = new Map<string, Promise<unknown>>();
const storageStatsCache = new Map<string, { value: Pick<AgentResourceStats, "storageBytes" | "diskTotalBytes" | "diskAvailableBytes">; expiresAt: number }>();
const cpuStatsCache = new Map<string, { cpuTimeSeconds: number; sampledAt: number }>();
const PROFILE_AVATAR_STEM = "avatar";
const PROFILE_AVATAR_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"] as const;
let isQuitting = false;
let didStopAgentsForQuit = false;

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

function getDefaultPiSystemPromptPath(): string {
	return join(getAppRoot(), "src", "prompts", "system-prompt.md");
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
	if (kind === "pi") {
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
	if (!/src\/runtime\/main\.ts|dist\/runtime\/main\.js|src\/task-engine\/|dist\/task-engine\//.test(row.command)) {
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
	if (kind === "pi") {
		return {
			label: "系统提示词",
			description: "Pi runtime 当前注入到 Agent session 的系统提示词。",
			path: resolve(env.FEISHU_BOT_SYSTEM_PROMPT_FILE?.trim() || getDefaultPiSystemPromptPath()),
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
			avatarUrl: readProfileAvatarUrl(home),
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
	if (!readDesktopSettings().restoreRunningAgentsOnLaunch) {
		return;
	}
	const agents = await listAgents();
	await Promise.all(
		agents
			.filter((agent) => agent.enabled)
			.map((agent) => withAgentOperation(agent.id, () => startAgent(agent.id)).catch((error) => {
				console.error(`[desktop] failed to restore agent ${agent.id}:`, error);
			})),
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
	const model = getProfileModel(profile);
	const apiKeyEnv = model?.provider ? getProviderCredentialEnv(model.provider) : undefined;
	return {
		...summary,
		brand: channel?.brand,
		appSecret: env.FEISHU_APP_SECRET,
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
	validateModelDraft(draft);
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
	ipcMain.handle("agents:create-complete", async (_event, draft: AgentCreationDraft) => {
		try {
			if (draft.avatarId?.trim()) {
				resolveBotAvatarPath(draft.avatarId.trim());
			}
			completeCreationSession(draft);
			const agent = await getAgent(draft.sessionId);
			copyDefaultAvatarToProfile(draft.avatarId, agent.home);
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
