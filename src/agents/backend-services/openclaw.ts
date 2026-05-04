import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
	AgentBackendManagedServiceManager,
	AgentBackendManagedServiceManagerOptions,
} from "../backend-service.js";

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isManagedDisabled(value: unknown): boolean {
	if (typeof value === "boolean") {
		return !value;
	}
	if (typeof value !== "string") {
		return false;
	}
	return ["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function parseGatewayPort(gatewayUrl: string | undefined): number {
	const raw = gatewayUrl?.trim() || "ws://127.0.0.1:18789";
	try {
		const url = new URL(raw.startsWith("ws://") || raw.startsWith("wss://") ? raw : `ws://${raw}`);
		const port = Number.parseInt(url.port, 10);
		return Number.isFinite(port) ? port : 18789;
	} catch {
		return 18789;
	}
}

function canConnect(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = net.createConnection({ host: "127.0.0.1", port });
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("error", () => resolve(false));
		socket.setTimeout(500, () => {
			socket.destroy();
			resolve(false);
		});
	});
}

function stripAnsiControlSequences(text: string): string {
	return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

async function waitForPort(port: number, timeoutMs = 90_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastError = "";
	while (Date.now() < deadline) {
		try {
			if (await canConnect(port)) {
				return;
			}
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`OpenClaw gateway did not listen on 127.0.0.1:${port}${lastError ? `: ${lastError}` : ""}`);
}

function pipePrefixedLogs(
	stream: NodeJS.ReadableStream | null,
	target: NodeJS.WritableStream,
	prefix: string,
	onLine?: (line: string) => void,
): void {
	if (!stream) {
		return;
	}
	let buffer = "";
	stream.on("data", (chunk: Buffer | string) => {
		buffer += chunk.toString();
		const lines = buffer.split(/\r?\n/);
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			const cleanLine = stripAnsiControlSequences(line);
			if (cleanLine.trim()) {
				onLine?.(cleanLine);
				target.write(`${prefix}${cleanLine}\n`);
			}
		}
	});
}

function readJsonObject(path: string): Record<string, unknown> {
	if (!existsSync(path)) {
		return {};
	}
	const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
	return isRecord(parsed) ? parsed : {};
}

function writeJsonObject(path: string, value: Record<string, unknown>): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseModelRef(ref: string | undefined): { provider: string; model: string } | undefined {
	const value = ref?.trim();
	if (!value) {
		return undefined;
	}
	const [provider, ...modelParts] = value.split("/");
	const model = modelParts.join("/");
	if (!provider || !model) {
		return undefined;
	}
	return { provider, model };
}

function selectedOpenClawModelRef(options: AgentBackendManagedServiceManagerOptions): string | undefined {
	const configured = asString(options.config?.model) ?? asString(options.config?.modelRef);
	if (configured) {
		return configured;
	}
	const provider = options.model?.provider?.trim();
	const model = options.model?.model?.trim();
	if (!provider || !model) {
		return undefined;
	}
	return model.includes("/") ? model : `${provider}/${model}`;
}

function execOpenClawJson(command: string, args: string[], env: NodeJS.ProcessEnv): Record<string, unknown> | undefined {
	const output = execFileSync(command, args, {
		encoding: "utf8",
		maxBuffer: 20 * 1024 * 1024,
		timeout: 45_000,
		stdio: ["ignore", "pipe", "pipe"],
		env,
	});
	const parsed = JSON.parse(output) as unknown;
	return isRecord(parsed) ? parsed : undefined;
}

function modelDefinitionFromInspect(inspected: Record<string, unknown> | undefined, modelId: string): Record<string, unknown> {
	const input = Array.isArray(inspected?.input)
		? inspected.input.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
		: ["text"];
	return {
		id: modelId,
		name: asString(inspected?.name) ?? modelId,
		reasoning: typeof inspected?.reasoning === "boolean" ? inspected.reasoning : true,
		input: input.length ? input : ["text"],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: typeof inspected?.contextWindow === "number" ? inspected.contextWindow : 262144,
		maxTokens: typeof inspected?.maxTokens === "number" ? inspected.maxTokens : 32768,
	};
}

function upsertProviderModel(
	modelsJsonPath: string,
	providerId: string,
	modelDefinition: Record<string, unknown>,
): boolean {
	const root = readJsonObject(modelsJsonPath);
	const providers = isRecord(root.providers) ? root.providers : {};
	root.providers = providers;
	const existingProvider = isRecord(providers[providerId]) ? providers[providerId] : {};
	const isKimiProvider = providerId === "kimi" || providerId === "kimi-coding";
	if (!isRecord(providers[providerId]) && !isKimiProvider) {
		console.warn(`OpenClaw provider ${providerId} is not present in agent models.json; leaving provider provisioning to OpenClaw.`);
		return false;
	}
	const models = Array.isArray(existingProvider.models)
		? existingProvider.models.filter(isRecord)
		: [];
	const modelId = asString(modelDefinition.id);
	if (!modelId) {
		return false;
	}
	const existingIndex = models.findIndex((entry) => asString(entry.id) === modelId);
	const nextModels = existingIndex >= 0
		? models.map((entry, index) => index === existingIndex ? { ...entry, ...modelDefinition } : entry)
		: [...models, modelDefinition];
	providers[providerId] = {
		...existingProvider,
		...(isKimiProvider ? {
			baseUrl: asString(existingProvider.baseUrl) ?? "https://api.kimi.com/coding/",
			api: asString(existingProvider.api) ?? "anthropic-messages",
			apiKey: existingProvider.apiKey ?? "KIMI_API_KEY",
		} : {}),
		models: nextModels,
	};
	writeJsonObject(modelsJsonPath, root);
	return existingIndex < 0;
}

export function provisionOpenClawModel(options: {
	command: string;
	env: NodeJS.ProcessEnv;
	stateDir: string;
	modelRef: string;
}): void {
	const requested = options.modelRef.trim();
	if (!requested) {
		return;
	}
	try {
		execFileSync(options.command, ["models", "set", requested], {
			encoding: "utf8",
			maxBuffer: 5 * 1024 * 1024,
			timeout: 45_000,
			stdio: ["ignore", "pipe", "pipe"],
			env: options.env,
		});
		const inspected = execOpenClawJson(options.command, ["infer", "model", "inspect", "--model", requested, "--json"], options.env);
		const status = execOpenClawJson(options.command, ["models", "status", "--json"], options.env);
		const canonical =
			parseModelRef(asString(status?.resolvedDefault)) ??
			parseModelRef(asString(status?.defaultModel)) ??
			parseModelRef(requested);
		if (!canonical) {
			return;
		}
		const modelsJsonPath = join(options.stateDir, "agents", "main", "agent", "models.json");
		const added = upsertProviderModel(
			modelsJsonPath,
			canonical.provider,
			modelDefinitionFromInspect(inspected, canonical.model),
		);
		const requestedProvider = parseModelRef(requested)?.provider;
		if (requestedProvider && requestedProvider !== canonical.provider) {
			upsertProviderModel(
				modelsJsonPath,
				requestedProvider,
				modelDefinitionFromInspect(inspected, canonical.model),
			);
		}
		console.log(
			`OpenClaw model ready: ${requested} -> ${canonical.provider}/${canonical.model}${added ? " (provisioned)" : ""}`,
		);
	} catch (error) {
		console.warn(`OpenClaw model provisioning skipped: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export function createOpenClawServiceProcessManager(
	options: AgentBackendManagedServiceManagerOptions,
): AgentBackendManagedServiceManager {
	let child: ChildProcess | undefined;
	const config = options.config ?? {};
	const gatewayUrl = asString(config.gatewayUrl) ?? process.env.OPENCLAW_GATEWAY_URL?.trim() ?? "ws://127.0.0.1:18789";
	const port = parseGatewayPort(gatewayUrl);
	const command = asString(config.command) ?? process.env.OPENCLAW_COMMAND?.trim() ?? "openclaw";
	const managedDisabled = isManagedDisabled(config.managed) || isManagedDisabled(process.env.OPENCLAW_MANAGED);
	const stateDir = process.env.OPENCLAW_STATE_DIR || join(options.homeDir, "openclaw", "state");

	const stop = (): void => {
		if (!child) {
			return;
		}
		child.kill("SIGTERM");
		child = undefined;
	};

	return {
		async start(): Promise<void> {
			if (managedDisabled || !command) {
				return;
			}
			mkdirSync(join(options.homeDir, "runtime"), { recursive: true });
			const env = {
				...process.env,
				PIE_AGENT_HOME: options.homeDir,
				OPENCLAW_STATE_DIR: stateDir,
			};
			const modelRef = selectedOpenClawModelRef(options);
			if (modelRef) {
				provisionOpenClawModel({ command, env, stateDir, modelRef });
			}
			if (await canConnect(port)) {
				console.log(`OpenClaw gateway already reachable at ${gatewayUrl}`);
				return;
			}
			child = spawn(command, ["gateway", "run", "--allow-unconfigured", "--auth", "none", "--port", String(port), "--ws-log", "compact"], {
				cwd: options.environment.workDir,
				env,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let sawGatewayReady = false;
			const waitForGatewayReady = new Promise<void>((resolve) => {
				const markReady = (line: string) => {
					if (sawGatewayReady) {
						return;
					}
					if (
						line.includes("[gateway] ready") ||
						line.includes("[gateway] listening on") ||
						line.includes("[gateway] http server listening")
					) {
						sawGatewayReady = true;
						resolve();
					}
				};
				pipePrefixedLogs(child?.stdout ?? null, process.stdout, "[openclaw] ", markReady);
				pipePrefixedLogs(child?.stderr ?? null, process.stdout, "[openclaw] ", markReady);
				setTimeout(resolve, 30_000);
			});
			child.on("exit", () => {
				child = undefined;
			});
			child.on("error", (error) => {
				console.error(`OpenClaw gateway failed to start: ${error.message}`);
				child = undefined;
			});
			await waitForPort(port);
			await waitForGatewayReady;
			console.log(`OpenClaw gateway ready at ${gatewayUrl}`);
		},
		stop,
	};
}
