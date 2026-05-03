export type AgentStatus = "running" | "starting" | "paused" | "terminated";
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
	frameworkKind?: string;
	channelKinds?: string[];
	modelLabel?: string;
	appId?: string;
}

export interface AgentDetails extends AgentSummary {
	brand?: "feishu" | "lark";
	appSecret?: string;
	wechat?: {
		accountId?: string;
		baseUrl?: string;
		botToken?: string;
	};
	slack?: {
		botToken?: string;
		appToken?: string;
		signingSecret?: string;
		teamId?: string;
		appId?: string;
		botUserId?: string;
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
		outputToolCallsToIm?: boolean;
		apiKey?: string;
		apiKeyEnv?: string;
	};
}

export type DesktopThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type DesktopAgentFramework = "ousia" | "pi" | "codex" | "claude-code";
export type DesktopChannelKind = "feishu" | "wechat" | "slack" | "discord" | "telegram";
export type DesktopCodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type DesktopCodexWebSearchMode = "disabled" | "cached" | "live";
export type DesktopLanguage = "zh" | "en";
export type DesktopCloseWindowBehavior = "hide" | "quit";
export type DesktopLogRetention = "7d" | "30d" | "90d" | "forever";

export interface DesktopSettings {
	language: DesktopLanguage;
	closeWindowBehavior: DesktopCloseWindowBehavior;
	quitTerminatesAgents: boolean;
	restoreRunningAgentsOnLaunch: boolean;
	openAtLogin: boolean;
	runtimeLogRetention: DesktopLogRetention;
	usageEventRetention: DesktopLogRetention;
	appearanceGrayHue?: number;
}

export type DesktopSettingsDraft = Partial<
	Pick<
		DesktopSettings,
		| "language"
		| "closeWindowBehavior"
		| "quitTerminatesAgents"
		| "restoreRunningAgentsOnLaunch"
		| "openAtLogin"
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
	outputToolCallsToIm?: boolean;
	apiKey?: string;
	appId?: string;
	appSecret?: string;
	brand?: "feishu" | "lark";
	wechatAccountId?: string;
	wechatBaseUrl?: string;
	wechatBotToken?: string;
	slackBotToken?: string;
	slackAppToken?: string;
	slackSigningSecret?: string;
	slackTeamId?: string;
	slackAppId?: string;
	slackBotUserId?: string;
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

export interface DesktopModelCatalog {
	models: DesktopModelOption[];
	providers: string[];
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

export interface AgentCreationDraft {
	sessionId: string;
	framework: DesktopAgentFramework;
	name?: string;
	avatarId?: string;
	channels: DesktopChannelKind[];
	feishu?: DesktopFeishuAppCredentials;
	wechat?: DesktopWechatCredentials;
	slack?: {
		botToken: string;
		appToken: string;
		signingSecret?: string;
		teamId?: string;
		appId?: string;
		botUserId?: string;
	};
	discord?: {
		botToken: string;
		applicationId?: string;
		guildId?: string;
	};
	telegram?: {
		botToken: string;
		botUsername?: string;
	};
	provider: string;
	model: string;
	thinkingLevel: DesktopThinkingLevel;
	apiKey?: string;
	codexSandboxMode?: DesktopCodexSandboxMode;
	codexWebSearchMode?: DesktopCodexWebSearchMode;
}

export interface AgentOnboardEvent {
	sessionId: string;
	type: AgentOnboardEventType;
	source?: "codex-login" | "feishu" | "wechat";
	message?: string;
	url?: string;
	qr?: string;
	expiresIn?: number;
	feishu?: DesktopFeishuAppCredentials;
	wechat?: DesktopWechatCredentials;
}

export interface AgentDeleteEvent {
	agentId: string;
	step: AgentDeleteEventStep;
	message: string;
}

export interface AgentLogEntry {
	id: number;
	agentId: string;
	stream: "stdout" | "stderr" | "system";
	text: string;
	timestamp: string;
	updated?: boolean;
}

export interface UsageBucket {
	incomingMessages: number;
	outgoingMessages: number;
	actions: number;
	failedActions: number;
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

export interface PieDesktopApi {
	getSettings(): Promise<DesktopSettings>;
	updateSettings(draft: DesktopSettingsDraft): Promise<DesktopSettings>;
	listAgents(): Promise<AgentSummary[]>;
	listBotAvatars(): Promise<BotAvatarOption[]>;
	downloadBotAvatar(id: string): Promise<void>;
	uploadAgentAvatar(id: string, upload: AgentAvatarUpload): Promise<AgentDetails>;
	downloadAgentAvatar(id: string): Promise<void>;
	beginAgentCreation(): Promise<AgentCreationSession>;
	checkCodexEnvironment(): Promise<DesktopCodexDiagnostic>;
	openCodexLogin(sessionId: string): Promise<DesktopCodexDiagnostic>;
	createFeishuApp(sessionId: string): Promise<DesktopFeishuAppCredentials>;
	createWechatLogin(sessionId: string): Promise<DesktopWechatCredentials>;
	syncFeishuAppProfile(id: string): Promise<AgentDetails>;
	reauthorizeWechat(id: string): Promise<AgentDetails>;
	completeAgentCreation(draft: AgentCreationDraft): Promise<AgentDetails>;
	getAgent(id: string): Promise<AgentDetails>;
	updateAgent(id: string, draft: AgentDraft): Promise<AgentDetails>;
	startAgent(id: string): Promise<AgentDetails>;
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
	onAgentLog(callback: (entry: AgentLogEntry) => void): () => void;
	onAgentOnboardEvent(callback: (event: AgentOnboardEvent) => void): () => void;
	onAgentDeleteEvent(callback: (event: AgentDeleteEvent) => void): () => void;
}
