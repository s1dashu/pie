import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import type * as React from "react";
import type { DesktopLanguage, DesktopLogRetention, DesktopSettings, DesktopSettingsDraft } from "../../../shared/types";
import { Field } from "../../components/shared/field";
import { AceternityTooltip } from "../../components/shared/tooltip";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { applyAppearanceTheme, getAppearanceStepColor, getDefaultPreviewHue } from "../../lib/appearance-theme";
import { useI18n } from "../../lib/i18n";

const languageOptions: Array<{ value: DesktopLanguage; label: string }> = [
	{ value: "zh", label: "简体中文" },
	{ value: "en", label: "English" },
];

const logRetentionOptions: Array<{ value: DesktopLogRetention; labelKey: "retention7d" | "retention30d" | "retention90d" | "retentionForever" }> = [
	{ value: "7d", labelKey: "retention7d" },
	{ value: "30d", labelKey: "retention30d" },
	{ value: "90d", labelKey: "retention90d" },
	{ value: "forever", labelKey: "retentionForever" },
];

export function GlobalSettingsView({ onError, onClose }: { onError: (message: string) => void; onClose: () => void }): JSX.Element {
	const { t } = useI18n();
	const queryClient = useQueryClient();
	const hasInitializedAppearance = useRef(false);
	const previewAppearanceFrame = useRef<number | undefined>(undefined);
	const previewAppearanceHue = useRef<number | undefined>(undefined);
	const [appearanceGrayHueDraft, setAppearanceGrayHueDraft] = useState<number | undefined>(undefined);
	const settings = useQuery({
		queryKey: ["settings"],
		queryFn: () => window.pie.getSettings(),
	});
	const update = useMutation({
		mutationFn: (draft: DesktopSettingsDraft) => window.pie.updateSettings(draft),
		onMutate: async (draft) => {
			await queryClient.cancelQueries({ queryKey: ["settings"] });
			const previous = queryClient.getQueryData<DesktopSettings>(["settings"]);
			queryClient.setQueryData<DesktopSettings>(["settings"], (current) =>
				current ? { ...current, ...draft } : current,
			);
			return { previous };
		},
		onSuccess: (next) => {
			queryClient.setQueryData(["settings"], next);
		},
		onError: (error, _draft, context) => {
			if (context?.previous) {
				queryClient.setQueryData(["settings"], context.previous);
			}
			onError((error as Error).message);
		},
	});

	const data = settings.data;

	useEffect(() => {
		if (!data || hasInitializedAppearance.current) {
			return;
		}
		hasInitializedAppearance.current = true;
		setAppearanceGrayHueDraft(data?.appearanceGrayHue);
	}, [data]);

	useEffect(() => {
		return () => {
			if (previewAppearanceFrame.current !== undefined) {
				cancelAnimationFrame(previewAppearanceFrame.current);
			}
		};
	}, []);

	function updateField<K extends keyof DesktopSettingsDraft>(key: K, value: DesktopSettingsDraft[K]): void {
		update.mutate({ [key]: value });
	}

	function previewAppearance(value: number): void {
		previewAppearanceHue.current = value;
		if (previewAppearanceFrame.current !== undefined) {
			return;
		}
		previewAppearanceFrame.current = requestAnimationFrame(() => {
			previewAppearanceFrame.current = undefined;
			applyAppearanceTheme(previewAppearanceHue.current);
		});
	}

	function updateAppearanceHue(value: number | undefined): void {
		previewAppearanceHue.current = value;
		if (previewAppearanceFrame.current !== undefined) {
			cancelAnimationFrame(previewAppearanceFrame.current);
			previewAppearanceFrame.current = undefined;
		}
		setAppearanceGrayHueDraft(value);
		applyAppearanceTheme(value);
		update.mutate({ appearanceGrayHue: value });
	}

	return (
		<div className="flex h-full flex-col overflow-hidden bg-white">
			<div className="drag-region flex h-[72px] shrink-0 items-center justify-between gap-4 px-7 pt-3">
				<div className="min-w-0">
					<h1 className="text-xl font-semibold tracking-normal text-balance">{t("globalSettings")}</h1>
					<p className="mt-1 text-sm text-muted-foreground text-pretty">{t("settingsSubtitle")}</p>
				</div>
				<AceternityTooltip content={t("closeSettings")} side="bottom">
					<Button
						variant="unstyled"
						size="inline"
						className="no-drag inline-flex h-8 w-8 shrink-0 items-center justify-center text-[var(--slate-10)] transition hover:text-[var(--slate-12)]"
						onClick={onClose}
						aria-label={t("closeSettings")}
					>
						<HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-5" />
					</Button>
				</AceternityTooltip>
			</div>
			<div className="flex-1 overflow-y-auto px-7 pb-8 pt-2">
				{data ? (
					<div className="mx-auto flex max-w-3xl flex-col gap-5">
						<SettingsSection title={t("general")}>
							<Field label={t("language")}>
								<Select value={data.language} onValueChange={(value) => updateField("language", value as DesktopLanguage)}>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{languageOptions.map((item) => (
											<SelectItem key={item.value} value={item.value}>
												{item.value === "zh" ? t("simplifiedChinese") : item.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</Field>
						</SettingsSection>

						<SettingsSection title={t("appearance")} contentClassName="space-y-4">
							<GrayHuePicker
								hue={appearanceGrayHueDraft}
								onHuePreview={previewAppearance}
								onHueCommit={updateAppearanceHue}
								onReset={() => updateAppearanceHue(undefined)}
							/>
						</SettingsSection>

						<SettingsSection title={t("lifecycle")} contentClassName="space-y-5">
							<SettingToggle
								title={t("quitTerminatesAgents")}
								description={t("quitTerminatesAgentsDesc")}
								checked={data.quitTerminatesAgents}
								onCheckedChange={(checked) => updateField("quitTerminatesAgents", checked)}
							/>
							<SettingToggle
								title={t("restoreAgents")}
								description={t("restoreAgentsDesc")}
								checked={data.restoreRunningAgentsOnLaunch}
								onCheckedChange={(checked) => updateField("restoreRunningAgentsOnLaunch", checked)}
							/>
							<SettingToggle
								title={t("openAtLogin")}
								description={t("openAtLoginDesc")}
								checked={data.openAtLogin}
								onCheckedChange={(checked) => updateField("openAtLogin", checked)}
							/>
							<SettingToggle
								title={t("keepAwakeWhileOpen")}
								description={t("keepAwakeWhileOpenDesc")}
								checked={data.keepAwakeWhileOpen}
								onCheckedChange={(checked) => updateField("keepAwakeWhileOpen", checked)}
							/>
						</SettingsSection>

						<SettingsSection title={t("logRetention")}>
							<Field label={t("runtimeLogs")}>
								<Select value={data.runtimeLogRetention} onValueChange={(value) => updateField("runtimeLogRetention", value as DesktopLogRetention)}>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{logRetentionOptions.map((item) => (
											<SelectItem key={item.value} value={item.value}>
												{t(item.labelKey)}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</Field>
							<Field label={t("usageEvents")}>
								<Select value={data.usageEventRetention} onValueChange={(value) => updateField("usageEventRetention", value as DesktopLogRetention)}>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{logRetentionOptions.map((item) => (
											<SelectItem key={item.value} value={item.value}>
												{t(item.labelKey)}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</Field>
						</SettingsSection>

					</div>
				) : (
					<div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
						{settings.isLoading ? t("settingsLoading") : t("settingsLoadFailed")}
					</div>
				)}
			</div>
		</div>
	);
}

function SettingsSection({
	title,
	children,
	contentClassName = "space-y-3",
}: {
	title: string;
	children: React.ReactNode;
	contentClassName?: string;
}): JSX.Element {
	return (
		<section className="space-y-3">
			<h2 className="px-1 text-base font-semibold leading-snug text-foreground text-balance">{title}</h2>
			<div className={`pie-smooth-corner rounded-[24px] bg-[var(--slate-2)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] ${contentClassName}`}>
				{children}
			</div>
		</section>
	);
}

function GrayHuePicker({
	hue,
	onHuePreview,
	onHueCommit,
	onReset,
}: {
	hue?: number;
	onHuePreview: (hue: number) => void;
	onHueCommit: (hue: number) => void;
	onReset: () => void;
}): JSX.Element {
	const { t } = useI18n();
	const trackRef = useRef<HTMLDivElement | null>(null);
	const labelRef = useRef<HTMLDivElement | null>(null);
	const thumbRef = useRef<HTMLDivElement | null>(null);
	const swatchRef = useRef<HTMLSpanElement | null>(null);
	const activePointerId = useRef<number | undefined>(undefined);
	const previewHue = hue ?? getDefaultPreviewHue();
	const currentHue = useRef(previewHue);
	const isCustom = typeof hue === "number";
	const thumbProgress = previewHue / 359;

	const updateVisualHue = (nextHue: number, custom = true): void => {
		currentHue.current = nextHue;
		const nextProgress = nextHue / 359;
		trackRef.current?.setAttribute("aria-valuenow", String(nextHue));
		if (labelRef.current) {
			labelRef.current.textContent = custom ? t("currentHue", { hue: nextHue }) : t("defaultSlateHue");
		}
		if (thumbRef.current) {
			thumbRef.current.style.left = `calc(${nextProgress * 100}% + ${(0.5 - nextProgress) * 32}px)`;
		}
		if (swatchRef.current) {
			swatchRef.current.style.backgroundColor = getAppearanceStepColor(nextHue, 8);
		}
	};

	useEffect(() => {
		updateVisualHue(previewHue, isCustom);
	}, [previewHue, isCustom]);

	const readHueFromPointer = (clientX: number): number | undefined => {
		const rect = trackRef.current?.getBoundingClientRect();
		if (!rect) {
			return undefined;
		}
		const progress = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
		return Math.round(progress * 359);
	};

	const updateFromPointer = (clientX: number): number | undefined => {
		const nextHue = readHueFromPointer(clientX);
		if (nextHue === undefined) {
			return undefined;
		}
		updateVisualHue(nextHue);
		onHuePreview(nextHue);
		return nextHue;
	};

	const finishDrag = (clientX?: number): void => {
		const nextHue = typeof clientX === "number" ? updateFromPointer(clientX) : currentHue.current;
		activePointerId.current = undefined;
		thumbRef.current?.classList.remove("scale-[0.96]");
		if (trackRef.current) {
			trackRef.current.style.cursor = "grab";
		}
		globalThis.document?.body.style.removeProperty("cursor");
		const committedHue = nextHue ?? currentHue.current;
		requestAnimationFrame(() => {
			setTimeout(() => onHueCommit(committedHue), 0);
		});
	};

	return (
		<div className="space-y-4">
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<div className="text-sm font-medium leading-snug text-foreground text-balance">{t("chooseColor")}</div>
					<div ref={labelRef} className="mt-0.5 text-xs leading-5 text-muted-foreground text-pretty">
						{isCustom ? t("currentHue", { hue: previewHue }) : t("defaultSlateHue")}
					</div>
				</div>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-8 shrink-0 px-3 transition-[background-color,transform] active:scale-[0.96]"
					onClick={onReset}
					disabled={!isCustom}
				>
					{t("reset")}
				</Button>
			</div>
			<div>
				<div
					ref={trackRef}
					role="slider"
					aria-label={t("grayHue")}
					aria-valuemin={0}
					aria-valuemax={359}
					aria-valuenow={previewHue}
					tabIndex={0}
					className="no-drag relative h-9 cursor-grab touch-none select-none rounded-[18px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
					onPointerDown={(event) => {
						activePointerId.current = event.pointerId;
						event.currentTarget.setPointerCapture(event.pointerId);
						thumbRef.current?.classList.add("scale-[0.96]");
						event.currentTarget.style.cursor = "grabbing";
						globalThis.document?.body.style.setProperty("cursor", "grabbing");
						updateFromPointer(event.clientX);
					}}
					onPointerMove={(event) => {
						if (activePointerId.current === event.pointerId) {
							updateFromPointer(event.clientX);
						}
					}}
					onPointerUp={(event) => {
						if (activePointerId.current === event.pointerId) {
							finishDrag(event.clientX);
						}
					}}
					onPointerCancel={() => {
						activePointerId.current = undefined;
						thumbRef.current?.classList.remove("scale-[0.96]");
						if (trackRef.current) {
							trackRef.current.style.cursor = "grab";
						}
						globalThis.document?.body.style.removeProperty("cursor");
					}}
					onLostPointerCapture={() => {
						activePointerId.current = undefined;
						thumbRef.current?.classList.remove("scale-[0.96]");
						if (trackRef.current) {
							trackRef.current.style.cursor = "grab";
						}
						globalThis.document?.body.style.removeProperty("cursor");
					}}
					onKeyDown={(event) => {
							if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
								event.preventDefault();
								const nextHue = Math.max(0, currentHue.current - (event.shiftKey ? 15 : 3));
								updateVisualHue(nextHue);
								onHuePreview(nextHue);
								onHueCommit(nextHue);
							}
							if (event.key === "ArrowRight" || event.key === "ArrowUp") {
								event.preventDefault();
								const nextHue = Math.min(359, currentHue.current + (event.shiftKey ? 15 : 3));
								updateVisualHue(nextHue);
								onHuePreview(nextHue);
								onHueCommit(nextHue);
							}
						}}
				>
					<div className="pie-smooth-corner h-full rounded-[18px] bg-[linear-gradient(90deg,hsl(0_55%_92%),hsl(35_55%_92%),hsl(70_55%_92%),hsl(145_55%_92%),hsl(205_55%_92%),hsl(260_55%_92%),hsl(320_55%_92%),hsl(360_55%_92%))] shadow-[inset_0_1px_2px_rgba(15,23,42,0.09)]" />
					<div
						ref={thumbRef}
						className="pointer-events-none absolute top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full bg-white shadow-[0_6px_18px_rgba(15,23,42,0.18),0_1px_2px_rgba(15,23,42,0.14)] ring-1 ring-black/5 transition-transform duration-100"
						style={{
							left: `calc(${thumbProgress * 100}% + ${(0.5 - thumbProgress) * 36}px)`,
						}}
					>
						<span
							ref={swatchRef}
							className="absolute inset-1.5 rounded-full"
							style={{ backgroundColor: getAppearanceStepColor(previewHue, 8) }}
						/>
					</div>
				</div>
			</div>
		</div>
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
		<label className="flex cursor-pointer items-start gap-3 py-2.5">
			<Checkbox
				checked={checked}
				onCheckedChange={onCheckedChange}
				className="mt-0.5 translate-x-0.5"
			/>
			<span className="min-w-0 flex-1">
				<span className="block text-sm font-medium leading-snug text-foreground text-balance">{title}</span>
				<span className="mt-0.5 block text-xs font-normal leading-5 text-muted-foreground text-pretty">{description}</span>
			</span>
		</label>
	);
}
