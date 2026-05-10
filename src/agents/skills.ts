import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentProfile } from "../core/config-store.js";
import { getAgentHarnessDefinition } from "./harness-registry.js";

export type AgentSkillSourceKind = "profile" | "agent-type" | "universal";

export interface ResolvedAgentSkillSource {
	id: string;
	kind: AgentSkillSourceKind;
	label: string;
	description: string;
	path: string;
}

function resolveAgentTypeSkillSources(profile: AgentProfile | undefined, profileHomeDir: string): ResolvedAgentSkillSource[] {
	const kind = profile?.harness.kind ?? "pi";
	try {
		return getAgentHarnessDefinition(kind).skillSources.map((source) => ({
			id: source.id,
			kind: "agent-type" as const,
			label: source.label,
			description: "",
			path: typeof source.path === "function"
				? source.path({ profileHomeDir })
				: source.path,
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
	return dedupeSkillSourcesByPath([
		{
			id: "profile",
			kind: "profile",
			label: `${options.profileLabel?.trim() || "Agent"} Skills`,
			description: "只属于这个 Agent profile 的 Skills。",
			path: join(options.profileHomeDir, "skills"),
		},
		...resolveAgentTypeSkillSources(options.profile, options.profileHomeDir),
		{
			id: "universal",
			kind: "universal",
			label: "通用 Skills",
			description: "",
			path: join(homedir(), ".agents", "skills"),
		},
	]);
}

function dedupeSkillSourcesByPath(sources: ResolvedAgentSkillSource[]): ResolvedAgentSkillSource[] {
	const byPath = new Map<string, ResolvedAgentSkillSource>();
	const order: string[] = [];
	for (const source of sources) {
		const existing = byPath.get(source.path);
		if (!existing) {
			byPath.set(source.path, source);
			order.push(source.path);
			continue;
		}
		if (existing.kind === "profile" && source.kind === "agent-type") {
			byPath.set(source.path, source);
		}
	}
	return order.map((path) => byPath.get(path)!);
}
