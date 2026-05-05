import type { AgentSessionEvent } from "../../agents/types.js";

export function formatThinkingForIm(text: string): string {
	return text
		.trim()
		.split(/\r?\n/)
		.map((line) => `> ${line}`)
		.join("\n");
}

export class ThinkingPresentationBuffer {
	private text = "";
	private flushedLength = 0;

	ingest(event: AgentSessionEvent): void {
		if (event.type === "thinking_delta" && event.delta) {
			this.text += event.delta;
		}
		if (event.type === "thinking_finished" && event.thinking) {
			this.text = event.thinking;
		}
	}

	takeNextFormatted(): string | undefined {
		const nextText = this.text.slice(this.flushedLength);
		if (!nextText.trim()) {
			return undefined;
		}
		this.flushedLength = this.text.length;
		return formatThinkingForIm(nextText);
	}
}

export class AssistantTextPresentationBuffer {
	private text = "";

	ingest(event: AgentSessionEvent): string | undefined {
		if (event.type === "text_start") {
			this.text = "";
			return undefined;
		}
		if (event.type === "text_delta" && event.delta) {
			this.text += event.delta;
			return undefined;
		}
		if (event.type === "text_finished") {
			if (event.text.trim()) {
				this.text = event.text;
			}
			return this.take();
		}
		if (event.type === "turn_finished") {
			return this.take();
		}
		return undefined;
	}

	take(): string | undefined {
		const nextText = this.text.trim();
		this.text = "";
		return nextText || undefined;
	}
}
