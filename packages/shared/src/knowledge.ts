import type {
	KnowledgeSpecialistMode,
	KnowledgeSpecialistRun,
	KnowledgeSpecialistSettings,
} from "./knowledge-specialists";
import type {
	KnowledgeSemanticIndexCancelRequest,
	KnowledgeSemanticIndexRequest,
	KnowledgeSemanticIndexResult,
	KnowledgeSemanticProviderRequest,
	KnowledgeSemanticProviderResult,
	KnowledgeSemanticSettings,
	KnowledgeSemanticSettingsRequest,
	KnowledgeSemanticStatus,
	KnowledgeTopicArchiveRequest,
	KnowledgeTopicListResult,
	KnowledgeTopicsRequest,
} from "./knowledge-upgrade";

export type {
	KnowledgeSemanticConfig,
	KnowledgeSemanticIndexCancelRequest,
	KnowledgeSemanticIndexRequest,
	KnowledgeSemanticIndexResult,
	KnowledgeSemanticProvider,
	KnowledgeSemanticProviderRequest,
	KnowledgeSemanticProviderResult,
	KnowledgeSemanticSettings,
	KnowledgeSemanticSettingsRequest,
	KnowledgeSemanticStatus,
	KnowledgeTopic,
	KnowledgeTopicArchiveRequest,
	KnowledgeTopicListResult,
	KnowledgeTopicSource,
	KnowledgeTopicsRequest,
} from "./knowledge-upgrade";
/** Host-owned knowledge UI protocol. Reading in the UI never earns model evidence receipts. */
export interface KnowledgeReadRecord {
	path: string;
	title?: string;
	excerpt?: string;
	hash: string | null;
	startLine: number;
	endLine: number;
	missing?: boolean;
	truncated?: boolean;
	kind?: string;
}
/** 通用回执卡字段：label 为展示名（可附 i18n 键），value 为状态记号或短文本；tone 由生产端按事实给出。 */
export interface KnowledgeFlowCardField {
	label: string;
	/** 可选 i18n 键；渲染端字典里存在时优先使用 */
	i18n?: string;
	value: string;
	/** value 是否为状态记号（渲染端可查 flow.status.* 字典本地化） */
	status?: boolean;
	/** 等宽附注（Zotero key / 笔记路径等） */
	code?: string | null;
	/** 附加说明（渠道 / 库名等） */
	note?: string | null;
	tone?: "ok" | "warn" | "error" | "muted";
}
/** 通用回执卡动作：external = 系统浏览器；resource = 宿主 openResourceExternal（自定义协议）；note = Vault 笔记查看器；path = 本地文件预览。 */
export interface KnowledgeFlowCardLink {
	label: string;
	i18n?: string;
	kind: "external" | "resource" | "note" | "path";
	target: string;
}
/**
 * KnowledgeFlow 通用回执卡（挂钩 3）：归档 / 入库 / 总结 / 文献回执统一用它表达，
 * 由工具结果 `details.cards[]` 或工具元数据 `drone.flowCards(event)` 贡献；渲染端只有一个通用卡组件。
 * 只呈现宿主观察到的事实，不代表科学结论已核验。
 */
