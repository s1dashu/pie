#!/usr/bin/env node

/**
 * Interactive onboarding only (no multi-command CLI).
 * Writes non-sensitive profile data to `<agent-home>/config.json` and secrets to `<agent-home>/.env`.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { styleText } from "node:util";
import * as p from "@clack/prompts";
import { isCancel } from "@clack/prompts";
import * as lark from "@larksuiteoapi/node-sdk";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import qrcode from "qrcode-terminal";
import {
	expandUserHomePath,
	getDefaultPieRootDir,
	loadAgentEnvIntoProcess,
	shellExportPieHome,
	shortenHomeInPath,
	upsertAgentEnv,
} from "../core/agent-home.js";
import {
	createAgentProfile,
	getPrimaryFeishuChannel,
	getProfileModel,
	getStoredProfile,
	loadConfigStore,
	saveConfigStore,
	setStoredProfile,
	type FeishuChannelProfile,
	type ModelProfile,
} from "../core/config-store.js";
import {
	generateBotProfileId,
	getProfileHomeDir,
	loadProfileRegistry,
	registerProfileHome,
} from "../core/profile-registry.js";
import { getDefaultResumeSessionsForHarness } from "../core/session-policy.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ONBOARD_ENTRY = fileURLToPath(import.meta.url);

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
const BAR = "│";

type OnboardLanguage = "en" | "zh";

type OnboardMessages = {
	apiBaseUrl: string;
	responsesBaseUrl: string;
	modelIdOpenAi: string;
	modelIdResponses: string;
	apiKeyStored: (envKey: string) => string;
	noApiKeySaved: (envKey: string) => string;
	cancelled: string;
	authTitle: string;
	authUseOne: string;
	authScan: string;
	authOpenUrl: string;
	authExpires: (seconds: number) => string;
	modelSetup: string;
	modelCatalog: string;
	recommended: string;
	modelManual: string;
	modelProxy: string;
	modelProxyHint: string;
	apiStyle: string;
	apiStyleOpenAi: string;
	apiStyleOpenAiHint: string;
	apiStyleCodex: string;
	apiStyleCodexHint: string;
	modelProvider: string;
	modelId: string;
	loadingCatalog: string;
	loadedModels: (count: number) => string;
	emptyCatalog: string;
	noModelsForProvider: (provider: string) => string;
	providerCatalog: string;
	modelForProvider: (provider: string) => string;
	typeToFilter: string;
	feishuSetup: string;
	createFeishuAssistant: string;
	configureExistingAssistant: string;
	preparingAppLink: string;
	authorizeAppCreation: string;
	larkTenant: string;
	slowDown: (interval?: number) => string;
	createdApp: (brand: "feishu" | "lark", appId: string) => string;
	appCreationFailed: string;
	feishuAppId: string;
	required: string;
	appSecretKeep: string;
	appSecret: string;
	appSecretRequired: string;
	encryptKey: string;
	verificationToken: string;
	leaveEmpty: string;
	appRegion: string;
	feishuChina: string;
	larkInternational: string;
	intro: string;
	language: string;
	english: string;
	chinese: string;
	agentHomeUsing: (home: string) => string;
	profileCreated: (profileId: string) => string;
	botProfile: string;
	createNewBot: string;
	editExistingBot: (profileId: string) => string;
	thinkingLevel: string;
	toolPreset: string;
	usingProxyKey: (envKey: string) => string;
	keyAlreadySet: (envKey: string) => string;
	replaceKey: (envKey: string) => string;
	newKey: (envKey: string) => string;
	providerKeyRequired: (envKey: string, provider: string) => string;
	noProviderKey: (envKey: string) => string;
	noPresetKey: (provider: string) => string;
	saved: (path: string) => string;
	startBot: string;
	botExited: string;
	tip: string;
	setupComplete: string;
};

const MESSAGES: Record<OnboardLanguage, OnboardMessages> = {
	en: {
		apiBaseUrl: "OpenAI-compatible API base URL",
		responsesBaseUrl: "OpenAI Responses-compatible base URL",
		modelIdOpenAi: "Model id (as your API expects, e.g. gpt-4o or a deployment name)",
		modelIdResponses: "Responses model id (as your API expects)",
		apiKeyStored: (envKey) => `${envKey} (stored in .env; referenced from models.json)`,
		noApiKeySaved: (envKey) => `No API key saved; set ${envKey} in shell or re-run onboard.`,
		cancelled: "Cancelled",
		authTitle: "Feishu / Lark authorization",
		authUseOne: "Use one of these options:",
		authScan: "1. Scan this QR code with Feishu/Lark.",
		authOpenUrl: "2. Or open this URL:",
		authExpires: (seconds) => `Expires in ${seconds} seconds.`,
		modelSetup: "Model setup",
		modelCatalog: "Choose from Pi model catalog",
		recommended: "Recommended",
		modelManual: "Type provider and model id manually",
		modelProxy: "Custom API endpoint (proxy)",
		modelProxyHint: "OpenAI/Codex-compatible",
		apiStyle: "Which API does this endpoint speak?",
		apiStyleOpenAi: "OpenAI-compatible (Chat Completions)",
		apiStyleOpenAiHint: "/v1/chat/completions",
		apiStyleCodex: "OpenAI Responses-compatible",
		apiStyleCodexHint: "/v1/responses, Codex-style models",
		modelProvider: "Model provider",
		modelId: "Model id",
		loadingCatalog: "Loading Pi model catalog…",
		loadedModels: (count) => `Loaded ${count} models`,
		emptyCatalog: "Model catalog is empty",
		noModelsForProvider: (provider) => `No models listed for provider "${provider}". Enter a model id.`,
		providerCatalog: "Provider (Pi catalog)",
		modelForProvider: (provider) => `Model · ${provider} (type to filter)`,
		typeToFilter: "Type to filter…",
		feishuSetup: "Feishu / Lark app setup",
		createFeishuAssistant: "Create a new Feishu assistant",
		configureExistingAssistant: "Configure an existing Feishu assistant",
		preparingAppLink: "Preparing app creation link...",
		authorizeAppCreation: "Authorize app creation",
		larkTenant: "Detected Lark tenant; switching registration domain.",
		slowDown: (interval) => `Authorization polling slowed down${interval ? ` to ${interval}s` : ""}.`,
		createdApp: (brand, appId) => `Created new ${brand === "lark" ? "Lark" : "Feishu"} app ${appId}`,
		appCreationFailed: "App creation failed",
		feishuAppId: "Feishu App ID",
		required: "Required",
		appSecretKeep: "Feishu App Secret — press Enter to keep the value below, or type to replace",
		appSecret: "Feishu App Secret",
		appSecretRequired: "Feishu App Secret is required",
		encryptKey: "Feishu Encrypt Key (optional)",
		verificationToken: "Feishu Verification Token (optional)",
		leaveEmpty: "Leave empty to skip",
		appRegion: "App region",
		feishuChina: "Feishu (China)",
		larkInternational: "Lark (international)",
		intro: "pie — setup wizard",
		language: "Language / 语言",
		english: "English",
		chinese: "简体中文",
		agentHomeUsing: (home) => `Using agent home: ${home}`,
		profileCreated: (profileId) => `Using bot profile: ${profileId}`,
		botProfile: "Bot profile",
		createNewBot: "Create a new bot",
		editExistingBot: (profileId) => `Edit ${profileId} bot`,
		thinkingLevel: "Thinking level",
		toolPreset: "Tool preset",
		usingProxyKey: (envKey) => `Using API key from proxy setup (${envKey}).`,
		keyAlreadySet: (envKey) =>
			`${envKey} is already set (shell or saved config). You can skip replacing unless you want a new key in config.`,
		replaceKey: (envKey) => `Replace ${envKey} in config with a new value?`,
		newKey: (envKey) => `${envKey} (new value -> stored in .env)`,
		providerKeyRequired: (envKey, provider) =>
			`${envKey} — required for provider "${provider}" unless already exported in your shell (stored in .env)`,
		noProviderKey: (envKey) =>
			`No ${envKey} saved; model calls will fail until you export it or re-run onboard and paste a key.`,
		noPresetKey: (provider) =>
			`No preset API-key env name for provider "${provider}". Set credentials per pi-coding-agent / provider docs (env or manual config).`,
		saved: (path) => `Saved\n  ${path}`,
		startBot: "Start the bot now?",
		botExited: "Bot exited",
		tip: "Tip",
		setupComplete: "Setup complete",
	},
	zh: {
		apiBaseUrl: "OpenAI 兼容 API Base URL",
		responsesBaseUrl: "OpenAI Responses 兼容 Base URL",
		modelIdOpenAi: "模型 ID（按你的 API 要求填写，例如 gpt-4o 或部署名）",
		modelIdResponses: "Responses 模型 ID（按你的 API 要求填写）",
		apiKeyStored: (envKey) => `${envKey}（保存到 .env，并被 models.json 引用）`,
		noApiKeySaved: (envKey) => `未保存 API Key；请在 shell 设置 ${envKey}，或重新运行 onboard。`,
		cancelled: "已取消",
		authTitle: "飞书 / Lark 授权",
		authUseOne: "请选择其中一种方式完成授权：",
		authScan: "1. 使用飞书/Lark 扫描这个二维码。",
		authOpenUrl: "2. 或者打开这个链接：",
		authExpires: (seconds) => `${seconds} 秒后过期。`,
		modelSetup: "模型设置",
		modelCatalog: "从 Pi 模型目录选择",
		recommended: "推荐",
		modelManual: "手动输入 provider 和模型 ID",
		modelProxy: "自定义 API Endpoint（代理）",
		modelProxyHint: "兼容 OpenAI/Codex",
		apiStyle: "这个 Endpoint 使用哪种 API？",
		apiStyleOpenAi: "OpenAI 兼容（Chat Completions）",
		apiStyleOpenAiHint: "/v1/chat/completions",
		apiStyleCodex: "OpenAI Responses 兼容",
		apiStyleCodexHint: "/v1/responses，Codex 风格模型",
		modelProvider: "模型 Provider",
		modelId: "模型 ID",
		loadingCatalog: "正在加载 Pi 模型目录…",
		loadedModels: (count) => `已加载 ${count} 个模型`,
		emptyCatalog: "模型目录为空",
		noModelsForProvider: (provider) => `Provider "${provider}" 没有可选模型，请输入模型 ID。`,
		providerCatalog: "Provider（Pi 模型目录）",
		modelForProvider: (provider) => `模型 · ${provider}（输入关键词过滤）`,
		typeToFilter: "输入关键词过滤…",
		feishuSetup: "飞书 / Lark 应用设置",
		createFeishuAssistant: "创建新的飞书助理",
		configureExistingAssistant: "配置已有的飞书助理",
		preparingAppLink: "正在准备应用创建链接...",
		authorizeAppCreation: "授权创建应用",
		larkTenant: "检测到 Lark 租户，正在切换注册域名。",
		slowDown: (interval) => `授权轮询已放慢${interval ? `到 ${interval}s` : ""}。`,
		createdApp: (brand, appId) => `已创建新的 ${brand === "lark" ? "Lark" : "飞书"} 应用 ${appId}`,
		appCreationFailed: "应用创建失败",
		feishuAppId: "飞书 App ID",
		required: "必填",
		appSecretKeep: "飞书 App Secret：按 Enter 保留当前值，或输入新值替换",
		appSecret: "飞书 App Secret",
		appSecretRequired: "飞书 App Secret 必填",
		encryptKey: "飞书 Encrypt Key（可选）",
		verificationToken: "飞书 Verification Token（可选）",
		leaveEmpty: "留空跳过",
		appRegion: "应用区域",
		feishuChina: "飞书（中国）",
		larkInternational: "Lark（国际版）",
		intro: "pie — 设置向导",
		language: "Language / 语言",
		english: "English",
		chinese: "简体中文",
		agentHomeUsing: (home) => `使用 Agent Home：${home}`,
		profileCreated: (profileId) => `使用 bot profile：${profileId}`,
		botProfile: "Bot profile",
		createNewBot: "创建新 bot",
		editExistingBot: (profileId) => `修改 ${profileId} bot`,
		thinkingLevel: "思考等级",
		toolPreset: "工具预设",
		usingProxyKey: (envKey) => `使用代理设置中的 API Key（${envKey}）。`,
		keyAlreadySet: (envKey) =>
			`${envKey} 已在 shell 或配置中存在；除非要替换，否则可以跳过。`,
		replaceKey: (envKey) => `是否替换配置中的 ${envKey}？`,
		newKey: (envKey) => `${envKey}（新值，将保存到 .env）`,
		providerKeyRequired: (envKey, provider) =>
			`${envKey}：provider "${provider}" 需要；如果 shell 已设置可留空（保存到 .env）`,
		noProviderKey: (envKey) =>
			`未保存 ${envKey}；模型调用会失败，直到你导出该环境变量或重新 onboard 填入 Key。`,
		noPresetKey: (provider) =>
			`没有 provider "${provider}" 对应的预设 API Key 环境变量名；请按 pi-coding-agent / provider 文档设置凭证。`,
		saved: (path) => `已保存\n  ${path}`,
		startBot: "现在启动 bot？",
		botExited: "Bot 已退出",
		tip: "提示",
		setupComplete: "设置完成",
	},
};

/** Common provider → API key env name (for optional prompt). */
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
	"azure-openai-responses": "AZURE_OPENAI_API_KEY",
	"github-copilot": "COPILOT_GITHUB_TOKEN",
	"amazon-bedrock": "AWS_BEARER_TOKEN_BEDROCK",
	/** OpenAI-compatible proxy defined in `<agent-home>/models.json` by onboard. */
	"pie-openai-proxy": "PIE_OPENAI_PROXY_API_KEY",
	/** Codex Responses proxy defined in `<agent-home>/models.json` by onboard. */
	"pie-codex-proxy": "PIE_CODEX_PROXY_API_KEY",
};

