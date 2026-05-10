import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	getOpenClawCliCandidatePaths,
	resolveNodeCliLaunchCommand,
	resolveOpenClawExecutable,
	resolvePythonCliLaunchCommand,
	stopManagedChildProcess,
} from "./managed-process.js";

function isPidRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

describe("managed process stop", () => {
	it("force-kills a detached child that ignores SIGTERM", async () => {
		const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], {
			detached: process.platform !== "win32",
			stdio: "ignore",
		});
		assert.ok(child.pid);
		await stopManagedChildProcess(child, { forceKillMs: 100 });
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.equal(isPidRunning(child.pid!), false);
	});
});

describe("node cli launch resolution", () => {
	function withElectron<T>(fn: () => T): T {
		const previousElectron = process.versions.electron;
		const previousNpmNodeExecPath = process.env.npm_node_execpath;
		const previousExecPath = process.execPath;
		try {
			(process.versions as NodeJS.ProcessVersions & { electron?: string }).electron = "test";
			return fn();
		} finally {
			const versions = process.versions as NodeJS.ProcessVersions & { electron?: string };
			if (previousElectron === undefined) {
				delete (versions as { electron?: string }).electron;
			} else {
				versions.electron = previousElectron;
			}
			if (previousNpmNodeExecPath === undefined) {
				delete process.env.npm_node_execpath;
			} else {
				process.env.npm_node_execpath = previousNpmNodeExecPath;
			}
			process.execPath = previousExecPath;
		}
	}

	it("runs node shebang CLIs through an explicit node executable in Electron", () => {
		const root = mkdtempSync(join(tmpdir(), "pie-node-cli-"));
		try {
			const cliPath = join(root, "tool");
			writeFileSync(cliPath, "#!/usr/bin/env node\nconsole.log('ok');\n", "utf8");
			process.env.npm_node_execpath = process.execPath;

			const command = withElectron(() => resolveNodeCliLaunchCommand(cliPath));

			assert.equal(command.executablePath, process.execPath);
			assert.deepEqual(command.argsPrefix, [cliPath]);
			assert.equal(command.electronRunAsNode, false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("prefers the node executable from the same prefix as the CLI", () => {
		const root = mkdtempSync(join(tmpdir(), "pie-node-cli-prefix-"));
		try {
			const binDir = join(root, "node-v24", "bin");
			mkdirSync(binDir, { recursive: true });
			const cliPath = join(binDir, "openclaw");
			const siblingNodePath = join(binDir, "node");
			writeFileSync(cliPath, "#!/usr/bin/env node\nconsole.log('ok');\n", "utf8");
			writeFileSync(siblingNodePath, "", "utf8");
			process.env.npm_node_execpath = process.execPath;

			const command = withElectron(() => resolveNodeCliLaunchCommand(cliPath));

			assert.equal(command.executablePath, siblingNodePath);
			assert.deepEqual(command.argsPrefix, [cliPath]);
			assert.equal(command.electronRunAsNode, false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("infers the node executable from an npm global symlink target", () => {
		const root = mkdtempSync(join(tmpdir(), "pie-node-cli-symlink-"));
		try {
			const prefix = join(root, "prefix");
			const binDir = join(prefix, "bin");
			const packageDir = join(prefix, "lib", "node_modules", "openclaw");
			mkdirSync(binDir, { recursive: true });
			mkdirSync(packageDir, { recursive: true });
			const cliTargetPath = join(packageDir, "openclaw.mjs");
			const cliPath = join(binDir, "openclaw");
			const prefixNodePath = join(binDir, "node");
			writeFileSync(cliTargetPath, "#!/usr/bin/env node\nconsole.log('ok');\n", "utf8");
			writeFileSync(prefixNodePath, "", "utf8");
			symlinkSync(cliTargetPath, cliPath);
			process.env.npm_node_execpath = process.execPath;

			const command = withElectron(() => resolveNodeCliLaunchCommand(cliPath));

			assert.equal(command.executablePath, prefixNodePath);
			assert.deepEqual(command.argsPrefix, [cliPath]);
			assert.equal(command.electronRunAsNode, false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("finds install-cli OpenClaw wrappers under OPENCLAW_PREFIX", () => {
		const root = mkdtempSync(join(tmpdir(), "pie-openclaw-prefix-"));
		try {
			const binDir = join(root, "bin");
			mkdirSync(binDir, { recursive: true });
			const cliPath = join(binDir, "openclaw");
			writeFileSync(cliPath, "#!/usr/bin/env node\nconsole.log('ok');\n", "utf8");

			const command = resolveOpenClawExecutable({ ...process.env, OPENCLAW_PREFIX: root, PATH: "" });

			assert.equal(command?.executablePath, cliPath);
			assert.deepEqual(getOpenClawCliCandidatePaths({ OPENCLAW_PREFIX: root }), [cliPath, join(homedir(), ".openclaw", "bin", "openclaw")]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("uses the Node runtime bundled by OpenClaw install-cli", () => {
		const root = mkdtempSync(join(tmpdir(), "pie-openclaw-node-"));
		try {
			const binDir = join(root, "bin");
			const nodeBinDir = join(root, "tools", "node-v22.22.0", "bin");
			mkdirSync(binDir, { recursive: true });
			mkdirSync(nodeBinDir, { recursive: true });
			const cliPath = join(binDir, "openclaw");
			const nodePath = join(nodeBinDir, "node");
			writeFileSync(cliPath, "#!/usr/bin/env node\nconsole.log('ok');\n", "utf8");
			writeFileSync(nodePath, "", "utf8");
			delete process.env.npm_node_execpath;
			const previousOpenClawPrefix = process.env.OPENCLAW_PREFIX;

			const command = withElectron(() => {
				process.execPath = "/Applications/Pie.app/Contents/MacOS/Pie";
				process.env.OPENCLAW_PREFIX = root;
				try {
					const resolvedOpenClaw = resolveOpenClawExecutable();
					assert.ok(resolvedOpenClaw);
					return resolveNodeCliLaunchCommand(resolvedOpenClaw.executablePath, { candidatePaths: getOpenClawCliCandidatePaths() });
				} finally {
					if (previousOpenClawPrefix === undefined) {
						delete process.env.OPENCLAW_PREFIX;
					} else {
						process.env.OPENCLAW_PREFIX = previousOpenClawPrefix;
					}
				}
			});

			assert.equal(command.executablePath, nodePath);
			assert.deepEqual(command.argsPrefix, [cliPath]);
			assert.equal(command.electronRunAsNode, false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("python cli launch resolution", () => {
	it("runs python shebang CLIs through the venv python next to the CLI", () => {
		const root = mkdtempSync(join(tmpdir(), "pie-python-cli-"));
		try {
			const binDir = join(root, "venv", "bin");
			mkdirSync(binDir, { recursive: true });
			const cliPath = join(binDir, "hermes");
			const pythonPath = join(binDir, "python3");
			writeFileSync(cliPath, "#!/usr/bin/env python3\nprint('ok')\n", "utf8");
			writeFileSync(pythonPath, "", "utf8");

			const command = resolvePythonCliLaunchCommand(cliPath);

			assert.equal(realpathSync(command.executablePath), realpathSync(pythonPath));
			assert.deepEqual(command.argsPrefix, [cliPath]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("resolves python CLIs through symlink targets", () => {
		const root = mkdtempSync(join(tmpdir(), "pie-python-cli-symlink-"));
		try {
			const binDir = join(root, "venv", "bin");
			const localBinDir = join(root, "local", "bin");
			mkdirSync(binDir, { recursive: true });
			mkdirSync(localBinDir, { recursive: true });
			const cliTargetPath = join(binDir, "hermes");
			const cliPath = join(localBinDir, "hermes");
			const pythonPath = join(binDir, "python3");
			writeFileSync(cliTargetPath, "#!/usr/bin/env python3\nprint('ok')\n", "utf8");
			writeFileSync(pythonPath, "", "utf8");
			symlinkSync(cliTargetPath, cliPath);

			const command = resolvePythonCliLaunchCommand(cliPath);

			assert.equal(realpathSync(command.executablePath), realpathSync(pythonPath));
			assert.deepEqual(command.argsPrefix, [cliPath]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
