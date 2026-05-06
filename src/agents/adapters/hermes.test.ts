import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createAgentSessionPool } from "../session-runtime.js";
import { readAgentUsageEvents, summarizeAgentUsage } from "../../core/usage-stats.js";
import type { AgentSessionRuntimeOptions } from "../types.js";

function sendJson(response: ServerResponse, value: unknown): void {
	response.writeHead(200, { "content-type": "application/json" });
	response.end(JSON.stringify(value));
}

function sendSse(response: ServerResponse, events: unknown[]): void {
	response.writeHead(200, { "content-type": "text/event-stream" });
	for (const event of events) {
		response.write(`data: ${JSON.stringify(event)}\n\n`);
	}
	response.end();
}

function createHermesOptions(homeDir: string, endpoint: string): AgentSessionRuntimeOptions {
	return {
		harnessKind: "hermes",
		harnessConfig: { endpoint },
		homeDir,
		modelId: "hermes-agent",
		thinkingLevel: "medium",
		tools: [],
		debug: false,
		verboseLogs: false,
		resumeSessions: true,
	};
}

describe("Hermes adapter usage reporting", () => {
	const tempDirs: string[] = [];

	after(() => {
		for (const dir of tempDirs) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("records actual token usage from run completed events", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "pie-hermes-usage-"));
		tempDirs.push(homeDir);

		const server = createServer((request: IncomingMessage, response: ServerResponse) => {
			if (request.method === "POST" && request.url === "/v1/runs") {
				sendJson(response, { run_id: "run-1", status: "running" });
				return;
			}
			if (request.method === "GET" && request.url === "/v1/runs/run-1/events") {
				sendSse(response, [
					{ event: "message.delta", delta: "hello" },
					{
						event: "run.completed",
						output: "hello",
						usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
					},
				]);
				return;
			}
			response.writeHead(404);
			response.end();
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address();
			assert(address && typeof address === "object");
			const pool = createAgentSessionPool(createHermesOptions(homeDir, `http://127.0.0.1:${address.port}`));
			const session = await pool.getSession("conversation");

			await session.prompt("hi");

			const usage = summarizeAgentUsage(readAgentUsageEvents(homeDir));
			assert.equal(usage.tokenUsageSource, "actual");
			assert.equal(usage.total.tokens, 14);
			assert.equal(usage.total.inputTokens, 10);
			assert.equal(usage.total.outputTokens, 4);
		} finally {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			});
		}
	});
});
