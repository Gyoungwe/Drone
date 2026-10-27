/**
 * Drone UI 插件 API 类型声明。
 * ⚠️ 与宿主 `packages/desktop/src/main/ui-plugins/build.ts` 的 SHIMS、`plugins/host-api.ts`
 * 的挂载内容**逐名一致**（三处不可漂移）——agent 写代码时类型来源就是本文件，
 * 少一个名字 agent 就会写出跑不起来的插件。宿主侧新增暴露时同步本文件。
 */

/* ---------- react（虚拟模块，构建时重写到 window.DroneUI.React） ---------- */

declare module "react" {
	export type ReactNode = unknown;
	export type ComponentType<P = Record<string, never>> = unknown;
	export type ReactElement = unknown;

	export const Children: unknown;
	export const Component: unknown;
	export const Fragment: unknown;
	export const PureComponent: unknown;
	export const StrictMode: unknown;
	export const Suspense: unknown;
	export const cloneElement: unknown;
	export const createContext: unknown;
	export const createElement: unknown;
	export const createRef: unknown;
	export const forwardRef: unknown;
	export const isValidElement: unknown;
	export const lazy: unknown;
	export const memo: <P>(component: (props: P) => ReactNode) => unknown;
	export const startTransition: unknown;
	export const use: unknown;
	export const useActionState: unknown;
	export const useCallback: <T extends (...args: never[]) => unknown>(fn: T, deps: unknown[]) => T;
	export const useContext: <T>(ctx: unknown) => T;
	export const useDebugValue: unknown;
	export const useDeferredValue: unknown;
	export const useEffect: (effect: () => unknown, deps?: unknown[]) => void;
	export const useId: () => string;
	export const useImperativeHandle: unknown;
	export const useInsertionEffect: unknown;
	export const useLayoutEffect: unknown;
	export const useMemo: <T>(factory: () => T, deps: unknown[]) => T;
	export const useOptimistic: unknown;
	export const useReducer: unknown;
	export const useRef: <T>(init: T) => { current: T };
	export const useState: <T>(init: T | (() => T)) => [T, (v: T | ((prev: T) => T)) => void];
	export const useSyncExternalStore: unknown;
	export const useTransition: unknown;
	export const version: string;
	declare const React: unknown;
	export default React;
}

declare module "react/jsx-runtime" {
	export const jsx: unknown;
	export const jsxs: unknown;
	export const Fragment: unknown;
}

declare module "react-dom" {
	export const createPortal: unknown;
	export const flushSync: unknown;
	declare const ReactDOM: unknown;
	export default ReactDOM;
}

/* ---------- @gyoungwe/plugin-api（虚拟模块，构建时重写到 window.DroneUI） ---------- */

declare module "@gyoungwe/plugin-api" {
	export const version: number;
	export type UiRegion =
		| "knowledge.tab"
		| "knowledge.page"
		| "knowledge.surface"
		| "home.section"
		| "skills.section"
		| "panel.tab"
		| "rail.view"
		| "app.background"
		| "app.overlay"
		| "chat.corner.top-left"
		| "chat.corner.top-right"
		| "chat.corner.bottom-left"
		| "chat.corner.bottom-right"
		| "chat.diff-sidebar"
		| "settings.panel";

	/** 槽位 props 契约（与 SPEC §2 表一致） */
	export interface SlotProps {
		"chat.tool-call-card": { tool: UIToolCall };
		"chat.subagent-card": { runs: SubagentRunUi[] };
		"chat.todo-panel": Record<string, never>;
		/** 「产物」页签的一张通用回执卡；只想接管某些 kind 时其余 return renderDefault() */
		"panel.artifacts.card": {
			card: KnowledgeFlowCard;
			sessionId: string | null;
			renderDefault: () => unknown;
		};
		/** 任务卡验收项下方的证据行（扩展验收种类，如 zotero_item / wiki_review） */
		"panel.task.milestone-evidence": {
			milestone: TaskMilestone;
			task: WorkbenchTask;
			sessionId: string | null;
			renderDefault: () => unknown;
		};
	}

