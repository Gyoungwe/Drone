import type {
	legacyEvidenceNotice,
	PROTECTED_KNOWLEDGE_AGENTS,
	SUBAGENT_THINKING_LEVELS,
} from "@drone/shared";
import type { KnowledgeUiPort } from "@gyoungwe/plugin-api/ui";
import type { ImagePreviewOverlay } from "../components/chat/ImagePreview";
import type { Markdown } from "../components/chat/Markdown";
import type { taskArtifactLinks } from "../components/chat/TaskArtifactLinks";
import type { displayName, summarizeArgs } from "../components/chat/ToolCallCard";
import type { ChevronDownIcon, ObsidianIcon } from "../components/icons";
import type { RoadmapLane, roadmapStatus } from "../components/route/Roadmap";
import type { useAgentActive } from "../components/session/session-status";
import type { ActionSurface } from "../components/ui/ActionSurface";
import type { Button } from "../components/ui/Button";
import type { Dropdown } from "../components/ui/Dropdown";
import type { PageHeader } from "../components/ui/PageHeader";
import type { StatePanel } from "../components/ui/StatePanel";
import type { Switch } from "../components/ui/Switch";
import type { Tooltip } from "../components/ui/Tooltip";
import type { useContextUsage } from "../hooks/use-context-usage";
import type { useLanguage } from "../hooks/use-language";
import type { registerPluginMessages, useT } from "../i18n";
import type { relativeTime } from "../lib/relative-time";
import type { COMPOSER_FOCUS_EVENT, useDraftStore } from "../stores/drafts";
import type { useKnowledgeStore } from "../stores/knowledge";
import type { useProjectsStore } from "../stores/projects";
import type { isDraftSessionId, useSessionsStore } from "../stores/sessions";
import type { useSettingsStore } from "../stores/settings";
import type { pushToast } from "../stores/toasts";
import type { selectTranscript, useTranscriptStore } from "../stores/transcript";
import type { useUiStore } from "../stores/ui";
import type { useUiPreferencesStore } from "../stores/ui-preferences";
import type { PluginEntryHost, usePluginEntries } from "./PluginRegions";
import type { usePluginRuntime } from "./runtime";
import type { UI_REGIONS } from "./slots";

