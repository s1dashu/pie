import { appendFileSync, writeFileSync } from "node:fs";
import type { ExecTaskSpec } from "./task-types.js";
import { ensureParentDir } from "./file-utils.js";
import { resolveRelativeToHome, type TaskEngineContext } from "./engine-context.js";

export function emitToSink(
	ctx: TaskEngineContext,
	sink: ExecTaskSpec["sink"],
	payload: Record<string, unknown>,
): void {
	const target = resolveRelativeToHome(ctx, sink.path);
	ensureParentDir(target);
	if (sink.type === "append_jsonl") {
		appendFileSync(target, `${JSON.stringify(payload)}\n`, "utf8");
		return;
	}
	writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
