import { createHash } from "node:crypto";
import { autoTopicCandidate, type TopicCandidateResult, topicRunHash } from "@drone/knowledge";

export const RESEARCH_SUMMARY_VERSION = 1;
export const RESEARCH_SUMMARY_LIMITS = Object.freeze({
	findings: 24,
	citationsPerFinding: 12,
	sources: 24,
	summaryChars: 12_000,
	findingChars: 1_600,
	queryChars: 1_000,
	readReceipts: 64,
});

export interface ResearchCitationInput {
	path?: unknown;
	sourcePath?: unknown;
	hash?: unknown;
	sourceHash?: unknown;
	receiptRef?: unknown;
	locator?: unknown;
	label?: unknown;
}

export interface ResearchCitation {
	path: string;
	hash: string;
	receiptRef: string;
	locator?: string;
	label?: string;
}

export interface ResearchFindingInput {
	text?: unknown;
	claim?: unknown;
	citations?: readonly ResearchCitationInput[];
}

export interface ResearchFinding {
	text: string;
	citations: ResearchCitation[];
}

export interface ResearchReadReceipt {
	path?: unknown;
	hash?: unknown;
	receiptRef?: unknown;
	startLine?: unknown;
	endLine?: unknown;
}

export interface ResearchEvidenceGate {
	stage?: unknown;
	status?: unknown;
	answerable?: unknown;
	claimRefs?: readonly unknown[];
}

export interface ResearchRunSummaryInput {
	project: unknown;
	resultSlug: unknown;
	query: unknown;
	runId: unknown;
	topicId?: unknown;
	summary: unknown;
	findings: readonly ResearchFindingInput[];
	readReceipts: readonly ResearchReadReceipt[];
	evidenceGate: ResearchEvidenceGate;
	proposalId?: unknown;
	artifactPaths?: readonly unknown[];
}

export interface ResearchRunSummary {
	version: 1;
	project: string;
	resultSlug: string;
	query: string;
	runId: string;
	topicId: string;
	summary: string;
	findings: ResearchFinding[];
	sources: ResearchCitation[];
	readReceiptRefs: string[];
	claimRefs: string[];
	artifactPaths: string[];
	proposalId: string | null;
	runHash: string;
	answerable: true;
	navigationOnly: true;
}

export interface ResearchKnowledgeDeposit {
	summary: ResearchRunSummary;
	topic: {
		topicId: string;
		title: string;
		summary: string;
		sources: Array<{ path: string; hash: string }>;
		keyFindings: string[];
		proposalIds: string[];
		artifacts: string[];
		runHash: string;
	};
	wikiCandidate: TopicCandidateResult;
}

/** Minimal host port for depositing an evidence-gated run into topic memory. */
export interface ResearchTopicMemoryPort {
	record(
		input: {
			topicId: string;
			title: string;
			summary: string;
			sources: Array<{ path: string; hash: string }>;
			keyFindings: string[];
			proposalIds: string[];
			artifacts: string[];
			runHash: string;
		},
		expectedRevision?: number,
	): Promise<unknown>;
}

const clean = (value: unknown, limit: number): string =>
	String(value ?? "")
		.normalize("NFKC")
		.replace(/\p{Cc}/gu, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, limit);

function slug(value: unknown, label: string): string {
	const output = clean(value, 120);
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(output)) throw new Error(`${label} must be lowercase kebab-case`);
	return output;
}

function sourcePath(value: unknown): string {
	const path = clean(value, 480).replaceAll("\\", "/");
	if (
		!path ||
		path.startsWith("/") ||
		path.split("/").some((part) => !part || part === "." || part === ".." || part.startsWith(".")) ||
		!path.endsWith(".md") ||
		/(?:^|\/)Runs\//i.test(path)
	)
		throw new Error("Citation path must be a Vault-relative Markdown source note");
	return path;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function normalizeCitation(
	input: ResearchCitationInput,
	receipts: Map<string, ResearchReadReceipt>,
): ResearchCitation {
	const path = sourcePath(input.path ?? input.sourcePath);
	const hash = clean(input.hash ?? input.sourceHash, 64).toLowerCase();
	if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`Citation ${path} must include a SHA-256 source hash`);
	const receipt = receipts.get(path);
	if (!receipt || clean(receipt.hash, 64).toLowerCase() !== hash)
		throw new Error(`Citation ${path} is missing a matching current-turn read receipt`);
	const receiptRef = clean(input.receiptRef ?? receipt.receiptRef, 180);
	if (!receiptRef) throw new Error(`Citation ${path} must include a read receipt reference`);
	const locator = clean(input.locator, 160);
	const label = clean(input.label, 180);
	return {
		path,
		hash,
		receiptRef,
		...(locator ? { locator } : {}),
		...(label ? { label } : {}),
	};
}

function canonical(value: unknown): string {
	return JSON.stringify(value, (_key, item) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) return item;
		return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
	});
}

function formatFinding(finding: ResearchFinding): string {
	const refs = finding.citations.map((citation) => `[[${citation.path}]]`).join(" ");
	return `${finding.text}${refs ? ` ${refs}` : ""}`.trim();
}

