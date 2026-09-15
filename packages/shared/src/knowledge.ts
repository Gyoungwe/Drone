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
export interface KnowledgeFlow {
	specialists?: KnowledgeSpecialistRun[];
	sessionId: string;
	turnId: string;
	vaultId: string | null;
	bindingRevision: number | null;
	vault: string | null;
	project: string | null;
	artifacts?: { key: string; title: string; path: string | null; status: string; detail: string }[];
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
export interface KnowledgeApi {
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
		action: "reconcile" | "refresh-navigation";
		revision: number;
	}): Promise<unknown>;
	openKnowledgeTarget(input: { cwd?: string | null; path?: string | null; revision: number }): Promise<void>;
	resumeKnowledgeCheck(sessionId: string): Promise<void>;
	onKnowledgeEvent(callback: (event: KnowledgeUiEvent) => void): () => void;
}
