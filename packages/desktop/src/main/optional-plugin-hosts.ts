import { readdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface PluginHostLoaderDiscovery {
	readonly capability: string;
	readonly exportName: string;
	readonly packageName: string;
	readonly packageRoot: string;
	readonly entrypoint: string;
}

interface PluginManifest {
	capabilities?: unknown;
	hosts?: unknown;
	entrypoints?: { host?: unknown };
}

/** Discover a host adapter from installed package declarations, without naming a package. */
export async function discoverPluginHostLoader<T>(options: {
	packageRoots: readonly string[];
	capability: string;
	exportName?: string;
}): Promise<{ loader: T; discovery: PluginHostLoaderDiscovery } | undefined> {
	const exportName = options.exportName ?? `${options.capability}HostLoader`;
	for (const root of options.packageRoots) {
		for (const packageRoot of await packageDirectories(root)) {
			const manifest = await readManifest(join(packageRoot, "plugin.manifest.json"));
			if (!manifest || !declaresCapability(manifest, options.capability)) continue;
			const declaredEntrypoint = manifest.entrypoints?.host;
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
				discovery: {
					capability: options.capability,
					exportName,
					packageName: await packageName(packageRoot),
					packageRoot,
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

async function readManifest(path: string): Promise<PluginManifest | undefined> {
	const text = await readFile(path, "utf8").catch(() => undefined);
	if (!text) return undefined;
	try {
		return JSON.parse(text) as PluginManifest;
	} catch {
		return undefined;
	}
}

function declaresCapability(manifest: PluginManifest, capability: string): boolean {
	return (
		Array.isArray(manifest.hosts) &&
		manifest.hosts.includes("drone-desktop") &&
		Array.isArray(manifest.capabilities) &&
		manifest.capabilities.includes(capability)
	);
}

async function packageName(root: string): Promise<string> {
	const text = await readFile(join(root, "package.json"), "utf8").catch(() => undefined);
	if (text) {
		try {
			const name = (JSON.parse(text) as { name?: unknown }).name;
			if (typeof name === "string" && name.length > 0) return name;
		} catch {
			// Discovery can still identify an installed package by its directory.
		}
	}
	return basename(root);
}
