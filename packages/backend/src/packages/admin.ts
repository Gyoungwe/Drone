import { lstatSync } from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { PackageLifecycleReceipt } from "@drone/shared";
import type { PackageSource } from "@earendil-works/pi-coding-agent";
import { JsonStore } from "../json-store";
import type { PackageReplacementDisk, PackageSelection } from "../services/package-replacement";
import { type PackageManager, PackageService, type PackageServiceDependencies } from "../services/packages";
import { DefaultPackageManager, getAgentDir, SettingsManager } from "../session-engine/sdk";

type PackageSettings = { packages?: PackageSource[] };
type NpmSettings = { name?: string; private?: boolean; dependencies?: Record<string, string> };

function configuredDependency({ dependencies }: NpmSettings, name: string): string | undefined {
	return dependencies && Object.hasOwn(dependencies, name) ? dependencies[name] : undefined;
}

function createDefaultPackageManager(cwd: string): PackageManager {
	const agentDir = getAgentDir();
	const settingsManager = SettingsManager.create(cwd, agentDir);
	return Object.assign(new DefaultPackageManager({ cwd, agentDir, settingsManager }), {
		refresh: () => settingsManager.reload(),
		prepareReplacement: (receipt: PackageLifecycleReceipt) =>
			prepareReplacement(cwd, agentDir, settingsManager, receipt),
	});
}

function directNpmEntry(entry: PackageSource, name: string): boolean {
	const source = typeof entry === "string" ? entry : entry.source;
	return source === `npm:${name}` || source.startsWith(`npm:${name}@`);
}

function configuredNpmEntry(settings: PackageSettings, name: string): PackageSource | undefined {
	const matches = (settings.packages ?? []).filter((entry) => directNpmEntry(entry, name));
	if (matches.length > 1) throw new Error("Package selection is ambiguous");
	return matches[0];
}

function selectionStores(directory: string, npmRoot: string, name: string) {
	const settingsPath = join(directory, "settings.json");
	const npmPath = join(npmRoot, "package.json");
	for (const path of [settingsPath, npmPath]) {
		const stat = lstatSync(path, { throwIfNoEntry: false });
		if (stat && !stat.isFile()) throw new Error("Package configuration must be a regular file");
	}
	const settings = new JsonStore<PackageSettings>({
		path: settingsPath,
		storageId: "agent-settings",
		defaultValue: () => ({}),
		mode: 0o600,
		parse: (raw) => JSON.parse(raw.replace(/^\uFEFF/u, "")) as PackageSettings,
	});
	const npm = new JsonStore<NpmSettings>({
		path: npmPath,
		storageId: "agent-npm-packages",
		defaultValue: () => ({ name: "pi-extensions", private: true }),
	});
	return { settings, npm, name };
}

async function configure(
	{ settings, npm, name }: ReturnType<typeof selectionStores>,
	expected: PackageSelection,
	selection: PackageSelection,
): Promise<void> {
	if (expected.dependency !== selection.dependency) {
		await npm.update((manifest) => {
			if (configuredDependency(manifest, name) !== expected.dependency)
				throw new Error("Npm selection changed externally");
			const dependencies = { ...manifest.dependencies };
			if (selection.dependency === undefined) delete dependencies[name];
			manifest.dependencies =
				selection.dependency === undefined ? dependencies : { ...dependencies, [name]: selection.dependency };
		});
	}
	if (!isDeepStrictEqual(expected.entry, selection.entry)) {
		await settings.update((current) => {
			if (!isDeepStrictEqual(configuredNpmEntry(current, name), expected.entry))
				throw new Error("Configured package changed externally");
			const packages = current.packages ?? [];
			const index = packages.findIndex((entry) => directNpmEntry(entry, name));
			const next = selection.entry;
			if (index === -1 && next !== undefined) packages.push(next);
			else if (index !== -1) packages.splice(index, 1, ...(next === undefined ? [] : [next]));
			current.packages = packages;
		});
	}
}

async function prepareReplacement(
	cwd: string,
	agentDir: string,
	settingsManager: SettingsManager,
	{ packageName, scope, source }: PackageLifecycleReceipt,
): Promise<PackageReplacementDisk> {
	if (scope === "project" && !settingsManager.isProjectTrusted()) throw new Error("Project is not trusted");
	const projectDirectory = scope === "project" ? join(await realpath(cwd), ".pi") : undefined;
	const configDirectory = projectDirectory ?? agentDir;
	await mkdir(configDirectory, { recursive: true, mode: 0o700 });
	const directory = await realpath(configDirectory);
	if (projectDirectory && directory !== projectDirectory)
		throw new Error("Project configuration is redirected");
	const npmRoot = join(directory, "npm");
	await mkdir(npmRoot, { recursive: true, mode: 0o700 });
	if ((await realpath(npmRoot)) !== npmRoot) throw new Error("Managed npm root is redirected");
	const stores = selectionStores(directory, npmRoot, packageName);
	return {
		modules: join(npmRoot, "node_modules"),
		stage: (staging) => stageNpmPackage(staging, settingsManager, source),
		read: () => {
			const entry = configuredNpmEntry(stores.settings.readStrictSync(), packageName);
			const dependency = configuredDependency(stores.npm.readStrictSync(), packageName);
			return {
				...(entry === undefined ? {} : { entry }),
				...(dependency === undefined ? {} : { dependency }),
			};
		},
		configure: async (expected, selected) => {
			await configure(stores, expected, selected);
			await settingsManager.reload();
		},
	};
}

async function stageNpmPackage(directory: string, settings: SettingsManager, source: string): Promise<void> {
	const isolated = SettingsManager.inMemory({
		npmCommand: [
			...(settings.getNpmCommand() ?? ["npm"]),
			"--install-strategy=nested",
			"--no-audit",
			"--no-fund",
		],
	});
	await new DefaultPackageManager({ cwd: directory, agentDir: directory, settingsManager: isolated }).install(
		source,
	);
}

/**
 * @deprecated Import PackageService from `../services/packages` and inject a
 * package-manager factory instead. This adapter keeps the Pi SDK construction
 * in the existing R1 compatibility location during the v2 migration.
 */
export class PackageAdmin extends PackageService {
	constructor(
		deps: Omit<PackageServiceDependencies, "packageManagerFactory"> & {
			packageManagerFactory?: PackageServiceDependencies["packageManagerFactory"];
		},
	) {
		super({ ...deps, packageManagerFactory: deps.packageManagerFactory ?? createDefaultPackageManager });
	}
}

export {
	isNpmSpawnEnoent,
	NPM_NOT_FOUND_SENTINEL,
} from "../services/packages";
