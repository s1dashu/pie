import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, Info, XCircle } from "lucide-react";
import { Streamdown } from "streamdown";
import {
	AltArrowDownLineDuotone,
	AltArrowRightLineDuotone,
	CodeSquareBoldDuotone,
	DocumentAddBoldDuotone,
	FileTextBoldDuotone,
	PenNewSquareBoldDuotone,
	RoundedMagniferBoldDuotone,
	type SolarIconProps,
} from "solar-icon-set";
import type { AgentChatSessionCommandResult, AgentChatSessionStatus, AgentDetails, AgentEventLogEntry, AgentLogEntry, AgentResourceStats } from "../../../shared/types";
import { AppIcon } from "../../components/shared/app-icon";
import { Button } from "../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { Spinner } from "../../components/ui/spinner-1";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { runtimeLifecycleLabel, statusLabel } from "./agent-display";

const MAX_CHAT_LOG_ITEMS = 120;
const COMMAND_BUTTON_CLASS =
	"pie-smooth-corner h-6 rounded-[12px] bg-[var(--slate-a2)] px-2 text-[10px] font-medium leading-none text-foreground/48 shadow-none transition-[background-color,color,scale] hover:bg-[var(--slate-a3)] hover:text-foreground/70 active:scale-[0.96]";
const COMMON_CHAT_COMMANDS = ["new", "resume", "clear"] as const;
const COMPACT_CHAT_COMMAND_HARNESSES = new Set(["pi", "ousia"]);
const STATUS_CHAT_COMMAND_HARNESSES = new Set(["pi", "ousia", "hermes", "openclaw"]);
const AUTO_FOLLOW_BOTTOM_THRESHOLD = 12;

