import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { join } from "node:path";
import { resolveHermesHome } from "./hermes.js";

describe("Hermes managed service", () => {
	it("defaults Hermes home to the Pie profile Hermes directory", () => {
		const previous = process.env.HERMES_HOME;
		process.env.HERMES_HOME = "/tmp/global-hermes-home";
		try {
			assert.equal(
				resolveHermesHome({}, "/tmp/pie-profile"),
				join("/tmp/pie-profile", "hermes"),
			);
		} finally {
			if (previous === undefined) {
				delete process.env.HERMES_HOME;
			} else {
				process.env.HERMES_HOME = previous;
			}
		}
	});

	it("allows explicit Hermes home overrides", () => {
		assert.equal(resolveHermesHome({ hermesHome: "/tmp/hermes-home" }, "/tmp/pie-profile"), "/tmp/hermes-home");
	});
});
