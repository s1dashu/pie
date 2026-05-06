import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { buildAgentRoundInputFromMessageParts, extractTextPart, type ChannelMessagePart } from "./channel-model.js";

const PNG_1X1 = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
	"base64",
);

let server: Server | undefined;
const tempDirs: string[] = [];

async function closeServer(): Promise<void> {
	const current = server;
	server = undefined;
	if (!current) {
		return;
	}
	await new Promise<void>((resolve, reject) => {
		current.close((error) => (error ? reject(error) : resolve()));
	});
}

afterEach(async () => {
	await closeServer();
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

describe("channel model", () => {
	it("joins non-empty text parts while ignoring attachments", () => {
		const parts: ChannelMessagePart[] = [
			{ type: "text", text: " first " },
			{ type: "image", filePath: "/tmp/image.png" },
			{ type: "text", text: "\n\n" },
			{ type: "file", name: "report.pdf", filePath: "/tmp/report.pdf" },
			{ type: "text", text: "second" },
		];

		assert.equal(extractTextPart(parts), "first\n\nsecond");
	});

	it("builds multimodal agent input from local images", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pie-channel-model-"));
		tempDirs.push(dir);
		const filePath = join(dir, "pixel.png");
		await writeFile(filePath, PNG_1X1);

		const input = await buildAgentRoundInputFromMessageParts([
			{ type: "text", text: "describe this" },
			{ type: "image", filePath, mimeType: "application/octet-stream" },
		]);

		assert.equal(input.text, "describe this");
		assert.equal(input.images?.length, 1);
		assert.equal(input.images?.[0]?.mimeType, "image/png");
		assert.equal(input.images?.[0]?.data, PNG_1X1.toString("base64"));
	});

	it("uses a stable prompt when the message only contains an image", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pie-channel-image-only-"));
		tempDirs.push(dir);
		const filePath = join(dir, "pixel.png");
		await writeFile(filePath, PNG_1X1);

		const input = await buildAgentRoundInputFromMessageParts([{ type: "image", filePath }]);

		assert.equal(input.text, "Please respond to the attached image.");
		assert.equal(input.images?.length, 1);
	});

	it("fetches http image attachments and skips unsupported image payloads", async () => {
		server = createServer((request, response) => {
			if (request.url === "/pixel.png") {
				response.writeHead(200, { "content-type": "image/png" });
				response.end(PNG_1X1);
				return;
			}
			response.writeHead(200, { "content-type": "text/plain" });
			response.end("not an image");
		});
		await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		assert(address && typeof address === "object");
		const baseUrl = `http://127.0.0.1:${address.port}`;

		const input = await buildAgentRoundInputFromMessageParts([
			{ type: "image", url: `${baseUrl}/pixel.png` },
			{ type: "image", url: `${baseUrl}/notes.txt` },
		]);

		assert.equal(input.images?.length, 1);
		assert.equal(input.images?.[0]?.mimeType, "image/png");
	});
});
