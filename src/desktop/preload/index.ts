import { contextBridge, ipcRenderer } from "electron";
import type { AgentCreationDraft, AgentDraft, AgentLogEntry, AgentOnboardEvent, PieDesktopApi } from "../shared/types.js";

const api: PieDesktopApi = {
	listAgents: () => ipcRenderer.invoke("agents:list"),
	beginAgentCreation: () => ipcRenderer.invoke("agents:create-begin"),
	createFeishuApp: (sessionId: string) => ipcRenderer.invoke("agents:create-feishu-app", sessionId),
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
	getAgentSkillSources: (id: string) => ipcRenderer.invoke("agents:skill-sources", id),
	openAgentSkillSource: (id: string, sourceId: string) => ipcRenderer.invoke("agents:skill-source-open", id, sourceId),
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
};

contextBridge.exposeInMainWorld("pie", api);
