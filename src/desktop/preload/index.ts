import { contextBridge, ipcRenderer } from "electron";
import type {
	AgentAvatarUpload,
	AgentChangeEvent,
	AgentCreationDraft,
	AgentDeleteEvent,
	AgentDraft,
	AgentLogEntry,
	AgentOnboardEvent,
	DesktopQuitEvent,
	DesktopSettingsDraft,
	PieDesktopApi,
} from "../shared/types.js";

const api: PieDesktopApi = {
	getDesktopBootstrap: () => ipcRenderer.invoke("desktop:bootstrap"),
	getSettings: () => ipcRenderer.invoke("settings:get"),
	updateSettings: (draft: DesktopSettingsDraft) => ipcRenderer.invoke("settings:update", draft),
	listAgents: () => ipcRenderer.invoke("agents:list"),
	openAgentFromMenuBar: (id: string) => ipcRenderer.invoke("menu-bar:open-agent", id),
	listBotAvatars: () => ipcRenderer.invoke("bot-avatars:list"),
	downloadBotAvatar: (id: string) => ipcRenderer.invoke("bot-avatars:download", id),
	uploadAgentAvatar: (id: string, upload: AgentAvatarUpload) => ipcRenderer.invoke("agents:avatar-upload", id, upload),
	downloadAgentAvatar: (id: string) => ipcRenderer.invoke("agents:avatar-download", id),
	beginAgentCreation: () => ipcRenderer.invoke("agents:create-begin"),
	checkCodexEnvironment: () => ipcRenderer.invoke("agents:codex-diagnostic"),
	installCodex: (sessionId: string) => ipcRenderer.invoke("agents:codex-install", sessionId),
	openCodexLogin: (sessionId: string) => ipcRenderer.invoke("agents:codex-login", sessionId),
	checkHermesEnvironment: () => ipcRenderer.invoke("agents:hermes-diagnostic"),
	installHermes: (sessionId: string) => ipcRenderer.invoke("agents:hermes-install", sessionId),
	cancelHermesInstall: (sessionId: string) => ipcRenderer.invoke("agents:hermes-install-cancel", sessionId),
	getOpenClawModelCatalog: () => ipcRenderer.invoke("agents:openclaw-model-catalog"),
	getManagedRuntimeStatus: (kind) => ipcRenderer.invoke("runtimes:status", kind),
	upgradeManagedRuntime: (kind) => ipcRenderer.invoke("runtimes:upgrade", kind),
	uninstallManagedRuntime: (kind) => ipcRenderer.invoke("runtimes:uninstall", kind),
	createFeishuApp: (sessionId: string) => ipcRenderer.invoke("agents:create-feishu-app", sessionId),
	createWechatLogin: (sessionId: string) => ipcRenderer.invoke("agents:create-wechat-login", sessionId),
	fetchDiscordBotProfile: (sessionId: string, botToken: string) => ipcRenderer.invoke("agents:create-discord-profile", sessionId, botToken),
	syncFeishuAppProfile: (id: string) => ipcRenderer.invoke("agents:sync-feishu-app-profile", id),
	syncDiscordBotProfile: (id: string, botToken?: string) => ipcRenderer.invoke("agents:sync-discord-bot-profile", id, botToken),
	reauthorizeFeishu: (id: string) => ipcRenderer.invoke("agents:reauthorize-feishu", id),
	reauthorizeWechat: (id: string) => ipcRenderer.invoke("agents:reauthorize-wechat", id),
	completeAgentCreation: (draft: AgentCreationDraft) => ipcRenderer.invoke("agents:create-complete", draft),
	getAgent: (id: string) => ipcRenderer.invoke("agents:get", id),
	updateAgent: (id: string, draft: AgentDraft) => ipcRenderer.invoke("agents:update", id, draft),
	startAgent: (id: string) => ipcRenderer.invoke("agents:start", id),
	restartAgent: (id: string) => ipcRenderer.invoke("agents:restart", id),
	pauseAgent: (id: string) => ipcRenderer.invoke("agents:pause", id),
	deleteAgent: (id: string) => ipcRenderer.invoke("agents:delete", id),
	openAgentInEditor: (id: string) => ipcRenderer.invoke("agents:open-editor", id),
	revealAgentInFinder: (id: string) => ipcRenderer.invoke("agents:reveal-finder", id),
	getAgentUsage: (id: string) => ipcRenderer.invoke("agents:usage", id),
	getAgentResources: (id: string) => ipcRenderer.invoke("agents:resources", id),
	getAgentModelCatalog: (id: string) => ipcRenderer.invoke("agents:model-catalog", id),
	findReusableProviderCredential: (provider: string, excludeAgentId?: string) =>
		ipcRenderer.invoke("agents:provider-credential-reuse", provider, excludeAgentId),
	getAgentSkillSources: (id: string) => ipcRenderer.invoke("agents:skill-sources", id),
	openAgentSkillSource: (id: string, sourceId: string) => ipcRenderer.invoke("agents:skill-source-open", id, sourceId),
	openAgentSkillFolder: (id: string, sourceId: string, skillName: string) => ipcRenderer.invoke("agents:skill-folder-open", id, sourceId, skillName),
	getAgentSystemPrompt: (id: string) => ipcRenderer.invoke("agents:system-prompt", id),
	openAgentSystemPrompt: (id: string) => ipcRenderer.invoke("agents:system-prompt-open", id),
	getAgentLogs: (id: string) => ipcRenderer.invoke("agents:logs", id),
	onAgentChange: (callback: (event: AgentChangeEvent) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, payload: AgentChangeEvent) => callback(payload);
		ipcRenderer.on("agents:change", listener);
		return () => ipcRenderer.removeListener("agents:change", listener);
	},
	onAgentLog: (callback: (entry: AgentLogEntry) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, payload: AgentLogEntry) => callback(payload);
		ipcRenderer.on("agents:log", listener);
		return () => ipcRenderer.removeListener("agents:log", listener);
	},
	onAgentOnboardEvent: (callback: (event: AgentOnboardEvent) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, payload: AgentOnboardEvent) => callback(payload);
		ipcRenderer.on("agents:onboard-event", listener);
		return () => ipcRenderer.removeListener("agents:onboard-event", listener);
	},
	onAgentDeleteEvent: (callback: (event: AgentDeleteEvent) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, payload: AgentDeleteEvent) => callback(payload);
		ipcRenderer.on("agents:delete-event", listener);
		return () => ipcRenderer.removeListener("agents:delete-event", listener);
	},
	onDesktopQuitEvent: (callback: (event: DesktopQuitEvent) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, payload: DesktopQuitEvent) => callback(payload);
		ipcRenderer.on("desktop:quit-event", listener);
		return () => ipcRenderer.removeListener("desktop:quit-event", listener);
	},
	onSelectAgent: (callback: (agentId: string) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, payload: string) => callback(payload);
		ipcRenderer.on("agents:select", listener);
		return () => ipcRenderer.removeListener("agents:select", listener);
	},
};

contextBridge.exposeInMainWorld("pie", api);
