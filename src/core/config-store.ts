import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { resolveAgentHomeDir } from "./agent-home.js";

export type { LoadAgentEnvOptions } from "./agent-home.js";
export {
	expandUserHomePath,
	getAgentEnvFilePath,
	getDefaultAgentHomeDir,
	getDefaultPieRootDir,
	getProfileIdFromHomeDir,
	getProfilesDir,
	isProfileHomeDir,
	loadAgentEnvIntoProcess,
	resolveAgentHomeDir,
	shellExportPieHome,
	shortenHomeInPath,
	upsertAgentEnv,
} from "./agent-home.js";

export type ChannelKind = "feishu" | "wechat" | "slack" | "discord" | "telegram";
export type AgentBackendKind = "ousia" | "pi" | "codex" | "claude-code" | "openclaw" | "hermes";

export interface FeishuChannelProfile {
	kind: "feishu";
	id: string;
	enabled: boolean;
	appId: string;
	brand?: "feishu" | "lark";
	encryptKey?: string;
	verificationToken?: string;
}

export interface WechatChannelProfile {
	kind: "wechat";
	id: string;
	enabled: boolean;
	accountId?: string;
	baseUrl?: string;
	botType?: string;
	routeTag?: string;
}

export interface SlackChannelProfile {
	kind: "slack";
	id: string;
	enabled: boolean;
	teamId?: string;
	appId?: string;
	botUserId?: string;
}

export interface DiscordChannelProfile {
	kind: "discord";
	id: string;
	enabled: boolean;
	applicationId?: string;
	guildId?: string;
}

export interface TelegramChannelProfile {
	kind: "telegram";
	id: string;
	enabled: boolean;
	botUsername?: string;
}

export interface ModelProfile {
	provider?: string;
	model?: string;
	thinkingLevel?: ThinkingLevel;
	tools?: string;
	debug?: boolean;
	resumeSessions?: boolean;
	outputToolCallsToIm?: boolean;
	agentDir?: string;
	workDir?: string;
}

export interface AgentBackendProfile {
	kind: AgentBackendKind;
	model?: ModelProfile;
	config?: Record<string, unknown>;
}

export type ChannelProfile =
	| FeishuChannelProfile
	| WechatChannelProfile
	| SlackChannelProfile
	| DiscordChannelProfile
	| TelegramChannelProfile;

/** Stored agent instance profile. One profile is one agent instance and may expose multiple channels. */
export interface AgentProfile {
	schemaVersion: 1;
	backend: AgentBackendProfile;
	runtime?: {
		workDir?: string;
	};
	channels: ChannelProfile[];
}

export interface OwnerSessionBinding {
	chatId: string;
	sessionKey: string;
	openId?: string;
	updatedAt?: string;
}

export interface AgentConfigStore {
	version: 3;
	profile?: AgentProfile;
	ownerSession?: OwnerSessionBinding;
}

const DEFAULT_STORE: AgentConfigStore = {
	version: 3,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function normalizeOwnerSessionBinding(value: unknown): OwnerSessionBinding | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const chatId = typeof value.chatId === "string" ? value.chatId.trim() : "";
	const sessionKeySource = typeof value.sessionKey === "string" ? value.sessionKey.trim() : "";
	if (!chatId) {
		return undefined;
	}
	return {
		chatId,
		sessionKey: sessionKeySource || chatId,
		openId: typeof value.openId === "string" ? value.openId.trim() || undefined : undefined,
		updatedAt: typeof value.updatedAt === "string" ? value.updatedAt.trim() || undefined : undefined,
	};
}

function normalizeFeishuChannel(value: unknown): FeishuChannelProfile | undefined {
	if (!isRecord(value) || value.kind !== "feishu") {
		return undefined;
	}
	const appId = typeof value.appId === "string" ? value.appId.trim() : "";
	if (!appId) {
		return undefined;
	}
	return {
		kind: "feishu",
		id: typeof value.id === "string" && value.id.trim() ? value.id.trim() : "feishu",
		enabled: typeof value.enabled === "boolean" ? value.enabled : true,
		appId,
		brand: value.brand === "lark" ? "lark" : "feishu",
		encryptKey: typeof value.encryptKey === "string" && value.encryptKey.trim() ? value.encryptKey.trim() : undefined,
		verificationToken:
			typeof value.verificationToken === "string" && value.verificationToken.trim()
				? value.verificationToken.trim()
				: undefined,
	};
}

