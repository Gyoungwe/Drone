#!/usr/bin/env node
/** Reproducible local release gate. Only synthetic fixtures; never invokes a paid model. */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = new Set(process.argv.slice(2));
if (args.has("--help")) {
	console.log(
		"node scripts/check-upgrade-release.mjs [--fixtures-only] [--ui] [--report path]\nRuns offline regression fixtures; default also runs lint, typecheck, workspace tests and production build. --ui adds isolated Electron smoke. No tag, push, signing identity or release upload is performed.",
	);
	process.exit(0);
}
const value = (flag) => {
	const at = process.argv.indexOf(flag);
	if (at < 0) return null;
	const next = process.argv[at + 1];
	if (!next || next.startsWith("--")) throw new Error(`${flag} needs a value`);
	return next;
};
const root = fileURLToPath(new URL("../", import.meta.url));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = resolve(root, value("--report") || `.local/release-validation/${stamp}/report.json`);
await mkdir(dirname(reportPath), { recursive: true });
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const steps = args.has("--fixtures-only")
	? []
	: [
			["lint", npm, ["run", "lint"], 120_000],
			["typecheck", npm, ["run", "typecheck"], 120_000],
			["tests", npm, ["test"], 240_000],
		];
steps.push(
	["orchestration-stress", process.execPath, ["scripts/stress-knowledge.mjs"], 60_000],
	["hybrid-fixture", process.execPath, ["scripts/benchmark-semantic.mjs"], 120_000],
	["packaged-resources", process.execPath, ["scripts/check-knowledge-package.mjs"], 90_000],
);
if (!args.has("--fixtures-only")) steps.push(["build", npm, ["run", "build"], 180_000]);
if (args.has("--ui"))
	steps.push(["electron-ui", process.execPath, ["scripts/check-knowledge-ui.mjs"], 180_000]);
const report = {
	schema: 1,
	startedAt: new Date().toISOString(),
	platform: process.platform,
	arch: process.arch,
	node: process.version,
	fixtureOnly: args.has("--fixtures-only"),
	liveModel: false,
	publicRelease: false,
	passed: false,
	steps: [],
};
async function run(name, command, argv, timeout) {
	const start = Date.now();
	let output = "";
	const child = spawn(command, argv, {
		cwd: root,
		env: process.env,
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
		shell: process.platform === "win32" && command.endsWith(".cmd"),
	});
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		child.kill("SIGTERM");
	}, timeout);
	const hardTimer = setTimeout(() => child.kill("SIGKILL"), timeout + 5_000);
	const record = (chunk) => {
		if (output.length < 8_000_000) output += String(chunk).slice(0, 8_000_000 - output.length);
	};
	child.stdout.on("data", record);
	child.stderr.on("data", record);
	let code;
	try {
		code = await new Promise((resolve, reject) => {
			child.once("error", reject);
			child.once("close", resolve);
		});
	} catch (error) {
		output += `\n${String(error)}`;
		code = -1;
	} finally {
		clearTimeout(timer);
		clearTimeout(hardTimer);
	}
	const logPath = resolve(dirname(reportPath), `${name}.log`);
	await writeFile(logPath, output);
	const result = {
		name,
		passed: code === 0 && !timedOut,
		exitCode: code,
		timedOut,
		durationMs: Date.now() - start,
		logPath,
	};
	report.steps.push(result);
	console.log(JSON.stringify(result));
	await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
	return result.passed;
}
for (const step of steps) if (!(await run(...step))) break;
report.completedAt = new Date().toISOString();
report.passed = report.steps.length === steps.length && report.steps.every((step) => step.passed);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ passed: report.passed, reportPath }));
process.exitCode = report.passed ? 0 : 1;
