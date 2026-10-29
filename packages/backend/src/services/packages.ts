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
	installPackage(name: string): Promise<PackageLifecycleReceipt>;
	updatePackage(name: string): Promise<PackageLifecycleReceipt>;
	rollbackPackage(name: string, version: string): Promise<PackageLifecycleReceipt>;
	removePackage(source: string, scope: "user" | "project"): Promise<PackageLifecycleReceipt>;
}

export class PackageService implements PackageServicePort {
	private packageManager: PackageManager | undefined;

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
	async installPackage(name: string): Promise<PackageLifecycleReceipt> {
		const source = `npm:${name}`;
		return this.runOperation("install", name, source, "user", async (receipt, manager) => {
			this.assertInstallableName(name);
			this.assertNotBuiltin(name);
			const previousVersion = this.installedVersion(manager, source, "user");
			if (previousVersion) receipt.previousVersion = previousVersion;
			await manager.installAndPersist(source);
			receipt.events.push(event("enabled"));
		});
	}

	/** 更新已配置 npm 包；Pi 的 DefaultPackageManager 保留完整的版本/锁定语义。 */
	async updatePackage(name: string): Promise<PackageLifecycleReceipt> {
		const source = `npm:${name}`;
		const scope = this.configuredScope(source) ?? "user";
		return this.runOperation("update", name, source, scope, async (receipt, manager) => {
			this.assertInstallableName(name);
			this.assertNotBuiltin(name);
			if (typeof manager.update !== "function")
				throw new Error("Package updates are unavailable in this host");
			const previousVersion = this.installedVersion(manager, source, scope);
			if (previousVersion) receipt.previousVersion = previousVersion;
			await manager.update(source);
			// Pi preserves an exact version pin in settings. In that case its update
			// command can succeed without replacing the managed directory. Reinstall
			// through the unpinned source so the catalog's latest version is applied;
			// DefaultPackageManager replaces the existing source by package identity.
			if (
				previousVersion &&
				this.installedVersion(manager, source, scope) === previousVersion &&
				typeof manager.installAndPersist === "function"
			) {
				await manager.installAndPersist(source);
			}
			receipt.events.push(event("enabled"));
		});
	}

	/** Roll back an installed npm package to an explicitly authorized exact version. */
	async rollbackPackage(name: string, version: string): Promise<PackageLifecycleReceipt> {
		const source = `npm:${name}@${version}`;
		return this.runOperation(
			"rollback",
			name,
			source,
			this.configuredScope(`npm:${name}`) ?? "user",
			async (receipt, manager) => {
				this.assertInstallableName(name);
				this.assertRollbackVersion(version);
				this.assertNotBuiltin(name);
				const previousVersion = this.installedVersion(manager, `npm:${name}`, receipt.scope);
				if (!previousVersion) {
					const error = new Error(`Package not installed: npm:${name}`);
					(error as Error & { code?: string }).code = "not-installed";
					throw error;
				}
				receipt.previousVersion = previousVersion;
				await manager.installAndPersist(source);
				receipt.events.push(event("rolled_back", undefined, version));
			},
		);
	}

	/** 卸载已配置的包（按 source + scope 移除并持久化）；内置包永远不可卸载。 */
	async removePackage(source: string, scope: "user" | "project"): Promise<PackageLifecycleReceipt> {
		const packageName = packageNameFromSource(source);
		return this.runOperation("remove", packageName, source, scope, async (receipt, manager) => {
			this.assertNotBuiltin(packageName);
			const previousVersion = this.installedVersion(manager, source, scope);
			if (previousVersion) receipt.previousVersion = previousVersion;
			const removed = await manager.removeAndPersist(source, { local: scope === "project" });
			if (!removed) {
				const error = new Error(`Package not installed: ${source}`);
				(error as Error & { code?: string }).code = "not-installed";
				throw error;
			}
			receipt.events.push(event("disabled"));
		});
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
		scope: "user" | "project",
		action: (receipt: PackageLifecycleReceipt, manager: PackageManager) => Promise<void>,
	): Promise<PackageLifecycleReceipt> {
		const receipt: PackageLifecycleReceipt = {
			operation,
			packageName,
			source,
			scope,
			status: "succeeded",
			effect: "current-session",
			events: [],
		};
		const manager = this.getPackageManager();
		const previousCallback = this.installProgressCallback(manager, receipt);
		try {
			await action(receipt, manager);
			const reload = await this.reloadSessions();
			if (reload.reloaded.length) {
				receipt.reloadedSessionIds = reload.reloaded;
				for (const sessionId of reload.reloaded) receipt.events.push(event("reloaded", sessionId));
			}
			if (reload.deferred.length) {
				receipt.deferredSessionIds = reload.deferred;
				receipt.effect = "next-session";
				for (const sessionId of reload.deferred) receipt.events.push(event("reload_deferred", sessionId));
			}
			if (!reload.reloaded.length && !reload.deferred.length) receipt.effect = "current-session";
			receipt.version = this.installedVersion(manager, source, scope);
			log.info(
				`package ${operation === "remove" ? "removed" : operation === "update" ? "updated" : operation === "rollback" ? "rolled back" : "installed"}`,
				packageName,
				{ scope },
			);
			return receipt;
		} catch (err) {
			const normalized = normalizePackageError(err);
			receipt.status = "failed";
			receipt.effect = "current-session";
			receipt.error = {
				code: normalized.code,
				message: normalized.message,
				retryable: normalized.code === "unavailable" || normalized.code === "operation-failed",
			};
			receipt.events.push(event("failed", undefined, normalized.message));
			return receipt;
		} finally {
			previousCallback();
		}
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
	private async reloadSessions(): Promise<{ reloaded: string[]; deferred: string[] }> {
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
		return { reloaded, deferred };
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
