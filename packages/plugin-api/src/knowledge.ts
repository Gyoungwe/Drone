/**
 * Host-neutral knowledge contracts.
 *
 * This module intentionally has no dependency on Drone implementation
 * packages. It is the contract that a future installable knowledge plugin
 * can share with native Pi and Desktop hosts.
 */

export const KNOWLEDGE_CONTRACT_VERSION = 1 as const;
export type KnowledgeContractVersion = typeof KNOWLEDGE_CONTRACT_VERSION;

/** Host callbacks used by the installable knowledge extension without importing Drone packages. */
export interface KnowledgeExtensionHost {
	readonly bindAcceptanceVerifierEvents?: (pi: unknown) => void;
	readonly registerAcceptanceVerifier?: (name: string, definition: unknown) => unknown;
	readonly registerTaskRuntime?: (pi: unknown, options: unknown) => unknown;
	readonly registerTool?: (pi: unknown, definition: unknown) => void;
}

export type ContractParentRef =
	| string
	| {
			readonly kind: string;
			readonly id: string;
			readonly revision?: number;
			readonly contentHash?: string;
	  };

export const RESEARCH_CONTRACT_SCHEMA_VERSION = 1 as const;
export type ResearchContractSchemaVersion = typeof RESEARCH_CONTRACT_SCHEMA_VERSION;

export interface VersionedRecord {
	readonly schemaVersion: number;
	readonly revision: number;
	readonly contentHash: string;
	readonly parentRefs: readonly ContractParentRef[];
}

export type VersionedResearchContract = VersionedRecord;

export type KnowledgeReuseLevel =
	| "navigation-only"
	| "evidence-eligible"
	| "validated-capability"
	| "reproduced-capability";

export type KnowledgeEvidenceGrade = "navigation" | "contextual" | "primary" | "validated" | "reproduced";

export interface KnowledgeFreshness {
	readonly checkedAt: string;
	readonly expiresAt?: string;
	readonly status?: "fresh" | "stale" | "unknown";
}

export interface KnowledgeSourceReceipt {
	readonly sourceRef: string;
	readonly relativePath?: string;
	readonly sourceType?:
		| "project-file"
		| "literature"
		| "dataset"
		| "protocol"
		| "institutional"
		| "connector";
	readonly locator?: string;
	readonly license?: string;
	readonly accessedAt?: string;
	readonly failureReason?: string;
	readonly version?: string;
	readonly summary?: string;
	readonly contentHash: string;
	readonly receiptRef: string;
	readonly readAt: string;
	readonly evidenceGrade?: KnowledgeEvidenceGrade;
	readonly evidenceLevel?: KnowledgeEvidenceGrade;
	readonly freshness?: KnowledgeFreshness;
	readonly analysisRefs?: readonly ContractParentRef[];
	readonly checkpointRefs?: readonly ContractParentRef[];
}

export interface KnowledgeSnapshot extends VersionedResearchContract {
	readonly legacyCheckpoint?: unknown;
	readonly kind: "knowledge-snapshot";
	readonly id: string;
	readonly caseRef?: ContractParentRef;
	readonly projectId?: string;
	readonly workspaceId?: string;
	readonly assay?: string;
	readonly environmentFingerprint?: string;
	readonly sources: readonly KnowledgeSourceReceipt[];
	readonly approval?: "pending" | "approved" | "rejected" | "revoked";
	readonly reuseLevel: KnowledgeReuseLevel;
	readonly evidenceGrade?: KnowledgeEvidenceGrade;
	readonly evidenceLevel?: KnowledgeEvidenceGrade;
	readonly freshness?: KnowledgeFreshness;
	readonly methodVersion?: string;
	readonly referenceVersion?: string;
	readonly inputManifestHash?: string;
	readonly analysisRefs?: readonly ContractParentRef[];
	readonly evidenceCheckpointRefs?: readonly ContractParentRef[];
	readonly createdAt: string;
	readonly ingestedAt?: string;
}

export interface CapabilitySourceReceipt extends VersionedResearchContract {
	readonly kind: "capability-source-receipt";
	readonly id: string;
	readonly sourceRef: string;
	readonly sourceHash: string;
	readonly locator?: string;
	readonly observedAt: string;
	readonly readOnly: true;
}

