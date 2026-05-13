import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	createAgentProfile,
	getImBehavior,
	getPrimaryDingTalkChannel,
	getPrimaryFeishuChannel,
	getPrimaryWechatChannel,
	getProfileModel,
} from "../../core/config-store.js";
import { planAgentProfileMutation } from "./agent-profile-mutation.js";

describe("planAgentProfileMutation", () => {
	it("disables thinking output when Feishu card output is selected", () => {
		const currentProfile = createAgentProfile({
			harness: {
				kind: "pi",
				model: {
					provider: "openai",
					model: "gpt-5.5",
					outputThinkingToIm: true,
				},
			},
			channels: [
				{
					kind: "feishu",
					id: "feishu",
					enabled: true,
					appId: "cli_a",
					messageOutputMode: "bubble",
				},
			],
		});

		const plan = planAgentProfileMutation({
			currentProfile,
			draft: { feishuMessageOutputMode: "card" },
			env: { FEISHU_APP_SECRET: "secret" },
		});

		assert.equal(getProfileModel(plan.nextProfile)?.outputThinkingToIm, false);
		assert.equal(getPrimaryFeishuChannel(plan.nextProfile)?.messageOutputMode, "card");
		assert.deepEqual(plan.envUpdates, { FEISHU_APP_SECRET: "secret" });
	});

	it("updates OpenClaw modelRef and provider env metadata", () => {
		const currentProfile = createAgentProfile({
			harness: {
				kind: "openclaw",
				model: {
					provider: "anthropic",
					model: "claude-sonnet-4-5",
				},
			},
		});

		const plan = planAgentProfileMutation({
			currentProfile,
			draft: { provider: "openai", model: "gpt-5.5" },
			env: {},
		});

		assert.equal(plan.nextProfile.harness.config?.modelRef, "openai/gpt-5.5");
		assert.equal(plan.openClawModelRef, "openai/gpt-5.5");
		assert.equal(plan.nextProvider, "openai");
	});

	it("uses harness-specific session persistence defaults", () => {
		for (const harness of ["openclaw", "hermes"] as const) {
			const plan = planAgentProfileMutation({
				currentProfile: createAgentProfile({ harness: { kind: harness } }),
				draft: {},
				env: {},
			});
			assert.equal(getProfileModel(plan.nextProfile)?.resumeSessions, true);
		}

		for (const harness of ["pi", "ousia", "codex"] as const) {
			const plan = planAgentProfileMutation({
				currentProfile: createAgentProfile({ harness: { kind: harness } }),
				draft: {},
				env: {},
			});
			assert.equal(getProfileModel(plan.nextProfile)?.resumeSessions, false);
		}
	});

	it("keeps explicit session persistence overrides", () => {
		const openClawPlan = planAgentProfileMutation({
			currentProfile: createAgentProfile({ harness: { kind: "openclaw" } }),
			draft: { resumeSessions: false },
			env: {},
		});
		const codexPlan = planAgentProfileMutation({
			currentProfile: createAgentProfile({ harness: { kind: "codex" } }),
			draft: { resumeSessions: true },
			env: {},
		});

		assert.equal(getProfileModel(openClawPlan.nextProfile)?.resumeSessions, false);
		assert.equal(getProfileModel(codexPlan.nextProfile)?.resumeSessions, true);
	});

	it("updates IM behavior independently from channel credentials", () => {
		const currentProfile = createAgentProfile({
			harness: { kind: "pi" },
			channels: [
				{
					kind: "feishu",
					id: "feishu",
					enabled: true,
					appId: "cli_a",
				},
			],
		});

		const plan = planAgentProfileMutation({
			currentProfile,
			draft: { imGroupResponseMode: "owner_mention" },
			env: { FEISHU_APP_SECRET: "secret" },
		});

		assert.equal(getImBehavior(plan.nextProfile).groupResponseMode, "owner_mention");
		assert.deepEqual(plan.envUpdates, {});
		assert.equal(plan.hasFeishuUpdate, false);
	});

	it("validates new Slack credentials before producing mutations", () => {
		assert.throws(
			() =>
				planAgentProfileMutation({
					currentProfile: createAgentProfile({}),
					draft: { slackBotToken: "xoxb-token" },
					env: {},
				}),
			/Slack Bot Token 和 App Token 必填/,
		);
	});

	it("creates Wechat channel and env updates from a draft", () => {
		const plan = planAgentProfileMutation({
			currentProfile: createAgentProfile({}),
			draft: {
				wechatAccountId: "account-1",
				wechatBaseUrl: "https://example.test",
				wechatBotToken: "wechat-token",
			},
			env: {},
		});

		assert.equal(getPrimaryWechatChannel(plan.nextProfile)?.accountId, "account-1");
		assert.equal(getPrimaryWechatChannel(plan.nextProfile)?.baseUrl, "https://example.test");
		assert.deepEqual(plan.envUpdates, {
			WECHAT_ACCOUNT_ID: "account-1",
			WECHAT_BASE_URL: "https://example.test",
			WECHAT_BOT_TOKEN: "wechat-token",
		});
	});

	it("creates DingTalk channel and stores only the secret in env updates", () => {
		const plan = planAgentProfileMutation({
			currentProfile: createAgentProfile({}),
			draft: {
				dingtalkClientId: "ding-client",
				dingtalkClientSecret: "ding-secret",
			},
			env: {},
		});

		assert.equal(getPrimaryDingTalkChannel(plan.nextProfile)?.clientId, "ding-client");
		assert.deepEqual(plan.envUpdates, {
			DINGTALK_CLIENT_SECRET: "ding-secret",
		});
	});
});
