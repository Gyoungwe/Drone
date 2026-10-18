import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "../../..");

test("knowledge production runtime uses the generated worker resource", async () => {
	const runtime = await readFile(
		resolve(root, "packages/extensions/src/internal/knowledge-runtime.ts"),
		"utf8",
	);
	assert.match(runtime, /knowledge-worker\.mjs/);
	assert.doesNotMatch(runtime, /(?:\.\.?[\\/])+\.pi[\\/]lib[\\/]knowledge/);
	assert.equal(
		existsSync(resolve(root, ".pi/extensions/knowledge-worker.mjs")),
		true,
		"generated knowledge worker must be committed for CLI/desktop production loads",
	);
	assert.equal(
		existsSync(resolve(root, ".pi/lib/knowledge")),
		false,
		"legacy knowledge compatibility resources must not ship",
	);
});
