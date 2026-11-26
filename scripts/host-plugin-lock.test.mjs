import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { validatePluginsLockV2 } from "./fetch-plugins-release.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function checkLockedInstalls(packages, plugins, integrities) {
	const byName = new Map(plugins.map((plugin) => [plugin.name, plugin]));
	for (const plugin of plugins) {
		assert.ok(packages[`node_modules/${plugin.name}`], `${plugin.name} missing from npm lock`);
	}
	for (const [path, entry] of Object.entries(packages)) {
		const pathName = path.match(/(?:^|\/)node_modules\/(@gyoungwe\/pi-[^/]+)$/u)?.[1];
		const plugin = byName.get(pathName) ?? byName.get(entry.name);
		if (!plugin) continue;
		assert.equal(entry.resolved, plugin.tarballUrl, path);
		assert.equal(entry.version, plugin.version, path);
		assert.equal(entry.integrity, integrities.get(plugin.name), path);
	}
}

test("host npm pins and every locked install use verified Release bytes", async () => {
	const root = new URL("../", import.meta.url);
	const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));
	const plugins = validatePluginsLockV2(await readJson("plugins.lock.json"));
	const { packages } = await readJson("package-lock.json");
	const byName = new Map(plugins.map((plugin) => [plugin.name, plugin]));
	for (const [workspace, section, slugs] of [
		["", "devDependencies", ["pi-core", "pi-knowledge", "pi-research"]],
		["packages/backend", "devDependencies", ["pi-analysis", "pi-knowledge", "pi-research"]],
		["packages/extensions", "dependencies", ["pi-knowledge", "pi-research"]],
	]) {
		const manifest = await readJson(`${workspace || "."}/package.json`);
		for (const slug of slugs) {
			const name = `@gyoungwe/${slug}`;
			const { tarballUrl } = byName.get(name);
			assert.equal(manifest[section]?.[name], tarballUrl, `${workspace}:${name} manifest`);
			assert.equal(packages[workspace]?.[section]?.[name], tarballUrl, `${workspace}:${name} npm snapshot`);
		}
	}
	const integrities = new Map();
	for (const plugin of plugins) {
		const bytes = await readFile(
			new URL(`vendor/plugins/.tarballs/${plugin.slug}-${plugin.tarballSha256}.tgz`, root),
		);
		assert.equal(digest(bytes), plugin.tarballSha256, plugin.name);
		integrities.set(plugin.name, `sha512-${createHash("sha512").update(bytes).digest("base64")}`);
	}
	checkLockedInstalls(packages, plugins, integrities);
});

test("host lock guard rejects registry copies and permits unrelated bundled or optional entries", () => {
	const [plugin] = validatePluginsLockV2({
		version: 2,
		consumerCommit: "c".repeat(40),
		plugins: [
			{
				name: "@gyoungwe/pi-core",
				version: "0.3.0",
				repo: "https://github.com/Gyoungwe/drone-plugins.git",
				commit: "a".repeat(40),
				path: "packages/pi-core",
				tarballSha256: "b".repeat(64),
			},
		],
	});
	const integrities = new Map([[plugin.name, "sha512-verified"]]);
	const entry = {
		version: plugin.version,
		resolved: plugin.tarballUrl,
		integrity: integrities.get(plugin.name),
	};
	const packages = {
		[`node_modules/${plugin.name}`]: entry,
		"node_modules/@gyoungwe/pi-connectors": { optional: true },
		"node_modules/@gyoungwe/pi-evidence": { inBundle: true },
		"node_modules/other/node_modules/@gyoungwe/plugin-api": { inBundle: true },
	};
	checkLockedInstalls(packages, [plugin], integrities);
	for (const path of [
		`node_modules/${plugin.name}`,
		`node_modules/other/node_modules/${plugin.name}`,
		"node_modules/alias",
	]) {
		const registryEntry = { ...entry, name: plugin.name, resolved: "https://registry.npmjs.org/old.tgz" };
		assert.throws(
			() => checkLockedInstalls({ ...packages, [path]: registryEntry }, [plugin], integrities),
			/old.tgz/u,
		);
	}
});
