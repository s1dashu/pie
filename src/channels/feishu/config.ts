import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import { getAgentBackendDefinition } from "../../agents/backend-registry.js";
import { loadAgentEnvIntoProcess, resolveAgentHomeDir } from "../../core/agent-home.js";
import {
	type AgentBackendKind,
	type FeishuChannelProfile,
	getPrimaryFeishuChannel,
	getProfileModel,
	getStoredProfile,
	loadConfigStore,
	type AgentConfigStore,
} from "../../core/config-store.js";
import { DEFAULT_FEISHU_MESSAGE_OUTPUT_MODE, type FeishuMessageOutputMode } from "../../core/message-style.js";
import { resolveDefaultRuntimeHomeDir } from "../../core/profile-registry.js";
import { DEFAULT_TOOL_CALL_IM_MAX_LENGTH, type ToolCallImMaxLength } from "../common/tool-call-im.js";
import type { LarkConfig } from "./platform/index.js";

/** Built-in tool names accepted by `createAgentSession({ tools })` (pi-coding-agent). */
type BuiltinToolName = "read" | "bash" | "edit" | "write" | "grep" | "find" | "ls";
type RuntimeEnv = Record<string, string | undefined>;

/** Default Feishu "coding" tool preset (name allowlist; includes grep/find/ls). */
const CODING_TOOL_NAMES: BuiltinToolName[] = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const READONLY_TOOL_NAMES: BuiltinToolName[] = ["read", "grep", "find", "ls"];
const ALL_BUILTIN_TOOL_NAMES: BuiltinToolName[] = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const VALID_THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh"]);
const VALID_TOOL_NAMES = new Set<BuiltinToolName>(ALL_BUILTIN_TOOL_NAMES);
export interface FeishuBotConfig {
	homeDir: string;
	backendKind: AgentBackendKind;
	backendConfig?: Record<string, unknown>;
	feishu: LarkConfig;
	model?: Model<any>;
	modelId?: string;
	modelLabel: string;
	assistantSystemPrompt?: string;
	assistantSystemPromptPath?: string;
	thinkingLevel: ThinkingLevel;
	/** Tool name allowlist for `createAgentSession` (pi-coding-agent 0.70+). */
	tools: string[];
	toolLabel: string;
	runMode: "start" | "dev";
	debug: boolean;
	verboseLogs: boolean;
	resumeSessions: boolean;
	outputToolCallsToIm: boolean;
	outputToolCallImMaxLength: ToolCallImMaxLength;
	outputThinkingToIm: boolean;
	messageOutputMode: FeishuMessageOutputMode;
	startedAtMs: number;
}

function parseBooleanFlag(value: string | undefined, defaultValue: boolean): boolean {
	if (value == null || value === "") {
		return defaultValue;
	}
	const normalized = value.trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(normalized)) {
		return true;
	}
	if (["0", "false", "no", "off"].includes(normalized)) {
		return false;
	}
	throw new Error(`Invalid boolean flag value: ${value}`);
}

function parseToolCallImMaxLength(value: string | undefined): ToolCallImMaxLength {
	if (value == null || value === "") {
		return DEFAULT_TOOL_CALL_IM_MAX_LENGTH;
	}
	if (value === "none" || value === "60" || value === "100" || value === "200") {
		return value === "none" ? "none" : Number(value) as ToolCallImMaxLength;
	}
	throw new Error(`Invalid FEISHU_BOT_IM_TOOL_CALL_MAX_LENGTH: ${value}`);
}

function resolveFeishuMessageOutputMode(channel: FeishuChannelProfile | undefined, envValue: string | undefined): FeishuMessageOutputMode {
	if (channel?.messageOutputMode) {
		return channel.messageOutputMode;
	}
	if (envValue === "bubble" || envValue === "card") {
		return envValue;
	}
	return DEFAULT_FEISHU_MESSAGE_OUTPUT_MODE;
}

function parseThinkingLevel(value: string | undefined): ThinkingLevel {
	if (!value) {
		return "off";
	}
	if (!VALID_THINKING_LEVELS.has(value as ThinkingLevel)) {
		throw new Error(`Invalid FEISHU_BOT_THINKING: ${value}`);
	}
	return value as ThinkingLevel;
}

