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
	const fetcher = await readFile(resolve(root, "scripts/fetch-plugins.mjs"), "utf8");
	assert.match(fetcher, /knowledge-worker\.mjs/);
	assert.match(fetcher, /vendor\/plugins/);
	assert.equal(
		existsSync(resolve(root, ".pi/lib/knowledge")),
		false,
		"legacy knowledge compatibility resources must not ship",
	);
});
