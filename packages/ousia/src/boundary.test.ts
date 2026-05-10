import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

const OUSIA_DIR = new URL(".", import.meta.url).pathname;
const FORBIDDEN_IMPORT_PATTERNS = [
	/["'](?:\.\.\/){2,}runtime\//,
	/["'](?:\.\.\/){2,}desktop\//,
	/["'](?:\.\.\/){2,}channels\//,
	/["'](?:\.\.\/){2,}src\/runtime\//,
	/["'](?:\.\.\/){2,}src\/desktop\//,
	/["'](?:\.\.\/){2,}src\/channels\//,
	/["'](?:\.\.\/){2,}src\/agents\//,
	/["'](?:\.\.\/){2,}core\/config-store\.js["']/,
	/["'](?:\.\.\/){2,}core\/profile-registry\.js["']/,
	/["'](?:\.\.\/){2,}core\/agent-home\.js["']/,
	/["'](?:\.\.\/){2,}src\/core\/config-store\.js["']/,
	/["'](?:\.\.\/){2,}src\/core\/profile-registry\.js["']/,
	/["'](?:\.\.\/){2,}src\/core\/agent-home\.js["']/,
	/["'](?:\.\.\/){2,}agents\//,
];

function listTypeScriptFiles(dir: string): string[] {
	return readdirSync(dir)
		.flatMap((name) => {
			const filePath = join(dir, name);
			const stat = statSync(filePath);
			if (stat.isDirectory()) {
				return listTypeScriptFiles(filePath);
			}
			return filePath.endsWith(".ts") ? [filePath] : [];
		});
}

describe("Ousia framework boundary", () => {
	it("does not import Pie product/runtime modules", () => {
		const violations: string[] = [];
		for (const filePath of listTypeScriptFiles(OUSIA_DIR)) {
			if (filePath.endsWith("boundary.test.ts")) {
				continue;
			}
			const source = readFileSync(filePath, "utf8");
			for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
				if (pattern.test(source)) {
					violations.push(relative(OUSIA_DIR, filePath));
					break;
				}
			}
		}
		assert.deepEqual(violations, []);
	});
});
