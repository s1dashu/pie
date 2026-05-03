import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function normalizeWechatAccountId(value: string): string {
	return value.trim().replace(/[^a-zA-Z0-9._-]/g, "-");
}

function stateDir(homeDir: string): string {
	return join(homeDir, "runtime", "wechat");
}

export function getSyncBufPath(homeDir: string, accountId: string): string {
	return join(stateDir(homeDir), `${normalizeWechatAccountId(accountId)}.sync`);
}

export function loadSyncBuf(homeDir: string, accountId: string): string {
	const path = getSyncBufPath(homeDir, accountId);
	if (!existsSync(path)) {
		return "";
	}
	return readFileSync(path, "utf8");
}

export function saveSyncBuf(homeDir: string, accountId: string, value: string): void {
	const path = getSyncBufPath(homeDir, accountId);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, value, "utf8");
}

export function getContextTokenPath(homeDir: string, accountId: string): string {
	return join(stateDir(homeDir), `${normalizeWechatAccountId(accountId)}.context-tokens.json`);
}

export class ContextTokenStore {
	private readonly tokens = new Map<string, string>();

	constructor(
		private readonly homeDir: string,
		private readonly accountId: string,
	) {
		this.restore();
	}

	get(userId: string): string | undefined {
		return this.tokens.get(userId);
	}

	set(userId: string, token: string): void {
		this.tokens.set(userId, token);
		this.persist();
	}

	private restore(): void {
		const path = getContextTokenPath(this.homeDir, this.accountId);
		if (!existsSync(path)) {
			return;
		}
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (!parsed || typeof parsed !== "object") {
			return;
		}
		for (const [key, value] of Object.entries(parsed)) {
			if (typeof value === "string" && value) {
				this.tokens.set(key, value);
			}
		}
	}

	private persist(): void {
		const path = getContextTokenPath(this.homeDir, this.accountId);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify(Object.fromEntries(this.tokens), null, 2), "utf8");
	}
}

