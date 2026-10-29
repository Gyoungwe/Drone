import { existsSync } from "node:fs";
import { readdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const RESOURCE_FIELDS = ["extensions", "skills", "prompts", "themes"] as const;

type PackageJson = {
	name?: unknown;
	version?: unknown;
	dependencies?: Record<string, unknown>;
	optionalDependencies?: Record<string, unknown>;
	pi?: Partial<Record<(typeof RESOURCE_FIELDS)[number], unknown>>;
};

export interface InstalledPackageGraph {
	packages: { directory: string; direct: boolean }[];
	diagnostics: { packageName: string; error: string }[];
}

function within(root: string, target: string): boolean {
	const path = relative(root, target);
	return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function packageJson(directory: string): Promise<PackageJson> {
	const manifest: unknown = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
	if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
		throw new Error("package.json must contain an object");
	}
	return manifest as PackageJson;
}

function resourceDependencies(manifest: PackageJson): string[] {
	const dependencies = { ...manifest.dependencies, ...manifest.optionalDependencies };
	const selected = new Set<string>();
	for (const field of RESOURCE_FIELDS) {
		const paths = manifest.pi?.[field];
		if (!Array.isArray(paths)) continue;
		for (const path of paths) {
			if (typeof path !== "string") continue;
			const name = /^(?:\.\/)?node_modules\/(@[^/]+\/[^/]+|[^/]+)(?:\/|$)/.exec(path)?.[1];
			if (name && PACKAGE_NAME.test(name) && typeof dependencies[name] === "string") selected.add(name);
		}
	}
	return [...selected];
}

/** Resolve only a declared dependency, following npm's nearest node_modules lookup within this install. */
async function resolveDependency(root: string, from: string, name: string): Promise<string> {
	if (!PACKAGE_NAME.test(name)) throw new Error(`Invalid dependency name: ${name}`);
	const prefix = dirname(root);
	for (let directory = from; within(prefix, directory); directory = dirname(directory)) {
		if (basename(directory) !== "node_modules") {
			const candidate = join(directory, "node_modules", name);
			if (existsSync(join(candidate, "package.json"))) {
				const canonical = await realpath(candidate);
				if (!within(root, canonical))
					throw new Error(`Dependency ${name} resolves outside the managed install`);
				return canonical;
			}
		}
		if (directory === prefix) break;
	}
	throw new Error(`Declared Pi resource dependency is not installed: ${name}`);
}

async function declaredDependency(
	root: string,
	from: string,
	name: string,
	origin: string,
	diagnostics: InstalledPackageGraph["diagnostics"],
): Promise<string | undefined> {
	try {
		return await resolveDependency(root, from, name);
	} catch (error) {
		diagnostics.push({ packageName: origin, error: String(error) });
		return undefined;
	}
}

async function installedDirectories(directory: string, diagnostics: InstalledPackageGraph["diagnostics"]) {
	try {
		return await readdir(directory, { withFileTypes: true });
	} catch (error) {
		diagnostics.push({
			packageName: basename(directory),
			error: `Cannot list installed package directory: ${String(error)}`,
		});
		return [];
	}
}

/**
 * Keep ordinary top-level UI discovery, then follow only selected aggregates' explicit Pi resource edges.
 * The npm prefix's direct dependencies and optional dependencies are installation roots. Library, peer and development dependencies
 * are never recursively scanned, and discovering a UI does not grant trust or activate native resources.
 */
export async function installedPackageGraph(inputRoot: string): Promise<InstalledPackageGraph> {
	const result: InstalledPackageGraph = { packages: [], diagnostics: [] };
	if (!existsSync(inputRoot)) return result;
	const root = await realpath(inputRoot);
	const directories: string[] = [];
	for (const entry of await installedDirectories(root, result.diagnostics)) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
		const directory = join(root, entry.name);
		if (entry.name.startsWith("@")) {
			for (const child of await installedDirectories(directory, result.diagnostics)) {
				if (child.isDirectory()) directories.push(join(directory, child.name));
			}
		} else directories.push(directory);
	}
	const selected = new Set<string>();
	const prefixManifest = join(dirname(root), "package.json");
	if (existsSync(prefixManifest)) {
		let manifest: PackageJson | undefined;
		try {
			manifest = await packageJson(dirname(root));
		} catch (error) {
			result.diagnostics.push({ packageName: "managed-installation", error: String(error) });
		}
		for (const name of Object.keys({ ...manifest?.dependencies, ...manifest?.optionalDependencies })) {
			const directory = await declaredDependency(
				root,
				dirname(root),
				name,
				"managed-installation",
				result.diagnostics,
			);
			if (directory) selected.add(directory);
		}
	}
	const seen = new Set<string>();
	for (const directory of [...directories, ...selected]) {
		if (seen.has(directory)) continue;
		seen.add(directory);
		result.packages.push({ directory, direct: selected.has(directory) });
	}
	const traversed = new Set<string>();
	const pending = [...selected];
	for (const directory of pending) {
		if (traversed.has(directory)) continue;
		traversed.add(directory);
		let manifest: PackageJson;
		try {
			manifest = await packageJson(directory);
		} catch (error) {
			result.diagnostics.push({ packageName: directory, error: String(error) });
			continue;
		}
		const identity = typeof manifest.name === "string" ? manifest.name : directory;
		for (const name of resourceDependencies(manifest)) {
			const dependency = await declaredDependency(root, directory, name, identity, result.diagnostics);
			if (!dependency) continue;
			if (!seen.has(dependency)) {
				seen.add(dependency);
				result.packages.push({ directory: dependency, direct: selected.has(dependency) });
			}
			pending.push(dependency);
		}
	}
	return result;
}