function normalizeWechatChannel(value: unknown): WechatChannelProfile | undefined {
	if (!isRecord(value) || value.kind !== "wechat") {
		return undefined;
	}
	return {
		kind: "wechat",
		id: typeof value.id === "string" && value.id.trim() ? value.id.trim() : "wechat",
		enabled: typeof value.enabled === "boolean" ? value.enabled : true,
		accountId: typeof value.accountId === "string" && value.accountId.trim() ? value.accountId.trim() : undefined,
		baseUrl: typeof value.baseUrl === "string" && value.baseUrl.trim() ? value.baseUrl.trim() : undefined,
		botType: typeof value.botType === "string" && value.botType.trim() ? value.botType.trim() : undefined,
		routeTag: typeof value.routeTag === "string" && value.routeTag.trim() ? value.routeTag.trim() : undefined,
	};
}

function normalizeSlackChannel(value: unknown): SlackChannelProfile | undefined {
	if (!isRecord(value) || value.kind !== "slack") {
		return undefined;
	}
	return {
		kind: "slack",
		id: typeof value.id === "string" && value.id.trim() ? value.id.trim() : "slack",
		enabled: typeof value.enabled === "boolean" ? value.enabled : true,
		teamId: typeof value.teamId === "string" && value.teamId.trim() ? value.teamId.trim() : undefined,
		appId: typeof value.appId === "string" && value.appId.trim() ? value.appId.trim() : undefined,
		botUserId: typeof value.botUserId === "string" && value.botUserId.trim() ? value.botUserId.trim() : undefined,
	};
}

function normalizeDiscordChannel(value: unknown): DiscordChannelProfile | undefined {
	if (!isRecord(value) || value.kind !== "discord") {
		return undefined;
	}
	return {
		kind: "discord",
		id: typeof value.id === "string" && value.id.trim() ? value.id.trim() : "discord",
		enabled: typeof value.enabled === "boolean" ? value.enabled : true,
		applicationId:
			typeof value.applicationId === "string" && value.applicationId.trim() ? value.applicationId.trim() : undefined,
		guildId: typeof value.guildId === "string" && value.guildId.trim() ? value.guildId.trim() : undefined,
	};
}

function normalizeTelegramChannel(value: unknown): TelegramChannelProfile | undefined {
	if (!isRecord(value) || value.kind !== "telegram") {
		return undefined;
	}
	return {
		kind: "telegram",
		id: typeof value.id === "string" && value.id.trim() ? value.id.trim() : "telegram",
		enabled: typeof value.enabled === "boolean" ? value.enabled : true,
		botUsername:
			typeof value.botUsername === "string" && value.botUsername.trim() ? value.botUsername.trim() : undefined,
	};
}

function normalizeModelProfile(value: unknown): ModelProfile | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const out: ModelProfile = {};
	if (typeof value.provider === "string" && value.provider.trim()) {
		out.provider = value.provider.trim();
	}
	if (typeof value.model === "string" && value.model.trim()) {
		out.model = value.model.trim();
	}
	if (typeof value.thinkingLevel === "string") {
		out.thinkingLevel = value.thinkingLevel as ThinkingLevel;
	}
	if (typeof value.tools === "string" && value.tools.trim()) {
		out.tools = value.tools.trim();
	}
	if (typeof value.debug === "boolean") {
		out.debug = value.debug;
	}
	if (typeof value.resumeSessions === "boolean") {
		out.resumeSessions = value.resumeSessions;
	}
	if (typeof value.outputToolCallsToIm === "boolean") {
		out.outputToolCallsToIm = value.outputToolCallsToIm;
	}
	if (typeof value.agentDir === "string" && value.agentDir.trim()) {
		out.agentDir = value.agentDir.trim();
	}
	if (typeof value.workDir === "string" && value.workDir.trim()) {
		out.workDir = value.workDir.trim();
	}
	return Object.keys(out).length ? out : undefined;
}

function normalizeAgentBackend(value: unknown): AgentBackendProfile {
	if (isRecord(value)) {
		const kind =
			value.kind === "openclaw" ||
			value.kind === "hermes" ||
			value.kind === "claude-code" ||
			value.kind === "codex" ||
			value.kind === "pi" ||
			value.kind === "ousia"
				? value.kind
				: "pi";
		const model = normalizeModelProfile(value.model);
		const config = isRecord(value.config) ? value.config : undefined;
		return {
			kind,
			...(model ? { model } : {}),
			...(config ? { config } : {}),
		};
	}
	return { kind: "pi" };
}

