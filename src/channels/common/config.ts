import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import { resolveBackendFramework } from "../../core/backend-framework.js";
import { loadAgentEnvIntoProcess, resolveAgentHomeDir } from "../../core/agent-home.js";
import {
	type AgentBackendKind,
	getProfileModel,
	getStoredProfile,
	loadConfigStore,
	type AgentConfigStore,
	type AgentProfile,
} from "../../core/config-store.js";
import { resolveDefaultRuntimeHomeDir } from "../../core/profile-registry.js";
import type { PieChannelKind } from "../../runtime/types.js";

type BuiltinToolName = "read" | "bash" | "edit" | "write" | "grep" | "find" | "ls";
type RuntimeEnv = Record<string, string | undefined>;

const CODING_TOOL_NAMES: BuiltinToolName[] = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const READONLY_TOOL_NAMES: BuiltinToolName[] = ["read", "grep", "find", "ls"];
const ALL_BUILTIN_TOOL_NAMES: BuiltinToolName[] = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const VALID_TOOL_NAMES = new Set<BuiltinToolName>(ALL_BUILTIN_TOOL_NAMES);
const VALID_THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh"]);
export interface CommonChannelRuntimeConfig {
	homeDir: string;
	backendKind: AgentBackendKind;
	backendConfig?: Record<string, unknown>;
	channelKind: PieChannelKind;
	model?: Model<any>;
	modelId?: string;
	modelLabel: string;
	assistantSystemPrompt?: string;
	assistantSystemPromptPath?: string;
	thinkingLevel: ThinkingLevel;
	tools: string[];
	toolLabel: string;
	runMode: "start" | "dev";
	debug: boolean;
	verboseLogs: boolean;
	resumeSessions: boolean;
	outputToolCallsToIm: boolean;
	startedAtMs: number;
}

