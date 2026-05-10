import {
	getOwnerSessionBinding,
	loadConfigStore,
	saveConfigStore,
	setOwnerSessionBinding,
	type OwnerSessionBinding,
} from "../../core/config-store.js";
import type { AgentRunInput, AgentRunOutput } from "../../runtime/types.js";

export function formatAgentTaskPrompt(prompt: string): string {
	const trimmed = prompt.trim();
	if (!trimmed) {
		throw new Error("Task prompt is empty.");
	}
	return trimmed.startsWith("Task:") ? trimmed : `Task: ${trimmed}`;
}

export function isSilentAgentTask(request: AgentRunInput): boolean {
	return request.kind === "agent_task" && request.metadata?.deliveryMode === "silent";
}

export function rememberOwnerSessionBinding(ownerSession: OwnerSessionBinding, options?: {
	acceptExisting?: (existing: OwnerSessionBinding, next: OwnerSessionBinding) => boolean;
}): void {
	const store = loadConfigStore();
	const existing = getOwnerSessionBinding(store);
	if (existing) {
		const isSame =
			existing.chatId === ownerSession.chatId &&
			existing.sessionKey === ownerSession.sessionKey &&
			existing.openId === ownerSession.openId;
		if (isSame || options?.acceptExisting?.(existing, ownerSession) === false) {
			return;
		}
	}
	saveConfigStore(setOwnerSessionBinding(store, ownerSession));
}

export function resolveOwnerSessionQueueKey(request: AgentRunInput): string {
	if (isSilentAgentTask(request) || request.kind !== "agent_task") {
		return request.sessionKey;
	}
	return getOwnerSessionBinding(loadConfigStore())?.sessionKey ?? request.sessionKey;
}

export class ScheduledRunQueue {
	private readonly queues = new Map<string, Promise<void>>();

	async enqueue(
		request: AgentRunInput,
		runAgent: (request: AgentRunInput) => Promise<AgentRunOutput>,
		resolveQueueKey: (request: AgentRunInput) => string = resolveOwnerSessionQueueKey,
	): Promise<AgentRunOutput> {
		let result: AgentRunOutput | undefined;
		const queueKey = resolveQueueKey(request);
		const previous = this.queues.get(queueKey) ?? Promise.resolve();
		const current = previous
			.catch(() => undefined)
			.then(async () => {
				result = await runAgent(request);
			})
			.finally(() => {
				if (this.queues.get(queueKey) === current) {
					this.queues.delete(queueKey);
				}
			});
		this.queues.set(queueKey, current);
		await current;
		if (!result) {
			throw new Error("Scheduled agent run produced no result.");
		}
		return result;
	}
}
