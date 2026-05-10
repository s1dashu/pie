import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { codexCliAgentHarnessAdapter, extractCodexWebSearchArgs } from "./codex-cli.js";
import { CodexStdioJsonRpcClient } from "./codex-app-server-rpc.js";

describe("CodexStdioJsonRpcClient", () => {
	it("rejects in-flight requests when closed", async () => {
		const client = new CodexStdioJsonRpcClient({
			stdoutLabel: "codex-rpc-test",
			onNotification: () => undefined,
		});
		client.start(process.execPath, ["-e", "process.stdin.resume();"]);
		const request = client.request("test/hang", {});
		client.close();
		await assert.rejects(request, /closed/);
	});
});

describe("Codex adapter session pool", () => {
	it("creates a session without reading constructor options before initialization", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "pie-codex-adapter-"));
		try {
			const pool = codexCliAgentHarnessAdapter.createSessionPool({
				harnessKind: "codex",
				homeDir,
				modelId: "gpt-5.5",
				thinkingLevel: "medium",
				tools: ["coding"],
				debug: false,
				verboseLogs: false,
				resumeSessions: true,
			});
			const session = await pool.getSession("desktop");
			assert.equal(session.capabilities.supportsSessionPersistence, true);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});
});

describe("Codex web search item parsing", () => {
	it("extracts search query from nested Codex app-server item payloads", () => {
		assert.deepEqual(extractCodexWebSearchArgs({
			type: "webSearch",
			query: "",
			action: {
				query: "Hacker News newest",
			},
		}), { query: "Hacker News newest" });

		assert.deepEqual(extractCodexWebSearchArgs({
			type: "webSearch",
			input: JSON.stringify({ query: "OpenAI enterprise AI services" }),
		}), { query: "OpenAI enterprise AI services" });
	});

	it("omits args when the app-server item does not include a query", () => {
		assert.equal(extractCodexWebSearchArgs({ type: "webSearch", query: "" }), undefined);
	});
});
