import { legacyEvidenceNotice, PROTECTED_KNOWLEDGE_AGENTS, SUBAGENT_THINKING_LEVELS } from "@drone/shared";
import type { DroneUiRuntime } from "@gyoungwe/plugin-api/ui";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import { getPi } from "../api";
import { ImagePreviewOverlay } from "../components/chat/ImagePreview";
import { Markdown } from "../components/chat/Markdown";
import { taskArtifactLinks } from "../components/chat/TaskArtifactLinks";
import { displayName, summarizeArgs } from "../components/chat/ToolCallCard";
import { ChevronDownIcon, ObsidianIcon } from "../components/icons";
import { RoadmapLane, roadmapStatus } from "../components/route/Roadmap";
import { useAgentActive } from "../components/session/session-status";
import { ActionSurface } from "../components/ui/ActionSurface";
import { Button } from "../components/ui/Button";
import { Dropdown } from "../components/ui/Dropdown";
import { PageHeader } from "../components/ui/PageHeader";
import { StatePanel } from "../components/ui/StatePanel";
import { Switch } from "../components/ui/Switch";
import { Tooltip } from "../components/ui/Tooltip";
import { useContextUsage } from "../hooks/use-context-usage";
import { useLanguage } from "../hooks/use-language";
import { registerPluginMessages, useT } from "../i18n";
import { relativeTime } from "../lib/relative-time";
import { COMPOSER_FOCUS_EVENT, useDraftStore } from "../stores/drafts";
import { useKnowledgeStore } from "../stores/knowledge";
import { useProjectsStore } from "../stores/projects";
import { isDraftSessionId, useSessionsStore } from "../stores/sessions";
import { useSettingsStore } from "../stores/settings";
import { pushToast } from "../stores/toasts";
import { selectTranscript, useTranscriptStore } from "../stores/transcript";
import { useUiStore } from "../stores/ui";
import { useUiPreferencesStore } from "../stores/ui-preferences";
import type { DroneUiApi } from "./env";
import { PLUGIN_HOST_API_MANIFEST } from "./host-api.manifest";
import { knowledgeUiPort } from "./knowledge-api";
import { PluginEntryHost, usePluginEntries } from "./PluginRegions";
import { UI_REGIONS } from "./slots";

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
		StatePanel: StatePanel,
		Switch: Switch,
		ActionSurface: ActionSurface,
		PageHeader: PageHeader,
		ChevronDownIcon: ChevronDownIcon,
		ObsidianIcon: ObsidianIcon,
		RoadmapLane: RoadmapLane,
		PluginEntryHost: PluginEntryHost,
	},
	// </drone:generated namespace="components">
	// 挂钩 4：插件用宿主通道打开外部资源（zotero:// / obsidian:// 等自定义协议经主进程白名单）与普通链接
	// <drone:generated namespace="helpers">
	helpers: {
		summarizeArgs: summarizeArgs,
		displayToolName: displayName,
		openResourceExternal: (target: string, cwd?: string) => getPi().openResourceExternal(target, cwd),
		openExternal: (url: string) => getPi().openExternal(url),
		isDraftSessionId: isDraftSessionId,
		selectTranscript: selectTranscript,
		pushToast: pushToast,
		relativeTime: relativeTime,
		taskArtifactLinks: taskArtifactLinks,
		roadmapStatus: roadmapStatus,
		legacyEvidenceNotice: legacyEvidenceNotice,
		COMPOSER_FOCUS_EVENT: COMPOSER_FOCUS_EVENT,
		PROTECTED_KNOWLEDGE_AGENTS: PROTECTED_KNOWLEDGE_AGENTS,
		SUBAGENT_THINKING_LEVELS: SUBAGENT_THINKING_LEVELS,
		UI_REGIONS: UI_REGIONS,
	},
	// </drone:generated namespace="helpers">
	// <drone:generated namespace="hooks">
	hooks: {
		useT: useT,
		useContextUsage: useContextUsage,
		useLanguage: useLanguage,
		useAgentActive: useAgentActive,
		usePluginEntries: usePluginEntries,
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
		useDraftStore: useDraftStore,
	},
	// </drone:generated namespace="stores">
	// 挂钩 4：插件自带 i18n 条目（flow.status.* / 自定义键），无头插件 activate() 里注册、返回的清理函数里注销
	// <drone:generated namespace="knowledge">
	knowledge: {
		archiveKnowledgeTopic: knowledgeUiPort.archiveKnowledgeTopic,
		authorizeZoteroLocalWrite: knowledgeUiPort.authorizeZoteroLocalWrite,
		cancelKnowledgeModelReview: knowledgeUiPort.cancelKnowledgeModelReview,
		cancelKnowledgeSemanticIndex: knowledgeUiPort.cancelKnowledgeSemanticIndex,
		clearInstitutionalSession: knowledgeUiPort.clearInstitutionalSession,
		clearZoteroLocalWrite: knowledgeUiPort.clearZoteroLocalWrite,
		clearZoteroWebApi: knowledgeUiPort.clearZoteroWebApi,
		decideDailyIdea: knowledgeUiPort.decideDailyIdea,
		decideDailyRadarPaper: knowledgeUiPort.decideDailyRadarPaper,
		decideKnowledgeReview: knowledgeUiPort.decideKnowledgeReview,
		formalKnowledgeVault: knowledgeUiPort.formalKnowledgeVault,
		getDailyDiscovery: knowledgeUiPort.getDailyDiscovery,
		getInstitutionalStatus: knowledgeUiPort.getInstitutionalStatus,
		getKnowledgeCloudStatus: knowledgeUiPort.getKnowledgeCloudStatus,
		getKnowledgeGraph: knowledgeUiPort.getKnowledgeGraph,
		getKnowledgeJobs: knowledgeUiPort.getKnowledgeJobs,
		getKnowledgeMaintenanceRuns: knowledgeUiPort.getKnowledgeMaintenanceRuns,
		getKnowledgeMaintenanceSettings: knowledgeUiPort.getKnowledgeMaintenanceSettings,
		getKnowledgeNoteLinks: knowledgeUiPort.getKnowledgeNoteLinks,
		getKnowledgeOverview: knowledgeUiPort.getKnowledgeOverview,
		getKnowledgeReviews: knowledgeUiPort.getKnowledgeReviews,
		getKnowledgeSemanticStatus: knowledgeUiPort.getKnowledgeSemanticStatus,
		getKnowledgeTopics: knowledgeUiPort.getKnowledgeTopics,
		getResearchRun: knowledgeUiPort.getResearchRun,
		getResearchRuns: knowledgeUiPort.getResearchRuns,
		getZoteroLocalWrite: knowledgeUiPort.getZoteroLocalWrite,
		getZoteroStatus: knowledgeUiPort.getZoteroStatus,
		getZoteroWebApi: knowledgeUiPort.getZoteroWebApi,
		indexKnowledgeSemantic: knowledgeUiPort.indexKnowledgeSemantic,
		initializeKnowledgeCloud: knowledgeUiPort.initializeKnowledgeCloud,
		maintainKnowledge: knowledgeUiPort.maintainKnowledge,
		onKnowledgeEvent: knowledgeUiPort.onKnowledgeEvent,
		openExternal: knowledgeUiPort.openExternal,
		openInstitutionalLogin: knowledgeUiPort.openInstitutionalLogin,
		openKnowledgeTarget: knowledgeUiPort.openKnowledgeTarget,
		pickDirectory: knowledgeUiPort.pickDirectory,
		previewKnowledgeReview: knowledgeUiPort.previewKnowledgeReview,
		previewKnowledgeSetup: knowledgeUiPort.previewKnowledgeSetup,
		probeKnowledgeCloud: knowledgeUiPort.probeKnowledgeCloud,
		prompt: knowledgeUiPort.prompt,
		readKnowledgeCloudNote: knowledgeUiPort.readKnowledgeCloudNote,
		readKnowledgeNote: knowledgeUiPort.readKnowledgeNote,
		resumeKnowledgeCheck: knowledgeUiPort.resumeKnowledgeCheck,
		reviewKnowledgeWithModel: knowledgeUiPort.reviewKnowledgeWithModel,
		runKnowledgeMaintenance: knowledgeUiPort.runKnowledgeMaintenance,
		saveKnowledgeMaintenanceSettings: knowledgeUiPort.saveKnowledgeMaintenanceSettings,
		saveKnowledgeSemanticSettings: knowledgeUiPort.saveKnowledgeSemanticSettings,
		saveZoteroWebApi: knowledgeUiPort.saveZoteroWebApi,
		searchKnowledge: knowledgeUiPort.searchKnowledge,
		setKnowledgeCloudPassword: knowledgeUiPort.setKnowledgeCloudPassword,
		setKnowledgeSpecialistSettings: knowledgeUiPort.setKnowledgeSpecialistSettings,
		startKnowledgeSetup: knowledgeUiPort.startKnowledgeSetup,
		syncKnowledgeCloud: knowledgeUiPort.syncKnowledgeCloud,
		testInstitutionalAccess: knowledgeUiPort.testInstitutionalAccess,
		testKnowledgeSemanticProvider: knowledgeUiPort.testKnowledgeSemanticProvider,
		updateDailyDiscovery: knowledgeUiPort.updateDailyDiscovery,
	},
	// </drone:generated namespace="knowledge">
	// <drone:generated namespace="i18n">
	i18n: {
		registerMessages: registerPluginMessages,
	},
	// </drone:generated namespace="i18n">
} satisfies DroneUiApi & DroneUiRuntime;
