/**
 * Adapted from larksuite/openclaw-lark.
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cachedVersion: string | undefined;

function readVersionFromDir(startDir: string): string | undefined {
	let dir = startDir;
	for (let i = 0; i < 12; i++) {
		const candidate = join(dir, "package.json");
		if (existsSync(candidate)) {
			try {
				const raw = readFileSync(candidate, "utf8");
				const pkg = JSON.parse(raw) as { name?: string; version?: string };
				if (typeof pkg.version === "string" && pkg.version.length) {
					return pkg.version;
				}
			} catch {
				// keep walking
			}
		}
		const parent = dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}
	return undefined;
}

export function getPackageVersion(): string {
	if (cachedVersion) {
		return cachedVersion;
	}

	try {
		const dirName = dirname(fileURLToPath(import.meta.url));
		cachedVersion = readVersionFromDir(dirName) ?? "unknown";
		return cachedVersion;
	} catch {
		cachedVersion = "unknown";
		return cachedVersion;
	}
}

export function getUserAgent(): string {
	return `pie-feishu/${getPackageVersion()}`;
}