const PROXY_OPENAI_PROVIDER_ID = "pie-openai-proxy";
const PROXY_OPENAI_ENV_KEY = "PIE_OPENAI_PROXY_API_KEY";
const PROXY_CODEX_PROVIDER_ID = "pie-codex-proxy";
const PROXY_CODEX_ENV_KEY = "PIE_CODEX_PROXY_API_KEY";

export function normalizeOpenAiCompatibleBaseUrl(raw: string): string {
	return raw.trim().replace(/\/+$/, "");
}

export function normalizeOpenAiResponsesBaseUrl(raw: string): string {
	return raw.trim().replace(/\/+$/, "");
}

type ModelsJsonRoot = {
	providers?: Record<string, unknown>;
};

function mergeProxyIntoModelsJson(homeDir: string, providerId: string, providerConfig: unknown): void {
	const path = join(homeDir, "models.json");
	let root: ModelsJsonRoot = {};
	if (existsSync(path)) {
		try {
			const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				root = parsed as ModelsJsonRoot;
			}
		} catch {
			p.log.warn(`Could not parse existing models.json; overwriting structure at ${path}`);
		}
	}
	if (!root.providers || typeof root.providers !== "object") {
		root.providers = {};
	}
	root.providers[providerId] = providerConfig;
	writeFileSync(path, `${JSON.stringify(root, null, 2)}\n`, "utf8");
}

