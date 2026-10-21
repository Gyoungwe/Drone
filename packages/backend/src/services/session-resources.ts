import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	DRONE_PLUGIN_METADATA,
	type DronePackageManifest,
	dronePluginSource,
	type HostPluginPackage,
	type LoadedResources,
	type McpStatus,
	type McpStatus as McpStatusType,
	normalizeMcpStatus,
	type PiPackageManifest,
	RESEARCH_SKILL_SOURCES,
	type ResourceDiagnosticInfo,
	researchSkillProfile,
	type SlashCommandInfo,
} from "@drone/shared";

type McpHandler = (cwd: string, status: McpStatusType) => void;

import { allSkillsFromLoader } from "../capabilities/resource-loader";
import type { CapabilityRuntime } from "../capabilities/runtime";
import { getKnowledgeWorkerLifecycle } from "../knowledge/ui";
import { describeMcpStatusChange, type McpService } from "./../mcp/service";
import type { ProjectResourceLoader } from "../project/trust-loader";
import type { RegisteredSession, SessionRegistry } from "../session/registry";
import type { SessionEngine } from "../session-engine/engine";
import type { SessionServiceOptions } from "../session-service";
import { presentExtensionCommands, slashCommandsForLoader, slashCommandsForSession } from "../slash-commands";

export interface SessionResourceHost {
	readonly options: SessionServiceOptions;
	readonly registry: SessionRegistry;
	readonly sessionEngine: SessionEngine;
	readonly capabilityRuntimes: Map<string, CapabilityRuntime>;
	readonly mcp: McpService;
	readonly projectLoader: ProjectResourceLoader;
	requireSession(id: string): RegisteredSession;
	reapplyCapabilities(id: string): void;
	log: {
		info: (message: string, ...args: unknown[]) => void;
		warn: (message: string, ...args: unknown[]) => void;
	};
}

export class SessionResourceService {
	private readonly mcpHandlers = new Set<(cwd: string, status: McpStatus) => void>();
	constructor(private readonly host: SessionResourceHost) {}

	/**
	 * Resolve the upstream identity of a skill without trusting the loader's
	 * short `local`/`auto` labels.  Built-in research packs are mapped from the
	 * source catalog; ordinary Pi packages fall back to their package metadata.
	 * Integrity pins stay inside the pack loader and updater and are not exposed
	 * as product provenance.
	 */
	private skillRepository(
		name: string,
		filePath: string,
		source: string,
	): { repository: string; path?: string } | undefined {
		const normalizedPath = filePath.replaceAll("\\", "/");
		const profile = researchSkillProfile(name);
		const sourceEntry = profile
			? RESEARCH_SKILL_SOURCES.find((entry) => entry.id === profile.source)
			: RESEARCH_SKILL_SOURCES.find((entry) =>
					entry.skills.some(
						(skill) =>
							normalizedPath.endsWith(`/${skill.path}`) ||
							normalizedPath.endsWith(`/skills/${skill.name}/SKILL.md`),
					),
				);
		if (sourceEntry) {
			const locked = profile ?? sourceEntry.skills.find((skill) => normalizedPath.endsWith(`/${skill.path}`));
			return {
				repository: `https://github.com/${sourceEntry.repository}`,
				...(locked?.path ? { path: locked.path } : {}),
			};
		}

		const github = this.githubRepository(source);
		if (github) return { repository: github };
		let current = dirname(filePath);
		for (let i = 0; i < 8; i++) {
			const packageJson = join(current, "package.json");
			if (existsSync(packageJson)) {
				try {
					const parsed = JSON.parse(readFileSync(packageJson, "utf8")) as {
						repository?: string | { url?: string };
					};
					const repository =
						typeof parsed.repository === "string" ? parsed.repository : parsed.repository?.url;
					const normalized = repository ? this.githubRepository(repository) : undefined;
					if (normalized) return { repository: normalized };
				} catch {
					// A malformed optional package manifest must not hide the skill.
				}
			}
			const parent = dirname(current);
			if (parent === current) break;
			current = parent;
		}
		return undefined;
	}

