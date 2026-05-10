import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { checkCodexCliRuntime } from "./codex.js";

describe("Codex CLI runtime diagnostic", () => {
	it("reports an existing CLI as installed even when version probing fails", async () => {
		const root = mkdtempSync(join(tmpdir(), "pie-codex-cli-"));
		try {
			const codexPath = join(root, "codex");
			writeFileSync(codexPath, "#!/bin/sh\necho bad version >&2\nexit 2\n", { encoding: "utf8", mode: 0o755 });

			const diagnostic = await checkCodexCliRuntime(codexPath);

			assert.equal(diagnostic.installed, true);
			assert.equal(diagnostic.ready, false);
			assert.equal(diagnostic.executablePath, codexPath);
			assert.match(diagnostic.error ?? "", /bad version/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
