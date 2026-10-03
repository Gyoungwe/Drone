import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { knowledgeDirectory } from "./config";
import { runRuntimeExclusive } from "./runtime-host";

/** Durable format for terminal-job experience. It is intentionally separate from evidence and instructions. */
export const EXPERIENCE_VERSION = 1;
export const EXPERIENCE_LIMITS = Object.freeze({
	maxRecords: 128,
	maxFileBytes: 512 * 1024,
	maxSummaryChars: 1200,
	maxReasonChars: 600,
	maxTags: 16,
	maxArtifacts: 16,
	maxSources: 16,
	maxObservationIds: 8,
	maxJobIds: 8,
	maxWorkflowSpecDiffs: 16,
	maxQcMetrics: 24,
	maxQcValues: 128,
	maxModelSummaryChars: 500,
	maxSearchResults: 24,
	maxHostIdChars: 64,
	maxProjectChars: 96,
	maxWorkflowChars: 180,
	maxSchedulerChars: 32,
	maxRevisionChars: 180,
	maxSchedulerJobIdChars: 180,
	maxQueryChars: 200,
});

export type ExperienceStatus = "observed" | "verified";
export type ExperienceOutcome = "success" | "failure" | "blocked" | "unknown";

export interface ExperienceBinding {
	vaultId: string;
}

export interface ExperienceArtifact {
	path?: string;
	sha256: string;
	bytes?: number;
}

/** Host-observed execution facts copied from a terminal compute completion. */
export interface ExperienceExecutionFacts {
	contractHash?: string | null;
	workflow?: string | null;
	workflowRevision?: string | null;
	scheduler?: string | null;
	schedulerJobId?: string | null;
	artifactRefs?: readonly ExperienceArtifact[] | null;
}

export interface ExperienceRepair {
	succeeded: boolean;
	summary?: string | null;
	observationId?: string | null;
}

export type WorkflowSpecDiffValue = string | number | boolean | null;

export interface WorkflowSpecDiff {
	path: string;
	before?: WorkflowSpecDiffValue;
	after?: WorkflowSpecDiffValue;
}

export interface ExperienceResourceUse {
	[key: string]: number;
}

export interface ExperienceQcDistribution {
	[key: string]: number | undefined;
	min?: number;
	max?: number;
	mean?: number;
	median?: number;
	p95?: number;
	count?: number;
}

export interface ExperienceQcMetric {
	name: string;
	unit?: string | null;
	value?: number | null;
	count?: number | null;
	distribution?: ExperienceQcDistribution;
	values?: number[];
}

export interface ExperienceProvenance {
	runId?: string | null;
	observationId?: string | null;
	receiptId?: string | null;
	manifestSha256?: string | null;
	artifactHashes?: readonly ExperienceArtifact[];
}

export interface ExperienceObservation {
	id: string;
	outcome: ExperienceOutcome;
	observedAt?: string;
	exitCode?: number | null;
	featureKey?: string;
	repairSucceeded?: boolean;
	failureSignature?: string | null;
	failedStep?: string | null;
	step?: string | null;
	repair?: ExperienceRepair | null;
	workflowSpecDiff?: readonly WorkflowSpecDiff[] | null;
	resourceUse?: ExperienceResourceUse | null;
	qcMetrics?: readonly ExperienceQcMetric[] | null;
	qc?: readonly ExperienceQcMetric[] | null;
	modelSummary?: string | null;
	contractHash?: string | null;
	workflow?: string | null;
	workflowRevision?: string | null;
	scheduler?: string | null;
	schedulerJobId?: string | null;
	artifactRefs?: readonly ExperienceArtifact[] | null;
	provenance?: ExperienceProvenance;
}

export interface TerminalJobExperienceInput {
	jobId: string;
	featureKey?: string;
	summary: string;
	outcome: ExperienceOutcome;
	exitCode?: number | null;
	step?: string | null;
	failureSignature?: string | null;
	repairSucceeded?: boolean;
	failedStep?: string | null;
	repair?: ExperienceRepair | null;
	workflowSpecDiff?: readonly WorkflowSpecDiff[] | null;
	resourceUse?: ExperienceResourceUse | null;
	qcMetrics?: readonly ExperienceQcMetric[] | null;
	qc?: readonly ExperienceQcMetric[] | null;
	modelSummary?: string | null;
	/** Immutable task/compute contract and exact workflow facts observed by the host. */
	contractHash?: string | null;
	workflow?: string | null;
	workflowRevision?: string | null;
	scheduler?: string | null;
	schedulerJobId?: string | null;
	artifactRefs?: readonly ExperienceArtifact[] | null;
	observationId: string;
	observedAt?: string;
	topicId?: string | null;
	provenance: ExperienceProvenance;
	tags?: readonly string[];
	sourceRefs?: readonly string[];
}

export interface ExperienceStorePort {
	record(input: ExperienceInput, expectedRevision?: number): Promise<{ classification: string; record: ExperienceRecord; revision: number }>;
}

