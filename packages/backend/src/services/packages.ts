import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	CatalogPackageType,
	CatalogSearchResult,
	ConfiguredPackageInfo,
	PackageLifecycleEvent,
	PackageLifecycleOperation,
	PackageLifecycleReceipt,
} from "@drone/shared";
import { DRONE_BUILTIN_PLUGIN_PACKAGE_NAMES, NPM_NOT_FOUND_SENTINEL } from "@drone/shared";
import { createLogger } from "../log";
import { fetchPackageCatalog } from "../packages/catalog";
import type { SessionRegistry } from "../session/registry";
import {
	type PackageReplacementDisk,
	type PackageReplacementHost,
	replaceInstalledPackage,
} from "./package-replacement";

const log = createLogger("backend");

export { NPM_NOT_FOUND_SENTINEL };

/** 判断错误是否为 spawn npm ENOENT（GUI 启动 PATH 不含 npm 安装目录时的典型报错，issue #18） */
export function isNpmSpawnEnoent(err: unknown): boolean {
	if (
		/(^|\b)spawn(\s+[^\s]+)*\s+npm(\.\w+)?\s+ENOENT\b/.test(err instanceof Error ? err.message : String(err))
	) {
		return true;
	}
	const code = (err as { code?: unknown } | null)?.code;
	const syscall = (err as { syscall?: unknown } | null)?.syscall;
	return code === "ENOENT" && typeof syscall === "string" && /\bnpm\b/.test(syscall);
}

/** Minimal package-manager boundary kept free of Pi SDK runtime imports. */
export interface PackageManager {
	listConfiguredPackages(): ReadonlyArray<{ source: string; scope: "user" | "project" }>;
	installAndPersist(source: string): Promise<void>;
	update?(source?: string): Promise<void>;
	removeAndPersist(source: string, options?: { local?: boolean }): Promise<boolean>;
	setProgressCallback?(callback: ((event: PackageManagerProgressEvent) => void) | undefined): void;
	getInstalledPath?(source: string, scope: "user" | "project"): string | undefined;
	refresh?(): Promise<void>;
	prepareReplacement?(receipt: PackageLifecycleReceipt): Promise<PackageReplacementDisk>;
}

/** Pi's progress callback is deliberately mirrored as a small host-neutral type. */
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
	packageManagerFactory: PackageManagerFactory;
}

/**
 * 社区包领域服务：目录搜索、用户级安装/卸载、已配置清单与会话热重载。
 *
 * The service owns the package-manager boundary so host adapters can consume
 * package operations through BackendServices without reaching through PiBackend.
 * The package manager remains lazy because catalog browsing must not touch the
 * user's settings file or spawn npm.
 */
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
		scope: "user" | "project",
		host?: PackageReplacementHost,
	): Promise<PackageLifecycleReceipt>;
}

export class PackageService implements PackageServicePort {
	private packageManager: PackageManager | undefined;
	private mutating = false;

	constructor(private readonly deps: PackageServiceDependencies) {}

	/** 包管理器（用户级安装/卸载，懒加载；settingsManager 仅用于读写 settings.json 安装记录） */
	private getPackageManager(): PackageManager {
		if (!this.packageManager) {
			const cwd = this.deps.defaultCwd || process.cwd();
			this.packageManager = this.deps.packageManagerFactory(cwd);
		}
		return this.packageManager;
	}

	/** 搜索 pi.dev 社区包目录（设置页扩展面板浏览用） */
	async searchPackages(
		query: string,
		type?: CatalogPackageType | "",
		page?: number,
	): Promise<CatalogSearchResult> {
		return fetchPackageCatalog({ query, type: type || undefined, page });
	}

	/** 列出 settings.json 已配置的包（「已安装」态匹配用） */
	async listConfiguredPackages(): Promise<ConfiguredPackageInfo[]> {
		return this.getPackageManager()
			.listConfiguredPackages()
			.map((p) => ({ source: p.source, scope: p.scope }));
	}

	/** 安装社区包（npm:<name>，用户级）；返回结构化生命周期回执。 */
	async installPackage(name: string, host?: PackageReplacementHost): Promise<PackageLifecycleReceipt> {
		return this.runOperation("install", name, `npm:${name}`, "user", host);
	}

	/** 更新已配置 npm 包；Pi 的 DefaultPackageManager 保留完整的版本/锁定语义。 */
	async updatePackage(name: string, host?: PackageReplacementHost): Promise<PackageLifecycleReceipt> {
		return this.runOperation("update", name, `npm:${name}`, undefined, host);
	}

