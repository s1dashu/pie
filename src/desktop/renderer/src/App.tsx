import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ChartSquareBoldDuotone,
	CheckCircleLineDuotone,
	CloseCircleBoldDuotone,
	CodeSquareBoldDuotone,
	CPUBoltBoldDuotone,
	FolderOpenBoldDuotone,
	PauseCircleBoldDuotone,
	PenLineDuotone,
	PlayCircleBoldDuotone,
	RadioMinimalisticBoldDuotone,
	RestartCircleBoldDuotone,
	SettingsMinimalisticBoldDuotone,
	ShieldStarBoldDuotone,
	SmileCircleBoldDuotone,
	TrashBinMinimalisticBoldDuotone,
	Widget5BoldDuotone,
	type SolarIconProps,
} from "solar-icon-set";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Avatar, { genConfig } from "react-nice-avatar";
import type {
	AgentCreationSession,
	AgentDetails,
	AgentDraft,
	AgentLogEntry,
	AgentOnboardEvent,
	AgentSummary,
	AgentUsageStats,
	DesktopFeishuAppCredentials,
	DesktopModelOption,
	DesktopThinkingLevel,
} from "../../shared/types";
import { Checkbox } from "./components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { cn } from "./lib/utils";

function AppIcon({
	IconComponent,
	className,
	color = "currentColor",
}: {
	IconComponent: (props: SolarIconProps) => JSX.Element;
	className?: string;
	color?: string;
}): JSX.Element {
	return <IconComponent className={className} color={color} />;
}

function statusTone(status: AgentSummary["status"]): string {
	if (status === "running") {
		return "bg-primary";
	}
	if (status === "paused") {
		return "bg-accent";
	}
	return "bg-border";
}

function statusLabel(status: AgentSummary["status"]): string {
	if (status === "running") {
		return "运行中";
	}
	if (status === "paused") {
		return "已暂停";
	}
	return "未启动";
}

function AgentAvatar({ seed, size = 44 }: { seed: string; size?: number }): JSX.Element {
	const config = useMemo(() => genConfig(seed), [seed]);
	return (
		<div
			className="agent-avatar-frame shrink-0 overflow-hidden rounded-full bg-white"
			style={{ width: size, height: size }}
		>
			<Avatar className="h-full w-full" {...config} />
		</div>
	);
}

function ErrorToast({ message, onClose }: { message: string; onClose: () => void }): JSX.Element {
	return (
		<div className="absolute bottom-4 left-4 right-4 z-50 flex items-start gap-2 rounded-2xl bg-[var(--red-2)] px-4 py-3 text-sm text-[var(--red-11)]">
			<span className="flex-1">{message}</span>
			<button type="button" onClick={onClose} className="shrink-0 rounded-full p-1 hover:bg-[var(--red-4)]" aria-label="Dismiss">
				<AppIcon IconComponent={CloseCircleBoldDuotone} className="h-4 w-4" color="var(--red-11)" />
			</button>
		</div>
	);
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
	return (
		<label className="block">
			<span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
			{children}
		</label>
	);
}

const inputClass =
	"no-drag h-10 w-full rounded-2xl border border-transparent bg-white px-3 text-sm outline-none transition placeholder:text-muted-foreground hover:border-[var(--lime-8)] focus:border-primary focus:bg-white";

const thinkingLevelOptions: Array<{ value: DesktopThinkingLevel; label: string }> = [
	{ value: "off", label: "off" },
	{ value: "minimal", label: "minimal" },
	{ value: "low", label: "low" },
	{ value: "medium", label: "medium" },
	{ value: "high", label: "high" },
	{ value: "xhigh", label: "xhigh" },
];

const brandOptions: Array<{ value: "feishu" | "lark"; label: string }> = [
	{ value: "feishu", label: "Feishu" },
	{ value: "lark", label: "Lark" },
];

type AgentTab = "overview" | "model" | "skills" | "usage" | "channels";

const tabs: Array<{ id: AgentTab; label: string; icon: (props: SolarIconProps) => JSX.Element }> = [
	{ id: "overview", label: "概览", icon: Widget5BoldDuotone },
	{ id: "usage", label: "用量统计", icon: ChartSquareBoldDuotone },
	{ id: "model", label: "模型配置", icon: CodeSquareBoldDuotone },
	{ id: "skills", label: "Skills 配置", icon: ShieldStarBoldDuotone },
	{ id: "channels", label: "渠道管理", icon: RadioMinimalisticBoldDuotone },
];

function CompactMetric({ label, value }: { label: string; value: string }): JSX.Element {
	return (
		<div className="min-w-0 rounded-[36px] bg-[var(--slate-2)] p-4">
			<div className="truncate text-xs font-medium uppercase text-muted-foreground">{label}</div>
			<div className="mt-2 text-base font-semibold leading-none text-foreground">{value}</div>
		</div>
	);
}

function UsageMetric({ label, value, detail }: { label: string; value: string; detail: string }): JSX.Element {
	return (
		<div className="rounded-[36px] bg-[var(--slate-2)] p-4">
			<div className="text-xs font-medium text-muted-foreground">{label}</div>
			<div className="mt-2 text-2xl font-semibold text-foreground">{value}</div>
			<div className="mt-1 text-xs text-muted-foreground">{detail}</div>
		</div>
	);
}

