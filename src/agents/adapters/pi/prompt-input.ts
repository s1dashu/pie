import { normalizeAgentRoundInput, type AgentConversationSession, type AgentRoundInputLike } from "../../types.js";

export function forwardPiPrompt(session: AgentConversationSession, input: AgentRoundInputLike): Promise<void> {
	const content = normalizeAgentRoundInput(input);
	return (session as any).prompt(content.text, content.images?.length ? { images: content.images } : undefined);
}