	/** Roll back an installed npm package to an explicitly authorized exact version. */
	async rollbackPackage(
		name: string,
		version: string,
		host?: PackageReplacementHost,
	): Promise<PackageLifecycleReceipt> {
		return this.runOperation("rollback", name, `npm:${name}@${version}`, undefined, host);
	}

	/** 卸载已配置的包（按 source + scope 移除并持久化）；内置包永远不可卸载。 */
	async removePackage(
		source: string,
		scope: "user" | "project",
		host?: PackageReplacementHost,
	): Promise<PackageLifecycleReceipt> {
		return this.runOperation("remove", packageNameFromSource(source), source, scope, host);
	}

	private assertInstallableName(name: string): void {
		if (!/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(name)) {
			const error = new Error(`Invalid package name: ${name}`);
			(error as Error & { code?: string }).code = "invalid-source";
			throw error;
		}
	}

	private assertNotBuiltin(name: string): void {
		if (
			!DRONE_BUILTIN_PLUGIN_PACKAGE_NAMES.includes(
				name as (typeof DRONE_BUILTIN_PLUGIN_PACKAGE_NAMES)[number],
			)
		)
			return;
		const error = new Error(`Built-in package cannot be changed: ${name}`);
		(error as Error & { code?: string }).code = "builtin";
		throw error;
	}

	private assertRollbackVersion(version: string): void {
		if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version)) return;
		const error = new Error(`Invalid package version: ${version}`);
		(error as Error & { code?: string }).code = "invalid-source";
		throw error;
	}

	private configuredScope(source: string): "user" | "project" | undefined {
		const match = this.getPackageManager()
			.listConfiguredPackages()
			.find((entry) => packageSourcesMatch(entry.source, source));
		return match?.scope;
	}

	private installedVersion(
		manager: PackageManager,
		source: string,
		scope: "user" | "project",
	): string | undefined {
		const installedPath = manager.getInstalledPath?.(source, scope);
		if (!installedPath) return undefined;
		try {
			const value = JSON.parse(readFileSync(join(installedPath, "package.json"), "utf8")) as {
				version?: unknown;
			};
			return typeof value.version === "string" && value.version.length > 0 ? value.version : undefined;
		} catch {
			return undefined;
		}
	}

	private async runOperation(
		operation: PackageLifecycleOperation,
		packageName: string,
		source: string,
		scope: "user" | "project" | undefined,
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
		if (this.mutating) return this.failed(receipt, new Error("A package mutation is already in progress"));
		this.mutating = true;
		try {
			this.assertNotBuiltin(packageName);
			const npm = source.startsWith("npm:");
			if (npm) this.assertInstallableName(packageName);
			if (operation === "rollback") this.assertRollbackVersion(source.slice(packageName.length + 5));
			const manager = this.getPackageManager();
			await manager.refresh?.();
			receipt.scope = scope ?? this.configuredScope(source) ?? "user";
			if (host && npm && manager.prepareReplacement) {
				const disk = await manager.prepareReplacement(receipt).catch(() => {
					throw new Error("Package staging could not be prepared");
				});
				if (await replaceInstalledPackage(receipt, disk, host, this.deps.registry)) return receipt;
			} else {
				const restoreCallback = this.installProgressCallback(manager, receipt);
				try {
					await this.applyLegacyOperation(receipt, manager);
				} finally {
					restoreCallback();
				}
				receipt.version = this.installedVersion(manager, source, receipt.scope);
			}
			await this.reloadSessions(receipt);
			return receipt;
		} catch (err) {
			return this.failed(receipt, err);
		} finally {
			this.mutating = false;
		}
	}

	private async applyLegacyOperation(
		receipt: PackageLifecycleReceipt,
		manager: PackageManager,
	): Promise<void> {
		const { operation, source, scope } = receipt;
		const previousVersion = this.installedVersion(manager, source, scope);
		if (previousVersion) receipt.previousVersion = previousVersion;
		if (operation === "remove") {
			if (!(await manager.removeAndPersist(source, { local: scope === "project" })))
				throw Object.assign(new Error("Package is not installed"), { code: "not-installed" });
			receipt.events.push(event("disabled"));
			return;
		}
		if (operation === "update") {
			if (!manager.update) throw new Error("Package updates are unavailable in this host");
			await manager.update(source);
			if (previousVersion && this.installedVersion(manager, source, scope) === previousVersion)
				await manager.installAndPersist(source);
		} else {
			if (operation === "rollback" && !previousVersion)
				throw Object.assign(new Error("Package is not installed"), { code: "not-installed" });
			await manager.installAndPersist(source);
		}
		receipt.events.push(
			event(
				operation === "rollback" ? "rolled_back" : "enabled",
				undefined,
				operation === "rollback" ? source.slice(receipt.packageName.length + 5) : undefined,
			),
		);
	}

	private failed(receipt: PackageLifecycleReceipt, error: unknown): PackageLifecycleReceipt {
		const { code, message } = normalizePackageError(error);
		receipt.status = "failed";
		receipt.effect = "current-session";
		receipt.error = { code, message, retryable: code === "unavailable" || code === "operation-failed" };
		receipt.events.push(event("failed", undefined, message));
		return receipt;
	}

	private installProgressCallback(manager: PackageManager, receipt: PackageLifecycleReceipt): () => void {
		if (!manager.setProgressCallback) return () => {};
		manager.setProgressCallback((progress) => {
			if (progress.type === "start") {
				receipt.events.push(
					event(progress.action === "remove" ? "disabled" : "staged", undefined, progress.message),
				);
			} else if (progress.type === "complete") {
				receipt.events.push(
					event(progress.action === "remove" ? "drained" : "verified", undefined, progress.message),
				);
			} else if (progress.type === "error") {
				receipt.events.push(event("failed", undefined, progress.message));
			}
		});
		return () => manager.setProgressCallback?.(undefined);
	}

	/** 对非流式活跃会话做资源热重载；流式会话明确延迟到下一次会话边界。 */
	private async reloadSessions(receipt: PackageLifecycleReceipt): Promise<void> {
		const reloaded: string[] = [];
		const deferred: string[] = [];
		for (const entry of this.deps.registry.list()) {
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
			for (const sessionId of reloaded) receipt.events.push(event("reloaded", sessionId));
		}
		if (deferred.length) {
			receipt.deferredSessionIds = deferred;
			receipt.effect = "next-session";
			for (const sessionId of deferred) receipt.events.push(event("reload_deferred", sessionId));
		}
	}
}