function normalizeAgentRuntime(value: unknown): AgentProfile["runtime"] {
	if (!isRecord(value)) {
		return undefined;
	}
	const workDir = typeof value.workDir === "string" && value.workDir.trim() ? value.workDir.trim() : undefined;
	return workDir ? { workDir } : undefined;
}

export function createAgentProfile(opts: {
	backend?: AgentBackendProfile;
	runtime?: AgentProfile["runtime"];
	model?: ModelProfile;
	channels?: ChannelProfile[];
	feishu?: FeishuChannelProfile;
}): AgentProfile {
	const channels = opts.channels ?? (opts.feishu ? [opts.feishu] : []);
	return {
		schemaVersion: 1,
		backend: opts.backend ?? {
			kind: "pi",
			...(opts.model ? { model: opts.model } : {}),
		},
		...(opts.runtime ? { runtime: opts.runtime } : {}),
		channels: channels.map((channel) =>
			channel.kind === "feishu"
				? {
						...channel,
						id: channel.id ?? "feishu",
						enabled: channel.enabled ?? true,
					}
				: channel.kind === "wechat"
					? {
							...channel,
							id: channel.id ?? "wechat",
							enabled: channel.enabled ?? true,
						}
					: {
							...channel,
							id: channel.id ?? channel.kind,
							enabled: channel.enabled ?? true,
						},
		),
	};
}

export function normalizeAgentProfile(value: unknown): AgentProfile | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	if (!isRecord(value.backend) || !Array.isArray(value.channels)) {
		return undefined;
	}

	const channels = value.channels
		.map(
			(channel) =>
				normalizeFeishuChannel(channel) ??
				normalizeWechatChannel(channel) ??
				normalizeSlackChannel(channel) ??
				normalizeDiscordChannel(channel) ??
				normalizeTelegramChannel(channel),
		)
		.filter((channel): channel is ChannelProfile => Boolean(channel));
	return createAgentProfile({
		backend: normalizeAgentBackend(value.backend),
		runtime: normalizeAgentRuntime(value.runtime),
		channels,
	});
}

export function getProfileModel(profile: AgentProfile | undefined): ModelProfile | undefined {
	return profile?.backend.kind === "ousia" || profile?.backend.kind === "pi" || profile?.backend.kind === "codex"
		? profile.backend.model
		: undefined;
}

export function setProfileModel(profile: AgentProfile | undefined, model: ModelProfile): AgentProfile {
	const base = profile ?? createAgentProfile({});
	return {
		...base,
		backend: {
			...base.backend,
			kind: base.backend.kind ?? "pi",
			model,
		},
	};
}

export function getPrimaryFeishuChannel(profile: AgentProfile | undefined): FeishuChannelProfile | undefined {
	return profile?.channels.find(
		(channel): channel is FeishuChannelProfile => channel.kind === "feishu" && channel.enabled !== false,
	);
}

export function getPrimaryWechatChannel(profile: AgentProfile | undefined): WechatChannelProfile | undefined {
	return profile?.channels.find(
		(channel): channel is WechatChannelProfile => channel.kind === "wechat" && channel.enabled !== false,
	);
}

export function getPrimarySlackChannel(profile: AgentProfile | undefined): SlackChannelProfile | undefined {
	return profile?.channels.find(
		(channel): channel is SlackChannelProfile => channel.kind === "slack" && channel.enabled !== false,
	);
}

export function getPrimaryDiscordChannel(profile: AgentProfile | undefined): DiscordChannelProfile | undefined {
	return profile?.channels.find(
		(channel): channel is DiscordChannelProfile => channel.kind === "discord" && channel.enabled !== false,
	);
}

export function getPrimaryTelegramChannel(profile: AgentProfile | undefined): TelegramChannelProfile | undefined {
	return profile?.channels.find(
		(channel): channel is TelegramChannelProfile => channel.kind === "telegram" && channel.enabled !== false,
	);
}

export function upsertFeishuChannel(
	profile: AgentProfile | undefined,
	channel: FeishuChannelProfile,
): AgentProfile {
	const base = profile ?? createAgentProfile({});
	const normalized = normalizeFeishuChannel({ ...channel, id: channel.id ?? "feishu", enabled: channel.enabled ?? true });
	if (!normalized) {
		throw new Error("Invalid Feishu channel profile");
	}
	let replaced = false;
	const channels = base.channels.map((entry) => {
		if (entry.kind === "feishu" && (entry.id ?? "feishu") === (normalized.id ?? "feishu")) {
			replaced = true;
			return normalized;
		}
		return entry;
	});
	if (!replaced) {
		channels.push(normalized);
	}
	return {
		...base,
		channels,
	};
}

