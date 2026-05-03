import { useMemo, useState } from "react";
import type * as React from "react";
import { EyeBold, EyeClosedBold, FolderOpenBoldDuotone } from "solar-icon-set";
import type { AgentDetails, AgentDraft, AgentResourceStats, AgentSkillSource, AgentSystemPromptSource, AgentUsageStats, DesktopModelOption, DesktopThinkingLevel } from "../../../shared/types";
import { Checkbox } from "../../components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { AppIcon } from "../../components/shared/app-icon";
import { Field } from "../../components/shared/field";
import { UsageMetric } from "../../components/shared/metrics";
import { AceternityTooltip } from "../../components/shared/tooltip";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { cn } from "../../lib/utils";
import { TerminalLog } from "../logs/TerminalLog";
import { brandOptions, formatCount, formatDuration, formatTokenCount, thinkingLevelOptions, type AgentTab } from "./agent-display";
import { ProviderSelect } from "./ProviderSelect";
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
	const totalMessages = usage.total.incomingMessages + usage.total.outgoingMessages;
	const cacheStats = getCacheStats(usage);
	const hasFeishuChannel = Boolean(agent.channelKinds?.includes("feishu") || agent.appId);
	const hasWechatChannel = Boolean(agent.channelKinds?.includes("wechat") || agent.wechat);
	const hasSlackChannel = Boolean(agent.channelKinds?.includes("slack") || agent.slack);
	const hasDiscordChannel = Boolean(agent.channelKinds?.includes("discord") || agent.discord);
	const hasTelegramChannel = Boolean(agent.channelKinds?.includes("telegram") || agent.telegram);
	const channelKinds = [
		...(hasFeishuChannel ? ["feishu"] : []),
		...(hasWechatChannel ? ["wechat"] : []),
		...(hasSlackChannel ? ["slack"] : []),
		...(hasDiscordChannel ? ["discord"] : []),
		...(hasTelegramChannel ? ["telegram"] : []),
	];

	return (
		<div className={activeTab === "overview" ? "mx-auto flex h-full min-h-0 max-w-6xl flex-col gap-3" : ""}>
			{activeTab === "overview" ? (
				<>
					<div className="grid grid-cols-4 gap-4">
						<UsageMetric
							label="消息数"
							value={formatCount(totalMessages)}
							hint={`${formatCount(usage.total.incomingMessages)} / ${formatCount(usage.total.outgoingMessages)}`}
						/>
						<UsageMetric
							label="工具调用次数"
							value={formatCount(usage.total.actions)}
							hint={`失败 ${formatCount(usage.total.failedActions)}`}
						/>
						<UsageMetric
							label="Token 消耗"
							value={formatTokenCount(usage.total.tokens)}
							hint={`${formatTokenCount(usage.total.inputTokens)} / ${formatTokenCount(usage.total.outputTokens)}`}
						/>
						<UsageMetric
							label="运行时长"
							value={formatDuration(usage.total.runDurationMs)}
							hint={`本次运行 ${formatDuration(usage.currentRun.runDurationMs)}`}
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
								<ProviderSelect
									value={draft.provider ?? ""}
									providers={providerOptions}
									placeholder={isModelCatalogLoading ? "Loading providers..." : "Select provider"}
									onValueChange={onUpdateProviderSelection}
								/>
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
												{item.name && item.name !== item.id ? item.name : item.id.split("/").filter(Boolean).at(-1) ?? item.id}
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
							<SecretInput
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
				<div className="mx-auto max-w-5xl space-y-4">
					{hasFeishuChannel ? (
						<div className="pie-smooth-corner space-y-4 rounded-[42px] bg-[var(--slate-2)] p-5">
							<SectionTitle title="飞书" description="保存前会验证 App ID 和 App Secret。" />
							<div className="grid grid-cols-2 gap-4">
								<Field label="App ID">
									<Input value={channelDraft.appId ?? ""} onChange={(event) => onUpdateChannelField("appId", event.target.value)} />
								</Field>
								<Field label="App Secret">
									<SecretInput value={channelDraft.appSecret ?? ""} onChange={(event) => onUpdateChannelField("appSecret", event.target.value)} />
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
						</div>
					) : null}
					{hasWechatChannel ? (
						<div className="pie-smooth-corner space-y-4 rounded-[42px] bg-[var(--slate-2)] p-5">
							<SectionTitle title="微信" description="Token 只保存到该 Agent 的 .env，不写入 config.json。" />
							<div className="grid grid-cols-2 gap-4">
								<Field label="Account ID">
									<Input value={channelDraft.wechatAccountId ?? ""} onChange={(event) => onUpdateChannelField("wechatAccountId", event.target.value)} />
								</Field>
								<Field label="Base URL">
									<Input value={channelDraft.wechatBaseUrl ?? ""} onChange={(event) => onUpdateChannelField("wechatBaseUrl", event.target.value)} />
								</Field>
							</div>
							<Field label="Bot Token">
								<SecretInput
									value={channelDraft.wechatBotToken ?? ""}
									onChange={(event) => onUpdateChannelField("wechatBotToken", event.target.value)}
									placeholder="留空保存会清除当前微信 Bot Token"
								/>
							</Field>
						</div>
					) : null}
					{hasSlackChannel ? (
						<div className="pie-smooth-corner space-y-4 rounded-[42px] bg-[var(--slate-2)] p-5">
							<SectionTitle title="Slack" description="Socket Mode 需要 Bot Token 和 App Token；token 只保存到该 Agent 的 .env。" />
							<div className="grid grid-cols-2 gap-4">
								<Field label="Bot Token">
									<SecretInput value={channelDraft.slackBotToken ?? ""} onChange={(event) => onUpdateChannelField("slackBotToken", event.target.value)} />
								</Field>
								<Field label="App Token">
									<SecretInput value={channelDraft.slackAppToken ?? ""} onChange={(event) => onUpdateChannelField("slackAppToken", event.target.value)} />
								</Field>
							</div>
							<div className="grid grid-cols-3 gap-4">
								<Field label="Team ID">
									<Input value={channelDraft.slackTeamId ?? ""} onChange={(event) => onUpdateChannelField("slackTeamId", event.target.value)} />
								</Field>
								<Field label="App ID">
									<Input value={channelDraft.slackAppId ?? ""} onChange={(event) => onUpdateChannelField("slackAppId", event.target.value)} />
								</Field>
								<Field label="Bot User ID">
									<Input value={channelDraft.slackBotUserId ?? ""} onChange={(event) => onUpdateChannelField("slackBotUserId", event.target.value)} />
								</Field>
							</div>
							<Field label="Signing Secret">
								<SecretInput value={channelDraft.slackSigningSecret ?? ""} onChange={(event) => onUpdateChannelField("slackSigningSecret", event.target.value)} />
							</Field>
						</div>
					) : null}
					{hasDiscordChannel ? (
						<div className="pie-smooth-corner space-y-4 rounded-[42px] bg-[var(--slate-2)] p-5">
							<SectionTitle title="Discord" description="需要 Bot Token；服务端消息还需要开启 Message Content Intent。" />
							<Field label="Bot Token">
								<SecretInput value={channelDraft.discordBotToken ?? ""} onChange={(event) => onUpdateChannelField("discordBotToken", event.target.value)} />
							</Field>
							<div className="grid grid-cols-2 gap-4">
								<Field label="Application ID">
									<Input value={channelDraft.discordApplicationId ?? ""} onChange={(event) => onUpdateChannelField("discordApplicationId", event.target.value)} />
								</Field>
								<Field label="Guild ID">
									<Input value={channelDraft.discordGuildId ?? ""} onChange={(event) => onUpdateChannelField("discordGuildId", event.target.value)} />
								</Field>
							</div>
						</div>
					) : null}
					{hasTelegramChannel ? (
						<div className="pie-smooth-corner space-y-4 rounded-[42px] bg-[var(--slate-2)] p-5">
							<SectionTitle title="Telegram" description="从 BotFather 获取 Bot Token；token 只保存到该 Agent 的 .env。" />
							<Field label="Bot Token">
								<SecretInput value={channelDraft.telegramBotToken ?? ""} onChange={(event) => onUpdateChannelField("telegramBotToken", event.target.value)} />
							</Field>
							<Field label="Bot Username">
								<Input value={channelDraft.telegramBotUsername ?? ""} onChange={(event) => onUpdateChannelField("telegramBotUsername", event.target.value)} />
							</Field>
						</div>
					) : null}
					{channelKinds.length ? (
						<div className="pie-smooth-corner space-y-3 rounded-[42px] bg-[var(--slate-2)] p-5">
							<SectionTitle title="IM 消息样式" description="控制消息在 IM 中的呈现样式" />
							<label className="flex cursor-pointer items-start gap-3 py-2.5">
								<Checkbox
									checked={channelDraft.outputToolCallsToIm ?? true}
									onCheckedChange={(checked) => onUpdateChannelField("outputToolCallsToIm", checked)}
									className="mt-0.5"
								/>
								<span className="min-w-0 flex-1">
									<span className="block text-sm font-medium leading-snug text-foreground text-balance">在 IM 中显示工具调用</span>
									<span className="mt-0.5 block text-sm font-normal leading-snug text-muted-foreground text-pretty">开启后，Agent 调用工具时会把工具名和执行状态同步发到已启用渠道。</span>
								</span>
							</label>
						</div>
					) : null}
					{!channelKinds.length ? (
						<div className="pie-smooth-corner rounded-[42px] bg-[var(--slate-2)] px-5 py-8 text-center text-sm text-muted-foreground">
							该 Agent 还没有启用的 IM 渠道。
						</div>
					) : null}
					<div className="pie-smooth-corner rounded-[42px] bg-[var(--slate-2)] px-5 py-6 text-center text-sm text-muted-foreground">
						多渠道支持尚在开发中
					</div>
					<div className="flex items-center justify-between gap-3 pt-1">
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
						<div className="pie-smooth-corner flex min-w-0 flex-col rounded-[36px] bg-[var(--slate-2)] p-4">
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
				<div className="mt-1 min-w-0 text-pretty text-xs leading-snug text-muted-foreground">{description}</div>
			) : null}
		</div>
	);
}

