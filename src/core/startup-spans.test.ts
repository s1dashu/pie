import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendStartupSpan } from "./startup-spans.js";

describe("appendStartupSpan", () => {
	it("appends startup span events under the profile runtime directory", () => {
		const homeDir = mkdtempSync(join(tmpdir(), "pie-startup-spans-"));
		try {
			appendStartupSpan(homeDir, {
				name: "runtime_starting",
				harnessKind: "openclaw",
				elapsedMs: 12,
				meta: { background: true },
				timestamp: "2026-05-06T00:00:00.000Z",
			});
			const [line] = readFileSync(join(homeDir, "runtime", "startup-spans.jsonl"), "utf8").trim().split(/\r?\n/);
			assert.deepEqual(JSON.parse(line!), {
				timestamp: "2026-05-06T00:00:00.000Z",
				name: "runtime_starting",
				harnessKind: "openclaw",
				elapsedMs: 12,
				meta: { background: true },
			});
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});
});