function formatCount(value: number): string {
	return new Intl.NumberFormat("zh-CN").format(value);
}

function formatDuration(ms: number): string {
	if (ms < 60_000) {
		return `${Math.floor(ms / 1000)}s`;
	}
	if (ms < 3_600_000) {
		return `${Math.floor(ms / 60_000)}m`;
	}
	const hours = Math.floor(ms / 3_600_000);
	const minutes = Math.floor((ms % 3_600_000) / 60_000);
	return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function emptyUsage(): AgentUsageStats {
	return {
		today: { incomingMessages: 0, outgoingMessages: 0, actions: 0, failedActions: 0, tokens: 0, runDurationMs: 0 },
		total: { incomingMessages: 0, outgoingMessages: 0, actions: 0, failedActions: 0, tokens: 0, runDurationMs: 0 },
		recentDays: [],
		updatedAt: new Date(0).toISOString(),
	};
}

function UsageTrend({ usage }: { usage: AgentUsageStats }): JSX.Element {
	const days = usage.recentDays.slice(-7);
	const maxValue = Math.max(1, ...days.map((day) => day.tokens));
	return (
		<div className="flex h-52 items-end gap-2 pt-5">
			{days.length ? days.map((day) => {
				return (
					<div key={day.date} className="flex min-w-0 flex-1 flex-col items-center gap-2">
						<div className="flex h-36 w-full items-end rounded-2xl bg-[var(--slate-1)] px-1.5 py-1.5">
							<div
								className="w-full rounded-xl bg-primary"
								style={{ height: `${Math.max(6, Math.round((day.tokens / maxValue) * 100))}%` }}
								title={`${day.date}: ${formatCount(day.tokens)} token`}
							/>
						</div>
						<div className="w-full truncate text-center text-xs text-muted-foreground">{day.date.slice(5)}</div>
					</div>
				);
			}) : (
				<div className="flex h-full w-full items-center justify-center rounded-[36px] bg-[var(--slate-2)] text-sm text-muted-foreground">
					暂无用量数据
				</div>
			)}
		</div>
	);
}

function TerminalLog({ agent }: { agent: AgentDetails }): JSX.Element {
	const [logs, setLogs] = useState<AgentLogEntry[]>([]);
	const terminalRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		let cancelled = false;
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
			setLogs((current) => {
				const existingIndex = current.findIndex((line) => line.id === entry.id);
				if (existingIndex !== -1) {
					const next = [...current];
					next[existingIndex] = entry;
					return next;
				}
				return [...current.slice(-999), entry];
			});
		});
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [agent.id]);

	useLayoutEffect(() => {
		if (terminalRef.current) {
			const node = terminalRef.current;
			node.scrollTop = node.scrollHeight;
			const frame = window.requestAnimationFrame(() => {
				node.scrollTop = node.scrollHeight;
			});
			return () => window.cancelAnimationFrame(frame);
		}
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
		<div ref={(node) => { terminalRef.current = node; }} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-0 font-mono text-xs leading-5 text-[#24292f] [scrollbar-gutter:stable]">
			{lines.map((line) => (
				<div key={line.id} className="grid grid-cols-[3ch_9ch_minmax(0,1fr)] gap-x-2">
					<span className={cn(
						"text-right font-bold",
						line.stream === "stderr" ? "text-[#d1242f]" : line.stream === "system" ? "text-[#0969da]" : "text-[#1a7f37]",
					)}>
						{line.stream === "stderr" ? "err" : line.stream === "system" ? "sys" : "out"}
					</span>
					<span className="font-medium text-[#8250df]">{new Date(line.timestamp).toLocaleTimeString()}</span>
					<span className={cn(
						"min-w-0 whitespace-pre-wrap break-words",
						line.stream === "stderr" ? "text-[#82071e]" : line.stream === "system" ? "text-[#0550ae]" : "text-[#24292f]",
					)}>
						{line.text}
					</span>
				</div>
			))}
		</div>
	);
}

function CreateAgentDialog({
	open,
	onClose,
	onCreated,
	onError,
}: {
	open: boolean;
	onClose: () => void;
	onCreated: (agent: AgentDetails) => void;
	onError: (message: string) => void;
}): JSX.Element | null {
	const [session, setSession] = useState<AgentCreationSession | undefined>();
	const [step, setStep] = useState<"config" | "auth" | "model">("config");
	const [name, setName] = useState("");
	const [manualMode, setManualMode] = useState(false);
	const [feishu, setFeishu] = useState<DesktopFeishuAppCredentials | undefined>();
	const [qrEvent, setQrEvent] = useState<AgentOnboardEvent | undefined>();
	const [status, setStatus] = useState("");
	const [provider, setProvider] = useState("kimi-coding");
	const [model, setModel] = useState("k2p6");
	const [thinkingLevel, setThinkingLevel] = useState<DesktopThinkingLevel>("off");
	const [apiKey, setApiKey] = useState("");
	const queryClient = useQueryClient();

	const begin = useMutation({
		mutationFn: () => window.pie.beginAgentCreation(),
		onSuccess: (created) => {
			setSession(created);
			setName(created.name);
			const defaultProvider = created.providers.includes("kimi-coding") ? "kimi-coding" : created.providers[0] ?? "kimi-coding";
			const defaultModel = defaultProvider === "kimi-coding"
				? "k2p6"
				: created.models.find((item) => item.provider === defaultProvider)?.id ?? "";
			setProvider(defaultProvider);
			setModel(defaultModel);
			setStep("config");
		},
		onError: (err: Error) => onError(err.message),
	});
	const createFeishu = useMutation({
		mutationFn: (sessionId: string) => window.pie.createFeishuApp(sessionId),
		onSuccess: (created) => {
			setFeishu(created);
			setStep("model");
		},
		onError: (err: Error) => onError(err.message),
	});
	const complete = useMutation({
		mutationFn: () => {
			if (!session || !feishu) {
				throw new Error("创建流程尚未完成");
			}
			return window.pie.completeAgentCreation({
				sessionId: session.sessionId,
				name,
				feishu,
				provider,
				model,
				thinkingLevel,
				apiKey,
			});
		},
		onSuccess: async (agent) => {
			await queryClient.invalidateQueries({ queryKey: ["agents"] });
			onCreated(agent);
			onClose();
		},
		onError: (err: Error) => onError(err.message),
	});

	useEffect(() => {
		if (!open) {
			return;
		}
		begin.mutate();
	}, [open]);

	useEffect(() => {
		return window.pie.onAgentOnboardEvent((event) => {
			if (event.sessionId !== session?.sessionId) {
				return;
			}
			if (event.type === "qr") {
				setQrEvent(event);
			}
			if (event.message) {
				setStatus(event.message);
			}
			if (event.feishu) {
				setFeishu(event.feishu);
			}
		});
	}, [session?.sessionId]);

	if (!open) {
		return null;
	}

	const modelsForProvider = session?.models.filter((item) => item.provider === provider) ?? [];
	const providers = session?.providers.length ? session.providers : [provider];

	return (
		<div className="absolute inset-0 z-40 flex items-center justify-center bg-[var(--black-a6)] px-6">
			<div className="no-drag flex w-full max-w-2xl flex-col rounded-[28px] bg-white">
				<div className="flex h-14 items-center justify-between px-5">
					<div className="text-sm font-semibold text-foreground">创建 Bot</div>
					<button type="button" onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-[var(--slate-3)] hover:text-foreground" aria-label="Close">
						<AppIcon IconComponent={CloseCircleBoldDuotone} className="h-4 w-4" />
					</button>
				</div>
				<div className="grid grid-cols-[180px_1fr]">
					<div className="m-3 rounded-3xl bg-[var(--slate-2)] p-3 text-sm">
						<div className={cn("rounded-2xl px-3 py-2", step === "config" && "bg-[var(--lime-3)] text-[var(--lime-12)]")}>1. 开启配置</div>
						<div className={cn("mt-1 rounded-2xl px-3 py-2", step === "auth" && "bg-[var(--lime-3)] text-[var(--lime-12)]")}>2. 扫码授权</div>
						<div className={cn("mt-1 rounded-2xl px-3 py-2", step === "model" && "bg-[var(--lime-3)] text-[var(--lime-12)]")}>3. 模型与 Key</div>
					</div>
					<div className="min-h-[390px] p-5">
						{begin.isPending || !session ? (
							<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
								<AppIcon IconComponent={RestartCircleBoldDuotone} className="mr-2 h-4 w-4 animate-spin" /> 正在初始化配置...
							</div>
						) : step === "config" ? (
							<div className="space-y-4">
								<Field label="Bot 名称">
									<input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} />
								</Field>
								<div className="rounded-2xl bg-[var(--slate-2)] px-3 py-2 text-xs leading-relaxed text-muted-foreground">
									配置会保存到 {session.home}。语言设置不在创建流程内，请在左下角全局设置里配置。
								</div>
								<div className="flex justify-end">
									<button
										type="button"
										className="rounded-2xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
										onClick={() => {
											setStep("auth");
											setStatus("");
											setQrEvent(undefined);
											createFeishu.mutate(session.sessionId);
										}}
									>
										开始扫码授权
									</button>
								</div>
							</div>
						) : step === "auth" ? (
							<div className="space-y-4">
								<div className="text-sm font-medium text-foreground">扫码授权，创建飞书/Lark bot</div>
								<div className="rounded-3xl bg-[var(--slate-2)] p-4">
									{qrEvent?.qr ? (
											<pre className="overflow-auto whitespace-pre font-mono text-[8px] leading-[8px] text-foreground">{qrEvent.qr}</pre>
									) : (
										<div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
											<AppIcon IconComponent={RestartCircleBoldDuotone} className="mr-2 h-4 w-4 animate-spin" /> 等待二维码...
										</div>
									)}
								</div>
								{qrEvent?.url ? <div className="break-all text-xs text-muted-foreground">{qrEvent.url}</div> : null}
								<div className="text-xs text-muted-foreground">{status || "请使用飞书或 Lark 扫码。"}</div>
								<button type="button" className="text-xs text-muted-foreground underline" onClick={() => setManualMode(true)}>
									改为手动填写已有应用
								</button>
								{manualMode ? (
									<div className="grid grid-cols-2 gap-3 rounded-3xl bg-[var(--slate-2)] p-3">
										<input className={inputClass} placeholder="App ID" onChange={(event) => setFeishu((old) => ({ appId: event.target.value, appSecret: old?.appSecret ?? "", brand: old?.brand ?? "feishu" }))} />
										<input className={inputClass} placeholder="App Secret" type="password" onChange={(event) => setFeishu((old) => ({ appId: old?.appId ?? "", appSecret: event.target.value, brand: old?.brand ?? "feishu" }))} />
										<Select
											value={feishu?.brand ?? "feishu"}
											onValueChange={(value) => setFeishu((old) => ({ appId: old?.appId ?? "", appSecret: old?.appSecret ?? "", brand: value as "feishu" | "lark" }))}
										>
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{brandOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
											</SelectContent>
										</Select>
										<button type="button" className="rounded-2xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" onClick={() => feishu?.appId && feishu.appSecret ? setStep("model") : onError("请填写 App ID 和 App Secret")}>
											继续
										</button>
									</div>
								) : null}
							</div>
						) : (
							<div className="space-y-4">
								<div className="grid grid-cols-2 gap-4">
									<Field label="供应商">
										<Select
											value={provider}
											onValueChange={(nextProvider) => {
												setProvider(nextProvider);
												setModel(session.models.find((item) => item.provider === nextProvider)?.id ?? "");
											}}
										>
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{providers.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
											</SelectContent>
										</Select>
									</Field>
									<Field label="模型">
										{modelsForProvider.length ? (
											<Select value={model} onValueChange={setModel}>
												<SelectTrigger>
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{modelsForProvider.map((item) => <SelectItem key={item.id} value={item.id}>{item.name && item.name !== item.id ? `${item.id} · ${item.name}` : item.id}</SelectItem>)}
												</SelectContent>
											</Select>
										) : (
											<input className={inputClass} value={model} onChange={(event) => setModel(event.target.value)} placeholder="model id" />
										)}
									</Field>
								</div>
								<Field label="API Key">
									<input className={inputClass} type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="留空则使用已有环境变量或稍后补充" />
								</Field>
								<Field label="Thinking Level">
									<Select value={thinkingLevel} onValueChange={(value) => setThinkingLevel(value as DesktopThinkingLevel)}>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{thinkingLevelOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
										</SelectContent>
									</Select>
								</Field>
								<div className="flex justify-end">
									<button
										type="button"
										className="rounded-2xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
										disabled={complete.isPending}
										onClick={() => complete.mutate()}
									>
										创建 Bot
									</button>
								</div>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

function AgentEditor({
	agent,
	onError,
	onDeleted,
}: {
	agent: AgentDetails;
	onError: (message: string) => void;
	onDeleted: () => void;
}): JSX.Element {
	const queryClient = useQueryClient();
	const [activeTab, setActiveTab] = useState<AgentTab>("overview");
	const tabListRef = useRef<HTMLDivElement | null>(null);
	const tabButtonRefs = useRef<Partial<Record<AgentTab, HTMLButtonElement>>>({});
	const tabContentRefs = useRef<Partial<Record<AgentTab, HTMLSpanElement>>>({});
	const nameInputRef = useRef<HTMLInputElement | null>(null);
	const [tabIndicator, setTabIndicator] = useState({ left: 0, width: 0 });
	const [isEditingName, setIsEditingName] = useState(false);
	const [draft, setDraft] = useState<AgentDraft>({
		name: agent.name,
		provider: agent.model?.provider ?? "kimi-coding",
		model: agent.model?.model ?? "k2p6",
		thinkingLevel: agent.model?.thinkingLevel as DesktopThinkingLevel ?? "off",
		outputToolCallsToIm: agent.model?.outputToolCallsToIm ?? false,
	});
	const [channelDraft, setChannelDraft] = useState<AgentDraft>({
		appId: agent.appId ?? "",
		appSecret: agent.appSecret ?? "",
		brand: agent.brand ?? "feishu",
	});
	const [channelSaveMessage, setChannelSaveMessage] = useState<string | undefined>();
	const usageQuery = useQuery({
		queryKey: ["agent-usage", agent.id],
		queryFn: () => window.pie.getAgentUsage(agent.id),
		refetchInterval: agent.status === "running" ? 5000 : 15000,
	});
	const modelCatalogQuery = useQuery({
		queryKey: ["agent-model-catalog", agent.id],
		queryFn: () => window.pie.getAgentModelCatalog(agent.id),
	});
	const usage = usageQuery.data ?? emptyUsage();
	const todayMessages = usage.today.incomingMessages + usage.today.outgoingMessages;
	const totalMessages = usage.total.incomingMessages + usage.total.outgoingMessages;
	const providerOptions = useMemo(() => {
		const values = new Set(modelCatalogQuery.data?.providers ?? []);
		if (draft.provider) {
			values.add(draft.provider);
		}
		return [...values].sort((left, right) => left.localeCompare(right));
	}, [draft.provider, modelCatalogQuery.data?.providers]);
	const modelOptions = useMemo<DesktopModelOption[]>(() => {
		const provider = draft.provider ?? "";
		const options = (modelCatalogQuery.data?.models ?? []).filter((item) => item.provider === provider);
		if (draft.model && !options.some((item) => item.id === draft.model)) {
			return [{ id: draft.model, provider, name: "Current configuration" }, ...options];
		}
		return options;
	}, [draft.model, draft.provider, modelCatalogQuery.data?.models]);

	useLayoutEffect(() => {
		const updateIndicator = () => {
			const list = tabListRef.current;
			const content = tabContentRefs.current[activeTab];
			if (!list || !content) {
				return;
			}
			const listRect = list.getBoundingClientRect();
			const contentRect = content.getBoundingClientRect();
			setTabIndicator({
				left: contentRect.left - listRect.left,
				width: contentRect.width,
			});
		};

		updateIndicator();
		const frame = window.requestAnimationFrame(updateIndicator);
		window.addEventListener("resize", updateIndicator);
		return () => {
			window.cancelAnimationFrame(frame);
			window.removeEventListener("resize", updateIndicator);
		};
	}, [activeTab]);

	useEffect(() => {
		setDraft({
			name: agent.name,
			provider: agent.model?.provider ?? "kimi-coding",
			model: agent.model?.model ?? "k2p6",
			thinkingLevel: agent.model?.thinkingLevel as DesktopThinkingLevel ?? "off",
			outputToolCallsToIm: agent.model?.outputToolCallsToIm ?? false,
		});
		setChannelDraft({
			appId: agent.appId ?? "",
			appSecret: agent.appSecret ?? "",
			brand: agent.brand ?? "feishu",
		});
		setChannelSaveMessage(undefined);
		setIsEditingName(false);
	}, [agent]);

	useEffect(() => {
		if (isEditingName) {
			nameInputRef.current?.focus();
			nameInputRef.current?.select();
		}
	}, [isEditingName]);

	const update = useMutation({
		mutationFn: (newDraft: AgentDraft) => window.pie.updateAgent(agent.id, newDraft),
		onSuccess: async (updated) => {
			await queryClient.invalidateQueries({ queryKey: ["agents"] });
			queryClient.setQueryData(["agent", agent.id], updated);
		},
		onError: (err: Error) => onError(err.message),
	});
	const saveChannel = useMutation({
		mutationFn: (newDraft: AgentDraft) => window.pie.updateAgent(agent.id, newDraft),
		onSuccess: async (updated) => {
			await queryClient.invalidateQueries({ queryKey: ["agents"] });
			queryClient.setQueryData(["agent", agent.id], updated);
			setChannelSaveMessage("验证通过，渠道配置已保存。");
		},
		onError: (err: Error) => {
			setChannelSaveMessage(undefined);
			onError(err.message);
		},
	});
	const start = useMutation({
		mutationFn: () => window.pie.startAgent(agent.id),
		onSuccess: async (updated) => {
			await queryClient.invalidateQueries({ queryKey: ["agents"] });
			queryClient.setQueryData(["agent", agent.id], updated);
		},
		onError: (err: Error) => onError(err.message),
	});
	const pause = useMutation({
		mutationFn: () => window.pie.pauseAgent(agent.id),
		onSuccess: async (updated) => {
			await queryClient.invalidateQueries({ queryKey: ["agents"] });
			queryClient.setQueryData(["agent", agent.id], updated);
		},
		onError: (err: Error) => onError(err.message),
	});
	const remove = useMutation({
		mutationFn: async () => {
			if (agent.status === "running") {
				await window.pie.pauseAgent(agent.id);
			}
			return window.pie.deleteAgent(agent.id);
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["agents"] });
			onDeleted();
		},
		onError: (err: Error) => onError(err.message),
	});
	const revealFinder = useMutation({
		mutationFn: () => window.pie.revealAgentInFinder(agent.id),
		onError: (err: Error) => onError(err.message),
	});

	const updateField = (field: keyof AgentDraft, value: AgentDraft[keyof AgentDraft]) => {
		const newDraft = { ...draft, [field]: value };
		setDraft(newDraft);
		update.mutate(newDraft);
	};

	const commitNameEdit = () => {
		const nextName = (draft.name ?? "").trim();
		if (!nextName) {
			setDraft((current) => ({ ...current, name: agent.name }));
			setIsEditingName(false);
			return;
		}
		if (nextName === agent.name) {
			setDraft((current) => ({ ...current, name: nextName }));
			setIsEditingName(false);
			return;
		}
		const newDraft = { ...draft, name: nextName };
		setDraft(newDraft);
		setIsEditingName(false);
		update.mutate(newDraft);
	};

	const updateModelSelection = (nextDraft: AgentDraft) => {
		setDraft(nextDraft);
		update.mutate(nextDraft);
	};

	const updateChannelField = (field: keyof AgentDraft, value: string) => {
		setChannelSaveMessage(undefined);
		setChannelDraft((current) => ({ ...current, [field]: value }));
	};

	return (
		<div className="flex h-full flex-col bg-white">
			<div className="drag-region shrink-0 bg-white px-7 pb-2 pt-5">
				<div className="flex items-center justify-between gap-4">
					<div className="flex min-w-0 items-center gap-4">
						<AgentAvatar seed={agent.avatarSeed} size={40} />
						<div className="group/name no-drag flex min-w-0 items-center gap-1.5">
							{isEditingName ? (
								<div className="flex h-9 min-w-0 items-center rounded-[18px] bg-[var(--lime-3)] ring-2 ring-[var(--lime-8)]">
									<input
										ref={nameInputRef}
											className="h-full min-w-0 flex-1 bg-transparent px-3 text-xl font-semibold text-foreground caret-[var(--lime-11)] outline-none selection:bg-[var(--lime-6)]"
										value={draft.name ?? ""}
										onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
										onBlur={commitNameEdit}
										onKeyDown={(event) => {
											if (event.key === "Enter") {
												event.currentTarget.blur();
											}
											if (event.key === "Escape") {
												setDraft((current) => ({ ...current, name: agent.name }));
												setIsEditingName(false);
											}
										}}
										aria-label="Agent Name"
									/>
									<button
										type="button"
										className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--lime-11)] transition hover:bg-[var(--lime-5)] hover:text-[var(--lime-12)]"
										onMouseDown={(event) => event.preventDefault()}
										onClick={commitNameEdit}
										aria-label="保存 Agent 名称"
										title="保存"
									>
										<AppIcon IconComponent={CheckCircleLineDuotone} className="h-5 w-5" />
									</button>
								</div>
							) : (
								<>
										<div className="min-w-0 truncate text-xl font-semibold text-foreground">{draft.name}</div>
									<button
										type="button"
										className="no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-0 transition hover:bg-[var(--slate-3)] hover:text-[var(--lime-11)] group-hover/name:opacity-100 focus:opacity-100"
										onClick={() => setIsEditingName(true)}
										aria-label="编辑 Agent 名称"
										title="编辑名称"
									>
										<AppIcon IconComponent={PenLineDuotone} className="h-4 w-4" />
									</button>
								</>
							)}
							{update.isPending && <AppIcon IconComponent={RestartCircleBoldDuotone} className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />}
						</div>
					</div>
				<div className="no-drag flex items-center gap-2">
					{agent.status === "running" ? (
						<button
							type="button"
							className="inline-flex h-8 w-8 items-center justify-center text-[var(--slate-11)] transition hover:text-[var(--slate-12)]"
							onClick={() => pause.mutate()}
							title="Pause Agent"
							aria-label="Pause Agent"
						>
							<AppIcon IconComponent={PauseCircleBoldDuotone} className="h-7 w-7" />
						</button>
					) : (
						<button
							type="button"
							className="inline-flex h-8 w-8 items-center justify-center text-[var(--lime-11)] transition hover:text-[var(--lime-12)]"
							onClick={() => start.mutate()}
							title="Start Agent"
							aria-label="Start Agent"
						>
							<AppIcon IconComponent={PlayCircleBoldDuotone} className="h-7 w-7" />
						</button>
					)}
					<button
						type="button"
						className="inline-flex h-8 w-8 items-center justify-center text-[var(--lime-11)] transition hover:text-[var(--lime-12)]"
						onClick={() => revealFinder.mutate()}
						title="Open Agent Profile"
						aria-label="Open Agent Profile"
					>
						<AppIcon IconComponent={FolderOpenBoldDuotone} className="h-7 w-7" />
					</button>
					<button
						type="button"
						className="inline-flex h-8 w-8 items-center justify-center text-[var(--red-11)] transition hover:text-[var(--red-12)]"
						onClick={() => window.confirm(`删除 ${agent.name}？`) && remove.mutate()}
						title="Delete Agent"
						aria-label="Delete Agent"
					>
						<AppIcon IconComponent={TrashBinMinimalisticBoldDuotone} className="h-7 w-7" color="var(--red-11)" />
					</button>
				</div>
				</div>
			</div>

				<div ref={tabListRef} className="relative flex h-10 shrink-0 items-center gap-1 bg-white px-7">
					<div
						className="pointer-events-none absolute bottom-1 h-0.5 rounded-full bg-[var(--lime-9)] transition-[left,width] duration-200 ease-out"
						style={{ left: tabIndicator.left, width: tabIndicator.width }}
					/>
					{tabs.map((tab, index) => {
						return (
							<button
								key={tab.id}
								type="button"
								ref={(node) => {
									if (node) {
										tabButtonRefs.current[tab.id] = node;
									} else {
										delete tabButtonRefs.current[tab.id];
									}
								}}
								className={cn(
									"no-drag inline-flex h-7 items-center gap-1 pb-0.5 text-xs font-normal transition-colors",
									index === 0 ? "pl-0 pr-2" : "px-2",
									activeTab === tab.id
										? "text-[var(--lime-12)]"
										: "text-muted-foreground hover:text-foreground",
								)}
								onClick={() => setActiveTab(tab.id)}
							>
								<span
									ref={(node) => {
										if (node) {
											tabContentRefs.current[tab.id] = node;
										} else {
											delete tabContentRefs.current[tab.id];
										}
									}}
									className="agent-tabs-label relative z-10 inline-flex items-center gap-1.5"
								>
									<AppIcon IconComponent={tab.icon} className="h-3 w-3" />
									{tab.label}
								</span>
							</button>
						);
					})}
				</div>

			<div className={cn(
				"flex-1 bg-white px-7 pb-7 pt-4",
				activeTab === "overview" ? "min-h-0 overflow-hidden" : "overflow-y-auto",
			)}>
				{activeTab === "overview" ? (
					<div className="mx-auto flex h-full min-h-0 max-w-6xl flex-col gap-3">
						<div className="grid grid-cols-4 gap-3">
							<CompactMetric label="今日消息" value={formatCount(todayMessages)} />
							<CompactMetric label="完成 Action" value={formatCount(usage.today.actions)} />
							<CompactMetric label="估算 Token" value={formatCount(usage.today.tokens)} />
							<CompactMetric label="运行时长" value={formatDuration(usage.today.runDurationMs)} />
						</div>
						<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[42px] bg-[var(--slate-2)] pb-4 pt-5">
							<div className="flex items-center justify-between px-4 pb-3">
								<div className="text-sm font-semibold text-foreground">运行日志</div>
							</div>
							<TerminalLog agent={agent} />
						</div>
					</div>
				) : activeTab === "model" ? (
					<div className="space-y-4 rounded-[42px] bg-[var(--slate-2)] p-5">
						<div className="text-sm font-semibold text-foreground">模型配置</div>
						<div className="grid grid-cols-2 gap-4">
							<Field label="Provider">
								<Select
									value={draft.provider ?? ""}
									onValueChange={(nextProvider) => {
										const nextModel = modelCatalogQuery.data?.models.find((item) => item.provider === nextProvider)?.id ?? draft.model ?? "";
										updateModelSelection({ ...draft, provider: nextProvider, model: nextModel });
									}}
								>
									<SelectTrigger>
										<SelectValue placeholder={modelCatalogQuery.isLoading ? "Loading providers..." : "Select provider"} />
									</SelectTrigger>
									<SelectContent>
										{providerOptions.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
									</SelectContent>
								</Select>
							</Field>
							<Field label="Model">
								<Select
									value={draft.model ?? ""}
									onValueChange={(nextModel) => updateField("model", nextModel)}
									disabled={!modelOptions.length}
								>
									<SelectTrigger>
										<SelectValue placeholder={modelCatalogQuery.isLoading ? "Loading models..." : "Select model"} />
									</SelectTrigger>
									<SelectContent>
										{modelOptions.map((item) => (
											<SelectItem key={`${item.provider}/${item.id}`} value={item.id}>
												{item.name && item.name !== item.id ? `${item.id} · ${item.name}` : item.id}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</Field>
						</div>
						<Field label="Thinking Level">
							<Select
								value={draft.thinkingLevel ?? "off"}
								onValueChange={(value) => updateField("thinkingLevel", value as DesktopThinkingLevel)}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{thinkingLevelOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
								</SelectContent>
							</Select>
						</Field>
						<Field label="API Key">
							<input className={inputClass} type="password" placeholder="保存/轮换 API Key 的入口待接入 .env 写入" />
						</Field>
					</div>
				) : activeTab === "skills" ? (
					<div className="mx-auto max-w-5xl rounded-[42px] bg-[var(--slate-2)] p-5">
						<div className="text-sm font-semibold text-foreground">Skills 配置</div>
						<div className="mt-4 rounded-[36px] bg-white p-8 text-center text-sm text-muted-foreground">
							这里会配置该 Agent 独有的 Skills。当前先预留 profile-scoped skills 管理入口。
						</div>
					</div>
				) : activeTab === "channels" ? (
					<div className="mx-auto max-w-5xl space-y-4 rounded-[42px] bg-[var(--slate-2)] p-5">
						<div className="flex items-center justify-between gap-4">
							<div>
								<div className="text-sm font-semibold text-foreground">渠道管理</div>
								<div className="mt-1 text-xs text-muted-foreground">当前仅支持飞书渠道。保存前会验证 App ID 和 App Secret。</div>
							</div>
							<div className="rounded-full bg-white px-3 py-1 text-xs font-medium text-muted-foreground">
								飞书
							</div>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<Field label="App ID">
								<input className={inputClass} value={channelDraft.appId ?? ""} onChange={(event) => updateChannelField("appId", event.target.value)} />
							</Field>
							<Field label="App Secret">
								<input className={inputClass} value={channelDraft.appSecret ?? ""} onChange={(event) => updateChannelField("appSecret", event.target.value)} />
							</Field>
						</div>
						<Field label="区域">
							<Select
								value={channelDraft.brand ?? "feishu"}
								onValueChange={(value) => updateChannelField("brand", value)}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{brandOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
								</SelectContent>
							</Select>
						</Field>
						<label className="flex items-center justify-between gap-4 rounded-2xl bg-white px-3 py-2">
							<span>
								<span className="block text-sm font-medium text-foreground">在飞书显示工具调用</span>
								<span className="block text-xs text-muted-foreground">开启后，Agent 调用工具时会把工具名和参数同步发到 IM。</span>
							</span>
							<Checkbox
								checked={draft.outputToolCallsToIm ?? false}
								onCheckedChange={(checked) => updateField("outputToolCallsToIm", checked)}
							/>
						</label>
						<div className="flex items-center justify-between gap-3 pt-4">
							<div className="text-xs text-muted-foreground">
								{channelSaveMessage ?? "修改后点击保存；验证不通过时不会写入配置。"}
							</div>
							<button
								type="button"
								className="rounded-2xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
								disabled={saveChannel.isPending}
								onClick={() => saveChannel.mutate(channelDraft)}
							>
								{saveChannel.isPending ? "验证中..." : "保存"}
							</button>
						</div>
					</div>
				) : (
					<div className="mx-auto max-w-5xl space-y-6">
						<div className="grid grid-cols-4 gap-4">
							<UsageMetric label="今日消息" value={formatCount(todayMessages)} detail={`累计 ${formatCount(totalMessages)} 条`} />
							<UsageMetric label="今日 Actions" value={formatCount(usage.today.actions)} detail={`失败 ${formatCount(usage.today.failedActions)} 次`} />
							<UsageMetric label="今日 Token" value={formatCount(usage.today.tokens)} detail={`累计 ${formatCount(usage.total.tokens)}，估算值`} />
							<UsageMetric label="运行时长" value={formatDuration(usage.today.runDurationMs)} detail={usage.runningSince ? "当前运行中" : "今日累计"} />
						</div>
						<div className="rounded-[42px] bg-[var(--slate-2)] p-5">
							<div className="flex items-center justify-between gap-4">
								<div>
									<div className="text-sm font-semibold text-foreground">近一周 Token 用量</div>
									<div className="mt-1 text-xs text-muted-foreground">按消息文本长度估算，用于观察用量变化趋势。</div>
								</div>
								<div className="text-xs text-muted-foreground">更新于 {new Date(usage.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</div>
							</div>
							<UsageTrend usage={usage} />
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

export function App(): JSX.Element {
	const [selectedId, setSelectedId] = useState<string | undefined>();
	const [creating, setCreating] = useState(false);
	const [error, setError] = useState<string | undefined>();
	const queryClient = useQueryClient();

	const agents = useQuery({
		queryKey: ["agents"],
		queryFn: () => window.pie.listAgents(),
		refetchInterval: 3000,
	});
	const selected = useQuery({
		queryKey: ["agent", selectedId],
		queryFn: () => window.pie.getAgent(selectedId!),
		enabled: Boolean(selectedId),
	});

	useEffect(() => {
		if (agents.error) {
			setError((agents.error as Error).message);
		}
	}, [agents.error]);

	useEffect(() => {
		if (selected.error) {
			setError((selected.error as Error).message);
		}
	}, [selected.error]);

	return (
		<main className="app-continuous-corner relative flex h-full w-full overflow-hidden bg-[var(--slate-3)] p-[var(--app-shell-gap)] text-foreground">
			<div className="drag-region absolute left-0 right-0 top-0 z-0 h-10 w-full" />
			<div className="relative z-10 flex w-[260px] shrink-0 flex-col rounded-[var(--app-shell-radius)] bg-transparent">
				<div className="drag-region h-9 shrink-0" />
				<div className="flex-1 overflow-y-auto px-2 pb-4 pt-3">
					{agents.isLoading ? (
						<div className="flex h-20 items-center justify-center">
							<AppIcon IconComponent={CPUBoltBoldDuotone} className="h-5 w-5 animate-pulse text-muted-foreground" />
						</div>
					) : (
						<div className="space-y-1">
							{agents.data?.map((agent) => {
								const isSelected = agent.id === selectedId;
								return (
									<button
										key={agent.id}
										type="button"
										onClick={() => setSelectedId(agent.id)}
										className={cn(
											"flex min-h-[72px] w-full items-center gap-3 rounded-[36px] px-2.5 py-3 text-left transition-all",
											isSelected ? "bg-white text-foreground" : "text-foreground/80 hover:bg-white/60 hover:text-foreground",
										)}
									>
										<AgentAvatar seed={agent.avatarSeed} size={40} />
										<div className="min-w-0 flex-1">
											<div className="truncate text-sm font-medium">{agent.name}</div>
											<div className="mt-1 flex items-center gap-1.5">
												<span className={cn("h-1.5 w-1.5 rounded-full", statusTone(agent.status))} />
												<span className="truncate text-xs text-muted-foreground opacity-80">
													{agent.modelLabel ?? statusLabel(agent.status)}
												</span>
											</div>
										</div>
									</button>
								);
							})}
						</div>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-2 px-2 pb-3 pt-2">
					<button
						type="button"
						className="no-drag flex h-12 min-w-0 flex-1 items-center justify-center rounded-[36px] bg-white px-4 text-sm font-medium text-foreground transition hover:bg-white/80"
						onClick={() => {
							setError(undefined);
							setCreating(true);
						}}
						aria-label="创建 Agent"
					>
						<span className="truncate">创建 Agent</span>
					</button>
					<button
						type="button"
						className="no-drag flex h-12 w-12 shrink-0 items-center justify-center rounded-[36px] bg-white text-[var(--lime-11)] transition hover:bg-white/80 hover:text-[var(--lime-12)]"
						aria-label="全局设置"
						title="全局设置"
					>
						<AppIcon IconComponent={SettingsMinimalisticBoldDuotone} className="h-6 w-6" />
					</button>
				</div>
			</div>
			<div className="agent-detail-corner relative z-10 ml-1 flex flex-1 flex-col overflow-hidden bg-white">
				{selectedId && selected.data ? (
					<AgentEditor
						agent={selected.data}
						onError={setError}
						onDeleted={() => {
							setSelectedId(undefined);
							queryClient.removeQueries({ queryKey: ["agent", selectedId] });
						}}
					/>
				) : (
					<div className="drag-region flex h-full flex-col items-center justify-center bg-white text-muted-foreground">
						<AppIcon IconComponent={SmileCircleBoldDuotone} className="mb-4 h-12 w-12 text-[var(--lime-10)]" />
						<p className="text-sm font-medium">选择一个 bot，或创建新的 bot</p>
					</div>
				)}
			</div>
			<CreateAgentDialog
				open={creating}
				onClose={() => setCreating(false)}
				onError={setError}
				onCreated={(agent) => setSelectedId(agent.id)}
			/>
			{error && <ErrorToast message={error} onClose={() => setError(undefined)} />}
		</main>
	);
}
