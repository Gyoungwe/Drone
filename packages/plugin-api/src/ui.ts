/** Public Desktop UI bindings. Runtime services are provided by window.DroneUI. */
import type {
	ButtonHTMLAttributes,
	ComponentProps,
	ComponentType,
	MouseEventHandler,
	ReactNode,
	RefObject,
} from "react";
import type {
	AvailableModel,
	ImageInput,
	KnowledgeFlow,
	KnowledgeSpecialistRole,
	KnowledgeUiEvent,
	KnowledgeUiPort,
	ModelPrefs,
	SessionMeta,
	SubagentThinkingLevel,
	UiPluginAnchor,
	WorkbenchTask,
} from "./ui-wire.js";

export type * from "./ui-wire.js";

/** Bound to the installed package by the desktop main process; callers cannot select another package. */
export interface PluginUiRuntimeClient {
	invoke(operation: string, input: unknown): Promise<unknown>;
}

/** Headless UI modules receive the same bound client as their React contributions. */
export interface PluginUiActivationContext {
	runtime: PluginUiRuntimeClient | undefined;
}

export type KnowledgeTab = "overview" | "network" | "reviews" | "settings";
export type KnowledgeSurfaceProps =
	| {
			kind: "settings";
			context?: {
				cwd: string | null;
				sessionId: string | null;
				tab?: "overview" | "settings" | "reviews" | "maintenance" | "semantic" | "topics";
				id?: string;
			};
			headless?: boolean;
			hideTabs?: boolean;
	  }
	| { kind: "note"; cwd: string | null; revision: number; path: string; onClose: () => void }
	| { kind: "flow"; sessionId: string | null }
	| { kind: "zotero" }
	| { kind: "institution" };

