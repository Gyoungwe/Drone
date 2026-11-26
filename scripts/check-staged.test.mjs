import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkStaged, parseAddedLines } from "./check-staged.mjs";

test("generated output mixed with source fails; alone it passes", () => {
	assert.equal(checkStaged(["src/a.ts", ".pi/extensions/x.mjs"], []).length, 1);
	assert.deepEqual(checkStaged([".pi/extensions/x.mjs", "packages/p/dist/i.js"], []), []);
	assert.deepEqual(checkStaged(["src/a.ts"], []), []);
});

test("new skips and test timeouts fail", () => {
	const added = parseAddedLines(
		// Split so this file does not trip the hook it tests.
		[
			"+++ b/src/a.test.ts",
			"+it" + ".skip('x', () => {});",
			"+test('y', { time" + "out: 20000 }, () => {});",
			"+++ b/src/b.ts",
			"+const time" + "out: number = 5;",
		].join("\n"),
	);
	assert.deepEqual(
		checkStaged(["src/a.test.ts", "src/b.ts"], added).map((p) => p.split(":")[0]),
		["src/a.test.ts", "src/a.test.ts"],
	);
});

const legacyKnowledge = "packages/plugin-api/src/legacy-knowledge.ts";
const structureBaseline = "scripts/fixtures/structure-baseline.json";
const checker = fileURLToPath(new URL("./check-staged.mjs", import.meta.url));

function stagedFixture(t) {
	const cwd = mkdtempSync(join(tmpdir(), "drone-staged-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const git = (...args) => execFileSync("git", args, { cwd, stdio: "pipe" });
	const put = (file, text) => {
		const path = join(cwd, file);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, text);
	};
	git("init", "--quiet", "--template=");
	put(structureBaseline, "{}\n");
	put(legacyKnowledge, "export {};\n");
	git("add", structureBaseline, legacyKnowledge);
	const run = () => spawnSync(process.execPath, [checker], { cwd, encoding: "utf8" });
	return { git, put, run };
}

test("staged check rejects retired IPC and new legacy filenames and permits P5 modules", (t) => {
	const { git, put, run } = stagedFixture(t);
	const contracts = "packages/shared/src/host-api/index.ts";
	const p5 = "packages/plugin-api/src/p5-facts.ts";
	put(contracts, "export {};\n");
	put(p5, "export {};\n");
	git("add", contracts, p5);
	const allowed = run();
	assert.equal(allowed.status, 0, allowed.stderr);
	const blockedPaths = [
		"packages/shared/src/ipc.ts",
		"packages/shared/src/legacy-foo.ts",
		"packages/plugin-api/src/legacy-other.ts",
	];
	for (const file of blockedPaths) put(file, "export {};\n");
	git("add", ...blockedPaths);
	const blocked = run();
	assert.equal(blocked.status, 1, blocked.stdout);
	for (const file of blockedPaths) assert.ok(blocked.stderr.includes(file), blocked.stderr);
	assert.doesNotMatch(blocked.stderr, /p5-facts|legacy-knowledge|host-api\/index/);
});

test("staged check reads complete staged exports even when the working copy permits them", (t) => {
	const { git, put, run } = stagedFixture(t);
	const index = "packages/shared/src/barrels/shared exports.ts";
	const relative = 'export * from "./host-api";\nexport * from "./process-lanes/types";\n';
	put(index, 'export *\n as knowledge\n from "@gyoungwe/plugin-api/knowledge";\n');
	git("add", index);
	put(index, relative);
	const blocked = run();
	assert.equal(blocked.status, 1, blocked.stdout);
	assert.match(blocked.stderr, /shared exports\.ts:1.* @gyoungwe\/plugin-api\/knowledge/);
	git("add", index);
	const allowed = run();
	assert.equal(allowed.status, 0, allowed.stderr);
});

test("staged legacy-knowledge retirement requires the updated baseline in the index", (t) => {
	const { git, put, run } = stagedFixture(t);
	git("rm", "--cached", legacyKnowledge);
	put(structureBaseline, JSON.stringify({ [`legacy-file\t${legacyKnowledge}`]: 0 }));
	const pending = run();
	assert.equal(pending.status, 1, pending.stdout);
	assert.match(pending.stderr, /structure-baseline\.json/);
	git("add", structureBaseline);
	const retired = run();
	assert.equal(retired.status, 0, retired.stderr);
	git("add", legacyKnowledge);
	put(structureBaseline, "{}\n");
	const blocked = run();
	assert.equal(blocked.status, 1, blocked.stdout);
	assert.ok(blocked.stderr.includes(legacyKnowledge), blocked.stderr);
});