	private githubRepository(value: string): string | undefined {
		const match = value.trim().match(/(?:github\.com[/:])([^/]+\/[^/#]+)|^github:([^/]+\/[^/#]+)$/iu);
		const repository = (match?.[1] ?? match?.[2])?.replace(/\.git$/u, "");
		return repository ? `https://github.com/${repository}` : undefined;
	}

	/**
	 * Pi's resource loader exposes the extension path, but not the package that
	 * owns a bundled extension. Keep the host-owned package inventory explicit so
	 * the desktop Plugins view can account for the capabilities shipped by Drone
	 * and the optional installed UI pack.
	 */
	private hostPluginPackages(): HostPluginPackage[] {
		const require = createRequire(import.meta.url);
		const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
		const entries = [
			{ name: "@gyoungwe/pi-core", host: "desktop" as const },
			{ name: "@gyoungwe/pi-knowledge", host: "pi" as const },
			{ name: "@gyoungwe/pi-research", host: "pi" as const },
			{ name: "@gyoungwe/pi-analysis", host: "pi" as const },
			{ name: "@gyoungwe/pi-evidence", host: "pi" as const },
			{ name: "@gyoungwe/pi-connectors", host: "pi" as const },
			{ name: "@gyoungwe/desktop-ui-pack", host: "desktop" as const },
			{ name: "@gyoungwe/research-suite", host: "pi" as const },
		];
		const knowledgeLifecycle = getKnowledgeWorkerLifecycle();
		return entries.map((entry) => {
			const metadata = DRONE_PLUGIN_METADATA[entry.name as keyof typeof DRONE_PLUGIN_METADATA];
			const packageJson =
				entry.name === "@gyoungwe/desktop-ui-pack"
					? (() => {
							const candidate = join(
								agentDir,
								"npm",
								"node_modules",
								"@gyoungwe",
								"desktop-ui-pack",
								"package.json",
							);
							return existsSync(candidate) ? candidate : null;
						})()
					: this.packageJsonPath(require, entry.name);
			const version = packageJson ? this.readPackageVersion(packageJson) : metadata.version;
			const packageData = packageJson ? this.readPackage(packageJson) : undefined;
			const manifestData = packageJson ? this.readManifest(dirname(packageJson)) : undefined;
			const source = packageData ? dronePluginSource(packageData, manifestData) : undefined;
			const lifecycle = entry.name === "@gyoungwe/pi-knowledge" ? knowledgeLifecycle : undefined;
			return {
				...entry,
				version,
				status: packageJson ? "available" : "unavailable",
				...(lifecycle
					? {
							currentVersion: lifecycle.currentVersion,
							nextSessionVersion: lifecycle.nextSessionVersion,
							lifecycleState: lifecycle.state,
							...(lifecycle.lastError ? { lastLifecycleError: lifecycle.lastError } : {}),
						}
					: {}),
				description: metadata.description,
				...(metadata.packageKind ? { packageKind: metadata.packageKind } : {}),
				...(metadata.capabilities ? { capabilities: [...metadata.capabilities] } : {}),
				...(metadata.tools ? { tools: [...metadata.tools] } : {}),
				...(metadata.permissions ? { permissions: metadata.permissions } : {}),
				source: source ? "drone" : "unknown",
				...(source
					? {
							packageKind: source.packageKind,
							description: source.description,
							capabilities: [...source.capabilities],
							piApiVersion: source.piApiVersion,
							pluginApi: source.pluginApi,
							minHostVersion: source.minHostVersion,
							hosts: [...source.hosts],
							tools: [...source.tools],
							permissions: source.permissions,
							manifestDeclared: Boolean(manifestData),
						}
					: {}),
			};
		});
	}

	private readPackage(path: string): PiPackageManifest | undefined {
		try {
			return JSON.parse(readFileSync(path, "utf8")) as PiPackageManifest;
		} catch {
			return undefined;
		}
	}

	private readManifest(root: string): DronePackageManifest | undefined {
		try {
			const manifestPath = existsSync(join(root, "plugin.manifest.json"))
				? join(root, "plugin.manifest.json")
				: join(root, "ui", "plugin.json");
			const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
			if (manifestPath.endsWith(`${join("ui", "plugin.json")}`)) {
				return {
					version: typeof parsed.version === "string" ? parsed.version : undefined,
					entrypoints: { ui: "./ui/plugin.json" },
					capabilities: ["ui"],
					hosts: ["drone-desktop"],
				};
			}
			return parsed as DronePackageManifest;
		} catch {
			return undefined;
		}
	}

	private packageJsonPath(require: NodeRequire, name: string): string | null {
		try {
			const resolved = require.resolve(name);
			let current = dirname(resolved);
			for (let i = 0; i < 5; i++) {
				const candidate = join(current, "package.json");
				if (existsSync(candidate)) return candidate;
				const parent = dirname(current);
				if (parent === current) break;
				current = parent;
			}
		} catch {
			// An optional package is still shown as unavailable below.
		}
		return null;
	}

	private readPackageVersion(path: string): string {
		try {
			const parsed = JSON.parse(readFileSync(path, "utf8")) as { version?: unknown };
			return typeof parsed.version === "string" ? parsed.version : "unknown";
		} catch {
			return "unknown";
		}
	}

	/** 列出斜杠命令：内置（标记 supported）+ prompt 模板 + skill + 扩展命令 */
	async listSlashCommands(sessionId: string): Promise<SlashCommandInfo[]> {
		return slashCommandsForSession(this.host.requireSession(sessionId).session);
	}

	/**
	 * 无会话列出斜杠命令（draft 新会话的补全数据源）：三类命令都只依赖
	 * DefaultResourceLoader（扩展命令在加载期注册进 ext.commands），无需建会话。
	 * 信任未决的项目不弹窗、按不信任只加载用户级资源（弹窗已在选目录时前置）。
	 */
	async listSlashCommandsForCwd(cwd?: string): Promise<SlashCommandInfo[]> {
		const target = cwd || this.host.options.defaultCwd || process.cwd();
		const { resourceLoader } = await this.host.projectLoader.load(target, {
			askTrust: false,
		});
		return slashCommandsForLoader(resourceLoader);
	}

	/** 项目信任前置决策（添加项目/切换 draft cwd 时由 renderer 调用） */
	async ensureProjectTrust(cwd: string): Promise<boolean> {
		return this.host.projectLoader.ensureTrust(cwd);
	}

	/** 扩展显示名：`<inline:N>` 原样，目录式扩展取最后一段（剥 index.ts 后缀） */
	private extensionDisplayName(path: string): string {
		const cleaned = path.replace(/\/index\.(ts|js)$/, "");
		const base = cleaned.split("/").filter(Boolean).pop();
		return base ?? path;
	}

	/** 读取会话已加载的资源（skills/扩展；设置页展示用） */
	async getLoadedResources(sessionId: string): Promise<LoadedResources> {
		const entry = this.host.requireSession(sessionId);
		const session = entry.session;
		const loader = session.resourceLoader as typeof session.resourceLoader & {
			getAllSkillsIncludingDisabled?: () => ReturnType<typeof session.resourceLoader.getSkills>;
		};
		const skillResult =
			loader.getAllSkillsIncludingDisabled?.() ?? allSkillsFromLoader(session.resourceLoader);
		const extResult = session.resourceLoader.getExtensions();
		const firstToolOwner = new Map<string, { path: string; source: string }>();
		const toolCollisions: ResourceDiagnosticInfo[] = [];
		for (const extension of extResult.extensions) {
			for (const toolName of extension.tools.keys()) {
				const owner = firstToolOwner.get(toolName);
				if (!owner) {
					firstToolOwner.set(toolName, { path: extension.path, source: extension.sourceInfo.source });
					continue;
				}
				if (owner.path === extension.path) continue;
				toolCollisions.push({
					type: "collision",
					message: `Tool "${toolName}" is declared by ${owner.source} and ${extension.sourceInfo.source}; keeping the first registration.`,
					path: extension.path,
				});
			}
		}
		return {
			skills: skillResult.skills.map((skill) => {
				const upstream = this.skillRepository(skill.name, skill.filePath, skill.sourceInfo.source);
				return {
					name: skill.name,
					description: skill.description,
					scope: skill.sourceInfo.scope,
					source: skill.sourceInfo.source,
					path: skill.filePath,
					...(upstream
						? {
								repository: upstream.repository,
								...(upstream.path ? { repositoryPath: upstream.path } : {}),
							}
						: {}),
					disableModelInvocation: skill.disableModelInvocation,
				};
			}),
			skillDiagnostics: [
				...skillResult.diagnostics.map((d) => ({
					type: d.type,
					message: d.message,
					path: d.path,
				})),
				...toolCollisions,
			],
			extensions: extResult.extensions.map((ext) => ({
				name: this.extensionDisplayName(ext.path),
				path: ext.path,
				scope: ext.sourceInfo.scope,
				source: ext.sourceInfo.source,
				hidden: ext.hidden === true,
				toolsCount: ext.tools.size,
				tools: [...ext.tools.keys()],
				commands: presentExtensionCommands(
					[...ext.commands.values()].map((command) => ({
						...command,
						invocationName: command.name,
					})),
				).map((command) => command.name),
				flagsCount: ext.flags.size,
				shortcutsCount: ext.shortcuts.size,
			})),
			extensionErrors: extResult.errors,
			hostPlugins: this.hostPluginPackages(),
			...(this.host.capabilityRuntimes.get(sessionId)
				? { capabilities: this.host.capabilityRuntimes.get(sessionId)?.state() }
				: {}),
		};
	}

	/**
	 * MCP 配置变更后热重载空闲会话，对齐 CLI /reload。传 cwd 只重载该项目的会话；
	 * 不传表示改的是用户级配置（影响所有项目），重载全部会话。
	 */
	async reloadMcpSessions(cwd?: string): Promise<void> {
		const target = cwd ? resolve(cwd) : undefined;
		for (const entry of this.host.registry.list()) {
			if (target && resolve(entry.cwd) !== target) continue;
			if (entry.session.isStreaming || entry.session.isCompacting) {
				this.host.log.info("skip MCP reload while session busy", entry.session.sessionId, {
					cwd: entry.cwd,
				});
				continue;
			}
			try {
				await this.host.sessionEngine.reload(entry.session);
				this.host.reapplyCapabilities(entry.session.sessionId);
			} catch (err) {
				this.host.log.warn("MCP session reload failed", entry.session.sessionId, err);
			}
		}
	}

	onMcpStatus(handler: McpHandler): () => void {
		this.mcpHandlers.add(handler);
		return () => this.mcpHandlers.delete(handler);
	}

	setMcpStatus(cwd: string, payload: McpStatus): void {
		const status = normalizeMcpStatus(payload);
		if (!status) {
			this.host.log.warn("ignored malformed MCP runtime status", { cwd });
			return;
		}
		for (const line of describeMcpStatusChange(this.host.mcp.peekStatus(cwd), status))
			this.host.log[line.level](line.message, { cwd, ...line.data });
		this.host.mcp.setStatus(status, cwd);
		const published = this.host.mcp.getStatus(cwd);
		for (const handler of this.mcpHandlers) handler(cwd, published);
	}
}
