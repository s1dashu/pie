import { Cpu, FolderOpen, Globe2, HardDrive, Layers3, MemoryStick, UserRound } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AgentDetails, AgentDraft, AgentResourceStats, AgentSkillSource, AgentUsageStats, DesktopModelOption, DesktopThinkingLevel } from "../../../shared/types";
import { Checkbox } from "../../components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Field } from "../../components/shared/field";
import { CompactMetric, UsageMetric } from "../../components/shared/metrics";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { cn } from "../../lib/utils";
import { TerminalLog } from "../logs/TerminalLog";
import { brandOptions, formatCount, formatDuration, thinkingLevelOptions, type AgentTab } from "./agent-display";
import { UsageTrend } from "./UsageTrend";

export function AgentContentPanels({
	activeTab,
	agent,
	usage,
	resources,
	todayMessages,
	totalMessages,
	draft,
	channelDraft,
	channelSaveMessage,
	providerOptions,
	modelOptions,
	allModelOptions,
	isModelCatalogLoading,
	skillSources,
	isLoadingSkillSources,
	openingSkillSourceId,
	isSavingChannel,
	onUpdateField,
	onUpdateModelSelection,
	onOpenSkillSource,
	onUpdateChannelField,
	onSaveChannel,
}: {
	activeTab: AgentTab;
	agent: AgentDetails;
	usage: AgentUsageStats;
	resources?: AgentResourceStats;
	todayMessages: number;
	totalMessages: number;
	draft: AgentDraft;
	channelDraft: AgentDraft;
	channelSaveMessage?: string;
	providerOptions: string[];
	modelOptions: DesktopModelOption[];
	allModelOptions: DesktopModelOption[];
	isModelCatalogLoading: boolean;
	skillSources: AgentSkillSource[];
	isLoadingSkillSources: boolean;
	openingSkillSourceId?: string;
	isSavingChannel: boolean;
	onUpdateField: (field: keyof AgentDraft, value: AgentDraft[keyof AgentDraft]) => void;
	onUpdateModelSelection: (nextDraft: AgentDraft) => void;
	onOpenSkillSource: (sourceId: string) => void;
	onUpdateChannelField: (field: keyof AgentDraft, value: string) => void;
	onSaveChannel: () => void;
}): JSX.Element {
	return (
		<div className={activeTab === "overview" ? "mx-auto flex h-full min-h-0 max-w-6xl flex-col gap-3" : ""}>
			{activeTab === "overview" ? (
				<>
					<div className="grid grid-cols-4 gap-3">
						<CompactMetric label="今日消息" value={formatCount(todayMessages)} />
						<CompactMetric label="完成 Action" value={formatCount(usage.today.actions)} />
						<CompactMetric label="估算 Token" value={formatCount(usage.today.tokens)} />
						<CompactMetric label="运行时长" value={formatDuration(usage.today.runDurationMs)} />
					</div>
					<div className="pie-smooth-corner flex min-h-0 flex-1 flex-col overflow-hidden rounded-[42px] bg-[var(--slate-2)] pb-4 pt-5">
						<div className="flex items-center justify-between px-4 pb-3">
							<div className="text-sm font-semibold text-foreground text-balance">运行日志</div>
						</div>
						<TerminalLog agent={agent} />
					</div>
				</>
			) : activeTab === "model" ? (
				<div className="pie-smooth-corner space-y-4 rounded-[42px] bg-[var(--slate-2)] p-5">
					<div className="text-sm font-semibold text-foreground text-balance">模型配置</div>
					<div className="grid grid-cols-2 gap-4">
						<Field label="Provider">
							<Select
								value={draft.provider ?? ""}
								onValueChange={(nextProvider) => {
									const nextModel = allModelOptions.find((item) => item.provider === nextProvider)?.id ?? draft.model ?? "";
									onUpdateModelSelection({ ...draft, provider: nextProvider, model: nextModel });
								}}
							>
								<SelectTrigger>
									<SelectValue placeholder={isModelCatalogLoading ? "Loading providers..." : "Select provider"} />
								</SelectTrigger>
								<SelectContent>
									{providerOptions.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
								</SelectContent>
							</Select>
						</Field>
						<Field label="Model">
							<Select
								value={draft.model ?? ""}
								onValueChange={(nextModel) => onUpdateField("model", nextModel)}
								disabled={!modelOptions.length}
							>
								<SelectTrigger>
									<SelectValue placeholder={isModelCatalogLoading ? "Loading models..." : "Select model"} />
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
							onValueChange={(value) => onUpdateField("thinkingLevel", value as DesktopThinkingLevel)}
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
						<Input variant="shadcn" type="password" placeholder="保存/轮换 API Key 的入口待接入 .env 写入" />
					</Field>
				</div>
			) : activeTab === "skills" ? (
				<div className="pie-smooth-corner mx-auto max-w-5xl rounded-[42px] bg-[var(--slate-2)] p-5">
					<div className="flex items-center justify-between gap-4">
						<div>
							<div className="text-sm font-semibold text-foreground text-balance">Skills 管理</div>
							<div className="mt-1 text-xs text-muted-foreground text-pretty">按目录来源管理；打开 folder 后直接增删或编辑 Skills。</div>
						</div>
					</div>
					<div className="mt-4 grid gap-3">
						{isLoadingSkillSources ? (
							<div className="pie-smooth-corner rounded-[36px] bg-white p-8 text-center text-sm text-muted-foreground">
								正在读取 Skills 目录...
							</div>
						) : (
							skillSources.map((source) => (
								<SkillSourceRow
									key={source.id}
									source={source}
									isOpening={openingSkillSourceId === source.id}
									onOpen={() => onOpenSkillSource(source.id)}
								/>
							))
						)}
					</div>
				</div>
			) : activeTab === "channels" ? (
				<div className="pie-smooth-corner mx-auto max-w-5xl space-y-4 rounded-[42px] bg-[var(--slate-2)] p-5">
					<div className="flex items-center justify-between gap-4">
						<div>
							<div className="text-sm font-semibold text-foreground text-balance">渠道管理</div>
							<div className="mt-1 text-xs text-muted-foreground text-pretty">当前仅支持飞书渠道。保存前会验证 App ID 和 App Secret。</div>
						</div>
						<div className="pie-smooth-corner rounded-full bg-white px-3 py-1 text-xs font-medium text-muted-foreground">
							飞书
						</div>
					</div>
					<div className="grid grid-cols-2 gap-4">
						<Field label="App ID">
							<Input value={channelDraft.appId ?? ""} onChange={(event) => onUpdateChannelField("appId", event.target.value)} />
						</Field>
						<Field label="App Secret">
							<Input value={channelDraft.appSecret ?? ""} onChange={(event) => onUpdateChannelField("appSecret", event.target.value)} />
						</Field>
					</div>
					<Field label="区域">
						<Select
							value={channelDraft.brand ?? "feishu"}
							onValueChange={(value) => onUpdateChannelField("brand", value)}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{brandOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
							</SelectContent>
						</Select>
					</Field>
					<label className="pie-smooth-corner flex items-center justify-between gap-4 rounded-2xl bg-white px-3 py-2">
						<span>
							<span className="block text-sm font-medium text-foreground text-balance">在飞书显示工具调用</span>
							<span className="block text-xs text-muted-foreground text-pretty">开启后，Agent 调用工具时会把工具名和参数同步发到 IM。</span>
						</span>
						<Checkbox
							checked={draft.outputToolCallsToIm ?? false}
							onCheckedChange={(checked) => onUpdateField("outputToolCallsToIm", checked)}
						/>
					</label>
					<div className="flex items-center justify-between gap-3 pt-4">
						<div className="text-xs text-muted-foreground text-pretty">
							{channelSaveMessage ?? "修改后点击保存；验证不通过时不会写入配置。"}
						</div>
						<Button
							disabled={isSavingChannel}
							onClick={onSaveChannel}
						>
							{isSavingChannel ? "验证中..." : "保存"}
						</Button>
					</div>
				</div>
			) : (
				<div className="mx-auto max-w-6xl space-y-4">
					<div className="grid grid-cols-12 gap-4">
						<ResourceChartCard
							className="col-span-6"
							title="CPU"
							description={resources?.running ? `PID ${resources.pid ?? "-"}` : "Agent 未运行"}
							value={formatPercent(resources?.cpuPercent ?? 0)}
							tone="lime"
							icon={<Cpu className="size-4" />}
							currentValue={resources?.cpuPercent ?? 0}
							updatedAt={resources?.updatedAt}
						/>
						<ResourceChartCard
							className="col-span-6"
							title="内存"
							description={`占系统内存 ${formatPercent(resources?.memoryPercent ?? 0)}`}
							value={formatBytes(resources?.memoryBytes ?? 0)}
							tone="teal"
							icon={<MemoryStick className="size-4" />}
							currentValue={(resources?.memoryBytes ?? 0) / 1024 / 1024}
							updatedAt={resources?.updatedAt}
						/>
						<StorageCard className="col-span-4" resources={resources} />
						<UsageMetric className="col-span-3" label="今日消息" value={formatCount(todayMessages)} detail={`累计 ${formatCount(totalMessages)} 条`} />
						<UsageMetric className="col-span-3" label="今日 Actions" value={formatCount(usage.today.actions)} detail={`失败 ${formatCount(usage.today.failedActions)} 次`} />
						<UsageMetric className="col-span-2" label="运行时长" value={formatDuration(usage.today.runDurationMs)} detail={usage.runningSince ? "当前运行中" : "今日累计"} />
					</div>
					<div className="pie-smooth-corner rounded-[42px] bg-[var(--slate-2)] p-5">
						<div className="flex items-center justify-between gap-4">
							<div>
								<div className="text-sm font-semibold text-foreground text-balance">近一周 Token 用量</div>
								<div className="mt-1 text-xs text-muted-foreground text-pretty">按消息文本长度估算，用于观察用量变化趋势。</div>
							</div>
							<div className="text-xs text-muted-foreground tabular-nums">更新于 {new Date(usage.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</div>
						</div>
						<UsageTrend usage={usage} />
					</div>
				</div>
			)}
		</div>
	);
}

function ResourceChartCard({
	title,
	description,
	value,
	tone,
	icon,
	currentValue,
	updatedAt,
	className,
}: {
	title: string;
	description: string;
	value: string;
	tone: "lime" | "teal";
	icon: ReactNode;
	currentValue: number;
	updatedAt?: string;
	className?: string;
}): JSX.Element {
	const [points, setPoints] = useState<number[]>([]);
	const stroke = tone === "lime" ? "var(--lime-10)" : "#0f8b8d";
	const fill = tone === "lime" ? "rgba(162, 209, 48, 0.16)" : "rgba(15, 139, 141, 0.14)";

	useEffect(() => {
		if (!updatedAt) {
			return;
		}
		setPoints((current) => [...current.slice(-35), currentValue]);
	}, [currentValue, updatedAt]);

	const path = useMemo(() => buildLinePath(points, 100, 44), [points]);
	const areaPath = path ? `${path} L 100 44 L 0 44 Z` : "";

	return (
		<div className={cn("pie-smooth-corner min-h-[220px] overflow-hidden rounded-[36px] bg-[var(--slate-2)] p-4", className)}>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex items-center gap-2 text-sm font-semibold text-foreground">
						<span className="flex size-8 items-center justify-center rounded-2xl bg-white text-foreground">{icon}</span>
						{title}
					</div>
					<div className="mt-2 truncate text-xs text-muted-foreground">{description}</div>
				</div>
				<div className="text-right text-2xl font-semibold text-foreground tabular-nums">{value}</div>
			</div>
			<div className="mt-4 h-32 overflow-hidden rounded-[28px] bg-white">
				<svg viewBox="0 0 100 44" preserveAspectRatio="none" className="h-full w-full">
					<path d={areaPath} fill={fill} />
					<path d={path} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
					<line x1="0" y1="32" x2="100" y2="32" stroke="var(--slate-a4)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
				</svg>
			</div>
		</div>
	);
}

function StorageCard({ resources, className }: { resources?: AgentResourceStats; className?: string }): JSX.Element {
	const diskUsedPercent = resources?.diskTotalBytes ? ((resources.diskTotalBytes - (resources.diskAvailableBytes ?? 0)) / resources.diskTotalBytes) * 100 : undefined;
	return (
		<div className={cn("pie-smooth-corner rounded-[36px] bg-[var(--slate-2)] p-4", className)}>
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-2 text-sm font-semibold text-foreground">
					<span className="flex size-8 items-center justify-center rounded-2xl bg-white text-foreground">
						<HardDrive className="size-4" />
					</span>
					存储空间
				</div>
				<div className="text-xs text-muted-foreground">Profile</div>
			</div>
			<div className="mt-5 text-2xl font-semibold text-foreground tabular-nums">{formatBytes(resources?.storageBytes ?? 0)}</div>
			<div className="mt-1 text-xs text-muted-foreground">当前 Agent home 占用</div>
			<div className="mt-4 h-2 overflow-hidden rounded-full bg-white">
				<div
					className="h-full rounded-full bg-[#0f8b8d]"
					style={{ width: `${Math.max(2, Math.min(100, diskUsedPercent ?? 0))}%` }}
				/>
			</div>
			<div className="mt-2 flex justify-between gap-3 text-xs text-muted-foreground tabular-nums">
				<span>磁盘已用 {diskUsedPercent === undefined ? "-" : formatPercent(diskUsedPercent)}</span>
				<span>可用 {formatBytes(resources?.diskAvailableBytes ?? 0)}</span>
			</div>
		</div>
	);
}

function buildLinePath(points: number[], width: number, height: number): string {
	if (!points.length) {
		return "";
	}
	const maxValue = Math.max(1, ...points);
	return points.map((point, index) => {
		const x = points.length === 1 ? 0 : (index / (points.length - 1)) * width;
		const y = height - Math.max(2, (point / maxValue) * (height - 4));
		if (points.length === 1) {
			return `M 0 ${y.toFixed(2)} L ${width} ${y.toFixed(2)}`;
		}
		return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
	}).join(" ");
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${Math.round(bytes)} B`;
	}
	const units = ["KB", "MB", "GB", "TB"];
	let value = bytes / 1024;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}
	return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatPercent(value: number): string {
	return `${Math.max(0, value).toFixed(value >= 10 ? 0 : 1)}%`;
}

function SkillSourceRow({
	source,
	isOpening,
	onOpen,
}: {
	source: AgentSkillSource;
	isOpening: boolean;
	onOpen: () => void;
}): JSX.Element {
	const Icon = source.kind === "profile" ? UserRound : source.kind === "agent-type" ? Layers3 : Globe2;
	const preview = source.skills.slice(0, 4);
	return (
		<div className="pie-smooth-corner grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 rounded-[32px] bg-white p-3 shadow-[0_1px_0_rgba(0,0,0,0.04),0_10px_30px_rgba(15,23,42,0.04)]">
			<div className="flex size-10 items-center justify-center rounded-3xl bg-[var(--slate-3)] text-foreground">
				<Icon className="size-4" />
			</div>
			<div className="min-w-0">
				<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
					<div className="text-sm font-semibold text-foreground text-balance">{source.label}</div>
					<div className={cn(
						"rounded-full px-2 py-0.5 text-[11px] font-medium",
						source.exists ? "bg-[var(--lime-3)] text-[var(--lime-11)]" : "bg-[var(--slate-3)] text-muted-foreground",
					)}>
						{source.exists ? `${source.skillCount} 个` : "未创建"}
					</div>
				</div>
				<div className="mt-1 text-xs text-muted-foreground text-pretty">{source.description}</div>
				<div className="mt-2 truncate font-mono text-[11px] text-muted-foreground">{source.path}</div>
				{preview.length ? (
					<div className="mt-2 flex flex-wrap gap-1.5">
						{preview.map((skill) => (
							<span key={skill} className="rounded-full bg-[var(--slate-2)] px-2 py-0.5 text-[11px] text-muted-foreground">
								{skill}
							</span>
						))}
						{source.skills.length > preview.length ? (
							<span className="rounded-full bg-[var(--slate-2)] px-2 py-0.5 text-[11px] text-muted-foreground">
								+{source.skills.length - preview.length}
							</span>
						) : null}
					</div>
				) : null}
			</div>
			<Button variant="outline" size="sm" onClick={onOpen} disabled={isOpening}>
				<FolderOpen data-icon="inline-start" className="size-4" />
				{isOpening ? "打开中" : "打开"}
			</Button>
		</div>
	);
}
