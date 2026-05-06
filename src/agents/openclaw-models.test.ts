import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ensureOpenClawAgentProfile, getOpenClawAgentIdForPieProfile, readOpenClawGatewaySettings } from "./openclaw-models.js";

describe("ensureOpenClawAgentProfile", () => {
	it("upserts a Pie profile as a namespaced official OpenClaw agent", () => {
		const root = mkdtempSync(join(tmpdir(), "pie-openclaw-"));
		try {
			const stateDir = join(root, "state");
			const homeDir = join(root, "profile-home");
			const workDir = join(root, "workspace");
			const result = ensureOpenClawAgentProfile({
				stateDir,
				profileId: "bot-alpha",
				homeDir,
				workDir,
				modelRef: "kimi-k2",
			});
			assert.equal(result.agentId, getOpenClawAgentIdForPieProfile("bot-alpha"));
			assert.equal(result.workspace, workDir);
			assert.equal(result.agentDir, join(homeDir, "openclaw", "agent"));
			const config = JSON.parse(readFileSync(join(stateDir, "openclaw.json"), "utf8")) as {
				agents?: { list?: Array<Record<string, unknown>> };
			};
			const agent = config.agents?.list?.find((item) => item.id === result.agentId);
			assert.equal(agent?.workspace, workDir);
			assert.equal(agent?.agentDir, result.agentDir);
			assert.equal(agent?.model, result.modelRef);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("marks Pie OpenClaw workspaces as setup-complete and removes the default bootstrap prompt", () => {
		const root = mkdtempSync(join(tmpdir(), "pie-openclaw-bootstrap-"));
		try {
			const stateDir = join(root, "state");
			const homeDir = join(root, "profile-home");
			const workDir = join(root, "workspace");
			mkdirSync(workDir, { recursive: true });
			writeFileSync(
				join(workDir, "BOOTSTRAP.md"),
				[
					"# BOOTSTRAP.md - Hello, World",
					"",
					"_You just woke up. Time to figure out who you are._",
					"",
					"Delete this file.",
					"",
				].join("\n"),
				"utf8",
			);

			ensureOpenClawAgentProfile({
				stateDir,
				profileId: "bot-alpha",
				homeDir,
				workDir,
			});

			const workspaceState = JSON.parse(readFileSync(join(workDir, ".openclaw", "workspace-state.json"), "utf8")) as {
				setupCompletedAt?: string;
				bootstrapSeededAt?: string;
			};
			assert.equal(typeof workspaceState.setupCompletedAt, "string");
			assert.equal(typeof workspaceState.bootstrapSeededAt, "string");
			assert.equal(existsSync(join(workDir, "BOOTSTRAP.md")), false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("reads official OpenClaw gateway endpoint and token settings", () => {
		const root = mkdtempSync(join(tmpdir(), "pie-openclaw-settings-"));
		try {
			const stateDir = join(root, "openclaw");
			const configPath = join(stateDir, "openclaw.json");
			ensureOpenClawAgentProfile({
				stateDir,
				profileId: "bot-alpha",
				homeDir: join(root, "profile-home"),
				workDir: join(root, "workspace"),
			});
			const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
			config.gateway = {
				port: 18888,
				auth: {
					mode: "token",
					token: "official-token",
				},
			};
			writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

			const settings = readOpenClawGatewaySettings({ stateDir });

			assert.equal(settings.gatewayUrl, "ws://127.0.0.1:18888");
			assert.equal(settings.authMode, "token");
			assert.equal(settings.token, "official-token");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
