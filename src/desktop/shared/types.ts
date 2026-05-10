import type { AgentLogEntry } from "../../core/agent-logs.js";

export type AgentStatus = "running" | "starting" | "paused" | "terminated";
export type { AgentLogEntry };
export type AgentDesiredState = "running" | "paused";
export type RuntimeEnvironmentLifecycleState =
	| "created"
	| "starting"
	| "running"
	| "degraded"
	| "stopping"
	| "stopped"
	| "failed";
export type AgentOnboardEventType = "qr" | "status" | "done" | "error";
export type AgentDeleteEventStep = "stop" | "files" | "done";

export interface RuntimeEnvironmentSummary {
	homeDir: string;
	workDir: string;
	lifecycle: {
		state: RuntimeEnvironmentLifecycleState;
		updatedAt: string;
		reason?: string;
	};
}

export interface AgentSummary {
	id: string;
	name: string;
	status: AgentStatus;
	desiredState: AgentDesiredState;
	avatarSeed: string;
	avatarUrl?: string;
	selected: boolean;
	home: string;
	runtimeEnvironment?: RuntimeEnvironmentSummary;
	createdAt?: string;
	updatedAt?: string;
	harnessKind?: string;
	harnessService?: {
		kind: string;
		group: string;
		endpoint?: string;
		lifecycle: RuntimeEnvironmentSummary["lifecycle"];
	};
	channelKinds?: string[];
	modelLabel?: string;
	appId?: string;
}

export interface AgentDetails extends AgentSummary {
	brand?: "feishu" | "lark";
	feishuMessageOutputMode?: DesktopFeishuMessageOutputMode;
	imGroupResponseMode?: DesktopImGroupResponseMode;
	feishuCredentialState?: "active" | "invalidated";
	feishuCredentialInvalidatedReason?: string;
	appSecret?: string;
	wechat?: {
		accountId?: string;
		baseUrl?: string;
		botToken?: string;
	};
	slack?: {
		botToken?: string;
		appToken?: string;
	};
	discord?: {
		botToken?: string;
		applicationId?: string;
		guildId?: string;
	};
	telegram?: {
		botToken?: string;
		botUsername?: string;
	};
	model?: {
		provider?: string;
		model?: string;
		thinkingLevel?: string;
		resumeSessions?: boolean;
		outputToolCallsToIm?: boolean;
		outputToolCallImMaxLength?: 60 | 100 | 200 | "none";
		outputThinkingToIm?: boolean;
		apiKey?: string;
		apiKeyEnv?: string;
	};
}

export type DesktopThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type DesktopAgentHarness = "ousia" | "pi" | "codex" | "claude-code" | "openclaw" | "hermes";
export type DesktopChannelKind = "feishu" | "wechat" | "slack" | "discord" | "telegram";
export type DesktopCodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type DesktopCodexWebSearchMode = "disabled" | "cached" | "live";
export type DesktopFeishuMessageOutputMode = "bubble" | "card";
export type DesktopImGroupResponseMode = "collect_only" | "owner_mention" | "mention" | "owner" | "any";
export type DesktopLanguage = "zh" | "en";
export type DesktopLogRetention = "7d" | "30d" | "90d" | "forever";
export type DesktopColorScheme = "system" | "light" | "dark";

export interface DesktopSettings {
	language: DesktopLanguage;
	colorScheme: DesktopColorScheme;
	quitTerminatesAgents: boolean;
	restoreRunningAgentsOnLaunch: boolean;
	openAtLogin: boolean;
	keepAwakeWhileOpen: boolean;
	developerMode: boolean;
	runtimeLogRetention: DesktopLogRetention;
	usageEventRetention: DesktopLogRetention;
	appearanceGrayHue?: number;
}

export interface DesktopBootstrap {
	settings: DesktopSettings;
	agents: AgentSummary[];
	selectedAgent?: AgentDetails;
}

export type DesktopSettingsDraft = Partial<
	Pick<
		DesktopSettings,
		| "language"
		| "colorScheme"
		| "quitTerminatesAgents"
		| "restoreRunningAgentsOnLaunch"
		| "openAtLogin"
		| "keepAwakeWhileOpen"
		| "developerMode"
		| "runtimeLogRetention"
		| "usageEventRetention"
		| "appearanceGrayHue"
	>
