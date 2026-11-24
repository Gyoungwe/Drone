#!/usr/bin/env node
/**
 * Runs one check command through the output ladder (output-ladder.mjs) and keeps its exit code.
 *   node jev-run.mjs -- '<command>'            run, store the full output, print the ladder view
 *   node jev-run.mjs --show <chunk> [--grep p]  print a stored chunk, or only its lines matching p
 * The PreToolUse hook rewrites squeezable Bash commands to the first form.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decision, record, STATE_DIR } from "./decision.mjs";
import { knownFailures, knownHint } from "./known-failures.mjs";
import { ladder } from "./output-ladder.mjs";

const RUNNER = fileURLToPath(import.meta.url);
const CHUNKS = path.join(STATE_DIR, "chunks");
const LAST_RUNS = path.join(STATE_DIR, "last-runs.json");

function runShell(command) {
	return new Promise((resolve) => {
		const parts = [];
		const child = spawn(command, { shell: process.env.SHELL || true, stdio: ["inherit", "pipe", "pipe"] });
		child.stdout.on("data", (data) => parts.push(data));
		child.stderr.on("data", (data) => parts.push(data));
		child.on("error", (error) => parts.push(Buffer.from(`${error.message}\n`)));
		child.on("close", (code, signal) => {
			const output = Buffer.concat(parts).toString("utf8");
			resolve({ output, exitCode: code ?? (signal === null ? 1 : 128) });
		});
	});
}

function readLastRuns() {
	return existsSync(LAST_RUNS) ? JSON.parse(readFileSync(LAST_RUNS, "utf8")) : {};
}

function commandKey(command) {
	return createHash("sha256").update(`${process.cwd()}\n${command}`).digest("hex").slice(0, 16);
}

async function run(command) {
	const raw = process.env.JEV_RAW === "1";
	const { output, exitCode } = await runShell(command);
	const lastRuns = readLastRuns();
	const key = commandKey(command);
	const view = ladder({ output, exitCode, raw, previous: lastRuns[key], runner: RUNNER });
	mkdirSync(CHUNKS, { recursive: true });
	writeFileSync(path.join(CHUNKS, `${view.id}.log`), view.stored);
	writeFileSync(LAST_RUNS, `${JSON.stringify({ ...lastRuns, [key]: view.fingerprint }, null, "\t")}\n`);
	const shown = view.answer !== "hide";
	const known = shown ? knownFailures({ output: view.stored, command, exitCode }) : [];
	record(STATE_DIR, {
		...decision("output", view.answer, "ladder", view.confidence),
		command,
		exitCode,
		lines: view.lines,
		chunk: view.id,
		known: known.map((rule) => rule.id),
	});
	const askHint =
		exitCode !== 0 && known.length === 0 && shown
			? `⚑ 种子库未命中；查经验库：node .claude/jev/jev-lessons.mjs ask --chunk ${view.id}`
			: "";
	process.stdout.write(`${[view.text, knownHint(known), askHint].filter(Boolean).join("\n")}\n`);
	return exitCode;
}

function show(id, pattern) {
	if (!/^[0-9a-f]{8}$/.test(id)) throw new Error(`not a chunk id: ${id}`);
	const file = path.join(CHUNKS, `${id}.log`);
	if (!existsSync(file)) throw new Error(`no stored chunk ${id} in ${CHUNKS}`);
	const text = readFileSync(file, "utf8");
	if (pattern === undefined) return text;
	const matcher = new RegExp(pattern, "i");
	const hits = text
		.split("\n")
		.flatMap((line, index) => (matcher.test(line) ? [`${index + 1}: ${line}`] : []));
	return `${hits.length} matching lines in chunk ${id}\n${hits.join("\n")}`;
}

async function main(argv) {
	if (argv[0] === "--show") {
		const grep = argv.indexOf("--grep");
		process.stdout.write(`${show(argv[1] ?? "", grep === -1 ? undefined : argv[grep + 1])}\n`);
		return 0;
	}
	if (argv[0] !== "--" || argv.length !== 2) {
		throw new Error("usage: jev-run.mjs -- '<command>' | --show <chunk> [--grep <pattern>]");
	}
	return run(argv[1]);
}

process.exitCode = await main(process.argv.slice(2));
