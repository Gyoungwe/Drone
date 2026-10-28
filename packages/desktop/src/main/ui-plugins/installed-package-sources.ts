import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
	PluginRecordAdoptionDeclaration,
	PluginRecordAdoptions,
	PluginServiceProvision,
	PluginServiceRequirement,
} from "@gyoungwe/plugin-api/runtime";
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
	provides?: Readonly<Record<string, PluginServiceProvision>>;
	requires?: Readonly<Record<string, PluginServiceRequirement>>;
	recordAdoptions?: PluginRecordAdoptions;
	packageRoot: string;
	installationPath: string;
	nativeDeclaredPath?: string;
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

function serviceMap(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error(`${field} must be an object`);
	return value as Record<string, unknown>;
}
function serviceName(value: unknown, field: string): string {
	if (typeof value !== "string" || value.length === 0 || value.length > 128)
		throw new Error(`${field} must be a nonempty string of at most 128 characters`);
	return value;
}
function serviceVersion(value: unknown, field: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 1)
		throw new Error(`${field} must be a positive safe integer`);
	return value as number;
}
function installedServices(declarations: { provides?: unknown; requires?: unknown }) {
	const services: Pick<InstalledUiRuntimeSource, "provides" | "requires"> = {};
	if (declarations.provides !== undefined) {
		const provided: [string, PluginServiceProvision][] = [];
		for (const [name, value] of Object.entries(serviceMap(declarations.provides, "drone.provides"))) {
			const field = `drone.provides.${serviceName(name, "service name")}`;
			const record = serviceMap(value, field);
			if (Object.keys(record).some((key) => !["version", "operations"].includes(key)))
				throw new Error(`${field} only accepts version and operations`);
			if (!Array.isArray(record.operations) || record.operations.length === 0)
				throw new Error(`${field}.operations must be a nonempty array`);
			const operations = record.operations.map((item) => serviceName(item, `${field}.operations`));
			if (new Set(operations).size !== operations.length)
				throw new Error(`${field}.operations must be unique`);
			provided.push([
				name,
				{
					version: serviceVersion(record.version, `${field}.version`),
					operations: Object.freeze(operations),
				},
			]);
		}
		services.provides = Object.freeze(Object.fromEntries(provided));
	}
	if (declarations.requires !== undefined) {
		const required: [string, PluginServiceRequirement][] = [];
		for (const [alias, value] of Object.entries(serviceMap(declarations.requires, "drone.requires"))) {
			const field = `drone.requires.${serviceName(alias, "service alias")}`;
			const record = serviceMap(value, field);
			if (Object.keys(record).some((key) => !["service", "version"].includes(key)))
				throw new Error(`${field} only accepts service and version`);
			required.push([
				alias,
				{
					service: serviceName(record.service, `${field}.service`),
					version: serviceVersion(record.version, `${field}.version`),
				},
			]);
		}
		services.requires = Object.freeze(Object.fromEntries(required));
	}
	return services;
}

function stableAdoptionVersion(value: unknown, field: string): string {
	const version = serviceName(value, field);
	if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version))
		throw new Error(`${field} must be an exact stable version`);
	return version;
}
function installedRecordAdoptions(value: unknown, packageVersion: unknown): PluginRecordAdoptions {
	const current = stableAdoptionVersion(packageVersion, "package version for record adoption")
		.split(".")
		.map(BigInt);
	const adoptions: [string, PluginRecordAdoptionDeclaration][] = [];
	for (const [type, raw] of Object.entries(serviceMap(value, "drone.recordAdoptions"))) {
		const field = `drone.recordAdoptions.${serviceName(type, "adoption logical type")}`;
		const record = serviceMap(raw, field);
		if (
			Object.keys(record).some((key) => !["legacyType", "fromVersions", "removeBeforeVersion"].includes(key))
		)
			throw new Error(`${field} only accepts legacyType, fromVersions and removeBeforeVersion`);
		const legacyType = serviceName(record.legacyType, `${field}.legacyType`);
		if (legacyType.startsWith("plugin-record:") || legacyType.startsWith("plugin-notice:"))
			throw new Error(`${field}.legacyType cannot import a source-owned namespace`);
		if (!Array.isArray(record.fromVersions) || record.fromVersions.length === 0)
			throw new Error(`${field}.fromVersions must list supported exact migrator versions`);
		const fromVersions = record.fromVersions.map((item) =>
			stableAdoptionVersion(item, `${field}.fromVersions`),
		);
		if (new Set(fromVersions).size !== fromVersions.length)
			throw new Error(`${field}.fromVersions must be unique`);
		const removeBeforeVersion = stableAdoptionVersion(
			record.removeBeforeVersion,
			`${field}.removeBeforeVersion`,
		);
		const removal = removeBeforeVersion.split(".").map(BigInt);
		const differing = current.findIndex((part, index) => part !== removal[index]);
		if (differing === -1 || (current[differing] as bigint) > (removal[differing] as bigint))
			throw new Error(`${field} must be removed before package version ${removeBeforeVersion}`);
		adoptions.push([type, { legacyType, fromVersions: Object.freeze(fromVersions), removeBeforeVersion }]);
	}
	return Object.freeze(Object.fromEntries(adoptions));
}

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
						drone?: {
							deliveryProjection?: unknown;
							provides?: unknown;
							requires?: unknown;
							recordAdoptions?: unknown;
						};
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
					installationPath: resolve(packageDir),
					entrypoint,
					contentHash: installedPackageHash(packageRoot),
				};
				if (manifest.drone?.deliveryProjection !== undefined) {
					if (manifest.drone.deliveryProjection !== "required")
						throw new Error("drone.deliveryProjection must be required when declared");
					runtime.deliveryProjection = "required";
				}
				Object.assign(runtime, installedServices(manifest.drone ?? {}));
				if (manifest.drone?.recordAdoptions !== undefined)
					runtime.recordAdoptions = installedRecordAdoptions(
						manifest.drone.recordAdoptions,
						packageJson?.version,
					);
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
					runtime.nativeDeclaredPath = resolve(packageDir, manifest.entrypoints.extension as string);
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
		if ((manifest.drone?.provides !== undefined || manifest.drone?.requires !== undefined) && !runtime) {
			discoveries.push({ packageName, error: "drone service declarations require a desktopRuntime owner" });
			continue;
		}
		if (manifest.drone?.recordAdoptions !== undefined && !runtime) {
			discoveries.push({ packageName, error: "drone.recordAdoptions requires a desktopRuntime owner" });
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
