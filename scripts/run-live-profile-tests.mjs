#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();
const profilesRoot = join(homedir(), ".pie", "profiles");
const connectivityTestFile = "src/integration/live-connectivity.test.ts";
const imRuntimeTestFile = "src/integration/live-im-runtime.test.ts";
const feishuLabTestFile = "src/integration/live-feishu-lab.test.ts";
const discordLabTestFile = "src/integration/live-discord-lab.test.ts";
const allowedHarnesses = new Set(["pi", "ousia", "codex", "hermes", "openclaw"]);
const allowedChannels = new Set(["feishu", "discord"]);

function parseEnvFile(filePath) {
	const result = {};
	if (!existsSync(filePath)) {
		return result;
	}
	const text = readFileSync(filePath, "utf8");
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}
		const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
		if (!match) {
			continue;
		}
		let value = match[2] ?? "";
		if (
			(value.startsWith("\"") && value.endsWith("\"")) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			try {
				value = JSON.parse(value);
			} catch {
				value = value.slice(1, -1);
			}
		}
		result[match[1]] = value;
	}
	return result;
}

function readJson(filePath) {
	if (!existsSync(filePath)) {
		return undefined;
	}
	return JSON.parse(readFileSync(filePath, "utf8"));
}

function readOpenClawGatewayUrl() {
	const config = readJson(join(homedir(), ".openclaw", "openclaw.json"));
	const port = config?.gateway?.port;
	return typeof port === "number" ? `ws://127.0.0.1:${port}` : "ws://127.0.0.1:18789";
}

function getHarness(profile) {
	return profile.harness?.kind ?? profile.backend?.kind ?? "unknown";
}

function getProfileCases() {
	if (!existsSync(profilesRoot)) {
		return [];
	}
	const cases = [];
	for (const id of readdirSync(profilesRoot).sort()) {
		const home = join(profilesRoot, id);
		const config = readJson(join(home, "config.json"));
		const profile = config?.profile ?? config;
		if (!profile || typeof profile !== "object") {
			continue;
		}
		const env = parseEnvFile(join(home, ".env"));
		const targets = new Set();
		const channels = Array.isArray(profile.channels) ? profile.channels : [];
		for (const channel of channels) {
			if (!channel || channel.enabled === false) {
				continue;
			}
			if (channel.kind === "feishu") {
				if (channel.appId) {
					env.FEISHU_APP_ID ??= channel.appId;
				}
				if (channel.brand) {
					env.FEISHU_BRAND ??= channel.brand;
				}
				if (env.FEISHU_APP_ID && env.FEISHU_APP_SECRET) {
					targets.add("feishu");
				}
			}
			if (channel.kind === "discord") {
				if (channel.applicationId) {
					env.DISCORD_APPLICATION_ID ??= channel.applicationId;
				}
				if (channel.guildId) {
					env.DISCORD_GUILD_ID ??= channel.guildId;
				}
				if (env.DISCORD_BOT_TOKEN) {
					targets.add("discord");
				}
			}
			if (channel.kind === "wechat") {
				if (channel.accountId) {
					env.WECHAT_ACCOUNT_ID ??= channel.accountId;
				}
				if (channel.baseUrl) {
					env.WECHAT_BASE_URL ??= channel.baseUrl;
				}
				if (channel.botType) {
					env.WECHAT_BOT_TYPE ??= channel.botType;
				}
				if (channel.routeTag) {
					env.WECHAT_ROUTE_TAG ??= channel.routeTag;
				}
				targets.add("wechat");
			}
			if (channel.kind === "slack" && env.SLACK_BOT_TOKEN) {
				targets.add("slack");
			}
			if (channel.kind === "telegram" && env.TELEGRAM_BOT_TOKEN) {
				targets.add("telegram");
			}
		}

		const harness = getHarness(profile);
		if (!allowedHarnesses.has(harness)) {
			continue;
		}
		for (const target of [...targets]) {
			if (!allowedChannels.has(target) && target !== harness) {
				targets.delete(target);
			}
		}
		const harnessConfig = profile.harness?.config ?? profile.backend?.config ?? {};
		if (harness === "hermes") {
			const port = env.API_SERVER_PORT || env.HERMES_PORT;
			if (!env.HERMES_ENDPOINT && port) {
				env.HERMES_ENDPOINT = `http://${env.API_SERVER_HOST || "127.0.0.1"}:${port}`;
			}
			if (!env.HERMES_API_SERVER_KEY && env.API_SERVER_KEY) {
				env.HERMES_API_SERVER_KEY = env.API_SERVER_KEY;
			}
			if (env.HERMES_ENDPOINT) {
				targets.add("hermes");
			}
		}
		if (harness === "openclaw") {
			env.OPENCLAW_GATEWAY_URL ??= harnessConfig.gatewayUrl || harnessConfig.url || readOpenClawGatewayUrl();
			if (env.OPENCLAW_GATEWAY_URL) {
				targets.add("openclaw");
			}
		}

		if (targets.size) {
			cases.push({
				id,
				home,
				harness,
				targets: [...targets].sort(),
				env,
			});
		}
	}
	return cases;
}

