import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type * as React from "react";
import type { DesktopCloseWindowBehavior, DesktopLanguage, DesktopLogRetention, DesktopSettingsDraft } from "../../../shared/types";
import { Field } from "../../components/shared/field";
import { AceternityTooltip } from "../../components/shared/tooltip";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";

const languageOptions: Array<{ value: DesktopLanguage; label: string }> = [
	{ value: "zh", label: "中文" },
	{ value: "en", label: "English" },
];

const closeWindowOptions: Array<{ value: DesktopCloseWindowBehavior; label: string }> = [
	{ value: "hide", label: "隐藏到后台" },
	{ value: "quit", label: "退出 Pie" },
];

const logRetentionOptions: Array<{ value: DesktopLogRetention; label: string }> = [
	{ value: "7d", label: "保存 7 天" },
	{ value: "30d", label: "保存 30 天" },
	{ value: "90d", label: "保存 90 天" },
	{ value: "forever", label: "永久保存" },
];

export function GlobalSettingsView({ onError, onClose }: { onError: (message: string) => void; onClose: () => void }): JSX.Element {
	const queryClient = useQueryClient();
	const settings = useQuery({
		queryKey: ["settings"],
		queryFn: () => window.pie.getSettings(),
	});
	const update = useMutation({
		mutationFn: (draft: DesktopSettingsDraft) => window.pie.updateSettings(draft),
		onSuccess: (next) => {
			queryClient.setQueryData(["settings"], next);
		},
		onError: (error) => onError((error as Error).message),
	});

	const data = settings.data;

	function updateField<K extends keyof DesktopSettingsDraft>(key: K, value: DesktopSettingsDraft[K]): void {
		update.mutate({ [key]: value });
	}

	return (
		<div className="flex h-full flex-col overflow-hidden bg-white">
			<div className="drag-region flex h-[72px] shrink-0 items-center justify-between gap-4 px-7 pt-3">
				<div className="min-w-0">
					<h1 className="text-xl font-semibold tracking-normal text-balance">全局设置</h1>
					<p className="mt-1 text-sm text-muted-foreground text-pretty">这些设置影响 Pie Desktop 和所有 Agent 的运行方式。</p>
				</div>
				<AceternityTooltip content="关闭设置" side="bottom">
					<Button
						variant="unstyled"
						size="inline"
						className="no-drag inline-flex h-8 w-8 shrink-0 items-center justify-center text-[var(--slate-10)] transition hover:text-[var(--slate-12)]"
						onClick={onClose}
						aria-label="关闭全局设置"
					>
						<HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-5" />
					</Button>
				</AceternityTooltip>
			</div>
			<div className="flex-1 overflow-y-auto px-7 pb-8 pt-2">
				{data ? (
					<div className="mx-auto flex max-w-3xl flex-col gap-5">
						<SettingsSection title="通用">
							<Field label="语言">
								<Select value={data.language} onValueChange={(value) => updateField("language", value as DesktopLanguage)}>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{languageOptions.map((item) => (
											<SelectItem key={item.value} value={item.value}>
												{item.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</Field>
						</SettingsSection>

						<SettingsSection title="生命周期">
							<Field label="关闭窗口时">
								<Select value={data.closeWindowBehavior} onValueChange={(value) => updateField("closeWindowBehavior", value as DesktopCloseWindowBehavior)}>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{closeWindowOptions.map((item) => (
											<SelectItem key={item.value} value={item.value}>
												{item.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</Field>
							<SettingToggle
								title="退出 Pie 时终止全部 Agent"
								description="开启后，应用退出时会停止所有仍在运行的 Agent。"
								checked={data.quitTerminatesAgents}
								onCheckedChange={(checked) => updateField("quitTerminatesAgents", checked)}
							/>
							<SettingToggle
								title="重启后自动启动上次运行中的 Agent"
								description="开启后，Pie 启动时会恢复上次处于运行状态的 Agent。"
								checked={data.restoreRunningAgentsOnLaunch}
								onCheckedChange={(checked) => updateField("restoreRunningAgentsOnLaunch", checked)}
							/>
							<SettingToggle
								title="开机自动启动 Pie"
								description="开启后，登录系统时自动打开 Pie。"
								checked={data.openAtLogin}
								onCheckedChange={(checked) => updateField("openAtLogin", checked)}
							/>
						</SettingsSection>

						<SettingsSection title="日志保存策略">
							<Field label="运行日志">
								<Select value={data.runtimeLogRetention} onValueChange={(value) => updateField("runtimeLogRetention", value as DesktopLogRetention)}>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{logRetentionOptions.map((item) => (
											<SelectItem key={item.value} value={item.value}>
												{item.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</Field>
							<Field label="用量事件">
								<Select value={data.usageEventRetention} onValueChange={(value) => updateField("usageEventRetention", value as DesktopLogRetention)}>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{logRetentionOptions.map((item) => (
											<SelectItem key={item.value} value={item.value}>
												{item.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</Field>
						</SettingsSection>

					</div>
				) : (
					<div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
						{settings.isLoading ? "正在加载设置..." : "设置加载失败"}
					</div>
				)}
			</div>
		</div>
	);
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
	return (
		<section className="space-y-3">
			<h2 className="px-1 text-sm font-semibold leading-snug text-foreground/80">{title}</h2>
			<div className="pie-smooth-corner space-y-3 rounded-[24px] bg-[var(--slate-2)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
				{children}
			</div>
		</section>
	);
}

function SettingToggle({
	title,
	description,
	checked,
	onCheckedChange,
}: {
	title: string;
	description: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
}): JSX.Element {
	return (
		<label className="pie-smooth-corner flex min-h-14 cursor-pointer items-center justify-between gap-4 rounded-2xl bg-white px-3 py-2.5">
			<span className="min-w-0">
				<span className="block text-sm font-medium leading-snug text-foreground text-balance">{title}</span>
				<span className="mt-0.5 block text-sm font-normal leading-snug text-muted-foreground text-pretty">{description}</span>
			</span>
			<Checkbox checked={checked} onCheckedChange={onCheckedChange} />
		</label>
	);
}