export interface KnowledgeFlowCard {
	/** 合并键（同键后来者覆盖，空值不覆盖旧值） */
	key: string;
	/** 卡片种类：artifact / literature / wiki-proposal / setup / summary / … 由生产端定义 */
	kind: string;
	title: string;
	/** title 只是占位（例如仅有 DOI）：合并时不覆盖已知标题 */
	provisionalTitle?: boolean;
	subtitle?: string | null;
	/** 状态记号（渲染端按 flow.status.* 字典本地化，缺省显示原文） */
	status: string;
	tone?: "ok" | "warn" | "error" | "muted";
	detail?: string | null;
	/** 主产物路径（Vault 相对或本地文件），供「打开」动作 */
	path?: string | null;
	fields?: KnowledgeFlowCardField[];
	links?: KnowledgeFlowCardLink[];
	/** 来源工具名（审计用） */
	source?: string | null;
	at: number;
}
export interface KnowledgeFlow {
	specialists?: KnowledgeSpecialistRun[];
	sessionId: string;
	turnId: string;
	vaultId: string | null;
	bindingRevision: number | null;
	vault: string | null;
	project: string | null;
	/** 通用回执卡（归档 / 入库 / 总结 / 文献……），见 KnowledgeFlowCard */
	cards?: KnowledgeFlowCard[];
	phase: string;
	updatedAt: number;
	navigation: KnowledgeReadRecord[];
	reads: KnowledgeReadRecord[];
	search: {
		query: string;
		wikiOnly: boolean;
		hits: number;
		complete: boolean;
		coverage: string;
		revision: number;
		previews?: KnowledgeReadRecord[];
	} | null;
	publication: {
		status: string;
		warnings?: { code: string; message: string }[];
		reason: string | null;
		paths?: string[];
		scientificallyVerified: false;
	} | null;
	/**
	 * 门控四阶段进度（导航/Wiki/检索/发布），由后端 flow 生产端从权威 flow 数据单点派生。
	 * 渲染端只读展示、不再自行重算，避免与后端判定漂移。旧 flow 可能缺省。
	 */
	stages?: {
		navigation: boolean;
		wiki: boolean;
		search: boolean;
		publication: boolean;
	};
	error?: string | null;
}
export type KnowledgeUiEvent = (
	| { kind: "flow"; flow: KnowledgeFlow }
	| { kind: "invalidate" }
	| { kind: "open-review"; sessionId: string; id: string }
	| {
			kind: "notice";
			id: string;
			sessionId: string | null;
			severity: "info" | "warning" | "error";
			text: string;
	  }
) & { sequence?: number };
export interface KnowledgeBinding {
	version: number;
	vault: string;
	vaultId: string;
	revision: number;
	profile: string;
	depositMode: string;
	subagentPolicy: string;
	updatedAt: string;
}
export interface KnowledgeIndexStatus {
	revision: number;
	coverage: string;
	noteCount: number;
	pendingChanges: number;
	jobs: number;
	watching: boolean;
	lastReconciledAt: string | null;
	problems: { path: string; message: string }[];
}
export interface KnowledgeOverview {
	reviewMode?: "automatic" | "strict";
	wikiHistory?: { id: string; path: string; afterHash: string; reviewedAt: number; reviewMethod: string }[];
	specialistSettings?: KnowledgeSpecialistSettings;
	specialistSettingsError?: string;
	enabled: boolean;
	bound: boolean;
	scope: "application";
	binding?: KnowledgeBinding;
	cwd: string | null;
	project: string | null;
	legacyProjectVault: string | null;
	projectError?: string;
	index?: KnowledgeIndexStatus | null;
	error?: string | null;
	flow: KnowledgeFlow | null;
}

export type KnowledgeCloudMode =
	| "disabled"
	| "unchecked"
	| "offline"
	| "unauthorized"
	| "read-only"
	| "ready"
	| "error";

/** Cloud status is a transport projection; it never contains credentials or note content. */
export interface KnowledgeCloudStatus {
	configured: boolean;
	/** 密码来源：环境变量优先于界面保存；仅标识来源，不含密码本身 */
	passwordSource: "env" | "saved" | null;
	endpoint: string;
	folder: string;
	mode: KnowledgeCloudMode;
	reachable: boolean;
	authenticated: boolean;
	initialized: boolean;
	writable: boolean | null;
	lastCheckedAt: string | null;
	message: string | null;
	warnings: string[];
}

export interface KnowledgeCloudNote {
	path: string;
	text: string;
	hash: string;
	/** 仅强 ETag 可用于条件写入；缺省时只读。 */
	version: string | null;
	bytes: number;
	lastModified: string | null;
}

export interface KnowledgeCloudWriteResult {
	path: string;
	status: "created" | "updated" | "conflict" | "offline" | "forbidden" | "unknown";
	version: string | null;
	hash: string;
	message: string | null;
}