function createClientMessageId(): string {
	return `desktop-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

type ChatItemRole = "user" | "assistant" | "system" | "error" | "tool" | "typing";
type ChatCommand = "new" | "resume" | "compact" | "status" | "clear";

interface ChatItem {
	id: string;
	role: ChatItemRole;
	text: string;
	timestamp: string;
	sessionKey?: string;
	runId?: string;
	sortTimestamp?: string;
	sequence?: number;
	status?: "pending" | "sent" | "failed";
	systemTone?: "success" | "info";
	errorText?: string;
	toolName?: string;
	toolState?: "started" | "finished" | "failed";
	toolArgs?: unknown;
	toolResult?: unknown;
	textStreaming?: boolean;
}

type ChatRenderItem =
	| { kind: "message"; item: ChatItem }
	| { kind: "tool_group"; id: string; tools: ChatItem[]; timestamp: string; autoCollapseWhenComplete: boolean };

interface SessionOption {
	key: string;
	label: string;
}

export function AgentChatPanel({
	agent,
	resources,
}: {
	agent: AgentDetails;
	resources?: AgentResourceStats;
}): JSX.Element {
	const { language, t } = useI18n();
	const [logs, setLogs] = useState<AgentLogEntry[]>([]);
	const [events, setEvents] = useState<AgentEventLogEntry[]>([]);
	const [localItems, setLocalItems] = useState<ChatItem[]>([]);
	const [draft, setDraft] = useState("");
	const [sessionKey, setSessionKey] = useState("desktop");
	const [isAutoFollowPaused, setIsAutoFollowPaused] = useState(false);
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const inputRef = useRef<HTMLTextAreaElement | null>(null);
	const autoFollowRef = useRef(true);
	const programmaticScrollRef = useRef(false);
	const lastScrollTopRef = useRef(0);
	const pendingCompactSessionsRef = useRef(new Set<string>());

	const scrollToBottom = () => {
		const node = scrollRef.current;
		if (!node) {
			return;
		}
		programmaticScrollRef.current = true;
		node.scrollTop = node.scrollHeight;
		lastScrollTopRef.current = node.scrollTop;
		window.requestAnimationFrame(() => {
			programmaticScrollRef.current = false;
		});
	};

	const handleChatScroll = (forcePause = false) => {
		if (programmaticScrollRef.current) {
			return;
		}
		const node = scrollRef.current;
		if (!node) {
			return;
		}
		const distanceToBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
		if (distanceToBottom <= AUTO_FOLLOW_BOTTOM_THRESHOLD) {
			lastScrollTopRef.current = node.scrollTop;
			if (!autoFollowRef.current) {
				autoFollowRef.current = true;
				setIsAutoFollowPaused(false);
			}
			return;
		}
		if (!forcePause && node.scrollTop >= lastScrollTopRef.current) {
			lastScrollTopRef.current = node.scrollTop;
			return;
		}
		lastScrollTopRef.current = node.scrollTop;
		autoFollowRef.current = false;
		setIsAutoFollowPaused(true);
	};

	const resumeAutoFollow = () => {
		autoFollowRef.current = true;
		setIsAutoFollowPaused(false);
		scrollToBottom();
	};

	useEffect(() => {
		let cancelled = false;
		const refreshEvents = () => window.pie.getAgentEvents(agent.id).then((entries) => {
			if (!cancelled) {
				setEvents(entries);
			}
		}).catch(() => {
			if (!cancelled) {
				setEvents([]);
			}
		});
		void refreshEvents();
		const eventRefreshTimer = window.setInterval(() => {
			void refreshEvents();
		}, 1000);
		window.pie.getAgentLogs(agent.id).then((entries) => {
			if (!cancelled) {
				setLogs(entries.filter((entry) => entry.stream === "system"));
			}
		}).catch(() => {
			if (!cancelled) {
				setLogs([]);
			}
		});
		const unsubscribe = window.pie.onAgentLog((entry) => {
			if (entry.agentId !== agent.id || entry.stream !== "system") {
				return;
			}
			setLogs((current) => mergeAgentLogs(current, [entry]));
		});
		const unsubscribeEvents = typeof window.pie.onAgentEvent === "function"
			? window.pie.onAgentEvent((entry) => {
					if (entry.agentId !== agent.id) {
						return;
					}
					setEvents((current) => mergeAgentEvents(current, [entry]));
				})
			: () => undefined;
		return () => {
			cancelled = true;
			window.clearInterval(eventRefreshTimer);
			unsubscribe();
			unsubscribeEvents();
		};
	}, [agent.id]);

	useEffect(() => {
		setLocalItems([]);
		setDraft("");
		setSessionKey("desktop");
		pendingCompactSessionsRef.current.clear();
		autoFollowRef.current = true;
		setIsAutoFollowPaused(false);
		lastScrollTopRef.current = 0;
		window.requestAnimationFrame(scrollToBottom);
	}, [agent.id]);

	const localItemsById = useMemo(() => new Map(localItems.map((item) => [item.id, item])), [localItems]);
	const sessionEvents = useMemo(() => events.filter((entry) => (entry.conversationKey ?? "desktop") === sessionKey), [events, sessionKey]);
	const eventItems = useMemo(() => eventsToChatItems(sessionEvents, localItemsById), [sessionEvents, localItemsById]);
	const logItems = useMemo(() => logsToChatItems(logs), [logs]);
	const items = useMemo(() => {
		const persistedIds = new Set(eventItems.map((item) => item.id));
		const visibleLocalItems = localItems.filter((item) =>
			(item.sessionKey ?? "desktop") === sessionKey &&
			(item.role === "system" || item.status === undefined || ((item.status === "failed" || item.status === "pending") && !persistedIds.has(item.id))),
		);
		const merged = [...eventItems, ...logItems, ...visibleLocalItems].sort(compareChatItems);
		return merged.slice(-MAX_CHAT_LOG_ITEMS);
	}, [eventItems, localItems, logItems, sessionKey]);
	const renderItems = useMemo(() => groupConsecutiveToolItems(items), [items]);
	const sessions = useMemo(() => deriveSessionOptions(events, sessionKey, language), [events, language, sessionKey]);

	useLayoutEffect(() => {
		if (!autoFollowRef.current) {
			return;
		}
		scrollToBottom();
		const frame = window.requestAnimationFrame(scrollToBottom);
		return () => window.cancelAnimationFrame(frame);
	}, [renderItems]);

	const appendLocalItem = (role: ChatItemRole, text: string) => {
		const timestamp = new Date().toISOString();
		setLocalItems((current) => [...current, { id: `local-${timestamp}-${current.length}`, role, text, timestamp, sessionKey }]);
	};

	const markLocalItem = (id: string, update: Partial<ChatItem>) => {
		setLocalItems((current) => current.map((item) => item.id === id ? { ...item, ...update } : item));
	};

	const sendText = async (text: string, clientMessageId = createClientMessageId()) => {
		markLocalItem(clientMessageId, { status: "pending", errorText: undefined });
		try {
			const unavailableMessage = getChatUnavailableMessage(agent, t);
			if (unavailableMessage) {
				throw new Error(unavailableMessage);
			}
			if (typeof window.pie.sendAgentChatMessage !== "function") {
				throw new Error(t("chatPreloadRestartRequired"));
			}
			const result = await window.pie.sendAgentChatMessage(agent.id, text, sessionKey, clientMessageId);
			setSessionKey(result.sessionKey);
			setLocalItems((current) => current.filter((item) => item.id !== clientMessageId));
		} catch (error) {
			markLocalItem(clientMessageId, {
				status: "failed",
				errorText: error instanceof Error ? error.message : String(error),
			});
		}
	};

	const clearSession = async () => {
		try {
			if (typeof window.pie.runAgentChatSessionCommand !== "function") {
				throw new Error(t("chatPreloadRestartRequired"));
			}
			const result = await window.pie.runAgentChatSessionCommand(agent.id, "clear", sessionKey);
			setSessionKey(result.sessionKey);
			setEvents((current) => current.filter((entry) => (entry.conversationKey ?? "desktop") !== result.sessionKey));
			const timestamp = new Date().toISOString();
			setLocalItems([{ id: `local-${timestamp}-clear`, role: "system", text: formatCommandResult("clear", result, language), timestamp, sessionKey: result.sessionKey }]);
		} catch (error) {
			appendLocalItem("system", error instanceof Error ? error.message : String(error));
		}
	};

	const runCommand = async (command: ChatCommand) => {
		if (command === "resume") {
			appendLocalItem("system", formatResumeHint(sessions, language));
			return;
		}
		if (command === "clear") {
			await clearSession();
			return;
		}
		if (command === "compact") {
			await runCompactCommand();
			return;
		}
		try {
			if (typeof window.pie.runAgentChatSessionCommand !== "function") {
				throw new Error(t("chatPreloadRestartRequired"));
			}
			const result = await window.pie.runAgentChatSessionCommand(agent.id, command, sessionKey);
			if (command === "new") {
				setSessionKey(result.sessionKey);
				const timestamp = new Date().toISOString();
				setLocalItems([{ id: `local-${timestamp}-new`, role: "system", text: formatCommandResult(command, result, language), timestamp, sessionKey: result.sessionKey }]);
				return;
			}
			appendLocalItem("system", formatCommandResult(command, result, language));
		} catch (error) {
			appendLocalItem("system", error instanceof Error ? error.message : String(error));
		}
	};

	const runCompactCommand = async () => {
		const compactSessionKey = sessionKey.trim() || "desktop";
		if (pendingCompactSessionsRef.current.has(compactSessionKey)) {
			appendLocalItem("system", language === "en" ? "Compaction is already running." : "正在压缩当前会话上下文。");
			return;
		}
		const timestamp = new Date().toISOString();
		const itemId = `local-${timestamp}-compact`;
		pendingCompactSessionsRef.current.add(compactSessionKey);
		setLocalItems((current) => [
			...current,
			{
				id: itemId,
				role: "system",
				text: language === "en" ? "Compacting current session context..." : "正在压缩当前会话上下文...",
				timestamp,
				sessionKey: compactSessionKey,
				status: "pending",
				systemTone: "info",
			},
		]);
		try {
			if (typeof window.pie.runAgentChatSessionCommand !== "function") {
				throw new Error(t("chatPreloadRestartRequired"));
			}
			const result = await window.pie.runAgentChatSessionCommand(agent.id, "compact", compactSessionKey);
			markLocalItem(itemId, {
				text: formatCommandResult("compact", result, language),
				status: "sent",
				systemTone: "success",
				sessionKey: result.sessionKey,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (isInformationalCompactError(message)) {
				markLocalItem(itemId, {
					text: formatCompactInfoMessage(message, language),
					status: "sent",
					systemTone: "info",
				});
			} else {
				markLocalItem(itemId, {
					text: message,
					status: "failed",
					systemTone: undefined,
				});
			}
		} finally {
			pendingCompactSessionsRef.current.delete(compactSessionKey);
		}
	};

	const resumeSession = (nextSessionKey: string) => {
		setSessionKey(nextSessionKey);
		const timestamp = new Date().toISOString();
		setLocalItems((current) => [
			...current,
			{
				id: `local-${timestamp}-resume`,
				role: "system",
				text: language === "en" ? `Resumed session ${nextSessionKey}.` : `已切换到会话 ${nextSessionKey}。`,
				timestamp,
				sessionKey: nextSessionKey,
			},
		]);
	};

	const supportedCommands = useMemo(() => getSupportedChatCommands(agent), [agent.harnessKind]);

	const submitCommand = async (command: ChatCommand, text: string) => {
		if (!supportedCommands.has(command)) {
			appendLocalItem("system", language === "en" ? `This agent does not support /${command}.` : `当前 agent 不支持 /${command}。`);
			return;
		}
		if (command !== "clear") {
			appendLocalItem("user", text);
		}
		await runCommand(command);
	};

	const parseCommand = (text: string): ChatCommand | undefined => {
		if (text === "/status") {
			return "status";
		}
		if (text === "/new") {
			return "new";
		}
		if (text === "/resume") {
			return "resume";
		}
		if (text === "/compact") {
			return "compact";
		}
		if (text === "/clear") {
			return "clear";
		}
		return undefined;
	};

	const submitSlashCommand = async (text: string): Promise<boolean> => {
		const command = parseCommand(text);
		if (!command) {
			return false;
		}
		await submitCommand(command, text);
		return true;
	};

	const runCommandButton = (command: ChatCommand) => {
		void runCommand(command);
	};

	const selectSession = (nextSessionKey: string) => {
		if (nextSessionKey === sessionKey) {
			return;
		}
		resumeAutoFollow();
		resumeSession(nextSessionKey);
	};

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const text = draft.trim();
		if (!text) {
			return;
		}
		resumeAutoFollow();
		setDraft("");
		if (await submitSlashCommand(text)) {
			return;
		}
		const clientMessageId = createClientMessageId();
		const userTimestamp = new Date().toISOString();
		setLocalItems((current) => [
			...current,
			{ id: clientMessageId, role: "user", text, timestamp: userTimestamp, sessionKey, sortTimestamp: userTimestamp, sequence: Number.MAX_SAFE_INTEGER, status: "pending" },
		]);
		await sendText(text, clientMessageId);
	};

	return (
		<div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col">
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
				<div className="relative flex min-h-0 flex-1 overflow-hidden">
					<div
						ref={scrollRef}
						onScroll={() => handleChatScroll()}
						onWheel={(event) => {
							if (event.deltaY < 0) {
								handleChatScroll(true);
							}
						}}
						onTouchMove={() => handleChatScroll(true)}
						className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-2 [scrollbar-gutter:stable]"
					>
						{renderItems.length ? (
							<div className="space-y-5">
								{renderItems.map((item) => item.kind === "message"
									? <ChatBubble key={item.item.id} item={item.item} onRetry={() => void sendText(item.item.text, item.item.id)} />
									: <ToolGroup key={item.id} tools={item.tools} autoCollapseWhenComplete={item.autoCollapseWhenComplete} />)}
							</div>
						) : (
							<EmptyChat agent={agent} />
						)}
					</div>
					{isAutoFollowPaused ? (
						<div className="pointer-events-none absolute bottom-3 right-5 flex justify-end">
							<button
								type="button"
								className="pie-smooth-corner pointer-events-auto grid size-8 place-items-center rounded-full bg-[var(--slate-a4)] text-muted-foreground shadow-[0_6px_18px_rgba(15,23,42,0.08)] backdrop-blur transition-[transform,background-color,color] hover:bg-[var(--slate-a5)] hover:text-foreground active:scale-95"
								onClick={resumeAutoFollow}
								aria-label={language === "en" ? "Jump to latest" : "回到最新"}
							>
								<ArrowDown className="size-4" strokeWidth={2.2} />
							</button>
						</div>
					) : null}
				</div>
				<form onSubmit={handleSubmit} className="mt-2 space-y-2">
					<CommandBar
						supportedCommands={supportedCommands}
						sessions={sessions}
						onSelectSession={selectSession}
						onNew={() => runCommandButton("new")}
						onCompact={() => runCommandButton("compact")}
						onStatus={() => runCommandButton("status")}
						onClear={() => runCommandButton("clear")}
					/>
					<div className="pie-smooth-corner relative min-h-[72px] rounded-[26px] bg-[var(--slate-2)] py-2.5 pl-3.5 pr-14">
						<textarea
							ref={inputRef}
							value={draft}
							onChange={(event) => setDraft(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && !event.shiftKey) {
									event.preventDefault();
									event.currentTarget.form?.requestSubmit();
								}
							}}
							placeholder={t("chatInputPlaceholder")}
							rows={2}
							className="block max-h-36 min-h-12 w-full resize-none bg-transparent px-1 py-1 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground"
						/>
						<Button
							type="submit"
							size="icon-lg"
							className="absolute bottom-2 right-2 h-9 w-9 active:scale-[0.96]"
							aria-label={t("chatSend")}
						>
							<ArrowUp className="size-5" strokeWidth={2.2} />
						</Button>
					</div>
				</form>
			</div>
		</div>
	);
}

function getChatUnavailableMessage(agent: AgentDetails, t: ReturnType<typeof useI18n>["t"]): string | undefined {
	const lifecycleState = agent.runtimeEnvironment?.lifecycle.state;
	if (agent.status === "starting" || lifecycleState === "starting") {
		return t("chatAgentStarting");
	}
	if (agent.status === "paused" || lifecycleState === "stopped" || lifecycleState === "created") {
		return t("chatAgentNotStarted");
	}
	if (lifecycleState === "failed") {
		return agent.runtimeEnvironment?.lifecycle.reason
			? t("chatAgentFailedWithReason", { reason: agent.runtimeEnvironment.lifecycle.reason })
			: t("chatAgentFailed");
	}
	return undefined;
}

function getSupportedChatCommands(agent: AgentDetails): Set<ChatCommand> {
	const commands = new Set<ChatCommand>(COMMON_CHAT_COMMANDS);
	const harnessKind = agent.harnessKind;
	if (harnessKind && COMPACT_CHAT_COMMAND_HARNESSES.has(harnessKind)) {
		commands.add("compact");
	}
	if (harnessKind && STATUS_CHAT_COMMAND_HARNESSES.has(harnessKind)) {
		commands.add("status");
	}
	return commands;
}

function CommandBar({
	supportedCommands,
	sessions,
	onSelectSession,
	onNew,
	onCompact,
	onStatus,
	onClear,
}: {
	supportedCommands: Set<ChatCommand>;
	sessions: SessionOption[];
	onSelectSession: (sessionKey: string) => void;
	onNew: () => void;
	onCompact: () => void;
	onStatus: () => void;
	onClear: () => void;
}): JSX.Element {
	const { t } = useI18n();
	return (
		<div className="flex shrink-0 flex-wrap gap-1.5 px-1">
			{supportedCommands.has("new") ? <CommandButton command="new" onClick={onNew} /> : null}
			{supportedCommands.has("resume") ? (
				<Popover>
					<PopoverTrigger
						className={cn(COMMAND_BUTTON_CLASS, "inline-flex items-center justify-center")}
					>
						<CommandLabel command="resume" />
					</PopoverTrigger>
					<PopoverContent side="right" align="start" className="w-72 gap-2 rounded-[28px] p-2">
						<div className="px-2 pb-1 pt-1 text-xs font-medium text-muted-foreground">{t("chatResumeMenu")}</div>
						{sessions.map((session) => (
							<button
								key={session.key}
								type="button"
								onClick={() => onSelectSession(session.key)}
								className="flex min-h-10 w-full items-center gap-2 rounded-[18px] px-2.5 text-left text-sm text-foreground transition-[background-color] hover:bg-[var(--slate-3)]"
							>
								<span className="size-1.5 rounded-full bg-[var(--lime-9)]" />
								<span className="min-w-0 flex-1 truncate">{session.label}</span>
							</button>
						))}
					</PopoverContent>
				</Popover>
			) : null}
			{supportedCommands.has("compact") ? <CommandButton command="compact" onClick={onCompact} /> : null}
			{supportedCommands.has("status") ? <CommandButton command="status" onClick={onStatus} /> : null}
			{supportedCommands.has("clear") ? <CommandButton command="clear" onClick={onClear} /> : null}
		</div>
	);
}

function CommandButton({
	command,
	onClick,
}: {
	command: string;
	onClick: () => void;
}): JSX.Element {
	return (
		<Button
			type="button"
			variant="unstyled"
			size="inline"
			className={COMMAND_BUTTON_CLASS}
			onClick={onClick}
		>
			<CommandLabel command={command} />
		</Button>
	);
}

function CommandLabel({ command }: { command: string }): JSX.Element {
	return (
		<span className="inline-flex items-baseline gap-[2px]">
			<span className="font-mono text-[9px] font-normal text-foreground/30">/</span>
			<span>{command}</span>
		</span>
	);
}

function SystemStatusIcon({ item }: { item: ChatItem }): JSX.Element {
	if (item.status === "pending") {
		return <span className="grid size-4 shrink-0 place-items-center"><Spinner size={12} color="currentColor" /></span>;
	}
	if (item.status === "failed") {
		return <XCircle className="size-4 shrink-0 text-[var(--red-9)]" strokeWidth={2} />;
	}
	if (item.systemTone === "success") {
		return <CheckCircle2 className="size-4 shrink-0 text-[var(--green-9)]" strokeWidth={2} />;
	}
	if (item.systemTone === "info") {
		return <Info className="size-4 shrink-0 text-muted-foreground/65" strokeWidth={2} />;
	}
	return <span className="size-4 shrink-0" />;
}

const ChatBubble = memo(function ChatBubble({
	item,
	onRetry,
}: {
	item: ChatItem;
	onRetry: () => void;
}): JSX.Element {
	const { t } = useI18n();
	const isUser = item.role === "user";
	const isError = item.role === "error";
	const isSystem = item.role === "system";
	const isTyping = item.role === "typing";
	if (isSystem) {
		return (
			<div className="flex items-center gap-2 px-2 py-0.5 text-[11px] leading-5 text-muted-foreground/70 tabular-nums">
				<SystemStatusIcon item={item} />
				<span>{new Date(item.timestamp).toLocaleTimeString()}</span>
				<span className="whitespace-pre-wrap break-words">{item.text}</span>
			</div>
		);
	}
	if (isTyping) {
		return (
			<div className="flex justify-start px-3 py-1">
				<WaveDots />
			</div>
		);
	}
	return (
		<div className="flex justify-start">
			<div className="group relative flex max-w-[82%] flex-col items-start">
				<div className="pointer-events-none absolute -top-3 left-1 h-3 whitespace-nowrap text-left text-[10px] leading-3 text-muted-foreground opacity-0 transition-opacity duration-150 tabular-nums group-hover:opacity-100">
					{new Date(item.timestamp).toLocaleTimeString()}
				</div>
				<div className={cn(
					"pie-smooth-corner max-w-full rounded-[28px] px-3 py-2 text-sm leading-5",
					isUser
						? cn("bg-[var(--slate-12)] text-white", item.status === "failed" && "bg-[var(--red-9)]")
						: isError
							? "bg-[var(--red-2)] text-[var(--red-12)]"
							: "bg-[var(--slate-2)] text-foreground",
				)}>
					{item.role === "assistant" ? (
						<Streamdown
							animated={item.textStreaming ? { animation: "fadeIn", duration: 100, stagger: 8 } : false}
							className="pie-chat-markdown space-y-2 text-sm leading-5"
							controls={false}
							isAnimating={item.textStreaming === true}
							lineNumbers={false}
						>
							{item.text}
						</Streamdown>
					) : (
						<div className="whitespace-pre-wrap break-words text-pretty">{item.text}</div>
					)}
				</div>
				{isUser && item.status === "failed" ? (
					<div className="mt-1 flex items-center justify-end gap-2 px-1 text-[11px] leading-5 text-[var(--red-11)]">
						<span className="min-w-0 truncate">{item.errorText}</span>
						<button
							type="button"
							className="shrink-0 font-medium text-[var(--red-11)] transition-colors hover:text-[var(--red-12)] disabled:opacity-50"
							onClick={onRetry}
						>
							{t("chatRetry")}
						</button>
					</div>
				) : null}
			</div>
		</div>
	);
});

function WaveDots(): JSX.Element {
	return (
		<span
			className="flex h-5 items-center gap-1"
			aria-label="Agent is responding"
			role="status"
		>
			{[0, 1, 2].map((index) => (
				<span
					key={index}
					className="size-1.5 rounded-full bg-[var(--slate-10)] motion-reduce:animate-none"
					style={{
						animation: "pie-wave-dot 0.9s ease-in-out infinite",
						animationDelay: `${index * 0.12}s`,
					}}
				/>
			))}
		</span>
	);
}

function ToolGroup({ tools, autoCollapseWhenComplete }: { tools: ChatItem[]; autoCollapseWhenComplete: boolean }): JSX.Element {
	const hasRunningTool = tools.some((tool) => tool.toolState === "started");
	const [expanded, setExpanded] = useState(hasRunningTool || !autoCollapseWhenComplete);
	const wasRunningRef = useRef(hasRunningTool);
	const wasAutoCollapseReadyRef = useRef(!hasRunningTool && autoCollapseWhenComplete);
	useEffect(() => {
		if (hasRunningTool) {
			setExpanded(true);
		} else if (autoCollapseWhenComplete && !wasAutoCollapseReadyRef.current) {
			setExpanded(false);
		} else if (!autoCollapseWhenComplete && wasRunningRef.current) {
			setExpanded(true);
		}
		wasRunningRef.current = hasRunningTool;
		wasAutoCollapseReadyRef.current = !hasRunningTool && autoCollapseWhenComplete;
	}, [autoCollapseWhenComplete, hasRunningTool]);
	const failedCount = tools.filter((tool) => tool.toolState === "failed").length;
	const label = hasRunningTool
		? `${tools.length} ${tools.length === 1 ? "step" : "steps"} running`
		: `${tools.length} ${tools.length === 1 ? "step" : "steps"} taken${failedCount ? `, ${failedCount} failed` : ""}`;
	const canCollapse = !hasRunningTool;
	return (
		<div className="max-w-[82%] py-0 text-xs leading-5 text-muted-foreground">
			<button
				type="button"
				className="flex min-h-6 max-w-full items-center gap-1.5 rounded-4xl transition-[background-color,color] hover:bg-[var(--slate-2)] hover:text-foreground disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
				onClick={() => canCollapse && setExpanded((current) => !current)}
				disabled={!canCollapse}
			>
				<span className="grid size-5 shrink-0 place-items-center">
					<AppIcon IconComponent={expanded ? AltArrowDownLineDuotone : AltArrowRightLineDuotone} className="size-3.5" />
				</span>
				<span className="truncate font-medium">{label}</span>
			</button>
			{expanded ? (
				<div className="mt-1 space-y-1">
					{tools.map((tool) => (
						<ToolCallRow key={tool.id} tool={tool} />
					))}
				</div>
			) : null}
		</div>
	);
}

function ToolCallRow({ tool }: { tool: ChatItem }): JSX.Element {
	const summary = formatToolSummary(tool);
	const isRunning = tool.toolState === "started";
	return (
		<div className="relative flex min-w-0 items-start gap-2">
			<span className={cn(
				"relative z-10 mt-0.5 grid size-5 shrink-0 place-items-center bg-white text-[var(--slate-10)]",
				tool.toolState === "failed" && "text-[var(--red-10)]",
			)}>
				{isRunning ? <Spinner size={14} color="currentColor" /> : <AppIcon IconComponent={summary.icon} className="size-4" />}
			</span>
			<div className="flex min-w-0 flex-1 items-baseline gap-2 pt-0.5">
				<span className="shrink-0 font-medium text-foreground/70">{summary.action}</span>
				{summary.content ? <span className="min-w-0 truncate text-muted-foreground">{summary.content}</span> : null}
			</div>
		</div>
	);
}

function EmptyChat({ agent }: { agent: AgentDetails }): JSX.Element {
	const { t } = useI18n();
	return (
		<div className="flex h-full min-h-[260px] items-center justify-center">
			<div className="max-w-sm text-center">
				<div className="mt-3 text-base font-semibold text-foreground text-balance">{t("chatEmptyTitle")}</div>
				<div className="mt-1 text-sm leading-6 text-muted-foreground text-pretty">{t("chatEmptyDesc", { name: agent.name })}</div>
			</div>
		</div>
	);
}

function logsToChatItems(_logs: AgentLogEntry[]): ChatItem[] {
	return [];
}

function eventsToChatItems(entries: AgentEventLogEntry[], localItemsById: Map<string, ChatItem>): ChatItem[] {
	const items: ChatItem[] = [];
	const userById = new Map<string, ChatItem>();
	const textById = new Map<string, ChatItem>();
	const toolById = new Map<string, ChatItem>();
	const runInstanceByRunId = new Map<string, string>();
	const activeRunInstances = new Set<string>();
	for (const entry of entries) {
		const event = readEvent(entry.event);
		if (!event) {
			continue;
		}
		if (event.type === "user_message") {
			const messageId = readString(event.messageId);
			const id = messageId ?? `user-${entry.timestamp}-${items.length}`;
			const localItem = messageId ? localItemsById.get(messageId) : undefined;
			const existing = userById.get(id);
			if (existing) {
				existing.text = readString(event.text) ?? existing.text;
				existing.status = readStatus(event.status) ?? existing.status;
				existing.errorText = readString(event.errorText);
				continue;
			}
			const item: ChatItem = {
				id,
				role: "user",
				text: readString(event.text) ?? "",
				timestamp: entry.timestamp,
				sortTimestamp: localItem?.sortTimestamp ?? localItem?.timestamp ?? entry.timestamp,
				sequence: localItem?.sequence ?? entry.sequence,
				status: readStatus(event.status),
				errorText: readString(event.errorText),
			};
			userById.set(id, item);
			items.push(item);
			continue;
		}
		if (event.type === "agent_run_started") {
			const runId = readString(event.runId) ?? `run-${entry.timestamp}-${items.length}`;
			const runInstanceId = makeRunInstanceId(runId, entry, items.length);
			runInstanceByRunId.set(runId, runInstanceId);
			activeRunInstances.add(runInstanceId);
			continue;
		}
		if (event.type === "turn_started") {
			appendTypingItem(items, runInstanceForEvent(event, runInstanceByRunId), entry);
			continue;
		}
		if (event.type === "turn_finished") {
			const runInstanceId = runInstanceForEvent(event, runInstanceByRunId);
			finishRunningToolItems(items, runInstanceId, event.status === "error");
			removeTypingItem(items, runInstanceId);
			continue;
		}
		if (event.type === "agent_run_finished") {
			const runId = readString(event.runId);
			if (runId) {
				const runInstanceId = runInstanceByRunId.get(runId) ?? runId;
				activeRunInstances.delete(runInstanceId);
				finishRunningToolItems(items, runInstanceId, event.status === "error");
				removeTypingItem(items, runInstanceId);
			}
			continue;
		}
		if (event.type === "thinking_start" || event.type === "thinking_delta" || event.type === "thinking_finished") {
			removeTypingItem(items, runInstanceForEvent(event, runInstanceByRunId));
			continue;
		}
		if (event.type === "text_start") {
			removeTypingItem(items, runInstanceForEvent(event, runInstanceByRunId));
			const textId = scopedEventItemId(event, "textId", runInstanceByRunId, `text-${entry.timestamp}-${items.length}`);
			const item: ChatItem = { id: textId, role: "assistant", text: "", timestamp: entry.timestamp, sequence: entry.sequence, textStreaming: true };
			textById.set(textId, item);
			items.push(item);
			continue;
		}
		if (event.type === "text_delta") {
			const runInstanceId = runInstanceForEvent(event, runInstanceByRunId);
			removeTypingItem(items, runInstanceId);
			const textId = scopedEventItemId(event, "textId", runInstanceByRunId);
			const delta = readString(event.delta) ?? "";
			const item = textId ? textById.get(textId) : undefined;
			if (item) {
				item.text += delta;
				item.textStreaming = true;
			} else if (delta) {
				const fallbackTextId = textId ?? `text-${entry.timestamp}-${items.length}`;
				const fallbackItem: ChatItem = {
					id: fallbackTextId,
					role: "assistant",
					text: delta,
					timestamp: entry.timestamp,
					sequence: entry.sequence,
					textStreaming: true,
				};
				textById.set(fallbackTextId, fallbackItem);
				items.push(fallbackItem);
			}
			continue;
		}
		if (event.type === "text_finished") {
			const runInstanceId = runInstanceForEvent(event, runInstanceByRunId);
			removeTypingItem(items, runInstanceId);
			const textId = scopedEventItemId(event, "textId", runInstanceByRunId);
			const text = readString(event.text) ?? "";
			const item = textId ? textById.get(textId) : undefined;
			if (item) {
				item.text = text;
				item.textStreaming = false;
			} else if (text) {
				items.push({ id: `text-${entry.timestamp}-${items.length}`, role: "assistant", text, timestamp: entry.timestamp, sequence: entry.sequence, textStreaming: false });
			}
			continue;
		}
		if (event.type === "tool_call_started") {
			const runInstanceId = runInstanceForEvent(event, runInstanceByRunId);
			removeTypingItem(items, runInstanceId);
			const toolCallId = scopedEventItemId(event, "toolCallId", runInstanceByRunId, `tool-${entry.timestamp}-${items.length}`);
			const item: ChatItem = {
				id: toolCallId,
				role: "tool",
				text: formatToolContent(event.args),
				timestamp: entry.timestamp,
				sequence: entry.sequence,
				runId: runInstanceId,
				toolName: readString(event.name) ?? "tool",
				toolState: "started",
				toolArgs: event.args,
			};
			toolById.set(toolCallId, item);
			items.push(item);
			continue;
		}
		if (event.type === "tool_call_updated") {
			const runInstanceId = runInstanceForEvent(event, runInstanceByRunId);
			removeTypingItem(items, runInstanceId);
			const toolCallId = scopedEventItemId(event, "toolCallId", runInstanceByRunId);
			const item = toolCallId ? toolById.get(toolCallId) : undefined;
			if (item && event.partialResult !== undefined) {
				item.text = formatToolContent(event.partialResult);
				item.toolResult = event.partialResult;
			}
			continue;
		}
		if (event.type === "tool_call_finished") {
			const runInstanceId = runInstanceForEvent(event, runInstanceByRunId);
			removeTypingItem(items, runInstanceId);
			const toolCallId = scopedEventItemId(event, "toolCallId", runInstanceByRunId);
			const item = toolCallId ? toolById.get(toolCallId) : undefined;
			if (item) {
				item.toolState = event.isError === true ? "failed" : "finished";
				if (event.result !== undefined) {
					item.text = formatToolContent(event.result);
					item.toolResult = event.result;
				}
			}
		}
	}
	return items.filter((item) => item.role !== "assistant" || item.text.trim());
}

function compareChatItems(left: ChatItem, right: ChatItem): number {
	const timestampOrder = Date.parse(left.sortTimestamp ?? left.timestamp) - Date.parse(right.sortTimestamp ?? right.timestamp);
	if (timestampOrder !== 0) {
		return timestampOrder;
	}
	return (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER);
}

function makeRunInstanceId(runId: string, entry: AgentEventLogEntry, fallbackIndex: number): string {
	return `${runId}:${entry.timestamp}:${entry.sequence ?? fallbackIndex}`;
}

function runInstanceForEvent(event: Record<string, unknown>, runInstanceByRunId: Map<string, string>): string | undefined {
	const runId = readString(event.runId);
	return runId ? runInstanceByRunId.get(runId) ?? runId : undefined;
}

function removeTypingItem(items: ChatItem[], runId: string | undefined): void {
	const index = items.findIndex((item) => item.role === "typing" && (!runId || item.runId === runId));
	if (index >= 0) {
		items.splice(index, 1);
	}
}

function finishRunningToolItems(items: ChatItem[], runId: string | undefined, isError: boolean): void {
	for (const item of items) {
		if (item.role !== "tool" || item.toolState !== "started") {
			continue;
		}
		if (runId && item.runId !== runId) {
			continue;
		}
		item.toolState = isError ? "failed" : "finished";
	}
}

function appendTypingItem(items: ChatItem[], runId: string | undefined, entry: AgentEventLogEntry): void {
	if (!runId) {
		return;
	}
	removeTypingItem(items, runId);
	items.push({
		id: `typing-${runId}-${entry.timestamp}-${entry.sequence ?? items.length}`,
		role: "typing",
		text: "",
		timestamp: entry.timestamp,
		sequence: (entry.sequence ?? items.length) + 0.1,
		runId,
	});
}

function groupConsecutiveToolItems(items: ChatItem[]): ChatRenderItem[] {
	const grouped: ChatRenderItem[] = [];
	let pendingTools: ChatItem[] = [];
	const flushTools = (autoCollapseWhenComplete: boolean) => {
		if (!pendingTools.length) {
			return;
		}
		grouped.push({
			kind: "tool_group",
			id: pendingTools.map((tool) => tool.id).join(":"),
			tools: pendingTools,
			timestamp: pendingTools.at(-1)?.timestamp ?? pendingTools[0]!.timestamp,
			autoCollapseWhenComplete,
		});
		pendingTools = [];
	};
	for (const item of items) {
		if (item.role === "tool") {
			pendingTools.push(item);
			continue;
		}
		flushTools(item.role === "assistant");
		grouped.push({ kind: "message", item });
	}
	flushTools(false);
	return grouped;
}

function readEvent(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function readStatus(value: unknown): ChatItem["status"] | undefined {
	return value === "pending" || value === "sent" || value === "failed" ? value : undefined;
}

function scopedEventItemId(
	event: Record<string, unknown>,
	idKey: "textId" | "toolCallId",
	runInstanceByRunId: Map<string, string>,
	fallback?: string,
): string | undefined {
	const id = readString(event[idKey]) ?? fallback;
	if (!id) {
		return undefined;
	}
	const runId = runInstanceForEvent(event, runInstanceByRunId);
	const turnId = readString(event.turnId);
	if (!runId || !turnId || id.includes(":")) {
		return id;
	}
	return `${runId}:${turnId}:${id}`;
}

interface ToolSummary {
	icon: (props: SolarIconProps) => JSX.Element;
	action: string;
	content: string;
}

function formatToolSummary(tool: ChatItem): ToolSummary {
	const name = normalizeToolName(tool.toolName);
	const args = readRecord(tool.toolArgs);
	if (name === "edit") {
		return { icon: PenNewSquareBoldDuotone, action: "编辑文件", content: truncateToolText(readFileTarget(args) ?? tool.text) };
	}
	if (name === "write") {
		return { icon: DocumentAddBoldDuotone, action: "写入文件", content: truncateToolText(readFileTarget(args) ?? tool.text) };
	}
	if (name === "read") {
		return { icon: FileTextBoldDuotone, action: "阅读文件", content: truncateToolText(readFileTarget(args) ?? tool.text) };
	}
	if (name === "bash" || name === "shell" || name === "exec") {
		return { icon: CodeSquareBoldDuotone, action: "执行命令", content: truncateToolText(readCommandTarget(args) ?? tool.text) };
	}
	if (name === "grep" || name === "find" || name === "ls") {
		return { icon: RoundedMagniferBoldDuotone, action: tool.toolName ?? "工具调用", content: truncateToolText(readSearchTarget(args) ?? tool.text) };
	}
	return { icon: CodeSquareBoldDuotone, action: tool.toolName ?? "工具调用", content: truncateToolText(readGenericToolTarget(args) ?? tool.text) };
}

function normalizeToolName(name: string | undefined): string {
	return name?.trim().toLowerCase().replace(/^.*[./:]/, "") ?? "";
}

function readFileTarget(record: Record<string, unknown> | undefined): string | undefined {
	const raw = readFirstString(record, ["path", "filePath", "file_path", "filename", "file", "target"]);
	return raw ? basename(raw) : undefined;
}

function readCommandTarget(record: Record<string, unknown> | undefined): string | undefined {
	return readFirstString(record, ["command", "cmd", "script", "input", "args"]);
}

function readSearchTarget(record: Record<string, unknown> | undefined): string | undefined {
	return readFirstString(record, ["pattern", "query", "path", "glob", "command", "cmd", "input"]);
}

function readGenericToolTarget(record: Record<string, unknown> | undefined): string | undefined {
	return readFirstString(record, ["path", "filePath", "file_path", "command", "cmd", "query", "pattern", "input", "text"]);
}

function readFirstString(record: Record<string, unknown> | undefined, keys: string[]): string | undefined {
	if (!record) {
		return undefined;
	}
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
		if (Array.isArray(value) && value.length) {
			return value.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join(" ").trim();
		}
	}
	return undefined;
}

function basename(path: string): string {
	const normalized = path.trim().replace(/\\/g, "/");
	return normalized.split("/").filter(Boolean).at(-1) ?? normalized;
}

function truncateToolText(text: string | undefined, maxLength = 100): string {
	const normalized = (text ?? "").replace(/\s+/g, " ").trim();
	return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function formatToolContent(value: unknown): string {
	if (value === undefined || value === null) {
		return "";
	}
	if (typeof value === "string") {
		return value;
	}
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function deriveSessionOptions(events: AgentEventLogEntry[], currentSessionKey: string, language: "zh" | "en"): SessionOption[] {
	const latestByKey = new Map<string, string>();
	for (const entry of events) {
		const key = entry.conversationKey ?? "desktop";
		latestByKey.set(key, entry.timestamp);
	}
	latestByKey.set(currentSessionKey, latestByKey.get(currentSessionKey) ?? new Date().toISOString());
	const sorted = [...latestByKey.entries()]
		.sort((left, right) => Date.parse(right[1]) - Date.parse(left[1]))
		.slice(0, 8);
	return sorted.map(([key, timestamp]) => ({
		key,
		label: key === currentSessionKey
			? language === "en" ? `Current: ${key}` : `当前：${key}`
			: `${key} · ${new Date(timestamp).toLocaleString()}`,
	}));
}

function formatResumeHint(sessions: SessionOption[], language: "zh" | "en"): string {
	if (sessions.length <= 1) {
		return language === "en" ? "No other desktop sessions yet." : "还没有其他桌面会话。";
	}
	return language === "en" ? "Choose a session from the Resume menu." : "请从 Resume 菜单选择要恢复的会话。";
}

function isInformationalCompactError(message: string): boolean {
	const normalized = message.toLowerCase();
	return normalized.includes("already compacted") || normalized.includes("nothing to compact");
}

function formatCompactInfoMessage(message: string, language: "zh" | "en"): string {
	const normalized = message.toLowerCase();
	if (normalized.includes("already compacted")) {
		return language === "en" ? "Current session has already been compacted." : "当前会话已经压缩过。";
	}
	if (normalized.includes("nothing to compact")) {
		return language === "en" ? "There is not enough session context to compact yet." : "当前会话内容还不需要压缩。";
	}
	return message;
}

function formatCommandResult(
	command: "new" | "status" | "compact" | "clear",
	result: AgentChatSessionCommandResult,
	language: "zh" | "en",
): string {
	if (command === "new") {
		return language === "en" ? `Started new session ${result.sessionKey}.` : `已开启新会话 ${result.sessionKey}。`;
	}
	if (command === "clear") {
		const count = result.clearedEvents ?? 0;
		return language === "en" ? `Cleared current session history (${count} events).` : `已清空当前会话历史（${count} 条事件）。`;
	}
	if (command === "compact") {
		return language === "en" ? "Compacted current session context." : "已压缩当前会话上下文。";
	}
	if (result.status) {
		return formatSessionStatus(result.status, result.sessionKey, language);
	}
	return language === "en" ? `Session ${result.sessionKey} is available.` : `会话 ${result.sessionKey} 可用。`;
}

function formatSessionStatus(status: AgentChatSessionStatus, sessionKey: string, language: "zh" | "en"): string {
	const lines = language === "en"
		? [`Session: ${sessionKey}`, `Messages: ${status.totalMessages}`]
		: [`会话：${sessionKey}`, `消息数：${status.totalMessages}`];
	const usage = status.contextUsage;
	if (!usage) {
		lines.push(language === "en" ? "Context: unavailable for this harness." : "Context：当前 harness 未提供上下文用量。");
		return lines.join("\n");
	}
	const windowText = formatTokens(usage.contextWindow);
	if (usage.tokens === null || usage.percent === null) {
		lines.push(language === "en" ? `Context: unknown / ${windowText}` : `Context：未知 / ${windowText}`);
		return lines.join("\n");
	}
	lines.push(language === "en" ? `Context: ${formatTokens(usage.tokens)} / ${windowText}` : `Context：${formatTokens(usage.tokens)} / ${windowText}`);
	lines.push(language === "en" ? `Usage: ${formatPercent(usage.percent)}` : `占用：${formatPercent(usage.percent)}`);
	return lines.join("\n");
}

function formatTokens(value: number): string {
	if (value >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(1)}M`;
	}
	if (value >= 1_000) {
		return `${Math.round(value / 100) / 10}K`;
	}
	return String(value);
}

