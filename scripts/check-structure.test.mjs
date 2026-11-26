import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compare, scanSource, updateBaseline } from "./check-structure.mjs";

test("flags long files, non-Error extends and module-level let", () => {
	// Built from parts so this file does not trip the check it tests.
	const ext = "ext" + "ends";
	const text = `${"x\n".repeat(401)}class A ${ext} B {}\nclass E ${ext} Error {}\nclass F ${ext} errors.HttpError {}\nlet a = 1;\nexport let b = 2;\nfunction f() {\n\tlet c = 3;\n}\n`;
	assert.deepEqual(scanSource(text), { "file-lines": 409, "class-extends": 1, "module-let": 2 });
	assert.deepEqual(scanSource("const a = 1;\n"), {});
});

test("new long files fail above the limit; baselined ones may not grow", () => {
	const { grown, shrunk } = compare(
		{ "file-lines\told.ts": 500, "module-let\tgone.ts": 1 },
		{ "file-lines\told.ts": 501, "file-lines\tnew.ts": 401 },
	);
	assert.deepEqual(
		grown.map((g) => g.key),
		["file-lines\told.ts", "file-lines\tnew.ts"],
	);
	assert.deepEqual(
		shrunk.map((s) => s.key),
		["module-let\tgone.ts"],
	);
});

