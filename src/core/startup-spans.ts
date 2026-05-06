import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export interface StartupSpanEvent {
	name: string;
	elapsedMs?: number;
	harnessKind?: string;
	phase?: string;
	meta?: Record<string, string | number | boolean | undefined>;
	timestamp?: string;
}

const STARTUP_SPANS_FILE = "startup-spans.jsonl";

export function appendStartupSpan(homeDir: string, event: StartupSpanEvent): void {
	const filePath = join(homeDir, "runtime", STARTUP_SPANS_FILE);
	mkdirSync(dirname(filePath), { recursive: true });
	appendFileSync(
		filePath,
		`${JSON.stringify({
			timestamp: event.timestamp ?? new Date().toISOString(),
			...event,
		})}\n`,
		"utf8",
	);
}