	/** 上下文使用量（useContextUsage 返回值；percent/tokens 为 null 表示未知） */
	export interface ContextUsageInfo {
		tokens: number | null;
		contextWindow: number;
		percent: number | null;
	}

	export interface UIToolCall {
		key: string;
		id: string;
		name: string;
		args: string;
		output: string;
		state: "running" | "done" | "error";
		blockIndex?: number;
	}

	export interface SubagentRunUi {
		key: string;
		agent: string;
		task?: string;
		status: "running" | "done" | "error";
		model?: string;
		tokens?: number;
		exitCode?: number;
		artifactsDir?: string;
		sessionFile?: string;
	}

	/** 通用回执卡动作链接（external 浏览器 / resource 自定义协议 / note Vault 笔记 / path 本地文件预览） */
	export interface KnowledgeFlowCardLink {
		label: string;
		i18n?: string;
		kind: "external" | "resource" | "note" | "path";
		target: string;
	}
	export interface KnowledgeFlowCardField {
		label: string;
		i18n?: string;
		value: string;
		status?: boolean;
		code?: string | null;
		note?: string | null;
		tone?: "ok" | "warn" | "error" | "muted";
	}
	/** 通用回执卡（KnowledgeFlow.cards[]；由 .pi 扩展的 drone.flowCards / details.cards 贡献） */
	export interface KnowledgeFlowCard {
		key: string;
		kind: string;
		title: string;
		subtitle?: string | null;
		status: string;
		tone?: "ok" | "warn" | "error" | "muted";
		detail?: string | null;
		path?: string | null;
		fields?: KnowledgeFlowCardField[];
		links?: KnowledgeFlowCardLink[];
		source?: string | null;
		at: number;
	}
	/** 任务里程碑（acceptance.kind 为扩展验收种类时，evidence 带验收器写入的 summary / note / links） */
	export interface TaskMilestone {
		id: string;
		title: string;
		dependsOn: string[];
		acceptance: {
			kind: string;
			path?: string | null;
			sha256?: string | null;
			[field: string]: string | null | undefined;
		};
		state: string;
		evidence?: {
			kind?: string;
			state?: string;
			reason?: string;
			summary?: string | null;
			note?: string | null;
			links?: KnowledgeFlowCardLink[];
			[key: string]: unknown;
		} | null;
	}
	export interface WorkbenchTask {
		id: string;
		goal: string;
		state: string;
		milestones: TaskMilestone[];
		[key: string]: unknown;
	}

	/** 宿主精选组件 props（宽松化：与宿主内部类型同构，不逐字段绑定） */
	export interface PluginButtonProps {
		children?: unknown;
		onClick?: () => void;
		disabled?: boolean;
		className?: string;
		title?: string;
	}
	export interface PluginTooltipProps {
		label: string;
		children: unknown;
	}
	export interface PluginMarkdownProps {
		text: string;
		streaming?: boolean;
		/** Own all link clicks and render without legacy knowledge-link rewriting. */
		onLink?: (href: string) => void;
	}
	export interface PluginImagePreviewProps {
		image: { data: string; mimeType: string };
		onClose: () => void;
	}

	// <drone:generated namespace="components">
	export const components: {
		Button: (props: PluginButtonProps) => unknown;
		Dropdown: (props: { trigger: unknown; children: (close: () => void) => unknown }) => unknown;
		Tooltip: (props: PluginTooltipProps) => unknown;
		Markdown: (props: PluginMarkdownProps) => unknown;
		ImagePreview: (props: PluginImagePreviewProps) => unknown;
		StatePanel: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["components"]["StatePanel"];
		Switch: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["components"]["Switch"];
		ActionSurface: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["components"]["ActionSurface"];
		PageHeader: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["components"]["PageHeader"];
		ChevronDownIcon: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["components"]["ChevronDownIcon"];
		ObsidianIcon: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["components"]["ObsidianIcon"];
		RoadmapLane: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["components"]["RoadmapLane"];
		PluginEntryHost: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["components"]["PluginEntryHost"];
	};

