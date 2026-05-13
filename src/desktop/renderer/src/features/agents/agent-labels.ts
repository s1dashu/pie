type Translate = (key: string, values?: Record<string, string | number>) => string;

const harnessLabels: Record<string, string> = {
	"claude-code": "Claude Code",
	codex: "Codex",
	hermes: "Hermes",
	openclaw: "OpenClaw",
	ousia: "Ousia",
	pi: "Pi",
};

const channelLabels: Record<string, string> = {
	discord: "Discord",
	dingtalk: "DingTalk",
	feishu: "Feishu",
	slack: "Slack",
	telegram: "Telegram",
	wechat: "Wechat",
};

export function formatHarnessName(kind: string | undefined, t: Translate): string {
	const normalized = normalizeMetadataValue(kind);
	if (!normalized) {
		return t("agent");
	}
	return harnessLabels[normalized] ?? formatMetadataLabel(normalized);
}

export function formatChannelNames(kinds: string[] | undefined, t: Translate): string {
	const values = kinds?.map((kind) => formatChannelName(kind, t)).filter(Boolean) ?? [];
	return values.length ? values.join("+") : t("noChannel");
}

export function formatAgentSubtitle(
	agent: { harnessKind?: string; frameworkKind?: string; channelKinds?: string[] },
	t: Translate,
): string {
	return `${formatHarnessName(agent.harnessKind ?? agent.frameworkKind, t)} ${t("on")} ${formatChannelNames(agent.channelKinds, t)}`;
}

function formatChannelName(kind: string | undefined, t: Translate): string {
	const normalized = normalizeMetadataValue(kind);
	if (!normalized) {
		return "";
	}
	return channelLabels[normalized] ?? formatMetadataLabel(normalized);
}

function normalizeMetadataValue(value: string | undefined): string {
	return value?.trim().toLowerCase().replace(/[_\s]+/g, "-") ?? "";
}

function formatMetadataLabel(value: string): string {
	return value
		.replace(/[-_]+/g, " ")
		.replace(/\s+/g, " ")
		.split(" ")
		.filter(Boolean)
		.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
		.join(" ");
}
