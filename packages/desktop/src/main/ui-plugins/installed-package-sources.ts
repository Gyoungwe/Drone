import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { installedPackageGraph } from "./installed-package-graph";

/**
 * Content identity for an installed package generation.
 *
 * The package manager may keep the same name, directory and entrypoint while
 * replacing a file in place.  A path-only binding would keep executing that
 * replacement.  Hash every file in the package tree (including nested
 * dependencies) with stable relative names so a later source check can revoke
 * the old binding.  Symlinks are represented by their canonical target; an
 * entrypoint/resource that escapes the package is rejected by discovery before
 * it can be activated.
 */
export function installedPackageHash(root: string): string {
	const hash = createHash("sha256");
	const canonicalRoot = realpathSync(root);
	const visited = new Set<string>();
	const walk = (directory: string, relativeDirectory: string): void => {
		const canonical = realpathSync(directory);
		if (visited.has(canonical)) return;
		visited.add(canonical);
		const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
			a.name.localeCompare(b.name),
		);
		for (const entry of entries) {
			const absolute = join(directory, entry.name);
			const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
			const stat = lstatSync(absolute);
			if (stat.isSymbolicLink()) {
				const target = realpathSync(absolute);
				hash.update(`symlink:${relativePath}\0${target}\0`);
				const targetRelative = relative(canonicalRoot, target);
				if (
					!isAbsolute(targetRelative) &&
					targetRelative !== ".." &&
					!targetRelative.startsWith(`..${sep}`)
				) {
					const targetStat = lstatSync(target);
					if (targetStat.isDirectory()) walk(target, targetRelative);
					else if (targetStat.isFile()) hash.update(readFileSync(target));
				}
				continue;
			}
			if (stat.isDirectory()) {
				walk(absolute, relativePath);
				continue;
			}
			if (stat.isFile()) hash.update(`file:${relativePath}\0`).update(readFileSync(absolute)).update("\0");
		}
	};
	walk(canonicalRoot, "");
	return hash.digest("hex");
}

export interface InstalledUiRuntimeSource {
	pluginId: string;
	contentHash: string;
	deliveryProjection?: "required";
	packageRoot: string;
	entrypoint: string;
	nativeEntrypoint?: string;
	requestsStateRead?: boolean;
	requestsStateWrite?: boolean;
	requestsFileRead?: boolean;
	requestsFileWrite?: boolean;
	requestsModel?: boolean;
	requestsExecution?: boolean;
	resources?: Readonly<Record<string, string>>;
}

export type InstalledPackageDiscovery =
	| { packageName: string; packageRoot: string; uiDir?: string; runtime?: InstalledUiRuntimeSource }
	| { packageName: string; error: string };

export type InstalledUiDiscovery =
	| (Exclude<InstalledPackageDiscovery, { error: string }> & { uiDir: string })
	| { packageName: string; error: string };

/** Resolve declarations without importing plugin code. All entries belong to one canonical package. */
async function installedRuntimeFile(packageRoot: string, value: unknown, field: string): Promise<string> {
	if (typeof value !== "string" || value.length === 0 || isAbsolute(value)) {
		throw new Error(`entrypoints.${field} must be a nonempty relative path`);
	}
	const entrypoint = await realpath(resolve(packageRoot, value));
	const entryRelative = relative(packageRoot, entrypoint);
	if (isAbsolute(entryRelative) || entryRelative === ".." || entryRelative.startsWith(`..${sep}`)) {
		throw new Error(`entrypoints.${field} escapes the installed package`);
	}
	if (!(await stat(entrypoint)).isFile()) {
		throw new Error(`entrypoints.${field} must point to a file`);
	}
	return entrypoint;
}

