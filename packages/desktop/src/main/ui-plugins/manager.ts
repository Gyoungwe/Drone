import { existsSync, type FSWatcher, realpathSync, watch } from "node:fs";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createLogger, type SelectedNativeSource } from "@drone/backend";
import type { UiPluginInfo, UiPluginManifest, UiPluginsConfig } from "@drone/shared";
import { app } from "electron";
import { buildPlugin } from "./build";
import { defaultUiPluginsConfig, loadUiPluginsConfig, saveUiPluginsConfig } from "./config";
import {
	type InstalledPackageDiscovery,
	type InstalledUiDiscovery,
	type InstalledUiRuntimeSource,
	installedPackageHash,
} from "./installed-package-sources";
import { discoverManagedPackages } from "./managed-roots";
import { filterContributions } from "./manifest-contributions";
import { classifyUnmanagedNativePath } from "./native-source-classification";
import {
	builtinPackageRoot,
	builtinPluginsDir,
	installedUiPackageRoot,
	NAME_RE,
	packageDiagnosticName,
	pluginsDir,
	seedBuiltinPlugins,
	seedDocs,
} from "./plugin-dirs";
import { readManifest, validateManifest } from "./plugin-manifest";

export { RETIRED_BUILTIN_PLUGINS, uiPluginsResourcesDir } from "./plugin-dirs";

const log = createLogger("ui-plugins");

/** 目录内所有文件的最新 mtime（构建陈旧性判断：源码比产物新即重建） */
async function newestMtime(dir: string): Promise<number | null> {
	let newest: number | null = null;
	const walk = async (d: string) => {
		const entries = await readdir(d, { withFileTypes: true }).catch(() => []);
		for (const entry of entries) {
			const p = join(d, entry.name);
			if (entry.isDirectory()) {
				await walk(p);
			} else {
				const s = await stat(p).catch(() => null);
				if (s && (newest === null || s.mtimeMs > newest)) newest = s.mtimeMs;
			}
		}
	};
	await walk(dir);
	return newest;
}

export class UiPluginManager {
	private readonly installedPackageRoot: string;
	private readonly builtinPackageRoot: string;
	/** Read-only built-in packages of the current scan: package root → package name. Drone vouches for them. */
	builtinPackages: ReadonlyMap<string, string> = new Map();
	private readonly legacyInstalledPackageDir?: string;
	/** name → 扫描信息（scanAll 合成；buildError 是内存态，保留在 Map 里跨扫描存活） */
	private infos = new Map<string, UiPluginInfo>();
	/** name → 插件目录绝对路径（白名单：readCode/openDir 只接受扫描到的合法名） */
	private dirNames = new Map<string, string>();
	/** Installed provenance is never inferred from a local UI directory or its name. */
	private packageSources = new Map<string, { source: InstalledUiRuntimeSource; current: boolean }>();
	private installedSources = new Map<string, Exclude<InstalledUiDiscovery, { error: string }>>();
	/** Discovery diagnostics are host-owned metadata; an empty managed root is a valid empty list. */
	private installedDiagnostics: Array<{ packageName: string; error: string }> = [];
	/** Name → package generation hash. Local user UI plugins intentionally have no entry here. */
	private installedPackageHashes = new Map<string, { root: string; hash: string }>();
	/** Installed package generations observed as changed during this scan; trust must be renewed. */
	private readonly reconfirmInstallations = new Set<string>();
	/** 随包内置插件名集合（init 时导出到用户目录；此处仅用于合成 builtin 标志 → 面板 badge/启用免确认） */
	private builtinNames = new Set<string>();
	/** 持久化配置缓存（updateConfig 后刷新；scanAll 时叠加） */
	private config: UiPluginsConfig = defaultUiPluginsConfig();
	/** 热重载 watcher（startWatcher 启动；will-quit 时关闭） */
	private watchers: FSWatcher[] = [];
	/** 插件名 → 防抖重建定时器（连续保存只重建一次） */
	private rebuildTimers = new Map<string, NodeJS.Timeout>();

	constructor(options?: {
		installedPackageRoot?: string;
		builtinPackageRoot?: string;
		installedPackageDir?: string;
	}) {
		this.installedPackageRoot = options?.installedPackageRoot ?? installedUiPackageRoot();
		this.builtinPackageRoot = options?.builtinPackageRoot ?? builtinPackageRoot();
		this.legacyInstalledPackageDir = options?.installedPackageDir;
	}

