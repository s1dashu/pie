export type ImGroupResponseMode =
	| "collect_only"
	| "owner_mention"
	| "mention"
	| "owner"
	| "any";

export interface ImBehaviorRules {
	groupResponseMode: ImGroupResponseMode;
}

export const DEFAULT_IM_GROUP_RESPONSE_MODE: ImGroupResponseMode = "owner_mention";

export function isImGroupResponseMode(value: unknown): value is ImGroupResponseMode {
	return (
		value === "collect_only" ||
		value === "owner_mention" ||
		value === "mention" ||
		value === "owner" ||
		value === "any"
	);
}

export function shouldRespondToImMessage(options: {
	isDirectMessage: boolean;
	isBotMentioned?: boolean;
	senderId?: string;
	ownerId?: string;
	groupResponseMode: ImGroupResponseMode;
}): boolean {
	if (options.isDirectMessage) {
		return true;
	}
	const isOwner = Boolean(options.ownerId && options.senderId && options.ownerId === options.senderId);
	const isMentioned = Boolean(options.isBotMentioned);
	switch (options.groupResponseMode) {
		case "collect_only":
			return false;
		case "owner_mention":
			return isOwner && isMentioned;
		case "mention":
			return isMentioned;
		case "owner":
			return isOwner;
		case "any":
			return true;
	}
}
