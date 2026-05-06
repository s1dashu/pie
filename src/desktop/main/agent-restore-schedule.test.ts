import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getRestoreDelayMs } from "./agent-restore-schedule.js";

describe("getRestoreDelayMs", () => {
	it("only applies stagger delay to lightweight harnesses", () => {
		assert.equal(getRestoreDelayMs({ harnessKind: "pi" }, 0), 0);
		assert.equal(getRestoreDelayMs({ harnessKind: "hermes" }, 2), 1_000);
	});

	it("delays selected OpenClaw restore by a short grace period", () => {
		assert.equal(getRestoreDelayMs({ harnessKind: "openclaw", selected: true }, 0), 4_000);
		assert.equal(getRestoreDelayMs({ harnessKind: "openclaw", selected: true }, 2), 5_000);
	});

	it("delays background OpenClaw restore longer than the selected profile", () => {
		assert.equal(getRestoreDelayMs({ harnessKind: "openclaw", selected: false }, 0), 15_000);
		assert.equal(getRestoreDelayMs({ harnessKind: "openclaw" }, 1), 15_500);
	});
});