function resolveTools(value: string | undefined): { tools: string[]; label: string } {
	if (!value || value === "coding") {
		return { tools: [...CODING_TOOL_NAMES], label: "coding" };
	}
	if (value === "readonly") {
		return { tools: [...READONLY_TOOL_NAMES], label: "readonly" };
	}
	if (value === "all") {
		return { tools: [...ALL_BUILTIN_TOOL_NAMES], label: "all" };
	}
	if (value === "none") {
		return { tools: [], label: "none" };
	}

	const names = value
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
	if (names.length === 0) {
		return { tools: [...CODING_TOOL_NAMES], label: "coding" };
	}

	for (const name of names) {
		if (!VALID_TOOL_NAMES.has(name as BuiltinToolName)) {
			throw new Error(`Invalid FEISHU_BOT_TOOLS entry: ${name}`);
		}
	}

	return {
		tools: names as BuiltinToolName[],
		label: names.join(","),
	};
}

function resolveModel(env: RuntimeEnv, backendKind: AgentBackendKind): { model?: Model<any>; modelId?: string; label: string } {
	const provider = env.FEISHU_BOT_PROVIDER;
	const modelId = env.FEISHU_BOT_MODEL;
	if (backendKind === "codex") {
		return {
			modelId: modelId?.trim() || undefined,
			label: modelId?.trim() || "codex default",
		};
	}
	if (backendKind === "hermes") {
		return {
			modelId: modelId?.trim() || undefined,
			label: modelId?.trim() || "hermes default",
		};
	}
	if (!provider || !modelId) {
		return { model: undefined, label: "auto" };
	}
	const homeDir = resolveAgentHomeDir();
	const modelRegistry = ModelRegistry.create(AuthStorage.inMemory(), join(homeDir, "models.json"));
	modelRegistry.refresh();
	const model = modelRegistry.find(provider, modelId);
	if (!model) {
		throw new Error(
			`config.json: model ${provider}/${modelId} was not found. If this is a custom provider, ensure ${homeDir}/models.json defines providers.${provider} with model id "${modelId}".`,
		);
	}
	return {
		model,
		label: `${provider}/${modelId}`,
	};
}

function resolveRunMode(env: RuntimeEnv): "start" | "dev" {
	return env.PIE_RUN_MODE === "dev" ? "dev" : "start";
}

