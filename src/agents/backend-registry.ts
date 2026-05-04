import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentBackendKind } from "../core/config-store.js";
import { resolveAgentFrameworkRuntime, type AgentFrameworkRuntime } from "../core/backend-framework.js";
import { codexCliAgentBackendAdapter } from "./adapters/codex-cli.js";
import { hermesAgentBackendAdapter } from "./adapters/hermes.js";
import { openClawAgentBackendAdapter } from "./adapters/openclaw.js";
import { ousiaAgentBackendAdapter, piAgentBackendAdapter } from "./adapters/pi.js";
import type { AgentBackendManagedServiceManagerFactory } from "./backend-service.js";
import { createHermesServiceProcessManager } from "./backend-services/hermes.js";
import { createOpenClawServiceProcessManager } from "./backend-services/openclaw.js";
import type { AgentBackendAdapter } from "./types.js";

export interface AgentSkillSourceRegistration {
	id: string;
	label: string;
	path: string;
}

export interface AgentBackendDefinition {
	kind: AgentBackendKind;
	label: string;
	adapter: AgentBackendAdapter;
	frameworkRuntime: AgentFrameworkRuntime;
	createManagedServiceManager?: AgentBackendManagedServiceManagerFactory;
	skillSources: AgentSkillSourceRegistration[];
}

function globalSkillSource(id: string, label: string, homeName: string): AgentSkillSourceRegistration {
	return {
		id,
		label,
		path: join(homedir(), homeName, "skills"),
	};
}

const AGENT_BACKEND_DEFINITIONS: Partial<Record<AgentBackendKind, AgentBackendDefinition>> = {
	pi: {
		kind: "pi",
		label: "Pi Coding Agent",
		adapter: piAgentBackendAdapter,
		frameworkRuntime: resolveAgentFrameworkRuntime("pi"),
		skillSources: [globalSkillSource("agent-type", "Pi Agent Skills", ".pi")],
	},
	ousia: {
		kind: "ousia",
		label: "Ousia",
		adapter: ousiaAgentBackendAdapter,
		frameworkRuntime: resolveAgentFrameworkRuntime("ousia"),
		skillSources: [globalSkillSource("agent-type", "Pi Agent Skills", ".pi")],
	},
	codex: {
		kind: "codex",
		label: "Codex",
		adapter: codexCliAgentBackendAdapter,
		frameworkRuntime: resolveAgentFrameworkRuntime("codex"),
		skillSources: [globalSkillSource("agent-type", "Codex Skills", ".codex")],
	},
	hermes: {
		kind: "hermes",
		label: "Hermes",
		adapter: hermesAgentBackendAdapter,
		frameworkRuntime: resolveAgentFrameworkRuntime("hermes"),
		createManagedServiceManager: createHermesServiceProcessManager,
		skillSources: [globalSkillSource("agent-type", "Hermes Skills", ".hermes")],
	},
	openclaw: {
		kind: "openclaw",
		label: "OpenClaw",
		adapter: openClawAgentBackendAdapter,
		frameworkRuntime: resolveAgentFrameworkRuntime("openclaw"),
		createManagedServiceManager: createOpenClawServiceProcessManager,
		skillSources: [globalSkillSource("agent-type", "OpenClaw Skills", ".openclaw")],
	},
};

export function getAgentBackendDefinition(kind: AgentBackendKind): AgentBackendDefinition {
	const definition = AGENT_BACKEND_DEFINITIONS[kind];
	if (!definition) {
		throw new Error(`Agent backend "${kind}" is not supported by this Pie runtime.`);
	}
	return definition;
}

export function getAgentBackendLabel(kind: AgentBackendKind): string {
	return getAgentBackendDefinition(kind).label;
}

export function listAgentBackendDefinitions(): AgentBackendDefinition[] {
	return Object.values(AGENT_BACKEND_DEFINITIONS).filter(Boolean) as AgentBackendDefinition[];
}