export interface ExperienceInput {
	/** Stable job identifier from the terminal runner. */
	jobId?: string;
	/** A stable semantic pattern key. Different observations of this key can verify an experience. */
	featureKey?: string;
	summary: string;
	observation?: ExperienceObservation;
	hostObservation?: ExperienceObservation;
	provenance?: ExperienceProvenance;
	topicId?: string | null;
	reason?: string | null;
	tags?: readonly string[];
	sourceRefs?: readonly string[];
	exitCode?: number | null;
	failureSignature?: string | null;
	failedStep?: string | null;
	repairSucceeded?: boolean;
	step?: string | null;
	repair?: ExperienceRepair | null;
	workflowSpecDiff?: readonly WorkflowSpecDiff[] | null;
	resourceUse?: ExperienceResourceUse | null;
	qcMetrics?: readonly ExperienceQcMetric[] | null;
	qc?: readonly ExperienceQcMetric[] | null;
	/** Compatibility alias for qcMetrics at the adapter boundary. */
	modelSummary?: string | null;
	contractHash?: string | null;
	workflow?: string | null;
	workflowRevision?: string | null;
	scheduler?: string | null;
	schedulerJobId?: string | null;
	artifactRefs?: readonly ExperienceArtifact[] | null;
	/** Accepted for compatibility at the adapter boundary but intentionally never persisted. */
	command?: unknown;
	output?: unknown;
	credentials?: unknown;
}

export interface ExperienceRecord {
	id: string;
	version: 1;
	vaultId: string;
	project: string;
	hostId: string;
	jobId: string;
	featureKey: string;
	topicId: string | null;
	summary: string;
	reason: string | null;
	outcome: ExperienceOutcome;
	status: ExperienceStatus;
	observedAt: string;
	observationIds: string[];
	observationCount: number;
	jobIds: string[];
	jobCount: number;
	failureSignature: string | null;
	exitCode: number | null;
	failedStep: string | null;
	repair: ExperienceRepair | null;
	workflowSpecDiff: WorkflowSpecDiff[];
	resourceUse: ExperienceResourceUse;
	qcMetrics: ExperienceQcMetric[];
	modelSummary: string | null;
	modelGenerated: boolean;
	contractHash: string | null;
	workflow: string | null;
	workflowRevision: string | null;
	scheduler: string | null;
	schedulerJobId: string | null;
	artifactRefs: ExperienceArtifact[];
	provenance: ExperienceProvenance;
	tags: string[];
	sourceRefs: string[];
	navigationOnly: true;
	evidenceEligible: false;
	instructionEligible: false;
	createdAt: string;
	updatedAt: string;
}

export interface ExperienceDocument {
	version: 1;
	vaultId: string;
	project: string;
	hostId: string;
	revision: number;
	updatedAt: string;
	records: ExperienceRecord[];
}

export interface ExperienceSearchHit {
	score: number;
	record: ExperienceRecord;
}

export interface ExperienceSearchResult {
	revision: number;
	query: string;
	records: ExperienceSearchHit[];
	navigationOnly: true;
	evidenceEligible: false;
	instructionEligible: false;
}

export interface ExperienceStoreOptions {
	binding: ExperienceBinding;
	project: string;
	hostId: string;
	directory?: string | null;
}

type ExperienceMutationResult = {
	classification: "new" | "updated" | "duplicate";
	record: ExperienceRecord;
};

export interface ExperienceStore {
	path: string;
	scope: { vaultId: string; project: string; hostId: string };
	read: () => Promise<ExperienceDocument>;
	record: (input: ExperienceInput, expectedRevision?: number) => Promise<{
		classification: "new" | "updated" | "duplicate";
		revision: number;
		record: ExperienceRecord;
	}>;
	search: (
		query?: string,
		options?: { limit?: number; includeObserved?: boolean; workflow?: string; hostId?: string; failureSignature?: string },
	) => Promise<ExperienceSearchResult>;
}

const HASH = (value: string) => createHash("sha256").update(value).digest("hex");
const now = () => new Date().toISOString();

function text(value: unknown, limit: number): string {
	if (typeof value !== "string" && typeof value !== "number") return "";
	return String(value)
		.normalize("NFKC")
		.replace(/[\u0000-\u001f\u007f<>]/g, " ")
		.replace(/(?:bearer\s+)[^\s,;"']+/gi, "Bearer [redacted]")
		.replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|authorization|cookie)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1[redacted]")
		.replace(/https?:\/\/[^\s<>"]+/gi, (raw) => {
			try {
				const url = new URL(raw);
				url.username = "";
				url.password = "";
				url.search = "";
				url.hash = "";
				return url.toString();
			} catch {
				return "[URL omitted]";
			}
		})
		.trim()
		.slice(0, limit);
}

function id(value: unknown, label: string, limit = 180): string {
	const result = text(value, limit);
	if (!result) throw new Error(`${label} is required`);
	if (/[\\/]/.test(result) || result === "." || result === "..") throw new Error(`Invalid ${label}`);
	return result;
}

function projectKey(value: unknown): string {
	const project = text(value, EXPERIENCE_LIMITS.maxProjectChars).toLowerCase();
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project)) throw new Error("Invalid experience project");
	return project;
}