function mergeOpenAiProxyIntoModelsJson(homeDir: string, baseUrl: string, modelId: string): void {
	mergeProxyIntoModelsJson(homeDir, PROXY_OPENAI_PROVIDER_ID, {
		baseUrl,
		api: "openai-completions",
		apiKey: PROXY_OPENAI_ENV_KEY,
		compat: {
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
		},
		models: [{ id: modelId }],
	});
}

function mergeCodexProxyIntoModelsJson(homeDir: string, baseUrl: string, modelId: string): void {
	mergeProxyIntoModelsJson(homeDir, PROXY_CODEX_PROVIDER_ID, {
		baseUrl,
		api: "openai-responses",
		apiKey: PROXY_CODEX_ENV_KEY,
		models: [
			{
				id: modelId,
				reasoning: true,
				contextWindow: 272000,
				maxTokens: 128000,
			},
		],
	});
}

async function pickOpenAiCompatibleProxy(homeDir: string, msg: OnboardMessages): Promise<{
	provider: string;
	modelId: string;
	preloadedEnv: Record<string, string>;
}> {
	const baseRaw = stringOrCancel(
		await p.text({
			message: msg.apiBaseUrl,
			placeholder: "https://your-gateway.example.com",
		}),
	).trim();
	const baseUrl = normalizeOpenAiCompatibleBaseUrl(baseRaw);
	if (!baseUrl) {
		throw new Error("API base URL is required");
	}

	const modelId = stringOrCancel(
		await p.text({
			message: msg.modelIdOpenAi,
			placeholder: "gpt-4o-mini",
		}),
	).trim();
	if (!modelId) {
		throw new Error("Model id is required");
	}

	const keyRaw = stringOrCancel(
		await p.password({
			message: msg.apiKeyStored(PROXY_OPENAI_ENV_KEY),
			mask: "*",
		}),
	).trim();
	if (!keyRaw) {
		p.log.warn(msg.noApiKeySaved(PROXY_OPENAI_ENV_KEY));
	}

	mergeOpenAiProxyIntoModelsJson(homeDir, baseUrl, modelId);

	return {
		provider: PROXY_OPENAI_PROVIDER_ID,
		modelId,
		preloadedEnv: keyRaw ? { [PROXY_OPENAI_ENV_KEY]: keyRaw } : {},
	};
}

