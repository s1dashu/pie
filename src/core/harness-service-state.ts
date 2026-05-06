import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RuntimeEnvironmentLifecycleSnapshot, RuntimeEnvironmentLifecycleState } from "../runtime/environment.js";

export interface HarnessServiceStateRecord {
	version: 1;
	kind: string;
	group: string;
	homeDir: string;
	endpoint?: string;
	lifecycle: RuntimeEnvironmentLifecycleSnapshot;
	updatedAt: string;
}

export function getHarnessServiceStatePath(rootDir: string, kind: string, group = "default"): string {
	return join(rootDir, "runtime", "harness-services", `${kind}-${group}.json`);
}

export function readHarnessServiceState(rootDir: string, kind: string, group = "default"): HarnessServiceStateRecord | undefined {
	const path = getHarnessServiceStatePath(rootDir, kind, group);
	if (!existsSync(path)) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<HarnessServiceStateRecord>;
		if (!parsed.lifecycle || typeof parsed.lifecycle.state !== "string") {
			return undefined;
		}
		return {
			version: 1,
			kind: typeof parsed.kind === "string" ? parsed.kind : kind,
			group: typeof parsed.group === "string" ? parsed.group : group,
			homeDir: typeof parsed.homeDir === "string" ? parsed.homeDir : rootDir,
			endpoint: typeof parsed.endpoint === "string" ? parsed.endpoint : undefined,
			lifecycle: {
				state: parsed.lifecycle.state,
				updatedAt: typeof parsed.lifecycle.updatedAt === "string" ? parsed.lifecycle.updatedAt : new Date(0).toISOString(),
				reason: typeof parsed.lifecycle.reason === "string" ? parsed.lifecycle.reason : undefined,
			} as RuntimeEnvironmentLifecycleSnapshot,
			updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
		};
	} catch {
		return undefined;
	}
}

export function writeHarnessServiceState(
	rootDir: string,
	record: {
		kind: string;
		group?: string;
		homeDir: string;
		endpoint?: string;
		state: RuntimeEnvironmentLifecycleState;
		reason?: string;
	},
): void {
	const group = record.group ?? "default";
	const path = getHarnessServiceStatePath(rootDir, record.kind, group);
	const now = new Date().toISOString();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(
		path,
		`${JSON.stringify({
			version: 1,
			kind: record.kind,
			group,
			homeDir: record.homeDir,
			...(record.endpoint ? { endpoint: record.endpoint } : {}),
			lifecycle: {
				state: record.state,
				updatedAt: now,
				...(record.reason ? { reason: record.reason } : {}),
			},
			updatedAt: now,
		}, null, 2)}\n`,
		"utf8",
	);
}
