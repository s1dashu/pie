import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldRunIdleCompact } from "./session-runtime.js";
import type { AgentSessionRuntimeOptions } from "./types.js";

function createOptions(harnessKind: AgentSessionRuntimeOptions["harnessKind"]): AgentSessionRuntimeOptions {
	return {
		harnessKind,
		homeDir: "/tmp/pie-agent",
		thinkingLevel: "medium",
		tools: [],
		debug: false,
		verboseLogs: false,
		resumeSessions: true,
	};
}

describe("shouldRunIdleCompact", () => {
	it("enables idle compaction for Pi and Ousia session-backed harnesses", () => {
		assert.equal(shouldRunIdleCompact(createOptions("pi")), true);
		assert.equal(shouldRunIdleCompact(createOptions("ousia")), true);
	});

	it("does not enable idle compaction for external runtime harnesses", () => {
		assert.equal(shouldRunIdleCompact(createOptions("codex")), false);
		assert.equal(shouldRunIdleCompact(createOptions("hermes")), false);
		assert.equal(shouldRunIdleCompact(createOptions("openclaw")), false);
	});

	it("honors the global idle compaction kill switch", () => {
		const original = process.env.PIE_DISABLE_IDLE_COMPACT;
		try {
			process.env.PIE_DISABLE_IDLE_COMPACT = "1";
			assert.equal(shouldRunIdleCompact(createOptions("ousia")), false);
		} finally {
			if (original === undefined) {
				delete process.env.PIE_DISABLE_IDLE_COMPACT;
			} else {
				process.env.PIE_DISABLE_IDLE_COMPACT = original;
			}
		}
	});
});
