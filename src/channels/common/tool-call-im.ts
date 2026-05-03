import { basename } from "node:path";

const TOOL_CALL_IM_MAX = 100;
const DEFAULT_TOOL_IM_EMOJI = "🖥️";

function truncate(text: string, max = TOOL_CALL_IM_MAX): string {
	return text.length > max ? `${text.slice(0, max)}...` : text;
}

function toolCallImEmoji(toolLabel: string): string {
	const base = toolLabel.replace(/\s+error$/i, "").trim().toLowerCase();
	switch (base) {
		case "read":
			return "📖";
		case "write":
			return "📝";
		case "edit":
			return "✏️";
		case "bash":
			return DEFAULT_TOOL_IM_EMOJI;
		default:
			return DEFAULT_TOOL_IM_EMOJI;
	}
}

function imBasename(pathStr: string): string {
	const trimmed = pathStr.trim();
	const base = basename(trimmed);
	return base || trimmed || "(unknown)";
}

function firstStringFieldForIm(rec: Record<string, unknown>): string {
	for (const value of Object.values(rec)) {
		if (typeof value === "string" && value.trim()) {
			return value.trim().replace(/\s+/g, " ");
		}
	}
	return "";
}

export function formatToolImLine(toolName: string, args: unknown): string {
	const emoji = toolCallImEmoji(toolName);
	const base = toolName.replace(/\s+error$/i, "").trim().toLowerCase();
	const rec = args !== null && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};

	if (base === "bash") {
		const cmd = typeof rec.command === "string" ? rec.command.trim().replace(/\s+/g, " ") : "";
		return truncate(`${emoji} bash ${cmd || "(no command)"}`);
	}
	if (base === "read" || base === "write" || base === "edit") {
		const pathStr = typeof rec.path === "string" ? rec.path : "";
		return truncate(`${emoji} ${base} ${imBasename(pathStr || "(no path)")}`);
	}
	if (base === "grep") {
		const pattern = typeof rec.pattern === "string" ? rec.pattern.trim().replace(/\s+/g, " ") : "";
		const pathStr = typeof rec.path === "string" ? rec.path.trim() : "";
		const tail = pathStr ? ` ${imBasename(pathStr)}` : "";
		return truncate(`${emoji} grep ${pattern || "?"}${tail}`);
	}
	if (base === "find") {
		const pathStr = typeof rec.path === "string" ? rec.path.trim() : "";
		const pattern = typeof rec.pattern === "string" ? rec.pattern.trim() : "";
		const head = pathStr ? imBasename(pathStr) : ".";
		return truncate(`${emoji} find ${pattern ? `${head} ${pattern.replace(/\s+/g, " ")}` : head}`);
	}
	if (base === "ls") {
		const pathStr = typeof rec.path === "string" ? rec.path.trim() : "";
		return truncate(`${emoji} ls ${pathStr ? imBasename(pathStr) : "."}`);
	}

	const hint = firstStringFieldForIm(rec);
	return truncate(hint ? `${emoji} ${base} ${hint}` : `${emoji} ${toolName.replace(/\s+error$/i, "").trim()}`);
}

function formatToolImErrorSummary(result: unknown): string {
	if (result == null) {
		return "";
	}
	if (typeof result === "string") {
		return result.trim().replace(/\s+/g, " ");
	}
	if (typeof result === "object") {
		const rec = result as Record<string, unknown>;
		const content = rec.content;
		if (Array.isArray(content)) {
			const parts: string[] = [];
			for (const item of content) {
				if (item && typeof item === "object" && (item as { type?: string }).type === "text") {
					const text = (item as { text?: string }).text;
					if (typeof text === "string" && text.trim()) {
						parts.push(text.trim());
					}
				}
			}
			if (parts.length) {
				return parts.join(" ").replace(/\s+/g, " ");
			}
		}
		if (typeof rec.message === "string" && rec.message.trim()) {
			return rec.message.trim().replace(/\s+/g, " ");
		}
	}
	return String(result).replace(/\s+/g, " ");
}

export function formatToolImErrorLine(toolName: string, result: unknown): string {
	const emoji = toolCallImEmoji(`${toolName} error`);
	const summary = formatToolImErrorSummary(result);
	return truncate(summary ? `${emoji} ${toolName} error ${summary}` : `${emoji} ${toolName} error`);
}
