import { createHash } from "node:crypto";

export const PLAN_PROPOSAL_VERSION = 1;
export const PLAN_PROPOSAL_LIMITS = Object.freeze({
	findings: 24,
	candidates: 3,
	questions: 16,
	conflicts: 16,
	uncertainties: 16,
	citations: 48,
	textChars: 1_600,
	pathChars: 480,
});

export type ProposalApprovalState = "draft" | "pending" | "approved" | "rejected";

export interface ProposalCitationInput {
	path?: unknown;
	hash?: unknown;
	receiptRef?: unknown;
	locator?: unknown;
	label?: unknown;
}
export interface ProposalCitation {
	path: string;
	hash: string;
	receiptRef: string;
	locator?: string;
	label?: string;
}
export interface ProposalFindingInput {
	text?: unknown;
	citations?: readonly ProposalCitationInput[];
}
export interface ProposalFinding {
	text: string;
	citations: ProposalCitation[];
}
export interface ProposalCandidateInput {
	id?: unknown;
	title?: unknown;
	method?: unknown;
	basis?: readonly ProposalCitationInput[];
	resources?: unknown;
	risks?: readonly unknown[];
}
export interface ProposalCandidate {
	id: string;
	title: string;
	method: string;
	basis: ProposalCitation[];
	resources: string;
	risks: string[];
}
export interface ProposalRecommendationInput {
	candidateId?: unknown;
	reason?: unknown;
	citations?: readonly ProposalCitationInput[];
}
export interface ProposalRecommendation {
	candidateId: string;
	reason: string;
	citations: ProposalCitation[];
}
export interface ProposalQuestionInput {
	id?: unknown;
	question?: unknown;
	defaultValue?: unknown;
	options?: readonly unknown[];
}
export interface ProposalQuestion {
	id: string;
	question: string;
	defaultValue: string;
	options: string[];
}
export interface ProposalConflictInput {
	topic?: unknown;
	description?: unknown;
	citations?: readonly ProposalCitationInput[];
}
export interface ProposalConflict {
	topic: string;
	description: string;
	citations: ProposalCitation[];
}
export interface ProposalUncertaintyInput {
	topic?: unknown;
	description?: unknown;
	impact?: unknown;
}
export interface ProposalUncertainty {
	topic: string;
	description: string;
	impact: string;
}
export interface ProposalComputeBudget {
	maxCoreHours?: number;
	maxWallClockMinutes?: number;
	maxConcurrentJobs?: number;
	maxDiskGb?: number;
}
export interface ProposalComputeScopeInput {
	hosts?: readonly unknown[];
	remoteRead?: readonly unknown[];
	remoteWrite?: readonly unknown[];
	budget?: ProposalComputeBudget;
	workflows?: readonly unknown[];
	agentCode?: unknown;
	autonomy?: unknown;
}
export interface ProposalComputeScope {
	hosts: string[];
	remoteRead: string[];
	remoteWrite: string[];
	budget: ProposalComputeBudget;
	workflows: string[];
	agentCode: boolean;
	autonomy: "L0" | "L1" | "L2" | "L3";
}
export interface PlanProposalInput {
	project?: unknown;
	goal?: unknown;
	query?: unknown;
	summary?: unknown;
	findings?: readonly ProposalFindingInput[];
	candidates?: readonly ProposalCandidateInput[];
	recommendation?: ProposalRecommendationInput;
	questions?: readonly ProposalQuestionInput[];
	conflicts?: readonly ProposalConflictInput[];
	uncertainties?: readonly ProposalUncertaintyInput[];
	compute?: ProposalComputeScopeInput;
	previousContractHash?: unknown;
}
export interface PlanProposal {
	version: 1;
	project: string;
	goal: string;
	query: string;
	summary: string;
	findings: ProposalFinding[];
	candidates: ProposalCandidate[];
	recommendation: ProposalRecommendation;
	questions: ProposalQuestion[];
	conflicts: ProposalConflict[];
	uncertainties: ProposalUncertainty[];
	compute: ProposalComputeScope;
	previousContractHash: string | null;
	contractHash: string;
	approval: ProposalApprovalState;
	approvedContractHash: string | null;
	navigationOnly: true;
}

