import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
} from "../../components/ui/select";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";

const PRIMARY_PROVIDER_IDS = [
	"openai",
	"anthropic",
	"google",
	"kimi-coding",
	"zai",
	"deepseek",
];

const PROVIDER_LABELS: Record<string, string> = {
	openai: "OpenAI",
	anthropic: "Anthropic",
	google: "Google",
	"kimi-coding": "Kimi Coding",
	zai: "ZAI",
	deepseek: "DeepSeek",
};

export function ProviderSelect({
	value,
	providers,
	placeholder,
	triggerClassName,
	onValueChange,
}: {
	value: string;
	providers: string[];
	placeholder?: string;
	triggerClassName?: string;
	onValueChange: (provider: string) => void;
}): JSX.Element {
	const { t } = useI18n();
	const [showMoreProviders, setShowMoreProviders] = useState(false);
	const providerGroups = useMemo(() => groupProviderOptions(providers, value), [providers, value]);

	return (
		<Select value={value} onValueChange={onValueChange}>
			<SelectTrigger className={triggerClassName}>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent align="start" alignItemWithTrigger={false}>
				<SelectGroup>
					{providerGroups.primary.map((provider) => (
						<SelectItem key={provider} value={provider} label={formatProviderLabel(provider)}>
							{formatProviderLabel(provider)}
						</SelectItem>
					))}
				</SelectGroup>
				{providerGroups.secondary.length ? (
					<>
						<SelectSeparator />
						{showMoreProviders ? (
							<SelectGroup>
								<div className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs text-muted-foreground">
									<span>{t("moreProviders")}</span>
									<ProviderListToggle
										className="-my-1 -mr-1 rounded-lg px-2 py-1 text-xs"
										fullWidth={false}
										onClick={() => setShowMoreProviders(false)}
									>
										{t("collapse")}
									</ProviderListToggle>
								</div>
								{providerGroups.secondary.map((provider) => (
									<SelectItem key={provider} value={provider} label={formatProviderLabel(provider)}>
										{formatProviderLabel(provider)}
									</SelectItem>
								))}
							</SelectGroup>
						) : (
							<ProviderListToggle onClick={() => setShowMoreProviders(true)}>
								{t("moreProviders")}
							</ProviderListToggle>
						)}
					</>
				) : null}
			</SelectContent>
		</Select>
	);
}

function groupProviderOptions(providers: string[], value: string): { primary: string[]; secondary: string[] } {
	const uniqueProviders = [...new Set(providers.filter(Boolean))];
	const primary = PRIMARY_PROVIDER_IDS.filter((provider) => uniqueProviders.includes(provider));
	if (value && !primary.includes(value) && uniqueProviders.includes(value)) {
		primary.push(value);
	}
	const secondary = uniqueProviders
		.filter((provider) => !primary.includes(provider))
		.sort((left, right) => formatProviderLabel(left).localeCompare(formatProviderLabel(right)));
	return { primary, secondary };
}

function formatProviderLabel(provider: string): string {
	return PROVIDER_LABELS[provider] ?? provider;
}

function ProviderListToggle({
	children,
	className,
	fullWidth = true,
	onClick,
}: {
	children: ReactNode;
	className?: string;
	fullWidth?: boolean;
	onClick: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			className={cn(
				"pie-smooth-corner relative flex cursor-default items-center gap-2.5 rounded-[var(--control-item-radius)] py-2 text-left text-sm outline-hidden select-none",
				fullWidth ? "w-full pr-8 pl-3" : "w-auto",
				"text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground",
				className
			)}
			onMouseDown={(event) => event.preventDefault()}
			onClick={onClick}
		>
			<span className="flex-1 min-w-0 truncate">{children}</span>
		</button>
	);
}
