import { normalizeAgentPromptInput, type AgentConversationSession, type AgentPromptInputLike } from "../../types.js";

export function forwardPiPrompt(session: AgentConversationSession, input: AgentPromptInputLike): Promise<void> {
	const content = normalizeAgentPromptInput(input);
	return (session as any).prompt(content.text, content.images?.length ? { images: content.images } : undefined);
}
