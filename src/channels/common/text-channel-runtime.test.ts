import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type {
	AgentConversationSession,
	AgentConversationSessionPool,
	AgentPromptInputLike,
	AgentSessionCapabilities,
	AgentSessionEvent,
} from "../../agents/types.js";
import { loadConfigStore, saveConfigStore, type AgentConfigStore } from "../../core/config-store.js";
import type { AgentRunInput } from "../../runtime/types.js";
import type { CommonChannelRuntimeConfig } from "./config.js";
import type { ChannelTarget, IncomingChannelMessage, TextChannelAdapter } from "./channel-model.js";
import { TextChannelRuntime } from "./text-channel-runtime.js";

const PNG_1X1 = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
	"base64",
);

const CAPABILITIES: AgentSessionCapabilities = {
	supportsSteering: false,
	supportsInterrupt: true,
	supportsStreamingEvents: true,
	supportsSessionPersistence: true,
	supportsToolEvents: true,
};

const tempDirs: string[] = [];
let previousPieAgentHome: string | undefined;

afterEach(() => {
	if (previousPieAgentHome === undefined) {
		delete process.env.PIE_AGENT_HOME;
	} else {
		process.env.PIE_AGENT_HOME = previousPieAgentHome;
	}
	previousPieAgentHome = undefined;
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function createTempHome(): string {
	const dir = mkdtempSync(join(tmpdir(), "pie-text-runtime-"));
	tempDirs.push(dir);
	previousPieAgentHome ??= process.env.PIE_AGENT_HOME;
	process.env.PIE_AGENT_HOME = dir;
	saveConfigStore({ version: 3 }, dir);
	return dir;
}

function createConfig(homeDir: string, overrides: Partial<CommonChannelRuntimeConfig> = {}): CommonChannelRuntimeConfig {
	return {
		homeDir,
		harnessKind: "pi",
		channelKind: "discord",
		runtimeEnv: {},
		modelLabel: "fake",
		thinkingLevel: "off",
		tools: [],
		toolLabel: "none",
		runMode: "start",
		debug: false,
		verboseLogs: false,
		resumeSessions: true,
		outputToolCallsToIm: true,
		outputToolCallImMaxLength: 60,
		outputThinkingToIm: false,
		groupResponseMode: "mention",
		startedAtMs: 1_700_000_000_000,
		...overrides,
	};
}

function createMessage(overrides: Partial<IncomingChannelMessage> = {}): IncomingChannelMessage {
	return {
		id: "message-1",
		channel: "discord",
		conversationKey: "conversation-1",
		target: { channelId: "channel-1", userId: "user-1" },
		parts: [{ type: "text", text: "hello" }],
		createdAtMs: 1_700_000_001_000,
		isDirectMessage: true,
		isBotMentioned: false,
		senderId: "user-1",
		...overrides,
	};
}

class FakeTextChannelAdapter implements TextChannelAdapter {
	readonly sent: Array<{ target: ChannelTarget; text: string }> = [];
	private onMessage?: (message: IncomingChannelMessage) => Promise<void>;

	constructor(readonly kind: "feishu" | "discord" = "discord") {}

	async start(handlers: { onMessage: (message: IncomingChannelMessage) => Promise<void> }): Promise<void> {
		this.onMessage = handlers.onMessage;
	}

	async stop(): Promise<void> {}

	async sendText(target: ChannelTarget, text: string): Promise<void> {
		this.sent.push({ target, text });
	}

	async receive(message: IncomingChannelMessage): Promise<void> {
		assert(this.onMessage, "adapter has not been started");
		await this.onMessage(message);
	}
}

class FakeAgentSession implements AgentConversationSession {
	readonly capabilities = CAPABILITIES;
	readonly state: { messages: unknown[] } = { messages: [] };
	readonly prompts: AgentPromptInputLike[] = [];
	private readonly listeners = new Set<(event: AgentSessionEvent) => void>();

	constructor(
		private readonly conversationKey: string,
		private readonly reply: (input: AgentPromptInputLike, conversationKey: string) => string | Promise<string>,
	) {}

	get isStreaming(): boolean {
		return false;
	}

	async prompt(input: AgentPromptInputLike): Promise<void> {
		this.prompts.push(input);
		const text = await this.reply(input, this.conversationKey);
		this.state.messages.push({
			role: "assistant",
			content: [{ type: "text", text }],
		});
	}

	async abort(): Promise<void> {}

	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
}

class FakeAgentSessionPool implements AgentConversationSessionPool {
	readonly capabilities = CAPABILITIES;
	readonly sessions = new Map<string, FakeAgentSession>();

	constructor(
		private readonly reply: (input: AgentPromptInputLike, conversationKey: string) => string | Promise<string> = (input) =>
			`reply:${typeof input === "string" ? input : input.text}`,
	) {}

	async getSession(conversationKey: string): Promise<FakeAgentSession> {
		let session = this.sessions.get(conversationKey);
		if (!session) {
			session = new FakeAgentSession(conversationKey, this.reply);
			this.sessions.set(conversationKey, session);
		}
		return session;
	}
}

async function createRuntime(options: {
	homeDir?: string;
	channelKind?: "feishu" | "discord";
	sessionPool?: FakeAgentSessionPool;
	config?: Partial<CommonChannelRuntimeConfig>;
} = {}): Promise<{
	adapter: FakeTextChannelAdapter;
	sessionPool: FakeAgentSessionPool;
	runtime: TextChannelRuntime;
}> {
	const homeDir = options.homeDir ?? createTempHome();
	const channelKind = options.channelKind ?? "discord";
	const adapter = new FakeTextChannelAdapter(channelKind);
	const sessionPool = options.sessionPool ?? new FakeAgentSessionPool();
	const runtime = new TextChannelRuntime(
		createConfig(homeDir, { channelKind, ...options.config }),
		adapter,
		{ sessionPool },
	);
	await runtime.start();
	return { adapter, sessionPool, runtime };
}

describe("TextChannelRuntime integration", () => {
	it("prompts the agent and sends the assistant reply for an incoming IM message", async () => {
		const { adapter, sessionPool } = await createRuntime();

		await adapter.receive(createMessage({ parts: [{ type: "text", text: "hello runtime" }] }));

		const session = sessionPool.sessions.get("conversation-1");
		assert.equal(session?.prompts.length, 1);
		assert.deepEqual(session?.prompts[0], { text: "hello runtime" });
		assert.deepEqual(adapter.sent, [
			{ target: { channelId: "channel-1", userId: "user-1" }, text: "reply:hello runtime" },
		]);
	});

	it("passes image attachments through to the agent input before replying", async () => {
		const homeDir = createTempHome();
		const imagePath = join(homeDir, "pixel.png");
		writeFileSync(imagePath, PNG_1X1);
		const { adapter, sessionPool } = await createRuntime({ homeDir });

		await adapter.receive(createMessage({
			parts: [
				{ type: "text", text: "read the image" },
				{ type: "image", filePath: imagePath },
			],
		}));

		const input = sessionPool.sessions.get("conversation-1")?.prompts[0];
		assert.equal(typeof input, "object");
		assert.equal((input as { text?: string }).text, "read the image");
		assert.equal((input as { images?: Array<{ mimeType: string; data: string }> }).images?.[0]?.mimeType, "image/png");
		assert.equal((input as { images?: Array<{ mimeType: string; data: string }> }).images?.[0]?.data, PNG_1X1.toString("base64"));
		assert.equal(adapter.sent.at(-1)?.text, "reply:read the image");
	});

	it("deduplicates repeated platform message ids", async () => {
		const { adapter, sessionPool } = await createRuntime();
		const message = createMessage({ id: "same-message", parts: [{ type: "text", text: "once" }] });

		await adapter.receive(message);
		await adapter.receive(message);

		assert.equal(sessionPool.sessions.get("conversation-1")?.prompts.length, 1);
		assert.equal(adapter.sent.length, 1);
	});

	it("applies group response policy before prompting the agent", async () => {
		const homeDir = createTempHome();
		const { adapter, sessionPool } = await createRuntime({
			homeDir,
			config: { groupResponseMode: "owner_mention" },
		});

		await adapter.receive(createMessage({
			id: "owner-dm",
			conversationKey: "owner-conversation",
			target: { channelId: "owner-chat", userId: "owner-user" },
			senderId: "owner-user",
			isDirectMessage: true,
		}));
		await adapter.receive(createMessage({
			id: "group-other-mention",
			conversationKey: "group-conversation",
			target: { channelId: "group-chat", userId: "other-user" },
			senderId: "other-user",
			isDirectMessage: false,
			isBotMentioned: true,
			parts: [{ type: "text", text: "other mention" }],
		}));
		await adapter.receive(createMessage({
			id: "group-owner-mention",
			conversationKey: "group-conversation",
			target: { channelId: "group-chat", userId: "owner-user" },
			senderId: "owner-user",
			isDirectMessage: false,
			isBotMentioned: true,
			parts: [{ type: "text", text: "owner mention" }],
		}));

		assert.equal(sessionPool.sessions.get("group-conversation")?.prompts.length, 1);
		assert.deepEqual(sessionPool.sessions.get("group-conversation")?.prompts[0], { text: "owner mention" });
		assert.equal(adapter.sent.filter((item) => item.target.channelId === "group-chat").length, 1);
	});

	it("routes non-silent scheduled tasks to the bound owner session and silent tasks to their own session", async () => {
		const homeDir = createTempHome();
		const { adapter, runtime, sessionPool } = await createRuntime({ homeDir, channelKind: "feishu" });

		await adapter.receive(createMessage({
			channel: "feishu",
			conversationKey: "owner-conversation",
			target: { channelId: "owner-chat", userId: "owner-user" },
			senderId: "owner-user",
			parts: [{ type: "text", text: "bind owner" }],
		}));

		const store: AgentConfigStore = loadConfigStore(homeDir);
		assert.equal(store.ownerSession?.chatId, "owner-chat");
		assert.equal(store.ownerSession?.sessionKey, "owner-conversation");
		assert.equal(store.ownerSession?.openId, "owner-user");

		const visibleTask = await runtime.deliverRun({
			kind: "agent_task",
			sessionKey: "task-session",
			prompt: "run visible task",
		});
		assert.equal(visibleTask.sessionKey, "owner-conversation");
		assert.equal(sessionPool.sessions.get("owner-conversation")?.prompts.at(-1), "Task: run visible task");
		assert.equal(adapter.sent.at(-1)?.target.channelId, "owner-chat");
		assert.equal(adapter.sent.at(-1)?.text, "reply:Task: run visible task");

		const beforeSilentSendCount = adapter.sent.length;
		const silentTask: AgentRunInput = {
			kind: "agent_task",
			sessionKey: "silent-session",
			prompt: "run silent task",
			metadata: { deliveryMode: "silent" },
		};
		const silentResult = await runtime.deliverRun(silentTask);
		assert.equal(silentResult.sessionKey, "silent-session");
		assert.equal(silentResult.assistantText, "reply:run silent task");
		assert.equal(sessionPool.sessions.get("silent-session")?.prompts.at(-1), "run silent task");
		assert.equal(adapter.sent.length, beforeSilentSendCount);
	});
});
