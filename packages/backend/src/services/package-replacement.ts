import { realpathSync, renameSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { PackageLifecycleReceipt } from "@drone/shared";
import type { PackageSource } from "@earendil-works/pi-coding-agent";
import { createLogger } from "../log";
import type { PluginRuntimeSource } from "../plugins/plugin-source";
import type { SessionRegistry } from "../session/registry";
import { packageHasPiResources } from "../session-engine/package-resources";
import {
	type PackageIdentity,
	type PackageLocation,
	packageContainsPath,
	readPackageIdentity,
} from "./package-identity";
import { deferPackageSessions, relevantPackageSessions } from "./package-lifecycle";
import type { SessionPackageVersions } from "./session-package-versions";

export type { PackageLocation } from "./package-identity";

const log = createLogger("packages");

export interface PackageSelection {
	readonly entry?: PackageSource;
	readonly dependency?: string;
}

export interface PackageReplacementDisk {
	readonly modules: string;
	stage(directory: string): Promise<void>;
	read(): PackageSelection;
	configure(expected: PackageSelection, selection: PackageSelection): Promise<void>;
}

interface PackageInspection {
	readonly sources: readonly PluginRuntimeSource[];
	readonly restart?: boolean;
}

export interface PackageReplacementHost {
	inspect(location: PackageLocation, candidate?: boolean): Promise<PackageInspection>;
	transition<T>(
		location: PackageLocation,
		sources: readonly PluginRuntimeSource[],
		action: (drained: boolean, quarantine: () => void) => Promise<T>,
	): Promise<T>;
	probe(
		sources: readonly PluginRuntimeSource[],
		directory: string,
		occupiedTools: ReadonlySet<string>,
		quarantine: () => void,
	): Promise<void>;
	rescan(location: PackageLocation): Promise<void>;
	onCandidatePending?(): void;
}

interface Replacement {
	readonly receipt: PackageLifecycleReceipt;
	readonly disk: PackageReplacementDisk;
	readonly host: PackageReplacementHost;
	readonly location: PackageLocation;
	readonly candidate: PackageLocation;
	readonly directory: string;
	readonly previous?: PackageIdentity;
	readonly selection: PackageSelection;
	readonly occupiedTools: () => ReadonlySet<string>;
	readonly registry: SessionRegistry;
	readonly packageVersions?: SessionPackageVersions;
	readonly observeStages?: () => void;
	preserveBackup: boolean;
}

function addEvent(
	receipt: PackageLifecycleReceipt,
	type: PackageLifecycleReceipt["events"][number]["type"],
	detail?: string,
) {
	receipt.events.push({ type, at: Date.now(), ...(detail ? { detail } : {}) });
}

function fail(receipt: PackageLifecycleReceipt, message: string): void {
	receipt.status = "failed";
	receipt.error = { code: "operation-failed", message, retryable: false };
	addEvent(receipt, "failed", message);
}

function assertReadback(
	state: Replacement,
	identity: PackageIdentity | undefined,
	selection: PackageSelection,
) {
	if (
		!isDeepStrictEqual(readPackageIdentity(state.location), identity) ||
		!isDeepStrictEqual(state.disk.read(), selection)
	)
		throw new Error("Package selection readback failed");
	return identity?.version;
}

function nextSelection(state: Replacement, identity: PackageIdentity | undefined): PackageSelection {
	if (!identity) return {};
	const { source } = state.receipt;
	const { entry } = state.selection;
	return { entry: typeof entry === "object" ? { ...entry, source } : source, dependency: identity.version };
}

async function restoreSelection(state: Replacement, selected: PackageSelection): Promise<void> {
	const actual = state.disk.read();
	const previous = state.selection;
	if (isDeepStrictEqual(actual, previous)) return;
	if (
		(!isDeepStrictEqual(actual.entry, previous.entry) && !isDeepStrictEqual(actual.entry, selected.entry)) ||
		(actual.dependency !== previous.dependency && actual.dependency !== selected.dependency)
	)
		throw new Error("Package selection changed during recovery");
	await state.disk.configure(actual, previous);
}

async function cutover(
	state: Replacement,
	identity: PackageIdentity | undefined,
	sources: readonly PluginRuntimeSource[],
	quarantine: () => void,
): Promise<void> {
	const { receipt, host, location, candidate, directory } = state;
	const backup = join(directory, "previous");
	const selected = nextSelection(state, identity);
	let displaced = false;
	let promoted = false;
	let configuring = false;
	let scanStarted = false;
	let reason = "Previous package selection changed";
	try {
		assertReadback(state, state.previous, state.selection);
		reason = "Candidate worker readiness failed";
		if (sources.length) await host.probe(sources, directory, state.occupiedTools(), quarantine);
		reason = "Package publication failed";
		assertReadback(state, state.previous, state.selection);
		if (!isDeepStrictEqual(readPackageIdentity(candidate), identity))
			throw new Error("Candidate changed after verification");
		if (state.previous) {
			renameSync(location.path, backup);
			displaced = true;
		}
		if (identity) {
			renameSync(candidate.path, location.path);
			promoted = true;
		}
		configuring = true;
		await state.disk.configure(state.selection, selected);
		const version = assertReadback(state, identity, selected);
		scanStarted = true;
		await host.rescan(location);
		receipt.version = version;
		addEvent(receipt, receipt.operation === "rollback" ? "rolled_back" : identity ? "enabled" : "disabled");
	} catch {
		fail(receipt, state.preserveBackup ? "Candidate worker cleanup could not be confirmed" : reason);
		try {
			if (promoted) renameSync(location.path, candidate.path);
			if (displaced) renameSync(backup, location.path);
			if (configuring) await restoreSelection(state, selected);
			if (scanStarted) await host.rescan(location);
			receipt.version = assertReadback(state, state.previous, state.selection);
			if (!state.preserveBackup)
				addEvent(receipt, "rolled_back", receipt.version ?? "Previous package absent");
		} catch {
			state.preserveBackup = true;
			quarantine();
			fail(receipt, "Previous package selection could not be verified");
		}
	}
}

async function stageCandidate(state: Replacement) {
	if (state.receipt.operation === "remove") return undefined;
	await state.disk.stage(state.directory);
	addEvent(state.receipt, "staged");
	const identity = readPackageIdentity(state.candidate);
	if (
		!identity ||
		(state.receipt.operation === "rollback" && !state.receipt.source.endsWith(`@${identity.version}`))
	)
		throw new Error("Candidate version did not match the install request");
	const inspection = await state.host.inspect(state.candidate, true);
	const pi = await packageHasPiResources(state.candidate.path, state.selection.entry);
	if (!isDeepStrictEqual(readPackageIdentity(state.candidate), identity))
		throw new Error("Candidate changed during verification");
	addEvent(state.receipt, "verified", identity.version);
	return { identity, inspection, pi };
}

type Activation = {
	identity?: PackageIdentity;
	sources: readonly PluginRuntimeSource[];
	sessionScoped: boolean;
	hasNext: boolean;
	restart: boolean;
};

function publishSelection(state: Replacement, next: Activation, drained: boolean, quarantine: () => void) {
	const { receipt, packageVersions, registry, location } = state;
	const publish = async () => {
		if (drained) addEvent(receipt, "drained");
		await cutover(state, next.identity, next.sources, () => {
			state.preserveBackup = true;
			quarantine();
		});
		if (receipt.status === "succeeded") {
			if (next.restart) receipt.effect = "app-restart";
			if (next.sessionScoped) {
				const workspace = packageVersions?.workspace ?? projectWorkspace(location);
				deferPackageSessions(receipt, relevantPackageSessions(registry, receipt, workspace));
			}
		}
		packageVersions?.settle(receipt, next.sessionScoped, next.hasNext);
	};
	return packageVersions ? packageVersions.withSelection(publish) : publish();
}

async function replace(state: Replacement): Promise<void> {
	const { receipt, host, location } = state;
	const canRemove = receipt.operation === "remove" && state.selection.entry !== undefined;
	if (!state.previous && receipt.operation !== "install" && !canRemove) {
		receipt.status = "failed";
		receipt.error = {
			code: "not-installed",
			message: "Package is not installed in this scope",
			retryable: false,
		};
		addEvent(receipt, "failed", receipt.error.message);
		return;
	}
	let reason = "Candidate package staging or integrity verification failed";
	try {
		const previous = state.previous ? await host.inspect(location) : undefined;
		const previousPi = state.previous && (await packageHasPiResources(location.path, state.selection.entry));
		const candidate = await stageCandidate(state);
		const sources = candidate?.inspection.sources ?? [];
		const priorSources = previous?.sources ?? [];
		const managed = priorSources.length > 0 || sources.length > 0;
		const hasNext = Boolean(candidate?.pi || sources.some(({ nativeEntrypoint }) => nativeEntrypoint));
		const sessionScoped = Boolean(
			previousPi || hasNext || priorSources.some(({ nativeEntrypoint }) => nativeEntrypoint),
		);
		const restart =
			Boolean(previous?.restart || candidate?.inspection.restart) &&
			state.previous?.hash !== candidate?.identity.hash;
		reason = "Previous package selection changed";
		assertReadback(state, state.previous, state.selection);
		reason = "Previous worker did not drain safely";
		const next = { identity: candidate?.identity, sources, sessionScoped, hasNext, restart };
		const action = (drained: boolean, quarantine: () => void) =>
			publishSelection(state, next, drained, quarantine);
		if (managed) {
			if (sessionScoped && candidate) {
				state.packageVersions?.stage(receipt, hasNext ? candidate.identity.version : null);
				state.observeStages?.();
				host.onCandidatePending?.();
			}
			await host.transition(location, priorSources, action);
		} else {
			await action(false, () => undefined);
		}
	} catch {
		fail(receipt, reason);
		state.packageVersions?.settle(receipt, false);
	}
}

function projectWorkspace(location: PackageLocation): string {
	return dirname(dirname(dirname(location.modules)));
}

function activeToolNames(registry: SessionRegistry, location: PackageLocation): ReadonlySet<string> {
	const workspace = projectWorkspace(location);
	return new Set(
		registry.list().flatMap(({ cwd, session }) => {
			if (location.scope === "project" && cwd !== workspace) return [];
			return session
				.getAllTools()
				.filter(({ sourceInfo }) => !packageContainsPath(location.path, sourceInfo.path))
				.map(({ name }) => name);
		}),
	);
}

export async function replaceInstalledPackage(
	receipt: PackageLifecycleReceipt,
	disk: PackageReplacementDisk,
	host: PackageReplacementHost,
	registry: SessionRegistry,
	packageVersions?: SessionPackageVersions,
	observeStages?: () => void,
): Promise<void> {
	const location = {
		packageName: receipt.packageName,
		scope: receipt.scope,
		modules: disk.modules,
		path: join(disk.modules, receipt.packageName),
	};
	let state: Replacement | undefined;
	try {
		const previous = readPackageIdentity(location);
		receipt.previousVersion = previous?.version;
		const selection = disk.read();
		await mkdir(dirname(location.path), { recursive: true, mode: 0o700 });
		if (realpathSync(dirname(location.path)) !== dirname(location.path))
			throw new Error("Package destination is redirected");
		const directory = await mkdtemp(join(dirname(disk.modules), ".drone-replacement-"));
		const modules = join(directory, "npm", "node_modules");
		state = {
			receipt,
			disk,
			host,
			location,
			directory,
			previous,
			selection,
			registry,
			packageVersions,
			observeStages,
			preserveBackup: false,
			candidate: { ...location, modules, path: join(modules, location.packageName) },
			occupiedTools: () => activeToolNames(registry, location),
		};
		await replace(state);
	} catch {
		fail(receipt, "Installed package selection could not be verified");
	} finally {
		if (state && !state.preserveBackup) {
			await rm(state.directory, { recursive: true, force: true }).catch(() => {
				log.warn("Package staging directory could not be removed", location.packageName);
			});
		}
	}
}
