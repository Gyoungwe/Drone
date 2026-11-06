import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(SCRIPTS);
const HELPER_URL = pathToFileURL(join(SCRIPTS, "is-main-module.mjs")).href;
const PROBE = `import { isMainModule } from ${JSON.stringify(HELPER_URL)};
console.log(isMainModule(import.meta.url) ? "main" : "imported");\n`;

const scratch = mkdtempSync(join(tmpdir(), "is-main-module-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

// A junction needs no privileges on Windows; other platforms ignore the type.
const link = (target, name) => {
	const path = join(scratch, name);
	symlinkSync(target, path, "junction");
	return path;
};
const linkedScripts = link(SCRIPTS, "linked-scripts");

const writeProbe = (name) => {
	const directory = join(scratch, name);
	mkdirSync(directory, { recursive: true });
	const path = join(directory, "probe.mjs");
	writeFileSync(path, PROBE);
	return path;
};
const run = (args, options) => spawnSync(process.execPath, args, { encoding: "utf8", ...options });

test("a script is main however its path is spelled", () => {
	const real = writeProbe("real");
	const linked = join(link(dirname(real), "linked-probe"), "probe.mjs");
	const cases = {
		direct: [[real]],
		relative: [["probe.mjs"], { cwd: dirname(real) }],
		symlink: [[linked]],
		"preserved symlink": [["--preserve-symlinks-main", linked]],
		spaces: [[writeProbe("a dir with spaces")]],
		"non-ASCII": [[writeProbe("无人机")]],
		hash: [[writeProbe("issue#1")]],
	};
	for (const [name, [args, options]] of Object.entries(cases)) {
		assert.equal(run(args, options).stdout.trim(), "main", name);
	}
});

test("a script that something else loaded is not main", () => {
	const url = pathToFileURL(writeProbe("imported")).href;
	const importer = join(scratch, "importer.mjs");
	writeFileSync(importer, `import ${JSON.stringify(url)};\n`);
	const inline = ["--input-type=module", "-e", `await import(${JSON.stringify(url)})`];
	const cases = {
		"another script": [importer],
		"no entry": inline,
		"entry is not a file": [...inline, "no-such-file"],
	};
	for (const [name, args] of Object.entries(cases)) {
		const result = run(args);
		assert.equal(result.stdout.trim(), "imported", `${name}: ${result.stderr}`);
	}
});

// Each of these used to exit 0 with no output when reached through a symlink.
for (const [script, expected] of [
	["check-structure.mjs", /structure: /],
	["check-lint-baseline.mjs", /lint baseline: /],
	["check-host-domain-dependencies.mjs", /Host domain dependency policy|"status": /],
	["academic-eval/score.mjs", /usage: score\.mjs/],
]) {
	test(`${script} runs through a symlinked path`, () => {
		const { stdout, stderr } = run([join(linkedScripts, script)], { cwd: ROOT });
		assert.match(stdout + stderr, expected);
	});
}

test("check-staged still rejects a staged skip through a symlinked path", () => {
	const repo = join(scratch, "repo");
	mkdirSync(repo);
	execFileSync("git", ["init", "-q"], { cwd: repo });
	// Split so this file does not trip the hook it tests.
	writeFileSync(join(repo, "a.test.ts"), `${"it" + ".skip"}('x', () => {});\n`);
	execFileSync("git", ["add", "a.test.ts"], { cwd: repo });
	const { status, stderr } = run([join(linkedScripts, "check-staged.mjs")], { cwd: repo });
	assert.equal(status, 1);
	assert.match(stderr, /pre-commit: a\.test\.ts: new skipped test/);
});

test("scripts decide whether they are main through the helper", () => {
	const scripts = execFileSync("git", ["ls-files", "scripts"], { cwd: ROOT, encoding: "utf8" })
		.split("\n")
		.filter((file) => /\.[cm]?js$/.test(file) && !/\.test\.[cm]?js$/.test(file))
		.filter((file) => !file.endsWith("/is-main-module.mjs"));
	assert.deepEqual(
		scripts.filter((file) => /process\.argv\[1\]/.test(readFileSync(join(ROOT, file), "utf8"))),
		[],
	);
});