function hostKey(value: unknown): string {
	const host = text(value, EXPERIENCE_LIMITS.maxHostIdChars).toLowerCase();
	if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(host)) throw new Error("Invalid experience host");
	return host;
}

function vaultKey(value: unknown): string {
	const vault = text(value, 64).toLowerCase();
	if (!/^[a-f0-9]{24}$/.test(vault)) throw new Error("Invalid experience binding");
	return vault;
}

function hash(value: unknown): string | null {
	const result = text(value, 128).toLowerCase();
	return /^[a-f0-9]{64}$/.test(result) ? result : null;
}

function opaqueRef(value: unknown, limit = 180): string {
	const result = text(value, limit);
	if (!result || /[\\/]/.test(result)) return "";
	return result;
}

function boundedStringList(value: unknown, limit: number): string[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.map((item) => text(item, 240)).filter(Boolean))].slice(0, limit);
}

function finiteNonNegative(value: unknown, maximum = 1e12): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) return null;
	return value;
}

function finiteNumber(value: unknown, maximum = 1e12): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > maximum) return null;
	return value;
}

function normalizeExitCode(value: unknown): number | null {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= -1 && value <= 255 ? value : null;
}

function normalizeRepair(value: unknown): ExperienceRepair | null {
	if (typeof value === "boolean") return { succeeded: value };
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const item = value as Record<string, unknown>;
	const succeeded = item.succeeded === true || item.success === true;
	const summary = text(item.summary, 400) || null;
	const observationId = opaqueRef(item.observationId, 180) || null;
	if (
		(item.succeeded !== undefined && typeof item.succeeded !== "boolean") ||
		(item.success !== undefined && typeof item.success !== "boolean")
	)
		return null;
	return {
		succeeded,
		...(summary ? { summary } : {}),
		...(observationId ? { observationId } : {}),
	};
}

function normalizeDiffValue(value: unknown): WorkflowSpecDiffValue | undefined {
	if (value === null || typeof value === "boolean") return value;
	if (typeof value === "number") return Number.isFinite(value) && Math.abs(value) <= 1e12 ? value : undefined;
	if (typeof value === "string") return text(value, 240) || null;
	return undefined;
}

function normalizeWorkflowSpecDiff(value: unknown): WorkflowSpecDiff[] {
	let entries: unknown[] = [];
	if (Array.isArray(value)) entries = value;
	else if (value && typeof value === "object") {
		entries = Object.entries(value as Record<string, unknown>).map(([path, after]) => ({ path, after }));
	}
	const result: WorkflowSpecDiff[] = [];
	for (const entry of entries.slice(0, EXPERIENCE_LIMITS.maxWorkflowSpecDiffs)) {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
		const item = entry as Record<string, unknown>;
		const path = text(item.path ?? item.field ?? item.key, 180);
		if (!path || /[\\]/.test(path)) continue;
		const before = normalizeDiffValue(item.before);
		const after = normalizeDiffValue(item.after ?? item.value);
		if (before === undefined && after === undefined) continue;
		result.push({ path, ...(before === undefined ? {} : { before }), ...(after === undefined ? {} : { after }) });
	}
	return result;
}

function normalizeResourceUse(value: unknown): ExperienceResourceUse {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const result: ExperienceResourceUse = {};
	for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 32)) {
		const name = text(key, 64);
		if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name) || /(token|secret|password|credential|command|output|path|url)/i.test(name)) continue;
		const number = finiteNonNegative(raw);
		if (number !== null) result[name] = number;
		if (Object.keys(result).length >= 16) break;
	}
	return result;
}

function normalizeQcMetrics(value: unknown): ExperienceQcMetric[] {
	let entries: Array<[string, unknown]> = [];
	if (Array.isArray(value)) {
		entries = value.map((entry) => ["", entry]);
	} else if (value && typeof value === "object") {
		entries = Object.entries(value as Record<string, unknown>);
	}
	const result: ExperienceQcMetric[] = [];
	for (const [mapName, raw] of entries.slice(0, EXPERIENCE_LIMITS.maxQcMetrics)) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
		const item = raw as Record<string, unknown>;
		const name = text(item.name ?? mapName, 120);
		if (!name) continue;
		const unit = text(item.unit, 32) || null;
		const valueNumber = finiteNonNegative(item.value, 1e12);
		const count = finiteNonNegative(item.count, 1e9);
		const distributionInput = item.distribution && typeof item.distribution === "object" ? (item.distribution as Record<string, unknown>) : item;
		const distribution: ExperienceQcDistribution = {};
		for (const [rawKey, rawValue] of Object.entries(distributionInput).slice(0, 16)) {
			const key = text(rawKey, 32);
			if (!/^[A-Za-z][A-Za-z0-9_.-]{0,31}$/.test(key) || ["count", "name", "unit", "value", "values"].includes(key)) continue;
			const number = finiteNumber(rawValue, 1e12);
			if (number !== null) distribution[key] = number;
		}
		const distributionCount = finiteNonNegative(distributionInput.count, 1e9);
		if (distributionCount !== null) distribution.count = distributionCount;
		const values = Array.isArray(item.values)
			? item.values.map((entry) => finiteNumber(entry, 1e12)).filter((entry): entry is number => entry !== null).slice(0, EXPERIENCE_LIMITS.maxQcValues)
			: [];
		if (valueNumber === null && count === null && Object.keys(distribution).length === 0 && values.length === 0) continue;
		result.push({
			name,
			...(unit ? { unit } : {}),
			...(valueNumber === null ? {} : { value: valueNumber }),
			...(count === null ? {} : { count }),
			...(Object.keys(distribution).length ? { distribution } : {}),
			...(values.length ? { values } : {}),
		});
	}
	return result;
}