export function normalizeResearchRunSummary(input: ResearchRunSummaryInput): ResearchRunSummary {
	const project = slug(input.project, "project");
	const resultSlug = slug(input.resultSlug, "resultSlug");
	const runId = clean(input.runId, 180);
	if (!/^run-[A-Za-z0-9][A-Za-z0-9_-]{1,180}$/.test(runId)) throw new Error("Invalid research run id");
	const query = clean(input.query, RESEARCH_SUMMARY_LIMITS.queryChars);
	const summary = clean(input.summary, RESEARCH_SUMMARY_LIMITS.summaryChars);
	if (!query || !summary) throw new Error("Research summary requires a query and non-empty summary");
	if (
		!Array.isArray(input.findings) ||
		input.findings.length < 1 ||
		input.findings.length > RESEARCH_SUMMARY_LIMITS.findings
	)
		throw new Error("Research summary requires 1–24 findings");
	const gate = input.evidenceGate;
	if (gate?.status === "failed" || gate?.answerable !== true || gate?.stage !== "answerable")
		throw new Error("Only an answerable, evidence-gated research run can produce a proposal summary");
	const receipts = new Map<string, ResearchReadReceipt>();
	if (!Array.isArray(input.readReceipts) || input.readReceipts.length > RESEARCH_SUMMARY_LIMITS.readReceipts)
		throw new Error("Current-turn read receipts are required");
	for (const item of input.readReceipts) {
		const path = sourcePath(item.path);
		const hash = clean(item.hash, 64).toLowerCase();
		const receiptRef = clean(item.receiptRef, 180);
		if (!/^[a-f0-9]{64}$/.test(hash) || !receiptRef) throw new Error(`Invalid read receipt for ${path}`);
		if (receipts.has(path) && receipts.get(path)?.hash !== hash)
			throw new Error(`Conflicting read receipts for ${path}`);
		receipts.set(path, { ...item, path, hash, receiptRef });
	}
	const findings = input.findings.map((item, index) => {
		const text = clean(item.text ?? item.claim, RESEARCH_SUMMARY_LIMITS.findingChars);
		if (!text) throw new Error(`Finding ${index + 1} is empty`);
		if (
			!Array.isArray(item.citations) ||
			item.citations.length < 1 ||
			item.citations.length > RESEARCH_SUMMARY_LIMITS.citationsPerFinding
		)
			throw new Error(`Finding ${index + 1} must carry at least one citation`);
		return {
			text,
			citations: item.citations.map((citation: ResearchCitationInput) =>
				normalizeCitation(citation, receipts),
			),
		};
	});
	const sources: ResearchCitation[] = [
		...new Map(
			findings.flatMap((item) => item.citations).map((item: ResearchCitation) => [item.path, item] as const),
		).values(),
	];
	if (sources.length > RESEARCH_SUMMARY_LIMITS.sources)
		throw new Error("Research summary has too many source notes");
	const claimRefs = (Array.isArray(gate.claimRefs) ? gate.claimRefs : [])
		.map((ref) => clean(ref, 240))
		.filter(Boolean)
		.slice(0, 64);
	const artifactPaths = (Array.isArray(input.artifactPaths) ? input.artifactPaths : [])
		.map((path) => clean(path, 480).replaceAll("\\", "/"))
		.filter((path) => path && !path.startsWith("/") && !path.split("/").includes(".."))
		.slice(0, 12);
	const topicId = clean(input.topicId, 120) || resultSlug.replace(/-20\d{6,14}$/, "") || resultSlug;
	if (!/^[a-z0-9][a-z0-9_-]{0,95}$/i.test(topicId)) throw new Error("Invalid topic id");
	const proposalId = clean(input.proposalId, 120) || null;
	const base: Omit<ResearchRunSummary, "runHash"> = {
		version: 1,
		project,
		resultSlug,
		query,
		runId,
		topicId,
		summary,
		findings,
		sources,
		readReceiptRefs: [...new Set(sources.map((item) => item.receiptRef))],
		claimRefs,
		artifactPaths,
		proposalId,
		answerable: true as const,
		navigationOnly: true as const,
	};
	return { ...base, runHash: sha256(canonical(base)) };
}

export const createResearchRunSummary = normalizeResearchRunSummary;
export const researchRunSummary = normalizeResearchRunSummary;

export function buildKnowledgeDeposit(summary: ResearchRunSummary): ResearchKnowledgeDeposit {
	const keyFindings = summary.findings.map(formatFinding);
	const topicSummary = [summary.summary, ...keyFindings].join("\n\n").slice(0, 12_000);
	const topic = {
		topicId: summary.topicId,
		title: summary.query.slice(0, 180),
		summary: topicSummary,
		sources: summary.sources.map(({ path, hash }) => ({ path, hash })),
		keyFindings,
		proposalIds: summary.proposalId ? [summary.proposalId] : [],
		artifacts: summary.artifactPaths,
		runHash: topicRunHash(topicSummary, summary.sources.map(({ path, hash }) => ({ path, hash })) as any),
	};
	const wikiSummary = `# ${summary.query.slice(0, 180)}\n\n${topicSummary}`;
	const wikiCandidate = autoTopicCandidate({
		summary: wikiSummary,
		query: summary.query,
		resultSlug: summary.resultSlug,
		sourcePaths: summary.sources.map((item) => item.path),
	});
	return { summary, topic, wikiCandidate };
}

export const researchKnowledgeDeposit = buildKnowledgeDeposit;

/**
 * Persist only the bounded navigation projection of a completed research run.
 * The host owns CAS, filesystem and Wiki-review policy; this adapter never
 * promotes the summary to evidence or an instruction.
 */
export async function depositResearchKnowledge(
	port: ResearchTopicMemoryPort,
	summary: ResearchRunSummary,
	expectedRevision?: number,
): Promise<unknown> {
	const deposit = buildKnowledgeDeposit(summary);
	return port.record(deposit.topic, expectedRevision);
}