function SecretInput({
	value,
	onChange,
	placeholder,
}: {
	value: string;
	onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
	placeholder?: string;
}): JSX.Element {
	const [visible, setVisible] = useState(false);
	return (
		<div className="group/secret-input relative">
			<Input
				type={visible ? "text" : "password"}
				value={value}
				onChange={onChange}
				placeholder={placeholder}
				className="pr-10"
			/>
			<Button
				type="button"
				variant="unstyled"
				size="inline"
				className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center text-[var(--slate-10)] opacity-0 transition-none hover:text-[var(--slate-12)] active:!translate-y-[-50%] focus:opacity-100 group-hover/secret-input:opacity-100 group-focus-within/secret-input:opacity-100"
				onClick={() => setVisible((current) => !current)}
				aria-label={visible ? "隐藏密钥" : "显示密钥"}
			>
				<AppIcon IconComponent={visible ? EyeClosedBold : EyeBold} className="size-5" />
			</Button>
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
		const maxValue = useMemo(() => Math.max(1, ...points), [points]);

	return (
		<div className={cn("pie-smooth-corner flex min-h-[8.5rem] min-w-0 flex-col overflow-hidden rounded-[36px] p-4", className)}>
			<div className="flex items-start justify-between gap-3">
				<SectionTitle title={title} className="min-w-0" />
				<div className="shrink-0 text-right text-2xl font-bold tracking-tight text-foreground tabular-nums">{value}</div>
			</div>
			{hint ? (
				<p className="mt-1 min-w-0 truncate text-xs leading-none text-muted-foreground">{hint}</p>
			) : null}
			<div className="relative mt-2 h-[72px]">
				<div className="absolute inset-0 flex items-end gap-px pb-0.5">
					{points.length ? points.map((point, index) => (
						<div
							key={`${index}-${point}`}
							className="min-w-0 flex-1 rounded-t-[3px]"
							style={{
								height: `${point > 0 ? Math.max(4, (point / maxValue) * 100) : 2}%`,
								backgroundColor: stroke,
								opacity: 0.28 + (point / maxValue) * 0.52,
							}}
						/>
					)) : (
						<div className="h-0.5 w-full rounded-full bg-[var(--slate-a4)]" />
					)}
				</div>
				<div className="absolute inset-x-0 bottom-[27%] border-t border-dashed border-[var(--slate-a4)]" />
			</div>
		</div>
	);
}

const PROFILE_STORAGE_BAR_CAP_BYTES = 500 * 1024 * 1024;

function StorageDetailCard({ resources }: { resources?: AgentResourceStats }): JSX.Element {
	const storageBytes = resources?.storageBytes ?? 0;
	const diskAvailableBytes = resources?.diskAvailableBytes;
	const diskTotalBytes = resources?.diskTotalBytes;
	const rawBarPercent = (storageBytes / PROFILE_STORAGE_BAR_CAP_BYTES) * 100;
	const barWidthPercent = storageBytes <= 0 ? 0 : Math.min(100, Math.max(2, rawBarPercent));

	return (
		<div className="pie-smooth-corner flex min-w-0 flex-col rounded-[36px] bg-[var(--slate-2)] p-4">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
				<div className="min-w-0">
					<SectionTitle title="存储空间" description="Agent 占用的存储空间" />
				</div>
				<div className="shrink-0 text-2xl font-bold tracking-tight text-foreground tabular-nums">
					{formatBytes(storageBytes)}
				</div>
			</div>
			<div className="pie-smooth-corner mt-3 space-y-3 rounded-[24px] py-3">
				<div className="h-2 overflow-hidden rounded-full bg-[var(--slate-4)]">
					<div
						className="h-full max-w-full rounded-full bg-[var(--slate-8)] transition-[width] duration-300"
						style={{ width: `${barWidthPercent}%` }}
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