export interface KnowledgeCloudSyncItem {
	path: string;
	status: "unchanged" | "pulled" | "pushed" | "conflict" | "skipped" | "failed";
	localHash: string | null;
	remoteVersion: string | null;
	message: string | null;
}

export interface KnowledgeCloudSyncResult {
	mode: "pull" | "push";
	completed: boolean;
	items: KnowledgeCloudSyncItem[];
	warnings: string[];
}
export type ResearchRunRouteState = "pending" | "active" | "complete" | "blocked";
export interface ResearchRunRouteNode {
	key: string;
	label: string;
	state: ResearchRunRouteState;
	at: string | null;
	detail: string | null;
	count?: number;
}
export interface ResearchRunListItem {
	runId: string;
	resultSlug: string;
	project: string;
	topicId: string | null;
	query: string;
	status: string;
	stage: string;
	answerable: boolean;
	scientificallyVerified: false;
	startedAt: string | null;
	updatedAt: string | null;
	runDir: string;
}
export interface ResearchRunSource {
	path: string;
	status: string;
	hash: string | null;
	verified: boolean;
	size?: number | null;
	location?: string | null;
	metadata?: Record<string, unknown> | null;
}
export interface ResearchRunClaim {
	id?: string | null;
	claim: string;
	support: string[];
	status: string;
	relationship?: "direct" | "indirect" | "hypothesis" | "unsupported" | null;
	limitations?: string | null;
	organism?: string | null;
	method?: string | null;
	evidence?: {
		path: string;
		startLine: number | null;
		endLine: number | null;
		quote: string | null;
		hash: string | null;
	}[];
}
export interface ResearchRunTimelineEvent {
	type: string;
	at: string | null;
	detail: string | null;
	status: "ok" | "failed" | "observed";
	refs?: string[];
}
export interface ResearchRunDetail extends ResearchRunListItem {
	route: ResearchRunRouteNode[];
	timeline?: ResearchRunTimelineEvent[];
	sources: ResearchRunSource[];
	claims: ResearchRunClaim[];
	warnings: string[];
	coverage: Record<string, unknown> | null;
	archive: { count: number; reused: number; verified: boolean };
	integrity?: { checked: number; verified: number; changed: number; missing: number };
	provenance?: {
		status: "not-recorded" | "observed" | "changed" | "incomplete";
		files: {
			path: string;
			role: string;
			hash: string | null;
			currentHash: string | null;
			matches: boolean | null;
		}[];
		limitations: string[];
	};
	gaps?: string[];
	governance?: {
		duplicateSources: string[][];
		staleSources: string[];
		unavailableSources: string[];
	};
}
export interface ResearchRunsRequest {
	cwd?: string | null;
	project?: string | null;
	limit?: number;
}
export interface ResearchRunRequest {
	cwd?: string | null;
	runDir?: string | null;
	runId?: string | null;
}
export interface KnowledgePage<T> {
	items: T[];
	total: number;
	offset: number;
	nextOffset: number | null;
	problems?: { id: string; error: string }[];
}
export interface KnowledgeJob {
	key: string;
	kind: string;
	path: string;
	scope: string;
	revision: number;
	updated: string;
}
export interface WikiReviewItem {
	id: string;
	path: string;
	title: string;
	status: string;
	expiresAt: number;
	expired: boolean;
	bindingChanged: boolean;
}
export interface WikiSource extends KnowledgeReadRecord {
	currentHash: string | null;
	changed: boolean;
	error?: string | null;
}
export interface WikiReviewPreview {
	id: string;
	path: string;
	project: string;
	status: string;
	title: string;
	rationale: string;
	before: string;
	after: string;
	protectedText: string;
	sources: WikiSource[];
	expiresAt: number;
	expired: boolean;
	targetChanged: boolean;
	canApply: boolean;
	modelReview?: WikiModelReviewResult | null;
	reviewToken: string;
	tokenExpiresAt: number;
	vault: string;
	bindingRevision: number;
	scientificallyVerified: false;
}
export interface WikiReviewResult {
	id: string;
	status: string;
	vaultWritten?: boolean;
	indexed?: boolean;
	reviewRecorded?: boolean;
	recordError?: string | null;
	indexError?: string | null;
	alreadyReviewed?: boolean;
	path?: string;
}
export interface KnowledgeNote extends KnowledgeReadRecord {
	displayText?: string;
	displayLinkBase?: string;
	text?: string;
	totalLines?: number;
	humanReview?: { text: string; truncated: boolean } | null;
}
export interface KnowledgeSetupPreview {
	path: string | null;
	scope: "application";
	bindingRevision: number;
	warning: string;
	context: { workspace: KnowledgeDirectory | null; vault: KnowledgeDirectory | null };
	templateSamples: { path: string; text: string }[];
	options: {
		profiles: {
			id: string;
			label: string;
			description: string;
			projectTypes: string[];
			libraryTypes: string[];
			directories: string[];
		}[];
	};
}
export interface KnowledgeDirectory {
	path: string;
	exists: boolean;
	truncated: boolean;
	entries: { path: string; type: string }[];
}
export interface KnowledgePageRequest {
	cwd?: string | null;
	offset?: number;
	limit?: number;
	revision?: number;
}
export interface WikiModelReviewInput {
	cwd: string;
	sessionId: string;
	token: string;
	requestId: string;
	acknowledged: true;
	autoApply: boolean;
}
export interface WikiModelReviewResult {
	auditId: string;
	proposalId: string;
	proposalHash: string;
	path: string;
	model: string;
	startedAt: number;
	completedAt: number;
	verdict: "approve" | "needs-human" | "reject";
	summary: string;
	cautions: string[];
	checks: Record<string, boolean>;
	autoApplyAuthorized: boolean;
	canAutoApply: boolean;
	applied: boolean;
	humanReviewed: false;
	scientificallyVerified: false;
	usage?: { inputTokens: number; outputTokens: number; cost: number };
	applyError?: string;
	auditSaveError?: string;
	partial?: boolean;
	writeResult?: WikiReviewResult;
	sources?: { path: string; hash: string; startLine: number; endLine: number }[];
}
/** 双向链接：出链（本笔记链接到的）与反链（链接到本笔记的） */
export interface KnowledgeLinkRef {
	path: string;
	title: string;
	/** false = 链接目标还不存在（未建的笔记） */
	exists: boolean;
}
export interface KnowledgeNoteLinks {
	path: string;
	title: string;
	outgoing: KnowledgeLinkRef[];
	incoming: KnowledgeLinkRef[];
}
export type KnowledgeGraphView = "semantic" | "all";
export type KnowledgeGraphRelationType = "link" | "directory" | "duplicate";
export interface KnowledgeGraphRelation {
	source: string;
	target: string;
	type: KnowledgeGraphRelationType;
}
export interface KnowledgeGraphNode {
	path: string;
	title: string;
	kind: string;
	degree: number;
	/** Optional frontmatter type, kept additive for older runtimes. */
	type?: string;
	/** Optional project/shared scope, kept additive for older runtimes. */
	scope?: string;
	/** Normalized paper identifiers used to surface likely duplicates. */
	identifiers?: string[];
	nodeType?: "note" | "wiki" | "navigation" | "mirror" | "infrastructure";
	isInfrastructure?: boolean;
	community?: number;
	x?: number;
	y?: number;
	mirrors?: string[];
	warnings?: string[];
}
export interface KnowledgeGraphSemantic {
	nodes: KnowledgeGraphNode[];
	edges: { source: string; target: string; directory?: boolean }[];
	totalNotes: number;
	view: KnowledgeGraphView;
	mergeMirrors: boolean;
	relations?: KnowledgeGraphRelation[];
	duplicates?: { canonical: string; duplicate: string }[];
	communities?: Record<string, number>;
	layout?: Record<string, { x: number; y: number }>;
	health?: { isolated: number; duplicates: number; infrastructure: number; missingLinks?: number };
}
/** 知识网络图：旧字段保留；语义投影字段全部为可选，兼容旧 worker/IPC。 */
export interface KnowledgeGraph {
	nodes: KnowledgeGraphNode[];
	edges: { source: string; target: string; directory?: boolean }[];
	totalNotes: number;
	revision?: number;
	view?: KnowledgeGraphView;
	mergeMirrors?: boolean;
	relations?: KnowledgeGraphRelation[];
	duplicates?: { canonical: string; duplicate: string }[];
	communities?: Record<string, number>;
	layout?: Record<string, { x: number; y: number }>;
	health?: { isolated: number; duplicates: number; infrastructure: number; missingLinks?: number };
	semantic?: KnowledgeGraphSemantic;
}
/** 每日发现（新旧对照）提出的一条想法 */
export interface DailyDiscoveryIdea {
	id: string;
	title: string;
	idea: string;
	/** 依据：Vault 内笔记路径 */
	basis: string[];
	test: string;
	whyOverlooked: string;
	createdAt: number;
	status: "new" | "saved" | "dismissed";
	savedPath?: string;
}
export type DailyDiscoveryOutcome =
	| { kind: "not-bound"; at: number }
	| { kind: "no-new-notes"; at: number; since: number }
	| { kind: "ran"; at: number; notes: number; added: number };

