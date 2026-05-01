#!/usr/bin/env node

/**
 * Single CLI entry: `pie` (bot) or `pie --onboard` / `pie onboard` (setup wizard).
 *
 * Keep interactive setup in the CLI layer. The desktop app should reuse the same config-store
 * primitives directly instead of depending on this TUI entry.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function parseCliArgv(argv: string[]): { onboard: boolean; rest: string[] } {
	if (argv[0] === "onboard") {
		return { onboard: true, rest: argv.slice(1) };
	}
	const rest: string[] = [];
	let onboard = false;
	for (const arg of argv) {
		if (arg === "--onboard") {
			onboard = true;
			continue;
		}
		rest.push(arg);
	}
	return { onboard, rest };
}

/** Resolve `./x.js` -> `x.ts` beside this file if it exists, else `x.js` (published `dist`). */
function resolveBesideCli(specifierEndingInJs: string): string {
	const cliDir = dirname(fileURLToPath(import.meta.url));
	const rel = specifierEndingInJs.replace(/^\.\//, "").replace(/\.js$/i, "");
	const tsPath = join(cliDir, `${rel}.ts`);
	const jsPath = join(cliDir, `${rel}.js`);
	if (existsSync(tsPath)) {
		return pathToFileURL(tsPath).href;
	}
	if (existsSync(jsPath)) {
		return pathToFileURL(jsPath).href;
	}
	throw new Error(`Cannot resolve ${specifierEndingInJs} under ${cliDir} (missing .ts and .js)`);
}

async function run(): Promise<void> {
	const raw = process.argv.slice(2);
	const { onboard, rest } = parseCliArgv(raw);
	if (onboard) {
		const { runOnboard } = await import(resolveBesideCli("./onboard.js"));
		await runOnboard(rest);
		return;
	}
	process.argv = [process.argv[0]!, process.argv[1]!, ...rest];
	const { runPie } = await import(resolveBesideCli("../runtime/main.js"));
	const exitCode = await runPie();
	process.exit(exitCode);
}

run().catch((err) => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
