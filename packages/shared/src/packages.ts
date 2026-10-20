/** pi.dev 社区包目录（packages 页）跨进程类型 */

/** npm 不在 PATH 上的错误哨兵（backend 抛出、renderer 映射为 i18n 文案；IPC 只保留 message，故放 message 前缀） */
export const NPM_NOT_FOUND_SENTINEL = "DRONE_NPM_NOT_FOUND";

export type CatalogPackageType = "extension" | "skill" | "prompt" | "theme";

/** 目录中的一个包（从 pi.dev/packages SSR HTML 解析，非官方 JSON API） */
export interface CatalogPackage {
	name: string;
	description: string;
	author: string;
	/** data-package-types 空格分隔；无标记时为 ["package"] */
	types: string[];
	/** 月下载量 */
	downloads: number;
	/** 更新时间（ms epoch） */
	updatedAt: number;
	/** 安装源（npm:<name>，对应 pi install npm:<name>） */
	installSource: string;
}

/** 启发式识别提供 subagent 能力的社区包（安装提醒，不作为安全边界）。 */
export function isSubagentPackage(pkg: Pick<CatalogPackage, "name" | "description">): boolean {
	return /sub-?agent/i.test(`${pkg.name} ${pkg.description}`);
}

export interface CatalogSearchResult {
	packages: CatalogPackage[];
	/** 全量匹配总数（分页用） */
	total: number;
	page: number;
	pageSize: number;
}

/** 已配置的包（settings.json 里的安装记录，用于「已安装」态匹配） */
export interface ConfiguredPackageInfo {
	source: string;
	scope: "user" | "project";
}

/** A package operation's effective boundary. Pi resources are session-scoped;
 * the desktop host may reload an idle session, while a streaming session waits
 * for its next boundary. */
export type PackageLifecycleEffect = "current-session" | "next-session" | "app-restart";

export type PackageLifecycleOperation = "install" | "update" | "remove";

export type PackageLifecycleStatus = "succeeded" | "failed";

/** Stable lifecycle phases used by the market UI and acceptance receipts. */
export type PackageLifecycleEventType =
	| "staged"
	| "verified"
	| "enabled"
	| "disabled"
	| "drained"
	| "reloaded"
	| "reload_deferred"
	| "rolled_back"
	| "failed";

export interface PackageLifecycleEvent {
	type: PackageLifecycleEventType;
	at: number;
	/** Session id is included only for session-boundary events. */
	sessionId?: string;
	detail?: string;
}

export interface PackageLifecycleError {
	/** Machine-readable code suitable for UI copy and acceptance checks. */
	code: "invalid-source" | "builtin" | "not-installed" | "unavailable" | "operation-failed";
	message: string;
	/** Whether retrying the same operation may succeed without changing input. */
	retryable: boolean;
}

/** Structured result returned by package install/update/remove IPC methods. */
export interface PackageLifecycleReceipt {
	operation: PackageLifecycleOperation;
	packageName: string;
	source: string;
	scope: "user" | "project";
	status: PackageLifecycleStatus;
	effect: PackageLifecycleEffect;
	/** Observed package version when the host can read the staged install. */
	version?: string;
	previousVersion?: string;
	events: PackageLifecycleEvent[];
	error?: PackageLifecycleError;
	/** Session ids reloaded or intentionally deferred at the boundary. */
	reloadedSessionIds?: string[];
	deferredSessionIds?: string[];
}

/** Numeric semver comparison (pre-release tags sort before the release). */
export function compareVersions(a: string, b: string): number {
	const parse = (value: string) => {
		const [core = "", pre] = value.replace(/^v/u, "").split("-", 2);
		return { parts: core.split(".").map((part) => Number.parseInt(part, 10) || 0), pre };
	};
	const left = parse(a);
	const right = parse(b);
	for (let index = 0; index < 3; index++) {
		const diff = (left.parts[index] ?? 0) - (right.parts[index] ?? 0);
		if (diff !== 0) return Math.sign(diff);
	}
	if (left.pre && !right.pre) return -1;
	if (!left.pre && right.pre) return 1;
	return 0;
}
