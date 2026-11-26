import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	isPackageName,
	isPackageVersion,
	type KeyedLocks,
	npmPackageName,
	type PackageLifecycleReceipt,
	type SessionPackageVersion,
} from "@drone/shared";
import type { ResourceLoader, SourceInfo } from "@earendil-works/pi-coding-agent";
import type { RegisteredSession } from "../session/registry";

type Scope = SessionPackageVersion["scope"];
type Selection = { packageName: string; scope: Scope; workspace: string; version: string | null };

function canonicalWorkspace(cwd: string): string {
	try {
		return realpathSync(cwd);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		return resolve(cwd);
	}
}

export function affectsPackageSession(
	entry: RegisteredSession,
	packageName: string,
	scope: Scope,
	workspace: string,
): boolean {
	const settings = entry.session.settingsManager;
	if (scope === "project")
		return canonicalWorkspace(entry.cwd) === workspace && settings?.isProjectTrusted() === true;
	return !settings
		?.getProjectSettings()
		.packages?.some((item) =>
			typeof item === "string"
				? npmPackageName(item) === packageName
				: item.autoload !== false && npmPackageName(item.source) === packageName,
		);
}

function packageRow(info: SourceInfo, agentDir: string): SessionPackageVersion | undefined {
	const { source, scope, origin, baseDir } = info;
	if (!baseDir || origin !== "package" || scope === "temporary") return undefined;
	try {
		const manifest: unknown = JSON.parse(readFileSync(join(baseDir, "package.json"), "utf8"));
		if (!manifest || typeof manifest !== "object") return undefined;
		const { name, version } = manifest as {
			name?: unknown;
			version?: unknown;
		};
		if (!isPackageName(name) || !isPackageVersion(version)) return undefined;
		const npmName = npmPackageName(source);
		if (source.startsWith("npm:") && npmName !== name) return undefined;
		const userPackageRoot = resolve(agentDir, "npm", "node_modules", name);
		const owner = npmName && resolve(baseDir) === userPackageRoot ? "user" : scope;
		return { packageName: name, scope: owner, currentVersion: version };
	} catch (error) {
		if (
			error instanceof SyntaxError ||
			["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")
		)
			return undefined;
		throw error;
	}
}

function rowKey(row: Pick<SessionPackageVersion, "scope" | "packageName">) {
	return `${row.scope}:${row.packageName}`;
}

export function capturedPackageVersions(loader: ResourceLoader, agentDir: string): SessionPackageVersion[] {
	const rows = new Map<string, SessionPackageVersion>();
	const seenRoots = new Set<string>();
	const resources = [
		...loader.getExtensions().extensions,
		...loader.getSkills().skills,
		...loader.getPrompts().prompts,
		...loader.getThemes().themes,
	];
	for (const { sourceInfo } of resources) {
		if (!sourceInfo?.baseDir || seenRoots.has(`${sourceInfo.scope}:${sourceInfo.baseDir}`)) continue;
		seenRoots.add(`${sourceInfo.scope}:${sourceInfo.baseDir}`);
		const row = packageRow(sourceInfo, agentDir);
		if (row) rows.set(rowKey(row), row);
	}
	return [...rows.values()];
}

export class SessionPackageVersions {
	private readonly selected = new Map<string, Selection>();
	private pending: Selection | undefined;

	constructor(
		private readonly scheduler: KeyedLocks,
		cwd: string,
	) {
		this.workspace = canonicalWorkspace(cwd);
	}

	readonly workspace: string;

	withSelection<T>(action: () => Promise<T>): Promise<T> {
		return this.scheduler.run("sdk-package-selection", action);
	}

	stage(receipt: PackageLifecycleReceipt, version: string | null): void {
		this.pending = this.selection(receipt, version);
	}

	settle(receipt: PackageLifecycleReceipt, sessionScoped: boolean, hasNext = false): void {
		this.pending = undefined;
		if (!sessionScoped || receipt.status === "failed") return;
		const selection = this.selection(receipt, hasNext ? receipt.version : null);
		if (selection) this.selected.set(rowKey(selection), selection);
	}

	forSession(entry: RegisteredSession): SessionPackageVersion[] {
		const rows = new Map(entry.packageVersions?.map((row) => [rowKey(row), row]));
		const eligible = new Map(this.selected);
		if (this.pending) eligible.set(rowKey(this.pending), this.pending);
		for (const selection of eligible.values()) {
			const { packageName, scope, workspace, version } = selection;
			if (!affectsPackageSession(entry, packageName, scope, workspace)) continue;
			const key = rowKey(selection);
			const current = rows.get(key);
			if (current?.currentVersion === version || (!current && version === null)) continue;
			rows.set(key, { ...current, packageName, scope, nextSessionVersion: version });
		}
		return [...rows.values()];
	}

	private selection(
		receipt: PackageLifecycleReceipt,
		version: string | null | undefined,
	): Selection | undefined {
		if (!isPackageName(receipt.packageName) || (version !== null && !isPackageVersion(version)))
			return undefined;
		return { packageName: receipt.packageName, scope: receipt.scope, workspace: this.workspace, version };
	}
}
