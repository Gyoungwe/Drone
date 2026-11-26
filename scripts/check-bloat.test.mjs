import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-bloat.mjs", import.meta.url));
const code = (lines) => "export {};\n".repeat(lines);

function fixture(t, initial = {}) {
	const cwd = mkdtempSync(join(tmpdir(), "drone-bloat-"));
	t.after(() => rmSync(cwd, { recursive: true }));
	const git = (...args) => execFileSync("git", args, { cwd, stdio: "pipe" });
	const put = (path, text) => {
		const absolute = join(cwd, path);
		mkdirSync(dirname(absolute), { recursive: true });
		writeFileSync(absolute, text);
	};
	git("init", "--quiet", "--template=");
	for (const [path, text] of Object.entries(initial)) put(path, text);
	git("add", ".");
	git(
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@example.invalid",
		"-c",
		"core.hooksPath=.git/hooks",
		"commit",
		"--allow-empty",
		"-qm",
		"base",
	);
	const check = (...args) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
	return { git, put, check };
}

test("new files use the selected snapshot, including untracked names with spaces", (t) => {
	const { git, put, check } = fixture(t);
	const path = "packages/demo/src/new component.tsx";
	put(path, code(350));
	assert.equal(check().status, 0);
	git("add", path);
	put(path, code(351));
	assert.equal(check("--staged").status, 0);
	assert.match(check().stderr, /超长新文件.*new component\.tsx/);
	git("add", path);
	put(path, code(350));
	assert.match(check("--staged").stderr, /超长新文件/);
});

test("even an empty new file in a frozen or retired directory is rejected", (t) => {
	const { put, check } = fixture(t);
	put("packages/research/src/new.ts", "");
	const result = check();
	assert.equal(result.status, 1);
	assert.match(result.stderr, /冻结目录/);
});

test("a shrinking legacy file passes while an unrelated edit cannot offset growth", (t) => {
	const legacy = "packages/extensions/src/legacy.ts";
	const wire = "packages/plugin-api/src/ui-wire.ts";
	const { put, check } = fixture(t, { [legacy]: code(3), [wire]: code(2) });
	put(legacy, code(2));
	let result = check("--require-net-decrease");
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /净 -1 行/);
	put(wire, code(3));
	result = check();
	assert.equal(result.status, 1);
	assert.match(result.stderr, /棘轮拦截.*ui-wire\.ts/);
});

test("the oversized existing-file rule allows shrinkage but not growth", (t) => {
	const path = "packages/demo/src/large.ts";
	const { put, check } = fixture(t, { [path]: code(501) });
	put(path, code(502));
	assert.match(check().stderr, /超长文件棘轮/);
	put(path, code(500));
	assert.equal(check().status, 0);
});

test("new generated files, process records, oversized docs and source mjs are rejected", (t) => {
	const { put, check } = fixture(t);
	put("packages/demo/dist/index.mjs", "export {};\n");
	put("docs/feature/inventory-task.md", "# Small but transient\n");
	put("docs/design.md", "x".repeat(12 * 1024 + 1));
	put("packages/demo/src/logic.mjs", "export {};\n");
	const result = check();
	assert.equal(result.status, 1);
	assert.match(result.stderr, /产物拦截.*dist\/index\.mjs/);
	assert.match(result.stderr, /文档膨胀.*inventory-task\.md/);
	assert.match(result.stderr, /文档膨胀.*docs\/design\.md/);
	assert.match(result.stderr, /语言统一.*logic\.mjs/);
});

test("tracked bundles may rebuild at the same size or shrink, but must not grow past 50 KiB", (t) => {
	const path = "packages/demo/dist/legacy.mjs";
	const limit = 50 * 1024;
	const { git, put, check } = fixture(t, { [path]: "x".repeat(limit) });
	put(path, "y".repeat(limit));
	assert.equal(check().status, 0);
	git("add", path);
	put(path, "z".repeat(limit + 1));
	assert.equal(check("--staged").status, 0);
	assert.match(check().stderr, /产物拦截.*legacy\.mjs/);
	git("add", path);
	put(path, "z".repeat(limit - 1));
	assert.match(check("--staged").stderr, /产物拦截.*legacy\.mjs/);
	assert.equal(check().status, 0);
});