	/** 确保插件根目录存在、分发规范文档与内置插件、加载配置 + 首次扫描 */
	async init(): Promise<void> {
		await mkdir(pluginsDir(), { recursive: true });
		// 0.4.0 内置插件版本化缓存目录的遗留（seed 方案后不再需要，静默清掉）
		await rm(join(app.getPath("userData"), "ui-plugins-builtin"), { recursive: true, force: true }).catch(
			() => {},
		);
		await seedDocs();
		await seedBuiltinPlugins();
		await this.scanAll();
	}

	/** 合成单个插件的 UiPluginInfo（统一从用户插件目录扫描；builtin 标志来自随包名单） */
	private async scanOne(
		name: string,
		srcDir: string,
		runtime?: InstalledUiRuntimeSource,
		forceReconfirmation = false,
		packageName?: string,
		contentHash?: string,
	): Promise<UiPluginInfo> {
		const manifest = await readManifest(srcDir);
		const invalidReason = validateManifest(name, manifest ?? {}, runtime);
		const prev = this.infos.get(name);
		// A built-in package is on until the user turns it off; Drone itself vouches for it.
		const builtinPackage =
			packageName !== undefined && [...this.builtinPackages.values()].includes(packageName);
		return {
			name,
			...(packageName ? { packageName } : {}),
			displayName: typeof manifest?.displayName === "string" ? manifest.displayName : undefined,
			description: typeof manifest?.description === "string" ? manifest.description : undefined,
			version: typeof manifest?.version === "string" ? manifest.version : undefined,
			droneUi: manifest?.droneUi,
			slots: manifest?.slots ?? {},
			contributions: filterContributions(manifest?.contributions),
			headless: manifest?.headless === true ? true : undefined,
			enabled: forceReconfirmation ? false : (this.config.plugins[name]?.enabled ?? builtinPackage),
			trusted: forceReconfirmation ? false : (this.config.plugins[name]?.trusted ?? builtinPackage),
			invalidReason: invalidReason ?? undefined,
			buildError: prev?.buildError,
			built: existsSync(join(this.buildDirectory(srcDir, contentHash), "index.js")),
			builtin: this.builtinNames.has(name) || builtinPackage || undefined, // 用户插件不落字段（保持载荷干净）
		};
	}

