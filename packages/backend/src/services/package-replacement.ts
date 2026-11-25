import { createHash, type Hash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { PackageLifecycleReceipt } from "@drone/shared";
import type { PackageSource } from "@earendil-works/pi-coding-agent";
import { createLogger } from "../log";
import type { PluginRuntimeSource } from "../plugins/plugin-source";
import type { SessionRegistry } from "../session/registry";

type PackageScope = PackageLifecycleReceipt["scope"];
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

export interface PackageLocation {
	readonly packageName: string;
	readonly scope: PackageScope;
	readonly modules: string;
	readonly path: string;
}

interface PackageInspection {
	readonly sources: readonly PluginRuntimeSource[];
	readonly restart?: boolean;
}

export interface PackageReplacementHost {
	inspect(location: PackageLocation): Promise<PackageInspection>;
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
}

interface PackageIdentity {
	readonly version: string;
	readonly hash: string;
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

function inside(root: string, path: string): boolean {
	const suffix = relative(root, path);
	return !isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`);
}

function addDirectory(hash: Hash, root: string, directory: string): void {
	for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
		left.name.localeCompare(right.name),
	)) {
		const path = join(directory, entry.name);
		hash.update(JSON.stringify([relative(root, path), entry.isDirectory(), entry.isSymbolicLink()]));
		if (entry.isDirectory()) addDirectory(hash, root, path);
		else if (entry.isSymbolicLink()) {
			const link = readlinkSync(path);
			if (isAbsolute(link) || !inside(root, realpathSync(path)))
				throw new Error("Package link escaped its directory");
			hash.update(JSON.stringify(link));
		} else if (entry.isFile()) {
			const bytes = readFileSync(path);
			hash.update(`${bytes.length}\0`).update(bytes);
		} else throw new Error("Invalid entry in package directory");
	}
}

function readIdentity(location: PackageLocation): PackageIdentity | undefined {
	const stat = lstatSync(location.path, { throwIfNoEntry: false });
	if (!stat) return undefined;
	const root = realpathSync(location.path);
	if (!stat.isDirectory() || root !== location.path || realpathSync(location.modules) !== location.modules)
		throw new Error("Package root is not a confined directory");
	const hash = createHash("sha256");
	addDirectory(hash, root, root);
	const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
		name?: unknown;
		version?: unknown;
	};
	const { version } = manifest;
	if (
		manifest.name !== location.packageName ||
		typeof version !== "string" ||
		version.length > 128 ||
		!/^\d+\.\d+\.\d+(?:-[\dA-Za-z.-]+)?(?:\+[\dA-Za-z.-]+)?$/u.test(version)
	)
		throw new Error("Unexpected package identity");
	return { version, hash: hash.digest("hex") };
}

function assertReadback(
	state: Replacement,
	identity: PackageIdentity | undefined,
	selection: PackageSelection,
) {
	if (
		!isDeepStrictEqual(readIdentity(state.location), identity) ||
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
		if (!isDeepStrictEqual(readIdentity(candidate), identity))
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
	const identity = readIdentity(state.candidate);
	if (
		!identity ||
		(state.receipt.operation === "rollback" && !state.receipt.source.endsWith(`@${identity.version}`))
	)
		throw new Error("Candidate version did not match the install request");
	const inspection = await state.host.inspect(state.candidate);
	if (!isDeepStrictEqual(readIdentity(state.candidate), identity))
		throw new Error("Candidate changed during verification");
	addEvent(state.receipt, "verified", identity.version);
	return { identity, inspection };
}

async function replace(state: Replacement): Promise<boolean> {
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
		return true;
	}
	let reason = "Candidate package staging or integrity verification failed";
	try {
		const previous = state.previous ? await host.inspect(location) : undefined;
		const candidate = await stageCandidate(state);
		const sources = candidate?.inspection.sources ?? [];
		const restart = previous?.restart || candidate?.inspection.restart;
		reason = "Previous package selection changed";
		assertReadback(state, state.previous, state.selection);
		reason = "Previous worker did not drain safely";
		await host.transition(location, previous?.sources ?? [], async (drained, quarantine) => {
			if (drained) addEvent(receipt, "drained");
			await cutover(state, candidate?.identity, sources, () => {
				state.preserveBackup = true;
				quarantine();
			});
		});
		if (restart && receipt.status === "succeeded") receipt.effect = "app-restart";
		return Boolean(restart || previous?.sources.length || sources.length || receipt.status === "failed");
	} catch {
		fail(receipt, reason);
		return true;
	}
}

function activeToolNames(registry: SessionRegistry, location: PackageLocation): ReadonlySet<string> {
	const workspace = dirname(dirname(dirname(location.modules)));
	return new Set(
		registry.list().flatMap(({ cwd, session }) => {
			if (location.scope === "project" && cwd !== workspace) return [];
			return session
				.getAllTools()
				.filter(({ sourceInfo }) => !inside(location.path, sourceInfo.path))
				.map(({ name }) => name);
		}),
	);
}

export async function replaceInstalledPackage(
	receipt: PackageLifecycleReceipt,
	disk: PackageReplacementDisk,
	host: PackageReplacementHost,
	registry: SessionRegistry,
): Promise<boolean> {
	const location = {
		packageName: receipt.packageName,
		scope: receipt.scope,
		modules: disk.modules,
		path: join(disk.modules, receipt.packageName),
	};
	let state: Replacement | undefined;
	try {
		const previous = readIdentity(location);
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
			preserveBackup: false,
			candidate: { ...location, modules, path: join(modules, location.packageName) },
			occupiedTools: () => activeToolNames(registry, location),
		};
		return await replace(state);
	} catch {
		fail(receipt, "Installed package selection could not be verified");
		return true;
	} finally {
		if (state && !state.preserveBackup) {
			await rm(state.directory, { recursive: true, force: true }).catch(() => {
				log.warn("Package staging directory could not be removed", location.packageName);
			});
		}
	}
}