async function pickCodexProxy(homeDir: string, msg: OnboardMessages): Promise<{
	provider: string;
	modelId: string;
	preloadedEnv: Record<string, string>;
}> {
	const baseRaw = stringOrCancel(
		await p.text({
			message: msg.responsesBaseUrl,
			placeholder: "https://your-gateway.example.com/v1",
		}),
	).trim();
	const baseUrl = normalizeOpenAiResponsesBaseUrl(baseRaw);
	if (!baseUrl) {
		throw new Error("API base URL is required");
	}

	const modelId = stringOrCancel(
		await p.text({
			message: msg.modelIdResponses,
			placeholder: "gpt-5.5",
			defaultValue: "gpt-5.5",
		}),
	).trim();
	if (!modelId) {
		throw new Error("Model id is required");
	}

	const keyRaw = stringOrCancel(
		await p.password({
			message: msg.apiKeyStored(PROXY_CODEX_ENV_KEY),
			mask: "*",
		}),
	).trim();
	if (!keyRaw) {
		p.log.warn(msg.noApiKeySaved(PROXY_CODEX_ENV_KEY));
	}

	mergeCodexProxyIntoModelsJson(homeDir, baseUrl, modelId);

	return {
		provider: PROXY_CODEX_PROVIDER_ID,
		modelId,
		preloadedEnv: keyRaw ? { [PROXY_CODEX_ENV_KEY]: keyRaw } : {},
	};
}