function resolveAssistantSystemPrompt(env: RuntimeEnv): { path: string; content: string } {
	const framework = getAgentBackendDefinition(getStoredProfile(loadConfigStore())?.backend.kind ?? "pi").frameworkRuntime;
	const filePath = resolve(env.FEISHU_BOT_SYSTEM_PROMPT_FILE ?? framework.systemPrompt?.defaultPath ?? "");
	if (!existsSync(filePath)) {
		throw new Error(`Missing system prompt file: ${filePath}`);
	}
	const homeDir = resolveAgentHomeDir();
	return {
		path: filePath,
		content: readFileSync(filePath, "utf8").replaceAll("{{AGENT_HOME}}", homeDir).trim(),
	};
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

function setEnvDefault(env: RuntimeEnv, key: string, value: string | undefined): void {
	if (!env[key]?.trim() && value) {
		env[key] = value;
	}
}

function mergeStoredProfileIntoEnv(env: RuntimeEnv, store: AgentConfigStore): void {
	const profile = getStoredProfile(store);
	if (!profile) {
		return;
	}
	const ch = getPrimaryFeishuChannel(profile);
	if (ch) {
		setEnvDefault(env, "FEISHU_APP_ID", ch.appId);
		setEnvDefault(env, "FEISHU_BRAND", ch.brand);
		setEnvDefault(env, "FEISHU_BOT_IM_OUTPUT_MODE", ch.messageOutputMode);
		setEnvDefault(env, "FEISHU_ENCRYPT_KEY", ch.encryptKey);
		setEnvDefault(env, "FEISHU_VERIFICATION_TOKEN", ch.verificationToken);
	}
	const m = getProfileModel(profile);
	if (m) {
		setEnvDefault(env, "FEISHU_BOT_PROVIDER", m.provider);
		setEnvDefault(env, "FEISHU_BOT_MODEL", m.model);
		setEnvDefault(env, "FEISHU_BOT_THINKING", m.thinkingLevel);
		setEnvDefault(env, "FEISHU_BOT_TOOLS", m.tools);
		if (env.FEISHU_BOT_DEBUG === undefined && m.debug != null) {
			env.FEISHU_BOT_DEBUG = m.debug ? "1" : "0";
		}
		if (env.FEISHU_BOT_RESUME_SESSIONS === undefined && m.resumeSessions != null) {
			env.FEISHU_BOT_RESUME_SESSIONS = m.resumeSessions ? "1" : "0";
		}
		if (env.FEISHU_BOT_IM_TOOL_CALLS === undefined && m.outputToolCallsToIm != null) {
			env.FEISHU_BOT_IM_TOOL_CALLS = m.outputToolCallsToIm ? "1" : "0";
		}
		if (env.FEISHU_BOT_IM_TOOL_CALL_MAX_LENGTH === undefined && m.outputToolCallImMaxLength != null) {
			env.FEISHU_BOT_IM_TOOL_CALL_MAX_LENGTH = String(m.outputToolCallImMaxLength);
		}
		if (env.FEISHU_BOT_IM_THINKING === undefined && m.outputThinkingToIm != null) {
			env.FEISHU_BOT_IM_THINKING = m.outputThinkingToIm ? "1" : "0";
		}
	}
}

function resolveBackendKind(store: AgentConfigStore): AgentBackendKind {
	return getAgentBackendDefinition(getStoredProfile(store)?.backend.kind ?? "pi").kind;
}

export function loadConfig(argv: string[] = process.argv.slice(2)): FeishuBotConfig {
	const homeArg = parseAgentHomeFromArgv(argv);
	loadAgentEnvIntoProcess({ agentHome: homeArg ?? resolveDefaultRuntimeHomeDir() });
	const store = loadConfigStore();
	const env: RuntimeEnv = { ...process.env };
	mergeStoredProfileIntoEnv(env, store);
	const backendKind = resolveBackendKind(store);
	const appId = env.FEISHU_APP_ID?.trim();
	const appSecret = env.FEISHU_APP_SECRET?.trim();
	if (!appId || !appSecret) {
		throw new Error("Missing FEISHU_APP_ID or FEISHU_APP_SECRET");
	}

	const homeDir = resolveAgentHomeDir();
	const feishuChannel = getPrimaryFeishuChannel(getStoredProfile(store));
	const { model, modelId, label: modelLabel } = resolveModel(env, backendKind);
	const { tools, label: toolLabel } = resolveTools(env.FEISHU_BOT_TOOLS);
	const framework = getAgentBackendDefinition(backendKind).frameworkRuntime;
	const assistantSystemPrompt = framework.systemPrompt ? resolveAssistantSystemPrompt(env) : undefined;
	const runMode = resolveRunMode(env);
	const debug = parseBooleanFlag(env.FEISHU_BOT_DEBUG, false);

	return {
		homeDir,
		backendKind,
		backendConfig: getStoredProfile(store)?.backend.config,
		feishu: {
			appId,
			appSecret,
			brand: env.FEISHU_BRAND ?? "feishu",
			encryptKey: env.FEISHU_ENCRYPT_KEY,
			verificationToken: env.FEISHU_VERIFICATION_TOKEN,
		},
		model,
		modelId,
		modelLabel,
		assistantSystemPrompt: assistantSystemPrompt?.content,
		assistantSystemPromptPath: assistantSystemPrompt?.path,
		thinkingLevel: parseThinkingLevel(env.FEISHU_BOT_THINKING),
		tools,
		toolLabel,
		runMode,
		debug,
		verboseLogs: debug,
		resumeSessions: parseBooleanFlag(env.FEISHU_BOT_RESUME_SESSIONS, true),
		outputToolCallsToIm: parseBooleanFlag(env.FEISHU_BOT_IM_TOOL_CALLS, true),
		outputToolCallImMaxLength: parseToolCallImMaxLength(env.FEISHU_BOT_IM_TOOL_CALL_MAX_LENGTH),
		outputThinkingToIm: parseBooleanFlag(env.FEISHU_BOT_IM_THINKING, false),
		messageOutputMode: resolveFeishuMessageOutputMode(feishuChannel, env.FEISHU_BOT_IM_OUTPUT_MODE),
		startedAtMs: Date.now(),
	};
}
