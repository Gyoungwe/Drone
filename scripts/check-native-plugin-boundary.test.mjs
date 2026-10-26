import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { inventoryNativePluginBoundary, packageEdges } from "./check-native-plugin-boundary.mjs";

test("ownership imports distinguish runtime, type imports and reexports without matching comments", () => {
	const edges = packageEdges(
		`
// import hidden from '@gyoungwe/pi-research';
import type { Note } from '@gyoungwe/pi-knowledge/host';
import { type Task } from '@drone/tasks';
export type { Result } from '@drone/research';
export { lookup } from '@gyoungwe/pi-knowledge/host';
const plugin = import('@gyoungwe/pi-analysis');
const core = require('@gyoungwe/pi-core');
type Knowledge = import('@gyoungwe/pi-knowledge').Knowledge;
import { contract } from '@gyoungwe/plugin-api';
`,
		"host.ts",
	);
	assert.deepEqual(
		edges.map(({ kind }) => kind),
		[
			"domain-type-import",
			"domain-type-import",
			"domain-type-import",
			"domain-runtime-import",
			"domain-runtime-import",
			"domain-runtime-import",
			"domain-type-import",
		],
	);
});

test("a host requiring domain packages cannot receive a clean static result", (context) => {
	const root = mkdtempSync(join(tmpdir(), "drone-boundary-inventory-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	function write(file, contents) {
		mkdirSync(dirname(join(root, file)), { recursive: true });
		writeFileSync(join(root, file), contents);
	}
	write("package.json", JSON.stringify({ scripts: { prebuild: "npm run fetch:plugins" } }));
	write("packages/backend/package.json", JSON.stringify({ dependencies: { "@gyoungwe/pi-knowledge": "*" } }));
	write("packages/desktop/package.json", "{}");
	write("packages/backend/src/service.ts", "export { run } from '@drone/tasks/runtime';");
	write(
		"plugins.lock.json",
		JSON.stringify({ plugins: [{ name: "@gyoungwe/pi-analysis", version: "0.1.2", commit: "fixture" }] }),
	);
	write("packages/desktop/electron-builder.yml", "extraResources:\n  - from: '../../.pi/extensions'\n");
	const report = inventoryNativePluginBoundary(root);
	assert.equal(report.status, "INCOMPLETE");
	assert.deepEqual(report.counts, {
		"domain-build-step": 1,
		"domain-manifest-dependency": 1,
		"domain-runtime-import": 1,
		"domain-packaged-resource": 1,
		"required-domain-plugin": 1,
	});
	for (const file of ["package.json", "packages/backend/package.json", "packages/desktop/package.json"])
		write(file, "{}");
	write("packages/backend/src/service.ts", "export const generic = true;");
	write("plugins.lock.json", '{"plugins":[]}');
	write("packages/desktop/electron-builder.yml", "files: [out/**]\n");
	const clear = inventoryNativePluginBoundary(root);
	assert.equal(clear.status, "STATIC_CLEAR_RUNTIME_UNVERIFIED");
	assert.equal(clear.runtimeAcceptance, "NOT_RUN");
});
