import type { ChannelKind } from "./config-store.js";

const DEVELOPMENT_CHANNELS = new Set<ChannelKind>(["slack", "telegram"]);

export function isChannelAvailableForRelease(kind: ChannelKind, options: { developerMode: boolean }): boolean {
	return options.developerMode || !DEVELOPMENT_CHANNELS.has(kind);
}

export function isDevelopmentChannel(kind: ChannelKind): boolean {
	return DEVELOPMENT_CHANNELS.has(kind);
}
