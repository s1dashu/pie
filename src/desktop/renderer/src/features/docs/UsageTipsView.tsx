import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AceternityTooltip } from "../../components/shared/tooltip";
import { Button } from "../../components/ui/button";
import { useI18n } from "../../lib/i18n";

type TipsSection = {
	title: string;
	items: Array<{ title: string; body: string }>;
};

const tipsByLanguage: Record<"zh" | "en", TipsSection[]> = {
	zh: [
		{
			title: "日常对话",
			items: [
				{ title: "直接发送消息", body: "在已连接的 IM 里发消息，就是给当前 Agent 下指令。Pie 会把回复和工具状态同步回对应会话。" },
				{ title: "开启新会话", body: "发送 /new 可以从空上下文开始，适合换一个新任务时使用。" },
				{ title: "压缩长对话", body: "长时间工作后发送 /compact，可以把当前会话整理成更短的上下文再继续。" },
			],
		},
		{
			title: "Agent 运行",
			items: [
				{ title: "一个 Agent 对应一个 Profile", body: "每个 Agent 有自己的配置、工作目录和运行状态；切换 Agent 不会混用彼此的会话。" },
				{ title: "OpenClaw 和 Hermes Profile", body: "OpenClaw 和 Hermes 会复用各自 runtime 的多 Profile 能力，Pie 负责把这些 Profile 映射成桌面端的 Agent。" },
				{ title: "启动和暂停", body: "桌面端会显示 Agent 当前状态。需要停用时可以暂停，需要继续时再启动。创建新的 OpenClaw Agent 时，OpenClaw Gateway 会整体重启。" },
			],
		},
		{
			title: "退出和清理",
			items: [
				{ title: "默认退出会停止 Agent", body: "全局设置里的“退出 Pie 时终止全部 Agent”默认开启，退出时会停止仍在运行的 Agent。" },
				{ title: "也支持退出时不停止 Agent", body: "如果关闭这个设置，退出桌面端后 Agent 进程会保留，适合需要它继续在线的场景。" },
			],
		},
	],
	en: [
		{
			title: "Daily conversations",
			items: [
				{ title: "Send a message", body: "A normal IM message is an instruction to the current Agent. Pie syncs replies and tool status back to that conversation." },
				{ title: "Start fresh", body: "Send /new to start from empty context when you are switching to a new task." },
				{ title: "Compact long work", body: "After a long session, send /compact to summarize the current conversation into shorter context before continuing." },
			],
		},
		{
			title: "Agent runtime",
			items: [
				{ title: "One Agent, one Profile", body: "Each Agent has its own configuration, work directory, and runtime state. Switching Agents does not mix their conversations." },
				{ title: "OpenClaw and Hermes Profiles", body: "OpenClaw and Hermes reuse their own runtime-level multi-Profile support. Pie maps those Profiles into desktop Agents." },
				{ title: "Start and pause", body: "The desktop shows each Agent's current state. Pause it when you do not need it, then start it again when work should continue. Creating a new OpenClaw Agent restarts the whole OpenClaw Gateway." },
			],
		},
		{
			title: "Quit and cleanup",
			items: [
				{ title: "Quit stops Agents by default", body: "The global “Stop all Agents when quitting Pie” setting is enabled by default, so Pie tries to stop running Agents on quit." },
				{ title: "You can keep Agents running on quit", body: "Disable that setting if you want Agent processes to keep running after the desktop app quits." },
			],
		},
	],
};

export function UsageTipsView({ onClose }: { onClose: () => void }): JSX.Element {
	const { language, t } = useI18n();
	const sections = tipsByLanguage[language] ?? tipsByLanguage.zh;
	return (
		<div className="flex h-full flex-col overflow-hidden bg-white">
			<div className="drag-region flex h-[72px] shrink-0 items-center justify-between gap-4 px-7 pt-3">
				<div className="min-w-0">
					<h1 className="text-xl font-semibold tracking-normal text-balance">{t("pieDocs")}</h1>
					<p className="mt-1 text-sm text-muted-foreground text-pretty">{t("pieDocsSubtitle")}</p>
				</div>
				<AceternityTooltip content={t("closeDocs")} side="bottom">
					<Button
						variant="unstyled"
						size="inline"
						className="no-drag inline-flex h-8 w-8 shrink-0 items-center justify-center text-[var(--slate-10)] transition-[color,transform] duration-200 hover:text-[var(--slate-12)] active:scale-[0.96]"
						onClick={onClose}
						aria-label={t("closeDocs")}
					>
						<HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-5" />
					</Button>
				</AceternityTooltip>
			</div>
			<div className="flex-1 overflow-y-auto px-7 pb-8 pt-2">
				<div className="mx-auto flex max-w-3xl flex-col gap-5">
					{sections.map((section) => (
						<section key={section.title} className="pie-smooth-corner space-y-4 rounded-[28px] bg-[var(--slate-2)] px-5 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
							<h2 className="text-base font-semibold leading-snug text-foreground text-balance">{section.title}</h2>
							<ol className="space-y-3 [counter-reset:doc-step]">
								{section.items.map((item) => (
									<li key={item.title} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 [counter-increment:doc-step]">
										<div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--slate-4)] text-xs font-semibold tabular-nums text-[var(--slate-11)] before:content-[counter(doc-step)]" />
										<div className="min-w-0">
											<div className="text-sm font-medium leading-5 text-foreground text-pretty">{item.title}</div>
											<div className="mt-1 text-sm leading-6 text-muted-foreground text-pretty">{item.body}</div>
										</div>
									</li>
								))}
							</ol>
						</section>
					))}
				</div>
			</div>
		</div>
	);
}