function formatPercent(value: number): string {
	if (value <= 1) {
		return `${Math.round(value * 100)}%`;
	}
	return `${Math.round(value)}%`;
}

function formatAgentStatus(agent: AgentDetails, resources: AgentResourceStats | undefined, language: "zh" | "en"): string {
	const lifecycle = runtimeLifecycleLabel(agent.runtimeEnvironment?.lifecycle.state, language);
	const workDir = agent.runtimeEnvironment?.workDir ?? agent.home;
	const memory = resources?.memoryBytes ? `${Math.round(resources.memoryBytes / 1024 / 1024)}MB` : language === "en" ? "unknown" : "未知";
	if (language === "en") {
		return [
			`Status: ${statusLabel(agent.status, language)} / ${lifecycle}`,
			`Harness: ${agent.harnessKind ?? "pi"}`,
			`Work dir: ${workDir}`,
			`Memory: ${memory}`,
		].join("\n");
	}
	return [
		`状态：${statusLabel(agent.status, language)} / ${lifecycle}`,
		`Harness：${agent.harnessKind ?? "pi"}`,
		`工作目录：${workDir}`,
		`内存：${memory}`,
	].join("\n");
}

function agentLogEntryKey(entry: AgentLogEntry): string {
	return `${entry.agentId}:${entry.id}:${entry.timestamp}`;
}

