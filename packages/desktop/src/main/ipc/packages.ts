import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { type BackendServices, createProcessPluginRuntime, type SessionServicePort } from "@drone/backend";
import { type PackageLifecycleReceipt, PackagesContract } from "@drone/shared";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { IpcMainInvokeEvent } from "electron";
import {
	type PluginHostDeclaration,
	type PluginHostLoaderDiscovery,
	requiresPluginHostRestart,
} from "../optional-plugin-hosts";
import { latestPackageVersions, registryPluginMetadata } from "../package-versions";
import { discoverInstalledPackages } from "../ui-plugins/installed-package-sources";
import type { UiPluginManager } from "../ui-plugins/manager";
import type {
	DesktopRuntimeBridge,
	DesktopRuntimeOwner,
	DesktopRuntimeSource,
} from "../ui-plugins/runtime-bridge";
import { bindContract, type ContractImplementation } from "./bind-contract";

type MutationHost = NonNullable<Parameters<BackendServices["packages"]["updatePackage"]>[1]>;
type PackageDeclaration = PluginHostDeclaration & {
	entrypoints?: { host?: string; worker?: string; desktopRuntime?: string };
};
type PackageServices = Pick<BackendServices, "packages">;

function contains(root: string, path: string): boolean {
	const suffix = relative(root, path);
	return !isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`);
}

async function readPackageMetadata<T>(root: string, filename: string): Promise<T | undefined> {
	try {
		const value: unknown = JSON.parse(await readFile(join(root, filename), "utf8"));
		if (!value || typeof value !== "object" || Array.isArray(value))
			throw new Error("Invalid package metadata");
		return value as T;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		return undefined;
	}
}

async function verifyPackageOutputs(root: string): Promise<void> {
	const build = await readPackageMetadata<{ outputs: Record<string, unknown> }>(root, "build-manifest.json");
	if (!build) return;
	for (const [entry, expected] of Object.entries(build.outputs)) {
		const file = await realpath(join(root, entry));
		if (
			typeof expected !== "string" ||
			!/^[0-9a-f]{64}$/u.test(expected) ||
			isAbsolute(entry) ||
			!contains(root, file)
		)
			throw new Error("Invalid package output integrity declaration");
		if (
			createHash("sha256")
				.update(await readFile(file))
				.digest("hex") !== expected
		)
			throw new Error("Package output failed integrity verification");
	}
}

async function inspectPackage(
	{ modules, path, packageName, scope }: Parameters<MutationHost["inspect"]>[0],
	bootLoaders: readonly PluginHostLoaderDiscovery[],
	candidate?: boolean,
) {
	const root = await realpath(path);
	const manifest =
		(await readPackageMetadata<PackageDeclaration>(root, "plugin.manifest.json")) ??
		(await readPackageMetadata<{ drone?: PackageDeclaration }>(root, "package.json"))?.drone;
	const { host, worker, desktopRuntime } = manifest?.entrypoints ?? {};
	const found = await discoverInstalledPackages(modules);
	const sources = found.flatMap((entry) =>
		"error" in entry || !entry.runtime || !contains(root, entry.packageRoot) ? [] : [entry.runtime],
	);
	if (
		desktopRuntime !== undefined &&
		!sources.some((source) => source.pluginId === packageName && source.packageRoot === root)
	)
		throw new Error("The declared package worker could not be verified");
	for (const entry of [host, worker]) {
		if (entry === undefined) continue;
		const file = await realpath(join(root, entry));
		if (isAbsolute(entry) || !contains(root, file) || !(await stat(file)).isFile())
			throw new Error("Invalid package worker entrypoint");
	}
	for (const source of sources) await verifyPackageOutputs(source.packageRoot);
	if (!sources.length && (host || worker)) await verifyPackageOutputs(root);
	return {
		sources,
		restart: requiresPluginHostRestart(root, scope, bootLoaders, candidate ? manifest : undefined),
	};
}

export function packageMutationHost(
	manager: UiPluginManager,
	runtime: DesktopRuntimeBridge,
	owner: DesktopRuntimeOwner,
	runtimeDirectory: string,
	bootLoaders: readonly PluginHostLoaderDiscovery[] = [],
): MutationHost {
	return {
		inspect: (location, candidate) => inspectPackage(location, bootLoaders, candidate),
		transition: ({ path }, previous, action) =>
			runtime.withPackageTransition(
				path,
				(source) =>
					contains(path, source.packageRoot) ||
					previous.some((item) => item.packageRoot === source.packageRoot),
				owner,
				action,
			),
		probe: async (sources, directory, occupiedTools, quarantine) => {
			const names = new Set(occupiedTools);
			for (const source of sources) {
				const current = () => manager.runtimeSourceCurrent(source);
				const registry = runtime.packageProbeRegistry(source, owner, current);
				await verifyCandidateWorker(
					registry,
					source,
					names,
					async () => {
						for (const entrypoint of Object.values(source.resources ?? {})) {
							if (!current()) throw new Error("Candidate source changed");
							await probeResource(source, entrypoint, directory, runtimeDirectory, quarantine);
						}
					},
					quarantine,
				);
			}
		},
		rescan: async ({ scope, modules }) => {
			await manager.scanAll(scope === "project" ? modules : undefined);
		},
	};
}

async function verifyCandidateWorker(
	registry: ReturnType<DesktopRuntimeBridge["packageProbeRegistry"]>,
	source: DesktopRuntimeSource,
	names: Set<string>,
	readiness: () => Promise<void>,
	quarantine: () => void,
): Promise<void> {
	const { pluginId } = source;
	try {
		await registry
			.activate(pluginId, () => undefined)
			.catch((error: unknown) => {
				if (error instanceof AggregateError) quarantine();
				throw error;
			});
		if (source.nativeEntrypoint) {
			const native = await registry.attachNative(pluginId, () => undefined, undefined, {
				kind: "primary",
				readOnly: false,
			});
			await native.extension(nativeRegistrationProbe(names));
		}
		await readiness();
	} finally {
		await registry.deactivate(pluginId).catch((error: unknown) => {
			quarantine();
			throw error;
		});
	}
}

function nativeRegistrationProbe(names: Set<string>): ExtensionAPI {
	const registerTool: ExtensionAPI["registerTool"] = ({ name }) => {
		if (names.has(name)) throw new Error("Candidate native tool conflicts with the SDK scope");
		names.add(name);
	};
	const probe: Pick<ExtensionAPI, "registerTool" | "registerCommand" | "on" | "events"> = {
		registerTool,
		registerCommand: () => undefined,
		on: () => () => undefined,
		events: { emit: () => undefined, on: () => () => undefined },
	};
	return probe as ExtensionAPI;
}

async function probeResource(
	source: DesktopRuntimeSource,
	entrypoint: string,
	directory: string,
	runtimeDirectory: string,
	quarantine: () => void,
): Promise<void> {
	const storageDirectory = await mkdtemp(join(directory, "readiness-"));
	const abort = new AbortController();
	const capabilities = {
		call: async () => {
			throw new Error("Candidate probe has no data grants");
		},
	};
	const instance = await createProcessPluginRuntime({
		pluginId: source.pluginId,
		entrypoint,
		packageRoot: source.packageRoot,
		runtimeDirectory,
		resource: { storageDirectory, parameters: {} },
	})({
		applicationId: randomUUID(),
		signal: abort.signal,
		capabilities,
		resources: [],
		events: { changed: () => undefined },
	});
	const timeout = setTimeout(() => abort.abort(new Error("Candidate resource readiness timed out")), 3000);
	try {
		const request = instance.operations.request;
		if (request?.effect !== "read") throw new Error("Candidate resource has no readback operation");
		const result = await request.execute(
			{ operation: "status", input: {} },
			{
				scope: { kind: "application" },
				signal: abort.signal,
				capabilities,
			},
		);
		abort.signal.throwIfAborted();
		if (
			!result ||
			typeof result !== "object" ||
			Array.isArray(result) ||
			("ready" in result && result.ready === false)
		)
			throw new Error("Candidate resource did not return a status record");
	} finally {
		clearTimeout(timeout);
		abort.abort();
		await instance.dispose().catch((error: unknown) => {
			quarantine();
			throw error;
		});
	}
}

function resolvePackageService(backend: PackageServices | SessionServicePort, services?: PackageServices) {
	if (services) return services.packages;
	if ("packages" in backend) return backend.packages;
	const legacy: SessionServicePort & Partial<BackendServices["packages"]> = backend;
	if (
		!legacy.searchPackages ||
		!legacy.installPackage ||
		!legacy.updatePackage ||
		!legacy.removePackage ||
		!legacy.listConfiguredPackages
	)
		throw new Error("Package service is required by the desktop host");
	return {
		searchPackages: legacy.searchPackages.bind(backend),
		installPackage: legacy.installPackage.bind(backend),
		updatePackage: legacy.updatePackage.bind(backend),
		rollbackPackage: legacy.rollbackPackage?.bind(backend),
		removePackage: legacy.removePackage.bind(backend),
		listConfiguredPackages: legacy.listConfiguredPackages.bind(backend),
	};
}

/** 社区包域：pi.dev 目录搜索 + 安装/卸载 + 已配置清单。 */
export function registerPackagesIpc(
	backend: PackageServices | SessionServicePort,
	services?: PackageServices,
	onPackagesChanged?: (receipt: PackageLifecycleReceipt) => Promise<void> | void,
	mutationHost?: (event: IpcMainInvokeEvent) => MutationHost,
): void {
	const packages = resolvePackageService(backend, services);
	const notifyAfterMutation = async (operation: Promise<PackageLifecycleReceipt>) => {
		const receipt = await operation;
		await onPackagesChanged?.(receipt);
		return receipt;
	};
	const implementation = (event: IpcMainInvokeEvent): ContractImplementation<typeof PackagesContract> => ({
		searchCatalog: (...args) => {
			const [query, type, page] = args;
			return packages.searchPackages(query, type, page);
		},
		installPackage: (name) => notifyAfterMutation(packages.installPackage(name, mutationHost?.(event))),
		updatePackage: (name) => notifyAfterMutation(packages.updatePackage(name, mutationHost?.(event))),
		rollbackPackage: (name, version) => {
			if (!packages.rollbackPackage) throw new Error("Package rollback is unavailable in this host");
			return notifyAfterMutation(packages.rollbackPackage(name, version, mutationHost?.(event)));
		},
		removePackage: (source, scope) =>
			notifyAfterMutation(packages.removePackage(source, scope, mutationHost?.(event))),
		listConfiguredPackages: () => packages.listConfiguredPackages(),
		latestPackageVersions: (names) => latestPackageVersions(names),
		pluginPackageMetadata: (names) => registryPluginMetadata(names),
	});
	bindContract(PackagesContract, implementation);
}
