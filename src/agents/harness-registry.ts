import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentHarnessKind } from "../core/config-store.js";
import type { HarnessLifecycleHooks } from "../core/agent-harness.js";
import { OUSIA_LIFECYCLE_HOOKS } from "../frameworks/ousia/harness.js";
import { codexCliAgentHarnessAdapter } from "./adapters/codex-cli.js";
import { hermesAgentHarnessAdapter } from "./adapters/hermes.js";
import { openClawAgentHarnessAdapter } from "./adapters/openclaw.js";
import { ousiaAgentHarnessAdapter, piAgentHarnessAdapter } from "./adapters/pi.js";
import type { AgentHarnessManagedServiceManagerFactory } from "./harness-service.js";
import { createHermesServiceProcessManager } from "./harness-services/hermes.js";
import { createOpenClawServiceProcessManager } from "./harness-services/openclaw.js";
import type { AgentHarnessAdapter } from "./types.js";

export interface AgentSkillSourceRegistration {
	id: string;
	label: string;
	path: string;
}

export interface AgentHarnessDefinition {
	kind: AgentHarnessKind;
	label: string;
	adapter: AgentHarnessAdapter;
	lifecycleHooks?: HarnessLifecycleHooks & {
		createManagedServiceManager?: AgentHarnessManagedServiceManagerFactory;
	};
	skillSources: AgentSkillSourceRegistration[];
}

function globalSkillSource(id: string, label: string, homeName: string): AgentSkillSourceRegistration {
	return {
		id,
		label,
		path: join(homedir(), homeName, "skills"),
	};
}

const AGENT_HARNESS_DEFINITIONS: Partial<Record<AgentHarnessKind, AgentHarnessDefinition>> = {
	pi: {
		kind: "pi",
		label: "Pi Coding Agent",
		adapter: piAgentHarnessAdapter,
		skillSources: [globalSkillSource("agent-type", "Pi Agent Skills", ".pi")],
	},
	ousia: {
		kind: "ousia",
		label: "Ousia",
		adapter: ousiaAgentHarnessAdapter,
		lifecycleHooks: OUSIA_LIFECYCLE_HOOKS,
		skillSources: [globalSkillSource("agent-type", "Pi Agent Skills", ".pi")],
	},
	codex: {
		kind: "codex",
		label: "Codex",
		adapter: codexCliAgentHarnessAdapter,
		skillSources: [globalSkillSource("agent-type", "Codex Skills", ".codex")],
	},
	hermes: {
		kind: "hermes",
		label: "Hermes",
		adapter: hermesAgentHarnessAdapter,
		lifecycleHooks: {
			createManagedServiceManager: createHermesServiceProcessManager,
		},
		skillSources: [globalSkillSource("agent-type", "Hermes Skills", ".hermes")],
	},
	openclaw: {
		kind: "openclaw",
		label: "OpenClaw",
		adapter: openClawAgentHarnessAdapter,
		lifecycleHooks: {
			createManagedServiceManager: createOpenClawServiceProcessManager,
		},
		skillSources: [globalSkillSource("agent-type", "OpenClaw Skills", ".openclaw")],
	},
};

export function getAgentHarnessDefinition(kind: AgentHarnessKind): AgentHarnessDefinition {
	const definition = AGENT_HARNESS_DEFINITIONS[kind];
	if (!definition) {
		throw new Error(`Agent harness "${kind}" is not supported by this Pie runtime.`);
	}
	return definition;
}

export function getAgentHarnessLabel(kind: AgentHarnessKind): string {
	return getAgentHarnessDefinition(kind).label;
}

export function listAgentHarnessDefinitions(): AgentHarnessDefinition[] {
	return Object.values(AGENT_HARNESS_DEFINITIONS).filter(Boolean) as AgentHarnessDefinition[];
}
