import type { AppApi } from "./app";
import type { BackgroundJobsApi } from "./background-jobs";
import type { ComputeApi } from "./compute";
import type { DiscoveryApi } from "./discovery";
import type { EvidenceApi } from "./evidence";
import type { InstitutionalApi } from "./institutional";
import type { KnowledgeHostApi } from "./knowledge";
import type { McpApi } from "./mcp";
import type { MemoryApi } from "./memory";
import type { PackagesApi } from "./packages";
import type { PermissionsApi } from "./permissions";
import type { PluginCredentialsApi } from "./plugin-credentials";
import type { PluginRuntimeApi } from "./plugin-runtime";
import type { ResearchApi } from "./research";
import type { SessionsApi } from "./sessions";
import type { SettingsApi } from "./settings";
import type { SubagentsApi } from "./subagents";
import type { UiPluginsApi } from "./ui-plugins";

export * from "./app";
export * from "./background-jobs";
export * from "./compute";
export * from "./define";
export * from "./discovery";
export * from "./evidence";
export * from "./institutional";
export * from "./knowledge";
export * from "./mcp";
export * from "./memory";
export * from "./packages";
export * from "./permissions";
export * from "./plugin-credentials";
export * from "./plugin-runtime";
export * from "./research";
export * from "./sessions";
export * from "./settings";
export * from "./subagents";
export * from "./ui-plugins";

/** 渲染进程经 preload 暴露的 window.pi 类型 */
export interface PiApi
	extends SessionsApi<"desktop">,
		ComputeApi,
		DiscoveryApi,
		EvidenceApi,
		ResearchApi,
		PluginCredentialsApi,
		BackgroundJobsApi,
		KnowledgeHostApi,
		SubagentsApi,
		InstitutionalApi,
		MemoryApi,
		McpApi,
		UiPluginsApi,
		PluginRuntimeApi,
		PackagesApi,
		SettingsApi,
		PermissionsApi,
		AppApi {}
