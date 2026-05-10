import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { describe, it } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	readLiveRuntimeProcessRecord,
	readRuntimeProcessRecord,
	isRuntimeProcessIdentityCommand,
	writeRuntimeProcessRecord,
	writeRuntimeStateRecord,
} from "./runtime-process.js";

describe("runtime process identity", () => {
	it("accepts Pie runtime commands with matching PIE_AGENT_HOME", () => {
		const home = resolve("/tmp/pie/profiles/alpha");
		assert.equal(
			isRuntimeProcessIdentityCommand(
				`/usr/bin/node /repo/node_modules/tsx/dist/cli.mjs /repo/src/runtime/main.ts PIE_AGENT_HOME=${home}`,
				home,
			),
			true,
		);
		assert.equal(
			isRuntimeProcessIdentityCommand(
				`/usr/bin/node /repo/dist/runtime/main.js PIE_AGENT_HOME=${home}`,
				home,
			),
			true,
		);
	});

	it("rejects pid reuse candidates without matching runtime command and home", () => {
		const home = resolve("/tmp/pie/profiles/alpha");
		assert.equal(isRuntimeProcessIdentityCommand(`/usr/bin/node /repo/src/runtime/main.ts PIE_AGENT_HOME=/tmp/other`, home), false);
		assert.equal(isRuntimeProcessIdentityCommand(`/usr/bin/node /repo/src/something-else.ts PIE_AGENT_HOME=${home}`, home), false);
	});

	it("recovers a live runtime process record from persisted runtime state", async () => {
		const home = mkdtempSync(join(tmpdir(), "pie-runtime-process-"));
		let child: ChildProcess | undefined;
		try {
			const runtimePath = join(home, "repo", "src", "runtime", "main.ts");
			mkdirSync(join(home, "repo", "src", "runtime"), { recursive: true });
			writeFileSync(runtimePath, "setTimeout(() => {}, 60000);\n", "utf8");
			child = spawn(process.execPath, [runtimePath], {
				env: { ...process.env, PIE_AGENT_HOME: home },
				stdio: "ignore",
			});
			assert.ok(child.pid);
			await new Promise((resolveWait) => setTimeout(resolveWait, 100));
			const record = {
				pid: child.pid,
				agentHome: home,
				startedAt: new Date().toISOString(),
				command: [process.execPath],
				gatewayPort: 12345,
			};
			writeRuntimeStateRecord(home, {
				homeDir: home,
				workDir: home,
				lifecycle: { state: "running", updatedAt: new Date().toISOString() },
				process: record,
			});

			const recovered = readLiveRuntimeProcessRecord(home);
			assert.equal(recovered?.pid, child.pid);
			assert.equal(recovered?.gatewayPort, 12345);
			assert.equal(readRuntimeProcessRecord(home)?.pid, child.pid);
		} finally {
			child?.kill("SIGKILL");
			rmSync(home, { recursive: true, force: true });
		}
	});

	it("removes stale runtime process records", () => {
		const home = mkdtempSync(join(tmpdir(), "pie-runtime-process-"));
		try {
			writeRuntimeProcessRecord(home, {
				pid: 0,
				agentHome: home,
				startedAt: new Date().toISOString(),
				command: ["stale"],
			});

			assert.equal(readLiveRuntimeProcessRecord(home), undefined);
			assert.equal(readRuntimeProcessRecord(home), undefined);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
