import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function ensureParentDir(filePath: string): void {
	mkdirSync(dirname(filePath), { recursive: true });
}

export function atomicWriteFile(filePath: string, content: string): void {
	ensureParentDir(filePath);
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	const fd = openSync(tempPath, "w");
	try {
		writeFileSync(fd, content, "utf8");
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
	renameSync(tempPath, filePath);
}
