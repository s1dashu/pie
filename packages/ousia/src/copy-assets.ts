#!/usr/bin/env node

import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { OUSIA_ASSET_DIRS } from "./assets.js";

export function copyOusiaAssets(outputDir: string): void {
	const targetRoot = resolve(outputDir);
	mkdirSync(targetRoot, { recursive: true });
	for (const asset of OUSIA_ASSET_DIRS) {
		const source = asset.resolve();
		const target = join(targetRoot, asset.name);
		rmSync(target, { recursive: true, force: true });
		cpSync(source, target, { recursive: true });
	}
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const currentPath = resolve(new URL(import.meta.url).pathname);

if (invokedPath === currentPath) {
	copyOusiaAssets(process.argv[2] ?? "dist");
}
