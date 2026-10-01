import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "../../..");

async function loadBuiltExtension(t) {
	const outputDir = await mkdtemp(join(tmpdir(), "drone-institutional-extension-"));
	t.after(() => rm(outputDir, { recursive: true, force: true }));
	await run(
		process.execPath,
		[resolve(root, "scripts/build-extensions.mjs"), "--out-dir", outputDir, "--force"],
		{ cwd: root },
	);
	return import(pathToFileURL(join(outputDir, "institutional-access.mjs")));
}

test("institutional extension registers only its host-facing tools", async (t) => {
	const extension = await loadBuiltExtension(t);
	const tools = [];
	extension.default({
		registerTool(definition) {
			tools.push(definition);
		},
	});
	assert.deepEqual(
		tools.map((tool) => tool.name),
		["research_institutional_login", "research_institutional_status"],
	);
	assert.equal(tools[0].drone.subagent, "exclude");
	assert.equal(tools[1].drone.readOnly, true);
	const result = await tools[1].execute("test", {});
	assert.equal(result.details.session.partition, "persist:drone-institutional");
	assert.equal(typeof result.details.electronAvailable, "boolean");
});

test("institutional extension is omitted from child Pi hosts", async (t) => {
	const extension = await loadBuiltExtension(t);
	const previous = process.env.PI_SUBAGENT_CHILD;
	process.env.PI_SUBAGENT_CHILD = "1";
	try {
		const tools = [];
		extension.default({
			registerTool(definition) {
				tools.push(definition);
			},
		});
		assert.deepEqual(tools, []);
	} finally {
		if (previous === undefined) delete process.env.PI_SUBAGENT_CHILD;
		else process.env.PI_SUBAGENT_CHILD = previous;
	}
});