	/** 扫描 userData/ui-plugins/ 每个子目录：校验 manifest 并合成 UiPluginInfo（叠加 config/产物状态） */
	async scanAll(): Promise<UiPluginInfo[]> {
		this.config = await loadUiPluginsConfig();
		this.reconfirmInstallations.clear();
		// 随包内置名单（每次扫描现取，目录静态几乎零开销）
		const builtinEntries = await readdir(builtinPluginsDir(), { withFileTypes: true }).catch(() => []);
		this.builtinNames = new Set(
			builtinEntries.filter((e) => e.isDirectory() && NAME_RE.test(e.name)).map((e) => e.name),
		);
		const dir = pluginsDir();
		const out: UiPluginInfo[] = [];
		const seen = new Set<string>();
		const installedSources = new Map<string, Exclude<InstalledUiDiscovery, { error: string }>>();
		const installedPackageHashes = new Map<string, { root: string; hash: string }>();
		const persistedInstallations = this.config.installations ?? {};
		const nextInstallations: NonNullable<UiPluginsConfig["installations"]> = { ...persistedInstallations };
		const entries = await readdir(dir, { withFileTypes: true }).catch((err) => {
			log.error("scanAll readdir failed", err);
			return [];
		});
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const name = entry.name;
			if (!NAME_RE.test(name)) continue; // 目录名非法直接跳过（不占白名单）
			try {
				seen.add(name);
				this.dirNames.set(name, join(dir, name));
				const info = await this.scanOne(name, join(dir, name));
				this.infos.set(name, info);
				out.push(info);
			} catch (err) {
				// 单插件扫描异常不阻断应用启动与其余插件（B2）：合成 invalid info 继续下一个
				const msg = err instanceof Error ? err.message : String(err);
				log.error("scanOne failed", name, err);
				const info: UiPluginInfo = {
					name,
					slots: {},
					contributions: [],
					enabled: false,
					trusted: false,
					built: false,
					invalidReason: `扫描异常: ${msg}`,
				};
				this.infos.set(name, info);
				out.push(info);
			}
		}
		// Installed packages are discovered from their own Drone manifest. The host
		// never names an optional package; a damaged or incompatible package becomes
		// a diagnostic row and cannot affect the user/built-in plugin scan.
		const managed = this.legacyInstalledPackageDir
			? { installed: [], builtins: new Map<string, string>() }
			: await discoverManagedPackages(this.installedPackageRoot, this.builtinPackageRoot);
		const installed: InstalledPackageDiscovery[] = managed.installed;
		this.builtinPackages = managed.builtins;
		const packageSources = new Map(
			[...this.packageSources].map(([name, item]) => [name, { source: item.source, current: false }]),
		);
		for (const candidate of installed)
			if (!("error" in candidate) && candidate.runtime)
				packageSources.set(`package:${candidate.packageRoot}`, { source: candidate.runtime, current: true });
		this.packageSources = packageSources;
		this.installedDiagnostics = installed.filter(
			(candidate): candidate is { packageName: string; error: string } => "error" in candidate,
		);
		if (this.legacyInstalledPackageDir) {
			installed.push({
				packageName: "legacy-ui-fixture",
				packageRoot: this.legacyInstalledPackageDir,
				uiDir: this.legacyInstalledPackageDir,
			});
		}
		const candidates = await Promise.all(
			installed
				.filter(
					(candidate): candidate is InstalledUiDiscovery =>
						"error" in candidate || candidate.uiDir !== undefined,
				)
				.map(async (candidate) =>
					"error" in candidate
						? candidate
						: { ...candidate, uiManifest: await readManifest(candidate.uiDir) },
				),
		);
		const uiOwners = new Map<string, string[]>();
		for (const candidate of candidates) {
			if ("error" in candidate) continue;
			const name = candidate.uiManifest?.name;
			if (typeof name !== "string") continue;
			const owners = uiOwners.get(name);
			if (owners) owners.push(candidate.packageName);
			else uiOwners.set(name, [candidate.packageName]);
		}
		const resolvedCandidates = candidates.map((candidate) => {
			if ("error" in candidate) return candidate;
			const name = candidate.uiManifest?.name;
			const owners = typeof name === "string" ? uiOwners.get(name) : undefined;
			return owners && owners.length > 1
				? {
						packageName: candidate.packageName,
						error: `UI name ${name} is claimed by multiple installed packages: ${owners.join(", ")}`,
					}
				: candidate;
		});
		for (const candidate of resolvedCandidates) {
			if ("error" in candidate) {
				const name = packageDiagnosticName(candidate.packageName);
				if (seen.has(name)) continue;
				seen.add(name);
				const info: UiPluginInfo = {
					name,
					slots: {},
					contributions: [],
					enabled: false,
					trusted: false,
					built: false,
					invalidReason: `${candidate.packageName}: ${candidate.error}`,
				};
				this.infos.set(name, info);
				out.push(info);
				continue;
			}
			const installedManifest = candidate.uiManifest;
			const installedName = installedManifest?.name;
			if (typeof installedName !== "string" || !NAME_RE.test(installedName) || seen.has(installedName))
				continue;
			const invalidReason = validateManifest(installedName, installedManifest ?? {}, candidate.runtime);
			if (invalidReason) {
				const info: UiPluginInfo = {
					name: installedName,
					slots: {},
					contributions: [],
					enabled: false,
					trusted: false,
					built: false,
					invalidReason: `${candidate.packageName}: ${invalidReason}`,
				};
				seen.add(installedName);
				this.infos.set(installedName, info);
				out.push(info);
				continue;
			}
			try {
				seen.add(installedName);
				this.dirNames.set(installedName, candidate.uiDir);
				installedSources.set(installedName, candidate);
				const identity = {
					root: candidate.packageRoot,
					hash: candidate.runtime?.contentHash ?? installedPackageHash(candidate.packageRoot),
				};
				const previous =
					this.installedPackageHashes.get(installedName) ?? persistedInstallations[candidate.packageName];
				// A built-in changes only with Drone itself, so a new generation keeps the user's choice.
				const changed = previous && (previous.root !== identity.root || previous.hash !== identity.hash);
				if (changed && !this.builtinPackages.has(identity.root)) {
					this.reconfirmInstallations.add(installedName);
				}
				nextInstallations[candidate.packageName] = identity;
				installedPackageHashes.set(installedName, identity);
				const info = await this.scanOne(
					installedName,
					candidate.uiDir,
					candidate.runtime,
					this.reconfirmInstallations.has(installedName),
					candidate.packageName,
					identity.hash,
				);
				this.infos.set(installedName, info);
				out.push(info);
			} catch (err) {
				log.error("installed UI package scan failed", candidate.packageName, err);
			}
		}
		// 清理幽灵条目：目录已删除/改名的插件从两个 Map 移除（否则面板显示已删除插件直到重启）
		for (const stale of [...this.infos.keys()]) {
			if (!seen.has(stale)) this.infos.delete(stale);
		}
		for (const stale of [...this.dirNames.keys()]) {
			if (!seen.has(stale)) this.dirNames.delete(stale);
		}
		this.installedSources = installedSources;
		this.installedPackageHashes = installedPackageHashes;
		if (this.reconfirmInstallations.size > 0) {
			const plugins = { ...this.config.plugins };
			for (const name of this.reconfirmInstallations) {
				plugins[name] = { enabled: false, trusted: false };
			}
			await saveUiPluginsConfig({ plugins, installations: nextInstallations });
			this.config = await loadUiPluginsConfig();
		} else if (Object.keys(nextInstallations).length > 0) {
			await saveUiPluginsConfig({ installations: nextInstallations });
			this.config = await loadUiPluginsConfig();
		}
		return out;
	}

	private installedSourceCurrent(name: string): boolean {
		const identity = this.installedPackageHashes.get(name);
		if (!identity) return true;
		try {
			const runtime = this.installedSources.get(name)?.runtime;
			return runtime
				? this.runtimeSourceCurrent(runtime)
				: installedPackageHash(identity.root) === identity.hash;
		} catch {
			return false;
		}
	}

	/** 列表（设置面板/加载器用）：读扫描缓存 */
	list(): UiPluginInfo[] {
		return Array.from(this.infos.values());
	}

	/** Metadata-only diagnostics from the managed package scan. */
	diagnostics(): readonly { packageName: string; error: string }[] {
		return this.installedDiagnostics.map((diagnostic) => ({ ...diagnostic }));
	}

	/** 按名取单个插件信息（无效名/未知插件返回 null） */
	info(name: string): UiPluginInfo | null {
		return this.infos.get(name) ?? null;
	}

	/** The source belongs to the installed package selected by the current scan. */
	runtimeSource(name: string): InstalledUiRuntimeSource | undefined {
		const native = this.packageSources.get(name);
		if (native) {
			if (!native.current || this.builtinDisabled(native.source.packageRoot)) return undefined;
			try {
				return this.runtimeSourceCurrent(native.source) ? native.source : undefined;
			} catch (error) {
				log.warn("Installed native source is unavailable", native.source.pluginId, error);
				return undefined;
			}
		}
		if (!this.installedSourceCurrent(name)) return undefined;
		return this.installedSources.get(name)?.runtime;
	}

	/** Native and service consumers see the same package descriptors and current content identities. */
	runtimeSources(): readonly {
		name: string;
		source: InstalledUiRuntimeSource;
		state: "enabled" | "unavailable";
	}[] {
		return [...this.packageSources].map(([name, item]) => ({
			name,
			source: item.source,
			state: this.runtimeSource(name) ? "enabled" : "unavailable",
		}));
	}

	/**
	 * Native entries of current packages that declared read-only child session support. A child
	 * session loads only these; the actual loader selection is still classified per path.
	 */
	nativeChildExtensionPaths(): string[] {
		const paths: string[] = [];
		for (const [name, item] of this.packageSources) {
			if (item.source.nativeChildSessions !== "read-only" || !this.runtimeSource(name)) continue;
			const path = item.source.nativeDeclaredPath ?? item.source.nativeEntrypoint;
			if (path) paths.push(path);
		}
		return paths;
	}

	/** Native entries of enabled built-in packages; Pi's package manager does not list them. */
	builtinExtensionPaths(): string[] {
		return [...this.packageSources].flatMap(([name, { source }]) => {
			const path = source.nativeDeclaredPath ?? source.nativeEntrypoint;
			return path && this.builtinPackages.has(source.packageRoot) && this.runtimeSource(name) ? [path] : [];
		});
	}

	/** A built-in package is disabled through its UI plugin's switch, which is also its package switch. */
	private builtinDisabled(packageRoot: string): boolean {
		if (!this.builtinPackages.has(packageRoot)) return false;
		for (const [name, item] of this.installedSources)
			if (item.packageRoot === packageRoot && this.config.plugins[name]?.enabled === false) return true;
		return false;
	}

	/** Called only for a path selected by the actual Pi extension loader. UI visibility grants no native authority. */
	nativeRuntimeName(path: string): string | undefined {
		let declared = resolve(path);
		try {
			declared = join(realpathSync(dirname(declared)), basename(declared));
		} catch (error) {
			log.warn("Selected extension directory is unavailable", path, error);
		}
		for (const [name, item] of this.packageSources)
			if (item.source.nativeDeclaredPath === declared) return name;
		try {
			const canonical = realpathSync(path);
			for (const [name, item] of this.packageSources)
				if (item.source.nativeEntrypoint === canonical) return name;
		} catch (error) {
			log.warn("Selected extension path is unavailable", path, error);
		}
		return undefined;
	}

	/** Only paths selected by the real SDK loader enter this host-only source classification. */
	classifyNativeSelection(path: string): SelectedNativeSource {
		const sources = this.runtimeSources();
		const name = this.nativeRuntimeName(path);
		const selected = sources.find((item) => item.name === name);
		return selected
			? { kind: "managed", source: selected.source, state: selected.state }
			: classifyUnmanagedNativePath(
					path,
					sources.map((item) => item.source),
				);
	}

	private runtimeSourceCurrent(source: InstalledUiRuntimeSource): boolean {
		return (
			realpathSync(source.installationPath) === source.packageRoot &&
			(!source.nativeDeclaredPath || realpathSync(source.nativeDeclaredPath) === source.nativeEntrypoint) &&
			installedPackageHash(source.packageRoot) === source.contentHash
		);
	}

	isNativeSourceAvailable(name: string): boolean {
		return this.packageSources.has(name) && this.runtimeSource(name) !== undefined;
	}

	private buildDirectory(sourceDirectory: string, contentHash?: string): string {
		return contentHash
			? join(app.getPath("userData"), "ui-plugin-builds", contentHash)
			: join(sourceDirectory, "dist");
	}

	/** Runtime activation additionally requires the global switch and explicit UI trust. */
	isEnabled(name: string): boolean {
		const info = this.infos.get(name);
		return Boolean(
			this.config.enabled &&
				info?.enabled &&
				info.trusted &&
				!info.invalidReason &&
				this.installedSourceCurrent(name),
		);
	}

	/**
	 * 确保插件已构建：dist 缺失或源码比 dist 新 → 构建；force=true 无条件重建。
	 * 失败记 buildError（旧产物保留继续生效）；无效插件/未知名返回 false。
	 */
	async ensureBuilt(name: string, force = false): Promise<boolean> {
		const info = this.infos.get(name);
		if (!info || info.invalidReason) return false;
		const pluginDir = this.dirNames.get(name);
		const manifest = await readManifest(pluginDir ?? "");
		if (!pluginDir || !manifest || typeof manifest.main !== "string") return false;
		const contentHash = this.installedPackageHashes.get(name)?.hash;
		const outDir = this.buildDirectory(pluginDir, contentHash);
		const dist = join(outDir, "index.js");
		try {
			let needsBuild = force || !existsSync(dist);
			if (!needsBuild && !contentHash) {
				const srcMtime = await newestMtime(pluginDir);
				const distStat = await stat(dist).catch(() => null);
				needsBuild = srcMtime === null || !distStat || srcMtime > distStat.mtimeMs;
			}
			if (needsBuild) {
				const res = await buildPlugin(pluginDir, manifest.main, { outDir });
				if (res.ok) {
					this.infos.set(name, { ...info, buildError: undefined, built: true });
				} else {
					this.infos.set(name, { ...info, buildError: res.error, built: existsSync(dist) });
				}
				return res.ok;
			}
			return true;
		} catch (err) {
			log.error("ensureBuilt failed", name, err);
			return false;
		}
	}

	/**
	 * 读插件构建产物（白名单：只接受扫描到的合法名；先 ensureBuilt 再读 dist/index.js）。
	 * 返回 { manifest, code } 或 { error }。
	 */
	async readCode(name: string): Promise<{ manifest: UiPluginManifest; code: string } | { error: string }> {
		if (!this.installedSourceCurrent(name))
			return { error: "UI plugin installation changed; reload required" };
		const info = this.infos.get(name);
		if (!info || info.invalidReason) return { error: `未知插件 ${name}` };
		const pluginDir = this.dirNames.get(name);
		if (!pluginDir) return { error: `未知插件 ${name}` };
		const ok = await this.ensureBuilt(name);
		const output = join(
			this.buildDirectory(pluginDir, this.installedPackageHashes.get(name)?.hash),
			"index.js",
		);
		if (!ok) {
			// 构建失败：旧产物存在则继续生效（spec §6，不清 dist）；buildError 已进 list 由面板展示
			if (!existsSync(output)) {
				return { error: this.infos.get(name)?.buildError ?? `构建失败：${name}` };
			}
		}
		try {
			const [manifest, code] = await Promise.all([readManifest(pluginDir), readFile(output, "utf-8")]);
			if (!manifest || validateManifest(name, manifest, this.runtimeSource(name)))
				return { error: "manifest 校验失败" };
			// 未知 region 条目已被过滤（与 scanAll 合成 info 同源），registry 只注册已知区域
			const cleanManifest: UiPluginManifest = {
				...(manifest as UiPluginManifest),
				contributions: filterContributions(manifest.contributions),
			};
			return { manifest: cleanManifest, code };
		} catch (err) {
			log.error("readCode failed", name, err);
			return { error: String(err) };
		}
	}

	/** 插件目录绝对路径（白名单：只接受扫描到的合法名；无效名返回 null） */
	pluginDirOf(name: string): string | null {
		return this.dirNames.get(name) ?? null;
	}

	/** 插件根目录绝对路径 */
	rootDir(): string {
		return pluginsDir();
	}

	/**
	 * 启动热重载 watcher：监听插件目录（recursive），变更落在某插件的 src/ 或 plugin.json
	 * → 300ms 防抖后重新扫描+构建（无论成败）→ 回调通知（推 { kind: "changed", name }）。
	 * dist/ 下的构建产物事件忽略（否则构建自身会触发重建死循环）；watch 失败只告警不致命。
	 * （内置插件已导出到本目录，天然被覆盖——无需第二路 watcher）
	 */
	startWatcher(onChange: (name: string) => void): void {
		if (this.watchers.length > 0) return;
		try {
			this.watchers.push(
				watch(pluginsDir(), { recursive: true }, (_event, filename) => {
					if (typeof filename !== "string") return;
					const rel = filename.split(/[\\/]/);
					const name = rel[0];
					if (!name || !NAME_RE.test(name)) return;
					const rest = rel.slice(1);
					if (rest.length === 0 || rest[0] === "dist") return; // 目录事件/构建产物忽略
					this.scheduleRebuild(name, onChange);
				}),
			);
		} catch (err) {
			log.error("fs.watch failed（热重载不可用，手动重建不受影响）", err);
		}
	}

	/** 300ms 防抖：连续保存只重建一次；插件已删除则 scanAll 清理后不再通知 */
	private scheduleRebuild(name: string, onChange: (name: string) => void): void {
		clearTimeout(this.rebuildTimers.get(name));
		this.rebuildTimers.set(
			name,
			setTimeout(() => {
				this.rebuildTimers.delete(name);
				void (async () => {
					await this.scanAll(); // 可能插件被删/改名/plugin.json 变更
					if (!this.infos.has(name)) return; // 插件没了：scanAll 已清缓存，无需通知
					await this.ensureBuilt(name); // 失败时 buildError 已更新（旧产物继续生效）
					onChange(name);
				})();
			}, 300),
		);
	}

	/** 关闭 watcher 并清防抖定时器（app will-quit 时调用） */
	disposeWatcher(): void {
		for (const timer of this.rebuildTimers.values()) clearTimeout(timer);
		this.rebuildTimers.clear();
		for (const w of this.watchers) w.close();
		this.watchers = [];
	}

	/** 写入配置补丁并刷新扫描缓存（enabled/trusted/assignments 变化后调用） */
	async updateConfig(patch: Partial<UiPluginsConfig>): Promise<void> {
		await saveUiPluginsConfig(patch);
		await this.scanAll();
	}
}