>;

export interface AgentDraft {
	name?: string;
	provider?: string;
	model?: string;
	thinkingLevel?: DesktopThinkingLevel;
	resumeSessions?: boolean;
	outputToolCallsToIm?: boolean;
	outputToolCallImMaxLength?: 60 | 100 | 200 | "none";
	outputThinkingToIm?: boolean;
	apiKey?: string;
	appId?: string;
	appSecret?: string;
	brand?: "feishu" | "lark";
	feishuMessageOutputMode?: DesktopFeishuMessageOutputMode;
	imGroupResponseMode?: DesktopImGroupResponseMode;
	wechatAccountId?: string;
	wechatBaseUrl?: string;
	wechatBotToken?: string;
	slackBotToken?: string;
	slackAppToken?: string;
	discordBotToken?: string;
	discordApplicationId?: string;
	discordGuildId?: string;
	telegramBotToken?: string;
	telegramBotUsername?: string;
}

export interface DesktopModelOption {
	id: string;
	name?: string;
	provider: string;
	modelRef?: string;
}

export interface DesktopCodexModelOption {
	id: string;
	name?: string;
	defaultThinkingLevel?: DesktopThinkingLevel;
	supportedThinkingLevels: DesktopThinkingLevel[];
	description?: string;
}

export interface DesktopCodexDiagnostic {
	installed: boolean;
	authenticated: boolean;
	executablePath?: string;
	version?: string;
	authMethod?: "cli" | "env" | "unknown";
	error?: string;
	loginCommand?: string[];
}

export interface DesktopRuntimeDiagnostic {
	installed: boolean;
	ready: boolean;
	executablePath?: string;
	version?: string;
	error?: string;
	installCommand?: string[];
}

export type DesktopManagedRuntimeKind = "hermes" | "openclaw" | "codex";

export interface DesktopManagedRuntimeStatus extends DesktopRuntimeDiagnostic {
	kind: DesktopManagedRuntimeKind;
	label: string;
}

export interface DesktopModelCatalog {
	models: DesktopModelOption[];
	providers: string[];
}

export interface ImportableHarnessProfile {
	id: string;
	label: string;
	harness: "openclaw" | "hermes";
	path?: string;
	workDir?: string;
	agentDir?: string;
	provider?: string;
	model?: string;
	modelRef?: string;
	isDefault?: boolean;
}

export interface ProviderCredentialReuse {
	provider: string;
	envKey: string;
	value: string;
	sourceAgentId?: string;
	sourceAgentName?: string;
}

export interface AgentCreationSession {
	sessionId: string;
	profileId: string;
	name: string;
	home: string;
	models: DesktopModelOption[];
	providers: string[];
	codexModels: DesktopCodexModelOption[];
	openClawModels: DesktopModelOption[];
}

export interface BotAvatarOption {
	id: string;
	fileName: string;
	label: string;
	dataUrl: string;
}

export interface AgentAvatarUpload {
	fileName: string;
	dataUrl: string;
}

export interface DesktopFeishuAppCredentials {
	appId: string;
	appSecret: string;
	brand: "feishu" | "lark";
	appName?: string;
	avatarUrl?: string;
}

export interface DesktopWechatCredentials {
	accountId: string;
	baseUrl: string;
	userId?: string;
}

export interface DesktopDiscordBotProfile {
	botToken: string;
	applicationId?: string;
	botName?: string;
	avatarUrl?: string;
}

export interface AgentCreationDraft {
	sessionId: string;
	harness: DesktopAgentHarness;
	importedHarnessProfileId?: string;
	name?: string;
	avatarUpload?: AgentAvatarUpload;
	channels: DesktopChannelKind[];
	feishu?: DesktopFeishuAppCredentials;
	wechat?: DesktopWechatCredentials;
	slack?: {
		botToken: string;
		appToken: string;
	};
	discord?: {
		botToken: string;
		applicationId?: string;
		guildId?: string;
		botName?: string;
		avatarUrl?: string;
	};
	telegram?: {
		botToken: string;
		botUsername?: string;
	};
	provider: string;
	model: string;
	thinkingLevel: DesktopThinkingLevel;
	resumeSessions?: boolean;
	apiKey?: string;
	codexSandboxMode?: DesktopCodexSandboxMode;
	codexWebSearchMode?: DesktopCodexWebSearchMode;
}