function normalizeArtifact(value: unknown): ExperienceArtifact | null {
	if (!value || typeof value !== "object") return null;
	const item = value as Record<string, unknown>;
	const sha256 = hash(item.sha256);
	if (!sha256) return null;
	const bytes = typeof item.bytes === "number" && Number.isSafeInteger(item.bytes) && item.bytes >= 0 ? item.bytes : undefined;
	const pathValue = text(item.path, 240).replaceAll("\\", "/");
	const safePath = pathValue && !isAbsolute(pathValue) && !pathValue.split("/").includes("..") && !/(?:^|\/)(?:\.env(?:\.[^/]*)?|auth\.json|credentials(?:\.json)?|\.ssh|\.git)(?:\/|$)/i.test(pathValue) ? pathValue : "";
	return {
		...(safePath ? { path: safePath } : {}),
		sha256,
		...(bytes === undefined ? {} : { bytes }),
	};
}

function normalizeArtifactRefs(value: unknown): ExperienceArtifact[] {
	if (!Array.isArray(value)) return [];
	return value
		.map(normalizeArtifact)
		.filter((item): item is ExperienceArtifact => Boolean(item))
		.slice(0, EXPERIENCE_LIMITS.maxArtifacts);
}

function normalizeWorkflow(value: unknown): string | null {
	const result = text(value, EXPERIENCE_LIMITS.maxWorkflowChars);
	return result || null;
}

function normalizeWorkflowRevision(value: unknown): string | null {
	const result = text(value, EXPERIENCE_LIMITS.maxRevisionChars);
	return result || null;
}

function normalizeScheduler(value: unknown): string | null {
	const result = text(value, EXPERIENCE_LIMITS.maxSchedulerChars).toLowerCase();
	return result && /^[a-z][a-z0-9._-]{0,31}$/.test(result) ? result : null;
}

function normalizeSchedulerJobId(value: unknown): string | null {
	return opaqueRef(value, EXPERIENCE_LIMITS.maxSchedulerJobIdChars) || null;
}

function normalizeProvenance(input: ExperienceProvenance): ExperienceProvenance {
	if (!input || typeof input !== "object") throw new Error("Experience provenance is required");
	const item = input as Record<string, unknown>;
	const manifestSha256 = hash(item.manifestSha256 ?? item.manifestHash);
	const artifactHashes = Array.isArray(item.artifactHashes)
		? item.artifactHashes.map(normalizeArtifact).filter((value): value is ExperienceArtifact => Boolean(value)).slice(0, EXPERIENCE_LIMITS.maxArtifacts)
		: [];
	const runId = opaqueRef(item.runId);
	const observationId = opaqueRef(item.observationId);
	const receiptId = opaqueRef(item.receiptId);
	const result: ExperienceProvenance = {
		...(runId ? { runId } : {}),
		...(observationId ? { observationId } : {}),
		...(receiptId ? { receiptId } : {}),
		...(manifestSha256 ? { manifestSha256 } : {}),
		...(artifactHashes.length ? { artifactHashes } : {}),
	};
	if (!result.runId && !result.receiptId && !result.manifestSha256 && !result.artifactHashes?.length)
		throw new Error("Experience provenance must reference a host receipt or manifest");
	return result;
}

function blank(vaultId: string, project: string, hostId: string): ExperienceDocument {
	return { version: EXPERIENCE_VERSION, vaultId, project, hostId, revision: 0, updatedAt: now(), records: [] };
}

function validateDocument(value: unknown, vaultId: string, project: string, hostId: string): ExperienceDocument {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Corrupt experience document");
	const item = value as Record<string, unknown>;
	if (item.version !== EXPERIENCE_VERSION || item.vaultId !== vaultId || item.project !== project || item.hostId !== hostId)
		throw new Error("Experience binding mismatch");
	if (!Number.isSafeInteger(item.revision) || Number(item.revision) < 0 || !Array.isArray(item.records))
		throw new Error("Corrupt experience document");
	if (item.records.length > EXPERIENCE_LIMITS.maxRecords) throw new Error("Experience record limit exceeded");
	return {
		version: EXPERIENCE_VERSION,
		vaultId,
		project,
		hostId,
		revision: Number(item.revision),
		updatedAt: text(item.updatedAt, 40) || now(),
		records: item.records.map((record) => normalizeRecord(record, vaultId, project, hostId)),
	};
}

