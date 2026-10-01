export {
	type ClaimComparison,
	type ClaimSetComparison,
	compareClaimSets,
	compareClaims,
	type KnowledgeClaim,
} from "./claim-conflicts";
export {
	createKnowledgeConfigApi,
	createKnowledgeConfigState,
	type KnowledgeBinding,
	type KnowledgeBindingInput,
	type KnowledgeConfigApi,
	type KnowledgeConfigState,
	type KnowledgeDepositMode,
	type KnowledgeProfile,
	type KnowledgeSubagentPolicy,
	knowledgeDirectory,
	projectIdentity,
	readKnowledgeBinding,
	saveKnowledgeBinding,
	withKnowledgeBinding,
} from "./config";
export {
	continuationHint,
	continuesTopic,
	currentProject,
	explainerTopicId,
	type KnowledgeToolResult,
	result,
	type SessionIdentityContext,
	sessionIdentity,
	type TopicForContinuation,
} from "./extension-helpers";
export {
	allowedSegment,
	canRead,
	fileVersion,
	inspectNote,
	MAX_NOTE_BYTES,
	noteScope,
	readNoteFile,
	safeNotePath,
	snippet,
	validateNote,
} from "./files";
export {
	type CardFieldOptions,
	cardField,
	cardLink,
	type FlowCard,
	type FlowCardField,
	type FlowCardInput,
	type FlowCardLink,
	type FlowEvent,
	type FlowEventContent,
	type FlowTone,
	failureCard,
	flowCard,
	literatureCard,
	statusTone,
} from "./flow-cards";
export {
	containedVaultFile,
	createVaultFileOnly,
	initializeProjectContext,
	initializeSharedNavigation,
	type KnowledgeLayoutDependencies,
	type NavigationUpdateResult,
	updateVaultNavigation,
} from "./layout";
export {
	createSpecialistBudget,
	decideSpecialistRun,
	SPECIALIST_DECISIONS,
	type SpecialistBudget,
	type SpecialistBudgetOptions,
	type SpecialistBudgetSnapshot,
	type SpecialistDecision,
	type SpecialistRequestSignatureOptions,
	type SpecialistRunDecision,
	type SpecialistRunOptions,
	type SpecialistUsage,
	specialistRequestSignature,
} from "./orchestration-policy";
export {
	advisoryLine,
	advisoryNotice,
	knowledgeFailure,
	type PublicationFailure,
	type PublicationFailureCode,
	type PublicationVerification,
	publicationFallbackNotice,
	publicationNotice,
	publicationNotices,
} from "./publication-policy";
export {
	advisoryCodes,
	type ReviewMode,
	readReviewMode,
	saveReviewMode,
} from "./review-policy";
export {
	buildKnowledgeSearchExpression,
	splitKnowledgeChunks,
	tokenizeKnowledgeText,
} from "./search-policy";
export { embedTexts, validateSemanticConfig as validateSemanticProviderConfig } from "./semantic-provider";
export {
	createSemanticSettingsApi,
	createSemanticSettingsState,
	readSemanticSettings,
	type SemanticConfig,
	type SemanticProvider,
	type SemanticSettings,
	type SemanticSettingsApi,
	type SemanticSettingsState,
	saveSemanticSettings,
	validateSemanticConfig,
} from "./semantic-settings";
export {
	normalizeSourceLinks,
	onlineSourceLink,
	type SourceLinkOptions,
	type SourceLinksResult,
} from "./source-links";
export {
	createTaskFeedback,
	guardResearchToolResult,
	type ResearchToolResultEvent,
	type TaskFeedback,
	type TaskFeedbackContent,
	type TaskFeedbackContext,
	type TaskFeedbackEvent,
	type TaskFeedbackFacts,
	type TaskFeedbackFailure,
	type TaskFeedbackFile,
} from "./task-feedback";
export {
	createToolBudget,
	type ToolBudget,
	type ToolBudgetFailure,
	type ToolBudgetOptions,
} from "./tool-budget";
export {
	autoTopicCandidate,
	type TopicCandidate,
	type TopicCandidateInput,
	type TopicCandidateResult,
} from "./topic-candidate";
export {
	immutableWikiProposalHash,
	MANAGED_END,
	MANAGED_START,
	type ManagedParts,
	managedParts,
	proposedWikiText,
	targetWikiPath,
	validateSpecialistHtml,
	validateWikiSourcePaths,
	type WikiProposalShape,
} from "./wiki-policy";

export {
	TOPIC_MEMORY_LIMITS,
	TOPIC_MEMORY_VERSION,
	archiveTopic,
	classifyTopic,
	createTopicMemory,
	listTopics,
	readTopic,
	topicRunHash,
	updateTopic,
} from "./topic-memory";
export { runNavigationMaintenance, updateNavigation } from "./maintenance";
export { configureKnowledgeRuntime } from "./runtime-host";

export {
	beginKnowledgeFlow,
	clearKnowledgeFlow,
	emitKnowledgeUi,
	flowFor,
	invalidateKnowledgeUi,
	noteKnowledgeOperation,
	noteKnowledgeRead,
	noteKnowledgeSearch,
	noteKnowledgeSpecialist,
	publicationKnowledgeFlow,
	subscribeKnowledgeUi,
	updateKnowledgeFlow,
} from "./ui-state";
export {
	projectKnowledgeEvent,
	projectKnowledgeSnapshot,
	registerAnswerPublication,
} from "./publication";

export { KnowledgeService, closeKnowledgeServices, getKnowledgeService, notifyKnowledgeChange } from "./service";

export {
	decideWikiProposal,
	listWikiProposals,
	mergeWikiProposal,
	previewWikiProposal,
	stageWikiProposal,
	undoWikiUpdate,
	wikiHistory,
	validateWikiSourcePaths as validateRuntimeWikiSourcePaths,
} from "./wiki-review";

export {
	SPECIALIST_LIMITS,
	contextSessionId,
	knowledgeSpecialistHost,
	registerKnowledgeSpecialistHost,	
	setSpecialistSettings,
	specialistQueueSnapshot,
	specialistSettings,	
	withSpecialistSlot,
} from "./specialist-host";