export function upsertWechatChannel(
	profile: AgentProfile | undefined,
	channel: WechatChannelProfile,
): AgentProfile {
	const base = profile ?? createAgentProfile({});
	const normalized = normalizeWechatChannel({ ...channel, id: channel.id ?? "wechat", enabled: channel.enabled ?? true });
	if (!normalized) {
		throw new Error("Invalid Wechat channel profile");
	}
	let replaced = false;
	const channels = base.channels.map((entry) => {
		if (entry.kind === "wechat" && (entry.id ?? "wechat") === (normalized.id ?? "wechat")) {
			replaced = true;
			return normalized;
		}
		return entry;
	});
	if (!replaced) {
		channels.push(normalized);
	}
	return {
		...base,
		channels,
	};
}

function upsertChannel<T extends ChannelProfile>(
	profile: AgentProfile | undefined,
	channel: T,
	normalize: (value: unknown) => T | undefined,
): AgentProfile {
	const base = profile ?? createAgentProfile({});
	const normalized = normalize({ ...channel, id: channel.id ?? channel.kind, enabled: channel.enabled ?? true });
	if (!normalized) {
		throw new Error(`Invalid ${channel.kind} channel profile`);
	}
	let replaced = false;
	const channels = base.channels.map((entry) => {
		if (entry.kind === normalized.kind && (entry.id ?? entry.kind) === (normalized.id ?? normalized.kind)) {
			replaced = true;
			return normalized;
		}
		return entry;
	});
	if (!replaced) {
		channels.push(normalized);
	}
	return { ...base, channels };
}

export function upsertSlackChannel(profile: AgentProfile | undefined, channel: SlackChannelProfile): AgentProfile {
	return upsertChannel(profile, channel, normalizeSlackChannel);
}

export function upsertDiscordChannel(profile: AgentProfile | undefined, channel: DiscordChannelProfile): AgentProfile {
	return upsertChannel(profile, channel, normalizeDiscordChannel);
}

export function upsertTelegramChannel(profile: AgentProfile | undefined, channel: TelegramChannelProfile): AgentProfile {
	return upsertChannel(profile, channel, normalizeTelegramChannel);
}

export function normalizeConfigStore(value: unknown): AgentConfigStore {
	const parsed = isRecord(value) ? value : {};
	const directOwnerSession = normalizeOwnerSessionBinding(parsed.ownerSession);
	const directProfile = normalizeAgentProfile(parsed.profile);
	return {
		version: 3,
		profile: directProfile,
		ownerSession: directOwnerSession,
	};
}

export function getConfigStorePath(homeDir: string = resolveAgentHomeDir()): string {
	return join(homeDir, "config.json");
}

export function loadConfigStore(homeDir?: string): AgentConfigStore {
	const path = getConfigStorePath(homeDir);
	if (!existsSync(path)) {
		return DEFAULT_STORE;
	}

	const raw = readFileSync(path, "utf8").trim();
	if (!raw) {
		return DEFAULT_STORE;
	}

	return normalizeConfigStore(JSON.parse(raw) as unknown);
}

export function saveConfigStore(store: AgentConfigStore, homeDir?: string): void {
	const path = getConfigStorePath(homeDir);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, "utf8");
	try {
		chmodSync(path, 0o600);
	} catch {
		// Best-effort; unsupported on some filesystems.
	}
}

export function hasStoredProfile(store: AgentConfigStore): boolean {
	return Boolean(store.profile);
}

export function getStoredProfile(store: AgentConfigStore): AgentProfile | undefined {
	return store.profile;
}

export function setStoredProfile(store: AgentConfigStore, profile: AgentProfile): AgentConfigStore {
	return {
		version: 3,
		profile,
		ownerSession: store.ownerSession,
	};
}

export function getOwnerSessionBinding(store: AgentConfigStore): OwnerSessionBinding | undefined {
	return store.ownerSession;
}

export function setOwnerSessionBinding(store: AgentConfigStore, ownerSession: OwnerSessionBinding): AgentConfigStore {
	return {
		version: 3,
		profile: store.profile,
		ownerSession,
	};
}
