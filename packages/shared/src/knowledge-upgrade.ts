export type KnowledgeSemanticProvider = "none" | "ollama" | "openai-compatible";

export interface KnowledgeSemanticSettings {
	version: 1;
	revision: number;
	provider: KnowledgeSemanticProvider;
	enabled: boolean;
	baseUrl: string;
	model: string;
	credentialEnv: string;
	remoteConsent: boolean;
	timeoutMs?: number;
	chunkChars?: number;
	minSimilarity?: number;
	updatedAt: string;
}

export interface KnowledgeSemanticConfig {
	provider: KnowledgeSemanticProvider;
	enabled: boolean;
	baseUrl: string;
	model: string;
	credentialEnv: string;
	remoteConsent: boolean;
	timeoutMs?: number;
	chunkChars?: number;
	minSimilarity?: number;
}

export interface KnowledgeSemanticIndexStatus {
	status?: string;
	coverage?: string;
	revision?: number;
	semantic?: {
		vectors?: number;
		paths?: number;
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

export interface KnowledgeSemanticStatus {
	settings: KnowledgeSemanticSettings;
	index: KnowledgeSemanticIndexStatus;
}

export interface KnowledgeSemanticSettingsRequest {
	cwd?: string | null;
	bindingRevision: number;
	expectedSettingsRevision: number;
	config: KnowledgeSemanticConfig;
}

export interface KnowledgeSemanticProviderRequest {
	cwd?: string | null;
	bindingRevision: number;
	config: KnowledgeSemanticConfig;
}

export interface KnowledgeSemanticProviderResult {
	ok: true;
	provider: KnowledgeSemanticProvider;
	model: string;
	dimension: number;
}

export interface KnowledgeSemanticIndexRequest {
	cwd: string;
	bindingRevision: number;
	requestId: string;
	limit?: number;
}

export interface KnowledgeSemanticIndexResult {
	enabled: boolean;
	processed?: number;
	partial?: boolean;
	dimension?: number;
	status?: KnowledgeSemanticIndexStatus;
	[key: string]: unknown;
}

export interface KnowledgeSemanticIndexCancelRequest {
	cwd: string;
	bindingRevision: number;
	requestId: string;
}

export interface KnowledgeTopicSource {
	path: string;
	hash: string;
}

export type KnowledgeClaimRelation = "observation" | "interpretation" | "hypothesis";

export interface KnowledgeClaim {
	claim: string;
	subject: string;
	predicate: string;
	value?: string;
	organism?: string;
	tissue?: string;
	stage?: string;
	method?: string;
	sourcePath: string;
	sourceHash: string;
	location?: string;
	relation: KnowledgeClaimRelation;
}

export interface KnowledgeConflictRecord {
	relation: "supports" | "refines" | "supersedes" | "contradicts" | "unresolved";
	confidence: "high" | "medium" | "low";
	reason: string;
	previousSourcePath: string;
	incomingSourcePath: string;
	detectedAt: string;
}

export interface KnowledgeTopic {
	id: string;
	title: string;
	aliases: string[];
	summary: string;
	entities: string[];
	unresolvedQuestions: string[];
	sources: KnowledgeTopicSource[];
	artifacts: string[];
	status: "active" | "stale" | "conflict-candidate" | "archived" | (string & {});
	updatedAt: string;
	lastRunId?: string;
	proposalIds?: string[];
	claims?: KnowledgeClaim[];
	conflicts?: KnowledgeConflictRecord[];
}

export interface KnowledgeTopicListResult {
	revision: number;
	topics: KnowledgeTopic[];
}

export interface KnowledgeTopicsRequest {
	cwd: string;
	bindingRevision: number;
	query?: string;
}

export interface KnowledgeTopicArchiveRequest {
	cwd: string;
	bindingRevision: number;
	id: string;
	expectedRevision: number;
}