export type EvolutionCandidateStatus = "proposed" | "approved" | "rejected" | "superseded" | "revoked";

export interface EvolutionCandidate extends VersionedResearchContract {
	readonly kind: "evolution-candidate";
	readonly id: string;
	readonly projectRef: ContractParentRef;
	readonly runRefs: readonly ContractParentRef[];
	readonly knowledgeSnapshotRefs: readonly ContractParentRef[];
	readonly experienceRefs: readonly ContractParentRef[];
	readonly observationCount: number;
	readonly minimumObservations: number;
	readonly proposal: string;
	readonly status: EvolutionCandidateStatus;
	readonly executionEligible: boolean;
	readonly approvalRef?: ContractParentRef;
	readonly supersedesRef?: ContractParentRef;
	readonly revokedByRef?: ContractParentRef;
	readonly reason?: string;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export type KnowledgeReuseDecisionStatus = "eligible" | "blocked" | "approved" | "rejected" | "revoked";

export interface KnowledgeReuseDecisionRecord extends VersionedResearchContract {
	readonly kind: "knowledge-reuse-decision";
	readonly id: string;
	readonly projectRef: ContractParentRef;
	readonly runRef: ContractParentRef;
	readonly snapshotRef: ContractParentRef;
	readonly status: KnowledgeReuseDecisionStatus;
	readonly reusable: boolean;
	readonly reasons: readonly string[];
	readonly executionEligible: boolean;
	readonly approvalRef?: ContractParentRef;
	readonly revokedByRef?: ContractParentRef;
	readonly evaluatedAt: string;
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.filter(([, item]) => item !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([key, item]) => [key, canonicalize(item)]),
	);
}

/** Synchronous SHA-256 keeps the contract usable in native Pi and browsers. */
function sha256(text: string): string {
	const bytes: number[] = [];
	for (const character of text) {
		let point = character.codePointAt(0) ?? 0;
		if (point >= 0xd800 && point <= 0xdfff) point = 0xfffd;
		if (point < 0x80) bytes.push(point);
		else if (point < 0x800) bytes.push(0xc0 | (point >> 6), 0x80 | (point & 63));
		else if (point < 0x10000)
			bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 63), 0x80 | (point & 63));
		else
			bytes.push(
				0xf0 | (point >> 18),
				0x80 | ((point >> 12) & 63),
				0x80 | ((point >> 6) & 63),
				0x80 | (point & 63),
			);
	}
	const length = bytes.length * 8;
	bytes.push(0x80);
	while (bytes.length % 64 !== 56) bytes.push(0);
	const high = Math.floor(length / 0x100000000);
	for (const word of [high, length >>> 0])
		for (let shift = 24; shift >= 0; shift -= 8) bytes.push((word >>> shift) & 255);
	const state = [
		0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
	];
	const constants = [
		0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
		0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
		0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
		0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
		0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
		0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
		0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
		0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
	];
	const rotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));
	for (let offset = 0; offset < bytes.length; offset += 64) {
		const words: number[] = [];
		for (let i = 0; i < 16; i += 1) {
			const j = offset + i * 4;
			words[i] =
				((bytes[j] ?? 0) << 24) |
				((bytes[j + 1] ?? 0) << 16) |
				((bytes[j + 2] ?? 0) << 8) |
				(bytes[j + 3] ?? 0);
		}
		for (let i = 16; i < 64; i += 1) {
			const x = words[i - 15] ?? 0;
			const y = words[i - 2] ?? 0;
			words[i] =
				((words[i - 16] ?? 0) +
					(rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3)) +
					(words[i - 7] ?? 0) +
					(rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10))) |
				0;
		}
		let [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0] = state;
		for (let i = 0; i < 64; i += 1) {
			const t1 =
				(h +
					(rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) +
					((e & f) ^ (~e & g)) +
					(constants[i] ?? 0) +
					(words[i] ?? 0)) |
				0;
			const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
			h = g;
			g = f;
			f = e;
			e = (d + t1) | 0;
			d = c;
			c = b;
			b = a;
			a = (t1 + t2) | 0;
		}
		for (const [i, value] of [a, b, c, d, e, f, g, h].entries()) state[i] = ((state[i] ?? 0) + value) | 0;
	}
	return state.map((value) => (value >>> 0).toString(16).padStart(8, "0")).join("");
}

