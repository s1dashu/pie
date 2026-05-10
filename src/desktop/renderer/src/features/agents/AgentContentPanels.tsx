import { lazy, Suspense, useMemo, useState } from "react";
import type * as React from "react";
import { EyeBold, EyeClosedBold, FolderOpenBoldDuotone, RestartCircleBoldDuotone } from "solar-icon-set";
import type { AgentDetails, AgentDraft, AgentResourceStats, AgentSkillSource, AgentSystemPromptSource, AgentUsageStats, DesktopFeishuMessageOutputMode, DesktopImGroupResponseMode, DesktopModelOption, DesktopThinkingLevel } from "../../../shared/types";
import { Checkbox } from "../../components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { AgentLoadingIndicator } from "../../components/shared/agent-loading-indicator";
import { AppIcon } from "../../components/shared/app-icon";
import { Field } from "../../components/shared/field";
import { UsageMetric } from "../../components/shared/metrics";
import { AceternityTooltip } from "../../components/shared/tooltip";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { brandOptions, formatCount, formatDuration, formatTokenCount, thinkingLevelOptions, type AgentTab } from "./agent-display";
import { ProviderSelect } from "./ProviderSelect";

const AgentLogsPanel = lazy(() => import("./AgentLogsPanel").then((module) => ({ default: module.AgentLogsPanel })));
const AgentChatPanel = lazy(() => import("./AgentChatPanel").then((module) => ({ default: module.AgentChatPanel })));

