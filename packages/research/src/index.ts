export {
	buildProxiedUrl,
	inferEzproxyTemplateFromUrl,
} from "./institutional-proxy";
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
	type DeliveryContract,
	deliveryContract,
	hasPaperCitation,
	PAPER_EVIDENCE_GUIDANCE,
	RESEARCH_ANSWER_GUIDANCE,
	requiresPaperEvidence,
} from "./source-delivery";
