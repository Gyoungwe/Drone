import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface PluginHostLoaderDiscovery {
	readonly capability: string;
	readonly exportName: string;
	readonly packageName: string;
	readonly packageRoot: string;
	readonly entrypoint: string;
}

export interface DiscoveredPluginHostLoader<T> {
	readonly loader: T;
	/** The declared host module, retained for optional factory exports. */
	readonly module: Readonly<Record<string, unknown>>;
	readonly discovery: PluginHostLoaderDiscovery;
}

export interface PluginHostDeclaration {
	capabilities?: unknown;
	hosts?: unknown;
	entrypoints?: { host?: unknown };
}

interface PackageJson {
	name?: unknown;
	drone?: PluginHostDeclaration;
}

const BOOT_CAPABILITIES = ["analysis", "discovery", "evidence", "knowledge", "research"];

export function requiresPluginHostRestart(
	root: string,
	scope: "user" | "project",
	loaded: readonly PluginHostLoaderDiscovery[],
	candidate?: PluginHostDeclaration,
): boolean {
	return (
		loaded.some(({ packageRoot }) => packageRoot === root) ||
		(scope === "user" &&
			candidate?.entrypoints?.host !== undefined &&
			BOOT_CAPABILITIES.some((capability) => declaresCapability(candidate, capability)))
	);
}

/** Discover a host adapter from installed package declarations, without naming a package. */
export async function discoverPluginHostLoader<T>(options: {
	packageRoots: readonly string[];
	capability: string;
	exportName?: string;
}): Promise<DiscoveredPluginHostLoader<T> | undefined> {
	const exportName = options.exportName ?? `${options.capability}HostLoader`;
	for (const root of options.packageRoots) {
		for (const packageRoot of await packageDirectories(root)) {
			const manifest = await readManifest(join(packageRoot, "plugin.manifest.json"));
			const declaration = manifest ?? (await readPackageJson(join(packageRoot, "package.json")))?.drone;
			if (!declaration || !declaresCapability(declaration, options.capability)) continue;
			const declaredEntrypoint = declaration.entrypoints?.host;
			if (typeof declaredEntrypoint !== "string" || declaredEntrypoint.length === 0) continue;
			const entrypoint = resolve(packageRoot, declaredEntrypoint);
			const entryRelative = relative(resolve(packageRoot), entrypoint);
			if (isAbsolute(entryRelative) || entryRelative === ".." || entryRelative.startsWith("..")) continue;
			if (!(await stat(entrypoint).catch(() => undefined))?.isFile()) continue;
			const module = (await import(pathToFileURL(entrypoint).href)) as Record<string, unknown>;
			const loader = module[exportName] as T | undefined;
			if (!loader) continue;
			return {
				loader,
				module,
				discovery: {
					capability: options.capability,
					exportName,
					packageName: await packageName(packageRoot),
					packageRoot: await realpath(packageRoot),
					entrypoint,
				},
			};
		}
	}
	return undefined;
}

async function packageDirectories(root: string): Promise<string[]> {
	const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
	const directories: string[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
		const path = join(root, entry.name);
		if (entry.name.startsWith("@")) {
			const scoped = await readdir(path, { withFileTypes: true }).catch(() => []);
			for (const child of scoped) if (child.isDirectory()) directories.push(join(path, child.name));
		} else directories.push(path);
	}
	return directories;
}

async function readManifest(path: string): Promise<PluginHostDeclaration | undefined> {
	const text = await readFile(path, "utf8").catch(() => undefined);
	if (!text) return undefined;
	try {
		return JSON.parse(text) as PluginHostDeclaration;
	} catch {
		return undefined;
	}
}

async function readPackageJson(path: string): Promise<PackageJson | undefined> {
	const text = await readFile(path, "utf8").catch(() => undefined);
	if (!text) return undefined;
	try {
		return JSON.parse(text) as PackageJson;
	} catch {
		return undefined;
	}
}

function declaresCapability(manifest: PluginHostDeclaration, capability: string): boolean {
	return (
		Array.isArray(manifest.hosts) &&
		manifest.hosts.includes("drone-desktop") &&
		Array.isArray(manifest.capabilities) &&
		manifest.capabilities.includes(capability)
	);
}

async function packageName(root: string): Promise<string> {
	const name = (await readPackageJson(join(root, "package.json")))?.name;
	if (typeof name === "string" && name.length > 0) return name;
	return basename(root);
}
