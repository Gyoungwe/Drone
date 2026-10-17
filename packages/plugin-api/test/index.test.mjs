import assert from "node:assert/strict";
import test from "node:test";
import { compareHostVersions, negotiateCapabilities } from "../dist/index.js";

const host = {
	host: "drone-desktop",
	hostVersion: "0.33.0",
	pluginApiVersion: 1,
	piApiVersion: 1,
	capabilities: ["readSource", "searchKnowledge"],
};

test("accepts a plugin when host and declared capabilities match", () => {
	assert.deepEqual(
		negotiateCapabilities(
			{ pluginApi: 1, minHostVersion: "0.31.0", hosts: ["drone-desktop"], capabilities: ["readSource"] },
			host,
		),
		{ status: "compatible", host: "drone-desktop", pluginApi: 1, missingCapabilities: [] },
	);
});

test("refuses an incompatible host without partial loading", () => {
	const result = negotiateCapabilities(
		{ pluginApi: 1, hosts: ["native-pi"], capabilities: ["runCompute"] },
		host,
	);
	assert.equal(result.status, "incompatible");
	assert.equal(result.reason, "host");
});

test("refuses an older host and reports missing capabilities", () => {
	const oldHost = { ...host, hostVersion: "0.30.0" };
	assert.equal(
		negotiateCapabilities({ pluginApi: 1, minHostVersion: "0.31.0" }, oldHost).reason,
		"host-version",
	);
	const missing = negotiateCapabilities({ pluginApi: 1, capabilities: ["runCompute"] }, host);
	assert.equal(missing.reason, "capability");
	assert.deepEqual(missing.missingCapabilities, ["runCompute"]);
});

test("compares host versions by numeric major/minor/patch components", () => {
	assert.equal(compareHostVersions("v1.1.0", "1.1.0-beta.1"), 0);
	assert.equal(compareHostVersions("1.2.0", "1.1.9"), 1);
	assert.equal(compareHostVersions("1.0.9", "1.1.0"), -1);
});
