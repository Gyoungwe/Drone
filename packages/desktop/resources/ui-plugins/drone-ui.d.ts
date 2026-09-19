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

/* ---------- @drone/plugin-api（虚拟模块，构建时重写到 window.DroneUI） ---------- */

declare module "@drone/plugin-api" {
	export const version: number;

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
	}
	export interface PluginImagePreviewProps {
		image: { data: string; mimeType: string };
		onClose: () => void;
	}

	export const components: {
		Button: (props: PluginButtonProps) => unknown;
		Dropdown: (props: { trigger: unknown; children: (close: () => void) => unknown }) => unknown;
		Tooltip: (props: PluginTooltipProps) => unknown;
		Markdown: (props: PluginMarkdownProps) => unknown;
		ImagePreview: (props: PluginImagePreviewProps) => unknown;
	};
	export const helpers: {
		summarizeArgs(args: string): string;
		displayToolName(name: string): string;
		/** 经主进程白名单打开 zotero:// obsidian:// 等资源（cwd 供相对路径解析） */
		openResourceExternal(target: string, cwd?: string): Promise<void>;
		/** 系统浏览器打开 http(s) 链接 */
		openExternal(url: string): Promise<void>;
	};
	export const hooks: {
		useT(): (key: string, params?: Record<string, string | number>) => string;
		/** 上下文使用量（事件驱动刷新；sessionId 为 null/draft 时返回 null）——token 仪表盘用 */
		useContextUsage(sessionId: string | null): ContextUsageInfo | null;
		/** 当前界面语言（"zh" | "en"）——插件自有文案跟随中英 */
		useLanguage(): "zh" | "en";
	};
	export const stores: {
		useTranscriptStore: unknown;
		useSessionsStore: unknown;
		useUiStore: unknown;
		useProjectsStore: unknown;
		useSettingsStore: unknown;
		/** 应用级 UI 偏好（ui-state.json 持久化）：centerOrbEnabled 等 */
		useUiPreferencesStore: unknown;
		/** 知识流：flows[sessionId] 含 cards[]（通用回执卡）、phase、publication 等 */
		useKnowledgeStore: unknown;
	};
	/** 插件自带文案：注册后 useT()(key) 在核心字典找不到时回落到这里；返回注销函数（无头插件在 activate 里注册、清理函数里注销） */
	export const i18n: {
		registerMessages(
			namespace: string,
			messages: { zh?: Record<string, unknown>; en?: Record<string, unknown> },
		): () => void;
	};
	// store hooks 顶层便捷导出（与 shim 解构一致，例：import { useSessionsStore } from "@drone/plugin-api"）
	export const useTranscriptStore: unknown;
	export const useSessionsStore: unknown;
	export const useUiStore: unknown;
	export const useProjectsStore: unknown;
	export const useSettingsStore: unknown;
	export const useUiPreferencesStore: unknown;
	export const useKnowledgeStore: unknown;
	export const openResourceExternal: (target: string, cwd?: string) => Promise<void>;
	export const openExternal: (url: string) => Promise<void>;
	export const registerMessages: (
		namespace: string,
		messages: { zh?: Record<string, unknown>; en?: Record<string, unknown> },
	) => () => void;
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