test("oversized runtime Skill indexes cannot be added or grow", (t) => {
	const path = "packages/demo/skills/current/SKILL.md";
	const { put, check } = fixture(t, { [path]: "x".repeat(4 * 1024) });
	put(path, "x".repeat(4 * 1024 + 1));
	put(".pi/skills/secondary/SKILL.md", "x".repeat(3 * 1024 + 1));
	const result = check();
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Skill 索引.*current\/SKILL\.md/);
	assert.match(result.stderr, /Skill 索引.*secondary\/SKILL\.md/);
	put(path, "x".repeat(4 * 1024 - 1));
	put(".pi/skills/secondary/SKILL.md", "x".repeat(3 * 1024));
	assert.equal(check().status, 0);
});

test("other generated artifact classes keep the 50 KiB byte ratchet even at zero net lines", (t) => {
	const limit = 50 * 1024;
	const paths = [
		"packages/demo/ui/bundle.js",
		"packages/demo/ui/styles/generated.ts",
		".pi/extensions/nested/dist/legacy.mjs",
	];
	const { git, put, check } = fixture(t, Object.fromEntries(paths.map((path) => [path, "x".repeat(limit)])));
	for (const path of paths) put(path, "z".repeat(limit + 1));
	const worktree = check();
	git("add", ...paths);
	const staged = check("--staged");
	for (const result of [worktree, staged]) {
		assert.equal(result.status, 1);
		for (const path of paths)
			assert.match(result.stderr, new RegExp(`产物拦截.*${path.replace(/\./g, "\\.")}`));
	}
});

test("an index deletion offsets extension growth while the untracked working copy is rejected", (t) => {
	const path = ".pi/extensions/legacy.mjs";
	const growing = ".pi/extensions/growing.mjs";
	const { git, put, check } = fixture(t, { [path]: "x".repeat(60 * 1024), [growing]: code(1) });
	git("rm", "--cached", path);
	assert.equal(check("--staged").status, 0);
	const untracked = check();
	assert.equal(untracked.status, 1);
	assert.match(untracked.stderr, /产物拦截.*legacy\.mjs/);
	put(growing, code(2));
	git("add", growing);
	assert.equal(check("--staged").status, 0);
	const both = check();
	assert.equal(both.status, 1);
	assert.match(both.stderr, /产物拦截.*growing\.mjs/);
});

test("process cleanup and test deletions cannot satisfy a business net decrease", (t) => {
	const { git, check } = fixture(t, {
		"upgrade-audit/captured.ts": code(8),
		"packages/demo/src/example.test.ts": code(8),
	});
	git("rm", "-r", "upgrade-audit", "packages");
	assert.equal(check("--staged").status, 0);
	assert.match(check("--staged", "--require-net-decrease").stderr, /业务净减未达标/);
});

test("tracked extension batches allow bounded byte growth at zero or negative net lines in the selected snapshot", (t) => {
	const growing = ".pi/extensions/growing.mjs";
	const shrinking = ".pi/extensions/shrinking.mjs";
	const lines = 30 * 1024;
	const denser = (count) => `${"longer\n".repeat(4 * 1024)}${"x\n".repeat(count - 4 * 1024)}`;
	const { git, put, check } = fixture(t, {
		[growing]: "x\n".repeat(lines),
		[shrinking]: "y\n".repeat(lines),
	});
	put(growing, denser(lines + 1));
	put(shrinking, "y\n".repeat(lines - 1));
	assert.equal(check().status, 0);
	git("add", growing, shrinking);
	put(growing, denser(lines + 2));
	assert.equal(check("--staged").status, 0);
	assert.match(check().stderr, /产物拦截.*growing\.mjs/);
	put(shrinking, "y\n".repeat(lines - 3));
	git("add", growing, shrinking);
	put(shrinking, "y\n".repeat(lines - 1));
	assert.equal(check("--staged").status, 0);
	assert.equal(check().status, 1);
});

