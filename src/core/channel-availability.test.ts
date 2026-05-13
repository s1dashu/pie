import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isChannelAvailableForRelease, isDevelopmentChannel } from "./channel-availability.js";

describe("channel availability", () => {
	it("treats Discord and DingTalk as release channels", () => {
		assert.equal(isDevelopmentChannel("discord"), false);
		assert.equal(isChannelAvailableForRelease("discord", { developerMode: false }), true);
		assert.equal(isDevelopmentChannel("dingtalk"), false);
		assert.equal(isChannelAvailableForRelease("dingtalk", { developerMode: false }), true);
	});

	it("keeps Slack and Telegram hidden from release channel creation", () => {
		for (const channel of ["slack", "telegram"] as const) {
			assert.equal(isDevelopmentChannel(channel), true);
			assert.equal(isChannelAvailableForRelease(channel, { developerMode: false }), false);
			assert.equal(isChannelAvailableForRelease(channel, { developerMode: true }), false);
		}
	});
});