function baselineFile(t, baseline) {
	const dir = mkdtempSync(join(tmpdir(), "structure-baseline-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "baseline.json");
	writeFileSync(path, `${JSON.stringify(baseline)}\n`);
	return path;
}

const readBaseline = (path) => JSON.parse(readFileSync(path, "utf8"));

test("--update records drops and removes entries that reached zero", (t) => {
	t.mock.method(console, "log", () => undefined);
	const path = baselineFile(t, { "file-lines\ta.ts": 500, "module-let\tb.ts": 1 });
	assert.equal(updateBaseline(path, { "file-lines\ta.ts": 450 }, ["--update"]), 0);
	assert.deepEqual(readBaseline(path), { "file-lines\ta.ts": 450 });
});

test("--update refuses a rise or a new entry, lists them and writes nothing", (t) => {
	const errors = t.mock.method(console, "error", () => undefined);
	const baseline = { "file-lines\ta.ts": 500, "module-let\tb.ts": 3 };
	const path = baselineFile(t, baseline);
	// b.ts drops, but a rise elsewhere must not let that drop through on its own.
	const current = { "file-lines\ta.ts": 501, "module-let\tb.ts": 1, "file-lines\tnew.ts": 401 };
	assert.equal(updateBaseline(path, current, ["--update"]), 1);
	assert.deepEqual(readBaseline(path), baseline);
	const output = errors.mock.calls.map((call) => call.arguments[0]).join("\n");
	assert.match(output, /a\.ts file-lines is 501 \(allowed 500\)/);
	assert.match(output, /new\.ts file-lines is 401 \(allowed 400\)/);
	assert.doesNotMatch(output, /b\.ts/);
});

test("--allow-moves accepts a rise or a new entry and lists what it accepted", (t) => {
	const logs = t.mock.method(console, "log", () => undefined);
	const path = baselineFile(t, { "module-let\told.ts": 2 });
	assert.equal(updateBaseline(path, { "module-let\tnew.ts": 2 }, ["--update", "--allow-moves"]), 0);
	assert.deepEqual(readBaseline(path), { "module-let\tnew.ts": 2 });
	const output = logs.mock.calls.map((call) => call.arguments[0]).join("\n");
	assert.match(output, /accepted as moved: new\.ts module-let is 2 \(allowed 0\)/);
});

const legacyKnowledge = "packages/plugin-api/src/legacy-knowledge.ts";
const structureBaseline = "scripts/fixtures/structure-baseline.json";

function structureFixture(t) {
	const cwd = mkdtempSync(join(tmpdir(), "drone-structure-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const git = (...args) => execFileSync("git", args, { cwd, stdio: "pipe" });
	const put = (file, text) => {
		const path = join(cwd, file);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, text);
	};
	git("init", "--quiet", "--template=");
	put(structureBaseline, "{}\n");
	for (const name of ["check-structure.mjs", "is-main-module.mjs"]) {
		copyFileSync(new URL(name, import.meta.url), join(cwd, "scripts", name));
	}
	const modules = fileURLToPath(new URL("../node_modules", import.meta.url));
	symlinkSync(modules, join(cwd, "node_modules"), "junction");
	put(legacyKnowledge, "export {};\n");
	git("add", legacyKnowledge);
	const run = (...args) =>
		spawnSync(process.execPath, [join(cwd, "scripts/check-structure.mjs"), ...args], {
			cwd,
			encoding: "utf8",
		});
	return { cwd, git, put, run, baseline: () => readBaseline(join(cwd, structureBaseline)) };
}

test("structure rejects retired IPC and new legacy filenames even before staging", (t) => {
	const { put, run, baseline } = structureFixture(t);
	put("packages/plugin-api/src/p5-facts.ts", "export {};\n");
	put("packages/shared/src/host-api/contracts.ts", "export {};\n");
	const allowed = run();
	assert.equal(allowed.status, 0, allowed.stderr);
	put("packages/shared/src/ipc.ts", "export {};\n");
	put("packages/shared/src/legacy-foo.ts", "export {};\n");
	put("packages/plugin-api/src/legacy-other.ts", "export {};\n");
	const blocked = run("--update", "--allow-moves");
	assert.equal(blocked.status, 1, blocked.stdout);
	assert.match(blocked.stderr, /packages\/shared\/src\/ipc\.ts/);
	assert.match(blocked.stderr, /packages\/shared\/src\/legacy-foo\.ts/);
	assert.match(blocked.stderr, /packages\/plugin-api\/src\/legacy-other\.ts/);
	assert.doesNotMatch(blocked.stderr, /p5-facts|legacy-knowledge|host-api\/contracts/);
	assert.deepEqual(baseline(), {});
});

test("structure rejects cross-package wildcard exports and keeps local shared barrels", (t) => {
	const { put, run } = structureFixture(t);
	const index = "packages/shared/src/index.ts";
	put(index, 'export * from "./host-api";\nexport * from "./process-lanes/types";\n');
	const allowed = run();
	assert.equal(allowed.status, 0, allowed.stderr);
	put(index, 'export *\nfrom "@gyoungwe/plugin-api";\n');
	const blocked = run();
	assert.equal(blocked.status, 1, blocked.stdout);
	assert.match(blocked.stderr, /packages\/shared\/src\/index\.ts:1.* @gyoungwe\/plugin-api/);
});

test("structure guards the 400-line limit for a host API contract", (t) => {
	const { git, put, run } = structureFixture(t);
	const file = "packages/shared/src/host-api/sessions.ts";
	put(file, "export {};\n".repeat(400));
	git("add", file);
	const allowed = run();
	assert.equal(allowed.status, 0, allowed.stderr);
	put(file, "export {};\n".repeat(401));
	const blocked = run();
	assert.equal(blocked.status, 1, blocked.stdout);
	assert.match(blocked.stderr, /host-api\/sessions\.ts file-lines is 401 \(allowed 400\)/);
});

test("structure records legacy-knowledge retirement and rejects its return", (t) => {
	const { cwd, put, run, baseline } = structureFixture(t);
	const unchanged = run("--update");
	assert.equal(unchanged.status, 0, unchanged.stderr);
	assert.deepEqual(baseline(), {});
	rmSync(join(cwd, legacyKnowledge));
	const update = run("--update");
	assert.equal(update.status, 0, update.stderr);
	const retired = { [`legacy-file\t${legacyKnowledge}`]: 0 };
	assert.deepEqual(baseline(), retired);
	assert.equal(run().status, 0);
	put(legacyKnowledge, "export {};\n");
	const blocked = run("--update");
	assert.equal(blocked.status, 1, blocked.stdout);
	assert.ok(blocked.stderr.includes(legacyKnowledge), blocked.stderr);
	assert.deepEqual(baseline(), retired);
});