export function canonicalContractJson(value: unknown): string {
	return JSON.stringify(canonicalize(value));
}

export function contractContentHash(value: unknown): string {
	return sha256(canonicalContractJson(value));
}

function computeResearchContractHash<T extends VersionedResearchContract>(value: T): string {
	const {
		contentHash: _contentHash,
		decisionHash: _decisionHash,
		...body
	} = value as T & { decisionHash?: unknown };
	return contractContentHash(body);
}

function assertContract(value: VersionedResearchContract): void {
	if (value.schemaVersion !== RESEARCH_CONTRACT_SCHEMA_VERSION) throw new Error("Invalid schemaVersion");
	if (!Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error("Invalid revision");
	if (!/^[a-f0-9]{64}$/.test(value.contentHash)) throw new Error("Invalid contentHash");
	if (!Array.isArray(value.parentRefs)) throw new Error("Invalid parentRefs");
	if (value.contentHash !== computeResearchContractHash(value))
		throw new Error("Contract contentHash mismatch");
}

function base<T extends Record<string, unknown>>(
	body: T,
	options: { readonly revision?: number; readonly parentRefs?: readonly ContractParentRef[] } = {},
): T & VersionedResearchContract {
	const record = {
		...body,
		schemaVersion: RESEARCH_CONTRACT_SCHEMA_VERSION,
		revision: options.revision ?? 0,
		parentRefs: [...(options.parentRefs ?? [])],
	};
	const result = {
		...record,
		contentHash: computeResearchContractHash(record as unknown as T & VersionedResearchContract),
	} as T & VersionedResearchContract;
	assertContract(result);
	return result;
}

export function createKnowledgeSnapshot(
	input: Omit<KnowledgeSnapshot, keyof VersionedResearchContract | "kind"> & {
		readonly revision?: number;
		readonly parentRefs?: readonly ContractParentRef[];
	},
): KnowledgeSnapshot {
	return base({ ...input, kind: "knowledge-snapshot" as const }, input) as KnowledgeSnapshot;
}

function requireRef(ref: ContractParentRef | undefined, label: string): ContractParentRef {
	if (!ref || (typeof ref === "string" ? !ref.trim() : !ref.id.trim() || !ref.kind.trim()))
		throw new Error(`${label} is required`);
	return ref;
}

function refOf(value: VersionedResearchContract & { kind: string; id: string }): ContractParentRef {
	return { kind: value.kind, id: value.id, revision: value.revision, contentHash: value.contentHash };
}

export function createEvolutionCandidate(input: {
	readonly id: string;
	readonly projectRef: ContractParentRef;
	readonly runRefs: readonly ContractParentRef[];
	readonly knowledgeSnapshotRefs?: readonly ContractParentRef[];
	readonly experienceRefs: readonly ContractParentRef[];
	readonly observationCount: number;
	readonly minimumObservations?: number;
	readonly proposal: string;
	readonly createdAt: string;
}): EvolutionCandidate {
	const minimumObservations = input.minimumObservations ?? 2;
	if (!input.id.trim() || !input.proposal.trim())
		throw new Error("Evolution candidate identity and proposal are required");
	if (!Number.isSafeInteger(input.observationCount) || input.observationCount < minimumObservations)
		throw new Error("Evolution candidate requires repeated observations before approval");
	if (!Number.isSafeInteger(minimumObservations) || minimumObservations < 2)
		throw new Error("Evolution candidate minimum observations must be at least two");
	if (!input.runRefs.length || !input.experienceRefs.length)
		throw new Error("Evolution candidate lineage is required");
	if (input.experienceRefs.length < minimumObservations)
		throw new Error("Evolution candidate experience lineage must cover every required observation");
	return base({
		kind: "evolution-candidate" as const,
		id: input.id,
		projectRef: requireRef(input.projectRef, "projectRef"),
		runRefs: [...input.runRefs],
		knowledgeSnapshotRefs: [...(input.knowledgeSnapshotRefs ?? [])],
		experienceRefs: [...input.experienceRefs],
		observationCount: input.observationCount,
		minimumObservations,
		proposal: input.proposal,
		status: "proposed" as const,
		executionEligible: false as const,
		createdAt: input.createdAt,
		updatedAt: input.createdAt,
	});
}

export function approveEvolutionCandidate(
	candidate: EvolutionCandidate,
	approvalRef: ContractParentRef,
	updatedAt: string,
): EvolutionCandidate {
	if (candidate.status !== "proposed") throw new Error("Only a proposed evolution candidate can be approved");
	if (candidate.observationCount < candidate.minimumObservations)
		throw new Error("Evolution candidate does not meet its repeated-observation gate");
	const approval = requireRef(approvalRef, "approvalRef");
	return base(
		{
			...candidate,
			status: "approved" as const,
			executionEligible: true as const,
			approvalRef: approval,
			updatedAt,
		},
		{ revision: candidate.revision + 1, parentRefs: [refOf(candidate), approval] },
	) as EvolutionCandidate;
}

export function supersedeEvolutionCandidate(
	candidate: EvolutionCandidate,
	supersedingRef: ContractParentRef,
	updatedAt: string,
): EvolutionCandidate {
	if (candidate.status === "revoked") throw new Error("A revoked evolution candidate cannot be superseded");
	const superseding = requireRef(supersedingRef, "supersedingRef");
	return base(
		{
			...candidate,
			status: "superseded" as const,
			executionEligible: false as const,
			supersedesRef: superseding,
			updatedAt,
		},
		{ revision: candidate.revision + 1, parentRefs: [refOf(candidate), superseding] },
	) as EvolutionCandidate;
}

export function revokeEvolutionCandidate(
	candidate: EvolutionCandidate,
	revokedByRef: ContractParentRef,
	reason: string,
	updatedAt: string,
): EvolutionCandidate {
	if (!reason.trim()) throw new Error("Revocation reason is required");
	const revokedBy = requireRef(revokedByRef, "revokedByRef");
	return base(
		{
			...candidate,
			status: "revoked" as const,
			executionEligible: false as const,
			revokedByRef: revokedBy,
			reason,
			updatedAt,
		},
		{ revision: candidate.revision + 1, parentRefs: [refOf(candidate), revokedBy] },
	) as EvolutionCandidate;
}

export function createKnowledgeReuseDecision(input: {
	readonly id: string;
	readonly projectRef: ContractParentRef;
	readonly runRef: ContractParentRef;
	readonly snapshotRef: ContractParentRef;
	readonly reusable: boolean;
	readonly reasons: readonly string[];
	readonly evaluatedAt: string;
}): KnowledgeReuseDecisionRecord {
	return base({
		kind: "knowledge-reuse-decision" as const,
		id: input.id,
		projectRef: requireRef(input.projectRef, "projectRef"),
		runRef: requireRef(input.runRef, "runRef"),
		snapshotRef: requireRef(input.snapshotRef, "snapshotRef"),
		status: input.reusable ? ("eligible" as const) : ("blocked" as const),
		reusable: input.reusable,
		reasons: [...input.reasons],
		executionEligible: false as const,
		evaluatedAt: input.evaluatedAt,
	});
}

export function approveKnowledgeReuse(
	decision: KnowledgeReuseDecisionRecord,
	approvalRef: ContractParentRef,
	evaluatedAt: string,
): KnowledgeReuseDecisionRecord {
	if (decision.status !== "eligible" || !decision.reusable)
		throw new Error("Only an eligible reuse decision can be approved");
	const approval = requireRef(approvalRef, "approvalRef");
	return base(
		{
			...decision,
			status: "approved" as const,
			executionEligible: true as const,
			approvalRef: approval,
			evaluatedAt,
		},
		{ revision: decision.revision + 1, parentRefs: [refOf(decision), approval] },
	) as KnowledgeReuseDecisionRecord;
}

export function revokeKnowledgeReuse(
	decision: KnowledgeReuseDecisionRecord,
	revokedByRef: ContractParentRef,
	evaluatedAt: string,
): KnowledgeReuseDecisionRecord {
	const revokedBy = requireRef(revokedByRef, "revokedByRef");
	return base(
		{
			...decision,
			status: "revoked" as const,
			executionEligible: false as const,
			revokedByRef: revokedBy,
			evaluatedAt,
		},
		{ revision: decision.revision + 1, parentRefs: [refOf(decision), revokedBy] },
	) as KnowledgeReuseDecisionRecord;
}

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
	categoryCounts?: { paper: number; software: number; method: number; idea: number; other: number };
}

