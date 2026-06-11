import { useI18n } from "../../lib/i18n";

const DINGTALK_OPEN_PLATFORM_URL = "https://open-dev.dingtalk.com/";

export function DingTalkSetupGuide(): JSX.Element {
	const { t } = useI18n();
	const steps = [
		t("dingtalkGuideCreateApp"),
		t("dingtalkGuideEnableBot"),
		t("dingtalkGuideEnableStream"),
		t("dingtalkGuideCopyCredentials"),
	];
	return (
		<div className="space-y-2 text-xs leading-5 text-muted-foreground">
			<div className="flex items-center justify-between gap-3">
				<div className="font-medium text-foreground">{t("dingtalkSetupGuide")}</div>
				<a
					className="shrink-0 text-[11px] font-medium text-[var(--lime-11)] transition-colors hover:text-[var(--lime-12)]"
					href={DINGTALK_OPEN_PLATFORM_URL}
					target="_blank"
					rel="noreferrer"
				>
					{t("openDingTalkPlatform")}
				</a>
			</div>
			<ol className="list-decimal space-y-1 pl-4">
				{steps.map((step) => (
					<li key={step}>{step}</li>
				))}
			</ol>
		</div>
	);
}
