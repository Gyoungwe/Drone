import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const extension = await import(pathToFileURL(join(root, "dist/index.mjs")).href);
const tools = new Map();
const registration = extension.default({
	registerTool(tool) {
		tools.set(tool.name, tool);
	},
});
assert.deepEqual(registration.tools, [
	"evidence_validate_manifest",
	"evidence_validate_capsule",
	"evidence_verify_replay",
]);
assert.deepEqual([...tools.keys()], registration.tools);
for (const tool of tools.values()) assert.equal(tool.drone.readOnly, true);

const manifestResult = await tools.get("evidence_validate_manifest").execute("manifest", {
	manifest: {
		version: 1,
		entries: [
			{
				artifactId: "one",
				versionId: "one-v1",
				path: "input.txt",
				bytes: 5,
				sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
				role: "input",
				parentVersionIds: [],
			},
		],
	},
});
assert.equal(manifestResult.details.valid, true);

const dist = await readFile(join(root, "dist/index.mjs"), "utf8");
assert(!dist.includes("@drone/backend"));
assert(!dist.includes("electron"));
assert(!dist.includes("node:fs"));
assert(!dist.includes("../../"));
console.log("pi-evidence registration and read-only boundary smoke passed");
