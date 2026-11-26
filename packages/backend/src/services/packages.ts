import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type CatalogPackageType,
	type CatalogSearchResult,
	type ConfiguredPackageInfo,
	DRONE_BUILTIN_PLUGIN_PACKAGE_NAMES,
	isPackageName,
	isPackageVersion,
	npmPackageName,
	type PackageLifecycleOperation,
	type PackageLifecycleReceipt,
} from "@drone/shared";
import { createLogger } from "../log";
import { fetchPackageCatalog } from "../packages/catalog";
import {
	type FirstPartyReleaseResolver,
	isFirstPartyPackageName,
	isInternalDroneScope,
} from "../packages/first-party-releases";
import type { RegisteredSession, SessionRegistry } from "../session/registry";
import type { SessionTraces } from "../session/traces";
import { packageHasPiResources } from "../session-engine/package-resources";
import {
	deferPackageSessions,
	failPackageOperation,
	packageEvent,
	recordPackageLifecycle,
	relevantPackageSessions,
} from "./package-lifecycle";
import {
	type PackageReplacementDisk,
	type PackageReplacementHost,
	replaceInstalledPackage,
} from "./package-replacement";
import type { SessionPackageVersions } from "./session-package-versions";

const log = createLogger("backend");

export { NPM_NOT_FOUND_SENTINEL } from "@drone/shared";
export { isNpmSpawnEnoent } from "./package-lifecycle";

type PackageScope = PackageLifecycleReceipt["scope"];

/** Minimal package-manager boundary kept free of Pi SDK runtime imports. */
export interface PackageManager {
	listConfiguredPackages(): readonly ConfiguredPackageInfo[];
	installAndPersist(source: string, options?: { local?: boolean }): Promise<void>;
	update?(source?: string): Promise<void>;
	removeAndPersist(source: string, options?: { local?: boolean }): Promise<boolean>;
	setProgressCallback?(callback: ((event: PackageManagerProgressEvent) => void) | undefined): void;
	getInstalledPath?(source: string, scope: PackageScope): string | undefined;
	refresh?(): Promise<void>;
	prepareReplacement?(receipt: PackageLifecycleReceipt): Promise<PackageReplacementDisk>;
}

export interface PackageManagerProgressEvent {
	type: "start" | "progress" | "complete" | "error";
	action: "install" | "remove" | "update" | "clone" | "pull";
	source: string;
	message?: string;
}

export type PackageManagerFactory = (cwd: string) => PackageManager;

export interface PackageServiceDependencies {
	registry: SessionRegistry;
	defaultCwd?: string;
	onSessionReloaded?: (sessionId: string) => void;
	traces?: Pick<SessionTraces, "recordCustom">;
	packageVersions?: SessionPackageVersions;
	packageManagerFactory: PackageManagerFactory;
	firstPartyReleaseResolver?: FirstPartyReleaseResolver;
}

export interface PackageServicePort {
	searchPackages(query: string, type?: CatalogPackageType | "", page?: number): Promise<CatalogSearchResult>;
	listConfiguredPackages(): Promise<ConfiguredPackageInfo[]>;
	installPackage(name: string, host?: PackageReplacementHost): Promise<PackageLifecycleReceipt>;
	updatePackage(name: string, host?: PackageReplacementHost): Promise<PackageLifecycleReceipt>;
	rollbackPackage(
		name: string,
		version: string,
		host?: PackageReplacementHost,
	): Promise<PackageLifecycleReceipt>;
	removePackage(
		source: string,
		scope: PackageScope,
		host?: PackageReplacementHost,
	): Promise<PackageLifecycleReceipt>;
}

export class PackageService implements PackageServicePort {
	private packageManager: PackageManager | undefined;
	private mutating = false;

	constructor(private readonly deps: PackageServiceDependencies) {}

	private getPackageManager(): PackageManager {
		this.packageManager ??= this.deps.packageManagerFactory(this.deps.defaultCwd || process.cwd());
		return this.packageManager;
	}

	async searchPackages(
		query: string,
		type?: CatalogPackageType | "",
		page?: number,
	): Promise<CatalogSearchResult> {
		return fetchPackageCatalog({ query, type: type || undefined, page });
	}

	async listConfiguredPackages(): Promise<ConfiguredPackageInfo[]> {
		const packages = this.getPackageManager().listConfiguredPackages();
		return packages.map(({ source, scope }) => ({ source, scope }));
	}

	async installPackage(name: string, host?: PackageReplacementHost): Promise<PackageLifecycleReceipt> {
		return this.runOperation("install", name, `npm:${name}`, "user", host);
	}

