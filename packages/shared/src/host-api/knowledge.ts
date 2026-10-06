import { Type } from "typebox";
import type {
	KnowledgeApi,
	KnowledgeNote,
	KnowledgeOverview,
	KnowledgePage,
	KnowledgePageRequest,
	KnowledgeSearchRequest,
	KnowledgeSearchResult,
	KnowledgeSemanticIndexCancelRequest,
	KnowledgeSemanticIndexRequest,
	KnowledgeSemanticIndexResult,
	KnowledgeSemanticProviderRequest,
	KnowledgeSemanticProviderResult,
	KnowledgeSemanticSettings,
	KnowledgeSemanticSettingsRequest,
	KnowledgeSemanticStatus,
	KnowledgeSetupPreview,
	KnowledgeTopicArchiveRequest,
	KnowledgeTopicListResult,
	KnowledgeTopicsRequest,
	KnowledgeUiEvent,
	WikiModelReviewInput,
	WikiModelReviewResult,
	WikiReviewItem,
	WikiReviewPreview,
	WikiReviewResult,
} from "../knowledge";
import type { KnowledgeSpecialistSettings } from "../knowledge-specialists";
import { defineDomain } from "./define";

/**
 * Knowledge payloads are produced by the versioned `.pi` knowledge service.
 * Keep the transport boundary strict about the tuple arity and top-level
 * object shape while allowing the service to evolve additive fields without
 * requiring a desktop release for every new projection field.
 */
const ObjectPayload = <T>() => Type.Unsafe<T>({ type: "object" });
const ResultObject = <T>() => Type.Unsafe<T>({ type: "object" });
const OneObject = <T>() => Type.Tuple([ObjectPayload<T>()]);
const OptionalObject = <T>() => Type.Union([Type.Tuple([]), OneObject<T>()]);

const SpecialistSettingsInput = Type.Object(
	{
		mode: Type.Union([Type.Literal("automatic"), Type.Literal("manual"), Type.Literal("off")]),
		revision: Type.Integer({ minimum: 0 }),
		bindingRevision: Type.Integer({ minimum: 0 }),
		maxRunsPerTurn: Type.Optional(Type.Integer({ minimum: 0 })),
		maxRunsPerSession: Type.Optional(Type.Integer({ minimum: 0 })),
		maxToolOperations: Type.Optional(Type.Integer({ minimum: 0 })),
		concurrency: Type.Optional(Type.Integer({ minimum: 1 })),
		queueLimit: Type.Optional(Type.Integer({ minimum: 0 })),
		queueWaitMs: Type.Optional(Type.Integer({ minimum: 0 })),
		timeoutMs: Type.Optional(Type.Integer({ minimum: 0 })),
		maxTokensPerTurn: Type.Optional(Type.Integer({ minimum: 0 })),
		maxTokensPerSession: Type.Optional(Type.Integer({ minimum: 0 })),
		maxCostPerTurn: Type.Optional(Type.Number({ minimum: 0 })),
		maxCostPerSession: Type.Optional(Type.Number({ minimum: 0 })),
	},
	{ additionalProperties: false },
);

const ZoteroStatusSchema = Type.Object(
	{
		registered: Type.Boolean(),
		enabled: Type.Boolean(),
		command: Type.Union([Type.String(), Type.Null()]),
		localApiReachable: Type.Boolean(),
		desktopDetected: Type.Boolean(),
		desktopPath: Type.Union([Type.String(), Type.Null()]),
		docsUrl: Type.String({ minLength: 1 }),
		downloadUrl: Type.String({ minLength: 1 }),
	},
	{ additionalProperties: false },
);