export interface KnowledgeRecentNote {
	path: string;
	title: string;
	kind: "note" | "wiki";
	updatedAt: number;
}

export interface KnowledgeAnswerMetric {
	answered: number;
	total: number;
	rate: number | null;
	updatedAt: number | null;
}

export type KnowledgeSpecialistMode = "automatic" | "manual" | "off";
export interface KnowledgeSpecialistSettings {
	mode: KnowledgeSpecialistMode;
	revision: number;
	maxRunsPerTurn: number;
	maxRunsPerSession: number;
	maxToolOperations: number;
	concurrency: number;
	queueLimit: number;
	queueWaitMs: number;
	timeoutMs: number;
	maxTokensPerTurn: number;
	maxTokensPerSession: number;
	maxCostPerTurn: number;
	maxCostPerSession: number;
}

export type KnowledgeSpecialistRole = "navigator" | "evidence" | "wiki" | "explainer" | "reviewer";
export interface KnowledgeSpecialistRun {
	id: string;
	role: KnowledgeSpecialistRole;
	name: string;
	label: string;
	status: "queued" | "running" | "completed" | "failed" | "cancelled" | "skipped";
	action?: string;
	model?: string;
	thinkingLevel?: string;
	startedAt?: number;
	endedAt?: number;
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	reasoningTokens?: number;
	totalTokens?: number;
	cost?: number;
	usageReported?: boolean;
	reportedFields?: string[];
	decision?: "run" | "skip" | "wait" | "ask-user";
	reasonCode?: string;
	nextAction?: string;
	elapsedMs?: number;
	budget?: Record<string, number>;
	sourceCount?: number;
	summary?: string;
	error?: string;
	sources?: { path: string; hash: string; startLine: number; endLine: number; excerpt?: string }[];
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
export interface KnowledgeFlowCardLink {
	label: string;
	i18n?: string;
	kind: "external" | "resource" | "note" | "path";
	target: string;
}
export interface KnowledgeFlowCard {
	key: string;
	kind: string;
	title: string;
	provisionalTitle?: boolean;
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

export interface KnowledgeFlow {
	specialists?: KnowledgeSpecialistRun[];
	sessionId: string;
	turnId: string;
	vaultId: string | null;
	bindingRevision: number | null;
	vault: string | null;
	project: string | null;
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
	localAnswer?: boolean;
	localAnswerRate?: KnowledgeAnswerMetric | null;
	stages?: { navigation: boolean; wiki: boolean; search: boolean; publication: boolean };
	error?: string | null;
}

export interface KnowledgeOverview {
	reviewMode?: "automatic" | "strict";
	wikiHistory?: { id: string; path: string; afterHash: string; reviewedAt: number; reviewMethod: string }[];
	recentNotes?: KnowledgeRecentNote[];
	recentByCategory?: Partial<Record<"paper" | "software" | "method" | "idea", KnowledgeRecentNote[]>> | null;
	localAnswerRate?: KnowledgeAnswerMetric | null;
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

export interface KnowledgeLinkRef {
	path: string;
	title: string;
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
	type?: string;
	contentType?: string;
	isMain?: boolean;
	sharedWith?: string[];
	scope?: string;
	identifiers?: string[];
	nodeType?: "note" | "wiki" | "navigation" | "mirror" | "infrastructure" | "memory";
	isInfrastructure?: boolean;
	community?: number;
	x?: number;
	y?: number;
	mirrors?: string[];
	warnings?: string[];
}
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
	health?: {
		isolated: number;
		duplicates: number;
		infrastructure: number;
		missingLinks?: number;
		truncated?: boolean;
		candidateNodes?: number;
		candidateLimit?: number;
	};
	semantic?: KnowledgeGraphSemantic;
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
	health?: {
		isolated: number;
		duplicates: number;
		infrastructure: number;
		missingLinks?: number;
		truncated?: boolean;
		candidateNodes?: number;
		candidateLimit?: number;
	};
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

export * from "./knowledge-contracts.js";