export interface AgentOnboardEvent {
	sessionId: string;
	type: AgentOnboardEventType;
	source?: "codex-install" | "codex-login" | "discord" | "feishu" | "hermes-install" | "wechat";
	message?: string;
	url?: string;
	qr?: string;
	expiresIn?: number;
	feishu?: DesktopFeishuAppCredentials;
	wechat?: DesktopWechatCredentials;
	discord?: DesktopDiscordBotProfile;
}

export interface AgentDeleteEvent {
	agentId: string;
	step: AgentDeleteEventStep;
	message: string;
}

export interface DesktopQuitAgent {
	id: string;
	name: string;
	avatarSeed: string;
	avatarUrl?: string;
}

export type DesktopQuitEvent =
	| {
			phase: "terminating-agents";
			agentIds: string[];
			agents: DesktopQuitAgent[];
	  }
	| {
			phase: "agent-stopped";
			agent: DesktopQuitAgent;
	  };

export interface AgentChatSendResult {
	sessionKey: string;
	assistantText: string;
	clientMessageId?: string;
}

export interface AgentChatClearResult {
	sessionKey: string;
	clearedEvents: number;
}

export interface AgentChatSessionStatus {
	totalMessages: number;
	contextUsage?: {
		tokens: number | null;
		contextWindow: number;
		percent: number | null;
	};
}

export interface AgentChatSessionCommandResult {
	sessionKey: string;
	message?: string;
	status?: AgentChatSessionStatus;
	summary?: string;
	clearedEvents?: number;
}

export interface AgentEventLogEntry {
	timestamp: string;
	conversationKey?: string;
	event: unknown;
	sequence?: number;
}

export interface UsageBucket {
	incomingMessages: number;
	outgoingMessages: number;
	actions: number;
	failedActions: number;
	turns: number;
	tokens: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	runDurationMs: number;
}

export interface AgentUsageDailyPoint extends UsageBucket {
	date: string;
}

export interface AgentUsageStats {
	today: UsageBucket;
	total: UsageBucket;
	currentRun: UsageBucket;
	recentDays: AgentUsageDailyPoint[];
	tokenUsageSource: "actual" | "estimated" | "none";
	averageTtfsMs?: number;
	runningSince?: string;
	updatedAt: string;
}

export interface AgentResourceStats {
	cpuPercent: number;
	memoryBytes: number;
	memoryPercent: number;
	storageBytes: number;
	diskTotalBytes?: number;
	diskAvailableBytes?: number;
	pid?: number;
	running: boolean;
	updatedAt: string;
}

export type AgentSkillSourceKind = "profile" | "agent-type" | "universal";

export interface AgentSkillSource {
	id: string;
	kind: AgentSkillSourceKind;
	label: string;
	description: string;
	path: string;
	exists: boolean;
	skillCount: number;
	skills: string[];
}

export interface AgentSystemPromptSource {
	label: string;
	description: string;
	path: string;
	exists: boolean;
	content: string;
}

export interface AgentChangeEvent {
	agentIds: string[];
	reason?: string;
}

