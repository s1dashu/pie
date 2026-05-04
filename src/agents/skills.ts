import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentProfile } from "../core/config-store.js";
import { getAgentBackendDefinition } from "./backend-registry.js";

export type AgentSkillSourceKind = "profile" | "agent-type" | "universal";

export interface ResolvedAgentSkillSource {
	id: string;
	kind: AgentSkillSourceKind;
	label: string;
	description: string;
	path: string;
}

function resolveAgentTypeSkillSources(profile: AgentProfile | undefined): ResolvedAgentSkillSource[] {
	const kind = profile?.backend.kind ?? "pi";
	try {
		return getAgentBackendDefinition(kind).skillSources.map((source) => ({
			id: source.id,
			kind: "agent-type" as const,
			label: source.label,
			description: "",
			path: source.path,
		}));
	} catch {
		return [{
			id: "agent-type",
			kind: "agent-type",
			label: `${kind} 共享 Skills`,
			description: "",
			path: join(homedir(), `.${kind}`, "skills"),
		}];
	}
}

export function resolveSkillSources(options: {
	profile: AgentProfile | undefined;
	profileHomeDir: string;
	profileLabel?: string;
}): ResolvedAgentSkillSource[] {
	return [
		{
			id: "profile",
			kind: "profile",
			label: `${options.profileLabel?.trim() || "Agent"} Skills`,
			description: "只属于这个 Agent profile 的 Skills。",
			path: join(options.profileHomeDir, "skills"),
		},
		...resolveAgentTypeSkillSources(options.profile),
		{
			id: "universal",
			kind: "universal",
			label: "通用 Skills",
			description: "",
			path: join(homedir(), ".agents", "skills"),
		},
	];
}
