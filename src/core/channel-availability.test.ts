import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isChannelAvailableForRelease, isDevelopmentChannel } from "./channel-availability.js";

describe("channel availability", () => {
	it("treats Discord as a release channel", () => {
		assert.equal(isDevelopmentChannel("discord"), false);
		assert.equal(isChannelAvailableForRelease("discord", { developerMode: false }), true);
	});

	it("keeps Slack and Telegram behind developer mode", () => {
		for (const channel of ["slack", "telegram"] as const) {
			assert.equal(isDevelopmentChannel(channel), true);
			assert.equal(isChannelAvailableForRelease(channel, { developerMode: false }), false);
			assert.equal(isChannelAvailableForRelease(channel, { developerMode: true }), true);
		}
	});
});
