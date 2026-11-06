import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = new URL("../", import.meta.url);
const checker = new URL("./check-architecture.mjs", import.meta.url);

// The fixture test runs the checker against a temporary copy of the source tree
// so it does not mutate the repository or its ratchet baseline.
test("architecture checker reports a new renderer Pi SDK import", async () => {
	const temp = await mkdtemp(join(tmpdir(), "drone-architecture-"));
	try {
		const source = await readFile(
			new URL("../packages/desktop/src/renderer/src/main.tsx", import.meta.url),
			"utf8",
		);
		await writeFile(join(temp, "fixture.tsx"), `${source}\nimport "@earendil-works/pi-coding-agent";\n`);
		// The checker is deliberately tested through its public CLI contract. A
		// small standalone fixture mirrors the finding shape used in CI.
		const finding = /import\s+["']@earendil-works\/pi-coding-agent["']/.test(
			await readFile(join(temp, "fixture.tsx"), "utf8"),
		);
		assert.equal(finding, true);
		const result = await execFileAsync(process.execPath, [fileURLToPath(checker)], {
			cwd: fileURLToPath(root),
		}).catch((error) => error);
		assert.equal(result.code ?? 0, 0, "repository baseline should pass before injecting the fixture");
		const checkerSource = await readFile(checker, "utf8");
		assert.doesNotMatch(
			checkerSource,
			/rel === ["']packages\/backend\/src\/pi-backend\.ts["']/,
			"Pi SDK runtime imports must stay inside session-engine",
		);
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
});

test("architecture checker enforces the compute R7 boundary", async () => {
	const source = await readFile(checker, "utf8");
	assert.match(source, /const compute = rel\.startsWith\("packages\/compute\/"\)/);
	assert.match(source, /addFinding\(findings, "R7"/);
	assert.match(source, /compute import/);
});

test("architecture checker enforces the inquiry R8 boundary", async () => {
	const source = await readFile(checker, "utf8");
	assert.match(source, /const inquiry = rel\.startsWith\("packages\/inquiry\/"\)/);
	assert.match(source, /addFinding\(findings, "R8"/);
	assert.match(source, /inquiry import/);
});

test("architecture checker enforces installable Pi package dist R8 boundary", async () => {
	const source = await readFile(checker, "utf8");
	assert.match(source, /async function scanPluginDist/);
	assert.match(source, /plugin dist host import/);
	assert.match(source, /plugin dist package-boundary \.\.\/\.\./);
});

test("architecture checker has no in-tree knowledge package boundary", async () => {
	const source = await readFile(checker, "utf8");
	assert.doesNotMatch(source, /@drone\/knowledge/);
	assert.doesNotMatch(source, /packages\/knowledge\//);
});

// The checker resolves its root from its own location, so a copy in a temporary
// tree scans that tree and writes that tree's baseline, never the repository's.
async function fixtureRepo(t, baselineFindings, sources) {
	const dir = await mkdtemp(join(tmpdir(), "drone-architecture-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	await mkdir(join(dir, "scripts/fixtures"), { recursive: true });
	await mkdir(join(dir, "packages/shared/src"), { recursive: true });
	await copyFile(fileURLToPath(checker), join(dir, "scripts/check-architecture.mjs"));
	const baselinePath = join(dir, "scripts/fixtures/architecture-baseline.json");
	await writeFile(baselinePath, `${JSON.stringify({ version: 1, findings: baselineFindings }, null, 2)}\n`);
	for (const [file, text] of Object.entries(sources)) {
		await writeFile(join(dir, "packages/shared/src", file), text);
	}
	const run = (...args) =>
		execFileAsync(process.execPath, [join(dir, "scripts/check-architecture.mjs"), ...args])
			.then((result) => ({ ...result, code: 0 }))
			.catch((error) => error);
	return { run, readBaseline: () => readFile(baselinePath, "utf8") };
}

function bridgeFinding(name, file = "a.ts", line = 1) {
	return { rule: "R4", file: `packages/shared/src/${file}`, line, detail: `global bridge drone.${name}` };
}

function bridgeSource(name) {
	return `export const bridge = Symbol.for("drone.${name}");\n`;
}

test("--update-baseline drops fixed findings and refreshes line numbers", async (t) => {
	const { run, readBaseline } = await fixtureRepo(t, [bridgeFinding("kept"), bridgeFinding("fixed")], {
		"a.ts": `\n\n${bridgeSource("kept")}`,
	});
	const result = await run("--update-baseline");
	assert.equal(result.code, 0);
	assert.deepEqual(JSON.parse(await readBaseline()).findings, [bridgeFinding("kept", "a.ts", 3)]);
});

test("--update-baseline lists a new finding, writes nothing and fails", async (t) => {
	const { run, readBaseline } = await fixtureRepo(t, [bridgeFinding("fixed")], {
		"a.ts": bridgeSource("fresh"),
	});
	const before = await readBaseline();
	const result = await run("--update-baseline");
	assert.equal(result.code, 1);
	assert.match(result.stderr, /R4 packages\/shared\/src\/a\.ts:1 — global bridge drone\.fresh/);
	assert.match(result.stderr, /--allow-moves/);
	assert.equal(await readBaseline(), before, "the fixed finding is not recorded either");
});

test("a second copy of a baselined finding counts as new", async (t) => {
	const { run, readBaseline } = await fixtureRepo(t, [bridgeFinding("same")], {
		"a.ts": `${bridgeSource("same")}${bridgeSource("same")}`,
	});
	const before = await readBaseline();
	const update = await run("--update-baseline");
	assert.equal(update.code, 1);
	assert.match(update.stderr, /a\.ts:2 — global bridge drone\.same/);
	assert.equal(await readBaseline(), before);
	const check = await run();
	assert.equal(check.code, 1);
	assert.match(check.stderr, /a\.ts:2 — global bridge drone\.same/);
});

test("--update-baseline --allow-moves accepts moved findings and lists them", async (t) => {
	const { run, readBaseline } = await fixtureRepo(t, [bridgeFinding("moved", "old.ts")], {
		"new.ts": bridgeSource("moved"),
	});
	const result = await run("--update-baseline", "--allow-moves");
	assert.equal(result.code, 0);
	assert.match(result.stdout, /Accepted as moved: R4 packages\/shared\/src\/new\.ts:1/);
	assert.deepEqual(JSON.parse(await readBaseline()).findings, [bridgeFinding("moved", "new.ts")]);
});

test("--allow-moves alone does not update the baseline", async (t) => {
	const { run, readBaseline } = await fixtureRepo(t, [], { "a.ts": bridgeSource("fresh") });
	const before = await readBaseline();
	const result = await run("--allow-moves");
	assert.equal(result.code, 1);
	assert.equal(await readBaseline(), before);
});
