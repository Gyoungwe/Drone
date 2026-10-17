#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const adapter = resolve(root, "packages/desktop/pi-packages/node_modules/pi-mcp-adapter/index.ts");
if (!existsSync(adapter)) {
	console.error("[check:remaining-gates] pi-mcp-adapter is not staged; run npm run stage:pi-packages first");
	process.exit(2);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const commands = [
	[
		"unit",
		[
			"run",
			"test",
			"-w",
			"@drone/backend",
			"--",
			"test/mem-gate.test.mjs",
			"test/redline-acceptance.test.mjs",
		],
	],
	["sdk", ["run", "test:sdk", "-w", "@drone/backend", "--", "test/mcp-connector-gates.test.ts"]],
];
for (const [label, args] of commands) {
	console.error(`[check:remaining-gates] ${label}`);
	const result = spawnSync(npm, args, { cwd: root, stdio: "inherit" });
	if (result.error) {
		console.error(`[check:remaining-gates] failed to start npm: ${result.error.message}`);
		process.exit(1);
	}
	if (result.status !== 0) process.exit(result.status ?? 1);
}

// Keep the machine-readable summary small and free of paths, credentials, or session text.
console.log(
	JSON.stringify({
		status: "PASS",
		gates: {
			"MCP-01": "local stdio marker enable/call/disable-reload",
			"CONN-01": "read-only unique-term source receipt close/reopen",
			"MEM-01": "isolated cross-instance marker restore and stale source",
			"REDLINE-01": "publication/metacognitive/orchestration blocking fixtures",
		},
		testFiles: [
			"packages/backend/test/mem-gate.test.mjs",
			"packages/backend/test/mcp-connector-gates.test.ts",
			"packages/backend/test/redline-acceptance.test.mjs",
		],
	}),
);
