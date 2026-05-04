import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentDetails, AgentLogEntry } from "../../../shared/types";
import { cn } from "../../lib/utils";

const LOG_AUTO_FOLLOW_RESUME_MS = 2000;

export function TerminalLog({ agent, tone = "light" }: { agent: AgentDetails; tone?: "light" | "dark" }): JSX.Element {
	const [logs, setLogs] = useState<AgentLogEntry[]>([]);
	const terminalRef = useRef<HTMLDivElement | null>(null);
	const pendingEntriesRef = useRef<AgentLogEntry[]>([]);
	const flushFrameRef = useRef<number | null>(null);
	const autoFollowRef = useRef(true);
	const scrollResumeTimerRef = useRef<number | null>(null);
	const programmaticScrollRef = useRef(false);

	const scrollToBottom = () => {
		const node = terminalRef.current;
		if (!node) {
			return;
		}
		programmaticScrollRef.current = true;
		node.scrollTop = node.scrollHeight;
		window.requestAnimationFrame(() => {
			programmaticScrollRef.current = false;
		});
	};

	const pauseAutoFollowForUserScroll = () => {
		if (programmaticScrollRef.current) {
			return;
		}
		autoFollowRef.current = false;
		if (scrollResumeTimerRef.current !== null) {
			window.clearTimeout(scrollResumeTimerRef.current);
		}
		scrollResumeTimerRef.current = window.setTimeout(() => {
			scrollResumeTimerRef.current = null;
			autoFollowRef.current = true;
			scrollToBottom();
		}, LOG_AUTO_FOLLOW_RESUME_MS);
	};

	useEffect(() => {
		let cancelled = false;
		const flushPendingEntries = () => {
			flushFrameRef.current = null;
			const pendingEntries = pendingEntriesRef.current;
			pendingEntriesRef.current = [];
			if (!pendingEntries.length) {
				return;
			}
			setLogs((current) => mergeAgentLogs(current, pendingEntries));
		};
		const scheduleFlush = () => {
			if (flushFrameRef.current !== null) {
				return;
			}
			flushFrameRef.current = window.requestAnimationFrame(flushPendingEntries);
		};
		window.pie.getAgentLogs(agent.id).then((entries) => {
			if (!cancelled) {
				setLogs(entries);
			}
		}).catch(() => {
			if (!cancelled) {
				setLogs([]);
			}
		});
		const unsubscribe = window.pie.onAgentLog((entry) => {
			if (entry.agentId !== agent.id) {
				return;
			}
			pendingEntriesRef.current.push(entry);
			scheduleFlush();
		});
		return () => {
			cancelled = true;
			pendingEntriesRef.current = [];
			if (flushFrameRef.current !== null) {
				window.cancelAnimationFrame(flushFrameRef.current);
				flushFrameRef.current = null;
			}
			unsubscribe();
		};
	}, [agent.id]);

	useEffect(() => {
		autoFollowRef.current = true;
		if (scrollResumeTimerRef.current !== null) {
			window.clearTimeout(scrollResumeTimerRef.current);
			scrollResumeTimerRef.current = null;
		}
		return () => {
			if (scrollResumeTimerRef.current !== null) {
				window.clearTimeout(scrollResumeTimerRef.current);
				scrollResumeTimerRef.current = null;
			}
		};
	}, [agent.id]);

	useLayoutEffect(() => {
		if (!autoFollowRef.current) {
			return;
		}
		scrollToBottom();
		const frame = window.requestAnimationFrame(scrollToBottom);
		return () => window.cancelAnimationFrame(frame);
	}, [logs]);

	const lines = logs.length
		? logs
		: [{
				id: 0,
				agentId: agent.id,
				stream: "system" as const,
				text: agent.status === "running" ? "waiting for bot output..." : "bot is not running. click start to stream logs here.",
				timestamp: new Date().toISOString(),
			}];

	return (
		<div
			ref={(node) => { terminalRef.current = node; }}
			onScroll={pauseAutoFollowForUserScroll}
			onWheel={pauseAutoFollowForUserScroll}
			onTouchMove={pauseAutoFollowForUserScroll}
			onPointerDown={pauseAutoFollowForUserScroll}
			className={cn(
					"min-h-0 flex-1 overflow-y-auto px-3.5 pb-3 pt-0 font-mono text-[12px] leading-[16px] [scrollbar-gutter:stable]",
				tone === "dark" ? "text-slate-100" : "text-[var(--slate-12)]",
			)}
		>
			{lines.map((line) => (
				<LogLine key={line.id} line={line} tone={tone} />
			))}
		</div>
	);
}

const LogLine = memo(function LogLine({ line, tone }: { line: AgentLogEntry; tone: "light" | "dark" }): JSX.Element {
	return (
		<div className="grid grid-cols-[3ch_9ch_minmax(0,1fr)] gap-x-2">
			<span className={cn(
				"text-right font-medium",
				tone === "dark"
					? line.stream === "stderr" ? "text-red-300" : line.stream === "system" ? "text-slate-500" : "text-lime-300"
					: line.stream === "stderr" ? "text-[var(--red-11)]" : line.stream === "system" ? "text-[var(--slate-10)]" : "text-[var(--lime-11)]",
			)}>
				{line.stream === "stderr" ? "err" : line.stream === "system" ? "sys" : "out"}
			</span>
			<span className={cn("font-normal tabular-nums", tone === "dark" ? "text-slate-500" : "text-[var(--slate-9)]")}>{new Date(line.timestamp).toLocaleTimeString()}</span>
			<span className={cn(
				"min-w-0 whitespace-pre-wrap break-words text-pretty",
				tone === "dark"
					? line.stream === "stderr" ? "text-red-200" : line.stream === "system" ? "text-slate-400" : "text-slate-100"
					: line.stream === "stderr" ? "text-[var(--red-12)]" : line.stream === "system" ? "text-[var(--slate-11)]" : "text-[var(--slate-12)]",
			)}>
				{line.text}
			</span>
		</div>
	);
});

function agentLogEntryKey(entry: AgentLogEntry): string {
	return `${entry.agentId}:${entry.id}:${entry.timestamp}`;
}

function mergeAgentLogs(current: AgentLogEntry[], entries: AgentLogEntry[]): AgentLogEntry[] {
	const merged = current.slice();
	const indexByKey = new Map<string, number>();
	for (let index = 0; index < merged.length; index += 1) {
		indexByKey.set(agentLogEntryKey(merged[index]!), index);
	}
	let appended = false;
	for (const entry of entries) {
		const key = agentLogEntryKey(entry);
		const index = indexByKey.get(key);
		if (index === undefined) {
			indexByKey.set(key, merged.length);
			merged.push(entry);
			appended = true;
			continue;
		}
		merged[index] = entry;
	}
	const sorted = appended ? merged.sort(compareAgentLogEntries) : merged;
	return sorted.length > 1000 ? sorted.slice(-1000) : sorted;
}

function compareAgentLogEntries(left: AgentLogEntry, right: AgentLogEntry): number {
	const timestampOrder = Date.parse(left.timestamp) - Date.parse(right.timestamp);
	if (timestampOrder !== 0) {
		return timestampOrder;
	}
	return left.id - right.id;
}