function packageNameFromSource(source: string): string {
	const normalized = source.replace(/^npm:/u, "");
	const match = normalized.match(/^(@[^/]+\/[^@]+|[^@]+)(?:@.+)?$/u);
	return match?.[1] ?? normalized;
}

function packageSourcesMatch(left: string, right: string): boolean {
	return (
		packageNameFromSource(left) === packageNameFromSource(right) &&
		left.startsWith("npm:") &&
		right.startsWith("npm:")
	);
}

function event(
	type: PackageLifecycleEvent["type"],
	sessionId?: string,
	detail?: string,
): PackageLifecycleEvent {
	return {
		type,
		at: Date.now(),
		...(sessionId ? { sessionId } : {}),
		...(detail ? { detail: safeErrorMessage(detail) } : {}),
	};
}

function safeErrorMessage(value: string): string {
	return value
		.replace(/([A-Z_]*(?:TOKEN|PASSWORD|SECRET|API[_-]?KEY)[A-Z_]*\s*[=:]\s*)\S+/giu, "$1[redacted]")
		.slice(0, 1000);
}

function normalizePackageError(err: unknown): {
	code: NonNullable<PackageLifecycleReceipt["error"]>["code"];
	message: string;
} {
	const raw = err instanceof Error ? err.message : String(err);
	const message = safeErrorMessage(
		isNpmSpawnEnoent(err)
			? `${NPM_NOT_FOUND_SENTINEL}: npm executable not found on PATH (install Node.js, then restart the app)`
			: raw,
	);
	const explicit = (err as { code?: unknown } | null)?.code;
	if (
		explicit === "invalid-source" ||
		explicit === "builtin" ||
		explicit === "not-installed" ||
		explicit === "unavailable"
	) {
		return { code: explicit, message };
	}
	if (message.includes(NPM_NOT_FOUND_SENTINEL)) return { code: "unavailable", message };
	if (/invalid package name|unsupported .*source/iu.test(message)) return { code: "invalid-source", message };
	if (/not installed/iu.test(message)) return { code: "not-installed", message };
	if (/updates are unavailable|npm.*not found|network|fetch|registry/iu.test(message)) {
		return { code: "unavailable", message };
	}
	return { code: "operation-failed", message };
}