function normalizeRecord(value: unknown, vaultId: string, project: string, hostId: string): ExperienceRecord {
	if (!value || typeof value !== "object") throw new Error("Invalid experience record");
	const item = value as Record<string, unknown>;
	const status = item.status === "verified" ? "verified" : item.status === "observed" ? "observed" : null;
	const outcome = ["success", "failure", "blocked", "unknown"].includes(String(item.outcome)) ? (item.outcome as ExperienceOutcome) : null;
	if (!status || !outcome || item.navigationOnly !== true || item.evidenceEligible !== false || item.instructionEligible !== false)
		throw new Error("Invalid experience record safety flags");
	const result: ExperienceRecord = {
		id: id(item.id, "experience id"),
		version: EXPERIENCE_VERSION,
		vaultId,
		project,
		hostId,
		jobId: id(item.jobId, "jobId"),
		featureKey: id(item.featureKey, "featureKey", 240),
		topicId: text(item.topicId, 180) || null,
		summary: text(item.summary, EXPERIENCE_LIMITS.maxSummaryChars),
		reason: text(item.reason, EXPERIENCE_LIMITS.maxReasonChars) || null,
		outcome,
		status,
		observedAt: text(item.observedAt, 40) || now(),
		observationIds: boundedStringList(item.observationIds, EXPERIENCE_LIMITS.maxObservationIds),
		observationCount: Number.isSafeInteger(item.observationCount) && Number(item.observationCount) > 0 ? Number(item.observationCount) : 1,
		jobIds: (() => {
			const values = boundedStringList(item.jobIds, EXPERIENCE_LIMITS.maxJobIds);
			return values.length ? values : [id(item.jobId, "jobId")];
		})(),
		jobCount: Number.isSafeInteger(item.jobCount) && Number(item.jobCount) > 0 ? Math.min(Number(item.jobCount), EXPERIENCE_LIMITS.maxJobIds) : 1,
		failureSignature: text(item.failureSignature, 240) || null,
		exitCode: normalizeExitCode(item.exitCode),
		failedStep: text(item.failedStep, 240) || null,
		repair: normalizeRepair(item.repair),
		workflowSpecDiff: normalizeWorkflowSpecDiff(item.workflowSpecDiff ?? item.workflowSpecDiffs),
		resourceUse: normalizeResourceUse(item.resourceUse),
		qcMetrics: normalizeQcMetrics(item.qcMetrics ?? item.qc ?? item.qcMetricDistribution),
		modelSummary: text(item.modelSummary, EXPERIENCE_LIMITS.maxModelSummaryChars) || null,
		modelGenerated: item.modelGenerated === true && Boolean(text(item.modelSummary, EXPERIENCE_LIMITS.maxModelSummaryChars)),
		contractHash: hash(item.contractHash),
		workflow: normalizeWorkflow(item.workflow),
		workflowRevision: normalizeWorkflowRevision(item.workflowRevision ?? item.workflowRevisionId),
		scheduler: normalizeScheduler(item.scheduler),
		schedulerJobId: normalizeSchedulerJobId(item.schedulerJobId),
		artifactRefs: normalizeArtifactRefs(item.artifactRefs ?? item.artifacts),
		provenance: normalizeProvenance((item.provenance || {}) as ExperienceProvenance),
		tags: boundedStringList(item.tags, EXPERIENCE_LIMITS.maxTags),
		sourceRefs: boundedStringList(item.sourceRefs, EXPERIENCE_LIMITS.maxSources),
		navigationOnly: true,
		evidenceEligible: false,
		instructionEligible: false,
		createdAt: text(item.createdAt, 40) || now(),
		updatedAt: text(item.updatedAt, 40) || now(),
	};
	if (!result.summary) throw new Error("Experience summary is required");
	return result;
}

function pathFor(directory: string, vaultId: string, project: string, hostId: string): string {
	if (!isAbsolute(directory)) throw new Error("Experience directory must be absolute");
	return join(resolve(directory), vaultId, "experience", project, `${hostId}.json`);
}

