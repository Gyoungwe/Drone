import { type Dirent, existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DronePackageManifest, PiPackageManifest } from "@drone/shared";

/** One package found in an install root. */
export interface ScannedPackage {
	readonly name: string;
	readonly version: string;
	readonly description?: string;
	readonly packageRoot: string;
	readonly packageJson?: PiPackageManifest;
	readonly manifest?: DronePackageManifest;
}

/**
 * The `node_modules` directories above this module, nearest first.
 *
 * A host that runs from a checkout has one at the repository root; a host that
 * runs from an app bundle has none worth reading. Scanning the chain covers
 * the checkout without the host naming any package.
 */
export function moduleNodeModulesRoots(moduleUrl: string): string[] {
	const roots: string[] = [];
	let current = dirname(fileURLToPath(moduleUrl));
	for (let i = 0; i < 8; i++) {
		roots.push(join(current, "node_modules"));
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return roots;
}

/**
 * Pi's user package manager installs into `<agentDir>/npm/node_modules`.
 *
 * The host reads that root because it is where the user's own installs live,
 * not because it knows which packages are expected there.
 */
export function managedAgentPackageRoot(): string {
	const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	return join(agentDir, "npm", "node_modules");
}

/**
 * The install roots inside a packaged application.
 *
 * A packaged host keeps its read-only built-in packages beside the app, not
 * inside it: the asar holds only the plugin API. The resources directory is
 * therefore a root of its own, and it is absent in a checkout.
 */
export function packagedResourceRoots(): string[] {
	const resourcesPath = (process as NodeJS.Process & { readonly resourcesPath?: string }).resourcesPath;
	if (!resourcesPath) return [];
	return [
		join(resourcesPath, "plugin-packages", "node_modules"),
		join(resourcesPath, "pi-packages", "node_modules"),
	];
}

function readJson(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as unknown;
	} catch {
		return undefined;
	}
}

/** The package directories inside one `node_modules` root, scoped names included. */
function packageDirectories(root: string): { name: string; path: string }[] {
	let entries: Dirent[];
	try {
		entries = readdirSync(root, { withFileTypes: true });
	} catch {
		return [];
	}
	const found: { name: string; path: string }[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
		const path = join(root, entry.name);
		if (!entry.name.startsWith("@")) {
			found.push({ name: entry.name, path });
			continue;
		}
		let scoped: Dirent[];
		try {
			scoped = readdirSync(path, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const child of scoped) {
			if (!child.isDirectory()) continue;
			found.push({ name: `${entry.name}/${child.name}`, path: join(path, child.name) });
		}
	}
	return found;
}

/**
 * Read a package's own declaration.
 *
 * A Drone plugin ships `plugin.manifest.json`; a UI-only pack ships the
 * descriptor of its own entrypoint instead. Both are the package's statement
 * about itself, so the host reads them rather than assuming.
 */
export function readPackageManifest(root: string): DronePackageManifest | undefined {
	const manifestPath = join(root, "plugin.manifest.json");
	if (existsSync(manifestPath)) {
		const parsed = readJson(manifestPath);
		return parsed === undefined ? undefined : (parsed as DronePackageManifest);
	}
	const uiManifestPath = join(root, "ui", "plugin.json");
	if (!existsSync(uiManifestPath)) return undefined;
	const parsed = readJson(uiManifestPath) as { version?: unknown } | undefined;
	if (!parsed) return undefined;
	return {
		...(typeof parsed.version === "string" ? { version: parsed.version } : {}),
		entrypoints: { ui: "./ui/plugin.json" },
		capabilities: ["ui"],
		hosts: ["drone-desktop"],
	};
}

/**
 * Whether a package ships a worker of its own.
 *
 * A worker is a separate process the host starts and therefore has to track:
 * its version, its staged state and the failure that stopped it. The package
 * says so by declaring the entrypoint; the host does not look for a name.
 */
export function declaresWorker(manifest: DronePackageManifest | undefined): boolean {
	return typeof manifest?.entrypoints?.worker === "string" && manifest.entrypoints.worker.length > 0;
}

/**
 * Scan install roots for installed packages.
 *
 * Roots are read in order and the first root that provides a package name
 * wins, so a host can put its read-only built-in copies ahead of the roots a
 * user installs into.
 */
export function scanInstalledPackages(roots: readonly string[]): Map<string, ScannedPackage> {
	const found = new Map<string, ScannedPackage>();
	for (const root of roots) {
		for (const directory of packageDirectories(root)) {
			const packageJson = readJson(join(directory.path, "package.json")) as PiPackageManifest | undefined;
			const name =
				typeof packageJson?.name === "string" && packageJson.name.length > 0
					? packageJson.name
					: directory.name;
			if (found.has(name)) continue;
			const manifest = readPackageManifest(directory.path);
			found.set(name, {
				name,
				version: typeof packageJson?.version === "string" ? packageJson.version : "unknown",
				...(typeof packageJson?.description === "string" ? { description: packageJson.description } : {}),
				packageRoot: directory.path,
				...(packageJson ? { packageJson } : {}),
				...(manifest ? { manifest } : {}),
			});
		}
	}
	return found;
}
