// Verify the read-only built-in plugin packages Drone ships: plugins.lock.json entries marked
// `builtin: true`, staged by fetch-plugins.mjs and copied to <resources>/plugin-packages/node_modules.
//
//   node scripts/check-builtin-plugins.mjs                    builder mapping + staged copies
//   node scripts/check-builtin-plugins.mjs --packaged <dist>  the same against every packaged app in <dist>
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { isMainModule } from "./is-main-module.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const BUILTIN_PACKAGES_DIR = join(root, "packages/desktop/plugin-packages/node_modules");

function tree(directory, base = directory, out = new Map()) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		assert(!entry.isSymbolicLink(), `built-in package contains a symlink: ${path}`);
		if (entry.isDirectory()) tree(path, base, out);
		else out.set(relative(base, path).replaceAll("\\", "/"), readFileSync(path));
	}
	return out;
}

function installedNames(nodeModules) {
	if (!existsSync(nodeModules)) return [];
	return readdirSync(nodeModules).flatMap((name) =>
		name.startsWith("@") ? readdirSync(join(nodeModules, name)).map((child) => `${name}/${child}`) : [name],
	);
}

/** Every shipped built-in is byte-identical to its lock-verified vendor copy, and nothing else ships. */
export function verifyBuiltinPackages(nodeModules, repoRoot = root) {
	const lock = JSON.parse(readFileSync(join(repoRoot, "plugins.lock.json"), "utf8"));
	const builtins = lock.plugins.filter((plugin) => plugin.builtin === true);
	assert.deepEqual(
		installedNames(nodeModules).sort(),
		builtins.map((plugin) => plugin.name).sort(),
		`${nodeModules} must hold exactly the built-in packages in plugins.lock.json`,
	);
	const versions = {};
	for (const plugin of builtins) {
		const vendor = join(repoRoot, "vendor/plugins", plugin.name.split("/").at(-1));
		const receipt = JSON.parse(readFileSync(join(vendor, ".drone-fetch.json"), "utf8"));
		assert.deepEqual(
			receipt,
			{ commit: plugin.commit, sha256: plugin.tarballSha256 },
			`${plugin.name}: vendor copy is not the locked artifact`,
		);
		const expected = tree(vendor);
		const actual = tree(join(nodeModules, ...plugin.name.split("/")));
		assert.deepEqual(
			[...actual.keys()].sort(),
			[...expected.keys()].sort(),
			`${plugin.name}: file list differs`,
		);
		for (const [path, bytes] of expected)
			assert(bytes.equals(actual.get(path)), `${plugin.name}: ${path} differs from the locked artifact`);
		const pkg = JSON.parse(expected.get("package.json").toString("utf8"));
		assert.equal(pkg.name, plugin.name, `${plugin.name}: package name differs from the lock`);
		assert.equal(pkg.version, plugin.version, `${plugin.name}: package version differs from the lock`);
		versions[plugin.name] = pkg.version;
	}
	return versions;
}

function builderMapping() {
	const config = parse(readFileSync(join(root, "packages/desktop/electron-builder.yml"), "utf8"));
	const entry = config.extraResources.find((item) => item.from === "plugin-packages/node_modules");
	assert(entry, "electron-builder.yml must copy plugin-packages/node_modules into extraResources");
	assert.equal(
		entry.to,
		"plugin-packages/node_modules",
		"the manager scans <resources>/plugin-packages/node_modules",
	);
	assert(entry.filter?.includes("**/*"), "plugin-packages extraResources filter must include **/*");
	const source = readFileSync(join(root, "packages/desktop/src/main/ui-plugins/plugin-dirs.ts"), "utf8");
	assert.match(
		source,
		/join\(process\.resourcesPath, "plugin-packages", "node_modules"\)/,
		"the manager must resolve the shipped built-in root",
	);
}

function packagedResources(directory, depth = 0, found = []) {
	if (depth > 5 || !existsSync(directory)) return found;
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
		const path = join(directory, entry.name);
		if (/^resources$/i.test(entry.name) && existsSync(join(path, "app.asar"))) found.push(path);
		else if (!entry.name.endsWith(".asar.unpacked") && entry.name !== "node_modules")
			packagedResources(path, depth + 1, found);
	}
	return found;
}

if (isMainModule(import.meta.url)) {
	builderMapping();
	const packagedArg = process.argv.indexOf("--packaged");
	if (packagedArg >= 0) {
		const dist = resolve(process.argv[packagedArg + 1] ?? "");
		const targets = packagedResources(dist);
		assert(targets.length > 0, `no packaged app resources found under ${dist}`);
		for (const resources of targets) {
			const versions = verifyBuiltinPackages(join(resources, "plugin-packages", "node_modules"));
			console.log(`[check-builtin-plugins] ${resources}: ${JSON.stringify(versions)}`);
		}
	} else {
		console.log(
			`[check-builtin-plugins] staged ${JSON.stringify(verifyBuiltinPackages(BUILTIN_PACKAGES_DIR))}`,
		);
	}
}
