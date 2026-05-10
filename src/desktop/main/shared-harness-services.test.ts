import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { getOpenClawAgentIdForPieProfile } from "../../agents/openclaw-models.js";
import { createAgentProfile, loadConfigStore, saveConfigStore } from "../../core/config-store.js";
import { readHarnessServiceState } from "../../core/harness-service-state.js";
import { SharedHarnessServiceRegistry } from "./shared-harness-services.js";

describe("SharedHarnessServiceRegistry", () => {
	it("provisions multiple Pie OpenClaw profiles onto one shared gateway service", async () => {
		const root = mkdtempSync(join(tmpdir(), "pie-shared-openclaw-"));
		let startCount = 0;
		let stopCount = 0;
		const openClawStateDir = join(root, "official-openclaw");
		const registry = new SharedHarnessServiceRegistry({
			rootDir: root,
			openClawGatewayUrl: "ws://127.0.0.1:18789",
			openClawStateDir,
			createOpenClawManager: () => ({
				start: async () => {
					startCount += 1;
				},
				stop: () => {
					stopCount += 1;
				},
			}),
		});
		try {
			const firstHome = join(root, "profiles", "alpha");
			const secondHome = join(root, "profiles", "beta");
			saveConfigStore({
				version: 3,
				profile: createAgentProfile({
					harness: {
						kind: "openclaw",
						model: { provider: "kimi-coding", model: "k2p5" },
						config: {},
					},
					runtime: { workDir: join(root, "workspaces", "alpha") },
				}),
			}, firstHome);
			saveConfigStore({
				version: 3,
				profile: createAgentProfile({
					harness: {
						kind: "openclaw",
						model: { provider: "kimi-coding", model: "k2p5" },
						config: {},
					},
					runtime: { workDir: join(root, "workspaces", "beta") },
				}),
			}, secondHome);

			await registry.ensureForProfile({ id: "alpha", home: firstHome, harnessKind: "openclaw" });
			await registry.ensureForProfile({ id: "beta", home: secondHome, harnessKind: "openclaw" });

			assert.equal(startCount, 1);
			const firstProfile = loadConfigStore(firstHome).profile!;
			const secondProfile = loadConfigStore(secondHome).profile!;
			assert.equal(firstProfile.harness.config?.gatewayUrl, "ws://127.0.0.1:18789");
			assert.equal(secondProfile.harness.config?.gatewayUrl, "ws://127.0.0.1:18789");
			assert.equal(firstProfile.harness.config?.agentId, getOpenClawAgentIdForPieProfile("alpha"));
			assert.equal(secondProfile.harness.config?.agentId, getOpenClawAgentIdForPieProfile("beta"));
			assert.equal(firstProfile.harness.config?.managed, false);
			assert.equal(secondProfile.harness.config?.managed, false);

			const state = readHarnessServiceState(root, "openclaw");
			assert.equal(state?.lifecycle.state, "running");
			assert.equal(state?.endpoint, "ws://127.0.0.1:18789");
			const openClawConfig = JSON.parse(
				readFileSync(join(openClawStateDir, "openclaw.json"), "utf8"),
			) as { agents?: { list?: Array<Record<string, unknown>> } };
			const agents = openClawConfig.agents?.list ?? [];
			assert.equal(agents.find((agent) => agent.id === firstProfile.harness.config?.agentId)?.workspace, join(root, "workspaces", "alpha"));
			assert.equal(agents.find((agent) => agent.id === secondProfile.harness.config?.agentId)?.workspace, join(root, "workspaces", "beta"));

			await registry.stopAll();
			assert.equal(stopCount, 1);
			assert.equal(readHarnessServiceState(root, "openclaw")?.lifecycle.state, "stopped");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("deduplicates concurrent starts for the same shared OpenClaw service", async () => {
		const root = mkdtempSync(join(tmpdir(), "pie-shared-openclaw-concurrent-"));
		let startCount = 0;
		const openClawStateDir = join(root, "official-openclaw");
		let releaseStart: (() => void) | undefined;
		const startBarrier = new Promise<void>((resolve) => {
			releaseStart = resolve;
		});
		const registry = new SharedHarnessServiceRegistry({
			rootDir: root,
			openClawStateDir,
			createOpenClawManager: () => ({
				start: async () => {
					startCount += 1;
					await startBarrier;
				},
				stop: () => {},
			}),
		});
		try {
			const firstHome = join(root, "profiles", "alpha");
			const secondHome = join(root, "profiles", "beta");
			saveConfigStore({
				version: 3,
				profile: createAgentProfile({
					harness: { kind: "openclaw", config: {} },
					runtime: { workDir: join(root, "workspaces", "alpha") },
				}),
			}, firstHome);
			saveConfigStore({
				version: 3,
				profile: createAgentProfile({
					harness: { kind: "openclaw", config: {} },
					runtime: { workDir: join(root, "workspaces", "beta") },
				}),
			}, secondHome);

			const first = registry.ensureForProfile({ id: "alpha", home: firstHome, harnessKind: "openclaw" });
			const second = registry.ensureForProfile({ id: "beta", home: secondHome, harnessKind: "openclaw" });
			await new Promise((resolve) => setImmediate(resolve));
			assert.equal(startCount, 1);
			releaseStart?.();
			await Promise.all([first, second]);
			assert.equal(startCount, 1);
			assert.equal(readHarnessServiceState(root, "openclaw")?.lifecycle.state, "running");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("preserves imported official OpenClaw agent ids", async () => {
		const root = mkdtempSync(join(tmpdir(), "pie-shared-openclaw-import-"));
		const openClawStateDir = join(root, "official-openclaw");
		const registry = new SharedHarnessServiceRegistry({
			rootDir: root,
			openClawGatewayUrl: "ws://127.0.0.1:18789",
			openClawStateDir,
			createOpenClawManager: () => ({
				start: async () => {},
				stop: () => {},
			}),
		});
		try {
			const home = join(root, "profiles", "alpha");
			saveConfigStore({
				version: 3,
				profile: createAgentProfile({
					harness: {
						kind: "openclaw",
						model: { provider: "kimi-coding", model: "k2p5" },
						config: {
							agentId: "official-agent",
							importedAgent: true,
							importedProfileId: "official-agent",
							modelRef: "kimi-coding/k2p5",
						},
					},
					runtime: { workDir: join(root, "workspaces", "alpha") },
				}),
			}, home);

			await registry.ensureForProfile({ id: "alpha", home, harnessKind: "openclaw" });

			const profile = loadConfigStore(home).profile!;
			assert.equal(profile.harness.config?.agentId, "official-agent");
			assert.equal(profile.harness.config?.importedAgent, true);
			assert.equal(profile.harness.config?.managed, false);
			assert.equal(existsSync(join(openClawStateDir, "openclaw.json")), false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("does not start a shared service for non-OpenClaw profiles", async () => {
		const root = mkdtempSync(join(tmpdir(), "pie-shared-openclaw-ignore-"));
		let startCount = 0;
		const registry = new SharedHarnessServiceRegistry({
			rootDir: root,
			createOpenClawManager: () => ({
				start: async () => {
					startCount += 1;
				},
				stop: () => {},
			}),
		});
		try {
			const home = join(root, "profiles", "hermes");
			saveConfigStore({
				version: 3,
				profile: createAgentProfile({
					harness: { kind: "hermes", config: { managed: true } },
					runtime: { workDir: join(root, "workspaces", "hermes") },
				}),
			}, home);

			await registry.ensureForProfile({ id: "hermes", home, harnessKind: "hermes" });

			assert.equal(startCount, 0);
			assert.equal(readHarnessServiceState(root, "openclaw"), undefined);
			assert.equal(loadConfigStore(home).profile?.harness.config?.managed, true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("waits for shared service stop before marking it stopped", async () => {
		const root = mkdtempSync(join(tmpdir(), "pie-shared-openclaw-stop-"));
		let stopFinished = false;
		const openClawStateDir = join(root, "official-openclaw");
		const registry = new SharedHarnessServiceRegistry({
			rootDir: root,
			openClawStateDir,
			createOpenClawManager: () => ({
				start: async () => {},
				stop: async () => {
					await new Promise((resolve) => setTimeout(resolve, 10));
					stopFinished = true;
				},
			}),
		});
		try {
			const home = join(root, "profiles", "alpha");
			saveConfigStore({
				version: 3,
				profile: createAgentProfile({
					harness: { kind: "openclaw", config: {} },
					runtime: { workDir: join(root, "workspaces", "alpha") },
				}),
			}, home);

			await registry.ensureForProfile({ id: "alpha", home, harnessKind: "openclaw" });
			await registry.stopAll();

			assert.equal(stopFinished, true);
			assert.equal(readHarnessServiceState(root, "openclaw")?.lifecycle.state, "stopped");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
