import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolve } from "node:path";
import { isRuntimeProcessIdentityCommand } from "./runtime-process.js";

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
});
