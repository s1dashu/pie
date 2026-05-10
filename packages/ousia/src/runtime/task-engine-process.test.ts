import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveTsxNodeArgs } from "./task-engine-process.js";

describe("resolveTsxNodeArgs", () => {
	it("preserves tsx loader flags when inheriting execArgv", () => {
		const execArgv = [
			"--require",
			"/repo/node_modules/tsx/dist/preflight.cjs",
			"--import",
			"file:///repo/node_modules/tsx/dist/loader.mjs",
		];

		assert.deepEqual(resolveTsxNodeArgs("/repo/packages/ousia/src/runtime/task-engine-process.ts", execArgv), execArgv);
	});
});
