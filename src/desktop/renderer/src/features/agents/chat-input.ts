interface ChatInputNativeKeyboardEvent {
	isComposing?: boolean;
	keyCode?: number;
}

interface ChatInputKeyboardEvent {
	key: string;
	shiftKey: boolean;
	nativeEvent: ChatInputNativeKeyboardEvent;
	keyCode?: number;
}

export function shouldSubmitChatInput(event: ChatInputKeyboardEvent, isComposing: boolean): boolean {
	if (event.key !== "Enter" || event.shiftKey) {
		return false;
	}
	const nativeEvent = event.nativeEvent;
	return !isComposing && !nativeEvent.isComposing && nativeEvent.keyCode !== 229 && event.keyCode !== 229;
}