/** window.DroneUI 的类型（插件与宿主自身代码共用；与 host-api.ts 的挂载内容一一对应） */
export interface DroneUiApi {
	version: 1;
	/** 完整命名空间对象（与宿主同一 React 实例） */
	React: typeof import("react");
	jsxRuntime: typeof import("react/jsx-runtime");
	ReactDOM: typeof import("react-dom");
	// <drone:generated namespace="components">
	components: {
		Button: typeof Button;
		Dropdown: typeof Dropdown;
		Tooltip: typeof Tooltip;
		Markdown: typeof Markdown;
		ImagePreview: typeof ImagePreviewOverlay;
		StatePanel: typeof StatePanel;
		Switch: typeof Switch;
		ActionSurface: typeof ActionSurface;
		PageHeader: typeof PageHeader;
		ChevronDownIcon: typeof ChevronDownIcon;
		ObsidianIcon: typeof ObsidianIcon;
		RoadmapLane: typeof RoadmapLane;
		PluginEntryHost: typeof PluginEntryHost;
	};
	// </drone:generated namespace="components">
	// <drone:generated namespace="helpers">
	helpers: {
		summarizeArgs: typeof summarizeArgs;
		displayToolName: typeof displayName;
		openResourceExternal: (target: string, cwd?: string) => Promise<void>;
		openExternal: (url: string) => Promise<void>;
		isDraftSessionId: typeof isDraftSessionId;
		selectTranscript: typeof selectTranscript;
		pushToast: typeof pushToast;
		relativeTime: typeof relativeTime;
		taskArtifactLinks: typeof taskArtifactLinks;
		roadmapStatus: typeof roadmapStatus;
		legacyEvidenceNotice: typeof legacyEvidenceNotice;
		COMPOSER_FOCUS_EVENT: typeof COMPOSER_FOCUS_EVENT;
		PROTECTED_KNOWLEDGE_AGENTS: typeof PROTECTED_KNOWLEDGE_AGENTS;
		SUBAGENT_THINKING_LEVELS: typeof SUBAGENT_THINKING_LEVELS;
		UI_REGIONS: typeof UI_REGIONS;
	};
	// </drone:generated namespace="helpers">
	// <drone:generated namespace="hooks">
	hooks: {
		useT: typeof useT;
		useContextUsage: typeof useContextUsage;
		useLanguage: typeof useLanguage;
		useAgentActive: typeof useAgentActive;
		usePluginEntries: typeof usePluginEntries;
		usePluginRuntime: typeof usePluginRuntime;
	};
	// </drone:generated namespace="hooks">
	// <drone:generated namespace="stores">
	stores: {
		useTranscriptStore: typeof useTranscriptStore;
		useSessionsStore: typeof useSessionsStore;
		useUiStore: typeof useUiStore;
		useProjectsStore: typeof useProjectsStore;
		useSettingsStore: typeof useSettingsStore;
		useUiPreferencesStore: typeof useUiPreferencesStore;
		useKnowledgeStore: typeof useKnowledgeStore;
		useDraftStore: typeof useDraftStore;
	};
	// </drone:generated namespace="stores">
	// <drone:generated namespace="knowledge">
	knowledge: {
		archiveKnowledgeTopic: KnowledgeUiPort["archiveKnowledgeTopic"];
		authorizeZoteroLocalWrite: KnowledgeUiPort["authorizeZoteroLocalWrite"];
		cancelKnowledgeModelReview: KnowledgeUiPort["cancelKnowledgeModelReview"];
		cancelKnowledgeSemanticIndex: KnowledgeUiPort["cancelKnowledgeSemanticIndex"];
		clearInstitutionalSession: KnowledgeUiPort["clearInstitutionalSession"];
		clearZoteroLocalWrite: KnowledgeUiPort["clearZoteroLocalWrite"];
		clearZoteroWebApi: KnowledgeUiPort["clearZoteroWebApi"];
		decideDailyIdea: KnowledgeUiPort["decideDailyIdea"];
		decideDailyRadarPaper: KnowledgeUiPort["decideDailyRadarPaper"];
		decideKnowledgeReview: KnowledgeUiPort["decideKnowledgeReview"];
		formalKnowledgeVault: KnowledgeUiPort["formalKnowledgeVault"];
		getDailyDiscovery: KnowledgeUiPort["getDailyDiscovery"];
		getInstitutionalStatus: KnowledgeUiPort["getInstitutionalStatus"];
		getKnowledgeCloudStatus: KnowledgeUiPort["getKnowledgeCloudStatus"];
		getKnowledgeGraph: KnowledgeUiPort["getKnowledgeGraph"];
		getKnowledgeJobs: KnowledgeUiPort["getKnowledgeJobs"];
		getKnowledgeMaintenanceRuns: KnowledgeUiPort["getKnowledgeMaintenanceRuns"];
		getKnowledgeMaintenanceSettings: KnowledgeUiPort["getKnowledgeMaintenanceSettings"];
		getKnowledgeNoteLinks: KnowledgeUiPort["getKnowledgeNoteLinks"];
		getKnowledgeOverview: KnowledgeUiPort["getKnowledgeOverview"];
		getKnowledgeReviews: KnowledgeUiPort["getKnowledgeReviews"];
		getKnowledgeSemanticStatus: KnowledgeUiPort["getKnowledgeSemanticStatus"];
		getKnowledgeTopics: KnowledgeUiPort["getKnowledgeTopics"];
		getResearchRun: KnowledgeUiPort["getResearchRun"];
		getResearchRuns: KnowledgeUiPort["getResearchRuns"];
		getZoteroLocalWrite: KnowledgeUiPort["getZoteroLocalWrite"];
		getZoteroStatus: KnowledgeUiPort["getZoteroStatus"];
		getZoteroWebApi: KnowledgeUiPort["getZoteroWebApi"];
		indexKnowledgeSemantic: KnowledgeUiPort["indexKnowledgeSemantic"];
		initializeKnowledgeCloud: KnowledgeUiPort["initializeKnowledgeCloud"];
		maintainKnowledge: KnowledgeUiPort["maintainKnowledge"];
		onKnowledgeEvent: KnowledgeUiPort["onKnowledgeEvent"];
		openExternal: KnowledgeUiPort["openExternal"];
		openInstitutionalLogin: KnowledgeUiPort["openInstitutionalLogin"];
		openKnowledgeTarget: KnowledgeUiPort["openKnowledgeTarget"];
		pickDirectory: KnowledgeUiPort["pickDirectory"];
		previewKnowledgeReview: KnowledgeUiPort["previewKnowledgeReview"];
		previewKnowledgeSetup: KnowledgeUiPort["previewKnowledgeSetup"];
		probeKnowledgeCloud: KnowledgeUiPort["probeKnowledgeCloud"];
		prompt: KnowledgeUiPort["prompt"];
		readKnowledgeCloudNote: KnowledgeUiPort["readKnowledgeCloudNote"];
		readKnowledgeNote: KnowledgeUiPort["readKnowledgeNote"];
		resumeKnowledgeCheck: KnowledgeUiPort["resumeKnowledgeCheck"];
		reviewKnowledgeWithModel: KnowledgeUiPort["reviewKnowledgeWithModel"];
		runKnowledgeMaintenance: KnowledgeUiPort["runKnowledgeMaintenance"];
		saveKnowledgeMaintenanceSettings: KnowledgeUiPort["saveKnowledgeMaintenanceSettings"];
		saveKnowledgeSemanticSettings: KnowledgeUiPort["saveKnowledgeSemanticSettings"];
		saveZoteroWebApi: KnowledgeUiPort["saveZoteroWebApi"];
		searchKnowledge: KnowledgeUiPort["searchKnowledge"];
		setKnowledgeCloudPassword: KnowledgeUiPort["setKnowledgeCloudPassword"];
		setKnowledgeSpecialistSettings: KnowledgeUiPort["setKnowledgeSpecialistSettings"];
		startKnowledgeSetup: KnowledgeUiPort["startKnowledgeSetup"];
		syncKnowledgeCloud: KnowledgeUiPort["syncKnowledgeCloud"];
		testInstitutionalAccess: KnowledgeUiPort["testInstitutionalAccess"];
		testKnowledgeSemanticProvider: KnowledgeUiPort["testKnowledgeSemanticProvider"];
		updateDailyDiscovery: KnowledgeUiPort["updateDailyDiscovery"];
	};
	// </drone:generated namespace="knowledge">
	// <drone:generated namespace="i18n">
	i18n: {
		registerMessages: typeof registerPluginMessages;
	};
	// </drone:generated namespace="i18n">
}

declare global {
	interface Window {
		DroneUI: DroneUiApi;
	}
}