	async updatePackage(name: string, host?: PackageReplacementHost): Promise<PackageLifecycleReceipt> {
		return this.runOperation("update", name, `npm:${name}`, undefined, host);
	}

	async rollbackPackage(
		name: string,
		version: string,
		host?: PackageReplacementHost,
	): Promise<PackageLifecycleReceipt> {
		return this.runOperation("rollback", name, `npm:${name}@${version}`, undefined, host);
	}

	async removePackage(
		source: string,
		scope: PackageScope,
		host?: PackageReplacementHost,
	): Promise<PackageLifecycleReceipt> {
		return this.runOperation("remove", npmPackageName(source) ?? source, source, scope, host);
	}

	private assertInstallableName(name: string): void {
		if (!isPackageName(name))
			throw Object.assign(new Error(`Invalid package name: ${name}`), { code: "invalid-source" });
	}

	private assertNotBuiltin(name: string): void {
		if (DRONE_BUILTIN_PLUGIN_PACKAGE_NAMES.includes(name))
			throw Object.assign(new Error(`Built-in package cannot be changed: ${name}`), { code: "builtin" });
	}

	private assertRollbackVersion(version: string): void {
		if (!isPackageVersion(version))
			throw Object.assign(new Error(`Invalid package version: ${version}`), { code: "invalid-source" });
	}

	private configuredScope(manager: PackageManager, name: string): PackageScope | undefined {
		return manager.listConfiguredPackages().find(({ source }) => npmPackageName(source) === name)?.scope;
	}

	private installedVersion(manager: PackageManager, receipt: PackageLifecycleReceipt): string | undefined {
		const installedPath = manager.getInstalledPath?.(receipt.source, receipt.scope);
		if (!installedPath) return undefined;
		try {
			const text = readFileSync(join(installedPath, "package.json"), "utf8");
			const { version } = JSON.parse(text) as { version?: unknown };
			return typeof version === "string" && version.length > 0 ? version : undefined;
		} catch {
			return undefined;
		}
	}

	private async resolveOperationSource(receipt: PackageLifecycleReceipt, requestedVersion?: string) {
		const { operation, packageName } = receipt;
		const offered = isFirstPartyPackageName(packageName);
		if (operation === "remove" || (!offered && !isInternalDroneScope(packageName))) return requestedVersion;
		const resolve = this.deps.firstPartyReleaseResolver;
		if (!offered || !resolve)
			throw Object.assign(new Error("No first-party release source is available"), { code: "unavailable" });
		const release = await resolve(packageName, requestedVersion);
		receipt.source = release.installSource;
		return release.version;
	}

	private async runOperation(
		operation: PackageLifecycleOperation,
		packageName: string,
		source: string,
		scope: PackageScope | undefined,
		host: PackageReplacementHost | undefined,
	): Promise<PackageLifecycleReceipt> {
		const receipt: PackageLifecycleReceipt = {
			operation,
			packageName,
			source,
			scope: scope ?? "user",
			status: "succeeded",
			effect: "current-session",
			events: [],
		};
		if (this.mutating)
			return failPackageOperation(receipt, new Error("A package mutation is already in progress"));
		const observed = new Map<RegisteredSession, number>();
		const observeStages = () => {
			if (this.deps.traces)
				recordPackageLifecycle(this.deps.traces, receipt, this.affectedSessions(receipt), observed);
		};
		this.mutating = true;
		try {
			this.assertNotBuiltin(packageName);
			const npm = source.startsWith("npm:");
			if (npm) this.assertInstallableName(packageName);
			const requestedVersion = operation === "rollback" ? source.slice(packageName.length + 5) : undefined;
			if (requestedVersion !== undefined) this.assertRollbackVersion(requestedVersion);
			const expectedVersion = await this.resolveOperationSource(receipt, requestedVersion);
			const manager = this.getPackageManager();
			await manager.refresh?.();
			receipt.scope = scope ?? this.configuredScope(manager, packageName) ?? "user";
			if (host && npm && manager.prepareReplacement) {
				const disk = await manager.prepareReplacement(receipt).catch(() => {
					throw new Error("Package staging could not be prepared");
				});
				await replaceInstalledPackage(
					receipt,
					disk,
					host,
					this.deps.registry,
					this.deps.packageVersions,
					observeStages,
					expectedVersion,
				);
			} else {
				await this.runLegacy(receipt, manager, expectedVersion);
			}
			return receipt;
		} catch (err) {
			return failPackageOperation(receipt, err);
		} finally {
			this.mutating = false;
			observeStages();
		}
	}

