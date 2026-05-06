import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TestContext } from "node:test";
import { WebClient } from "@slack/web-api";
import WebSocket from "ws";
import { LarkClient } from "../channels/feishu/platform/index.js";
import { fetchLoginQr, getUpdates } from "../channels/wechat/platform/api.js";

const LIVE = process.env.PIE_LIVE_INTEGRATION_TESTS === "1";
const TIMEOUT_MS = Number(process.env.PIE_LIVE_INTEGRATION_TIMEOUT_MS ?? "15000");
const LIVE_TARGETS = new Set(
	(process.env.PIE_LIVE_TARGETS ?? "")
		.split(",")
		.map((part) => part.trim().toLowerCase())
		.filter(Boolean),
);

function env(name: string): string | undefined {
	return process.env[name]?.trim() || undefined;
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const response = await fetch(url, { ...init, signal: controller.signal });
		const text = await response.text();
		let body: unknown = text;
		try {
			body = text ? JSON.parse(text) : undefined;
		} catch {
			// Keep plain-text error bodies visible to assertions.
		}
		return { status: response.status, body };
	} finally {
		clearTimeout(timer);
	}
}

type LiveTarget = "feishu" | "slack" | "telegram" | "discord" | "wechat" | "hermes" | "openclaw";
type LiveTestFn = (t: TestContext) => void | Promise<void>;

const ALL_TARGETS: LiveTarget[] = ["feishu", "slack", "telegram", "discord", "wechat", "hermes", "openclaw"];
const DEFAULT_TARGETS: LiveTarget[] = ["feishu", "discord", "hermes", "openclaw"];

const selectedTargets: LiveTarget[] = LIVE_TARGETS.size
	? DEFAULT_TARGETS.filter((target) => LIVE_TARGETS.has(target))
	: DEFAULT_TARGETS;

function liveIt(target: LiveTarget, name: string, fn: LiveTestFn): void {
	if (!selectedTargets.includes(target)) {
		return;
	}
	it(name, fn);
}

describe("live external connectivity", { skip: !LIVE }, () => {
	liveIt("feishu", "probes Feishu/Lark bot credentials", async (t) => {
		const appId = env("FEISHU_APP_ID");
		const appSecret = env("FEISHU_APP_SECRET");
		if (!appId || !appSecret) {
			t.skip("FEISHU_APP_ID and FEISHU_APP_SECRET are required");
			return;
		}

		const result = await LarkClient.fromCredentials({
			accountId: "live-test",
			appId,
			appSecret,
			brand: env("FEISHU_BRAND") === "lark" ? "lark" : "feishu",
		}).probe();

		assert.equal(result.ok, true, result.ok ? undefined : result.error);
		assert.equal(result.appId, appId);
	});

	liveIt("slack", "authenticates Slack bot token with auth.test", async (t) => {
		const token = env("SLACK_BOT_TOKEN");
		if (!token) {
			t.skip("SLACK_BOT_TOKEN is required");
			return;
		}

		const response = await new WebClient(token, { timeout: TIMEOUT_MS }).auth.test();

		assert.equal(response.ok, true);
		assert.equal(typeof response.team_id, "string");
	});

	liveIt("telegram", "authenticates Telegram bot token with getMe", async (t) => {
		const token = env("TELEGRAM_BOT_TOKEN");
		if (!token) {
			t.skip("TELEGRAM_BOT_TOKEN is required");
			return;
		}

		const response = await fetchJson(`https://api.telegram.org/bot${token}/getMe`);
		const body = response.body as { ok?: boolean; result?: { id?: number; is_bot?: boolean } };

		assert.equal(response.status, 200);
		assert.equal(body.ok, true);
		assert.equal(body.result?.is_bot, true);
	});

	liveIt("discord", "authenticates Discord bot token with /users/@me", async (t) => {
		const token = env("DISCORD_BOT_TOKEN");
		if (!token) {
			t.skip("DISCORD_BOT_TOKEN is required");
			return;
		}

		const response = await fetchJson("https://discord.com/api/v10/users/@me", {
			headers: { authorization: `Bot ${token}` },
		});
		const body = response.body as { id?: string; bot?: boolean };

		assert.equal(response.status, 200);
		assert.equal(typeof body.id, "string");
		assert.equal(body.bot, true);
	});

	liveIt("wechat", "fetches WeChat login QR or polls updates when token is available", async () => {
		const baseUrl = env("WECHAT_BASE_URL");
		const routeTag = env("WECHAT_ROUTE_TAG");
		const token = env("WECHAT_BOT_TOKEN");
		if (token) {
			const updates = await getUpdates({ baseUrl: baseUrl ?? "https://ilinkai.weixin.qq.com", token, routeTag, timeoutMs: TIMEOUT_MS });
			assert.equal(typeof updates, "object");
			return;
		}

		const qr = await fetchLoginQr({
			baseUrl,
			botType: env("WECHAT_BOT_TYPE") ?? "3",
			routeTag,
		});
		assert.equal(typeof qr.qrcode, "string");
		assert.equal(typeof qr.qrcode_img_content, "string");
	});

	liveIt("hermes", "checks Hermes health endpoint when configured", async (t) => {
		const endpoint = env("HERMES_ENDPOINT");
		if (!endpoint) {
			t.skip("HERMES_ENDPOINT is required");
			return;
		}
		const healthPath = env("HERMES_HEALTH_PATH") ?? "/health";
		const apiKey = env("HERMES_API_SERVER_KEY") ?? env("API_SERVER_KEY");
		const response = await fetchJson(new URL(healthPath, endpoint.replace(/\/+$/, "/")).toString(), {
			headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
		});

		assert.equal(response.status >= 200 && response.status < 500, true);
	});

	liveIt("openclaw", "opens OpenClaw gateway websocket when configured", async (t) => {
		const gatewayUrl = env("OPENCLAW_GATEWAY_URL");
		if (!gatewayUrl) {
			t.skip("OPENCLAW_GATEWAY_URL is required");
			return;
		}
		const wsUrl = gatewayUrl.startsWith("http://")
			? `ws://${gatewayUrl.slice("http://".length).replace(/\/+$/, "")}`
			: gatewayUrl.startsWith("https://")
				? `wss://${gatewayUrl.slice("https://".length).replace(/\/+$/, "")}`
				: gatewayUrl;

		await new Promise<void>((resolve, reject) => {
			const ws = new WebSocket(wsUrl, { handshakeTimeout: TIMEOUT_MS });
			const timer = setTimeout(() => {
				ws.close();
				reject(new Error("OpenClaw websocket connection timed out"));
			}, TIMEOUT_MS);
			ws.once("open", () => {
				clearTimeout(timer);
				ws.close();
				resolve();
			});
			ws.once("error", (error) => {
				clearTimeout(timer);
				reject(error);
			});
		});
	});
});
