#!/usr/bin/env node
import { spawnSync } from "node:child_process";
/**
 * Run the two real host acceptance gates with isolated, offline fixtures.
 * The UI gate builds and executes a shipped UI plugin bundle through the host
 * manager/renderer registry. The skill gate uses the pinned Pi SDK and an
 * offline faux provider; neither gate reads credentials or user state.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(
	process.argv.includes("--out")
		? process.argv[process.argv.indexOf("--out") + 1]
		: "/private/tmp/drone-ui-skill-acceptance.json",
);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const startedAt = new Date().toISOString();
const commands = [
	{
		id: "UI-01",
		cwd: root,
		args: ["run", "test", "-w", "@drone/desktop", "--", "src/main/ui-plugins/ui-acceptance.test.ts"],
		testFile: "packages/desktop/src/main/ui-plugins/ui-acceptance.test.ts",
	},
	{
		id: "SKILL-01",
		cwd: root,
		args: ["run", "test:sdk", "-w", "@drone/backend", "--", "test/skill-acceptance-sdk.test.mjs"],
		testFile: "packages/backend/test/skill-acceptance-sdk.test.mjs",
	},
];

const results = [];
for (const command of commands) {
	console.error(`[check:ui-skill-acceptance] ${command.id}`);
	const result = spawnSync(npm, command.args, { cwd: command.cwd, stdio: "inherit", env: process.env });
	if (result.error) {
		results.push({ id: command.id, status: "FAIL", testFile: command.testFile, error: result.error.message });
		break;
	}
	results.push({ id: command.id, status: result.status === 0 ? "PASS" : "FAIL", testFile: command.testFile });
	if (result.status !== 0) break;
}

const report = {
	schema: 1,
	kind: "ui-skill-real-acceptance",
	status:
		results.length === commands.length && results.every((entry) => entry.status === "PASS") ? "PASS" : "FAIL",
	mode: "isolated-host-offline-sdk",
	startedAt,
	finishedAt: new Date().toISOString(),
	gates: results,
	claims: {
		"UI-01":
			"shipped plugin bundle built/read by UiPluginManager; renderer contribution appears, is removed, reload nonce increments, config survives manager restart",
		"SKILL-01":
			"pinned Pi SDK expands a real /skill invocation with an offline faux provider; invocation evidence and automatic disable counter-evidence are asserted, with explicit slash retained as manual-only",
	},
};
await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...report, report: out }));
if (report.status !== "PASS") process.exit(1);