const clean = (value: unknown, limit: number = PLAN_PROPOSAL_LIMITS.textChars): string =>
	String(value ?? "")
		.normalize("NFKC")
		.replace(/\p{Cc}/gu, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, limit);

function boundedList(value: readonly unknown[] | undefined, limit: number, field: string): string[] {
	if (!Array.isArray(value)) return [];
	if (value.length > limit) throw new Error(`${field} exceeds its bounded limit`);
	return [...new Set(value.map((item) => clean(item, 480)).filter(Boolean))];
}
function safeId(value: unknown, label: string): string {
	const id = clean(value, 96);
	if (!/^[a-z0-9][a-z0-9_-]{0,95}$/i.test(id)) throw new Error(`${label} must be a stable identifier`);
	return id;
}
function sourcePath(value: unknown): string {
	const path = clean(value, PLAN_PROPOSAL_LIMITS.pathChars).replaceAll("\\", "/");
	if (
		!path ||
		path.startsWith("/") ||
		!path.endsWith(".md") ||
		path.split("/").some((part) => !part || part === "." || part === ".." || part.startsWith("."))
	)
		throw new Error("Proposal citations must use Vault-relative Markdown source paths");
	return path;
}
function citation(input: ProposalCitationInput): ProposalCitation {
	const path = sourcePath(input.path);
	const hash = clean(input.hash, 64).toLowerCase();
	const receiptRef = clean(input.receiptRef, 180);
	if (!/^[a-f0-9]{64}$/.test(hash) || !receiptRef)
		throw new Error(`Citation ${path} requires a SHA-256 hash and read receipt reference`);
	const locator = clean(input.locator, 160);
	const label = clean(input.label, 180);
	return { path, hash, receiptRef, ...(locator ? { locator } : {}), ...(label ? { label } : {}) };
}
function citations(
	input: readonly ProposalCitationInput[] | undefined,
	field: string,
	required: boolean,
): ProposalCitation[] {
	if (!Array.isArray(input) || (!input.length && required))
		throw new Error(`${field} requires at least one citation`);
	if ((input?.length ?? 0) > 12) throw new Error(`${field} has too many citations`);
	return (input || []).map(citation);
}
function numberBudget(value: unknown, label: string): number | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1_000_000)
		throw new Error(`${label} must be a bounded positive number`);
	return value;
}
function pathList(value: readonly unknown[] | undefined, field: string): string[] {
	const values = boundedList(value, 16, field);
	if (values.some((item) => /[\r\n<>`$;|&]/.test(item)))
		throw new Error(`${field} contains unsafe path characters`);
	return values;
}
function canonical(value: unknown): string {
	return JSON.stringify(value, (_key, item) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) return item;
		return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
	});
}
function digest(value: unknown): string {
	return createHash("sha256").update(canonical(value)).digest("hex");
}

type ProposalContract = Omit<
	PlanProposal,
	"contractHash" | "approval" | "approvedContractHash" | "navigationOnly"
>;

function proposalContract(proposal: PlanProposal): ProposalContract {
	return {
		version: 1,
		project: proposal.project,
		goal: proposal.goal,
		query: proposal.query,
		summary: proposal.summary,
		findings: proposal.findings,
		candidates: proposal.candidates,
		recommendation: proposal.recommendation,
		questions: proposal.questions,
		conflicts: proposal.conflicts,
		uncertainties: proposal.uncertainties,
		compute: proposal.compute,
		previousContractHash: proposal.previousContractHash,
	};
}

/** Recompute the immutable contract identity from proposal inputs, never from a stored hash. */
export function planProposalContractHash(proposal: PlanProposal): string {
	return digest(proposalContract(proposal));
}

export function normalizePlanProposal(input: PlanProposalInput): PlanProposal {
	const findingsInput = Array.isArray(input.findings) ? input.findings : [];
	if (!findingsInput.length || findingsInput.length > PLAN_PROPOSAL_LIMITS.findings)
		throw new Error("A proposal requires 1–24 cited findings");
	const findings = findingsInput.map((item, index) => {
		const text = clean(item.text);
		if (!text) throw new Error(`Finding ${index + 1} is empty`);
		return { text, citations: citations(item.citations, `finding ${index + 1}`, true) };
	});
	const candidatesInput = Array.isArray(input.candidates) ? input.candidates : [];
	if (candidatesInput.length < 2 || candidatesInput.length > PLAN_PROPOSAL_LIMITS.candidates)
		throw new Error("A proposal requires 2–3 candidate plans");
	const candidates = candidatesInput.map((item, index) => {
		const method = clean(item.method);
		if (!method) throw new Error(`Candidate ${index + 1} requires a method`);
		return {
			id: safeId(item.id, `candidate ${index + 1}`),
			title: clean(item.title, 240) || `Candidate ${index + 1}`,
			method,
			basis: citations(item.basis, `candidate ${index + 1}`, true),
			resources: clean(item.resources, 600) || "未估算",
			risks: boundedList(item.risks, 8, `candidate ${index + 1} risks`),
		};
	});
	if (new Set(candidates.map((item) => item.id)).size !== candidates.length)
		throw new Error("Candidate ids must be unique");
	const recommendationInput = input.recommendation;
	if (!recommendationInput) throw new Error("A proposal requires a recommendation");
	const candidateId = safeId(recommendationInput.candidateId, "recommendation candidate");
	if (!candidates.some((item) => item.id === candidateId))
		throw new Error("Recommendation must name a candidate");
	const recommendation = {
		candidateId,
		reason: clean(recommendationInput.reason, 1_200),
		citations: citations(recommendationInput.citations, "recommendation", true),
	};
	if (!recommendation.reason) throw new Error("Recommendation requires a reason");
	const questionsInput = Array.isArray(input.questions) ? input.questions : [];
	if (questionsInput.length > PLAN_PROPOSAL_LIMITS.questions) throw new Error("Too many pending questions");
	const questions = questionsInput.map((item, index) => {
		const question = clean(item.question, 600);
		const defaultValue = clean(item.defaultValue, 320);
		if (!question || !defaultValue) throw new Error(`Question ${index + 1} requires a default value`);
		return {
			id: safeId(item.id, `question ${index + 1}`),
			question,
			defaultValue,
			options: boundedList(item.options, 8, `question ${index + 1} options`),
		};
	});
	if (new Set(questions.map((item) => item.id)).size !== questions.length)
		throw new Error("Question ids must be unique");
	const conflictsInput = Array.isArray(input.conflicts) ? input.conflicts : [];
	if (conflictsInput.length > PLAN_PROPOSAL_LIMITS.conflicts) throw new Error("Too many conflicts");
	const conflicts = conflictsInput.map((item, index) => {
		const topic = clean(item.topic, 240);
		const description = clean(item.description, 1_200);
		if (!topic || !description) throw new Error(`Conflict ${index + 1} is incomplete`);
		return { topic, description, citations: citations(item.citations, `conflict ${index + 1}`, true) };
	});
	const uncertaintiesInput = Array.isArray(input.uncertainties) ? input.uncertainties : [];
	if (uncertaintiesInput.length > PLAN_PROPOSAL_LIMITS.uncertainties)
		throw new Error("Too many uncertainties");
	const uncertainties = uncertaintiesInput.map((item, index) => {
		const topic = clean(item.topic, 240);
		const description = clean(item.description, 1_200);
		const impact = clean(item.impact, 600);
		if (!topic || !description || !impact) throw new Error(`Uncertainty ${index + 1} is incomplete`);
		return { topic, description, impact };
	});
	const computeInput = input.compute || {};
	const autonomy = clean(computeInput.autonomy, 2) || "L1";
	if (!["L0", "L1", "L2", "L3"].includes(autonomy))
		throw new Error("Compute autonomy must be L0, L1, L2 or L3");
	const compute: ProposalComputeScope = {
		hosts: pathList(computeInput.hosts, "compute hosts"),
		remoteRead: pathList(computeInput.remoteRead, "remoteRead"),
		remoteWrite: pathList(computeInput.remoteWrite, "remoteWrite"),
		budget: {
			...(numberBudget(computeInput.budget?.maxCoreHours, "maxCoreHours") !== undefined
				? { maxCoreHours: numberBudget(computeInput.budget?.maxCoreHours, "maxCoreHours") }
				: {}),
			...(numberBudget(computeInput.budget?.maxWallClockMinutes, "maxWallClockMinutes") !== undefined
				? {
						maxWallClockMinutes: numberBudget(
							computeInput.budget?.maxWallClockMinutes,
							"maxWallClockMinutes",
						),
					}
				: {}),
			...(numberBudget(computeInput.budget?.maxConcurrentJobs, "maxConcurrentJobs") !== undefined
				? { maxConcurrentJobs: numberBudget(computeInput.budget?.maxConcurrentJobs, "maxConcurrentJobs") }
				: {}),
			...(numberBudget(computeInput.budget?.maxDiskGb, "maxDiskGb") !== undefined
				? { maxDiskGb: numberBudget(computeInput.budget?.maxDiskGb, "maxDiskGb") }
				: {}),
		},
		workflows: boundedList(computeInput.workflows, 16, "compute workflows"),
		agentCode: computeInput.agentCode === true,
		autonomy: autonomy as ProposalComputeScope["autonomy"],
	};
	if (computeInput.agentCode === true && autonomy !== "L3") throw new Error("agentCode requires L3 autonomy");
	if (compute.remoteWrite.length && !compute.hosts.length)
		throw new Error("remoteWrite requires an explicit host");
	const project = clean(input.project, 120) || "research-workbench";
	const goal = clean(input.goal, 240);
	const query = clean(input.query, 1_000);
	const summary = clean(input.summary, 4_000);
	if (!goal || !query || !summary) throw new Error("Proposal requires goal, query and summary");
	const previousContractHash = clean(input.previousContractHash, 64).toLowerCase();
	if (previousContractHash && !/^[a-f0-9]{64}$/.test(previousContractHash))
		throw new Error("Invalid previous proposal hash");
	const contract: ProposalContract = {
		version: 1,
		project,
		goal,
		query,
		summary,
		findings,
		candidates,
		recommendation,
		questions,
		conflicts,
		uncertainties,
		compute,
		previousContractHash: previousContractHash || null,
	};
	return {
		...contract,
		contractHash: digest(contract),
		approval: "pending",
		approvedContractHash: null,
		navigationOnly: true,
	};
}

export const createPlanProposal = normalizePlanProposal;

export function approvePlanProposal(proposal: PlanProposal, expectedContractHash: unknown): PlanProposal {
	if (proposal.approval !== "pending") throw new Error("Only a pending proposal can be approved");
	const currentContractHash = planProposalContractHash(proposal);
	if (proposal.contractHash !== currentContractHash || expectedContractHash !== currentContractHash)
		throw new Error("Proposal changed; refresh before approval");
	return {
		...proposal,
		approval: "approved",
		approvedContractHash: currentContractHash,
		contractHash: currentContractHash,
	};
}
export function rejectPlanProposal(proposal: PlanProposal, expectedContractHash: unknown): PlanProposal {
	if (proposal.approval !== "pending") throw new Error("Only a pending proposal can be rejected");
	const currentContractHash = planProposalContractHash(proposal);
	if (proposal.contractHash !== currentContractHash || expectedContractHash !== currentContractHash)
		throw new Error("Proposal changed; refresh before rejection");
	return { ...proposal, approval: "rejected", approvedContractHash: null };
}
export function canExecutePlanProposal(
	proposal: PlanProposal,
	currentContractHash = proposal.contractHash,
): boolean {
	const computedHash = planProposalContractHash(proposal);
	return (
		proposal.approval === "approved" &&
		proposal.contractHash === computedHash &&
		proposal.approvedContractHash === computedHash &&
		currentContractHash === computedHash
	);
}

export type ProposalRecoveryDecision = "retry" | "block";
export function proposalRecoveryDecision(
	previousFailures: number,
	sameFailureKey: boolean,
): ProposalRecoveryDecision {
	return sameFailureKey && previousFailures >= 2 ? "block" : "retry";
}
export const shouldBlockRepeatedFailure = (previousFailures: number, sameFailureKey: boolean) =>
	proposalRecoveryDecision(previousFailures, sameFailureKey) === "block";

function renderCitation(ref: ProposalCitation): string {
	const label = ref.label || ref.path;
	const locator = ref.locator ? `（${ref.locator}）` : "";
	return `[[${ref.path}]]${locator}${label !== ref.path ? ` · ${label}` : ""}`;
}
function renderList(items: readonly string[], empty = "无") {
	return items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${empty}`;
}

export function renderPlanProposalCard(proposal: PlanProposal): string {
	const findings = proposal.findings
		.map((item) => `- ${item.text}\n  依据：${item.citations.map(renderCitation).join(" ")}`)
		.join("\n");
	const candidates = proposal.candidates
		.map(
			(item) =>
				`- ${item.title}\n  方法：${item.method}\n  资源：${item.resources}\n  风险：${renderList(item.risks)}\n  依据：${item.basis.map(renderCitation).join(" ")}`,
		)
		.join("\n");
	const questions = proposal.questions.length
		? proposal.questions
				.map(
					(item) =>
						`- ${item.question}\n  默认值：${item.defaultValue}${item.options.length ? `\n  可选：${item.options.join(" / ")}` : ""}`,
				)
				.join("\n")
		: "- 无";
	const conflicts = proposal.conflicts.length
		? proposal.conflicts
				.map(
					(item) =>
						`- ${item.topic}：${item.description}\n  依据：${item.citations.map(renderCitation).join(" ")}`,
				)
				.join("\n")
		: "- 无";
	const uncertainties = proposal.uncertainties.length
		? proposal.uncertainties
				.map((item) => `- ${item.topic}：${item.description}（影响：${item.impact}）`)
				.join("\n")
		: "- 无";
	const budget =
		Object.entries(proposal.compute.budget)
			.map(([key, value]) => `${key}=${value}`)
			.join("，") || "未填写";
	return [
		"## 调研摘要",
		proposal.summary,
		"",
		"### 关键发现（可打开引用）",
		findings,
		"",
		"## 候选方案",
		candidates,
		"",
		"## 推荐方案",
		`${proposal.candidates.find((item) => item.id === proposal.recommendation.candidateId)?.title || proposal.recommendation.candidateId}：${proposal.recommendation.reason}`,
		`依据：${proposal.recommendation.citations.map(renderCitation).join(" ")}`,
		"",
		"## 待确认问题（默认值）",
		questions,
		"",
		"## 冲突与不确定性",
		conflicts,
		uncertainties,
		"",
		"## 计算范围",
		`主机：${proposal.compute.hosts.join("、") || "无"}`,
		`远程读取：${proposal.compute.remoteRead.join("、") || "无"}`,
		`远程写入：${proposal.compute.remoteWrite.join("、") || "无"}`,
		`工作流：${proposal.compute.workflows.join("、") || "无"}`,
		`预算：${budget}；并行作业上限由宿主执行。`,
		`自治等级：${proposal.compute.autonomy}；允许 Agent 编写模块：${proposal.compute.agentCode ? "是" : "否"}。`,
		proposal.previousContractHash
			? `与上一版的差异：合同哈希 ${proposal.previousContractHash} → ${proposal.contractHash}，旧授权自动失效。`
			: `本版合同哈希：${proposal.contractHash}。`,
		"",
		"推荐方案和执行经验只用于导航，不能当作证据或指令，也不能替代用户授权。点击“同意”才会开始执行；修改本提案后必须重新确认。",
	].join("\n");
}

export const buildPlanProposalAuthorizationCard = renderPlanProposalCard;