function runCase(testCase) {
	return new Promise((resolve) => {
		const env = {
			...process.env,
			...testCase.env,
			PIE_AGENT_HOME: testCase.home,
			PIE_LIVE_INTEGRATION_TESTS: "1",
			PIE_LIVE_PROFILE_ID: testCase.id,
			PIE_LIVE_TARGETS: testCase.targets.join(","),
		};
		console.log(`\n== live profile ${testCase.id} (${testCase.harness}) targets=${testCase.targets.join(",")} ==`);
		const child = spawn("npx", ["tsx", "--test", connectivityTestFile], {
			cwd: repoRoot,
			env,
			stdio: "inherit",
		});
		child.on("exit", (code, signal) => {
			resolve({ code: code ?? (signal ? 1 : 0), signal });
		});
	});
}

function runImRuntimeCase(testCase, channel) {
	return new Promise((resolve) => {
		const env = {
			...process.env,
			...testCase.env,
			PIE_AGENT_HOME: testCase.home,
			PIE_LIVE_IM_RUNTIME_TESTS: "1",
			PIE_LIVE_PROFILE_ID: testCase.id,
			PIE_LIVE_CHANNEL_KIND: channel,
		};
		console.log(`\n== live IM runtime ${testCase.harness} on ${channel} (${testCase.id}) ==`);
		const child = spawn("npx", ["tsx", "--test", imRuntimeTestFile], {
			cwd: repoRoot,
			env,
			stdio: "inherit",
		});
		child.on("exit", (code, signal) => {
			resolve({ code: code ?? (signal ? 1 : 0), signal });
		});
	});
}

function runFeishuLabCase(testCase) {
	return new Promise((resolve) => {
		const ownerSession = readJson(join(testCase.home, "config.json"))?.ownerSession;
		const env = {
			...process.env,
			...testCase.env,
			PIE_AGENT_HOME: testCase.home,
			PIE_LIVE_FEISHU_LAB_TESTS: "1",
			PIE_LIVE_FEISHU_LAB_CHAT_ID: process.env.PIE_LIVE_FEISHU_LAB_CHAT_ID || ownerSession?.chatId || "",
			PIE_LIVE_FEISHU_LAB_CONVERSATION_KEY: process.env.PIE_LIVE_FEISHU_LAB_CONVERSATION_KEY || ownerSession?.sessionKey || "",
			PIE_LIVE_FEISHU_LAB_OPEN_ID: process.env.PIE_LIVE_FEISHU_LAB_OPEN_ID || ownerSession?.openId || "",
		};
		console.log(`\n== live Feishu Lab batch ${testCase.harness} (${testCase.id}) ==`);
		const child = spawn("npx", ["tsx", "--test", feishuLabTestFile], {
			cwd: repoRoot,
			env,
			stdio: "inherit",
		});
		child.on("exit", (code, signal) => {
			resolve({ code: code ?? (signal ? 1 : 0), signal });
		});
	});
}