export async function discoverInstalledPackages(root: string): Promise<InstalledPackageDiscovery[]> {
	const graph = await installedPackageGraph(root);
	const discoveries: InstalledPackageDiscovery[] = [...graph.diagnostics];
	const packageDirs = graph.packages.map((item) => item.directory);
	const directRoots = new Set(graph.packages.filter((item) => item.direct).map((item) => item.directory));
	const versions = new Map<string, string | undefined>();

	for (const packageDir of packageDirs) {
		const packageJsonPath = join(packageDir, "package.json");
		const manifestPath = join(packageDir, "plugin.manifest.json");
		const packageJson = await readFile(packageJsonPath, "utf8")
			.then((value) => JSON.parse(value) as { name?: string; version?: string })
			.catch(() => null);
		const packageName = typeof packageJson?.name === "string" ? packageJson.name : basename(packageDir);
		versions.set(packageDir, typeof packageJson?.version === "string" ? packageJson.version : undefined);
		const manifest = await readFile(manifestPath, "utf8")
			.then(
				(value) =>
					JSON.parse(value) as {
						entrypoints?: {
							ui?: unknown;
							desktopRuntime?: unknown;
							extension?: unknown;
							resources?: unknown;
						};
						hosts?: unknown;
						drone?: { deliveryProjection?: unknown };
						permissions?: { filesystem?: unknown; network?: unknown; subprocess?: unknown };
					},
			)
			.catch(() => null);
		if (!manifest && existsSync(manifestPath)) {
			discoveries.push({ packageName, error: "plugin.manifest.json is not valid JSON" });
			continue;
		}
		if (!manifest) continue;
		if (!Array.isArray(manifest.hosts) || !manifest.hosts.includes("drone-desktop")) {
			discoveries.push({ packageName, error: "plugin.manifest.json does not declare host drone-desktop" });
			continue;
		}
		const packageRoot = await realpath(packageDir);
		let canonicalUiDir: string | undefined;
		if (manifest.entrypoints?.ui !== undefined) {
			try {
				const uiManifest = await installedRuntimeFile(packageRoot, manifest.entrypoints.ui, "ui");
				if (basename(uiManifest) !== "plugin.json")
					throw new Error("entrypoints.ui must point to plugin.json");
				canonicalUiDir = dirname(uiManifest);
			} catch (error) {
				discoveries.push({ packageName, error: `Invalid UI entrypoint: ${String(error)}` });
				continue;
			}
		}
		let runtime: InstalledUiRuntimeSource | undefined;
		const declaredRuntime = manifest.entrypoints?.desktopRuntime;
		if (declaredRuntime === undefined && manifest.entrypoints?.resources !== undefined) {
			discoveries.push({ packageName, error: "entrypoints.resources requires a desktopRuntime owner" });
			continue;
		}
		if (declaredRuntime !== undefined) {
			try {
				if (typeof packageJson?.name !== "string" || packageJson.name.length === 0) {
					throw new Error("desktopRuntime requires a package.json name");
				}
				const entrypoint = await installedRuntimeFile(packageRoot, declaredRuntime, "desktopRuntime");
				runtime = {
					pluginId: packageName,
					packageRoot,
					entrypoint,
					contentHash: installedPackageHash(packageRoot),
				};
				if (manifest.drone?.deliveryProjection !== undefined) {
					if (manifest.drone.deliveryProjection !== "required")
						throw new Error("drone.deliveryProjection must be required when declared");
					runtime.deliveryProjection = "required";
				}
				if (Array.isArray(manifest.permissions?.filesystem)) {
					const filesystem = manifest.permissions.filesystem;
					if (filesystem.includes("application-state-write")) runtime.requestsStateWrite = true;
					if (filesystem.includes("application-state") || runtime.requestsStateWrite)
						runtime.requestsStateRead = true;
					if (filesystem.includes("workspace-write") || filesystem.includes("configured-vault-write"))
						runtime.requestsFileWrite = true;
					if (
						filesystem.includes("workspace") ||
						filesystem.includes("workspace-read") ||
						filesystem.includes("configured-vault") ||
						filesystem.includes("vault-read") ||
						runtime.requestsFileWrite
					)
						runtime.requestsFileRead = true;
				}
				if (
					Array.isArray(manifest.permissions?.network) &&
					manifest.permissions.network.includes("configured-services")
				)
					runtime.requestsModel = true;
				if (
					Array.isArray(manifest.permissions?.subprocess) &&
					manifest.permissions.subprocess.includes("container")
				)
					runtime.requestsExecution = true;
				if (manifest.entrypoints?.extension !== undefined) {
					runtime.nativeEntrypoint = await installedRuntimeFile(
						packageRoot,
						manifest.entrypoints?.extension,
						"extension",
					);
				}
				const declaredResources = manifest.entrypoints?.resources;
				if (declaredResources !== undefined) {
					if (
						declaredResources === null ||
						typeof declaredResources !== "object" ||
						Array.isArray(declaredResources)
					) {
						throw new Error("entrypoints.resources must be an object mapping resource IDs to relative files");
					}
					const resources: [string, string][] = [];
					for (const [id, resource] of Object.entries(declaredResources)) {
						if (id.length === 0) throw new Error("entrypoints.resources IDs must be nonempty");
						resources.push([id, await installedRuntimeFile(packageRoot, resource, `resources.${id}`)]);
					}
					runtime.resources = Object.freeze(Object.fromEntries(resources));
				}
			} catch (error) {
				discoveries.push({ packageName, error: `Invalid desktopRuntime: ${String(error)}` });
				continue;
			}
		}
		if (manifest.drone?.deliveryProjection !== undefined && !runtime) {
			discoveries.push({ packageName, error: "drone.deliveryProjection requires a desktopRuntime owner" });
			continue;
		}
		discoveries.push({
			packageName,
			packageRoot,
			...(canonicalUiDir ? { uiDir: canonicalUiDir } : {}),
			runtime,
		});
	}
	type Source = Exclude<InstalledPackageDiscovery, { error: string }>;
	const grouped = new Map<string, [Source, ...Source[]]>();
	const output: InstalledPackageDiscovery[] = discoveries.filter((item) => "error" in item);
	for (const item of discoveries) {
		if ("error" in item) continue;
		const group = grouped.get(item.packageName);
		if (group) group.push(item);
		else grouped.set(item.packageName, [item]);
	}
	for (const [packageName, sources] of grouped) {
		if (sources.length === 1) {
			output.push(sources[0]);
			continue;
		}
		const direct = sources.find((source) => directRoots.has(source.packageRoot));
		const version = versions.get(sources[0].packageRoot);
		if (
			direct &&
			version !== undefined &&
			sources.every((source) => versions.get(source.packageRoot) === version)
		) {
			output.push(direct);
			output.push({
				packageName,
				error: `Direct installation selected; shadowed UI sources: ${sources
					.filter((source) => source !== direct)
					.map((source) => source.packageRoot)
					.join(", ")}. Equal versions do not verify equal contents.`,
			});
		} else {
			output.push({
				packageName,
				error: `Conflicting installed UI sources: ${sources.map((source) => `${source.packageRoot} (${versions.get(source.packageRoot) ?? "version undeclared"})`).join(", ")}`,
			});
		}
	}
	return output;
}

/** UI contributions are a projection of the same validated package discovery. */
export async function discoverInstalledUiPackages(root: string): Promise<InstalledUiDiscovery[]> {
	return (await discoverInstalledPackages(root)).filter(
		(item): item is InstalledUiDiscovery => "error" in item || item.uiDir !== undefined,
	);
}