	private affectedSessions(receipt: PackageLifecycleReceipt) {
		return relevantPackageSessions(
			this.deps.registry,
			receipt,
			this.deps.packageVersions?.workspace ?? this.deps.defaultCwd ?? process.cwd(),
		);
	}

	private async runLegacy(
		receipt: PackageLifecycleReceipt,
		manager: PackageManager,
		expectedVersion?: string,
	): Promise<void> {
		const { packageVersions } = this.deps;
		const { source, scope, operation } = receipt;
		const hasPi = async () => {
			const path = manager.getInstalledPath?.(source, scope);
			return path ? packageHasPiResources(path) : false;
		};
		const mutate = async () => {
			const previousPi = await hasPi();
			const restore = this.installProgressCallback(manager, receipt);
			try {
				await this.applyLegacyOperation(receipt, manager, expectedVersion);
			} finally {
				restore();
			}
			const hasNext = operation !== "remove" && (await hasPi());
			const sessionScoped = previousPi || hasNext;
			packageVersions?.settle(receipt, sessionScoped, hasNext);
			if (sessionScoped) deferPackageSessions(receipt, this.affectedSessions(receipt));
			return sessionScoped;
		};
		const sessionScoped = await (packageVersions ? packageVersions.withSelection(mutate) : mutate());
		if (!sessionScoped) await this.reloadSessions(receipt);
	}

	private async applyLegacyOperation(
		receipt: PackageLifecycleReceipt,
		manager: PackageManager,
		expectedVersion?: string,
	): Promise<void> {
		const { operation, source, scope } = receipt;
		const previousVersion = this.installedVersion(manager, receipt);
		if (previousVersion) receipt.previousVersion = previousVersion;
		if (operation === "remove") {
			if (!(await manager.removeAndPersist(source, { local: scope === "project" })))
				throw Object.assign(new Error("Package is not installed"), { code: "not-installed" });
			receipt.events.push(packageEvent("disabled"));
			return;
		}
		if (operation === "update" && expectedVersion === undefined) {
			if (!manager.update) throw new Error("Package updates are unavailable in this host");
			await manager.update(source);
			if (previousVersion && this.installedVersion(manager, receipt) === previousVersion)
				await manager.installAndPersist(source);
		} else {
			if (operation !== "install" && !previousVersion)
				throw Object.assign(new Error("Package is not installed"), { code: "not-installed" });
			if (scope === "project" && source.startsWith(`npm:${receipt.packageName}@file://`))
				await manager.installAndPersist(source, { local: true });
			else await manager.installAndPersist(source);
		}
		receipt.version = this.installedVersion(manager, receipt);
		if (expectedVersion !== undefined && receipt.version !== expectedVersion)
			throw new Error("Installed package version could not be verified");
		receipt.events.push(packageEvent(operation === "rollback" ? "rolled_back" : "enabled"));
	}

	private installProgressCallback(manager: PackageManager, receipt: PackageLifecycleReceipt): () => void {
		if (!manager.setProgressCallback) return () => {};
		manager.setProgressCallback((progress) => {
			if (progress.action === "remove") return;
			if (progress.type === "start") receipt.events.push(packageEvent("staged"));
			if (progress.type === "complete") receipt.events.push(packageEvent("verified"));
		});
		return () => manager.setProgressCallback?.(undefined);
	}

	private async reloadSessions(receipt: PackageLifecycleReceipt): Promise<void> {
		const reloaded: string[] = [];
		const deferred: string[] = [];
		for (const entry of this.affectedSessions(receipt)) {
			if (entry.session.isStreaming) {
				log.info("skip reload while streaming", entry.session.sessionId);
				deferred.push(entry.session.sessionId);
				continue;
			}
			try {
				await entry.session.reload();
				this.deps.onSessionReloaded?.(entry.session.sessionId);
				reloaded.push(entry.session.sessionId);
			} catch (err) {
				log.warn("session reload failed", entry.session.sessionId, err);
				deferred.push(entry.session.sessionId);
			}
		}
		if (reloaded.length) {
			receipt.reloadedSessionIds = reloaded;
			for (const sessionId of reloaded) receipt.events.push(packageEvent("reloaded", sessionId));
		}
		if (deferred.length) {
			receipt.deferredSessionIds = deferred;
			receipt.effect = "next-session";
			for (const sessionId of deferred) receipt.events.push(packageEvent("reload_deferred", sessionId));
		}
	}
}
