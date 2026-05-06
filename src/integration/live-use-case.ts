export const DEFAULT_LIVE_USE_CASE_PROMPT =
	"请用中文用两句话讲一个关于唐代安史之乱的历史知识。必须包含这句话：安史之乱改变了唐朝的财政与边防格局。";

export const DEFAULT_LIVE_USE_CASE_EXPECTED_REGEX = "安史之乱改变了唐朝的财政与边防格局";

export function env(name: string): string | undefined {
	return process.env[name]?.trim() || undefined;
}

export function renderLiveUseCasePrompt(input: {
	index: number;
	token: string;
	templateEnvName: string;
	defaultPrompt?: string;
}): string {
	const template = env(input.templateEnvName);
	const base = template || input.defaultPrompt || DEFAULT_LIVE_USE_CASE_PROMPT;
	return base
		.replaceAll("{index}", String(input.index))
		.replaceAll("{token}", input.token);
}

export function liveUseCaseExpectedPattern(input: {
	token: string;
	regexEnvName: string;
	defaultRegex?: string;
}): RegExp {
	return new RegExp(env(input.regexEnvName) || input.defaultRegex || DEFAULT_LIVE_USE_CASE_EXPECTED_REGEX);
}
