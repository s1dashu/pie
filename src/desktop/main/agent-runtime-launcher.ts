import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

export interface AgentRuntimeLaunchCommandOptions {
	appRoot: string;
	nodeExecPath: string;
}

export function getAgentRuntimeLaunchCommand(options: AgentRuntimeLaunchCommandOptions): { execPath: string; argv: string[] } {
	const runtimeSrc = join(options.appRoot, "src/runtime/main.ts");
	const runtimeDist = join(options.appRoot, "dist/runtime/main.js");
	const tsxCli = join(options.appRoot, "node_modules/tsx/dist/cli.mjs");
	if (existsSync(tsxCli) && existsSync(runtimeSrc)) {
		return { execPath: options.nodeExecPath, argv: [tsxCli, runtimeSrc] };
	}
	if (existsSync(runtimeDist)) {
		return { execPath: options.nodeExecPath, argv: [runtimeDist] };
	}
	throw new Error("找不到 bot runtime 入口；请先运行 npm install 或 npm run build。");
}

async function getAvailableLocalPort(): Promise<number> {
	return new Promise((resolvePort, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			server.close(() => {
				if (typeof address === "object" && address?.port) {
					resolvePort(address.port);
					return;
				}
				reject(new Error("Unable to allocate a local port."));
			});
		});
	});
}

export async function getDistinctAvailableLocalPorts(count: number): Promise<number[]> {
	const ports: number[] = [];
	while (ports.length < count) {
		const port = await getAvailableLocalPort();
		if (!ports.includes(port)) {
			ports.push(port);
		}
	}
	return ports;
}
