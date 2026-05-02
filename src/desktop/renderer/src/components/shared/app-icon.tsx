import type { SolarIconProps } from "solar-icon-set";

export function AppIcon({
	IconComponent,
	className,
	color = "currentColor",
}: {
	IconComponent: (props: SolarIconProps) => JSX.Element;
	className?: string;
	color?: string;
}): JSX.Element {
	return <IconComponent className={className} color={color} />;
}