function runDiscordLabCase(testCase) {
	return new Promise((resolve) => {
		const ownerSession = readJson(join(testCase.home, "config.json"))?.ownerSession;
		const env = {
			...process.env,
			...testCase.env,
			PIE_AGENT_HOME: testCase.home,
			PIE_LIVE_DISCORD_LAB_TESTS: "1",
			PIE_LIVE_DISCORD_LAB_CHANNEL_ID: process.env.PIE_LIVE_DISCORD_LAB_CHANNEL_ID || ownerSession?.chatId || "",
			PIE_LIVE_DISCORD_LAB_CONVERSATION_KEY: process.env.PIE_LIVE_DISCORD_LAB_CONVERSATION_KEY || ownerSession?.sessionKey || "",
			PIE_LIVE_DISCORD_LAB_USER_ID: process.env.PIE_LIVE_DISCORD_LAB_USER_ID || ownerSession?.openId || "",
		};
		console.log(`\n== live Discord Lab batch ${testCase.harness} (${testCase.id}) ==`);
		const child = spawn("npx", ["tsx", "--test", discordLabTestFile], {
			cwd: repoRoot,
			env,
			stdio: "inherit",
		});
		child.on("exit", (code, signal) => {
			resolve({ code: code ?? (signal ? 1 : 0), signal });
		});
	});
}

const cases = getProfileCases();
if (!cases.length) {
	console.error("No live-testable Pie profiles found under ~/.pie/profiles.");
	process.exit(1);
}

console.log("| Profile | Live Case | Harness | Channel | Interface Checks |");
console.log("|---|---|---|---|---|");
for (const testCase of cases) {
	const config = readJson(join(testCase.home, "config.json"));
	const profile = config?.profile ?? config;
	const channels = (Array.isArray(profile?.channels) ? profile.channels : [])
		.filter((channel) => channel && channel.enabled !== false)
		.map((channel) => channel.kind)
		.filter((channel) => allowedChannels.has(channel));
	for (const channel of channels) {
		const checks = testCase.targets.filter((target) => target === channel || target === testCase.harness);
		if (!checks.length) {
			continue;
		}
		console.log(`| ${testCase.id} | ${testCase.harness} on ${channel} | ${testCase.harness} | ${channel} | ${checks.join(", ")} |`);
	}
}

let failed = 0;
for (const testCase of cases) {
	const result = await runCase(testCase);
	if (result.code !== 0) {
		failed += 1;
	}
}

for (const testCase of cases) {
	const config = readJson(join(testCase.home, "config.json"));
	const profile = config?.profile ?? config;
	const channels = (Array.isArray(profile?.channels) ? profile.channels : [])
		.filter((channel) => channel && channel.enabled !== false)
		.map((channel) => channel.kind)
		.filter((channel) => allowedChannels.has(channel));
	for (const channel of channels) {
		const result = await runImRuntimeCase(testCase, channel);
		if (result.code !== 0) {
			failed += 1;
		}
	}
}

if (process.env.PIE_LIVE_FEISHU_LAB_TESTS === "1") {
	for (const testCase of cases) {
		const config = readJson(join(testCase.home, "config.json"));
		const profile = config?.profile ?? config;
		const hasFeishu = (Array.isArray(profile?.channels) ? profile.channels : [])
			.some((channel) => channel && channel.enabled !== false && channel.kind === "feishu");
		if (!hasFeishu) {
			continue;
		}
		const result = await runFeishuLabCase(testCase);
		if (result.code !== 0) {
			failed += 1;
		}
	}
}

if (process.env.PIE_LIVE_DISCORD_LAB_TESTS === "1") {
	for (const testCase of cases) {
		const config = readJson(join(testCase.home, "config.json"));
		const profile = config?.profile ?? config;
		const hasDiscord = (Array.isArray(profile?.channels) ? profile.channels : [])
			.some((channel) => channel && channel.enabled !== false && channel.kind === "discord");
		if (!hasDiscord) {
			continue;
		}
		const result = await runDiscordLabCase(testCase);
		if (result.code !== 0) {
			failed += 1;
		}
	}
}

if (failed) {
	console.error(`\n${failed} live profile test case(s) failed.`);
	process.exit(1);
}

console.log(`\nAll ${cases.length} live profile test case(s) passed.`);
