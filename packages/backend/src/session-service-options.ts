import type { DroneRuntime, HarnessUnit } from "@drone/shared";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { KnowledgeUiServicePort } from "./knowledge/ui";
import type { PluginSandboxPolicy } from "./plugin-sandbox";
import type { PluginNativeIntegration } from "./plugins/coordinator";
import type { BackgroundReviewerFactory } from "./services/deliverable-reviewer";
import type { PermissionSettingsService } from "./services/permissions";

export interface SessionServiceOptions {
	/** 已登记的远程主机目录（由组合根接到计算主机登记表），供 ssh / ssh_hosts 工具使用 */
	listSshHosts?: () => Promise<import("./tools/ssh").SshHostEntry[]>;
	/** 观察记忆库；缺省不捕获、不注入。 */
	memory?: import("./memory/store").MemoryStore;
	/** 默认工作目录（createSession 未指定时使用） */
	defaultCwd?: string;
	/** 每会话工具白名单；缺省用 pi 默认（read/bash/edit/write） */
	tools?: string[];
	/** 额外自定义工具 */
	customTools?: ToolDefinition[];
	/** Tool/Skill 能力按需暴露（默认 true）；false 保留 SDK 全量工具行为，供兼容/测试。 */
	lazyCapabilities?: boolean;
	/** 重开会话发现最近被中断的 safe 工具时，自动发起只读恢复重跑（默认 true）。 */
	autoResumeInterrupted?: boolean;
	/** 是否启用权限确认门控（false 时 confirm 直接通过） */
	permissionGates?: boolean;
	/** 是否注册内置权限门控扩展（false 时逐工具规则不生效；用户换用自己的权限扩展时关闭）。permissionGates=false 时强制不注册 */
	permissionExtension?: boolean;
	/** 是否注册模型上下文合同与 compact checkpoint 扩展（默认 true）。 */
	harnessContext?: boolean;
	/** 独立 harness 单元开关；缺省全部启用，harnessContext=false 仍优先关闭全部。 */
	harness?: Partial<Record<HarnessUnit, boolean>>;
	/** 是否启用项目信任门控（false 时所有项目自动信任，项目资源直接加载；供无人值守场景用） */
	projectTrust?: boolean;
	/** 是否内置 webfetch 工具（默认 true）；传对象可配置 CIDR 放行 */
	webFetch?: boolean | { allowRanges?: string[] };
	/** 内置 subagent 优先于第三方 subagent 扩展（默认 true） */
	subagentPreferBuiltin?: boolean;
	/** 桌面端 userData 根目录，用于诊断存储清单；不读取其中的文件内容。 */
	userDataDir?: string;
	/** Host-owned runtime container; omitted only for direct compatibility construction. */
	runtime?: DroneRuntime;
	/** Optional knowledge domain provider; the default remains the host compatibility adapter. */
	knowledgeFactory?: () => KnowledgeUiServicePort;
	/** Temporary explicit 0.3 host adapter; no default optional-package import. */
	knowledgeSpecialistModelLoop?: import("@gyoungwe/plugin-api").LegacyKnowledgeSpecialistLoop;
	/** Optional background reviewer factory supplied by an installed knowledge plugin. */
	knowledgeBackgroundReviewerFactory?: BackgroundReviewerFactory;
	/** Optional project research-state root registered for the inquiry adapter. */
	inquiryDir?: string;
	/** Host-wide root for per-project inquiry ledgers. */
	projectsDir?: string;
	/** Existing v0.19.0 single ledger, mounted read-only for preservation. */
	legacyInquiryDir?: string;
	/** Host-owned permission settings service; omitted for direct compatibility construction. */
	permissions?: PermissionSettingsService;
	/**
	 * 桌面端集成（Electron 专用；纯 CLI 环境不传）：
	 * appendSystemPrompt = 追加进每次会话系统提示词的段落（如「你运行在 Drone 桌面端，界面可被 UI 插件定制」）；
	 * additionalSkillPaths = 额外技能目录（如随包分发的 drone-ui-plugin skill，描述原生进可用技能清单）。
	 */
	desktopIntegration?: {
		appendSystemPrompt: string[];
		additionalSkillPaths: string[];
		additionalExtensionPaths?: string[];
		/** Optional third-party extensions loaded through the process sandbox proxy. */
		sandboxedExtensions?: PluginSandboxPolicy[];
		pluginRuntimeDirectory?: string;
		nativeRuntime?: PluginNativeIntegration;
		additionalPromptTemplatePaths?: string[];
		academicPiRoot?: string;
		/** Entry file of the bundled MCP runtime (pi-mcp-adapter/index.ts); loaded as an extension. */
		mcpRuntimePath?: string;
	};
}