test("new extension artifacts remain rejected even below 50 KiB in a shrinking batch", (t) => {
	const tracked = ".pi/extensions/tracked.mjs";
	const { git, put, check } = fixture(t, { [tracked]: code(20) });
	const path = ".pi/extensions/new.mjs";
	put(tracked, code(2));
	put(path, code(5));
	const worktree = check();
	git("add", tracked, path);
	const staged = check("--staged");
	for (const result of [worktree, staged]) {
		assert.equal(result.status, 1);
		assert.match(result.stderr, /产物拦截.*new\.mjs/);
		assert.doesNotMatch(result.stderr, /tracked\.mjs/);
	}
});

test("a net-growing tracked extension batch rejects every member in both snapshots", (t) => {
	const growing = ".pi/extensions/growing.mjs";
	const shrinking = ".pi/extensions/shrinking.mjs";
	const lines = 30 * 1024;
	const { git, put, check } = fixture(t, {
		[growing]: "x\n".repeat(lines),
		[shrinking]: "y\n".repeat(lines),
	});
	put(growing, "x\n".repeat(lines + 2));
	put(shrinking, "y\n".repeat(lines - 1));
	const worktree = check();
	assert.equal(worktree.status, 1);
	assert.match(worktree.stderr, /产物拦截.*growing\.mjs/);
	assert.match(worktree.stderr, /产物拦截.*shrinking\.mjs/);
	git("add", growing, shrinking);
	put(growing, "x\n");
	const staged = check("--staged");
	assert.equal(staged.status, 1);
	assert.match(staged.stderr, /产物拦截.*growing\.mjs/);
	assert.match(staged.stderr, /产物拦截.*shrinking\.mjs/);
	assert.equal(check().status, 0);
});

test("tracked extension batches reject byte growth past 50 KiB, deletion weight smuggling, and binary blobs", (t) => {
	const dense = ".pi/extensions/dense.mjs";
	const shrinking = ".pi/extensions/shrinking.mjs";
	const lines = 30 * 1024;
	const { git, put, check } = fixture(t, {
		[dense]: "x\n".repeat(lines),
		[shrinking]: "y\n".repeat(lines),
	});
	put(dense, `${"d".repeat(60 * 1024)}\n${"x\n".repeat(lines - 1)}`);
	put(shrinking, "y\n".repeat(lines - 1));
	const worktree = check();
	git("add", dense, shrinking);
	const staged = check("--staged");
	for (const result of [worktree, staged]) {
		assert.equal(result.status, 1);
		assert.match(result.stderr, /产物拦截.*dense\.mjs/);
		assert.match(result.stderr, /产物拦截.*shrinking\.mjs/);
	}

	const sparse = ".pi/extensions/sparse.mjs";
	const heavy = ".pi/extensions/heavy.mjs";
	const smuggle = fixture(t, {
		[sparse]: "a\n".repeat(2000),
		[heavy]: "b\n".repeat(100),
	});
	smuggle.git("rm", sparse);
	smuggle.put(heavy, `${"b".repeat(40)}\n`.repeat(2100));
	const smuggleWorktree = smuggle.check();
	smuggle.git("add", heavy);
	const smuggleStaged = smuggle.check("--staged");
	for (const result of [smuggleWorktree, smuggleStaged]) {
		assert.equal(result.status, 1);
		assert.match(result.stderr, /产物拦截.*sparse\.mjs/);
		assert.match(result.stderr, /产物拦截.*heavy\.mjs/);
	}

	const bin = ".pi/extensions/bin.mjs";
	const binaryCase = fixture(t, { [bin]: code(100) });
	binaryCase.put(bin, Buffer.from("\0".repeat(100)));
	const binWorktree = binaryCase.check();
	binaryCase.git("add", bin);
	const binStaged = binaryCase.check("--staged");
	for (const result of [binWorktree, binStaged]) {
		assert.equal(result.status, 1);
		assert.match(result.stderr, /产物拦截.*bin\.mjs/);
	}
});
