const SLATE_STEPS = 12;
const DEFAULT_PREVIEW_HUE = 230;
const LIGHTNESS_BY_STEP = [99.4, 98, 95, 91.8, 88.9, 86.4, 80.8, 73.9, 57, 52.7, 40, 12.5];
const SATURATION_BY_STEP = [24, 22, 20, 18, 17, 16, 15, 14, 10, 10, 10, 12];
const ALPHA_BY_STEP = [0.012, 0.024, 0.059, 0.09, 0.122, 0.149, 0.196, 0.275, 0.455, 0.498, 0.624, 0.89];

export function getDefaultPreviewHue(): number {
	return DEFAULT_PREVIEW_HUE;
}

export function applyAppearanceTheme(hue: number | undefined): void {
	const root = getDocumentElement();
	if (!root) {
		return;
	}
	if (typeof hue !== "number" || !Number.isFinite(hue)) {
		for (let step = 1; step <= SLATE_STEPS; step += 1) {
			root.style.removeProperty(`--slate-${step}`);
			root.style.removeProperty(`--slate-a${step}`);
		}
		return;
	}
	for (let step = 1; step <= SLATE_STEPS; step += 1) {
		root.style.setProperty(`--slate-${step}`, getAppearanceStepColor(hue, step));
		root.style.setProperty(`--slate-a${step}`, getAppearanceAlphaColor(hue, step));
	}
}

interface StyleTarget {
	style: {
		removeProperty: (name: string) => void;
		setProperty: (name: string, value: string) => void;
	};
}

function getDocumentElement(): StyleTarget | undefined {
	const documentLike = (globalThis as { document?: { documentElement?: Partial<StyleTarget> } }).document;
	const element = documentLike?.documentElement;
	return element?.style ? { style: element.style } : undefined;
}

export function getAppearanceStepColor(hue: number, step: number): string {
	const index = clampStep(step) - 1;
	const saturation = SATURATION_BY_STEP[index] ?? SATURATION_BY_STEP[0]!;
	const lightness = LIGHTNESS_BY_STEP[index] ?? LIGHTNESS_BY_STEP[0]!;
	return `hsl(${normalizeHue(hue)} ${saturation}% ${lightness}%)`;
}

function getAppearanceAlphaColor(hue: number, step: number): string {
	const index = clampStep(step) - 1;
	const alpha = ALPHA_BY_STEP[index] ?? ALPHA_BY_STEP[0]!;
	return `hsl(${normalizeHue(hue)} 65% 18% / ${alpha})`;
}

function clampStep(step: number): number {
	return Math.min(SLATE_STEPS, Math.max(1, Math.round(step)));
}

function normalizeHue(hue: number): number {
	return Math.round(((hue % 360) + 360) % 360);
}