const imGroupResponseOptions = [
	{ value: "collect_only", labelKey: "imGroupResponseCollectOnly" },
	{ value: "owner_mention", labelKey: "imGroupResponseOwnerMention" },
	{ value: "mention", labelKey: "imGroupResponseMention" },
	{ value: "owner", labelKey: "imGroupResponseOwner" },
	{ value: "any", labelKey: "imGroupResponseAny" },
] as const satisfies Array<{ value: DesktopImGroupResponseMode; labelKey: Parameters<ReturnType<typeof useI18n>["t"]>[0] }>;

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
	isSyncingFeishu,
	isSyncingDiscord,
	isReauthorizingFeishu,
	isReauthorizingWechat,
	onUpdateField,
	onUpdateProviderSelection,
	onOpenSystemPrompt,
	onOpenSkillSource,
	onOpenSkillFolder,
	onUpdateChannelField,
	onSyncFeishu,
	onSyncDiscord,
	onReauthorizeFeishu,
	onReauthorizeWechat,
}: {
	activeTab: AgentTab;
	agent: AgentDetails;
	usage: AgentUsageStats;
	resources?: AgentResourceStats;
	resourceHistory: ResourceChartHistory;
	draft: AgentDraft;
	channelDraft: AgentDraft;
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
	isSyncingFeishu: boolean;
	isSyncingDiscord: boolean;
	isReauthorizingFeishu: boolean;
	isReauthorizingWechat: boolean;
	onUpdateField: (field: keyof AgentDraft, value: AgentDraft[keyof AgentDraft]) => void;
	onUpdateProviderSelection: (provider: string) => void;
	onOpenSystemPrompt: () => void;
	onOpenSkillSource: (sourceId: string) => void;
	onOpenSkillFolder: (sourceId: string, skillName: string) => void;
	onUpdateChannelField: (field: keyof AgentDraft, value: AgentDraft[keyof AgentDraft]) => void;
	onSyncFeishu: () => void;
	onSyncDiscord: () => void;
	onReauthorizeFeishu: () => void;
	onReauthorizeWechat: () => void;
}): JSX.Element {
	const { language, t } = useI18n();
	const visibleSkillSources = useMemo(() => orderSkillSources(skillSources), [skillSources]);
	const totalMessages = usage.total.incomingMessages + usage.total.outgoingMessages;
	const todayMessages = usage.today.incomingMessages + usage.today.outgoingMessages;
	const hasFeishuChannel = Boolean(agent.channelKinds?.includes("feishu") || agent.appId);
	const isFeishuCredentialInvalidated = agent.feishuCredentialState === "invalidated";
	const hasWechatChannel = Boolean(agent.channelKinds?.includes("wechat") || agent.wechat);
	const hasDiscordChannel = Boolean(agent.channelKinds?.includes("discord") || agent.discord);
	const channelKinds = [
		...(hasFeishuChannel ? ["feishu"] : []),
		...(hasWechatChannel ? ["wechat"] : []),
		...(hasDiscordChannel ? ["discord"] : []),
	];
	const usesCodexCli = draft.provider === "codex-cli" || agent.harnessKind === "codex";
	const showsSystemPrompt = agent.harnessKind === "ousia";
	const usesFeishuMessageCard = hasFeishuChannel && (channelDraft.feishuMessageOutputMode ?? "bubble") === "card";
	const showsTokenUsage = supportsTokenUsage(agent.harnessKind);

	return (
		<div className={activeTab === "logs" || activeTab === "chat" ? "mx-auto flex h-full min-h-0 max-w-6xl flex-col" : ""}>
			{activeTab === "chat" ? (
				<Suspense fallback={<PanelLoading label={t("loading")} />}>
					<AgentChatPanel agent={agent} resources={resources} />
				</Suspense>
			) : activeTab === "overview" ? (
				<div className="mx-auto max-w-6xl space-y-4">
					<div className={cn("grid gap-4 max-[760px]:gap-3 max-[560px]:grid-cols-2", showsTokenUsage ? "grid-cols-4" : "grid-cols-3")}>
						<UsageMetric
							label={t("messageCount")}
							value={formatCount(totalMessages, language)}
							hint={t("todayMetric", { value: formatCount(todayMessages, language) })}
						/>
						{showsTokenUsage ? (
							<UsageMetric
								label={t("tokenUsage")}
								value={formatTokenCountCompact(usage.total.tokens)}
								hint={t("todayMetric", { value: formatTokenCountCompact(usage.today.tokens) })}
							/>
						) : null}
						<UsageMetric
							label={t("runDuration")}
							value={formatDuration(usage.total.runDurationMs)}
							hint={t("todayMetric", { value: formatDuration(usage.today.runDurationMs) })}
						/>
						<UsageMetric
							label={t("averageTtfs")}
							value={formatTtfs(usage.averageTtfsMs)}
							hint={t("ttfsDefinition")}
						/>
					</div>
					<div className="grid grid-cols-2 gap-4 max-[620px]:grid-cols-1">
						<ResourceChartCard
							className="min-w-0 bg-[var(--slate-2)]"
							title={t("memory")}
							value={formatBytes(resources?.memoryBytes ?? 0)}
							hint={t("recentUsageCurve")}
							tone="slate"
							points={resourceHistory.memory}
							chartKind="bars"
						/>
						<ResourceChartCard
							className="min-w-0 bg-[var(--slate-2)]"
							title="CPU"
							value={formatPercent(resources?.cpuPercent ?? 0)}
							hint={t("mainProcessUsage")}
							tone="slate"
							points={resourceHistory.cpu}
							chartKind="line"
						/>
						<StorageDetailCard
							resources={resources}
							className="col-span-2 max-[620px]:col-span-1"
						/>
					</div>
				</div>
			) : activeTab === "logs" ? (
				<Suspense fallback={<PanelLoading label={t("loading")} tone="dark" />}>
					<AgentLogsPanel agent={agent} title={t("runtimeLogs")} />
				</Suspense>
			) : activeTab === "model" ? (
				<div className="mx-auto max-w-5xl space-y-4">
					<div className="pie-smooth-corner space-y-4 rounded-[42px] bg-[var(--slate-2)] p-4">
						<SectionTitle title={t("modelConfig")} />
						<div className={cn("grid gap-4", usesCodexCli ? "grid-cols-1" : "grid-cols-2")}>
							{!usesCodexCli ? (
								<Field label="Provider">
									<ProviderSelect
										value={draft.provider ?? ""}
										providers={providerOptions}
										placeholder={isModelCatalogLoading ? t("loadingProviders") : t("selectProvider")}
										onValueChange={onUpdateProviderSelection}
									/>
								</Field>
							) : null}
							<Field label="Model">
								<Select
									value={draft.model ?? ""}
									onValueChange={(nextModel) => onUpdateField("model", nextModel)}
									disabled={!modelOptions.length}
								>
									<SelectTrigger>
										<SelectValue placeholder={isModelCatalogLoading ? t("loadingModels") : t("selectModel")} />
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
						<Field label={t("thinkingLevel")}>
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
						{!usesCodexCli ? (
							<Field label="API Key">
								<SecretInput
									value={draft.apiKey ?? ""}
									onChange={(event) => onUpdateField("apiKey", event.target.value)}
									placeholder={t("apiKeyClearHint")}
								/>
							</Field>
						) : null}
					</div>
					{showsSystemPrompt ? (
						<SystemPromptCard
							source={systemPrompt}
							isLoading={isLoadingSystemPrompt}
							isOpening={isOpeningSystemPrompt}
							onOpen={onOpenSystemPrompt}
						/>
					) : null}
					<div className="pie-smooth-corner rounded-[42px] bg-[var(--slate-2)] px-5 py-5">
						<div className="flex items-start justify-between gap-4 px-1">
							<SectionTitle title={t("skillsManagement")} description={t("skillsManagementDesc")} />
						</div>
						<div className="mt-5 grid gap-4">
							{isLoadingSkillSources ? (
								<AgentLoadingIndicator className="pie-smooth-corner h-24 rounded-[36px] bg-white" label={t("readingSkills")} />
							) : (
								visibleSkillSources.map((source) => (
									<SkillSourceRow
										key={source.id}
										source={source}
										isOpening={openingSkillSourceId === source.id}
										onOpen={() => onOpenSkillSource(source.id)}
										onOpenSkill={(skillName) => onOpenSkillFolder(source.id, skillName)}
									/>
								))
							)}
						</div>
					</div>
				</div>
			) : activeTab === "channels" ? (
				<div className="mx-auto max-w-5xl space-y-4">
					{hasFeishuChannel ? (
						<div className="pie-smooth-corner space-y-4 rounded-[42px] bg-[var(--slate-2)] p-4">
							<div className="flex items-start justify-between gap-4">
								<SectionTitle title={t("feishu")} description={t("validateFeishu")} />
								<AceternityTooltip content={t("syncFeishuProfile")}>
									<Button
										type="button"
										variant="secondary"
										size="small"
										className="shrink-0 rounded-full transition-[background-color,box-shadow,transform] active:scale-[0.96]"
										disabled={isSyncingFeishu}
										onClick={onSyncFeishu}
									>
										<AppIcon IconComponent={RestartCircleBoldDuotone} className={cn("size-4", isSyncingFeishu ? "animate-spin" : "")} />
										<span>{isSyncingFeishu ? t("fetching") : t("fetch")}</span>
									</Button>
								</AceternityTooltip>
							</div>
							{isFeishuCredentialInvalidated ? (
								<Button
									type="button"
									variant="unstyled"
									size="inline"
									className="h-auto w-full justify-start rounded-2xl border border-[var(--amber-6)] bg-[var(--amber-3)] px-3 py-2 text-left text-xs leading-5 text-[var(--amber-11)] transition-[background-color,border-color,color,transform] hover:border-[var(--amber-7)] hover:bg-[var(--amber-4)] hover:text-[var(--amber-12)] active:scale-[0.99]"
									onClick={onReauthorizeFeishu}
									disabled={isReauthorizingFeishu}
								>
									{t("feishuCredentialInvalidatedDesc")}
								</Button>
							) : null}
							<div className="grid grid-cols-2 gap-4">
								<Field label="App ID">
									<Input value={channelDraft.appId ?? ""} onChange={(event) => onUpdateChannelField("appId", event.target.value)} />
								</Field>
								<Field label="App Secret">
									<SecretInput value={channelDraft.appSecret ?? ""} onChange={(event) => onUpdateChannelField("appSecret", event.target.value)} />
								</Field>
							</div>
							<Field label={t("region")}>
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
						<div className="pie-smooth-corner space-y-4 rounded-[42px] bg-[var(--slate-2)] p-4">
							<div className="flex items-start justify-between gap-4">
								<SectionTitle title={t("wechat")} description={t("wechatTokenDesc")} />
								<AceternityTooltip content={t("reauthorizeWechatTooltip")}>
									<Button
										type="button"
										variant="secondary"
										size="small"
										className="shrink-0 rounded-full transition-[background-color,box-shadow,transform] active:scale-[0.96]"
										disabled={isReauthorizingWechat}
										onClick={onReauthorizeWechat}
									>
										<span>{t("reauthorizeWechat")}</span>
									</Button>
								</AceternityTooltip>
							</div>
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
									placeholder={t("wechatTokenClearHint")}
								/>
							</Field>
						</div>
					) : null}
					{hasDiscordChannel ? (
						<div className="pie-smooth-corner space-y-4 rounded-[42px] bg-[var(--slate-2)] p-4">
							<div className="flex items-start justify-between gap-4">
								<SectionTitle title="Discord" description={t("discordDesc")} />
								<AceternityTooltip content={t("syncDiscordProfile")}>
									<Button
										type="button"
										variant="secondary"
										size="small"
										className="shrink-0 rounded-full transition-[background-color,box-shadow,transform] active:scale-[0.96]"
										disabled={isSyncingDiscord || !channelDraft.discordBotToken?.trim()}
										onClick={onSyncDiscord}
									>
										<AppIcon IconComponent={RestartCircleBoldDuotone} className={cn("size-4", isSyncingDiscord ? "animate-spin" : "")} />
										<span>{isSyncingDiscord ? t("fetching") : t("fetch")}</span>
									</Button>
								</AceternityTooltip>
							</div>
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
					{channelKinds.length ? (
						<div className="pie-smooth-corner space-y-3 rounded-[42px] bg-[var(--slate-2)] p-4">
							<SectionTitle title={t("imChannelBehavior")} />
							<Field label={t("imGroupResponseMode")}>
								<Select
									value={channelDraft.imGroupResponseMode ?? "owner_mention"}
									onValueChange={(value) => onUpdateChannelField("imGroupResponseMode", value as DesktopImGroupResponseMode)}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{imGroupResponseOptions.map((item) => (
											<SelectItem key={item.value} value={item.value}>{t(item.labelKey)}</SelectItem>
										))}
									</SelectContent>
								</Select>
							</Field>
							<label className="flex cursor-pointer items-start gap-3 py-2.5">
								<Checkbox
									checked={!(channelDraft.resumeSessions ?? false)}
									onCheckedChange={(checked) => onUpdateChannelField("resumeSessions", !checked)}
									className="mt-0.5"
								/>
								<span className="min-w-0 flex-1">
									<span className="block text-sm font-medium leading-snug text-foreground text-balance">{t("startFreshOnRestart")}</span>
									<span className="mt-0.5 block text-xs font-normal leading-5 text-muted-foreground text-pretty">{t("startFreshOnRestartDesc")}</span>
								</span>
							</label>
						</div>
					) : null}
					{channelKinds.length ? (
						<div className="pie-smooth-corner space-y-3 rounded-[42px] bg-[var(--slate-2)] p-4">
							<SectionTitle title={t("imMessageStyle")} description={t("imMessageStyleDesc")} />
							{hasFeishuChannel ? (
								<Field label={t("feishuMessageOutputMode")}>
									<Select
										value={channelDraft.feishuMessageOutputMode ?? "bubble"}
										onValueChange={(value) => {
											const nextMode = value as DesktopFeishuMessageOutputMode;
											onUpdateChannelField("feishuMessageOutputMode", nextMode);
											if (nextMode === "card") {
												onUpdateChannelField("outputThinkingToIm", false);
											}
										}}
									>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="bubble">{t("feishuMessageOutputBubble")}</SelectItem>
											<SelectItem value="card">{t("feishuMessageOutputCard")}</SelectItem>
										</SelectContent>
									</Select>
									<div className="mt-1 text-xs leading-5 text-muted-foreground text-pretty">
										{t("feishuMessageOutputModeDesc")}
									</div>
								</Field>
							) : null}
							<label className="flex cursor-pointer items-start gap-3 py-2.5">
								<Checkbox
									checked={channelDraft.outputToolCallsToIm ?? true}
									onCheckedChange={(checked) => onUpdateChannelField("outputToolCallsToIm", checked)}
									className="mt-0.5"
								/>
								<span className="min-w-0 flex-1">
									<span className="block text-sm font-medium leading-snug text-foreground text-balance">{t("showToolCallsInIm")}</span>
									<span className="mt-0.5 block text-xs font-normal leading-5 text-muted-foreground text-pretty">{t("showToolCallsInImDesc")}</span>
								</span>
							</label>
							<label className={cn("flex items-start gap-3 py-2.5", usesFeishuMessageCard ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
								<Checkbox
									checked={usesFeishuMessageCard ? false : channelDraft.outputThinkingToIm ?? false}
									onCheckedChange={(checked) => onUpdateChannelField("outputThinkingToIm", checked)}
									disabled={usesFeishuMessageCard}
									className="mt-0.5"
								/>
								<span className="min-w-0 flex-1">
									<span className="block text-sm font-medium leading-snug text-foreground text-balance">{t("showThinkingInIm")}</span>
									<span className="mt-0.5 block text-xs font-normal leading-5 text-muted-foreground text-pretty">
										{usesFeishuMessageCard ? t("showThinkingInImCardUnsupportedDesc") : t("showThinkingInImDesc")}
									</span>
								</span>
							</label>
							<Field label={t("toolCallTruncation")}>
								<Select
									value={String(channelDraft.outputToolCallImMaxLength ?? 60)}
									onValueChange={(value) => onUpdateChannelField("outputToolCallImMaxLength", value === "none" ? "none" : Number(value) as 60 | 100 | 200)}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="60">{t("toolCallTruncation60")}</SelectItem>
										<SelectItem value="100">{t("toolCallTruncation100")}</SelectItem>
										<SelectItem value="200">{t("toolCallTruncation200")}</SelectItem>
										<SelectItem value="none">{t("toolCallTruncationNone")}</SelectItem>
									</SelectContent>
								</Select>
							</Field>
						</div>
					) : null}
					{!channelKinds.length ? (
						<div className="pie-smooth-corner rounded-[42px] bg-[var(--slate-2)] px-4 py-6 text-center text-sm text-muted-foreground">
							{t("noImChannels")}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function PanelLoading({ label, tone = "light" }: { label: string; tone?: "light" | "dark" }): JSX.Element {
	return (
		<AgentLoadingIndicator
			className={cn(
				"h-full min-h-0 rounded-[42px]",
				tone === "dark" ? "bg-slate-950 text-slate-400" : "bg-[var(--slate-2)] text-muted-foreground",
			)}
			color={tone === "dark" ? "rgb(148 163 184)" : "var(--slate-11)"}
			label={label}
		/>
	);
}

function supportsTokenUsage(harnessKind: AgentDetails["harnessKind"]): boolean {
	return harnessKind !== "openclaw";
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
	const { t } = useI18n();
	return (
		<div className="pie-smooth-corner group/system-prompt relative rounded-[42px] bg-[var(--slate-2)] p-4">
			<div className="pr-9">
				<SectionTitle title={t("systemPrompt")} />
				<div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
					{source?.path || source?.description || "Loading..."}
				</div>
			</div>
			<AceternityTooltip content={t("openSystemPrompt")} className="absolute right-4 top-3.5">
				<Button
					variant="unstyled"
					size="inline"
					className="inline-flex h-8 w-8 items-center justify-center text-[var(--slate-10)] opacity-0 transition-[color,opacity,transform] hover:text-[var(--slate-12)] focus:opacity-100 group-hover/system-prompt:opacity-100"
					onClick={onOpen}
					disabled={isLoading || isOpening || !source?.path}
					aria-label="Open System Prompt"
				>
					<AppIcon IconComponent={FolderOpenBoldDuotone} className="size-7" />
				</Button>
			</AceternityTooltip>
			<div className="pie-smooth-corner mt-3.5 max-h-56 overflow-auto rounded-[28px] bg-white px-3.5 py-2.5">
				<pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground">
					{isLoading ? t("readingSystemPrompt") : source?.exists ? source.content : t("systemPromptMissing")}
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
			<div className="truncate text-base font-semibold leading-snug text-foreground text-balance">{title}</div>
			{description ? (
				<div className="mt-1 min-w-0 text-pretty text-xs leading-5 text-muted-foreground">{description}</div>
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
	const { t } = useI18n();
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
				aria-label={visible ? t("hideSecret") : t("showSecret")}
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
	chartKind,
	className,
}: {
	title: string;
	value: string;
	hint?: string;
	tone: "slate";
	points: number[];
	chartKind?: "bars" | "line";
	className?: string;
}): JSX.Element {
	const stroke = "var(--slate-8)";
	const maxValue = useMemo(() => Math.max(1, ...points), [points]);
	const linePath = useMemo(() => createSmoothedChartPath(points, maxValue), [maxValue, points]);

	return (
		<div className={cn("pie-smooth-corner flex min-h-[13rem] min-w-0 flex-col overflow-hidden rounded-[36px] p-3.5", className)}>
			<div className="flex flex-col gap-2 min-[980px]:flex-row min-[980px]:items-start min-[980px]:justify-between min-[980px]:gap-3">
				<SectionTitle title={title} className="min-w-0" />
				<div className="shrink-0 text-xl font-bold tracking-tight text-foreground tabular-nums min-[980px]:text-right min-[980px]:text-2xl">{value}</div>
			</div>
			{hint ? (
				<p className="mt-1 min-w-0 truncate text-xs leading-none text-muted-foreground">{hint}</p>
			) : null}
			<div className="relative mt-2 min-h-[72px] flex-1">
				{chartKind === "line" ? (
					<svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 64" preserveAspectRatio="none" aria-hidden="true">
						{linePath ? (
							<path d={linePath} fill="none" stroke={stroke} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3.2" opacity="0.72" vectorEffect="non-scaling-stroke" />
						) : (
							<path d="M 0 62 L 100 62" fill="none" stroke="var(--slate-a4)" strokeLinecap="round" strokeWidth="2" vectorEffect="non-scaling-stroke" />
						)}
					</svg>
				) : (
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
				)}
			</div>
		</div>
	);
}

function createSmoothedChartPath(points: number[], maxValue: number): string {
	if (points.length === 0) {
		return "";
	}

	const width = 100;
	const height = 64;
	const bottomPadding = 2;
	const topPadding = 3;
	const drawableHeight = height - topPadding - bottomPadding;
	const coordinates = points.map((point, index) => {
		const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
		const normalized = Math.min(1, Math.max(0, point / maxValue));
		const y = topPadding + (1 - normalized) * drawableHeight;

		return { x, y };
	});

	if (coordinates.length === 1) {
		const { x, y } = coordinates[0];

		return `M ${x - 2} ${y} L ${x + 2} ${y}`;
	}

	return coordinates.reduce((path, point, index) => {
		if (index === 0) {
			return `M ${point.x} ${point.y}`;
		}

		const previous = coordinates[index - 1];
		const controlX = (previous.x + point.x) / 2;

		return `${path} C ${controlX} ${previous.y}, ${controlX} ${point.y}, ${point.x} ${point.y}`;
	}, "");
}

const PROFILE_STORAGE_BAR_CAP_BYTES = 500 * 1024 * 1024;

function StorageDetailCard({
	resources,
	className,
}: {
	resources?: AgentResourceStats;
	className?: string;
}): JSX.Element {
	const { t } = useI18n();
	const storageBytes = resources?.storageBytes ?? 0;
	const diskTotalBytes = resources?.diskTotalBytes;
	const diskAvailableBytes = resources?.diskAvailableBytes;
	const rawBarPercent = (storageBytes / PROFILE_STORAGE_BAR_CAP_BYTES) * 100;
	const barWidthPercent = storageBytes <= 0 ? 0 : Math.min(100, Math.max(2, rawBarPercent));
	const storageMetrics = [
		{ label: t("profileUsage"), value: formatBytes(storageBytes) },
		{ label: t("diskAvailable"), value: formatOptionalBytes(diskAvailableBytes, t("unknown")) },
		{ label: t("diskCapacity"), value: formatOptionalBytes(diskTotalBytes, t("unknown")) },
	];

	return (
		<div className={cn("pie-smooth-corner flex min-w-0 flex-col rounded-[36px] bg-[var(--slate-2)] px-4 py-2.5", className)}>
			<div className="min-w-0">
				<div className="flex min-w-0 items-start justify-between gap-4">
					<SectionTitle title={t("storage")} />
					{diskTotalBytes && diskAvailableBytes !== undefined ? (
						<div className="shrink-0 pt-0.5 text-right text-xs font-medium text-muted-foreground tabular-nums">
							{formatPercent((diskAvailableBytes / diskTotalBytes) * 100)} {t("diskAvailable")}
						</div>
					) : null}
				</div>
				<div className="mt-2.5 grid grid-cols-3 gap-3 max-[760px]:grid-cols-1">
					{storageMetrics.map((metric) => (
						<div key={metric.label} className="min-w-0">
							<div className="truncate text-xs font-medium uppercase text-muted-foreground">{metric.label}</div>
							<div className="mt-1 truncate text-lg font-bold tracking-tight text-foreground tabular-nums min-[980px]:text-xl">
								{metric.value}
							</div>
						</div>
					))}
				</div>
				<div className="mt-2.5">
					<div className="h-1.5 overflow-hidden rounded-full bg-[var(--slate-4)]">
						<div
							className="h-full max-w-full rounded-full bg-[var(--slate-8)] transition-[width] duration-300"
							style={{ width: `${barWidthPercent}%` }}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}

function formatOptionalBytes(bytes: number | undefined, fallback: string): string {
	return bytes !== undefined && Number.isFinite(bytes) ? formatBytes(bytes) : fallback;
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

function formatTokenCountCompact(value: number): string {
	const abs = Math.abs(value);
	if (abs >= 1_000_000) {
		return `${Math.round(value / 1_000_000)}M`;
	}
	if (abs >= 1_000) {
		return `${Math.round(value / 1_000)}K`;
	}
	return formatCount(value);
}

function formatTtfs(value: number | undefined): string {
	if (value === undefined || !Number.isFinite(value)) {
		return "--";
	}
	if (value < 1000) {
		return `${Math.round(value)}ms`;
	}
	if (value < 10_000) {
		return `${(value / 1000).toFixed(1)}s`;
	}
	return `${Math.round(value / 1000)}s`;
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
	onOpenSkill,
}: {
	source: AgentSkillSource;
	isOpening: boolean;
	onOpen: () => void;
	onOpenSkill: (skillName: string) => void;
}): JSX.Element {
	const { t } = useI18n();
	const preview = source.skills.slice(0, 8);
	const desc = source.description.trim();
	return (
		<div className="pie-smooth-corner group/skill-source relative flex min-h-[148px] flex-col rounded-[32px] bg-white px-4 py-3.5 pr-14 shadow-[0_1px_0_rgba(15,23,42,0.03)]">
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				<div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-2">
					<div className="text-[15px] font-semibold leading-6 text-foreground text-balance">{source.label}</div>
					<div className={cn(
						"rounded-full px-2.5 py-1 text-xs font-semibold leading-none tabular-nums",
						source.exists ? "bg-[var(--lime-3)] text-[var(--lime-11)]" : "bg-[var(--slate-3)] text-muted-foreground",
					)}>
						{source.exists ? t("skillCount", { count: source.skillCount }) : t("notCreated")}
					</div>
				</div>
				{desc ? (
					<div className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground text-pretty">{desc}</div>
				) : null}
				<div className={cn("shrink-0 truncate font-mono text-xs leading-5 text-muted-foreground", desc ? "mt-3" : "mt-2")}>{source.path}</div>
				<div className="mt-auto shrink-0 pt-6">
					<div className="flex min-w-0 flex-wrap gap-2.5 overflow-visible">
						{preview.map((skill) => (
							<button
								key={skill}
								type="button"
								className="min-w-0 max-w-full truncate rounded-full bg-[var(--slate-2)] px-3 py-1.5 text-sm leading-5 text-muted-foreground transition-[background-color,color,scale] hover:bg-[var(--slate-3)] hover:text-foreground active:scale-[0.96] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
								onClick={() => onOpenSkill(skill)}
								title={t("openSkill", { name: skill })}
							>
								{skill}
							</button>
						))}
						{source.skills.length > preview.length ? (
							<span className="shrink-0 rounded-full bg-[var(--slate-2)] px-3 py-1.5 text-sm leading-5 text-muted-foreground tabular-nums">
								+{source.skills.length - preview.length}
							</span>
						) : null}
						{source.exists && source.skills.length === 0 ? (
							<span className="rounded-full bg-[var(--slate-2)] px-3 py-1.5 text-sm leading-5 text-muted-foreground">
								{t("noSkills")}
							</span>
						) : null}
					</div>
				</div>
			</div>
			<AceternityTooltip content={t("openSkillsFolder")} className="absolute right-4 top-3.5">
				<Button
					variant="unstyled"
					size="inline"
					className="inline-flex h-9 w-9 items-center justify-center text-[var(--slate-10)] transition-[color,scale] hover:text-[var(--slate-12)] active:scale-[0.96] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
					onClick={onOpen}
					disabled={isOpening}
					aria-label={t("openSkillsFolder")}
				>
					<AppIcon IconComponent={FolderOpenBoldDuotone} className="size-7" />
				</Button>
			</AceternityTooltip>
		</div>
	);
}
