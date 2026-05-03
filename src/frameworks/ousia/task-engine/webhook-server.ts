import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { appendEngineEvent, type TaskEngineContext } from "./engine-context.js";
import { emitToSink } from "./task-sink.js";
import type { LoadedExecTask } from "./runtime-types.js";

function readRequestBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		let body = "";
		req.setEncoding("utf8");
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => resolvePromise(body));
		req.on("error", reject);
	});
}

function sendJson(res: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
	res.statusCode = statusCode;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.end(`${JSON.stringify(payload)}\n`);
}

function normalizeWebhookPath(pathValue: string | undefined, execTaskId: string): string {
	if (!pathValue || pathValue.trim() === "") {
		return `/tasks/${execTaskId}`;
	}
	return pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
}

function matchWebhook(execTasks: Iterable<LoadedExecTask>, reqPath: string): LoadedExecTask | undefined {
	for (const execTask of execTasks) {
		if (execTask.spec.trigger.type !== "webhook") {
			continue;
		}
		const expected = normalizeWebhookPath(execTask.spec.trigger.path, execTask.spec.id);
		if (reqPath === expected) {
			return execTask;
		}
	}
	return undefined;
}

async function handleWebhook(
	ctx: TaskEngineContext,
	execTasks: Iterable<LoadedExecTask>,
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const url = new URL(req.url ?? "/", "http://127.0.0.1");
	const execTask = matchWebhook(execTasks, url.pathname);
	if (!execTask) {
		sendJson(res, 404, { ok: false, error: "execTask not found" });
		return;
	}
	if (execTask.spec.trigger.type !== "webhook") {
		sendJson(res, 400, { ok: false, error: "execTask trigger mismatch" });
		return;
	}
	const secret = execTask.spec.trigger.secret;
	if (secret) {
		const provided = req.headers["x-pi-feishu-secret"] ?? req.headers["x-pie-secret"] ?? req.headers["x-momo-secret"];
		if (provided !== secret) {
			sendJson(res, 401, { ok: false, error: "invalid secret" });
			return;
		}
	}

	const rawBody = await readRequestBody(req);
	let parsedBody: unknown = rawBody;
	if (rawBody.trim()) {
		try {
			parsedBody = JSON.parse(rawBody);
		} catch {
			parsedBody = rawBody;
		}
	}

	const payload = {
		timestamp: new Date().toISOString(),
		execTaskId: execTask.spec.id,
		triggerType: "webhook",
		method: req.method ?? "POST",
		path: url.pathname,
		headers: req.headers,
		body: parsedBody,
	};
	emitToSink(ctx, execTask.spec.sink, payload);
	appendEngineEvent(ctx, { type: "execTask_webhook_received", execTaskId: execTask.spec.id, path: url.pathname });
	sendJson(res, 200, { ok: true, execTaskId: execTask.spec.id, sink: execTask.spec.sink.path });
}

export function createWebhookServer(ctx: TaskEngineContext, execTasks: Map<string, LoadedExecTask>): Server {
	return createServer(async (req, res) => {
		try {
			if ((req.method ?? "GET").toUpperCase() !== "POST") {
				sendJson(res, 405, { ok: false, error: "only POST supported" });
				return;
			}
			await handleWebhook(ctx, execTasks.values(), req, res);
		} catch (error) {
			appendEngineEvent(ctx, {
				type: "execTask_webhook_error",
				error: error instanceof Error ? error.message : String(error),
			});
			sendJson(res, 500, { ok: false, error: "internal error" });
		}
	});
}
