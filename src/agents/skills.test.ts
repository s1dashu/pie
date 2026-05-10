import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createAgentProfile } from "../core/config-store.js";
import { resolveSkillSources } from "./skills.js";

describe("resolveSkillSources", () => {
	it("maps Ousia harness skills to the Ousia profile home instead of Pi global skills", () => {
		const profileHomeDir = "/tmp/pie-ousia-profile";
		const sources = resolveSkillSources({
			profile: createAgentProfile({ harness: { kind: "ousia" } }),
			profileHomeDir,
			profileLabel: "Mia",
		});

		assert.equal(sources.filter((source) => source.path === join(profileHomeDir, "skills")).length, 1);
		assert.deepEqual(
			sources.map((source) => ({ kind: source.kind, label: source.label, path: source.path })),
			[
				{ kind: "agent-type", label: "Ousia Skills", path: join(profileHomeDir, "skills") },
				{ kind: "universal", label: "通用 Skills", path: join(homedir(), ".agents", "skills") },
			],
		);
		assert.equal(sources.some((source) => source.label === "Pi Agent Skills"), false);
	});
});