export interface CommonConfigOptions {
	channelKind: PieChannelKind;
	envPrefix: string;
	argv?: string[];
	mergeChannelProfile?: (env: RuntimeEnv, profile: AgentProfile) => void;
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

function parseThinkingLevel(value: string | undefined, label: string): ThinkingLevel {
	if (!value) {
		return "off";
	}
	if (!VALID_THINKING_LEVELS.has(value as ThinkingLevel)) {
		throw new Error(`Invalid ${label}: ${value}`);
	}
	return value as ThinkingLevel;
}

function resolveTools(value: string | undefined, label: string): { tools: string[]; label: string } {
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
	const names = value.split(",").map((part) => part.trim()).filter(Boolean);
	for (const name of names) {
		if (!VALID_TOOL_NAMES.has(name as BuiltinToolName)) {
			throw new Error(`Invalid ${label} entry: ${name}`);
		}
	}
	return { tools: names, label: names.join(",") };
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

export function setEnvDefault(env: RuntimeEnv, key: string, value: string | undefined): void {
	if (!env[key]?.trim() && value) {
		env[key] = value;
	}
}

function resolveModel(
	env: RuntimeEnv,
	providerKey: string,
	modelKey: string,
	backendKind: AgentBackendKind,
): { model?: Model<any>; modelId?: string; label: string } {
	const provider = env[providerKey];
	const modelId = env[modelKey];
	if (backendKind === "codex") {
		return {
			modelId: modelId?.trim() || undefined,
			label: modelId?.trim() || "codex default",
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
		throw new Error(`config.json: model ${provider}/${modelId} was not found in ${homeDir}/models.json.`);
	}
	return { model, label: `${provider}/${modelId}` };
}

function resolveAssistantSystemPrompt(env: RuntimeEnv, promptKey: string, defaultPath: string): { path: string; content: string } {
	const filePath = resolve(env[promptKey] ?? defaultPath);
	if (!existsSync(filePath)) {
		throw new Error(`Missing system prompt file: ${filePath}`);
	}
	const homeDir = resolveAgentHomeDir();
	return { path: filePath, content: readFileSync(filePath, "utf8").replaceAll("{{AGENT_HOME}}", homeDir).trim() };
}

function mergeStoredModelIntoEnv(env: RuntimeEnv, prefix: string, store: AgentConfigStore): void {
	const profile = getStoredProfile(store);
	const model = getProfileModel(profile);
	if (!model) {
		return;
	}
	setEnvDefault(env, `${prefix}_BOT_PROVIDER`, model.provider);
	setEnvDefault(env, `${prefix}_BOT_MODEL`, model.model);
	setEnvDefault(env, `${prefix}_BOT_THINKING`, model.thinkingLevel);
	setEnvDefault(env, `${prefix}_BOT_TOOLS`, model.tools);
	if (env[`${prefix}_BOT_DEBUG`] === undefined && model.debug != null) {
		env[`${prefix}_BOT_DEBUG`] = model.debug ? "1" : "0";
	}
	if (env[`${prefix}_BOT_RESUME_SESSIONS`] === undefined && model.resumeSessions != null) {
		env[`${prefix}_BOT_RESUME_SESSIONS`] = model.resumeSessions ? "1" : "0";
	}
	if (env[`${prefix}_BOT_IM_TOOL_CALLS`] === undefined && model.outputToolCallsToIm != null) {
		env[`${prefix}_BOT_IM_TOOL_CALLS`] = model.outputToolCallsToIm ? "1" : "0";
	}
}

export function loadCommonChannelConfig(options: CommonConfigOptions): CommonChannelRuntimeConfig {
	const argv = options.argv ?? process.argv.slice(2);
	const homeArg = parseAgentHomeFromArgv(argv);
	loadAgentEnvIntoProcess({ agentHome: homeArg ?? resolveDefaultRuntimeHomeDir() });
	const store = loadConfigStore();
	const env: RuntimeEnv = { ...process.env };
	const profile = getStoredProfile(store);
	if (profile) {
		options.mergeChannelProfile?.(env, profile);
	}
	mergeStoredModelIntoEnv(env, options.envPrefix, store);

	const framework = resolveBackendFramework(profile?.backend.kind);
	const backendKind = framework.kind;
	const { model, modelId, label: modelLabel } = resolveModel(
		env,
		`${options.envPrefix}_BOT_PROVIDER`,
		`${options.envPrefix}_BOT_MODEL`,
		backendKind,
	);
	const { tools, label: toolLabel } = resolveTools(env[`${options.envPrefix}_BOT_TOOLS`], `${options.envPrefix}_BOT_TOOLS`);
	const assistantSystemPrompt =
		framework.systemPrompt
			? resolveAssistantSystemPrompt(env, `${options.envPrefix}_BOT_SYSTEM_PROMPT_FILE`, framework.systemPrompt.defaultPath)
			: undefined;
	return {
		homeDir: resolveAgentHomeDir(),
		backendKind,
		backendConfig: profile?.backend.config,
		channelKind: options.channelKind,
		model,
		modelId,
		modelLabel,
		assistantSystemPrompt: assistantSystemPrompt?.content,
		assistantSystemPromptPath: assistantSystemPrompt?.path,
		thinkingLevel: parseThinkingLevel(env[`${options.envPrefix}_BOT_THINKING`], `${options.envPrefix}_BOT_THINKING`),
		tools,
		toolLabel,
		runMode: env.PIE_RUN_MODE === "dev" ? "dev" : "start",
		debug: parseBooleanFlag(env[`${options.envPrefix}_BOT_DEBUG`], false),
		verboseLogs: parseBooleanFlag(env[`${options.envPrefix}_BOT_DEBUG`], false),
		resumeSessions: parseBooleanFlag(env[`${options.envPrefix}_BOT_RESUME_SESSIONS`], true),
		outputToolCallsToIm: parseBooleanFlag(env[`${options.envPrefix}_BOT_IM_TOOL_CALLS`], true),
		startedAtMs: Date.now(),
	};
}
