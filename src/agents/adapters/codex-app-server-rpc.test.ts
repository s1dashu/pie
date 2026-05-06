import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