async function ensureSafePath(directory: string, path: string): Promise<void> {
	const root = resolve(directory);
	const relativePath = relative(root, resolve(path));
	if (isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${sep}`)) throw new Error("Experience path escapes knowledge directory");
	let current = root;
	for (const segment of relativePath.split(sep).slice(0, -1)) {
		current = join(current, segment);
		try {
			const stat = await lstat(current);
			if (stat.isSymbolicLink()) throw new Error("Experience path cannot traverse symlinks");
			if (!stat.isDirectory()) throw new Error("Experience path parent must be a directory");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			await mkdir(current, { mode: 0o700 });
		}
	}
}

async function readDocument(path: string, vaultId: string, project: string, hostId: string): Promise<ExperienceDocument> {
	try {
		const stat = await lstat(path);
		if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Experience file must be a regular file");
		if (stat.size > EXPERIENCE_LIMITS.maxFileBytes) throw new Error("Experience file exceeds size limit");
		return validateDocument(JSON.parse(await readFile(path, "utf8")), vaultId, project, hostId);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return blank(vaultId, project, hostId);
		if (error instanceof SyntaxError) throw new Error("Corrupt experience document");
		throw error;
	}
}

async function atomicWrite(path: string, value: ExperienceDocument): Promise<void> {
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
		await rename(temporary, path);
	} finally {
		await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
			if (error.code !== "ENOENT") throw error;
		});
	}
}

function tokenSet(value: string): Set<string> {
	return new Set(value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 1));
}

function scoreRecord(record: ExperienceRecord, query: string): number {
	if (!query) return 0;
	const queryTokens = tokenSet(query);
	const fields = [
		record.featureKey,
		record.summary,
		record.reason || "",
		record.failureSignature || "",
		record.failedStep || "",
		record.modelSummary || "",
		record.workflow || "",
		record.workflowRevision || "",
		record.scheduler || "",
		record.schedulerJobId || "",
		record.hostId,
		...record.tags,
		record.topicId || "",
	];
	const recordTokens = tokenSet(fields.join(" "));
	let score = 0;
	for (const token of queryTokens) if (recordTokens.has(token)) score++;
	if (record.featureKey.toLowerCase().includes(query.toLowerCase())) score += 2;
	return score;
}

/** Convert a stable B1/B3 terminal-job observation into the redacted Experience input.
 * The adapter accepts only host-observed fields and provenance pointers; runner output and commands stay out.
 */
export function experienceInputFromTerminalJob(input: TerminalJobExperienceInput): ExperienceInput {
	const featureKey = text(input.featureKey || input.failureSignature || input.step || "terminal-job", 240);
	if (!featureKey) throw new Error("Terminal job experience requires a failure signature or step");
	return {
		jobId: id(input.jobId, "jobId"),
		featureKey,
		summary: text(input.summary, EXPERIENCE_LIMITS.maxSummaryChars),
		observation: {
			id: id(input.observationId, "observation id"),
			outcome: input.outcome,
			exitCode: input.exitCode ?? null,
			featureKey,
			repairSucceeded: input.repairSucceeded === true,
			failureSignature: input.failureSignature,
			failedStep: input.failedStep || input.step,
			repair: input.repair || (input.repairSucceeded === true ? { succeeded: true } : null),
			workflowSpecDiff: input.workflowSpecDiff,
			resourceUse: input.resourceUse,
			qcMetrics: input.qcMetrics ?? input.qc,
			modelSummary: input.modelSummary,
			contractHash: input.contractHash,
			workflow: input.workflow,
			workflowRevision: input.workflowRevision,
			scheduler: input.scheduler,
			schedulerJobId: input.schedulerJobId,
			artifactRefs: input.artifactRefs,
			observedAt: input.observedAt,
			provenance: input.provenance,
		},
		provenance: input.provenance,
		topicId: input.topicId,
		tags: input.tags,
		sourceRefs: input.sourceRefs,
		exitCode: input.exitCode,
		failureSignature: input.failureSignature,
		failedStep: input.failedStep || input.step,
		repair: input.repair,
		workflowSpecDiff: input.workflowSpecDiff,
		resourceUse: input.resourceUse,
		qcMetrics: input.qcMetrics ?? input.qc,
		modelSummary: input.modelSummary,
		contractHash: input.contractHash,
		workflow: input.workflow,
		workflowRevision: input.workflowRevision,
		scheduler: input.scheduler,
		schedulerJobId: input.schedulerJobId,
		artifactRefs: input.artifactRefs,
	};
}

export const terminalJobExperienceInput = experienceInputFromTerminalJob;

export async function recordTerminalJobExperience(
	store: ExperienceStorePort,
	input: TerminalJobExperienceInput,
	expectedRevision?: number,
) {
	return store.record(experienceInputFromTerminalJob(input), expectedRevision);
}

/** Build a bounded, host-isolated experience log backed by atomic JSON and revision CAS. */
export function createExperienceStore(options: ExperienceStoreOptions): ExperienceStore {
	const vaultId = vaultKey(options.binding?.vaultId);
	const project = projectKey(options.project);
	const hostId = hostKey(options.hostId);
	const directory = options.directory === undefined || options.directory === null ? knowledgeDirectory() : options.directory;
	if (!directory) throw new Error("Knowledge directory is not configured");
	const path = pathFor(directory, vaultId, project, hostId);
	const read = async () => {
		await ensureSafePath(directory, path);
		return readDocument(path, vaultId, project, hostId);
	};
	const mutate = async <T>(expectedRevision: number | undefined, updater: (current: ExperienceDocument) => { document: ExperienceDocument; result: T; noop?: boolean }): Promise<{ document: ExperienceDocument; result: T }> =>
		runRuntimeExclusive("experience-store", path, async () => {
			await ensureSafePath(directory, path);
			const current = await readDocument(path, vaultId, project, hostId);
			if (expectedRevision !== undefined && current.revision !== expectedRevision) throw new Error("Experience revision changed");
			const next = updater(structuredClone(current));
			if (next.noop) return { document: current, result: next.result };
			const candidate = { ...next.document, version: EXPERIENCE_VERSION, vaultId, project, hostId, revision: current.revision + 1, updatedAt: now(), records: next.document.records.slice(-EXPERIENCE_LIMITS.maxRecords) };
			const document = validateDocument(candidate, vaultId, project, hostId);
			await atomicWrite(path, document);
			return { document, result: next.result };
		});
	return {
		path,
		scope: { vaultId, project, hostId },
		read,
		record: async (input: ExperienceInput, expectedRevision?: number) => {
			if (!input || typeof input !== "object") throw new Error("Invalid experience input");
				const rawInput = input as ExperienceInput & { job?: { id?: unknown }; terminalJob?: { id?: unknown } };
				const jobId = id(input.jobId || rawInput.job?.id || rawInput.terminalJob?.id, "jobId");
				const observation = input.observation || input.hostObservation;
				const featureKey = id(
					input.featureKey || observation?.featureKey || input.failureSignature || observation?.failureSignature || input.failedStep || input.step,
					"featureKey",
					240,
				);
			if (!observation || typeof observation !== "object") throw new Error("Terminal host observation is required");
			const observationId = id(observation.id, "observation id");
			const outcome = observation.outcome;
			if (!["success", "failure", "blocked", "unknown"].includes(outcome)) throw new Error("Invalid experience outcome");
			const provenance = normalizeProvenance(input.provenance || observation.provenance || {});
			const summary = text(input.summary, EXPERIENCE_LIMITS.maxSummaryChars);
			if (!summary) throw new Error("Experience summary is required");
				const failureSignature = text(input.failureSignature ?? observation.failureSignature, 240) || null;
				const exitCode = normalizeExitCode(input.exitCode ?? observation.exitCode);
				const failedStep = text(input.failedStep ?? input.step ?? observation.failedStep ?? observation.step, 240) || null;
				const repair = normalizeRepair(input.repair ?? observation.repair ?? (input.repairSucceeded === true || observation.repairSucceeded === true ? { succeeded: true } : null));
				const repairSucceeded = input.repairSucceeded === true || observation.repairSucceeded === true || repair?.succeeded === true;
				const workflowSpecDiff = normalizeWorkflowSpecDiff(input.workflowSpecDiff ?? observation.workflowSpecDiff);
				const resourceUse = normalizeResourceUse(input.resourceUse ?? observation.resourceUse);
				const qcMetrics = normalizeQcMetrics(input.qcMetrics ?? input.qc ?? observation.qcMetrics ?? observation.qc);
				const modelSummary = text(input.modelSummary ?? observation.modelSummary, EXPERIENCE_LIMITS.maxModelSummaryChars) || null;
				const contractHash = hash(input.contractHash ?? observation.contractHash);
				const workflow = normalizeWorkflow(input.workflow ?? observation.workflow);
				const workflowRevision = normalizeWorkflowRevision(input.workflowRevision ?? observation.workflowRevision);
				const scheduler = normalizeScheduler(input.scheduler ?? observation.scheduler);
				const schedulerJobId = normalizeSchedulerJobId(input.schedulerJobId ?? observation.schedulerJobId);
				const artifactRefs = normalizeArtifactRefs(input.artifactRefs ?? observation.artifactRefs);
			const observedAt = text(observation.observedAt, 40) || now();
			const sanitizedTags = boundedStringList(input.tags, EXPERIENCE_LIMITS.maxTags);
			const sanitizedSources = boundedStringList(input.sourceRefs, EXPERIENCE_LIMITS.maxSources);
			const key = featureKey;
			const out = await mutate<ExperienceMutationResult>(expectedRevision, (document) => {
				const matching = document.records.filter((record) => record.featureKey === featureKey);
				const existing = document.records.find((record) => record.id === HASH(key).slice(0, 32));
				if (existing?.observationIds.includes(observationId)) return { document, result: { classification: "duplicate" as const, record: existing }, noop: true };
					const observations = new Set(matching.flatMap((record) => record.observationIds));
					observations.add(observationId);
					const jobs = new Set(matching.flatMap((record) => (record.jobIds.length ? record.jobIds : [record.jobId])));
					jobs.add(jobId);
					const status: ExperienceStatus = repairSucceeded || jobs.size >= 2 ? "verified" : "observed";
				const record: ExperienceRecord = existing || {
					id: HASH(key).slice(0, 32),
					version: EXPERIENCE_VERSION,
					vaultId,
					project,
					hostId,
					jobId,
					featureKey,
					topicId: text(input.topicId, 180) || null,
					summary,
					// A failure reason may be supplied as summary context, but raw output is never accepted.
					reason: text(input.reason, EXPERIENCE_LIMITS.maxReasonChars) || null,
					outcome,
					status,
					observedAt,
						observationIds: [],
						observationCount: 0,
						jobIds: [],
						jobCount: 0,
						failureSignature,
						exitCode,
						failedStep,
						repair,
						workflowSpecDiff,
						resourceUse,
							qcMetrics,
							modelSummary,
							modelGenerated: Boolean(modelSummary),
							contractHash,
							workflow,
							workflowRevision,
							scheduler,
							schedulerJobId,
							artifactRefs,
					provenance,
					tags: sanitizedTags,
					sourceRefs: sanitizedSources,
					navigationOnly: true,
					evidenceEligible: false,
					instructionEligible: false,
					createdAt: now(),
					updatedAt: now(),
				};
					record.observationIds = [...observations].slice(-EXPERIENCE_LIMITS.maxObservationIds);
					record.observationCount = Math.min(observations.size, EXPERIENCE_LIMITS.maxObservationIds);
					record.jobIds = [...jobs].slice(-EXPERIENCE_LIMITS.maxJobIds);
					record.jobCount = Math.min(jobs.size, EXPERIENCE_LIMITS.maxJobIds);
				record.status = status;
				record.updatedAt = now();
				record.observedAt = observedAt;
				record.outcome = outcome;
				record.summary = summary;
				record.provenance = provenance;
				record.tags = sanitizedTags;
					record.sourceRefs = sanitizedSources;
					if (failureSignature) record.failureSignature = failureSignature;
					if (input.exitCode !== undefined || observation.exitCode !== undefined) record.exitCode = exitCode;
					if (failedStep) record.failedStep = failedStep;
					if (repair) record.repair = repair;
					if (input.workflowSpecDiff !== undefined || observation.workflowSpecDiff !== undefined) record.workflowSpecDiff = workflowSpecDiff;
					if (input.resourceUse !== undefined || observation.resourceUse !== undefined) record.resourceUse = resourceUse;
					if (input.qcMetrics !== undefined || input.qc !== undefined || observation.qcMetrics !== undefined || observation.qc !== undefined) record.qcMetrics = qcMetrics;
					if (modelSummary) {
						record.modelSummary = modelSummary;
						record.modelGenerated = true;
					}
					if (contractHash) record.contractHash = contractHash;
					if (workflow) record.workflow = workflow;
					if (workflowRevision) record.workflowRevision = workflowRevision;
					if (scheduler) record.scheduler = scheduler;
					if (schedulerJobId) record.schedulerJobId = schedulerJobId;
					if (artifactRefs.length) record.artifactRefs = artifactRefs;
				if (!existing) document.records.unshift(record);
				return { document, result: { classification: existing ? ("updated" as const) : ("new" as const), record } };
			});
			return { ...out.result, revision: out.document.revision, record: out.result.record };
		},
		search: async (
			query = "",
			options: { limit?: number; includeObserved?: boolean; workflow?: string; hostId?: string; failureSignature?: string } = {},
		): Promise<ExperienceSearchResult> => {
			const document = await read();
			const q = text(query, EXPERIENCE_LIMITS.maxQueryChars);
			const limit = Math.min(EXPERIENCE_LIMITS.maxSearchResults, Math.max(1, Math.floor(options.limit || EXPERIENCE_LIMITS.maxSearchResults)));
			const workflowFilter = normalizeWorkflow(options.workflow);
			const hostFilter = options.hostId === undefined ? null : hostKey(options.hostId);
			const failureFilter = text(options.failureSignature, 240).toLowerCase() || null;
			const records = document.records
				.filter((record) => !workflowFilter || record.workflow?.toLowerCase() === workflowFilter.toLowerCase())
				.filter((record) => !hostFilter || record.hostId === hostFilter)
				.filter((record) => !failureFilter || record.failureSignature?.toLowerCase() === failureFilter)
				.filter((record) => options.includeObserved !== false || record.status === "verified")
				.map((record) => ({ record, score: scoreRecord(record, q) }))
				.filter((hit) => !q || hit.score > 0)
				.sort((left, right) => right.score - left.score || right.record.updatedAt.localeCompare(left.record.updatedAt) || left.record.id.localeCompare(right.record.id))
				.slice(0, limit);
			return { revision: document.revision, query: q, records, navigationOnly: true, evidenceEligible: false, instructionEligible: false };
		},
	};
}

export async function searchExperiences(
	options: ExperienceStoreOptions & {
		query?: string;
		limit?: number;
		includeObserved?: boolean;
		workflow?: string;
		failureSignature?: string;
		hostFilter?: string;
	},
): Promise<ExperienceSearchResult> {
	const { query = "", limit, includeObserved, workflow, failureSignature, hostFilter, ...storeOptions } = options;
	const store = createExperienceStore(storeOptions);
	return store.search(query, { limit, includeObserved, workflow, hostId: hostFilter, failureSignature });
}