export interface DailyDiscoveryState {
	enabled: boolean;
	lastRunAt: number | null;
	/** 最近一次运行失败的原因（模型不可用 / 调用出错）；成功后为 null */
	lastError?: string | null;
	/** 最近一次运行的结果：没有绑定 Vault / 没有新笔记 / 读了几篇、新增几条想法 */
	lastOutcome?: DailyDiscoveryOutcome | null;
	/** 未忽略的想法（最新在前） */
	ideas: DailyDiscoveryIdea[];
}
/** 知识库视图搜索框：共享知识 + 当前项目的只读检索 */
export interface KnowledgeSearchRequest {
	cwd?: string | null;
	bindingRevision: number;
	query: string;
	limit?: number;
}
export interface KnowledgeSearchHit {
	path: string;
	title: string;
	kind: string;
	text: string;
}
export interface KnowledgeSearchResult {
	query: string;
	hits: KnowledgeSearchHit[];
	/** false = 索引仍在核对，零结果不代表没有相关知识 */
	complete: boolean;
	warning: string | null;
}
export interface KnowledgeApi {
	getKnowledgeCloudStatus(): Promise<KnowledgeCloudStatus>;
	probeKnowledgeCloud(): Promise<KnowledgeCloudStatus>;
	initializeKnowledgeCloud(): Promise<KnowledgeCloudStatus>;
	/** 保存或清除（null）用户手动输入的 WebDAV 密码；不联网 */
	setKnowledgeCloudPassword(input: { password: string | null }): Promise<KnowledgeCloudStatus>;
	readKnowledgeCloudNote(input: { path: string }): Promise<KnowledgeCloudNote>;
	writeKnowledgeCloudNote(input: {
		path: string;
		text: string;
		expectedVersion?: string;
	}): Promise<KnowledgeCloudWriteResult>;
	syncKnowledgeCloud(input: {
		cwd?: string | null;
		mode: "pull" | "push";
		bindingRevision: number;
		paths: string[];
	}): Promise<KnowledgeCloudSyncResult>;
	searchKnowledge(input: KnowledgeSearchRequest): Promise<KnowledgeSearchResult>;
	getKnowledgeNoteLinks(input: { path: string; revision: number }): Promise<KnowledgeNoteLinks>;
	getKnowledgeGraph(input: {
		revision: number;
		limit?: number;
		view?: KnowledgeGraphView;
		mergeMirrors?: boolean;
	}): Promise<KnowledgeGraph>;
	getDailyDiscovery(): Promise<DailyDiscoveryState>;
	/** enabled: 开关；run: 立即运行一次 */
	updateDailyDiscovery(input: { enabled?: boolean; run?: boolean }): Promise<DailyDiscoveryState>;
	decideDailyIdea(input: { id: string; action: "save" | "dismiss" }): Promise<DailyDiscoveryState>;
	getResearchRuns(input?: ResearchRunsRequest): Promise<{ items: ResearchRunListItem[]; total: number }>;
	getResearchRun(input: ResearchRunRequest): Promise<ResearchRunDetail>;
	getKnowledgeSemanticStatus(input?: {
		cwd?: string | null;
		bindingRevision?: number;
	}): Promise<KnowledgeSemanticStatus>;
	saveKnowledgeSemanticSettings(input: KnowledgeSemanticSettingsRequest): Promise<KnowledgeSemanticSettings>;
	testKnowledgeSemanticProvider(
		input: KnowledgeSemanticProviderRequest,
	): Promise<KnowledgeSemanticProviderResult>;
	indexKnowledgeSemantic(input: KnowledgeSemanticIndexRequest): Promise<KnowledgeSemanticIndexResult>;
	cancelKnowledgeSemanticIndex(input: KnowledgeSemanticIndexCancelRequest): Promise<void>;
	getKnowledgeTopics(input: KnowledgeTopicsRequest): Promise<KnowledgeTopicListResult>;
	archiveKnowledgeTopic(input: KnowledgeTopicArchiveRequest): Promise<unknown>;
	reviewKnowledgeWithModel(input: WikiModelReviewInput): Promise<WikiModelReviewResult>;
	cancelKnowledgeModelReview(input: { sessionId: string; requestId: string }): Promise<void>;
	setKnowledgeSpecialistSettings(input: {
		mode: KnowledgeSpecialistMode;
		revision: number;
		bindingRevision: number;
		maxRunsPerTurn?: number;
		maxRunsPerSession?: number;
		maxToolOperations?: number;
		concurrency?: number;
		queueLimit?: number;
		queueWaitMs?: number;
		timeoutMs?: number;
		maxTokensPerTurn?: number;
		maxTokensPerSession?: number;
		maxCostPerTurn?: number;
		maxCostPerSession?: number;
	}): Promise<KnowledgeSpecialistSettings>;
	getKnowledgeOverview(input?: {
		cwd?: string | null;
		sessionId?: string | null;
	}): Promise<KnowledgeOverview>;
	previewKnowledgeSetup(input: { cwd?: string | null; path?: string | null }): Promise<KnowledgeSetupPreview>;
	startKnowledgeSetup(input: { sessionId: string; path?: string }): Promise<void>;
	getKnowledgeJobs(input?: KnowledgePageRequest): Promise<KnowledgePage<KnowledgeJob>>;
	getKnowledgeReviews(input: KnowledgePageRequest): Promise<KnowledgePage<WikiReviewItem>>;
	previewKnowledgeReview(input: { cwd: string; id: string; revision: number }): Promise<WikiReviewPreview>;
	decideKnowledgeReview(input: {
		cwd: string;
		token: string;
		decision: "apply" | "reject";
	}): Promise<WikiReviewResult>;
	readKnowledgeNote(input: {
		cwd?: string | null;
		path: string;
		startLine?: number;
		revision: number;
	}): Promise<KnowledgeNote>;
	maintainKnowledge(input: {
		cwd?: string | null;
		action: "reconcile" | "refresh-navigation" | "review-automatic" | "review-strict" | "undo-wiki";
		id?: string;
		expectedHash?: string;
		revision: number;
	}): Promise<unknown>;
	openKnowledgeTarget(input: { cwd?: string | null; path?: string | null; revision: number }): Promise<void>;
	resumeKnowledgeCheck(sessionId: string): Promise<void>;
	onKnowledgeEvent(callback: (event: KnowledgeUiEvent) => void): () => void;
}
