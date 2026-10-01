export {
	CLAIM_BINDING_SCHEMA,
	type ClaimBinding,
	type ClaimBindingSource,
	type ClaimReadRecord,
	type ClaimSourceRecord,
	claimBindingRefs,
	validateClaimBindings,
} from "./claim-bindings";
export {
	assertEvidenceAnswerable,
	createEvidenceGate,
	EVIDENCE_STAGES,
	type EvidenceEvent,
	type EvidenceFailure,
	type EvidenceGate,
	type EvidenceGateFailureState,
	type EvidenceGateState,
	type EvidenceStage,
} from "./evidence-gate";
export {
	buildProxiedUrl,
	inferEzproxyTemplateFromUrl,
} from "./institutional-proxy";
export {
	createLiteratureOperations,
	type DestinationRecovery,
	destinationRecovery,
	type LiteratureDestinationReceipt,
	type LiteratureOperationInput,
	type LiteratureOperationJournal,
	type LiteratureOperationLocation,
	type LiteratureOperationPorts,
	type LiteratureOperationReceipt,
	type LiteratureOperationRecord,
	type LiteratureOperationVerifier,
	type LiteratureWriteRecord,
	literatureOperationId,
	type ZoteroWriteReceipt,
} from "./literature-operations";
export {
	exactDoiItems,
	type LiteratureItem,
	type LiteratureReceipt,
	type LiteratureReceiptOptions,
	normalizeDoi,
	verifyLiteratureReceipt,
} from "./literature-receipt";
export {
	contactEmail,
	normalizePmcid,
	normalizePmid,
	OA_DEFAULT_TIMEOUT_MS,
	OA_MAX_CANDIDATES,
	OA_SOURCES,
	type OpenAccessCandidate,
	type OpenAccessOptions,
	type OpenAccessQuery,
	type OpenAccessResolution,
	PMC_CLOUD_BASE,
	pmcCloudHttps,
	resolveOpenAccess,
} from "./open-access";
export {
	createResearchReceiptJournal,
	type ResearchJournalPorts,
	type ResearchJournalWorkspace,
} from "./receipt-journal";
export {
	CORE_RESEARCH_RECEIPT_TOOLS,
	type CoreResearchReceiptTool,
	ReceiptJournalBuffer,
	type ReceiptJournalBufferOptions,
	type ReceiptJournalSnapshot,
	type ResearchReceiptEvent,
	receiptBelongsToRun,
	shouldRecordResearchReceipt,
} from "./receipt-journal-policy";
export {
	type ExecutionReceiptInput,
	observeExecutionReceipt,
	type ProvenanceFileDeclaration,
	type ProvenanceSnapshot,
	type RunProvenanceInput,
	type RunProvenanceManifest,
	type RunProvenanceResult,
	recordRunProvenance,
	type WorkspaceConfig,
	type WorkspaceConfigLoader,
} from "./run-provenance";
export {
	archiveSource,
	type SourceArchivePorts,
	type SourceArchiveWorkspace,
	sourceStatus,
} from "./source-archive";
export {
	type ContentValidation,
	DEFAULT_MAX_BYTES,
	DEFAULT_TIMEOUT_MS,
	hasMagic,
	isWithin,
	looksLikeChallenge,
	normalizeMetadata,
	SOURCE_CATEGORIES,
	type SourceCategory,
	type SourceMetadata,
	safeFilename,
	validateContent,
	validateRunDir,
} from "./source-archive-policy";
export {
	type DeliveryContract,
	deliveryContract,
	hasPaperCitation,
	PAPER_EVIDENCE_GUIDANCE,
	RESEARCH_ANSWER_GUIDANCE,
	requiresPaperEvidence,
} from "./source-delivery";
export {
	findZoteroItemsByIdentity,
	isValidZoteroDoi,
	isZoteroItemKey,
	normalizeZoteroDoi,
	summarizeZoteroAttachments,
	ZOTERO_KEY_PATTERN,
	type ZoteroAttachmentIdentity,
	type ZoteroIdentityItem,
	type ZoteroIdentityQuery,
	zoteroItemDoi,
} from "./zotero-identity";
export {
	lookupZoteroByDoi,
	type ZoteroListResponse,
	type ZoteroReadRequest,
	type ZoteroReconcileContext,
	type ZoteroReconcileExpectation,
} from "./zotero-reconcile";
export {
	mergeZoteroMcpConfig,
	readZoteroMcpConfig,
	remainingZoteroSetupSteps,
	ZOTERO_SETUP_BINDING,
	type ZoteroMcpServerEntry,
	type ZoteroSetupStatus,
	zoteroMcpSpec,
} from "./zotero-setup";
export {
	type ConnectorZoteroItem,
	connectorTargetId,
	type NormalizedZoteroAttachment,
	type NormalizedZoteroItem,
	normalizeZoteroAttachment,
	normalizeZoteroItem,
	toConnectorItem,
	toWebApiItem,
	type WebApiZoteroItem,
	ZOTERO_ITEM_SPECS,
	ZOTERO_ITEM_TYPES,
	ZOTERO_WRITE_LIMITS,
	type ZoteroCreator,
	type ZoteroWriteInput,
} from "./zotero-write";

export { createResearchLoop, RESEARCH_STAGES, type ResearchLoopPorts, type ResearchLoopWorkspace } from "./research-loop";
