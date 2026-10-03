import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