	// </drone:generated namespace="components">
	/** 经主进程白名单打开 zotero:// obsidian:// 等资源（cwd 供相对路径解析） */
	/** 系统浏览器打开 http(s) 链接 */
	// <drone:generated namespace="helpers">
	export const helpers: {
		summarizeArgs: (args: string) => string;
		displayToolName: (name: string) => string;
		openResourceExternal: (target: string, cwd?: string) => Promise<void>;
		openExternal: (url: string) => Promise<void>;
		isDraftSessionId: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["helpers"]["isDraftSessionId"];
		selectTranscript: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["helpers"]["selectTranscript"];
		pushToast: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["helpers"]["pushToast"];
		relativeTime: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["helpers"]["relativeTime"];
		taskArtifactLinks: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["helpers"]["taskArtifactLinks"];
		roadmapStatus: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["helpers"]["roadmapStatus"];
		legacyEvidenceNotice: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["helpers"]["legacyEvidenceNotice"];
		COMPOSER_FOCUS_EVENT: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["helpers"]["COMPOSER_FOCUS_EVENT"];
		PROTECTED_KNOWLEDGE_AGENTS: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["helpers"]["PROTECTED_KNOWLEDGE_AGENTS"];
		SUBAGENT_THINKING_LEVELS: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["helpers"]["SUBAGENT_THINKING_LEVELS"];
		UI_REGIONS: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["helpers"]["UI_REGIONS"];
	};
	// </drone:generated namespace="helpers">
	/** 上下文使用量（事件驱动刷新；sessionId 为 null/draft 时返回 null）——token 仪表盘用 */
	/** 当前界面语言（"zh" | "en"）——插件自有文案跟随中英 */
	// <drone:generated namespace="hooks">
	export const hooks: {
		useT: () => (key: string, params?: Record<string, string | number>) => string;
		useContextUsage: (sessionId: string | null) => ContextUsageInfo | null;
		useLanguage: () => "zh" | "en";
		useAgentActive: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["hooks"]["useAgentActive"];
		usePluginEntries: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["hooks"]["usePluginEntries"];
		usePluginRuntime: () => import("@gyoungwe/plugin-api/ui").PluginUiRuntimeClient;
		useSessionMessages: import("@gyoungwe/plugin-api/ui").SessionMessagesHook;
	};
	// </drone:generated namespace="hooks">
	/** 应用级 UI 偏好（ui-state.json 持久化）：centerOrbEnabled 等 */
	/** 知识流：flows[sessionId] 含 cards[]（通用回执卡）、phase、publication 等 */
	// <drone:generated namespace="stores">
	export const stores: {
		useTranscriptStore: unknown;
		useSessionsStore: unknown;
		useUiStore: unknown;
		useProjectsStore: unknown;
		useSettingsStore: unknown;
		useUiPreferencesStore: unknown;
		useKnowledgeStore: unknown;
		useDraftStore: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["stores"]["useDraftStore"];
	};
	// </drone:generated namespace="stores">
	/** 插件自带文案：注册后 useT()(key) 在核心字典找不到时回落到这里；返回注销函数（无头插件在 activate 里注册、清理函数里注销） */
	// <drone:generated namespace="knowledge">
	export const knowledge: {
		archiveKnowledgeTopic: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["archiveKnowledgeTopic"];
		authorizeZoteroLocalWrite: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["authorizeZoteroLocalWrite"];
		cancelKnowledgeModelReview: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["cancelKnowledgeModelReview"];
		cancelKnowledgeSemanticIndex: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["cancelKnowledgeSemanticIndex"];
		clearInstitutionalSession: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["clearInstitutionalSession"];
		clearZoteroLocalWrite: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["clearZoteroLocalWrite"];
		clearZoteroWebApi: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["clearZoteroWebApi"];
		decideDailyIdea: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["decideDailyIdea"];
		decideDailyRadarPaper: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["decideDailyRadarPaper"];
		decideKnowledgeReview: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["decideKnowledgeReview"];
		formalKnowledgeVault: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["formalKnowledgeVault"];
		getDailyDiscovery: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getDailyDiscovery"];
		getInstitutionalStatus: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getInstitutionalStatus"];
		getKnowledgeCloudStatus: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getKnowledgeCloudStatus"];
		getKnowledgeGraph: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getKnowledgeGraph"];
		getKnowledgeJobs: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getKnowledgeJobs"];
		getKnowledgeMaintenanceRuns: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getKnowledgeMaintenanceRuns"];
		getKnowledgeMaintenanceSettings: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getKnowledgeMaintenanceSettings"];
		getKnowledgeNoteLinks: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getKnowledgeNoteLinks"];
		getKnowledgeOverview: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getKnowledgeOverview"];
		getKnowledgeReviews: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getKnowledgeReviews"];
		getKnowledgeSemanticStatus: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getKnowledgeSemanticStatus"];
		getKnowledgeTopics: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getKnowledgeTopics"];
		getResearchRun: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getResearchRun"];
		getResearchRuns: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getResearchRuns"];
		getZoteroLocalWrite: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getZoteroLocalWrite"];
		getZoteroStatus: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getZoteroStatus"];
		getZoteroWebApi: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getZoteroWebApi"];
		indexKnowledgeSemantic: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["indexKnowledgeSemantic"];
		initializeKnowledgeCloud: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["initializeKnowledgeCloud"];
		maintainKnowledge: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["maintainKnowledge"];
		onKnowledgeEvent: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["onKnowledgeEvent"];
		openExternal: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["openExternal"];
		openInstitutionalLogin: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["openInstitutionalLogin"];
		openKnowledgeTarget: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["openKnowledgeTarget"];
		pickDirectory: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["pickDirectory"];
		previewKnowledgeReview: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["previewKnowledgeReview"];
		previewKnowledgeSetup: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["previewKnowledgeSetup"];
		probeKnowledgeCloud: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["probeKnowledgeCloud"];
		prompt: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["prompt"];
		readKnowledgeCloudNote: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["readKnowledgeCloudNote"];
		readKnowledgeNote: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["readKnowledgeNote"];
		resumeKnowledgeCheck: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["resumeKnowledgeCheck"];
		reviewKnowledgeWithModel: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["reviewKnowledgeWithModel"];
		runKnowledgeMaintenance: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["runKnowledgeMaintenance"];
		saveKnowledgeMaintenanceSettings: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["saveKnowledgeMaintenanceSettings"];
		saveKnowledgeSemanticSettings: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["saveKnowledgeSemanticSettings"];
		saveZoteroWebApi: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["saveZoteroWebApi"];
		searchKnowledge: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["searchKnowledge"];
		setKnowledgeCloudPassword: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["setKnowledgeCloudPassword"];
		setKnowledgeSpecialistSettings: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["setKnowledgeSpecialistSettings"];
		startKnowledgeSetup: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["startKnowledgeSetup"];
		syncKnowledgeCloud: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["syncKnowledgeCloud"];
		testInstitutionalAccess: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["testInstitutionalAccess"];
		testKnowledgeSemanticProvider: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["testKnowledgeSemanticProvider"];
		updateDailyDiscovery: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["updateDailyDiscovery"];
	};
	// </drone:generated namespace="knowledge">
	// <drone:generated namespace="sessions">
	export const sessions: {
		prompt: import("@gyoungwe/plugin-api/ui").SessionUiPort["prompt"];
	};
	// </drone:generated namespace="sessions">
	// <drone:generated namespace="i18n">
	export const i18n: {
		registerMessages: (
			namespace: string,
			messages: { zh?: Record<string, unknown>; en?: Record<string, unknown> },
		) => () => void;
	};
	// </drone:generated namespace="i18n">
	// <drone:generated namespace="topLevel">
	export const Button: (props: PluginButtonProps) => unknown;
	export const Dropdown: (props: { trigger: unknown; children: (close: () => void) => unknown }) => unknown;
	export const Tooltip: (props: PluginTooltipProps) => unknown;
	export const Markdown: (props: PluginMarkdownProps) => unknown;
	export const ImagePreview: (props: PluginImagePreviewProps) => unknown;
	export const StatePanel: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["components"]["StatePanel"];
	export const Switch: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["components"]["Switch"];
	export const ActionSurface: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["components"]["ActionSurface"];
	export const PageHeader: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["components"]["PageHeader"];
	export const ChevronDownIcon: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["components"]["ChevronDownIcon"];
	export const ObsidianIcon: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["components"]["ObsidianIcon"];
	export const RoadmapLane: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["components"]["RoadmapLane"];
	export const PluginEntryHost: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["components"]["PluginEntryHost"];
	export const summarizeArgs: (args: string) => string;
	export const displayToolName: (name: string) => string;
	export const openResourceExternal: (target: string, cwd?: string) => Promise<void>;
	export const openExternal: (url: string) => Promise<void>;
	export const isDraftSessionId: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["helpers"]["isDraftSessionId"];
	export const selectTranscript: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["helpers"]["selectTranscript"];
	export const pushToast: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["helpers"]["pushToast"];
	export const relativeTime: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["helpers"]["relativeTime"];
	export const taskArtifactLinks: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["helpers"]["taskArtifactLinks"];
	export const roadmapStatus: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["helpers"]["roadmapStatus"];
	export const legacyEvidenceNotice: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["helpers"]["legacyEvidenceNotice"];
	export const COMPOSER_FOCUS_EVENT: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["helpers"]["COMPOSER_FOCUS_EVENT"];
	export const PROTECTED_KNOWLEDGE_AGENTS: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["helpers"]["PROTECTED_KNOWLEDGE_AGENTS"];
	export const SUBAGENT_THINKING_LEVELS: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["helpers"]["SUBAGENT_THINKING_LEVELS"];
	export const UI_REGIONS: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["helpers"]["UI_REGIONS"];
	export const useT: () => (key: string, params?: Record<string, string | number>) => string;
	export const useContextUsage: (sessionId: string | null) => ContextUsageInfo | null;
	export const useLanguage: () => "zh" | "en";
	export const useAgentActive: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["hooks"]["useAgentActive"];
	export const usePluginEntries: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["hooks"]["usePluginEntries"];
	export const usePluginRuntime: () => import("@gyoungwe/plugin-api/ui").PluginUiRuntimeClient;
	export const useSessionMessages: import("@gyoungwe/plugin-api/ui").SessionMessagesHook;
	export const useTranscriptStore: unknown;
	export const useSessionsStore: unknown;
	export const useUiStore: unknown;
	export const useProjectsStore: unknown;
	export const useSettingsStore: unknown;
	export const useUiPreferencesStore: unknown;
	export const useKnowledgeStore: unknown;
	export const useDraftStore: import("@gyoungwe/plugin-api/ui").KnowledgeUiBindings["stores"]["useDraftStore"];
	export const registerMessages: (
		namespace: string,
		messages: { zh?: Record<string, unknown>; en?: Record<string, unknown> },
	) => () => void;
	export const archiveKnowledgeTopic: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["archiveKnowledgeTopic"];
	export const authorizeZoteroLocalWrite: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["authorizeZoteroLocalWrite"];
	export const cancelKnowledgeModelReview: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["cancelKnowledgeModelReview"];
	export const cancelKnowledgeSemanticIndex: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["cancelKnowledgeSemanticIndex"];
	export const clearInstitutionalSession: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["clearInstitutionalSession"];
	export const clearZoteroLocalWrite: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["clearZoteroLocalWrite"];
	export const clearZoteroWebApi: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["clearZoteroWebApi"];
	export const decideDailyIdea: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["decideDailyIdea"];
	export const decideDailyRadarPaper: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["decideDailyRadarPaper"];
	export const decideKnowledgeReview: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["decideKnowledgeReview"];
	export const formalKnowledgeVault: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["formalKnowledgeVault"];
	export const getDailyDiscovery: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getDailyDiscovery"];
	export const getInstitutionalStatus: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getInstitutionalStatus"];
	export const getKnowledgeCloudStatus: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getKnowledgeCloudStatus"];
	export const getKnowledgeGraph: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getKnowledgeGraph"];
	export const getKnowledgeJobs: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getKnowledgeJobs"];
	export const getKnowledgeMaintenanceRuns: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getKnowledgeMaintenanceRuns"];
	export const getKnowledgeMaintenanceSettings: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getKnowledgeMaintenanceSettings"];
	export const getKnowledgeNoteLinks: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getKnowledgeNoteLinks"];
	export const getKnowledgeOverview: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getKnowledgeOverview"];
	export const getKnowledgeReviews: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getKnowledgeReviews"];
	export const getKnowledgeSemanticStatus: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getKnowledgeSemanticStatus"];
	export const getKnowledgeTopics: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getKnowledgeTopics"];
	export const getResearchRun: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getResearchRun"];
	export const getResearchRuns: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getResearchRuns"];
	export const getZoteroLocalWrite: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getZoteroLocalWrite"];
	export const getZoteroStatus: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getZoteroStatus"];
	export const getZoteroWebApi: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["getZoteroWebApi"];
	export const indexKnowledgeSemantic: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["indexKnowledgeSemantic"];
	export const initializeKnowledgeCloud: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["initializeKnowledgeCloud"];
	export const maintainKnowledge: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["maintainKnowledge"];
	export const onKnowledgeEvent: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["onKnowledgeEvent"];
	export const openInstitutionalLogin: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["openInstitutionalLogin"];
	export const openKnowledgeTarget: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["openKnowledgeTarget"];
	export const pickDirectory: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["pickDirectory"];
	export const previewKnowledgeReview: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["previewKnowledgeReview"];
	export const previewKnowledgeSetup: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["previewKnowledgeSetup"];
	export const probeKnowledgeCloud: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["probeKnowledgeCloud"];
	export const prompt: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["prompt"];
	export const readKnowledgeCloudNote: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["readKnowledgeCloudNote"];
	export const readKnowledgeNote: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["readKnowledgeNote"];
	export const resumeKnowledgeCheck: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["resumeKnowledgeCheck"];
	export const reviewKnowledgeWithModel: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["reviewKnowledgeWithModel"];
	export const runKnowledgeMaintenance: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["runKnowledgeMaintenance"];
	export const saveKnowledgeMaintenanceSettings: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["saveKnowledgeMaintenanceSettings"];
	export const saveKnowledgeSemanticSettings: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["saveKnowledgeSemanticSettings"];
	export const saveZoteroWebApi: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["saveZoteroWebApi"];
	export const searchKnowledge: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["searchKnowledge"];
	export const setKnowledgeCloudPassword: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["setKnowledgeCloudPassword"];
	export const setKnowledgeSpecialistSettings: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["setKnowledgeSpecialistSettings"];
	export const startKnowledgeSetup: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["startKnowledgeSetup"];
	export const syncKnowledgeCloud: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["syncKnowledgeCloud"];
	export const testInstitutionalAccess: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["testInstitutionalAccess"];
	export const testKnowledgeSemanticProvider: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["testKnowledgeSemanticProvider"];
	export const updateDailyDiscovery: import("@gyoungwe/plugin-api/ui").KnowledgeUiPort["updateDailyDiscovery"];
	// </drone:generated namespace="topLevel">
	declare const api: unknown;
	export default api;
}

/* ---------- 静态资产（构建器 dataurl loader 内联为 data: URL，SPEC §3/§11） ---------- */

/* 图片：CSP img-src data: */
declare module "*.png" {
	const url: string;
	export default url;
}
declare module "*.webp" {
	const url: string;
	export default url;
}
declare module "*.gif" {
	const url: string;
	export default url;
}
declare module "*.jpg" {
	const url: string;
	export default url;
}
declare module "*.jpeg" {
	const url: string;
	export default url;
}

/* 音频：CSP media-src data:，new Audio(url) 播放（语音提醒/音效类插件用） */
declare module "*.mp3" {
	const url: string;
	export default url;
}
declare module "*.m4a" {
	const url: string;
	export default url;
}
declare module "*.wav" {
	const url: string;
	export default url;
}
declare module "*.ogg" {
	const url: string;
	export default url;
}
declare module "*.aac" {
	const url: string;
	export default url;
}
