import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { test } from "node:test";

function run(platform, env) {
	return new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			["scripts/check-release-signing.mjs", "--preflight", "--platform", platform],
			{ env: { ...process.env, ...env }, stdio: "pipe" },
		);
		let output = "";
		child.stdout.on("data", (chunk) => (output += chunk));
		child.stderr.on("data", (chunk) => (output += chunk));
		child.once("error", reject);
		child.once("close", (status) => resolve({ status, output }));
	});
}

test("signed macOS preflight fails closed without certificate and notarization inputs", async () => {
	const result = await run("mac", {
		CSC_LINK: "",
		CSC_KEY_PASSWORD: "",
		APPLE_ID: "",
		APPLE_APP_SPECIFIC_PASSWORD: "",
		APPLE_TEAM_ID: "",
	});
	assert.notEqual(result.status, 0);
	assert.match(result.output, /CSC_LINK/);
});

test("signed macOS preflight accepts explicit certificate and notarization inputs", async () => {
	const result = await run("mac", {
		CSC_LINK: "data:application/octet-stream;base64,ZmFrZQ==",
		CSC_KEY_PASSWORD: "test-password",
		APPLE_ID: "release@example.invalid",
		APPLE_APP_SPECIFIC_PASSWORD: "test-password",
		APPLE_TEAM_ID: "TEAM123456",
	});
	assert.equal(result.status, 0, result.output);
});

test("signed Windows preflight requires a certificate and password", async () => {
	const result = await run("windows", { WIN_CSC_LINK: "", WIN_CSC_KEY_PASSWORD: "" });
	assert.notEqual(result.status, 0);
	assert.match(result.output, /WIN_CSC_LINK/);
});
