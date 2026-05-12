import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldSubmitChatInput } from "./chat-input.js";

function keyboardEvent(event: {
	key: string;
	shiftKey?: boolean;
	isComposing?: boolean;
	keyCode?: number;
}) {
	return {
		key: event.key,
		shiftKey: event.shiftKey ?? false,
		keyCode: event.keyCode,
		nativeEvent: {
			isComposing: event.isComposing ?? false,
			keyCode: event.keyCode,
		},
	};
}

describe("shouldSubmitChatInput", () => {
	it("submits plain Enter", () => {
		assert.equal(shouldSubmitChatInput(keyboardEvent({ key: "Enter" }), false), true);
	});

	it("does not submit Shift+Enter", () => {
		assert.equal(shouldSubmitChatInput(keyboardEvent({ key: "Enter", shiftKey: true }), false), false);
	});

	it("does not submit while the input method is composing", () => {
		assert.equal(shouldSubmitChatInput(keyboardEvent({ key: "Enter" }), true), false);
		assert.equal(shouldSubmitChatInput(keyboardEvent({ key: "Enter", isComposing: true }), false), false);
	});

	it("does not submit keyCode 229 input method events", () => {
		assert.equal(shouldSubmitChatInput(keyboardEvent({ key: "Enter", keyCode: 229 }), false), false);
	});
});
