import { contextBridge, ipcRenderer } from "electron";
import type { AgentAvatarUpload, AgentCreationDraft, AgentDeleteEvent, AgentDraft, AgentLogEntry, AgentOnboardEvent, DesktopSettingsDraft, PieDesktopApi } from "../shared/types.js";

const api: PieDesktopApi = {
	getSettings: () => ipcRenderer.invoke("settings:get"),
	updateSettings: (draft: DesktopSettingsDraft) => ipcRenderer.invoke("settings:update", draft),
	listAgents: () => ipcRenderer.invoke("agents:list"),
	listBotAvatars: () => ipcRenderer.invoke("bot-avatars:list"),
	downloadBotAvatar: (id: string) => ipcRenderer.invoke("bot-avatars:download", id),
	uploadAgentAvatar: (id: string, upload: AgentAvatarUpload) => ipcRenderer.invoke("agents:avatar-upload", id, upload),
	downloadAgentAvatar: (id: string) => ipcRenderer.invoke("agents:avatar-download", id),
	beginAgentCreation: () => ipcRenderer.invoke("agents:create-begin"),
	createFeishuApp: (sessionId: string) => ipcRenderer.invoke("agents:create-feishu-app", sessionId),
	createWechatLogin: (sessionId: string) => ipcRenderer.invoke("agents:create-wechat-login", sessionId),
	completeAgentCreation: (draft: AgentCreationDraft) => ipcRenderer.invoke("agents:create-complete", draft),
	getAgent: (id: string) => ipcRenderer.invoke("agents:get", id),
	updateAgent: (id: string, draft: AgentDraft) => ipcRenderer.invoke("agents:update", id, draft),
	startAgent: (id: string) => ipcRenderer.invoke("agents:start", id),
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
	getAgentSystemPrompt: (id: string) => ipcRenderer.invoke("agents:system-prompt", id),
	openAgentSystemPrompt: (id: string) => ipcRenderer.invoke("agents:system-prompt-open", id),
	getAgentLogs: (id: string) => ipcRenderer.invoke("agents:logs", id),
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
};

contextBridge.exposeInMainWorld("pie", api);
