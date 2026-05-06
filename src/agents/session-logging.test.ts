import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { attachAgentSessionLogging } from "./session-logging.js";
import type { AgentConversationSession, AgentSessionCapabilities, AgentSessionEvent } from "./types.js";

const capabilities: AgentSessionCapabilities = {
	supportsSteering: false,
	supportsInterrupt: true,
	supportsStreamingEvents: true,
	supportsSessionPersistence: true,
	supportsToolEvents: true,
};

class FakeSession implements AgentConversationSession {
	readonly isStreaming = true;
	readonly capabilities = capabilities;
	private listener: ((event: AgentSessionEvent) => void) | undefined;

	async prompt(): Promise<void> {}
	async abort(): Promise<void> {}
	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		this.listener = listener;
		return () => {
			this.listener = undefined;
		};
	}
	emit(event: AgentSessionEvent): void {
		this.listener?.(event);
	}
}

describe("attachAgentSessionLogging", () => {
	it("logs the missing suffix from text_finished when streaming only emitted a prefix", () => {
		const homeDir = mkdtempSync(join(tmpdir(), "pie-session-logging-"));
		const session = new FakeSession();
		const logs: string[] = [];
		const originalLog = console.log;
		try {
			console.log = (message?: unknown) => {
				logs.push(String(message ?? ""));
			};
			attachAgentSessionLogging(session, homeDir);
			session.emit({ type: "turn_started", roundId: "round", turnId: "turn", index: 1 });
			session.emit({ type: "text_delta", roundId: "round", turnId: "turn", textId: "text", delta: "动态" });
			session.emit({ type: "text_finished", roundId: "round", turnId: "turn", textId: "text", text: "动态清零，静态挨饿。⚖️" });

			assert.deepEqual(
				logs.map((line) => line.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")),
				["Agent: 动态", "Agent: 清零，静态挨饿。⚖️"],
			);
		} finally {
			console.log = originalLog;
			rmSync(homeDir, { recursive: true, force: true });
		}
	});
});
