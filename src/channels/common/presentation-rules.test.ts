import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPresentationPromptHints, getPresentationRules } from "./presentation-rules.js";

describe("presentation rules", () => {
	it("formats channel response rules for system prompt injection", () => {
		const rules = getPresentationRules({ channel: "feishu" });
		const prompt = formatPresentationPromptHints(rules);

		assert.ok(prompt?.startsWith("## Channel response rules"));
		assert.ok(prompt?.includes("Never use Markdown tables"));
		assert.ok(prompt?.includes("Reply in Chinese"));
		assert.equal(prompt?.includes("## User message"), false);
	});

	it("omits channel response rules when a channel has no prompt hints", () => {
		assert.equal(formatPresentationPromptHints(getPresentationRules({ channel: "wechat" })), undefined);
	});
});