export interface PieDesktopApi {
	getDesktopBootstrap(): Promise<DesktopBootstrap>;
	getSettings(): Promise<DesktopSettings>;
	updateSettings(draft: DesktopSettingsDraft): Promise<DesktopSettings>;
	listAgents(): Promise<AgentSummary[]>;
	openAgentFromMenuBar(id: string): Promise<void>;
	listBotAvatars(): Promise<BotAvatarOption[]>;
	downloadBotAvatar(id: string): Promise<void>;
	uploadAgentAvatar(id: string, upload: AgentAvatarUpload): Promise<AgentDetails>;
	downloadAgentAvatar(id: string): Promise<void>;
	beginAgentCreation(): Promise<AgentCreationSession>;
	listImportableHarnessProfiles(kind: "openclaw" | "hermes"): Promise<ImportableHarnessProfile[]>;
	checkCodexEnvironment(): Promise<DesktopCodexDiagnostic>;
	installCodex(sessionId: string): Promise<DesktopCodexDiagnostic>;
	openCodexLogin(sessionId: string): Promise<DesktopCodexDiagnostic>;
	checkHermesEnvironment(): Promise<DesktopRuntimeDiagnostic>;
	installHermes(sessionId: string): Promise<DesktopRuntimeDiagnostic>;
	cancelHermesInstall(sessionId: string): Promise<void>;
	getOpenClawModelCatalog(): Promise<DesktopModelCatalog>;
	getManagedRuntimeStatus(kind: DesktopManagedRuntimeKind): Promise<DesktopManagedRuntimeStatus>;
	upgradeManagedRuntime(kind: DesktopManagedRuntimeKind): Promise<DesktopManagedRuntimeStatus>;
	uninstallManagedRuntime(kind: DesktopManagedRuntimeKind): Promise<DesktopManagedRuntimeStatus>;
	createFeishuApp(sessionId: string): Promise<DesktopFeishuAppCredentials>;
	createWechatLogin(sessionId: string): Promise<DesktopWechatCredentials>;
	fetchDiscordBotProfile(sessionId: string, botToken: string): Promise<DesktopDiscordBotProfile>;
	syncFeishuAppProfile(id: string): Promise<AgentDetails>;
	syncDiscordBotProfile(id: string, botToken?: string): Promise<AgentDetails>;
	reauthorizeFeishu(id: string): Promise<AgentDetails>;
	reauthorizeWechat(id: string): Promise<AgentDetails>;
	completeAgentCreation(draft: AgentCreationDraft): Promise<AgentDetails>;
	getAgent(id: string): Promise<AgentDetails>;
	updateAgent(id: string, draft: AgentDraft): Promise<AgentDetails>;
	startAgent(id: string): Promise<AgentDetails>;
	restartAgent(id: string): Promise<AgentDetails>;
	pauseAgent(id: string): Promise<AgentDetails>;
	deleteAgent(id: string): Promise<void>;
	openAgentInEditor(id: string): Promise<void>;
	revealAgentInFinder(id: string): Promise<void>;
	getAgentUsage(id: string): Promise<AgentUsageStats>;
	getAgentResources(id: string): Promise<AgentResourceStats>;
	getAgentModelCatalog(id: string): Promise<DesktopModelCatalog>;
	findReusableProviderCredential(provider: string, excludeAgentId?: string): Promise<ProviderCredentialReuse | undefined>;
	getAgentSkillSources(id: string): Promise<AgentSkillSource[]>;
	openAgentSkillSource(id: string, sourceId: string): Promise<AgentSkillSource[]>;
	openAgentSkillFolder(id: string, sourceId: string, skillName: string): Promise<void>;
	getAgentSystemPrompt(id: string): Promise<AgentSystemPromptSource>;
	openAgentSystemPrompt(id: string): Promise<AgentSystemPromptSource>;
	getAgentLogs(id: string): Promise<AgentLogEntry[]>;
	getAgentEvents(id: string): Promise<AgentEventLogEntry[]>;
	sendAgentChatMessage(id: string, prompt: string, sessionKey?: string, clientMessageId?: string): Promise<AgentChatSendResult>;
	runAgentChatSessionCommand(id: string, command: "new" | "status" | "compact" | "clear", sessionKey?: string): Promise<AgentChatSessionCommandResult>;
	clearAgentChatSession(id: string, sessionKey?: string): Promise<AgentChatClearResult>;
	onAgentChange(callback: (event: AgentChangeEvent) => void): () => void;
	onAgentLog(callback: (entry: AgentLogEntry) => void): () => void;
	onAgentEvent(callback: (entry: AgentEventLogEntry & { agentId: string }) => void): () => void;
	onAgentOnboardEvent(callback: (event: AgentOnboardEvent) => void): () => void;
	onAgentDeleteEvent(callback: (event: AgentDeleteEvent) => void): () => void;
	onDesktopQuitEvent(callback: (event: DesktopQuitEvent) => void): () => void;
	onSelectAgent(callback: (agentId: string) => void): () => void;
}
