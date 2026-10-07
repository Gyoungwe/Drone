import { resolve } from "node:path";
import {
	type LoadedResources,
	type McpStatus,
	type McpStatus as McpStatusType,
	normalizeMcpStatus,
	type SlashCommandInfo,
} from "@drone/shared";

type McpHandler = (cwd: string, status: McpStatusType) => void;

import { allSkillsFromLoader } from "../capabilities/resource-loader";
import type { CapabilityRuntime } from "../capabilities/runtime";
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
		const skillResult = allSkillsFromLoader(session.resourceLoader);
		const extResult = session.resourceLoader.getExtensions();
		return {
			skills: skillResult.skills.map((skill) => ({
				name: skill.name,
				description: skill.description,
				scope: skill.sourceInfo.scope,
				source: skill.sourceInfo.source,
				path: skill.filePath,
				disableModelInvocation: skill.disableModelInvocation,
			})),
			skillDiagnostics: skillResult.diagnostics.map((d) => ({
				type: d.type,
				message: d.message,
				path: d.path,
			})),
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