/** Selector snapshots are read-only; mutations use the explicitly exposed actions. */
export interface UiStoreBinding<State> {
	<Selected>(selector: (state: State) => Selected): Selected;
	getState(): State;
}
export interface KnowledgeDialogContext {
	cwd: string | null;
	sessionId: string | null;
	tab: "overview" | "reviews" | "maintenance";
	id?: string;
	note?: string;
	noteRevision?: number;
}
export interface KnowledgeReviewRequest {
	cwd: string;
	sessionId: string | null;
	id: string;
}
export interface KnowledgeStoreState {
	flows: Record<string, KnowledgeFlow>;
	revision: number;
	dialog: KnowledgeDialogContext | null;
	review: KnowledgeReviewRequest | null;
	reviewQueue: KnowledgeReviewRequest[];
	notice: Extract<KnowledgeUiEvent, { kind: "notice" }> | null;
	apply(event: KnowledgeUiEvent): void;
	invalidate(): void;
	open(context: KnowledgeDialogContext): void;
	openReview(request: KnowledgeReviewRequest): void;
	deferReview(): void;
	close(): void;
	dismiss(): void;
}
export interface KnowledgeSessionState {
	cwd: string | null;
	activeSessionId: string | null;
	sessions: SessionMeta[];
	models: AvailableModel[];
	createSession(cwd?: string, replaceDraftId?: string): Promise<void>;
	createDraftSession(cwd?: string): void;
}
export interface KnowledgeSettingsState {
	modelPrefs: ModelPrefs | null;
	openWith(category?: "knowledge" | "zotero" | "models"): void;
	setOpen(open: boolean): void;
	setSubagentModel(agent: string, modelRef: string | null): Promise<void>;
	setSubagentThinking(agent: string, level: SubagentThinkingLevel | null): Promise<void>;
}
/** The knowledge receipt view only needs message kind and persisted task receipts. */
export interface KnowledgeTranscript {
	messages: { kind: string; taskView?: { tasks: WorkbenchTask[] } }[];
}
export interface KnowledgeTranscriptState {
	bySession: Record<string, KnowledgeTranscript>;
}
export interface KnowledgeNavigationState {
	knowledgeTab: KnowledgeTab;
	setKnowledgeTab(tab: KnowledgeTab | "home"): void;
	setView(view: "chat" | "knowledge"): void;
	openResourcePreview(input: { href: string; label?: string; cwd?: string }): void;
}
export interface KnowledgeDraft {
	text: string;
	images: ImageInput[];
	slashCommand: string | null;
	subagent: string | null;
	attachments: string[];
	quotes: string[];
}
export interface KnowledgeDraftState {
	updateDraft(key: string, updater: (draft: KnowledgeDraft) => KnowledgeDraft): void;
}
export interface KnowledgePluginEntry {
	id: string;
	pluginName: string;
	title: string;
	contribution: {
		pluginName: string;
		id: string;
		exportName: string;
		component: ComponentType<Record<string, never>>;
		anchor?: UiPluginAnchor;
		title?: string;
	};
}
export type KnowledgeRoadmapStatus = "ok" | "active" | "warn" | "blocked" | "skip";
export interface KnowledgeRoadmapNode {
	key: string;
	label: string;
	value?: string;
	status: KnowledgeRoadmapStatus;
	detail?: string;
}
export interface KnowledgeUiRegions {
	AppBackground: "app.background";
	AppOverlay: "app.overlay";
	CornerTopLeft: "chat.corner.top-left";
	CornerTopRight: "chat.corner.top-right";
	CornerBottomLeft: "chat.corner.bottom-left";
	CornerBottomRight: "chat.corner.bottom-right";
	DiffSidebar: "chat.diff-sidebar";
	SettingsPanel: "settings.panel";
	PanelTab: "panel.tab";
	RailView: "rail.view";
	KnowledgeTab: "knowledge.tab";
	KnowledgePage: "knowledge.page";
	KnowledgeSurface: "knowledge.surface";
	HomeSection: "home.section";
	SkillsSection: "skills.section";
}
export type KnowledgeUiRegion = KnowledgeUiRegions[keyof KnowledgeUiRegions];
export interface KnowledgeUiBindings {
	components: {
		Button: ComponentType<
			ButtonHTMLAttributes<HTMLButtonElement> & {
				variant?: "ghost" | "primary" | "secondary" | "danger";
				size?: "sm" | "md";
				tone?: "default" | "danger";
			}
		>;
		StatePanel: ComponentType<{
			kind?: "empty" | "loading" | "error";
			title: ReactNode;
			hint?: ReactNode;
			action?: ReactNode;
			compact?: boolean;
			className?: string;
			testId?: string;
		}>;
		Switch: ComponentType<
			Omit<ComponentProps<"button">, "children" | "onClick" | "role" | "type"> & {
				checked: boolean;
				indeterminate?: boolean;
				onCheckedChange(checked: boolean): void;
			}
		>;
		ActionSurface: ComponentType<{
			children: ReactNode;
			ariaLabel: string;
			contentRef?: RefObject<HTMLDivElement | null>;
			tone?: "accent" | "warn" | "danger";
			width?: "compact" | "standard" | "wide";
			height?: "fill" | "fit";
			testId?: string;
			onBackdropMouseDown?: MouseEventHandler<HTMLDivElement>;
			onEscape?: () => void;
			restoreFocus?: boolean;
		}>;
		PageHeader: ComponentType<{
			title: ReactNode;
			description?: ReactNode;
			actions?: ReactNode;
			tabs?: ReactNode;
		}>;
		Markdown: ComponentType<{ text: string; streaming?: boolean }>;
		ChevronDownIcon: ComponentType<{ size?: number; className?: string }>;
		ObsidianIcon: ComponentType<{ size?: number; className?: string }>;
		RoadmapLane: ComponentType<{ nodes: KnowledgeRoadmapNode[]; testId?: string; ariaLabel?: string }>;
		PluginEntryHost: ComponentType<{
			entry: KnowledgePluginEntry;
			fallback?: ReactNode;
			props?: Record<string, unknown>;
		}>;
	};
	hooks: {
		useAgentActive(sessionId: string | null): boolean;
		usePluginEntries(region: KnowledgeUiRegion): KnowledgePluginEntry[];
		useLanguage(): "zh" | "en";
		useT(): (
			key:
				| "workbench.wikiReport"
				| "workbench.wikiDescription"
				| "workbench.openInWiki"
				| "workbench.stage.completed"
				| "workbench.stage.inProgress"
				| "workbench.stage.pending",
			params?: Record<string, string | number>,
		) => string;
	};
	helpers: {
		isDraftSessionId(sessionId: string | null | undefined): boolean;
		selectTranscript(state: KnowledgeTranscriptState, sessionId: string | null): KnowledgeTranscript;
		pushToast(
			severity: "error" | "warning" | "info",
			titleKey: "toast.knowledgeSetupFailed",
			detail?: string,
		): void;
		relativeTime(ms: number, language: "zh" | "en", now?: number): string;
		taskArtifactLinks(task: WorkbenchTask): { path: string; href: string; state: string }[];
		roadmapStatus(state: string): KnowledgeRoadmapStatus;
		legacyEvidenceNotice(text: string): string | null;
		COMPOSER_FOCUS_EVENT: "pi:composer-focus";
		PROTECTED_KNOWLEDGE_AGENTS: readonly {
			readonly role: KnowledgeSpecialistRole;
			readonly name: string;
			readonly label: string;
			readonly description: string;
			readonly permissions: readonly string[];
			readonly maxTurns: number;
			readonly maxTokens: number;
		}[];
		SUBAGENT_THINKING_LEVELS: readonly SubagentThinkingLevel[];
		UI_REGIONS: KnowledgeUiRegions;
	};
	stores: {
		useKnowledgeStore: UiStoreBinding<KnowledgeStoreState>;
		useSessionsStore: UiStoreBinding<KnowledgeSessionState>;
		useSettingsStore: UiStoreBinding<KnowledgeSettingsState>;
		useTranscriptStore: UiStoreBinding<KnowledgeTranscriptState>;
		useUiStore: UiStoreBinding<KnowledgeNavigationState>;
		useDraftStore: UiStoreBinding<KnowledgeDraftState>;
	};
}
export interface DroneUiRuntime extends KnowledgeUiBindings {
	version: 1;
	knowledge: KnowledgeUiPort;
}