/** Host API contract for knowledge management, reviews, semantic indexing and Zotero status. */
export const KnowledgeContract = defineDomain("knowledge", {
	methods: {
		setSpecialistSettings: {
			args: Type.Tuple([SpecialistSettingsInput]),
			result: ResultObject<KnowledgeSpecialistSettings>(),
		},
		getOverview: {
			args: OptionalObject<{ cwd?: string | null; sessionId?: string | null }>(),
			result: ResultObject<KnowledgeOverview>(),
		},
		previewSetup: {
			args: OneObject<{ cwd?: string | null; path?: string | null }>(),
			result: ResultObject<KnowledgeSetupPreview>(),
		},
		startSetup: {
			args: OneObject<{ sessionId: string; path?: string }>(),
			result: Type.Void(),
		},
		getJobs: {
			args: OptionalObject<KnowledgePageRequest>(),
			result: ResultObject<KnowledgePage<unknown>>(),
		},
		getReviews: {
			args: OneObject<KnowledgePageRequest>(),
			result: ResultObject<KnowledgePage<WikiReviewItem>>(),
		},
		previewReview: {
			args: OneObject<{ cwd: string; id: string; revision: number }>(),
			result: ResultObject<WikiReviewPreview>(),
		},
		reviewWithModel: {
			args: OneObject<WikiModelReviewInput>(),
			result: ResultObject<WikiModelReviewResult>(),
		},
		cancelModelReview: {
			args: OneObject<{ sessionId: string; requestId: string }>(),
			result: Type.Void(),
		},
		decideReview: {
			args: OneObject<{ cwd: string; token: string; decision: "apply" | "reject" }>(),
			result: ResultObject<WikiReviewResult>(),
		},
		readNote: {
			args: OneObject<{ cwd?: string | null; path: string; startLine?: number; revision: number }>(),
			result: ResultObject<KnowledgeNote>(),
		},
		maintain: {
			args: OneObject<{
				cwd?: string | null;
				action: "reconcile" | "refresh-navigation" | "review-automatic" | "review-strict" | "undo-wiki";
				id?: string;
				expectedHash?: string;
				revision: number;
			}>(),
			result: Type.Unknown(),
		},
		openTarget: {
			args: OneObject<{ cwd?: string | null; path?: string | null; revision: number }>(),
			result: Type.Void(),
		},
		resumeCheck: {
			args: Type.Tuple([Type.String({ minLength: 1 })]),
			result: Type.Void(),
		},
		getSemanticStatus: {
			args: OptionalObject<{ cwd?: string | null; bindingRevision?: number }>(),
			result: ResultObject<KnowledgeSemanticStatus>(),
		},
		saveSemanticSettings: {
			args: OneObject<KnowledgeSemanticSettingsRequest>(),
			result: ResultObject<KnowledgeSemanticSettings>(),
		},
		testSemanticProvider: {
			args: OneObject<KnowledgeSemanticProviderRequest>(),
			result: ResultObject<KnowledgeSemanticProviderResult>(),
		},
		indexSemantic: {
			args: OneObject<KnowledgeSemanticIndexRequest>(),
			result: ResultObject<KnowledgeSemanticIndexResult>(),
		},
		cancelSemanticIndex: {
			args: OneObject<KnowledgeSemanticIndexCancelRequest>(),
			result: Type.Void(),
		},
		search: {
			args: OneObject<KnowledgeSearchRequest>(),
			result: ResultObject<KnowledgeSearchResult>(),
		},
		getTopics: {
			args: OneObject<KnowledgeTopicsRequest>(),
			result: ResultObject<KnowledgeTopicListResult>(),
		},
		archiveTopic: {
			args: OneObject<KnowledgeTopicArchiveRequest>(),
			result: Type.Unknown(),
		},
		getZoteroStatus: {
			args: Type.Tuple([]),
			result: ZoteroStatusSchema,
		},
	},
	events: {
		event: ObjectPayload<KnowledgeUiEvent>(),
	},
});

export type KnowledgeSchemaTypes = {
	setSpecialistSettings: Parameters<KnowledgeApi["setKnowledgeSpecialistSettings"]>;
	getOverview: Parameters<KnowledgeApi["getKnowledgeOverview"]>;
	previewSetup: Parameters<KnowledgeApi["previewKnowledgeSetup"]>;
	startSetup: [{ sessionId: string; path?: string }];
	getJobs: Parameters<KnowledgeApi["getKnowledgeJobs"]>;
	getReviews: Parameters<KnowledgeApi["getKnowledgeReviews"]>;
	previewReview: Parameters<KnowledgeApi["previewKnowledgeReview"]>;
	reviewWithModel: Parameters<KnowledgeApi["reviewKnowledgeWithModel"]>;
	cancelModelReview: Parameters<KnowledgeApi["cancelKnowledgeModelReview"]>;
	decideReview: Parameters<KnowledgeApi["decideKnowledgeReview"]>;
	readNote: Parameters<KnowledgeApi["readKnowledgeNote"]>;
	maintain: Parameters<KnowledgeApi["maintainKnowledge"]>;
	openTarget: Parameters<KnowledgeApi["openKnowledgeTarget"]>;
	resumeCheck: [sessionId: string];
	getSemanticStatus: Parameters<KnowledgeApi["getKnowledgeSemanticStatus"]>;
	saveSemanticSettings: Parameters<KnowledgeApi["saveKnowledgeSemanticSettings"]>;
	testSemanticProvider: Parameters<KnowledgeApi["testKnowledgeSemanticProvider"]>;
	indexSemantic: Parameters<KnowledgeApi["indexKnowledgeSemantic"]>;
	cancelSemanticIndex: Parameters<KnowledgeApi["cancelKnowledgeSemanticIndex"]>;
	search: Parameters<KnowledgeApi["searchKnowledge"]>;
	getTopics: Parameters<KnowledgeApi["getKnowledgeTopics"]>;
	archiveTopic: Parameters<KnowledgeApi["archiveKnowledgeTopic"]>;
	getZoteroStatus: [];
};
