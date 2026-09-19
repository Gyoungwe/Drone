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

/**
 * 宿主 API：把宿主能力挂到 window.DroneUI（插件运行时的唯一入口，与宿主共享同一 React 实例）。
 * 暴露清单与 main/ui-plugins/build.ts 的 SHIMS、Phase 2 的 resources/ui-plugins/drone-ui.d.ts
 * **逐名一致**（新增暴露 = 改这三处 + host-api + shim + drone-ui.d.ts，同步进行）。
 * main.tsx 在 render 前 import 本模块（副作用挂载），确保任何插件代码运行前已就绪。
 */
window.DroneUI = {
	version: 1,
	// 完整命名空间对象（不是具名导入）：保证插件拿到与宿主同一实例
	React,
	jsxRuntime,
	ReactDOM,
	components: {
		Button,
		Dropdown,
		Tooltip,
		Markdown,
		ImagePreview: ImagePreviewOverlay,
	},
	helpers: {
		summarizeArgs,
		displayToolName: displayName,
		// 挂钩 4：插件用宿主通道打开外部资源（zotero:// / obsidian:// 等自定义协议经主进程白名单）与普通链接
		openResourceExternal: (target: string, cwd?: string) => getPi().openResourceExternal(target, cwd),
		openExternal: (url: string) => getPi().openExternal(url),
	},
	hooks: {
		useT,
		useContextUsage,
		useLanguage,
	},
	stores: {
		useTranscriptStore,
		useSessionsStore,
		useUiStore,
		useProjectsStore,
		useSettingsStore,
		useUiPreferencesStore,
		useKnowledgeStore,
	},
	// 挂钩 4：插件自带 i18n 条目（flow.status.* / 自定义键），无头插件 activate() 里注册、返回的清理函数里注销
	i18n: { registerMessages: registerPluginMessages },
} satisfies DroneUiApi;