function agentEventEntryKey(entry: AgentEventLogEntry): string {
	const event = readEvent(entry.event);
	const eventType = readString(event?.type) ?? "event";
	const messageId = readString(event?.messageId);
	if (eventType === "user_message" && messageId) {
		return `${entry.conversationKey ?? ""}:${eventType}:${messageId}`;
	}
	const eventId = readString(event?.textId) ??
		readString(event?.toolCallId) ??
		readString(event?.runId) ??
		"";
	return `${entry.conversationKey ?? ""}:${entry.timestamp}:${eventType}:${eventId}`;
}

function mergeAgentEvents(current: AgentEventLogEntry[], entries: AgentEventLogEntry[]): AgentEventLogEntry[] {
	const merged = current.slice();
	const indexByKey = new Map<string, number>();
	for (let index = 0; index < merged.length; index += 1) {
		indexByKey.set(agentEventEntryKey(merged[index]!), index);
	}
	for (const entry of entries) {
		const key = agentEventEntryKey(entry);
		const existingIndex = indexByKey.get(key);
		if (existingIndex === undefined) {
			indexByKey.set(key, merged.length);
			merged.push(entry);
		} else {
			merged[existingIndex] = entry;
		}
	}
	return merged.sort(compareAgentEventEntries).slice(-1000);
}