function assertValue<T>(value: T | symbol, cancelMessage = "Cancelled"): T {
	if (isCancel(value)) {
		p.cancel(cancelMessage);
		process.exit(0);
	}
	return value;
}

async function pickLanguage(): Promise<OnboardLanguage> {
	return assertValue(
		await p.select<OnboardLanguage>({
			message: MESSAGES.en.language,
			options: [
				{ value: "en", label: MESSAGES.en.english },
				{ value: "zh", label: MESSAGES.en.chinese },
			],
			initialValue: "zh",
		}),
	);
}

/** `text` / `password` may yield `undefined` on empty submit (not cancel); normalize to string. */
function stringOrCancel(value: string | symbol | undefined, cancelMessage = "Cancelled"): string {
	if (isCancel(value)) {
		p.cancel(cancelMessage);
		process.exit(0);
	}
	return value ?? "";
}

async function confirmOrExit(message: string, initialValue: boolean): Promise<boolean> {
	const v = await p.confirm({ message, initialValue });
	if (isCancel(v)) {
		p.cancel("Cancelled");
		process.exit(0);
	}
	return v;
}

function parseHomeArg(argv: string[]): string | undefined {
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

async function resolveOnboardProfileHome(
	argv: string[],
	msg: OnboardMessages,
): Promise<{ homeDir: string; profileId?: string }> {
	const homeArg = parseHomeArg(argv);
	if (homeArg) {
		return { homeDir: expandUserHomePath(homeArg) };
	}

	const rootDir = getDefaultPieRootDir();
	const registry = loadProfileRegistry(rootDir);
	const profileIds = Object.keys(registry.profiles).sort((a, b) => a.localeCompare(b));
	const createValue = "__create__";
	const selected = assertValue(
		await p.select<string>({
			message: msg.botProfile,
			options: [
				{ value: createValue, label: msg.createNewBot },
				...profileIds.map((profileId) => ({
					value: profileId,
					label: msg.editExistingBot(profileId),
					hint: registry.selectedProfile === profileId ? "selected" : undefined,
				})),
			],
			initialValue: createValue,
			maxItems: 12,
		}),
	);

	if (selected !== createValue) {
		const entry = registry.profiles[selected];
		const homeDir = entry?.home ? resolve(rootDir, entry.home) : getProfileHomeDir(selected, rootDir);
		return { homeDir, profileId: selected };
	}

	const profileId = generateBotProfileId(registry);
	return { homeDir: getProfileHomeDir(profileId, rootDir), profileId };
}

const CLI_DIST = join(REPO_ROOT, "dist/cli/index.js");
const CLI_SRC = join(REPO_ROOT, "src/cli/index.ts");
const TSX_CLI = join(REPO_ROOT, "node_modules/tsx/dist/cli.mjs");

function getBotLaunchCommand(): { execPath: string; argv: string[] } {
	/** Match `npm run start`: prefer tsx + `src` when present so stale `dist` does not run after onboard. */
	if (existsSync(TSX_CLI) && existsSync(CLI_SRC)) {
		return { execPath: process.execPath, argv: [TSX_CLI, CLI_SRC] };
	}
	if (existsSync(CLI_DIST)) {
	return { execPath: process.execPath, argv: [CLI_DIST] };
	}
	throw new Error(
		"CLI entry not found: run `npm run build` for published installs, or `npm install` in this repo and retry.",
	);
}

function printAuthorizationBlock(url: string, expiresIn: number, qr: string, msg: OnboardMessages): void {
	const lines = [
		styleText("bold", msg.authTitle),
		"",
		msg.authUseOne,
		"",
		msg.authScan,
		...qr.split("\n"),
		"",
		msg.authOpenUrl,
		url,
		"",
		msg.authExpires(expiresIn),
	];
	process.stdout.write(`${lines.map((line) => `${BAR}  ${line}`).join("\n")}\n`);
}

/**
 * Pi `ModelRegistry` + Clack select/autocomplete, or manual entry.
 */
async function pickProviderAndModel(
	homeDir: string,
	exModel: ModelProfile | undefined,
	msg: OnboardMessages,
): Promise<{ provider: string; modelId: string; preloadedEnv: Record<string, string> }> {
	const mode = assertValue(
		await p.select<"list" | "manual" | "proxy">({
			message: msg.modelSetup,
			options: [
				{ value: "list", label: msg.modelCatalog, hint: msg.recommended },
				{ value: "manual", label: msg.modelManual },
				{ value: "proxy", label: msg.modelProxy, hint: msg.modelProxyHint },
			],
			initialValue: "list",
		}),
	);

	if (mode === "proxy") {
		const apiStyle = assertValue(
			await p.select<"openai" | "codex">({
				message: msg.apiStyle,
				options: [
					{
						value: "openai",
						label: msg.apiStyleOpenAi,
						hint: msg.apiStyleOpenAiHint,
					},
					{
						value: "codex",
						label: msg.apiStyleCodex,
						hint: msg.apiStyleCodexHint,
					},
				],
				initialValue: "openai",
			}),
		);
		return apiStyle === "codex" ? pickCodexProxy(homeDir, msg) : pickOpenAiCompatibleProxy(homeDir, msg);
	}

	if (mode === "manual") {
		const defProv = exModel?.provider ?? "kimi-coding";
		const provider =
			stringOrCancel(
				await p.text({
					message: msg.modelProvider,
					placeholder: defProv,
					defaultValue: defProv,
				}),
			).trim() || defProv;

		const defModel = exModel?.model ?? "k2p5";
		const modelId =
			stringOrCancel(
				await p.text({
					message: msg.modelId,
					placeholder: defModel,
					defaultValue: defModel,
				}),
			).trim() || defModel;

		return { provider, modelId, preloadedEnv: {} };
	}

	const spin = p.spinner();
	spin.start(msg.loadingCatalog);
	const registry = ModelRegistry.create(AuthStorage.inMemory(), join(homeDir, "models.json"));
	registry.refresh();
	const all: Model<any>[] = registry.getAll();
	spin.stop(all.length ? msg.loadedModels(all.length) : msg.emptyCatalog);

	if (!all.length) {
		throw new Error("Model catalog is empty. Choose manual entry instead.");
	}

	const providers = [...new Set(all.map((m) => String(m.provider)))].sort((a, b) => a.localeCompare(b));
	const provInitial =
		exModel?.provider && providers.includes(exModel.provider) ? exModel.provider : providers[0]!;

	const provider = assertValue(
		await p.select({
			message: msg.providerCatalog,
			options: providers.map((pr) => ({ value: pr, label: pr })),
			initialValue: provInitial,
			maxItems: 16,
		}),
	);

	const modelsForProv = all.filter((m) => String(m.provider) === provider);
	if (!modelsForProv.length) {
		p.log.warn(msg.noModelsForProvider(provider));
		const modelId = stringOrCancel(
			await p.text({
				message: msg.modelId,
				placeholder: exModel?.model ?? "",
				...(exModel?.model ? { defaultValue: exModel.model } : {}),
			}),
		).trim();
		if (!modelId) {
			throw new Error("Model id is required");
		}
		return { provider, modelId, preloadedEnv: {} };
	}

	const modelItems = modelsForProv.map((m) => ({
		value: m.id,
		label: m.name && m.name !== m.id ? `${m.id} — ${m.name}` : m.id,
	}));
	const modelInitial =
		exModel?.model && modelItems.some((x) => x.value === exModel.model)
			? exModel.model
			: modelItems[0]!.value;

	const modelId = assertValue(
		await p.autocomplete({
			message: msg.modelForProvider(provider),
			options: modelItems,
			initialValue: modelInitial,
			placeholder: msg.typeToFilter,
			maxItems: 12,
		}),
	);

	return { provider, modelId, preloadedEnv: {} };
}

async function pickFeishuAppCredentials(
	exCh: FeishuChannelProfile | undefined,
	msg: OnboardMessages,
): Promise<{
	appId: string;
	appSecret: string;
	brand: "feishu" | "lark";
	encryptKey?: string;
	verificationToken?: string;
}> {
	const setupMode = assertValue(
		await p.select<"auto" | "manual">({
			message: msg.feishuSetup,
			options: [
				{ value: "auto", label: msg.createFeishuAssistant, hint: msg.recommended },
				{ value: "manual", label: msg.configureExistingAssistant },
			],
			initialValue: "auto",
		}),
	);

	if (setupMode === "auto") {
		const spin = p.spinner();
		let qrShown = false;
		spin.start(msg.preparingAppLink);
		try {
				const result = await lark.registerApp({
					source: "pie",
					onQRCodeReady(info) {
					spin.stop(msg.authorizeAppCreation);
					qrShown = true;
					qrcode.generate(info.url, { small: true }, (qr) => {
						printAuthorizationBlock(info.url, info.expireIn, qr, msg);
					});
				},
				onStatusChange(info) {
					if (!qrShown) {
						return;
					}
					if (info.status === "domain_switched") {
						p.log.info(msg.larkTenant);
					} else if (info.status === "slow_down") {
						p.log.info(msg.slowDown(info.interval));
					}
				},
			});
			const brand = result.user_info?.tenant_brand === "lark" ? "lark" : "feishu";
			p.log.success(msg.createdApp(brand, result.client_id));
			return {
				appId: result.client_id,
				appSecret: result.client_secret,
				brand,
			};
		} catch (error) {
			if (!qrShown) {
				spin.stop(msg.appCreationFailed);
			}
			const typed = error as { code?: unknown; description?: unknown };
			throw new Error(
				typeof typed.code === "string" || typeof typed.description === "string"
					? `${msg.appCreationFailed}: ${String(typed.code ?? "unknown")} ${String(typed.description ?? "")}`.trim()
					: `${msg.appCreationFailed}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	const appId = stringOrCancel(
		await p.text({
			message: msg.feishuAppId,
			placeholder: exCh?.appId ?? msg.required,
			...(exCh?.appId ? { defaultValue: exCh.appId } : {}),
		}),
	).trim();
	if (!appId) {
		throw new Error("Feishu App ID is required");
	}

	const existingSecret =
		process.env.FEISHU_APP_SECRET?.trim() ?? "";
	const appSecret = stringOrCancel(
		await p.text({
			message: existingSecret ? msg.appSecretKeep : msg.appSecret,
			placeholder: existingSecret || msg.required,
			...(existingSecret ? { defaultValue: existingSecret } : {}),
			validate: (v) => {
				if (!existingSecret && !(v ?? "").trim()) {
					return msg.appSecretRequired;
				}
				return undefined;
			},
		}),
	).trim() || existingSecret;
	if (!appSecret) {
		throw new Error("Feishu App Secret is required");
	}

	const encryptKey = stringOrCancel(
		await p.text({
			message: msg.encryptKey,
			placeholder: msg.leaveEmpty,
			...(exCh?.encryptKey ? { defaultValue: exCh.encryptKey } : {}),
		}),
	).trim() || undefined;

	const verificationToken = stringOrCancel(
		await p.text({
			message: msg.verificationToken,
			placeholder: msg.leaveEmpty,
			...(exCh?.verificationToken ? { defaultValue: exCh.verificationToken } : {}),
		}),
	).trim() || undefined;

	const brand = assertValue(
		await p.select<"feishu" | "lark">({
			message: msg.appRegion,
			options: [
				{ value: "feishu", label: msg.feishuChina },
				{ value: "lark", label: msg.larkInternational },
			],
			initialValue: exCh?.brand === "lark" ? "lark" : "feishu",
		}),
	);

	return {
		appId,
		appSecret,
		brand,
		...(encryptKey ? { encryptKey } : {}),
		...(verificationToken ? { verificationToken } : {}),
	};
}

export async function runOnboard(argv: string[]): Promise<void> {
	const homeArg = parseHomeArg(argv);
	loadAgentEnvIntoProcess(homeArg ? { agentHome: homeArg } : {});

	const language = await pickLanguage();
	const msg = MESSAGES[language];

	const { homeDir, profileId } = await resolveOnboardProfileHome(argv, msg);
	const homeDefaultShown = shortenHomeInPath(homeDir);
	p.intro(msg.intro);
	if (profileId) {
		p.log.info(msg.profileCreated(profileId));
	}
	p.log.info(msg.agentHomeUsing(homeDefaultShown));

	mkdirSync(homeDir, { recursive: true });
	process.env.PIE_AGENT_HOME = homeDir;
	loadAgentEnvIntoProcess({ agentHome: homeDir });

	const store = loadConfigStore();
	const ex = getStoredProfile(store);
	const exCh = getPrimaryFeishuChannel(ex);
	const exModel = getProfileModel(ex);

	const feishuApp = await pickFeishuAppCredentials(exCh, msg);

	const { provider, modelId, preloadedEnv: modelPreloadedEnv } = await pickProviderAndModel(homeDir, exModel, msg);

	const defThink = exModel?.thinkingLevel ?? "off";
	const thinkingLevel = assertValue(
		await p.select<ThinkingLevel>({
			message: msg.thinkingLevel,
			options: THINKING_LEVELS.map((lvl) => ({ value: lvl, label: lvl })),
			initialValue: THINKING_LEVELS.includes(defThink) ? defThink : "off",
		}),
	);

	const tools = exModel?.tools ?? "coding";

	const resumeSessions = getDefaultResumeSessionsForHarness("pi");
	const outputToolCallsToIm = false;
	const outputToolCallImMaxLength = 60;
	const outputThinkingToIm = false;

	const credEnv = PROVIDER_CREDENTIAL_ENV[provider];
	const existingProviderKey =
		(credEnv ? process.env[credEnv]?.trim() : undefined) || "";
	const extraEnv: Record<string, string> = { ...modelPreloadedEnv };
	if (credEnv && modelPreloadedEnv[credEnv]) {
		p.log.info(msg.usingProxyKey(credEnv));
	}
	if (credEnv) {
		if (extraEnv[credEnv]) {
			// Key already supplied by the custom proxy setup path.
		} else if (existingProviderKey) {
			p.log.info(msg.keyAlreadySet(credEnv));
			const replace = await p.confirm({
				message: msg.replaceKey(credEnv),
				initialValue: false,
			});
			if (isCancel(replace)) {
				p.cancel("Cancelled");
				process.exit(0);
			}
			if (replace) {
				const keyRaw = stringOrCancel(
					await p.password({
						message: msg.newKey(credEnv),
						mask: "*",
					}),
				);
				if (keyRaw.trim()) {
					extraEnv[credEnv] = keyRaw.trim();
				}
			}
		} else {
			const keyRaw = stringOrCancel(
				await p.password({
					message: msg.providerKeyRequired(credEnv, provider),
					mask: "*",
				}),
			);
			if (keyRaw.trim()) {
				extraEnv[credEnv] = keyRaw.trim();
			} else if (!process.env[credEnv]?.trim()) {
				p.log.warn(msg.noProviderKey(credEnv));
			}
		}
	} else {
		p.log.warn(msg.noPresetKey(provider));
	}

	const profile = createAgentProfile({
		feishu: {
			kind: "feishu",
			id: exCh?.id ?? "feishu",
			enabled: exCh?.enabled ?? true,
			appId: feishuApp.appId,
			brand: feishuApp.brand,
			messageOutputMode: exCh?.messageOutputMode ?? "bubble",
			...(feishuApp.encryptKey ? { encryptKey: feishuApp.encryptKey } : {}),
			...(feishuApp.verificationToken ? { verificationToken: feishuApp.verificationToken } : {}),
		},
		model: {
			provider,
			model: modelId,
			thinkingLevel,
			tools,
			debug: exModel?.debug ?? false,
			resumeSessions,
			outputToolCallsToIm,
			outputToolCallImMaxLength,
			outputThinkingToIm,
		},
	});

	saveConfigStore(setStoredProfile(store, profile));
	const savedEnv = {
		FEISHU_APP_SECRET: feishuApp.appSecret,
		...extraEnv,
	};
	upsertAgentEnv(
		savedEnv,
		homeDir,
	);
	if (profileId) {
		registerProfileHome(profileId, {
			displayName: profileId,
			desiredState: "running",
			selected: true,
		});
	}
	Object.assign(process.env, savedEnv);

	p.log.success(msg.saved(shortenHomeInPath(resolve(homeDir, "config.json"))));

	if (await confirmOrExit(msg.startBot, true)) {
		const command = getBotLaunchCommand();
		const child = spawn(command.execPath, command.argv, {
			cwd: REPO_ROOT,
			stdio: "inherit",
			env: { ...process.env, ...savedEnv, PIE_AGENT_HOME: homeDir },
		});
		await new Promise<void>((resolvePromise, reject) => {
			child.on("exit", (code, signal) => {
				if (signal) {
					reject(new Error(`child signal ${signal}`));
					return;
				}
				if (code !== 0 && code != null) {
					reject(new Error(`exit ${code}`));
					return;
				}
				resolvePromise();
			});
			child.on("error", reject);
		});
		p.outro(msg.botExited);
	} else {
		p.note(`${shellExportPieHome(homeDir)} && pie`, msg.tip);
		p.outro(msg.setupComplete);
	}
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(ONBOARD_ENTRY)) {
	runOnboard(process.argv.slice(2)).catch((err) => {
		p.log.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	});
}
