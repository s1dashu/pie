import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentFrameworkRuntime } from "../../core/backend-framework.js";
import { ensureOusiaAgentHomeLayout } from "./agent-home-layout.js";
import { createRuntimeTurnGatewayServer } from "./runtime/runtime-turn-gateway.js";
import { createTaskEngineProcessManager } from "./runtime/task-engine-process.js";

const OUSIA_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), ".");

function firstExistingPath(paths: string[]): string {
	return paths.find((path) => existsSync(path)) ?? paths[0]!;
}

export const OUSIA_SYSTEM_PROMPT_FILE = firstExistingPath([
	join(OUSIA_ROOT, "prompts", "system-prompt.md"),
	join(process.cwd(), "src", "frameworks", "ousia", "prompts", "system-prompt.md"),
]);

export const OUSIA_FRAMEWORK: AgentFrameworkRuntime = {
	kind: "ousia",
	label: "Ousia",
	systemPrompt: {
		label: "Ousia system prompt",
		defaultPath: OUSIA_SYSTEM_PROMPT_FILE,
	},
	ensureAgentHomeLayout: ensureOusiaAgentHomeLayout,
	createTaskEngineProcessManager,
	createTurnGatewayServer: createRuntimeTurnGatewayServer,
};
