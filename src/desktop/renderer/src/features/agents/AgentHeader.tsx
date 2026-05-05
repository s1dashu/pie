import { useEffect, useRef, useState } from "react";
import {
	AltArrowDownLineDuotone,
	CheckCircleBoldDuotone,
	FolderOpenBoldDuotone,
	GalleryAddLineDuotone,
	PauseBold,
	PlayBold,
	RestartCircleBoldDuotone,
	TrashBinMinimalisticBoldDuotone,
} from "solar-icon-set";
import type { AgentDetails } from "../../../shared/types";
import { AgentAvatar } from "../../components/shared/agent-avatar";
import { AppIcon } from "../../components/shared/app-icon";
import { AceternityTooltip } from "../../components/shared/tooltip";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "../../components/ui/popover";
import { Spinner } from "../../components/ui/spinner-1";
import { useI18n } from "../../lib/i18n";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "../../components/ui/alert-dialog";

export function AgentHeader({
	agent,
	isSaving,
	onSaveName,
	isUploadingAvatar,
	onUploadAvatar,
	isStarting,
	isPausing,
	onStart,
	onPause,
	showFeishuCredentialInvalidated,
	showWechatReauthorize,
	isReauthorizingWechat,
	showRestartConfigHint,
	onOpenWechatReauthorize,
	onReveal,
	onDelete,
	deleteError,
}: {
	agent: AgentDetails;
	isSaving: boolean;
	onSaveName: (name: string) => void;
	isUploadingAvatar: boolean;
	onUploadAvatar: (upload: { fileName: string; dataUrl: string }) => void;
	isStarting: boolean;
	isPausing: boolean;
	onStart: () => void;
	onPause: () => void;
	showFeishuCredentialInvalidated: boolean;
	showWechatReauthorize: boolean;
	isReauthorizingWechat: boolean;
	showRestartConfigHint: boolean;
	onOpenWechatReauthorize: () => void;
	onReveal: () => void;
	onDelete: () => void;
	deleteError?: string;
}): JSX.Element {
	const { t } = useI18n();
	const [open, setOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [deleteStep, setDeleteStep] = useState<"idle" | "stop" | "files" | "done">("idle");
	const [nameDraft, setNameDraft] = useState(agent.name);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const triggerRef = useRef<HTMLElement | null>(null);
	const contentRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		setNameDraft(agent.name);
	}, [agent.id, agent.name]);

	useEffect(() => {
		return window.pie.onAgentDeleteEvent((event) => {
			if (event.agentId !== agent.id) {
				return;
			}
			setDeleteStep(event.step);
		});
	}, [agent.id]);

	useEffect(() => {
		if (deleteError && deleteStep !== "idle") {
			setDeleteStep("idle");
		}
	}, [deleteError, deleteStep]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const closeOnOutsideInteraction = (event: PointerEvent | MouseEvent | FocusEvent) => {
			const target = event.target as Node | null;
			if (!target) {
				return;
			}
			if (triggerRef.current?.contains(target) || contentRef.current?.contains(target)) {
				return;
			}
			setOpen(false);
		};
		window.addEventListener("pointerdown", closeOnOutsideInteraction, true);
		window.addEventListener("click", closeOnOutsideInteraction, true);
		window.addEventListener("focusin", closeOnOutsideInteraction, true);
		return () => {
			window.removeEventListener("pointerdown", closeOnOutsideInteraction, true);
			window.removeEventListener("click", closeOnOutsideInteraction, true);
			window.removeEventListener("focusin", closeOnOutsideInteraction, true);
		};
	}, [open]);

	const saveName = () => {
		const nextName = nameDraft.trim();
		if (!nextName) {
			setNameDraft(agent.name);
			return;
		}
		if (nextName !== agent.name) {
			onSaveName(nextName);
		}
		setOpen(false);
	};
	const handleAvatarFile = (file: File | undefined) => {
		if (!file) {
			return;
		}
		const reader = new FileReader();
		reader.addEventListener("load", () => {
			if (typeof reader.result === "string") {
				onUploadAvatar({ fileName: file.name, dataUrl: reader.result });
			}
		});
		reader.readAsDataURL(file);
	};
	const showRuntimeUnavailable =
		agent.harnessKind === "hermes" &&
		agent.desiredState === "running" &&
		agent.runtimeEnvironment?.lifecycle.state === "failed" &&
		agent.status !== "running" &&
		agent.status !== "starting";

	return (
		<div className={`${open ? "no-drag" : "drag-region"} shrink-0 bg-white px-7 pb-2 pt-5`}>
			<input
				ref={fileInputRef}
				type="file"
				accept="image/png,image/jpeg,image/webp"
				className="sr-only no-drag"
				onChange={(event) => {
					handleAvatarFile(event.target.files?.[0]);
					event.currentTarget.value = "";
				}}
			/>
			<div className="flex items-center justify-between gap-4">
				<div className="flex min-w-0 items-center gap-2">
					<Popover open={open} onOpenChange={setOpen}>
						<PopoverTrigger
							render={
								<Button
									ref={triggerRef}
									variant="unstyled"
									size="inline"
									className="pie-smooth-corner no-drag flex h-12 min-w-0 max-w-[420px] items-center gap-3 rounded-[24px] px-1.5 pr-3 text-left transition-[background-color,transform] hover:bg-[var(--slate-2)] aria-expanded:bg-[var(--slate-2)]"
									aria-label={t("editAgentInfo")}
								/>
							}
						>
							<AgentAvatar seed={agent.avatarSeed} src={agent.avatarUrl} size={40} />
							<span className="min-w-0 truncate text-xl font-bold text-foreground">{agent.name}</span>
							{isSaving ? (
								<AppIcon IconComponent={RestartCircleBoldDuotone} className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
							) : (
								<AppIcon
									IconComponent={AltArrowDownLineDuotone}
									className="size-4 shrink-0 text-muted-foreground transition-transform duration-100 group-aria-expanded/button:rotate-180"
								/>
							)}
						</PopoverTrigger>
					<PopoverContent ref={contentRef} className="no-drag" align="start" sideOffset={10}>
						<div className="space-y-4">
							<div>
								<PopoverTitle>{t("agentInfo")}</PopoverTitle>
								<PopoverDescription className="mt-1">{t("editAvatarAndName")}</PopoverDescription>
							</div>
								<div className="pie-smooth-corner space-y-5 rounded-[24px] bg-[var(--slate-2)] p-4">
									<div>
										<div className="mb-3.5 text-xs font-medium text-muted-foreground">{t("agentAvatar")}</div>
										<div className="flex justify-center">
											<button
												type="button"
												className="group/avatar-upload relative rounded-full outline-none transition-transform active:scale-[0.96] focus-visible:ring-[3px] focus-visible:ring-ring/50"
												onClick={() => fileInputRef.current?.click()}
												disabled={isUploadingAvatar}
												aria-label={t("changeAvatar")}
											>
												<AgentAvatar seed={agent.avatarSeed} src={agent.avatarUrl} size={72} />
												<span className="pointer-events-none absolute inset-0 grid place-items-center rounded-full bg-black/35 text-white opacity-0 transition-opacity group-hover/avatar-upload:opacity-100 group-focus-visible/avatar-upload:opacity-100">
													<AppIcon IconComponent={isUploadingAvatar ? RestartCircleBoldDuotone : GalleryAddLineDuotone} className={isUploadingAvatar ? "size-6 animate-spin" : "size-6"} />
												</span>
											</button>
										</div>
									</div>
									<label className="block">
										<span className="mb-4 block text-xs font-medium text-muted-foreground">{t("agentName")}</span>
										<Input
											className="bg-white"
											value={nameDraft}
											onChange={(event) => setNameDraft(event.target.value)}
											onKeyDown={(event) => {
												if (event.key === "Enter") {
													saveName();
												}
												if (event.key === "Escape") {
													setNameDraft(agent.name);
												}
											}}
											aria-label={t("agentName")}
										/>
									</label>
								</div>
							<div className="flex justify-end">
								<Button
									size="sm"
									className="rounded-2xl"
									onClick={saveName}
									disabled={isSaving || !nameDraft.trim()}
								>
									{isSaving && <AppIcon IconComponent={RestartCircleBoldDuotone} className="size-4 animate-spin" />}
									{t("saveName")}
								</Button>
							</div>
						</div>
					</PopoverContent>
					</Popover>
					{showFeishuCredentialInvalidated ? (
						<AceternityTooltip content={t("feishuCredentialInvalidated")} side="bottom">
							<span className="no-drag inline-flex h-7 shrink-0 items-center rounded-full bg-[var(--amber-3)] px-2.5 text-[11px] font-medium text-[var(--amber-11)]">
								{t("feishuCredentialInvalidatedShort")}
							</span>
						</AceternityTooltip>
					) : showWechatReauthorize ? (
						<AceternityTooltip content={t("wechatExpired")} side="bottom">
							<Button
								type="button"
								variant="unstyled"
								size="inline"
								className="no-drag inline-flex h-7 shrink-0 items-center rounded-full bg-[var(--amber-3)] px-2.5 text-[11px] font-medium text-[var(--amber-11)] shadow-none transition-[background-color,color,transform] hover:bg-[var(--amber-4)] hover:text-[var(--amber-12)] active:scale-[0.96]"
								onClick={onOpenWechatReauthorize}
								disabled={isReauthorizingWechat}
							>
								<span>{t("reauthorizeWechat")}</span>
							</Button>
						</AceternityTooltip>
					) : showRestartConfigHint ? (
						<span className="no-drag inline-flex h-7 shrink-0 items-center rounded-full bg-[var(--amber-3)] px-2.5 text-[11px] font-medium text-[var(--amber-11)]">
							{t("restartAppliesLatestConfig")}
						</span>
					) : showRuntimeUnavailable ? (
						<span className="no-drag inline-flex h-7 shrink-0 items-center rounded-full bg-[var(--red-3)] px-2.5 text-[11px] font-medium text-[var(--red-11)]">
							{t("runtimeUnavailable")}
						</span>
					) : null}
				</div>
				<div className="no-drag flex items-center gap-2">
					{isStarting || isPausing || agent.status === "starting" ? (
						<AceternityTooltip content={isPausing ? t("pausing") : t("starting")} side="bottom">
							<Button
								variant="unstyled"
								size="inline"
								className="inline-flex h-8 w-8 cursor-default items-center justify-center"
								disabled
								aria-label={isPausing ? "Agent pausing" : "Agent starting"}
							>
								<Spinner size={18} color="var(--slate-11)" />
							</Button>
						</AceternityTooltip>
					) : agent.status === "running" ? (
						<AceternityTooltip content={t("pauseAgent")} side="bottom">
							<Button
								variant="unstyled"
								size="inline"
								className="inline-flex h-8 w-8 items-center justify-center"
								onClick={onPause}
								aria-label="Pause Agent"
							>
								<span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--lime-9)] text-white transition-colors group-hover/button:bg-[var(--lime-10)]">
									<AppIcon IconComponent={PauseBold} className="size-4" />
								</span>
							</Button>
						</AceternityTooltip>
					) : (
						<AceternityTooltip content={t("startAgent")} side="bottom">
							<Button
								variant="unstyled"
								size="inline"
								className="inline-flex h-8 w-8 items-center justify-center"
								onClick={onStart}
								aria-label="Start Agent"
							>
								<span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--slate-12)] text-white transition-colors group-hover/button:bg-[var(--slate-11)]">
									<AppIcon IconComponent={PlayBold} className="size-4" />
								</span>
							</Button>
						</AceternityTooltip>
					)}
					<AceternityTooltip content={t("openAgentProfile")} side="bottom">
						<Button
							variant="unstyled"
							size="inline"
							className="inline-flex h-8 w-8 items-center justify-center text-[var(--slate-10)] transition hover:text-[var(--slate-12)]"
							onClick={onReveal}
							aria-label={t("openAgentProfile")}
						>
							<AppIcon IconComponent={FolderOpenBoldDuotone} className="size-7" />
						</Button>
					</AceternityTooltip>
					<AlertDialog
						open={deleteOpen}
						onOpenChange={(nextOpen) => {
							if (deleteStep !== "idle" && deleteStep !== "done") {
								return;
							}
							setDeleteOpen(nextOpen);
							if (!nextOpen) {
								setDeleteStep("idle");
							}
						}}
					>
						<AlertDialogTrigger
							render={
								<Button
									variant="unstyled"
									size="inline"
									className="inline-flex h-8 w-8 items-center justify-center text-[var(--slate-10)] transition hover:text-[var(--red-11)]"
									aria-label={t("deleteAgent")}
								>
									<AceternityTooltip content={t("deleteAgent")} side="bottom" className="h-full w-full items-center justify-center">
										<AppIcon IconComponent={TrashBinMinimalisticBoldDuotone} className="size-7" />
									</AceternityTooltip>
								</Button>
							}
						/>
						<AlertDialogContent className="sm:max-w-md pie-smooth-corner">
							<AlertDialogHeader>
								<AlertDialogTitle>{t("deleteAgent")}</AlertDialogTitle>
								<AlertDialogDescription>
									{deleteStep === "idle"
										? t("deleteConfirm", { name: agent.name })
										: t("deletingAgent")}
								</AlertDialogDescription>
							</AlertDialogHeader>
							{deleteError && <p className="rounded-2xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{deleteError}</p>}
							{deleteStep !== "idle" && <DeleteProgress step={deleteStep} />}
							{deleteStep === "idle" ? (
								<AlertDialogFooter>
									<AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
									<AlertDialogAction
										onClick={(event) => {
											event.preventDefault();
											setDeleteStep("stop");
											onDelete();
										}}
										className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
									>
										{t("confirmDelete")}
									</AlertDialogAction>
								</AlertDialogFooter>
							) : null}
						</AlertDialogContent>
					</AlertDialog>
				</div>
			</div>
		</div>
	);
}

