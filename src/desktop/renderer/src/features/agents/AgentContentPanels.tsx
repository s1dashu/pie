import { useMemo } from "react";
import { FolderOpenBoldDuotone } from "solar-icon-set";
import type { AgentDetails, AgentDraft, AgentResourceStats, AgentSkillSource, AgentSystemPromptSource, AgentUsageStats, DesktopModelOption, DesktopThinkingLevel } from "../../../shared/types";
import { Checkbox } from "../../components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { AppIcon } from "../../components/shared/app-icon";
import { Field } from "../../components/shared/field";
import { CompactMetric, UsageMetric } from "../../components/shared/metrics";
import { AceternityTooltip } from "../../components/shared/tooltip";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { cn } from "../../lib/utils";
import { TerminalLog } from "../logs/TerminalLog";
import { brandOptions, formatCount, formatDuration, formatTokenCount, thinkingLevelOptions, type AgentTab } from "./agent-display";
import { UsageTrend } from "./UsageTrend";

export interface ResourceChartHistory {
	updatedAt?: string;
	memory: number[];
	cpu: number[];
}

export function AgentContentPanels({
	activeTab,
	agent,
	usage,
	resources,
	resourceHistory,
	draft,
	channelDraft,
	modelSaveMessage,
	channelSaveMessage,
	providerOptions,
	modelOptions,
	allModelOptions,
	isModelCatalogLoading,
	systemPrompt,
	isLoadingSystemPrompt,
	isOpeningSystemPrompt,
	skillSources,
	isLoadingSkillSources,
	openingSkillSourceId,
	isSavingModel,
	isSavingChannel,
	onUpdateField,
	onUpdateProviderSelection,
	onSaveModel,
	onOpenSystemPrompt,
	onOpenSkillSource,
	onUpdateChannelField,
	onSaveChannel,
}: {
	activeTab: AgentTab;
	agent: AgentDetails;
	usage: AgentUsageStats;
	resources?: AgentResourceStats;
	resourceHistory: ResourceChartHistory;
	draft: AgentDraft;
	channelDraft: AgentDraft;
	modelSaveMessage?: string;
	channelSaveMessage?: string;
	providerOptions: string[];
	modelOptions: DesktopModelOption[];
	allModelOptions: DesktopModelOption[];
	isModelCatalogLoading: boolean;
	systemPrompt?: AgentSystemPromptSource;
	isLoadingSystemPrompt: boolean;
	isOpeningSystemPrompt: boolean;
	skillSources: AgentSkillSource[];
	isLoadingSkillSources: boolean;
	openingSkillSourceId?: string;
	isSavingModel: boolean;
	isSavingChannel: boolean;
	onUpdateField: (field: keyof AgentDraft, value: AgentDraft[keyof AgentDraft]) => void;
	onUpdateProviderSelection: (provider: string) => void;
	onSaveModel: () => void;
	onOpenSystemPrompt: () => void;
	onOpenSkillSource: (sourceId: string) => void;
	onUpdateChannelField: (field: keyof AgentDraft, value: string | boolean) => void;
	onSaveChannel: () => void;
}): JSX.Element {
	const visibleSkillSources = useMemo(() => orderSkillSources(skillSources), [skillSources]);
	const currentRunMessages = usage.currentRun.incomingMessages + usage.currentRun.outgoingMessages;
	const cacheStats = getCacheStats(usage);

	return (
		<div className={activeTab === "overview" ? "mx-auto flex h-full min-h-0 max-w-6xl flex-col gap-3" : ""}>
			{activeTab === "overview" ? (
				<>
					<div className="grid grid-cols-4 gap-3">
						<CompactMetric
							label="消息数"
							value={formatCount(currentRunMessages)}
						/>
						<CompactMetric
							label="工具调用次数"
							value={formatCount(usage.currentRun.actions)}
						/>
						<CompactMetric
							label="Token 消耗"
							value={formatTokenCount(usage.currentRun.tokens)}
						/>
						<CompactMetric
							label="运行时长"
							value={formatDuration(usage.currentRun.runDurationMs)}
						/>
					</div>
					<div className="pie-smooth-corner flex min-h-0 flex-1 flex-col overflow-hidden rounded-[42px] bg-[var(--slate-2)] pb-4 pt-5">
						<div className="flex items-center justify-between px-4 pb-2">
							<SectionTitle title="运行日志" />
						</div>
						<TerminalLog agent={agent} />
					</div>
				</>
			) : activeTab === "model" ? (
				<div className="mx-auto max-w-5xl space-y-4">
					<div className="pie-smooth-corner space-y-4 rounded-[42px] bg-[var(--slate-2)] p-5">
						<SectionTitle title="模型配置" />
						<div className="grid grid-cols-2 gap-4">
							<Field label="Provider">
								<Select
									value={draft.provider ?? ""}
									onValueChange={onUpdateProviderSelection}
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
							<Input
								variant="shadcn"
								type="password"
								value={draft.apiKey ?? ""}
								onChange={(event) => onUpdateField("apiKey", event.target.value)}
								placeholder="留空保存会清除当前 provider 的 API Key"
							/>
						</Field>
						<div className="flex items-center justify-between gap-3 pt-2">
							<div className="text-xs text-muted-foreground text-pretty">
								{modelSaveMessage ?? "修改后点击保存；保存时会验证配置，运行中的 Bot 会自动重启。"}
							</div>
							<Button
								disabled={isSavingModel}
								onClick={onSaveModel}
							>
								{isSavingModel ? "验证中..." : "保存"}
							</Button>
						</div>
					</div>
					<SystemPromptCard
						source={systemPrompt}
						isLoading={isLoadingSystemPrompt}
						isOpening={isOpeningSystemPrompt}
						onOpen={onOpenSystemPrompt}
					/>
				</div>
			) : activeTab === "skills" ? (
				<div className="pie-smooth-corner mx-auto max-w-5xl rounded-[42px] bg-[var(--slate-2)] p-5">
					<div className="flex items-center justify-between gap-4">
						<SectionTitle title="Skills 管理" description="按目录来源管理；打开 folder 后直接增删或编辑 Skills。" />
					</div>
					<div className="mt-4 grid gap-3">
						{isLoadingSkillSources ? (
							<div className="pie-smooth-corner rounded-[36px] bg-white p-8 text-center text-sm text-muted-foreground">
								正在读取 Skills 目录...
							</div>
						) : (
							visibleSkillSources.map((source) => (
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
						<SectionTitle title="渠道管理" description="当前仅支持飞书渠道。保存前会验证 App ID 和 App Secret。" />
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
							checked={channelDraft.outputToolCallsToIm ?? true}
							onCheckedChange={(checked) => onUpdateChannelField("outputToolCallsToIm", checked)}
						/>
					</label>
					<div className="flex items-center justify-between gap-3 pt-4">
						<div className="text-xs text-muted-foreground text-pretty">
							{channelSaveMessage ?? "修改后点击保存；保存时会验证配置，运行中的 Bot 会自动重启。"}
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
					<div className="grid grid-cols-4 gap-4">
						<UsageMetric
							label="缓存命中率"
							value={formatPercent(cacheStats.hitRate)}
							hint={`${formatTokenCount(cacheStats.read)} / ${formatTokenCount(cacheStats.denom)}`}
						/>
						<UsageMetric
							label="输入 Token"
							value={formatTokenCount(cacheStats.totalInput)}
							hint="含缓存"
						/>
						<UsageMetric
							label="缓存 Token"
							value={formatTokenCount(cacheStats.read)}
							hint="缓存读取"
						/>
						<UsageMetric
							label="输出 Token"
							value={formatTokenCount(cacheStats.output)}
							hint="模型输出"
						/>
					</div>
					<div className="grid grid-cols-1 gap-4 min-[560px]:grid-cols-2">
						<ResourceChartCard
							className="min-w-0 bg-[var(--slate-2)]"
							title="内存"
							value={formatBytes(resources?.memoryBytes ?? 0)}
							hint="近期占用曲线"
							tone="slate"
							points={resourceHistory.memory}
						/>
						<ResourceChartCard
							className="min-w-0 bg-[var(--slate-2)]"
							title="CPU"
							value={formatPercent(resources?.cpuPercent ?? 0)}
							hint="主进程占用"
							tone="slate"
							points={resourceHistory.cpu}
						/>
					</div>
					<div className="grid grid-cols-1 gap-4 min-[560px]:grid-cols-2">
						<StorageDetailCard resources={resources} />
						<div className="pie-smooth-corner min-w-0 rounded-[36px] bg-[var(--slate-2)] p-4">
							<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
								<div className="min-w-0">
									<SectionTitle title="近一周 Token 用量" description="每日消耗列表" />
								</div>
								<div className="shrink-0 text-xs text-muted-foreground tabular-nums sm:pt-0.5 sm:text-right">
									更新于 {new Date(usage.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
								</div>
							</div>
							<UsageTrend usage={usage} />
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

function SystemPromptCard({
	source,
	isLoading,
	isOpening,
	onOpen,
}: {
	source?: AgentSystemPromptSource;
	isLoading: boolean;
	isOpening: boolean;
	onOpen: () => void;
}): JSX.Element {
	return (
		<div className="pie-smooth-corner group/system-prompt relative rounded-[42px] bg-[var(--slate-2)] p-5">
			<div className="pr-9">
				<SectionTitle title="系统提示词" />
				<div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
					{source?.path ?? "Loading..."}
				</div>
			</div>
			<AceternityTooltip content="打开系统提示词文件" className="absolute right-5 top-4">
				<Button
					variant="unstyled"
					size="inline"
					className="inline-flex h-8 w-8 items-center justify-center text-[var(--slate-10)] opacity-0 transition-[color,opacity,transform] hover:text-[var(--slate-12)] focus:opacity-100 group-hover/system-prompt:opacity-100"
					onClick={onOpen}
					disabled={isLoading || isOpening || !source}
					aria-label="Open System Prompt"
				>
					<AppIcon IconComponent={FolderOpenBoldDuotone} className="size-7" />
				</Button>
			</AceternityTooltip>
			<div className="pie-smooth-corner mt-4 max-h-56 overflow-auto rounded-[28px] bg-white px-4 py-3">
				<pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground">
					{isLoading ? "正在读取系统提示词..." : source?.exists ? source.content : "未找到系统提示词文件。"}
				</pre>
			</div>
		</div>
	);
}

function SectionTitle({
	title,
	description,
	className,
}: {
	title: string;
	description?: string;
	className?: string;
}): JSX.Element {
	return (
		<div className={cn("min-w-0", className)}>
			<div className="truncate text-xs font-medium uppercase text-muted-foreground">{title}</div>
			{description ? (
				<div className="mt-1 text-xs leading-snug text-muted-foreground text-pretty">{description}</div>
			) : null}
		</div>
	);
}

function ResourceChartCard({
	title,
	value,
	hint,
	tone,
	points,
	className,
	}: {
		title: string;
		value: string;
		hint?: string;
		tone: "slate";
		points: number[];
		className?: string;
	}): JSX.Element {
		const stroke = "var(--slate-8)";
		const fill = "var(--slate-a3)";

	const path = useMemo(() => buildLinePath(points, 100, 44), [points]);
	const areaPath = path ? `${path} L 100 44 L 0 44 Z` : "";

	return (
		<div className={cn("pie-smooth-corner flex min-h-[8.5rem] min-w-0 flex-col overflow-hidden rounded-[36px] p-4", className)}>
			<div className="flex items-start justify-between gap-3">
				<SectionTitle title={title} className="min-w-0" />
				<div className="shrink-0 text-right text-2xl font-bold tracking-tight text-foreground tabular-nums">{value}</div>
			</div>
			{hint ? (
				<p className="mt-1 min-w-0 text-xs leading-snug text-balance text-muted-foreground">{hint}</p>
			) : null}
			<div className="pie-smooth-corner relative mt-2 h-[72px] overflow-hidden rounded-2xl">
				<svg viewBox="0 0 100 44" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
					<path d={areaPath} fill={fill} />
					<path d={path} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
					<line x1="0" y1="32" x2="100" y2="32" stroke="var(--slate-a4)" strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
				</svg>
			</div>
		</div>
	);
}

function StorageDetailCard({ resources }: { resources?: AgentResourceStats }): JSX.Element {
	const storageBytes = resources?.storageBytes ?? 0;
	const diskAvailableBytes = resources?.diskAvailableBytes;
	const diskTotalBytes = resources?.diskTotalBytes;
	const usedPercent = diskTotalBytes && diskTotalBytes > 0 ? (storageBytes / diskTotalBytes) * 100 : 0;

	return (
		<div className="pie-smooth-corner min-w-0 rounded-[36px] bg-[var(--slate-2)] p-4">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
				<div className="min-w-0">
					<SectionTitle title="存储空间" description="Profile home 与磁盘余量" />
				</div>
				<div className="shrink-0 text-2xl font-bold tracking-tight text-foreground tabular-nums">
					{formatBytes(storageBytes)}
				</div>
			</div>
			<div className="pie-smooth-corner mt-3 space-y-3 rounded-[24px] px-4 py-3">
				<div className="h-2 overflow-hidden rounded-full bg-[var(--slate-4)]">
					<div
						className="h-full max-w-full rounded-full bg-[var(--slate-8)] transition-[width] duration-300"
						style={{ width: `${Math.min(100, Math.max(2, usedPercent))}%` }}
					/>
				</div>
				<div className="grid gap-2 text-xs">
					<StorageDetailRow label="Profile 占用" value={formatBytes(storageBytes)} />
					<StorageDetailRow label="磁盘可用" value={diskAvailableBytes === undefined ? "未知" : formatBytes(diskAvailableBytes)} />
					<StorageDetailRow label="磁盘容量" value={diskTotalBytes === undefined ? "未知" : formatBytes(diskTotalBytes)} />
				</div>
			</div>
		</div>
	);
}

function StorageDetailRow({ label, value }: { label: string; value: string }): JSX.Element {
	return (
		<div className="flex items-center justify-between gap-4">
			<span className="min-w-0 truncate text-muted-foreground">{label}</span>
			<span className="shrink-0 text-right text-foreground tabular-nums">{value}</span>
		</div>
	);
}

function getCacheStats(usage: AgentUsageStats): {
	hitRate: number;
	read: number;
	write: number;
	input: number;
	totalInput: number;
	output: number;
	denom: number;
} {
	const read = usage.total.cacheReadTokens;
	const write = usage.total.cacheWriteTokens;
	const input = usage.total.inputTokens;
	const totalInput = input + read + write;
	const output = usage.total.outputTokens;
	const denom = totalInput;
	return {
		hitRate: denom > 0 ? (read / denom) * 100 : 0,
		read,
		write,
		input,
		totalInput,
		output,
		denom,
	};
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

function orderSkillSources(sources: AgentSkillSource[]): AgentSkillSource[] {
	const priority = new Map<AgentSkillSource["kind"], number>([
		["universal", 0],
		["agent-type", 1],
		["profile", 2],
	]);
	return sources
		.filter((source) => source.kind !== "profile" || source.skillCount > 0)
		.sort((left, right) => (priority.get(left.kind) ?? 99) - (priority.get(right.kind) ?? 99));
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
	const preview = source.skills.slice(0, 4);
	const desc = source.description.trim();
	return (
		<div className="pie-smooth-corner group/skill-source relative flex min-h-[112px] flex-col rounded-[32px] bg-white p-2.5 pr-12">
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
					<div className="text-sm font-medium text-foreground text-balance">{source.label}</div>
					<div className={cn(
						"rounded-full px-2 py-0.5 text-[11px] font-medium",
						source.exists ? "bg-[var(--lime-3)] text-[var(--lime-11)]" : "bg-[var(--slate-3)] text-muted-foreground",
					)}>
						{source.exists ? `${source.skillCount} 个` : "未创建"}
					</div>
				</div>
				{desc ? (
					<div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground text-pretty">{desc}</div>
				) : null}
				<div className={cn("shrink-0 truncate font-mono text-[11px] text-muted-foreground", desc ? "mt-2" : "mt-1")}>{source.path}</div>
				<div className="mt-auto shrink-0 pt-1.5">
					<div className="flex h-5 min-w-0 gap-1.5 overflow-hidden">
						{preview.map((skill) => (
							<span key={skill} className="shrink-0 rounded-full bg-[var(--slate-2)] px-2 py-0.5 text-[11px] leading-4 text-muted-foreground">
								{skill}
							</span>
						))}
						{source.skills.length > preview.length ? (
							<span className="shrink-0 rounded-full bg-[var(--slate-2)] px-2 py-0.5 text-[11px] leading-4 text-muted-foreground">
								+{source.skills.length - preview.length}
							</span>
						) : null}
					</div>
				</div>
			</div>
			<AceternityTooltip content="打开 Skills 文件夹" className="absolute right-3 top-3">
				<Button
					variant="unstyled"
					size="inline"
					className="inline-flex h-8 w-8 items-center justify-center text-[var(--slate-10)] opacity-0 transition-[color,opacity,transform] hover:text-[var(--slate-12)] focus:opacity-100 group-hover/skill-source:opacity-100"
					onClick={onOpen}
					disabled={isOpening}
					aria-label="Open Skills Folder"
				>
					<AppIcon IconComponent={FolderOpenBoldDuotone} className="size-7" />
				</Button>
			</AceternityTooltip>
		</div>
	);
}
