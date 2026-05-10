import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
	isPidRunning,
	readRuntimeProcessRecord,
	writeRuntimeProcessRecord,
} from "../../core/runtime-process.js";
import { stopLiveRuntimeProcessRecord } from "./runtime-process-control.js";

describe("runtime process control", () => {
	let child: ChildProcess | undefined;
	let home: string | undefined;

	afterEach(() => {
		if (child?.pid && isPidRunning(child.pid)) {
			try {
				process.kill(-child.pid, "SIGKILL");
			} catch {
				child.kill("SIGKILL");
			}
		}
		if (home) {
			rmSync(home, { recursive: true, force: true });
		}
		child = undefined;
		home = undefined;
	});

	it("force-kills a live runtime process record and clears the record", async () => {
		home = mkdtempSync(join(tmpdir(), "pie-runtime-process-control-"));
		child = spawn(
			process.execPath,
			[
				"-e",
				"process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000);",
				"/repo/src/runtime/main.ts",
			],
			{
				detached: process.platform !== "win32",
				env: { ...process.env, PIE_AGENT_HOME: home },
				stdio: ["ignore", "pipe", "ignore"],
			},
		);
		assert.ok(child.pid);
		await new Promise<void>((resolve) => child?.stdout?.once("data", () => resolve()));
		writeRuntimeProcessRecord(home, {
			pid: child.pid,
			agentHome: home,
			startedAt: new Date().toISOString(),
			command: [process.execPath, "/repo/src/runtime/main.ts"],
		});

		const result = await stopLiveRuntimeProcessRecord({
			homeDir: home,
			forceKillMs: 50,
			afterSignalMs: 1_000,
		});

		assert.equal(result.record?.pid, child.pid);
		assert.equal(result.forceKilled, true);
		assert.equal(result.stopped, true);
		assert.equal(readRuntimeProcessRecord(home), undefined);
		assert.equal(isPidRunning(child.pid), false);
	});
});
