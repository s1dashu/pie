import * as lark from "@larksuiteoapi/node-sdk";
import { REST, Routes } from "discord.js";
import type { Model } from "@mariozechner/pi-ai";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
	upsertAgentEnv,
} from "../../core/agent-home.js";
import {
	isChannelAvailableForRelease,
	isDevelopmentChannel,
} from "../../core/channel-availability.js";
import {
	checkCodexAppServerEnvironment,
	codexCliAgentHarnessAdapter,
	loginCodexWithAppServer,
} from "../../agents/adapters/codex-cli.js";
import { checkCodexCliRuntime } from "../../agents/harness-services/codex.js";
import { resolveHermesLaunchCommand } from "../../agents/harness-services/hermes.js";
import { resolveOpenClawExecutable } from "../../agents/harness-services/managed-process.js";
import {
	getOpenClawAgentIdForPieProfile,
	listImportableOpenClawAgentProfiles,
	readOpenClawGatewaySettings,
	toOpenClawModelRef,
} from "../../agents/openclaw-models.js";
import { LarkClient } from "../../channels/feishu/platform/core/lark-client.js";
import {
	DEFAULT_WECHAT_BASE_URL,
	fetchLoginQr,
	pollLoginQrStatus,
} from "../../channels/wechat/platform/api.js";
import { normalizeWechatAccountId } from "../../channels/wechat/state.js";
import {
	createAgentProfile,
	getProfileModel,
	getStoredProfile,
	loadConfigStore,
	saveConfigStore,
	setStoredProfile,
} from "../../core/config-store.js";
import {
	generateBotProfileId,
	getDefaultPieRootDir,
	getProfileHomeDir,
	loadProfileRegistry,
	registerProfileHome,
} from "../../core/profile-registry.js";
import { getDefaultResumeSessionsForHarness } from "../../core/session-policy.js";
import type {
	AgentCreationDraft,
	AgentCreationSession,
	AgentOnboardEvent,
	DesktopManagedRuntimeKind,
	DesktopManagedRuntimeStatus,
	DesktopDiscordBotProfile,
	DesktopFeishuAppCredentials,
	DesktopCodexDiagnostic,
	DesktopCodexModelOption,
	ImportableHarnessProfile,
	DesktopModelOption,
	DesktopRuntimeDiagnostic,
	DesktopWechatCredentials,
} from "../shared/types.js";
import {
	HERMES_MODEL_OPTIONS,
	OPENCLAW_429_MODEL_OPTIONS,
	mergeModelOptions,
	providersFromModels,
} from "../shared/model-catalog.js";
import { readDesktopSettings } from "./desktop-settings.js";

type EmitOnboardEvent = (event: AgentOnboardEvent) => void;

type ModelsJsonRoot = {
	providers?: Record<string, unknown>;
};

const nodeRequire = createRequire(import.meta.url);

const PROVIDER_CREDENTIAL_ENV: Record<string, string> = {
	openai: "OPENAI_API_KEY",
	anthropic: "ANTHROPIC_API_KEY",
	google: "GEMINI_API_KEY",
	"google-vertex": "GOOGLE_CLOUD_API_KEY",
	groq: "GROQ_API_KEY",
	cerebras: "CEREBRAS_API_KEY",
	xai: "XAI_API_KEY",
	openrouter: "OPENROUTER_API_KEY",
	"vercel-ai-gateway": "AI_GATEWAY_API_KEY",
	zai: "ZAI_API_KEY",
	mistral: "MISTRAL_API_KEY",
	minimax: "MINIMAX_API_KEY",
	"minimax-cn": "MINIMAX_CN_API_KEY",
	huggingface: "HF_TOKEN",
	opencode: "OPENCODE_API_KEY",
	"opencode-go": "OPENCODE_API_KEY",
	"kimi-coding": "KIMI_API_KEY",
	deepseek: "DEEPSEEK_API_KEY",
	"azure-openai-responses": "AZURE_OPENAI_API_KEY",
	"github-copilot": "COPILOT_GITHUB_TOKEN",
	"amazon-bedrock": "AWS_BEARER_TOKEN_BEDROCK",
};

const HERMES_INSTALL_COMMAND = "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash -s -- --skip-setup";
const CODEX_INSTALL_COMMAND = "npm install -g @openai/codex";
const CODEX_INSTALL_WITH_NODE_COMMAND = "brew install node && npm install -g @openai/codex";
const OPENCLAW_INSTALL_COMMAND = "curl -fsSL https://openclaw.ai/install.sh | bash";
const MIN_HERMES_GOOD_DISPLAY_VERSION = "0.12.0";
const DEFAULT_OPENCLAW_GATEWAY_PORT = 18789;
const SHARED_OPENCLAW_GATEWAY_URL = process.env.PIE_OPENCLAW_SHARED_GATEWAY_URL?.trim() || readOpenClawGatewaySettings().gatewayUrl;
const activeHermesInstalls = new Map<string, HermesInstallContext>();

interface HermesInstallContext {
	sessionId: string;
	emit: EmitOnboardEvent;
	child?: ChildProcess;
	cancelled: boolean;
	checkoutBackup?: {
		path: string;
		preserveOnSuccess: boolean;
	};
	originalBin:
		| { kind: "missing" }
		| { kind: "symlink"; target: string }
		| { kind: "file" };
}

const DEFAULT_BOT_NAMES = [
	"Mia",
	"Ava",
	"Eva",
	"Ivy",
	"Zoe",
	"Amy",
	"May",
	"Ada",
	"Elsa",
	"Nora",
	"Lily",
	"Yui",
	"Lua",
	"Luna",
	"Mimi",
	"Kiki",
];

function pickDefaultBotName(): string {
	return DEFAULT_BOT_NAMES[Math.floor(Math.random() * DEFAULT_BOT_NAMES.length)] ?? "Mia";
}

function shellPath(): string {
	return process.env.SHELL?.trim() || "/bin/zsh";
}

function stripAnsi(text: string): string {
	return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function runLoginShellCommand(command: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		const child = spawn(shellPath(), ["-lc", command], {
			stdio: ["ignore", "pipe", "pipe"],
			env: process.env,
		});
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});
		child.on("error", (error) => {
			stderr += error.message;
		});
		child.on("close", (code) => resolve({ code, stdout, stderr }));
	});
}

function runResolvedCommand(command: string, args: string[], options: { pathEnv?: string } = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		const child = spawn(command, args, {
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, ...(options.pathEnv ? { PATH: options.pathEnv } : {}) },
		});
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});
		child.on("error", (error) => resolve({ code: 1, stdout, stderr: error.message }));
		child.on("close", (code) => resolve({ code, stdout, stderr }));
	});
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

function shellCommand(command: string, args: string[] = []): string {
	return [command, ...args].map(shellQuote).join(" ");
}

function hermesCheckoutDir(): string {
	return join(homedir(), ".hermes", "hermes-agent");
}

function hermesBinPath(): string {
	return join(homedir(), ".local", "bin", "hermes");
}

function openClawBinPath(): string {
	return join(homedir(), ".local", "bin", "openclaw");
}

async function resolveCommandPath(command: string, fallbackPaths: string[]): Promise<string | undefined> {
	const found = await runLoginShellCommand(`command -v ${shellQuote(command)}`);
	const executablePath = found.stdout.trim().split(/\r?\n/)[0]?.trim();
	if (found.code === 0 && executablePath) {
		return executablePath;
	}
	return fallbackPaths.find((path) => existsSync(path));
}

function readHermesBinState(): HermesInstallContext["originalBin"] {
	const path = hermesBinPath();
	if (!existsSync(path)) {
		return { kind: "missing" };
	}
	const stat = lstatSync(path);
	if (stat.isSymbolicLink()) {
		return { kind: "symlink", target: readlinkSync(path) };
	}
	return { kind: "file" };
}

function createHermesInstallContext(sessionId: string, emit: EmitOnboardEvent): HermesInstallContext {
	return {
		sessionId,
		emit,
		cancelled: false,
		originalBin: readHermesBinState(),
	};
}

