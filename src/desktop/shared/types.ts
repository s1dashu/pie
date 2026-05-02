export type AgentStatus = "running" | "paused" | "terminated";
export type AgentOnboardEventType = "qr" | "status" | "done" | "error";

export interface AgentSummary {
	id: string;
	name: string;
	status: AgentStatus;
	avatarSeed: string;
	avatarUrl?: string;
	enabled: boolean;
	active: boolean;
	home: string;
	createdAt?: string;
	updatedAt?: string;
	modelLabel?: string;
	appId?: string;
}

export interface AgentDetails extends AgentSummary {
	brand?: "feishu" | "lark";
	appSecret?: string;
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
}

export interface DesktopModelOption {
	id: string;
	name?: string;
	provider: string;
}

export interface DesktopModelCatalog {
	models: DesktopModelOption[];
	providers: string[];
}

export interface AgentCreationSession {
	sessionId: string;
	profileId: string;
	name: string;
	home: string;
	models: DesktopModelOption[];
	providers: string[];
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
}

export interface AgentCreationDraft {
	sessionId: string;
	name?: string;
	avatarId?: string;
	feishu: DesktopFeishuAppCredentials;
	provider: string;
	model: string;
	thinkingLevel: DesktopThinkingLevel;
	apiKey?: string;
}

export interface AgentOnboardEvent {
	sessionId: string;
	type: AgentOnboardEventType;
	message?: string;
	url?: string;
	qr?: string;
	expiresIn?: number;
	feishu?: DesktopFeishuAppCredentials;
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
	createFeishuApp(sessionId: string): Promise<DesktopFeishuAppCredentials>;
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
	getAgentSkillSources(id: string): Promise<AgentSkillSource[]>;
	openAgentSkillSource(id: string, sourceId: string): Promise<AgentSkillSource[]>;
	getAgentSystemPrompt(id: string): Promise<AgentSystemPromptSource>;
	openAgentSystemPrompt(id: string): Promise<AgentSystemPromptSource>;
	getAgentLogs(id: string): Promise<AgentLogEntry[]>;
	onAgentLog(callback: (entry: AgentLogEntry) => void): () => void;
	onAgentOnboardEvent(callback: (event: AgentOnboardEvent) => void): () => void;
}
