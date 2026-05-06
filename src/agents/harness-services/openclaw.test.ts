import assert from "node:assert/strict";
import { createServer } from "node:net";
import { describe, it } from "node:test";
import { WebSocketServer } from "ws";
import { isOpenClawGatewayReachable } from "./openclaw.js";

function listenTcp(server: ReturnType<typeof createServer>): Promise<number> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (typeof address === "object" && address?.port) {
				resolve(address.port);
				return;
			}
			reject(new Error("Missing test server port."));
		});
	});
}

function webSocketPort(server: WebSocketServer): number {
	const address = server.address();
	if (typeof address === "object" && address?.port) {
		return address.port;
	}
	throw new Error("Missing websocket test server port.");
}

async function waitForWebSocketPort(server: WebSocketServer): Promise<number> {
	if (server.address()) {
		return webSocketPort(server);
	}
	await new Promise<void>((resolve) => server.once("listening", resolve));
	return webSocketPort(server);
}

describe("OpenClaw gateway identity probe", () => {
	it("accepts a websocket endpoint that emits the OpenClaw challenge event", async () => {
		const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
		server.on("connection", (socket) => {
			socket.send(JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "test" } }));
		});
		try {
			const port = await waitForWebSocketPort(server);
			assert.equal(await isOpenClawGatewayReachable(`ws://127.0.0.1:${port}`), true);
		} finally {
			server.close();
		}
	});

	it("rejects a plain open local port", async () => {
		const server = createServer((socket) => socket.end("ok"));
		try {
			const port = await listenTcp(server);
			assert.equal(await isOpenClawGatewayReachable(`ws://127.0.0.1:${port}`, 500), false);
		} finally {
			server.close();
		}
	});
});
