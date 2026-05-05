export interface NaturalSplitOptions {
	naturalSplitAfterChars: number;
	maxChars: number;
	sentenceEndChars?: readonly string[];
}

const DEFAULT_SENTENCE_END_CHARS = ["。", ".", "！", "!", "？", "?"] as const;

export function splitTextNaturally(text: string, options: NaturalSplitOptions): string[] {
	const normalized = text.trim();
	if (!normalized) {
		return [""];
	}
	const chunks: string[] = [];
	let current = "";
	let currentLength = 0;
	for (const char of normalized) {
		if (current && currentLength + 1 > options.maxChars) {
			chunks.push(current.trim());
			current = "";
			currentLength = 0;
		}
		current += char;
		currentLength += 1;
		const sentenceEndChars = options.sentenceEndChars ?? DEFAULT_SENTENCE_END_CHARS;
		if (currentLength >= options.naturalSplitAfterChars && sentenceEndChars.includes(char)) {
			chunks.push(current.trim());
			current = "";
			currentLength = 0;
		}
	}
	if (current.trim()) {
		chunks.push(current.trim());
	}
	return chunks;
}