function compareAgentEventEntries(left: AgentEventLogEntry, right: AgentEventLogEntry): number {
	const timestampOrder = Date.parse(left.timestamp) - Date.parse(right.timestamp);
	if (timestampOrder !== 0) {
		return timestampOrder;
	}
	return (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER);
}

function mergeAgentLogs(current: AgentLogEntry[], entries: AgentLogEntry[]): AgentLogEntry[] {
	const merged = current.slice();
	const indexByKey = new Map<string, number>();
	for (let index = 0; index < merged.length; index += 1) {
		indexByKey.set(agentLogEntryKey(merged[index]!), index);
	}
	for (const entry of entries) {
		const key = agentLogEntryKey(entry);
		const existingIndex = indexByKey.get(key);
		if (existingIndex === undefined) {
			indexByKey.set(key, merged.length);
			merged.push(entry);
		} else {
			merged[existingIndex] = entry;
		}
	}
	return merged.sort(compareAgentLogEntries).slice(-1000);
}

function compareAgentLogEntries(left: AgentLogEntry, right: AgentLogEntry): number {
	const timestampOrder = Date.parse(left.timestamp) - Date.parse(right.timestamp);
	if (timestampOrder !== 0) {
		return timestampOrder;
	}
	return left.id - right.id;
}