function signalInstallProcess(child: ChildProcess): void {
	if (!child.pid) {
		child.kill("SIGTERM");
		return;
	}
	if (process.platform !== "win32") {
		try {
			process.kill(-child.pid, "SIGTERM");
			return;
		} catch {
			// Fall back to the direct child process.
		}
	}
	child.kill("SIGTERM");
}

function parseSemver(text: string): [number, number, number] | undefined {
	const match = text.match(/\bv?(\d+)\.(\d+)\.(\d+)\b/);
	if (!match) {
		return undefined;
	}
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(left: [number, number, number], right: [number, number, number]): number {
	for (let index = 0; index < 3; index += 1) {
		const diff = left[index] - right[index];
		if (diff !== 0) {
			return diff;
		}
	}
	return 0;
}

function isHermesVersionSupported(versionText: string): boolean {
	const version = parseSemver(versionText);
	const minimum = parseSemver(MIN_HERMES_GOOD_DISPLAY_VERSION);
	return Boolean(version && minimum && compareSemver(version, minimum) >= 0);
}

function runInstallCommand(options: {
	sessionId: string;
	source: NonNullable<AgentOnboardEvent["source"]>;
	command: string;
	emit: EmitOnboardEvent;
	startMessage: string;
	doneMessage: string;
	context?: HermesInstallContext;
}): Promise<void> {
	return new Promise((resolve, reject) => {
		let output = "";
		options.emit({ sessionId: options.sessionId, type: "status", source: options.source, message: options.startMessage });
		const child = spawn(shellPath(), ["-lc", options.command], {
			stdio: ["ignore", "pipe", "pipe"],
			env: process.env,
			detached: process.platform !== "win32",
		});
		if (options.context) {
			options.context.child = child;
		}
		const handleOutput = (chunk: Buffer) => {
			const text = stripAnsi(chunk.toString("utf8"));
			output += text;
			const line = text.trim().split(/\r?\n/).filter(Boolean).at(-1);
			if (line) {
				options.emit({ sessionId: options.sessionId, type: "status", source: options.source, message: line.slice(0, 300) });
			}
		};
		child.stdout.on("data", handleOutput);
		child.stderr.on("data", handleOutput);
		child.on("error", reject);
		child.on("close", (code) => {
			if (options.context?.child === child) {
				options.context.child = undefined;
			}
			if (options.context?.cancelled) {
				const message = "Hermes 安装已取消。";
				options.emit({ sessionId: options.sessionId, type: "error", source: options.source, message });
				reject(new Error(message));
				return;
			}
			if (code === 0) {
				options.emit({ sessionId: options.sessionId, type: "done", source: options.source, message: options.doneMessage });
				resolve();
				return;
			}
			const rawMessage = output.trim().split(/\r?\n/).filter(Boolean).slice(-8).join("\n") || `${options.command} exited with code ${String(code)}`;
			const message = normalizeInstallError(options.source, rawMessage);
			options.emit({ sessionId: options.sessionId, type: "error", source: options.source, message });
			reject(new Error(message));
		});
	});
}

function normalizeInstallError(source: NonNullable<AgentOnboardEvent["source"]>, message: string): string {
	if (source === "hermes-install" && isHermesDirtyCheckoutInstallError(message)) {
		return "Hermes 本地安装目录存在未提交的变更，自动更新失败。Pie 下次会先备份旧安装目录后重新安装。";
	}
	if (source === "hermes-install" && isHermesCloneInstallError(message)) {
		return "Hermes 仓库克隆失败，可能是上次安装中断留下了半成品目录或网络传输失败。Pie 会清理半成品后重试。";
	}
	return message;
}

function isHermesDirtyCheckoutInstallError(message: string): boolean {
	return message.includes("is not a stash reference") || message.includes("Changes not staged for commit");
}

function isHermesCloneInstallError(message: string): boolean {
	return message.includes("Failed to clone repository") ||
		message.includes("invalid index-pack output") ||
		message.includes("could not open") && message.includes(".git/objects/pack");
}

async function backupHermesCheckoutForInstall(context: HermesInstallContext): Promise<void> {
	if (context.checkoutBackup) {
		return;
	}
	const checkoutDir = hermesCheckoutDir();
	if (!existsSync(join(checkoutDir, ".git"))) {
		return;
	}
	const status = await runLoginShellCommand(`git -C ${shellQuote(checkoutDir)} status --porcelain`);
	const isDirty = status.code === 0 && Boolean(status.stdout.trim());
	const backupDir = join(homedir(), ".hermes", `hermes-agent.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`);
	context.emit({
		sessionId: context.sessionId,
		type: "status",
		source: "hermes-install",
		message: isDirty
			? "检测到 Hermes 旧安装目录有本地变更，正在备份后重新安装..."
			: "正在备份当前 Hermes 安装目录...",
	});
	renameSync(checkoutDir, backupDir);
	context.checkoutBackup = { path: backupDir, preserveOnSuccess: isDirty };
	context.emit({
		sessionId: context.sessionId,
		type: "status",
		source: "hermes-install",
		message: `旧安装目录已备份到 ${backupDir}`,
	});
}

function restoreHermesBinState(context: HermesInstallContext): void {
	const path = hermesBinPath();
	if (context.originalBin.kind === "file") {
		return;
	}
	rmSync(path, { force: true });
	if (context.originalBin.kind === "symlink") {
		mkdirSync(join(homedir(), ".local", "bin"), { recursive: true });
		symlinkSync(context.originalBin.target, path);
	}
}

function cleanupHermesInstallContext(context: HermesInstallContext, outcome: "success" | "cancelled" | "failed"): void {
	const checkoutDir = hermesCheckoutDir();
	if (outcome === "success") {
		if (context.checkoutBackup && !context.checkoutBackup.preserveOnSuccess) {
			rmSync(context.checkoutBackup.path, { recursive: true, force: true });
		}
		return;
	}
	rmSync(checkoutDir, { recursive: true, force: true });
	if (context.checkoutBackup && existsSync(context.checkoutBackup.path)) {
		renameSync(context.checkoutBackup.path, checkoutDir);
	}
	restoreHermesBinState(context);
}

export async function cancelHermesInstallForDesktop(sessionId: string): Promise<void> {
	const context = activeHermesInstalls.get(sessionId);
	if (!context) {
		return;
	}
	context.cancelled = true;
	context.emit({ sessionId, type: "status", source: "hermes-install", message: "正在取消 Hermes 安装并清理..." });
	if (context.child) {
		signalInstallProcess(context.child);
		return;
	}
	cleanupHermesInstallContext(context, "cancelled");
	activeHermesInstalls.delete(sessionId);
	context.emit({ sessionId, type: "error", source: "hermes-install", message: "Hermes 安装已取消。" });
}

export function cancelAllHermesInstallsForDesktop(): void {
	for (const sessionId of [...activeHermesInstalls.keys()]) {
		void cancelHermesInstallForDesktop(sessionId);
	}
}

function runtimeLabel(kind: DesktopManagedRuntimeKind): string {
	if (kind === "hermes") {
		return "Hermes";
	}
	if (kind === "openclaw") {
		return "OpenClaw";
	}
	return "Codex";
}

function asManagedRuntimeStatus(
	kind: DesktopManagedRuntimeKind,
	diagnostic: DesktopRuntimeDiagnostic,
): DesktopManagedRuntimeStatus {
	return {
		kind,
		label: runtimeLabel(kind),
		...diagnostic,
	};
}

async function checkOpenClawEnvironmentForDesktop(): Promise<DesktopRuntimeDiagnostic> {
	const executable = resolveOpenClawExecutable();
	if (!executable) {
		return {
			installed: false,
			ready: false,
			error: "openclaw command not found in login shell PATH",
			installCommand: ["bash", "-lc", OPENCLAW_INSTALL_COMMAND],
		};
	}
	const version = await runResolvedCommand(executable.executablePath, ["--version"], { pathEnv: executable.pathEnv });
	const versionText = stripAnsi(version.stdout || version.stderr).trim();
	return {
		installed: true,
		ready: version.code === 0,
		executablePath: executable.executablePath,
		version: versionText || undefined,
		error: version.code === 0 ? undefined : stripAnsi(version.stderr || version.stdout).trim() || "OpenClaw CLI exists but did not run successfully.",
		installCommand: ["bash", "-lc", OPENCLAW_INSTALL_COMMAND],
	};
}

async function checkCodexRuntimeForDesktop(): Promise<DesktopRuntimeDiagnostic> {
	const diagnostic = await checkCodexCliRuntime();
	return {
		...diagnostic,
		installCommand: ["bash", "-lc", CODEX_INSTALL_COMMAND],
	};
}

export async function checkManagedRuntimeForDesktop(kind: DesktopManagedRuntimeKind): Promise<DesktopManagedRuntimeStatus> {
	if (kind === "hermes") {
		return asManagedRuntimeStatus(kind, await checkHermesEnvironmentForDesktop());
	}
	if (kind === "codex") {
		return asManagedRuntimeStatus(kind, await checkCodexRuntimeForDesktop());
	}
	return asManagedRuntimeStatus(kind, await checkOpenClawEnvironmentForDesktop());
}

export async function upgradeManagedRuntimeForDesktop(kind: DesktopManagedRuntimeKind): Promise<DesktopManagedRuntimeStatus> {
	if (kind === "hermes") {
		const diagnostic = await installHermesForDesktop(`settings-${kind}`, () => undefined);
		return asManagedRuntimeStatus(kind, diagnostic);
	}
	if (kind === "codex") {
		const diagnostic = await installCodexForDesktop(`settings-${kind}`, () => undefined);
		return asManagedRuntimeStatus(kind, {
			installed: diagnostic.installed,
			ready: diagnostic.installed,
			executablePath: diagnostic.executablePath,
			version: diagnostic.version,
			error: diagnostic.error,
			installCommand: ["bash", "-lc", CODEX_INSTALL_COMMAND],
		});
	}
	const diagnostic = await checkOpenClawEnvironmentForDesktop();
	if (!diagnostic.installed) {
		return asManagedRuntimeStatus(kind, await installOpenClawRuntimeForDesktop());
	}
	const executable = resolveOpenClawExecutable();
	const upgrade = executable
		? await runResolvedCommand(executable.executablePath, ["update"], { pathEnv: executable.pathEnv })
		: await runLoginShellCommand("openclaw update");
	if (upgrade.code !== 0) {
		throw new Error(stripAnsi(upgrade.stderr || upgrade.stdout).trim() || "OpenClaw 升级失败。");
	}
	return checkManagedRuntimeForDesktop(kind);
}

async function installOpenClawRuntimeForDesktop(): Promise<DesktopRuntimeDiagnostic> {
	const curlCheck = await runLoginShellCommand("command -v curl");
	if (curlCheck.code !== 0) {
		return {
			installed: false,
			ready: false,
			error: "未检测到 curl，无法运行 OpenClaw 官方安装脚本。",
			installCommand: ["bash", "-lc", OPENCLAW_INSTALL_COMMAND],
		};
	}
	const install = await runLoginShellCommand(OPENCLAW_INSTALL_COMMAND);
	if (install.code !== 0) {
		return {
			installed: false,
			ready: false,
			error: stripAnsi(install.stderr || install.stdout).trim() || "OpenClaw 官方安装脚本执行失败。",
			installCommand: ["bash", "-lc", OPENCLAW_INSTALL_COMMAND],
		};
	}
	return checkOpenClawEnvironmentForDesktop();
}

function uninstallHermesRuntime(): void {
	rmSync(hermesBinPath(), { force: true });
	rmSync(join(homedir(), ".hermes", "hermes-agent"), { recursive: true, force: true });
}

async function uninstallOpenClawRuntime(): Promise<void> {
	const diagnostic = await checkOpenClawEnvironmentForDesktop();
	const executablePath = diagnostic.executablePath?.trim();
	if (executablePath && (executablePath === openClawBinPath() || executablePath.startsWith(join(homedir(), ".local", "bin")))) {
		rmSync(executablePath, { force: true });
	}
	rmSync(openClawBinPath(), { force: true });
	rmSync(join(homedir(), ".openclaw"), { recursive: true, force: true });
}

async function uninstallCodexRuntime(): Promise<void> {
	const npmCheck = await runLoginShellCommand("command -v npm");
	if (npmCheck.code === 0) {
		await runLoginShellCommand("npm uninstall -g @openai/codex");
	}
	const diagnostic = await checkCodexRuntimeForDesktop();
	const executablePath = diagnostic.executablePath?.trim();
	if (executablePath && (executablePath.startsWith(join(homedir(), ".local", "bin")) || executablePath.startsWith("/opt/homebrew/bin") || executablePath.startsWith("/usr/local/bin"))) {
		rmSync(executablePath, { force: true });
	}
}

export async function uninstallManagedRuntimeForDesktop(kind: DesktopManagedRuntimeKind): Promise<DesktopManagedRuntimeStatus> {
	if (kind === "hermes") {
		await cancelHermesInstallForDesktop(`settings-${kind}`);
		uninstallHermesRuntime();
		return checkManagedRuntimeForDesktop(kind);
	}
	if (kind === "codex") {
		await uninstallCodexRuntime();
		return checkManagedRuntimeForDesktop(kind);
	}
	await uninstallOpenClawRuntime();
	return checkManagedRuntimeForDesktop(kind);
}

async function runHermesInstallCommandWithDirtyCheckoutRecovery(options: {
	sessionId: string;
	emit: EmitOnboardEvent;
	command: string;
	startMessage: string;
	doneMessage: string;
	context: HermesInstallContext;
}): Promise<void> {
	await backupHermesCheckoutForInstall(options.context);
	try {
		await runInstallCommand({
			sessionId: options.sessionId,
			source: "hermes-install",
			command: options.command,
			emit: options.emit,
			startMessage: options.startMessage,
			doneMessage: options.doneMessage,
			context: options.context,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (options.context.cancelled || (!isHermesDirtyCheckoutInstallError(message) && !isHermesCloneInstallError(message))) {
			throw error;
		}
		options.emit({
			sessionId: options.sessionId,
			type: "status",
			source: "hermes-install",
			message: isHermesCloneInstallError(message)
				? "Hermes 克隆失败，正在清理半成品后重试..."
				: "Hermes 旧安装目录更新失败，正在备份后重试...",
		});
		if (isHermesCloneInstallError(message)) {
			rmSync(hermesCheckoutDir(), { recursive: true, force: true });
		} else {
			await backupHermesCheckoutForInstall(options.context);
		}
		await runInstallCommand({
			sessionId: options.sessionId,
			source: "hermes-install",
			command: options.command,
			emit: options.emit,
			startMessage: "正在重新运行 Hermes 官方安装器...",
			doneMessage: options.doneMessage,
			context: options.context,
		});
	}
}

export function deriveHermesApiServerPort(profileId: string): number {
	let hash = 0;
	for (const char of profileId) {
		hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
	}
	return 18_000 + (hash % 20_000);
}

export function toHermesInferenceProvider(provider: string): string {
	const normalized = provider.trim();
	const map: Record<string, string> = {
		google: "gemini",
		zai: "zai",
		"kimi-coding": "kimi-coding",
		"kimi-coding-cn": "kimi-coding-cn",
	};
	return map[normalized] ?? normalized;
}

export function getProviderCredentialEnv(provider: string): string | undefined {
	if (provider === "pie-openai-proxy") {
		return "PIE_OPENAI_PROXY_API_KEY";
	}
	return PROVIDER_CREDENTIAL_ENV[provider];
}

function modelToOption(model: Model<any>): DesktopModelOption {
	return {
		id: String(model.id),
		name: typeof model.name === "string" ? model.name : undefined,
		provider: String(model.provider),
	};
}

export function loadModelOptions(homeDir: string): DesktopModelOption[] {
	const registry = ModelRegistry.create(AuthStorage.inMemory(), join(homeDir, "models.json"));
	registry.refresh();
	return registry.getAll().map(modelToOption);
}

export function loadModelCatalog(homeDir: string): Pick<AgentCreationSession, "models" | "providers"> {
	const models = loadModelOptions(homeDir);
	const providers = providersFromModels(models);
	return { models, providers };
}

export function loadHermesModelCatalog(homeDir: string): Pick<AgentCreationSession, "models" | "providers"> {
	const models = mergeModelOptions(loadModelOptions(homeDir), HERMES_MODEL_OPTIONS);
	return { models, providers: providersFromModels(models) };
}

export function loadOpenClawModelCatalog(): Pick<AgentCreationSession, "models" | "providers"> {
	const models = OPENCLAW_429_MODEL_OPTIONS;
	return { models, providers: providersFromModels(models) };
}

const FALLBACK_CODEX_MODELS: DesktopCodexModelOption[] = [
	{
		id: "gpt-5.5",
		name: "GPT-5.5",
		defaultThinkingLevel: "medium",
		supportedThinkingLevels: ["low", "medium", "high", "xhigh"],
	},
	{
		id: "gpt-5.3-codex",
		name: "GPT-5.3 Codex",
		defaultThinkingLevel: "medium",
		supportedThinkingLevels: ["low", "medium", "high", "xhigh"],
	},
	{
		id: "gpt-5.3-codex-spark",
		name: "GPT-5.3 Codex Spark",
		defaultThinkingLevel: "high",
		supportedThinkingLevels: ["low", "medium", "high", "xhigh"],
	},
];

export function loadCodexModelCatalog(): DesktopCodexModelOption[] {
	const path = join(homedir(), ".codex", "models_cache.json");
	if (!existsSync(path)) {
		return FALLBACK_CODEX_MODELS;
	}
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as { models?: unknown };
		if (!Array.isArray(parsed.models)) {
			return FALLBACK_CODEX_MODELS;
		}
		const models = parsed.models
			.flatMap((value): DesktopCodexModelOption[] => {
				if (!value || typeof value !== "object") {
					return [];
				}
				const model = value as Record<string, unknown>;
				const id = typeof model.slug === "string" ? model.slug.trim() : "";
				if (!id) {
					return [];
				}
				const supportedThinkingLevels = Array.isArray(model.supported_reasoning_levels)
					? model.supported_reasoning_levels
							.map((entry) =>
								entry && typeof entry === "object" && typeof (entry as { effort?: unknown }).effort === "string"
									? ((entry as { effort: string }).effort as DesktopCodexModelOption["supportedThinkingLevels"][number])
									: undefined,
							)
							.filter((entry): entry is DesktopCodexModelOption["supportedThinkingLevels"][number] =>
								entry === "low" || entry === "medium" || entry === "high" || entry === "xhigh",
							)
					: [];
				return [{
					id,
					name: typeof model.display_name === "string" ? model.display_name : undefined,
					defaultThinkingLevel:
						model.default_reasoning_level === "low" ||
						model.default_reasoning_level === "medium" ||
						model.default_reasoning_level === "high" ||
						model.default_reasoning_level === "xhigh"
							? model.default_reasoning_level
							: undefined,
					supportedThinkingLevels: supportedThinkingLevels.length ? supportedThinkingLevels : ["low", "medium", "high", "xhigh"],
					description: typeof model.description === "string" ? model.description : undefined,
				}];
			});
		return models.length ? models : FALLBACK_CODEX_MODELS;
	} catch {
		return FALLBACK_CODEX_MODELS;
	}
}

function mergeProxyIntoModelsJson(homeDir: string, providerId: string, providerConfig: unknown): void {
	const path = join(homeDir, "models.json");
	let root: ModelsJsonRoot = {};
	if (existsSync(path)) {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			root = parsed as ModelsJsonRoot;
		}
	}
	if (!root.providers || typeof root.providers !== "object") {
		root.providers = {};
	}
	root.providers[providerId] = providerConfig;
	writeFileSync(path, `${JSON.stringify(root, null, 2)}\n`, "utf8");
}

function generateQrText(url: string): Promise<string> {
	return new Promise((resolve) => {
		const qrcode = nodeRequire("qrcode-terminal") as {
			generate(input: string, options: { small: boolean }, callback: (qr: string) => void): void;
		};
		qrcode.generate(url, { small: true }, resolve);
	});
}

export function beginAgentCreation(): AgentCreationSession {
	const registry = loadProfileRegistry();
	const profileId = generateBotProfileId(registry);
	const home = getProfileHomeDir(profileId);
	mkdirSync(home, { recursive: true });
	const { models, providers } = loadModelCatalog(home);
	return {
		sessionId: profileId,
		profileId,
		name: pickDefaultBotName(),
		home,
		models,
		providers,
		codexModels: loadCodexModelCatalog(),
		openClawModels: [],
	};
}

function splitOpenClawModelRef(modelRef: string | undefined): { provider?: string; model?: string } {
	const clean = modelRef?.trim();
	if (!clean) {
		return {};
	}
	const slashIndex = clean.indexOf("/");
	if (slashIndex <= 0 || slashIndex >= clean.length - 1) {
		return { model: clean };
	}
	return {
		provider: clean.slice(0, slashIndex),
		model: clean.slice(slashIndex + 1),
	};
}

function readHermesConfigText(profileDir: string): string {
	try {
		return readFileSync(join(profileDir, "config.yaml"), "utf8");
	} catch {
		return "";
	}
}

function readHermesConfigScalar(configText: string, section: string, key: string): string | undefined {
	const lines = configText.split(/\r?\n/);
	let inSection = false;
	for (const line of lines) {
		if (/^\S[^:]*:\s*$/.test(line)) {
			inSection = line.trim() === `${section}:`;
			continue;
		}
		if (!inSection) {
			continue;
		}
		const match = line.match(new RegExp(`^\\s+${key}:\\s*(.+?)\\s*$`));
		const value = match?.[1]?.trim().replace(/^['"]|['"]$/g, "");
		if (value) {
			return value;
		}
	}
	return undefined;
}

function readHermesProfileModel(profileDir: string): { provider?: string; model?: string; port?: string } {
	const configText = readHermesConfigText(profileDir);
	return {
		provider: readHermesConfigScalar(configText, "model", "provider"),
		model: readHermesConfigScalar(configText, "model", "default") ?? readHermesConfigScalar(configText, "model", "model"),
		port: readHermesConfigScalar(configText, "api_server", "port"),
	};
}

function getOfficialHermesProfilesRoot(): string {
	return join(homedir(), ".hermes", "profiles");
}

function getOfficialPieHermesProfileHome(profileId: string): string {
	const safe = profileId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
	return join(getOfficialHermesProfilesRoot(), `pie-${safe || "profile"}`);
}

export interface ClaimedHermesHome {
	profileId: string;
	displayName: string;
	homeDir: string;
	hermesHome: string;
}

function normalizeHermesHomePath(path: string): string {
	return resolve(path.trim());
}

function getProfileHermesHome(profileId: string, entryHome: string): string | undefined {
	try {
		const homeDir = resolve(getDefaultPieRootDir(), entryHome);
		const profile = getStoredProfile(loadConfigStore(homeDir));
		if (profile?.harness.kind !== "hermes") {
			return undefined;
		}
		const configuredHermesHome = typeof profile.harness.config?.hermesHome === "string"
			? profile.harness.config.hermesHome.trim()
			: "";
		return normalizeHermesHomePath(configuredHermesHome || join(homeDir, "hermes"));
	} catch {
		return undefined;
	}
}

export function findPieProfileClaimingHermesHome(
	hermesHome: string | undefined,
	options?: { excludeProfileId?: string },
): ClaimedHermesHome | undefined {
	if (!hermesHome?.trim()) {
		return undefined;
	}
	const targetHome = normalizeHermesHomePath(hermesHome);
	const registry = loadProfileRegistry();
	for (const [profileId, entry] of Object.entries(registry.profiles)) {
		if (profileId === options?.excludeProfileId) {
			continue;
		}
		const claimedHome = getProfileHermesHome(profileId, entry.home);
		if (!claimedHome || claimedHome !== targetHome) {
			continue;
		}
		return {
			profileId,
			displayName: entry.displayName || profileId,
			homeDir: resolve(getDefaultPieRootDir(), entry.home),
			hermesHome: claimedHome,
		};
	}
	return undefined;
}

function appendHermesProfile(
	profiles: ImportableHarnessProfile[],
	seen: Set<string>,
	profile: ImportableHarnessProfile,
): void {
	if (seen.has(profile.id)) {
		return;
	}
	seen.add(profile.id);
	profiles.push(profile);
}

function listImportableHermesProfiles(): ImportableHarnessProfile[] {
	const root = join(homedir(), ".hermes");
	const profiles: ImportableHarnessProfile[] = [];
	const seen = new Set<string>();
	if (existsSync(root)) {
		const config = readHermesProfileModel(root);
		appendHermesProfile(profiles, seen, {
			id: "default",
			label: "default",
			harness: "hermes",
			path: root,
			isDefault: true,
			provider: config.provider,
			model: config.model,
		});
	}
	const profilesRoot = getOfficialHermesProfilesRoot();
	if (existsSync(profilesRoot)) {
		for (const entry of readdirSync(profilesRoot, { withFileTypes: true })) {
			if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(entry.name)) {
				continue;
			}
			const path = join(profilesRoot, entry.name);
			const config = readHermesProfileModel(path);
			appendHermesProfile(profiles, seen, {
				id: entry.name,
				label: entry.name,
				harness: "hermes",
				path,
				provider: config.provider,
				model: config.model,
			});
		}
	}
	const pieRegistry = loadProfileRegistry();
	for (const [profileId, entry] of Object.entries(pieRegistry.profiles)) {
		try {
			const homeDir = resolve(getDefaultPieRootDir(), entry.home);
			const profile = getStoredProfile(loadConfigStore(homeDir));
			if (profile?.harness.kind !== "hermes") {
				continue;
			}
			const configuredHermesHome = typeof profile.harness.config?.hermesHome === "string"
				? profile.harness.config.hermesHome.trim()
				: "";
			if (configuredHermesHome && configuredHermesHome.startsWith(profilesRoot)) {
				continue;
			}
			const legacyHermesHome = configuredHermesHome || join(homeDir, "hermes");
			if (!existsSync(legacyHermesHome)) {
				continue;
			}
			const config = readHermesProfileModel(legacyHermesHome);
			appendHermesProfile(profiles, seen, {
				id: `pie-${profileId}`,
				label: `${entry.displayName || profileId} (${profileId})`,
				harness: "hermes",
				path: legacyHermesHome,
				provider: config.provider ?? profile.harness.model?.provider,
				model: config.model ?? profile.harness.model?.model,
			});
		} catch {
			// Ignore incomplete legacy Pie profile homes while listing importable Hermes profiles.
		}
	}
	return profiles;
}

export function listImportableHarnessProfiles(kind: "openclaw" | "hermes"): ImportableHarnessProfile[] {
	if (kind === "openclaw") {
		return listImportableOpenClawAgentProfiles().map((profile) => {
			const model = splitOpenClawModelRef(profile.modelRef);
			return {
				id: profile.id,
				label: profile.id,
				harness: "openclaw",
				workDir: profile.workspace,
				path: profile.workspace,
				agentDir: profile.agentDir,
				modelRef: profile.modelRef,
				provider: model.provider,
				model: model.model,
			};
		});
	}
	return listImportableHermesProfiles();
}

export async function checkCodexEnvironmentForDesktop(): Promise<DesktopCodexDiagnostic> {
	try {
		return await checkCodexAppServerEnvironment();
	} catch (error) {
		const homeDir = join(homedir(), ".pie", "diagnostics", "codex");
		mkdirSync(homeDir, { recursive: true });
		const diagnostic = await (codexCliAgentHarnessAdapter.checkEnvironment?.({
			harnessKind: "codex",
			harnessConfig: {},
			homeDir,
			modelId: "gpt-5.5",
			thinkingLevel: "medium",
			tools: [],
			debug: false,
			verboseLogs: false,
			resumeSessions: getDefaultResumeSessionsForHarness("codex"),
		}) ?? Promise.resolve({
			installed: false,
			authenticated: false,
			error: "Codex adapter has no environment diagnostic.",
			loginCommand: ["codex", "login"],
		}));
		return {
			...diagnostic,
			error: diagnostic.authenticated ? undefined : diagnostic.error || (error instanceof Error ? error.message : String(error)),
		};
	}
}

export async function installCodexForDesktop(
	sessionId: string,
	emit: EmitOnboardEvent,
): Promise<DesktopCodexDiagnostic> {
	const npmCheck = await runLoginShellCommand("command -v npm");
	let command = CODEX_INSTALL_COMMAND;
	if (npmCheck.code !== 0) {
		const brewCheck = await runLoginShellCommand("command -v brew");
		if (brewCheck.code !== 0) {
			const diagnostic: DesktopCodexDiagnostic = {
				installed: false,
				authenticated: false,
				error: "未检测到 npm 或 Homebrew，无法自动安装 Codex CLI。请先安装 Node.js/npm。",
				loginCommand: ["codex", "login"],
			};
			emit({ sessionId, type: "error", source: "codex-install", message: diagnostic.error });
			return diagnostic;
		}
		command = CODEX_INSTALL_WITH_NODE_COMMAND;
	}
	await runInstallCommand({
		sessionId,
		source: "codex-install",
		command,
		emit,
		startMessage: "正在安装 Codex CLI...",
		doneMessage: "Codex CLI 已安装。",
	});
	return checkCodexEnvironmentForDesktop();
}

export async function checkHermesEnvironmentForDesktop(): Promise<DesktopRuntimeDiagnostic> {
	let command;
	try {
		command = resolveHermesLaunchCommand();
	} catch (error) {
		return {
			installed: false,
			ready: false,
			error: error instanceof Error ? error.message : String(error),
			installCommand: ["bash", "-lc", HERMES_INSTALL_COMMAND],
		};
	}
	if (!existsSync(command.executablePath)) {
		return {
			installed: false,
			ready: false,
			error: "hermes command not found in login shell PATH",
			installCommand: ["bash", "-lc", HERMES_INSTALL_COMMAND],
		};
	}
	const executablePath = command.argsPrefix[0] ?? command.executablePath;
	const version = await runResolvedCommand(command.executablePath, [...command.argsPrefix, "--version"], { pathEnv: command.pathEnv });
	const versionText = stripAnsi(version.stdout || version.stderr).trim();
	if (version.code === 0 && !isHermesVersionSupported(versionText)) {
		return {
			installed: true,
			ready: false,
			executablePath,
			version: versionText,
			error: `Hermes ${MIN_HERMES_GOOD_DISPLAY_VERSION}+ required for structured Pie display. Run hermes update.`,
			installCommand: ["bash", "-lc", "hermes update"],
		};
	}
	return {
		installed: true,
		ready: version.code === 0,
		executablePath,
		version: versionText,
		error: version.code === 0 ? undefined : stripAnsi(version.stderr || version.stdout).trim() || "Hermes CLI exists but did not run successfully.",
		installCommand: ["bash", "-lc", HERMES_INSTALL_COMMAND],
	};
}

export async function installHermesForDesktop(
	sessionId: string,
	emit: EmitOnboardEvent,
): Promise<DesktopRuntimeDiagnostic> {
	emit({ sessionId, type: "status", source: "hermes-install", message: "正在检查本机 Hermes..." });
	const existing = await checkHermesEnvironmentForDesktop();
	if (existing.installed && !existing.ready) {
		const context = createHermesInstallContext(sessionId, emit);
		activeHermesInstalls.set(sessionId, context);
		emit({ sessionId, type: "status", source: "hermes-install", message: existing.version ? `检测到 Hermes ${existing.version}，准备升级...` : "检测到 Hermes，但版本不可用，准备升级..." });
		try {
			const updateCommand = resolveHermesLaunchCommand();
			await runHermesInstallCommandWithDirtyCheckoutRecovery({
				sessionId,
				command: shellCommand(updateCommand.executablePath, [...updateCommand.argsPrefix, "update"]),
				emit,
				startMessage: `正在升级 Hermes 到 ${MIN_HERMES_GOOD_DISPLAY_VERSION}+...`,
				doneMessage: "Hermes 已升级。",
				context,
			});
			cleanupHermesInstallContext(context, "success");
			emit({ sessionId, type: "status", source: "hermes-install", message: "正在复检 Hermes 环境..." });
			return checkHermesEnvironmentForDesktop();
		} catch (error) {
			cleanupHermesInstallContext(context, context.cancelled ? "cancelled" : "failed");
			throw error;
		} finally {
			activeHermesInstalls.delete(sessionId);
		}
	}
	if (existing.ready) {
		emit({ sessionId, type: "done", source: "hermes-install", message: "Hermes 已安装。" });
		return existing;
	}
	emit({ sessionId, type: "status", source: "hermes-install", message: "未检测到 Hermes，准备运行官方安装器..." });
	emit({ sessionId, type: "status", source: "hermes-install", message: "正在检查 curl..." });
	const curlCheck = await runLoginShellCommand("command -v curl");
	if (curlCheck.code !== 0) {
		const diagnostic: DesktopRuntimeDiagnostic = {
			installed: false,
			ready: false,
			error: "未检测到 curl，无法运行 Hermes 官方安装脚本。",
			installCommand: ["bash", "-lc", HERMES_INSTALL_COMMAND],
		};
		emit({ sessionId, type: "error", source: "hermes-install", message: diagnostic.error });
		return diagnostic;
	}
	const context = createHermesInstallContext(sessionId, emit);
	activeHermesInstalls.set(sessionId, context);
	try {
		await runHermesInstallCommandWithDirtyCheckoutRecovery({
			sessionId,
			command: HERMES_INSTALL_COMMAND,
			emit,
			startMessage: "正在运行 Hermes 官方安装器...",
			doneMessage: "Hermes 已安装。",
			context,
		});
		cleanupHermesInstallContext(context, "success");
		emit({ sessionId, type: "status", source: "hermes-install", message: "正在复检 Hermes 环境..." });
		return checkHermesEnvironmentForDesktop();
	} catch (error) {
		cleanupHermesInstallContext(context, context.cancelled ? "cancelled" : "failed");
		throw error;
	} finally {
		activeHermesInstalls.delete(sessionId);
	}
}

let codexLoginPromise: Promise<DesktopCodexDiagnostic> | undefined;

function extractCodexLoginUrl(text: string): string | undefined {
	const cleanText = text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
	return cleanText.match(/https:\/\/auth\.openai\.com\/oauth\/authorize\?[^\s"'<>]+/)?.[0];
}

export async function openCodexLoginForDesktop(
	sessionId: string,
	emit: EmitOnboardEvent,
	openUrl: (url: string) => Promise<unknown>,
): Promise<DesktopCodexDiagnostic> {
	if (codexLoginPromise) {
		emit({ sessionId, type: "status", source: "codex-login", message: "Codex 登录流程已打开，请在浏览器中完成授权。" });
		return codexLoginPromise;
	}
	codexLoginPromise = openCodexLoginWithAppServerForDesktop(sessionId, emit, openUrl)
		.catch((error) => {
			emit({
				sessionId,
				type: "status",
				source: "codex-login",
				message: `Codex app-server 登录不可用，已切换到 CLI 登录：${error instanceof Error ? error.message : String(error)}`,
			});
			return openCodexLoginWithCliForDesktop(sessionId, emit, openUrl);
		})
		.finally(() => {
			codexLoginPromise = undefined;
		});
	return codexLoginPromise;
}

async function openCodexLoginWithAppServerForDesktop(
	sessionId: string,
	emit: EmitOnboardEvent,
	openUrl: (url: string) => Promise<unknown>,
): Promise<DesktopCodexDiagnostic> {
	emit({ sessionId, type: "status", source: "codex-login", message: "正在通过 Codex app-server 准备登录..." });
	return loginCodexWithAppServer({
		onAuthUrl: async (url) => {
			emit({ sessionId, type: "status", source: "codex-login", message: "浏览器已打开，请完成 OpenAI 授权。", url });
			await openUrl(url);
		},
		onCompleted: (completion) => {
			emit({
				sessionId,
				type: completion.success ? "done" : "error",
				source: "codex-login",
				message: completion.success ? "Codex 已登录。" : completion.error || "Codex 登录未完成。",
			});
		},
	});
}

function openCodexLoginWithCliForDesktop(
	sessionId: string,
	emit: EmitOnboardEvent,
	openUrl: (url: string) => Promise<unknown>,
): Promise<DesktopCodexDiagnostic> {
	const shell = process.env.SHELL?.trim() || "/bin/zsh";
	return new Promise<DesktopCodexDiagnostic>((resolvePromise, reject) => {
		let output = "";
		let openedUrl = false;
		emit({ sessionId, type: "status", source: "codex-login", message: "正在打开 Codex 登录..." });
		const child = spawn(shell, ["-lc", "codex login"], {
			stdio: ["ignore", "pipe", "pipe"],
			env: process.env,
		});
		const handleOutput = (chunk: Buffer) => {
			const text = chunk.toString("utf8");
			output += text;
			const url = extractCodexLoginUrl(output);
			if (url && !openedUrl) {
				openedUrl = true;
				emit({ sessionId, type: "status", source: "codex-login", message: "浏览器已打开，请完成 OpenAI 授权。", url });
				void openUrl(url).catch((error) => {
					emit({
						sessionId,
						type: "error",
						source: "codex-login",
						message: `无法打开浏览器：${error instanceof Error ? error.message : String(error)}`,
					});
				});
			}
		};
		child.stdout.on("data", handleOutput);
		child.stderr.on("data", handleOutput);
		child.on("error", (error) => {
			reject(error);
		});
		child.on("close", (code) => {
			void checkCodexEnvironmentForDesktop()
				.then((diagnostic) => {
					if (diagnostic.authenticated) {
						emit({ sessionId, type: "done", source: "codex-login", message: "Codex 已登录。" });
						resolvePromise(diagnostic);
						return;
					}
					const message = output.trim() || diagnostic.error || `codex login exited with code ${String(code)}`;
					emit({ sessionId, type: "error", source: "codex-login", message });
					resolvePromise(diagnostic);
				})
				.catch(reject);
		});
	});
}

export async function createFeishuAppForSession(
	sessionId: string,
	emit: EmitOnboardEvent,
): Promise<DesktopFeishuAppCredentials> {
	try {
		emit({ sessionId, type: "status", source: "feishu", message: "正在准备扫码授权..." });
		const result = await lark.registerApp({
			source: "pie",
			onQRCodeReady(info) {
				void generateQrText(info.url).then((qr) => {
					emit({
						sessionId,
						type: "qr",
						source: "feishu",
						message: "请使用飞书或 Lark 扫码授权创建 bot",
						url: info.url,
						qr,
						expiresIn: info.expireIn,
					});
				});
			},
			onStatusChange(info) {
				if (info.status === "domain_switched") {
					emit({ sessionId, type: "status", source: "feishu", message: "检测到 Lark 租户，已切换注册域名。" });
				} else if (info.status === "slow_down") {
					emit({ sessionId, type: "status", source: "feishu", message: `授权轮询已放慢${info.interval ? `到 ${info.interval}s` : ""}。` });
				}
			},
		});
		const feishu = {
			appId: result.client_id,
			appSecret: result.client_secret,
			brand: result.user_info?.tenant_brand === "lark" ? "lark" as const : "feishu" as const,
		};
		emit({ sessionId, type: "status", source: "feishu", message: "正在读取飞书应用名称和头像..." });
		const probe = await LarkClient.fromCredentials({
			accountId: `desktop-onboard-${sessionId}`,
			appId: feishu.appId,
			appSecret: feishu.appSecret,
			brand: feishu.brand,
		}).probe();
		const syncedFeishu = {
			...feishu,
			...(probe.ok && probe.botName ? { appName: probe.botName } : {}),
			...(probe.ok && probe.botAvatarUrl ? { avatarUrl: probe.botAvatarUrl } : {}),
		};
		const syncParts = [
			syncedFeishu.appName ? "名称" : undefined,
			syncedFeishu.avatarUrl ? "头像" : undefined,
		].filter(Boolean);
		emit({
			sessionId,
			type: "done",
			source: "feishu",
			message: syncParts.length
				? `已创建 ${syncedFeishu.brand === "lark" ? "Lark" : "飞书"} 应用，并同步${syncParts.join("和")}`
				: `已创建 ${syncedFeishu.brand === "lark" ? "Lark" : "飞书"} 应用，但未从开放平台读取到名称和头像`,
			feishu: syncedFeishu,
		});
		return syncedFeishu;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		emit({ sessionId, type: "error", source: "feishu", message });
		throw error;
	}
}

const WECHAT_BOT_TYPE = "3";
const WECHAT_LOGIN_TIMEOUT_MS = 480_000;
const WECHAT_QR_STATUS_TIMEOUT_MS = 35_000;

export async function createWechatLoginForSession(
	sessionId: string,
	emit: EmitOnboardEvent,
): Promise<DesktopWechatCredentials> {
	const homeDir = getProfileHomeDir(sessionId);
	try {
		emit({ sessionId, type: "status", source: "wechat", message: "正在准备微信扫码授权..." });
		let qr = await fetchLoginQr({
			baseUrl: DEFAULT_WECHAT_BASE_URL,
			botType: WECHAT_BOT_TYPE,
		});
		let scanned = false;
		const deadline = Date.now() + WECHAT_LOGIN_TIMEOUT_MS;
		const emitQr = async (message: string) => {
			emit({
				sessionId,
				type: "qr",
				source: "wechat",
				message,
				url: qr.qrcode_img_content,
				qr: await generateQrText(qr.qrcode_img_content),
			});
		};
		await emitQr("请使用微信扫码连接 bot");
		while (Date.now() < deadline) {
			const status = await pollLoginQrStatus({
				baseUrl: DEFAULT_WECHAT_BASE_URL,
				qrcode: qr.qrcode,
				timeoutMs: WECHAT_QR_STATUS_TIMEOUT_MS,
			});
			if (status.status === "wait") {
				continue;
			}
			if (status.status === "scaned") {
				if (!scanned) {
					emit({ sessionId, type: "status", source: "wechat", message: "已扫码，请在微信里继续确认..." });
					scanned = true;
				}
				continue;
			}
			if (status.status === "scaned_but_redirect") {
				emit({ sessionId, type: "status", source: "wechat", message: "微信扫码已跳转，请继续等待确认..." });
				continue;
			}
			if (status.status === "expired") {
				throw new Error("微信二维码已失效，请刷新二维码。");
			}
			if (status.status === "confirmed") {
				const token = status.bot_token?.trim();
				const rawAccountId = status.ilink_bot_id?.trim();
				if (!token || !rawAccountId) {
					throw new Error("微信登录已确认，但响应缺少 bot token 或 account id。");
				}
				const wechat: DesktopWechatCredentials = {
					accountId: normalizeWechatAccountId(rawAccountId),
					baseUrl: status.baseurl?.trim() || DEFAULT_WECHAT_BASE_URL,
					...(status.ilink_user_id?.trim() ? { userId: status.ilink_user_id.trim() } : {}),
				};
				upsertAgentEnv({
					WECHAT_BOT_TOKEN: token,
					WECHAT_ACCOUNT_ID: wechat.accountId,
					WECHAT_BASE_URL: wechat.baseUrl,
					...(wechat.userId ? { WECHAT_USER_ID: wechat.userId } : {}),
				}, homeDir);
				emit({ sessionId, type: "done", source: "wechat", message: "微信已连接", wechat });
				return wechat;
			}
		}
		throw new Error("微信登录超时，请重新开始创建。");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		emit({ sessionId, type: "error", source: "wechat", message });
		throw error;
	}
}

function parseDiscordAvatarUrl(userId: string, avatarHash: string | undefined): string | undefined {
	if (!userId || !avatarHash) {
		return undefined;
	}
	return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=256`;
}

export async function fetchDiscordBotProfileForSession(
	sessionId: string,
	botToken: string,
	emit: EmitOnboardEvent,
): Promise<DesktopDiscordBotProfile> {
	const token = botToken.trim();
	if (!token) {
		throw new Error("Discord Bot Token 必填");
	}
	try {
		emit({ sessionId, type: "status", source: "discord", message: "正在读取 Discord Bot 资料..." });
		const rest = new REST({ version: "10" }).setToken(token);
		const user = await rest.get(Routes.user("@me")) as Record<string, unknown>;
		const id = typeof user.id === "string" ? user.id.trim() : "";
		const username = typeof user.username === "string" ? user.username.trim() : "";
		const globalName = typeof user.global_name === "string" ? user.global_name.trim() : "";
		const avatar = typeof user.avatar === "string" ? user.avatar.trim() : "";
		const profile: DesktopDiscordBotProfile = {
			botToken: token,
			applicationId: id || undefined,
			botName: globalName || username || undefined,
			avatarUrl: parseDiscordAvatarUrl(id, avatar),
		};
		const syncParts = [
			profile.botName ? "名称" : undefined,
			profile.avatarUrl ? "头像" : undefined,
		].filter(Boolean);
		emit({
			sessionId,
			type: "done",
			source: "discord",
			message: syncParts.length
				? `已同步 Discord Bot ${syncParts.join("和")}`
				: "Discord Bot Token 可用，但未读取到名称和头像",
			discord: profile,
		});
		return profile;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		emit({ sessionId, type: "error", source: "discord", message });
		throw error;
	}
}

function parseOpenClawGatewayPort(value: unknown): number | undefined {
	if (typeof value !== "string" || !value.trim()) {
		return undefined;
	}
	try {
		const raw = value.trim();
		const url = new URL(raw.startsWith("ws://") || raw.startsWith("wss://") ? raw : `ws://${raw}`);
		const port = Number.parseInt(url.port, 10);
		return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
	} catch {
		return undefined;
	}
}

function canConnectLocalPort(port: number): Promise<boolean> {
	return new Promise((resolvePort) => {
		let settled = false;
		const socket = net.createConnection({ host: "127.0.0.1", port });
		const settle = (value: boolean) => {
			if (settled) {
				return;
			}
			settled = true;
			socket.destroy();
			resolvePort(value);
		};
		socket.once("connect", () => settle(true));
		socket.once("error", () => settle(false));
		socket.setTimeout(500, () => settle(false));
	});
}

function collectConfiguredOpenClawGatewayPorts(): Set<number> {
	const rootDir = getDefaultPieRootDir();
	const registry = loadProfileRegistry(rootDir);
	const ports = new Set<number>();
	for (const entry of Object.values(registry.profiles)) {
		try {
			const homeDir = resolve(rootDir, entry.home);
			const profile = getStoredProfile(loadConfigStore(homeDir));
			if (profile?.harness.kind !== "openclaw") {
				continue;
			}
			const port = parseOpenClawGatewayPort(profile.harness.config?.gatewayUrl);
			if (port) {
				ports.add(port);
			}
		} catch {
			// Ignore incomplete profile homes while choosing a free OpenClaw gateway port.
		}
	}
	return ports;
}

async function resolveOpenClawGatewayUrl(): Promise<string> {
	const configuredPorts = collectConfiguredOpenClawGatewayPorts();
	for (let port = DEFAULT_OPENCLAW_GATEWAY_PORT; port < 65536; port += 1) {
		if (configuredPorts.has(port)) {
			continue;
		}
		if (!(await canConnectLocalPort(port))) {
			return `ws://127.0.0.1:${port}`;
		}
	}
	throw new Error("没有可用的 OpenClaw gateway 端口。");
}

export async function completeAgentCreation(draft: AgentCreationDraft): Promise<void> {
	const profileId = draft.sessionId;
	const homeDir = getProfileHomeDir(profileId);
	const developerMode = readDesktopSettings().developerMode;
	const channels = Array.from(new Set(draft.channels)).filter(
		(channel) => isChannelAvailableForRelease(channel, { developerMode }),
	);
	const disabledChannels = draft.channels.filter(
		(channel) => isDevelopmentChannel(channel),
	);
	if (!developerMode && disabledChannels.length) {
		throw new Error("Slack、Discord、Telegram 渠道仍在开发中，当前 release 暂不开放。");
	}
	if (!channels.length) {
		throw new Error("至少选择一个 IM 渠道");
	}
	if (channels.includes("feishu") && (!draft.feishu?.appId.trim() || !draft.feishu.appSecret.trim())) {
		throw new Error("飞书 App ID 和 App Secret 必填");
	}
	if (channels.includes("wechat") && !draft.wechat?.accountId.trim()) {
		throw new Error("微信渠道尚未完成扫码授权");
	}
	if (channels.includes("slack") && (!draft.slack?.botToken.trim() || !draft.slack.appToken.trim())) {
		throw new Error("Slack Bot Token 和 App Token 必填");
	}
	if (channels.includes("discord") && !draft.discord?.botToken.trim()) {
		throw new Error("Discord Bot Token 必填");
	}
	if (channels.includes("telegram") && !draft.telegram?.botToken.trim()) {
		throw new Error("Telegram Bot Token 必填");
	}
	if (!draft.provider.trim() || !draft.model.trim()) {
		throw new Error("Provider 和模型必填");
	}

	mkdirSync(homeDir, { recursive: true });
	const store = loadConfigStore(homeDir);
	const ex = getStoredProfile(store);
	const exModel = getProfileModel(ex);

	const codexModels = draft.harness === "codex" ? loadCodexModelCatalog() : [];
	const provider =
		draft.harness === "codex"
			? "codex-cli"
			: draft.provider.trim();
	const requestedModel = draft.model.trim();
	const model =
		draft.harness === "codex"
			? codexModels.find((item) => item.id === requestedModel)?.id ?? codexModels[0]?.id ?? "gpt-5.5"
			: requestedModel;
	const apiKey = draft.apiKey?.trim();
	if (provider === "pie-openai-proxy") {
		mergeProxyIntoModelsJson(homeDir, provider, {
			baseUrl: "https://api.openai.com/v1",
			api: "openai-completions",
			apiKey: "PIE_OPENAI_PROXY_API_KEY",
			compat: {
				supportsDeveloperRole: false,
				supportsReasoningEffort: false,
			},
			models: [{ id: model }],
		});
	}
	const hermesApiServerPort = deriveHermesApiServerPort(profileId);
	const openClawModelRef = draft.harness === "openclaw" ? toOpenClawModelRef(provider, model) : undefined;
	const newHermesHome = draft.harness === "hermes" ? getOfficialPieHermesProfileHome(profileId) : undefined;
	const importedProfile = draft.importedHarnessProfileId && (draft.harness === "openclaw" || draft.harness === "hermes")
		? listImportableHarnessProfiles(draft.harness).find((item) => item.id === draft.importedHarnessProfileId)
		: undefined;
	if (draft.importedHarnessProfileId && !importedProfile) {
		throw new Error(`未找到可导入的 ${draft.harness} profile: ${draft.importedHarnessProfileId}`);
	}
	if (draft.harness === "hermes" && importedProfile?.path) {
		const owner = findPieProfileClaimingHermesHome(importedProfile.path, { excludeProfileId: profileId });
		if (owner) {
			throw new Error(`这个 Hermes profile 已被 Pie Agent「${owner.displayName}」使用，不能重复导入。请直接启动原 Agent，或先复制成新的 Hermes profile 后再导入。`);
		}
	}

	const profile = createAgentProfile({
		harness: {
			kind: draft.harness,
			...(draft.harness === "codex"
				? {
						config: {
							sandboxMode: draft.codexSandboxMode ?? "danger-full-access",
							webSearchMode: draft.codexWebSearchMode ?? "cached",
						},
					}
				: draft.harness === "hermes"
					? {
							config: {
								endpoint: `http://127.0.0.1:${hermesApiServerPort}`,
								runPath: "/v1/runs",
								healthPath: "/health",
								command: "hermes",
								args: ["gateway", "run", "--replace"],
								managed: true,
								hermesHome: importedProfile?.path ?? newHermesHome,
								...(importedProfile ? { importedProfileId: importedProfile.id } : {}),
							},
						}
					: draft.harness === "openclaw"
						? {
								config: {
									gatewayUrl: SHARED_OPENCLAW_GATEWAY_URL,
									agentId: importedProfile?.id ?? getOpenClawAgentIdForPieProfile(profileId),
									modelRef: importedProfile?.modelRef ?? openClawModelRef,
									...(importedProfile ? { importedAgent: true, importedProfileId: importedProfile.id } : {}),
									managed: false,
								},
							}
				: {}),
			model: {
				provider,
				model,
				thinkingLevel: draft.thinkingLevel as ThinkingLevel,
				tools: exModel?.tools ?? "coding",
				debug: exModel?.debug ?? false,
				resumeSessions: draft.resumeSessions ?? getDefaultResumeSessionsForHarness(draft.harness),
				outputToolCallsToIm: true,
				outputToolCallImMaxLength: 60,
				outputThinkingToIm: false,
			},
		},
		channels: [
			...(channels.includes("feishu") && draft.feishu
				? [{
						kind: "feishu" as const,
						id: "feishu",
						enabled: true,
						appId: draft.feishu.appId.trim(),
						credentialState: "active" as const,
						brand: draft.feishu.brand,
						messageOutputMode: "bubble" as const,
					}]
				: []),
			...(channels.includes("wechat")
				? [{
						kind: "wechat" as const,
						id: "wechat",
						enabled: true,
						accountId: draft.wechat?.accountId.trim() || "wechat",
						baseUrl: draft.wechat?.baseUrl.trim() || DEFAULT_WECHAT_BASE_URL,
					}]
				: []),
			...(channels.includes("slack")
				? [{
						kind: "slack" as const,
						id: "slack",
						enabled: true,
					}]
				: []),
			...(channels.includes("discord")
				? [{
						kind: "discord" as const,
						id: "discord",
						enabled: true,
						applicationId: draft.discord?.applicationId?.trim() || undefined,
						guildId: draft.discord?.guildId?.trim() || undefined,
					}]
				: []),
			...(channels.includes("telegram")
				? [{
						kind: "telegram" as const,
						id: "telegram",
						enabled: true,
						botUsername: draft.telegram?.botUsername?.trim() || undefined,
					}]
				: []),
		],
	});

	saveConfigStore(setStoredProfile(store, profile), homeDir);
	const savedEnv: Record<string, string> = {};
	if (channels.includes("feishu") && draft.feishu) {
		savedEnv.FEISHU_APP_SECRET = draft.feishu.appSecret.trim();
	}
	if (channels.includes("slack") && draft.slack) {
		savedEnv.SLACK_BOT_TOKEN = draft.slack.botToken.trim();
		savedEnv.SLACK_APP_TOKEN = draft.slack.appToken.trim();
	}
	if (channels.includes("discord") && draft.discord) {
		savedEnv.DISCORD_BOT_TOKEN = draft.discord.botToken.trim();
	}
	if (channels.includes("telegram") && draft.telegram) {
		savedEnv.TELEGRAM_BOT_TOKEN = draft.telegram.botToken.trim();
	}
	if (draft.harness === "hermes") {
		const hermesProvider = toHermesInferenceProvider(provider);
		savedEnv.API_SERVER_ENABLED = "true";
		savedEnv.API_SERVER_HOST = "127.0.0.1";
		savedEnv.API_SERVER_PORT = String(hermesApiServerPort);
		savedEnv.API_SERVER_KEY = randomBytes(32).toString("hex");
		savedEnv.GATEWAY_ALLOW_ALL_USERS = "true";
		savedEnv.HERMES_INFERENCE_PROVIDER = hermesProvider;
		savedEnv.HERMES_INFERENCE_MODEL = model;
		if (!importedProfile) {
			const hermesHome = newHermesHome ?? join(homeDir, "hermes");
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
		}
	}
	const envKey = getProviderCredentialEnv(provider);
	if (envKey && apiKey) {
		savedEnv[envKey] = apiKey;
	}
	upsertAgentEnv(savedEnv, homeDir);
	const importedProfileNeedsLocalIdentity = channels.includes("wechat") || channels.includes("discord");
	const displayName = importedProfile
		? importedProfileNeedsLocalIdentity
			? draft.name?.trim() || importedProfile.id
			: draft.feishu?.appName?.trim() || importedProfile.id
		: draft.feishu?.appName?.trim() ||
			draft.discord?.botName?.trim() ||
			draft.telegram?.botUsername?.trim() ||
			draft.name?.trim() ||
			profileId;
	registerProfileHome(profileId, {
		displayName,
		desiredState: "paused",
		selected: true,
	});
}
