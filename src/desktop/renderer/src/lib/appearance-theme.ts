import type { DesktopColorScheme } from "../../../shared/types.js";

const SLATE_STEPS = 12;
const DEFAULT_PREVIEW_HUE = 230;
type ResolvedColorScheme = "light" | "dark";
type MediaQueryListLike = {
	matches: boolean;
	addEventListener: (type: "change", listener: () => void) => void;
	removeEventListener: (type: "change", listener: () => void) => void;
};

const LIGHT_LIGHTNESS_BY_STEP = [99.4, 98, 95, 91.8, 88.9, 86.4, 80.8, 73.9, 57, 52.7, 40, 12.5];
const LIGHT_SATURATION_BY_STEP = [24, 22, 20, 18, 17, 16, 15, 14, 10, 10, 10, 12];
const LIGHT_ALPHA_BY_STEP = [0.012, 0.024, 0.059, 0.09, 0.122, 0.149, 0.196, 0.275, 0.455, 0.498, 0.624, 0.89];
const DARK_LIGHTNESS_BY_STEP = [7.2, 8.8, 11, 13.6, 16.4, 19, 23.5, 30.2, 39.3, 45, 62.8, 93];
const DARK_SATURATION_BY_STEP = [18, 17, 16, 15, 14, 13, 12, 11, 10, 10, 9, 10];
const DARK_ALPHA_BY_STEP = [0, 0.026, 0.056, 0.081, 0.109, 0.139, 0.191, 0.279, 0.372, 0.445, 0.685, 0.929];

export function getDefaultPreviewHue(): number {
	return DEFAULT_PREVIEW_HUE;
}

export function applyDesktopAppearance(colorScheme: DesktopColorScheme | undefined, hue: number | undefined): void {
	const root = getDocumentElement();
	if (!root) {
		return;
	}
	const resolvedScheme = resolveColorScheme(colorScheme);
	root.classList.toggle("dark", resolvedScheme === "dark");
	root.classList.toggle("light", resolvedScheme === "light");
	root.style.setProperty("color-scheme", resolvedScheme);
	applyAppearanceTheme(hue, resolvedScheme);
}

export function watchSystemColorScheme(
	colorScheme: DesktopColorScheme | undefined,
	onChange: () => void,
): () => void {
	const matchMedia = getMatchMedia();
	if (colorScheme !== "system" || !matchMedia) {
		return () => {};
	}
	const query = matchMedia("(prefers-color-scheme: dark)");
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
}

export function applyAppearanceTheme(hue: number | undefined, colorScheme?: ResolvedColorScheme): void {
	const root = getDocumentElement();
	if (!root) {
		return;
	}
	const resolvedScheme = colorScheme ?? resolveColorScheme();
	if (typeof hue !== "number" || !Number.isFinite(hue)) {
		for (let step = 1; step <= SLATE_STEPS; step += 1) {
			root.style.removeProperty(`--slate-${step}`);
			root.style.removeProperty(`--slate-a${step}`);
		}
		return;
	}
	for (let step = 1; step <= SLATE_STEPS; step += 1) {
		root.style.setProperty(`--slate-${step}`, getAppearanceStepColor(hue, step, resolvedScheme));
		root.style.setProperty(`--slate-a${step}`, getAppearanceAlphaColor(hue, step, resolvedScheme));
	}
}

interface StyleTarget {
	classList: {
		toggle: (name: string, force?: boolean) => boolean;
	};
	style: {
		removeProperty: (name: string) => void;
		setProperty: (name: string, value: string) => void;
	};
}

function getDocumentElement(): StyleTarget | undefined {
	const documentLike = (globalThis as { document?: { documentElement?: Partial<StyleTarget> } }).document;
	const element = documentLike?.documentElement;
	return element?.style && element.classList ? { classList: element.classList, style: element.style } : undefined;
}

export function getAppearanceStepColor(hue: number, step: number, colorScheme: ResolvedColorScheme = "light"): string {
	const index = clampStep(step) - 1;
	const saturations = colorScheme === "dark" ? DARK_SATURATION_BY_STEP : LIGHT_SATURATION_BY_STEP;
	const lightnesses = colorScheme === "dark" ? DARK_LIGHTNESS_BY_STEP : LIGHT_LIGHTNESS_BY_STEP;
	const saturation = saturations[index] ?? saturations[0]!;
	const lightness = lightnesses[index] ?? lightnesses[0]!;
	return `hsl(${normalizeHue(hue)} ${saturation}% ${lightness}%)`;
}

function getAppearanceAlphaColor(hue: number, step: number, colorScheme: ResolvedColorScheme): string {
	const index = clampStep(step) - 1;
	const alphas = colorScheme === "dark" ? DARK_ALPHA_BY_STEP : LIGHT_ALPHA_BY_STEP;
	const alpha = alphas[index] ?? alphas[0]!;
	const lightness = colorScheme === "dark" ? 92 : 18;
	return `hsl(${normalizeHue(hue)} 65% ${lightness}% / ${alpha})`;
}

function clampStep(step: number): number {
	return Math.min(SLATE_STEPS, Math.max(1, Math.round(step)));
}

function normalizeHue(hue: number): number {
	return Math.round(((hue % 360) + 360) % 360);
}

function resolveColorScheme(colorScheme: DesktopColorScheme | undefined = "system"): ResolvedColorScheme {
	if (colorScheme === "light" || colorScheme === "dark") {
		return colorScheme;
	}
	const matchMedia = getMatchMedia();
	if (matchMedia?.("(prefers-color-scheme: dark)").matches) {
		return "dark";
	}
	return "light";
}

function getMatchMedia(): ((query: string) => MediaQueryListLike) | undefined {
	const globalLike = globalThis as { matchMedia?: (query: string) => MediaQueryListLike };
	return typeof globalLike.matchMedia === "function" ? globalLike.matchMedia.bind(globalThis) : undefined;
}
