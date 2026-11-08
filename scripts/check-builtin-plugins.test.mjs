import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { verifyBuiltinPackages } from "./check-builtin-plugins.mjs";

const roots = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A repo with one built-in (core) and one ordinary (other) locked plugin, staged as fetch-plugins does. */
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "drone-builtin-check-"));
	roots.push(root);
	const plugins = [
		{ name: "@scope/core", commit: "c1", version: "1.0.0", tarballSha256: "a1", builtin: true },
		{ name: "@scope/other", commit: "c2", version: "2.0.0", tarballSha256: "a2" },
	];
	writeFileSync(join(root, "plugins.lock.json"), JSON.stringify({ version: 1, plugins }));
	for (const plugin of plugins) {
		const vendor = join(root, "vendor/plugins", plugin.name.split("/")[1]);
		mkdirSync(join(vendor, "dist"), { recursive: true });
		writeFileSync(
			join(vendor, "package.json"),
			JSON.stringify({ name: plugin.name, version: plugin.version }),
		);
		writeFileSync(join(vendor, "dist/index.mjs"), "export default 1;\n");
		writeFileSync(
			join(vendor, ".drone-fetch.json"),
			JSON.stringify({ commit: plugin.commit, sha256: plugin.tarballSha256 }),
		);
	}
	const nodeModules = join(root, "staged/node_modules");
	mkdirSync(join(nodeModules, "@scope"), { recursive: true });
	cpSync(join(root, "vendor/plugins/core"), join(nodeModules, "@scope/core"), { recursive: true });
	return { root, nodeModules, core: join(nodeModules, "@scope/core") };
}

test("a staged built-in identical to its locked vendor copy passes", () => {
	const { root, nodeModules } = fixture();
	assert.deepEqual(verifyBuiltinPackages(nodeModules, root), { "@scope/core": "1.0.0" });
});

test("changed, missing or extra files in a built-in fail", () => {
	const changed = fixture();
	writeFileSync(join(changed.core, "dist/index.mjs"), "export default 2;\n");
	assert.throws(() => verifyBuiltinPackages(changed.nodeModules, changed.root), /dist\/index\.mjs differs/);
	const extra = fixture();
	writeFileSync(join(extra.core, "dist/extra.mjs"), "");
	assert.throws(() => verifyBuiltinPackages(extra.nodeModules, extra.root), /file list differs/);
});

test("a package that is not a locked built-in, or a missing built-in, fails", () => {
	const extra = fixture();
	cpSync(join(extra.root, "vendor/plugins/other"), join(extra.nodeModules, "@scope/other"), {
		recursive: true,
	});
	assert.throws(() => verifyBuiltinPackages(extra.nodeModules, extra.root), /exactly the built-in packages/);
	const missing = fixture();
	rmSync(missing.core, { recursive: true });
	assert.throws(
		() => verifyBuiltinPackages(missing.nodeModules, missing.root),
		/exactly the built-in packages/,
	);
});

test("a vendor copy whose fetch receipt differs from the lock fails", () => {
	const { root, nodeModules } = fixture();
	for (const dir of [join(root, "vendor/plugins/core"), join(nodeModules, "@scope/core")])
		writeFileSync(join(dir, ".drone-fetch.json"), JSON.stringify({ commit: "c1", sha256: "other" }));
	assert.throws(() => verifyBuiltinPackages(nodeModules, root), /not the locked artifact/);
});
