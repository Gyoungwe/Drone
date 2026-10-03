import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import { getPi } from "../api";
import { ImagePreviewOverlay } from "../components/chat/ImagePreview";
import { Markdown } from "../components/chat/Markdown";
import { displayName, summarizeArgs } from "../components/chat/ToolCallCard";
import { Button } from "../components/ui/Button";
import { Dropdown } from "../components/ui/Dropdown";
import { Tooltip } from "../components/ui/Tooltip";
import { useContextUsage } from "../hooks/use-context-usage";
import { useLanguage } from "../hooks/use-language";
import { registerPluginMessages, useT } from "../i18n";
import { useKnowledgeStore } from "../stores/knowledge";
import { useProjectsStore } from "../stores/projects";
import { useSessionsStore } from "../stores/sessions";
import { useSettingsStore } from "../stores/settings";
import { useTranscriptStore } from "../stores/transcript";
import { useUiStore } from "../stores/ui";
import { useUiPreferencesStore } from "../stores/ui-preferences";
import type { DroneUiApi } from "./env";
import { PLUGIN_HOST_API_MANIFEST } from "./host-api.manifest";

/**
 * 宿主 API：把宿主能力挂到 window.DroneUI（插件运行时的唯一入口，与宿主共享同一 React 实例）。
 * 暴露清单与 main/ui-plugins/build.ts 的 SHIMS、Phase 2 的 resources/ui-plugins/drone-ui.d.ts
 * 由 host-api.manifest.json 统一生成，标记区外的实现细节保留在宿主侧。
 * main.tsx 在 render 前 import 本模块（副作用挂载），确保任何插件代码运行前已就绪。
 */
window.DroneUI = {
	version: PLUGIN_HOST_API_MANIFEST.version,
	// 完整命名空间对象（不是具名导入）：保证插件拿到与宿主同一实例
	React,
	jsxRuntime,
	ReactDOM,
	// <drone:generated namespace="components">
	components: {
		Button: Button,
		Dropdown: Dropdown,
		Tooltip: Tooltip,
		Markdown: Markdown,
		ImagePreview: ImagePreviewOverlay,
	},
	// </drone:generated namespace="components">
	// 挂钩 4：插件用宿主通道打开外部资源（zotero:// / obsidian:// 等自定义协议经主进程白名单）与普通链接
	// <drone:generated namespace="helpers">
	helpers: {
		summarizeArgs: summarizeArgs,
		displayToolName: displayName,
		openResourceExternal: (target: string, cwd?: string) => getPi().openResourceExternal(target, cwd),
		openExternal: (url: string) => getPi().openExternal(url),
	},
	// </drone:generated namespace="helpers">
	// <drone:generated namespace="hooks">
	hooks: {
		useT: useT,
		useContextUsage: useContextUsage,
		useLanguage: useLanguage,
	},
	// </drone:generated namespace="hooks">
	// <drone:generated namespace="stores">
	stores: {
		useTranscriptStore: useTranscriptStore,
		useSessionsStore: useSessionsStore,
		useUiStore: useUiStore,
		useProjectsStore: useProjectsStore,
		useSettingsStore: useSettingsStore,
		useUiPreferencesStore: useUiPreferencesStore,
		useKnowledgeStore: useKnowledgeStore,
	},
	// </drone:generated namespace="stores">
	// 挂钩 4：插件自带 i18n 条目（flow.status.* / 自定义键），无头插件 activate() 里注册、返回的清理函数里注销
	// <drone:generated namespace="i18n">
	i18n: {
		registerMessages: registerPluginMessages,
	},
	// </drone:generated namespace="i18n">
} satisfies DroneUiApi;