const deleteSteps = [
	{ id: "stop", labelKey: "stopRunningInstance" },
	{ id: "files", labelKey: "clearAgentFiles" },
	{ id: "done", labelKey: "deleteDone" },
] as const;

function DeleteProgress({ step }: { step: "stop" | "files" | "done" }): JSX.Element {
	const { t } = useI18n();
	const currentIndex = deleteSteps.findIndex((item) => item.id === step);
	return (
		<div className="space-y-2 rounded-2xl bg-[var(--slate-2)] p-3">
			{deleteSteps.map((item, index) => {
				const done = index < currentIndex || step === "done";
				const active = index === currentIndex && step !== "done";
				return (
					<div key={item.id} className="flex min-h-8 items-center gap-3 text-sm">
						<span className="grid h-5 w-5 shrink-0 place-items-center">
							{done ? (
								<AppIcon IconComponent={CheckCircleBoldDuotone} className="size-5 text-[var(--lime-10)]" />
							) : active ? (
								<span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--lime-4)] border-t-[var(--lime-10)]" />
							) : (
								<span className="h-2 w-2 rounded-full bg-border" />
							)}
						</span>
						<span className={active || done ? "text-foreground" : "text-muted-foreground"}>{t(item.labelKey)}</span>
					</div>
				);
			})}
		</div>
	);
}
