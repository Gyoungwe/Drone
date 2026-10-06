/**
 * Model-facing harness contracts. This module deliberately has no SDK or
 * filesystem dependency: the session engine projects host observations into
 * these bounded values before they enter model context.
 */

export const HARNESS_CHECKPOINT_CUSTOM_TYPE = "drone-harness-checkpoint-v1" as const;
export const HARNESS_STATUS_CUSTOM_TYPE = "drone-harness-status-v1" as const;
export const HARNESS_REDIRECT_CUSTOM_TYPE = "drone-harness-redirect-v1" as const;
export const HARNESS_GUARD_CUSTOM_TYPE = "drone-harness-guard-v1" as const;

export type HarnessUnit = "context" | "recall" | "guard" | "delivery" | "familyPrompt";

export const HARNESS_UNITS = [
	"context",
	"recall",
	"guard",
	"delivery",
	"familyPrompt",
] as const satisfies readonly HarnessUnit[];

export type HarnessUnitState = Record<HarnessUnit, boolean>;

export interface ResolvedHarnessUnits {
	units: HarnessUnitState;
	ignored: string[];
}

const HARNESS_UNIT_BY_KEY: Record<string, HarnessUnit> = {
	context: "context",
	recall: "recall",
	guard: "guard",
	delivery: "delivery",
	familyprompt: "familyPrompt",
};

/** Resolve the backwards-compatible and per-unit harness switches. */
export function resolveHarnessUnits(
	input: {
		harnessContext?: boolean;
		harness?: Partial<Record<HarnessUnit, boolean>>;
	},
	env = "",
): ResolvedHarnessUnits {
	const legacyDisabled = input.harnessContext === false;
	const units = Object.fromEntries(HARNESS_UNITS.map((unit) => [unit, !legacyDisabled])) as HarnessUnitState;
	if (!legacyDisabled) {
		for (const unit of HARNESS_UNITS) {
			const value = input.harness?.[unit];
			if (typeof value === "boolean") units[unit] = value;
		}
	}
	const ignored = new Set<string>();
	const disabled = env
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean)
		.map((value) => value.replace(/\s+/gu, "").toLowerCase());
	const disableAll = disabled.includes("all");
	if (!legacyDisabled && disableAll) for (const unit of HARNESS_UNITS) units[unit] = false;
	for (const key of disabled) {
		if (key === "all") continue;
		const unit = HARNESS_UNIT_BY_KEY[key];
		if (unit) {
			if (!legacyDisabled) units[unit] = false;
		} else {
			ignored.add(key);
		}
	}
	return { units, ignored: [...ignored] };
}

export interface HarnessPosture {
	effort: "normal" | "ultra";
	delegation: "off" | "light" | "standard" | "high";
	autonomy: "interactive" | "balanced" | "autonomous";
	mode?: "plan" | "execute";
}

export interface HarnessCheckpoint {
	version: 1;
	epoch: number;
	objective: string;
	deliverables: string[];
	findings: string[];
	workState: string;
	nextMove: string;
	relevantFiles: string[];
	sources?: HarnessSourceRef[];
}

export type HarnessSourceKind =
	| "task"
	| "todo"
	| "status"
	| "subagent"
	| "compaction"
	| "message"
	| "file"
	| "trace";

export interface HarnessSourceRef {
	kind: HarnessSourceKind;
	id?: string;
	label: string;
	path?: string;
	hash?: string;
	timestamp?: string;
}

export type HarnessModelFamily = "anthropic" | "gemini" | "gpt" | "codex" | "gpt-astra" | "default";

export type HarnessSpecialistRole = "ml" | "biology" | "physics" | "chemistry" | "data" | "general";

export interface HarnessContractFingerprint {
	version: 1;
	provider: string;
	model: string;
	system: string;
	tools: string[];
	capabilities: string[];
	skills: string[];
	fingerprint: string;
}

export interface HarnessBudgetStatus {
	used: number;
	limit: number;
	percent: number;
	level: "normal" | "warning" | "critical" | "exhausted";
}

export interface HarnessWorkerAttempt {
	parentSessionId: string;
	childSessionId?: string;
	attempt: number;
	agent: string;
	status: "started" | "running" | "done" | "error" | "aborted" | "cancelled";
	usage?: { input?: number; output?: number; totalTokens?: number; cost?: number };
	artifactRefs?: string[];
	evidenceRefs?: string[];
	error?: string;
}

export interface HarnessRecallHit {
	sourceKind: HarnessSourceKind;
	sourceId?: string;
	excerpt: string;
	path?: string;
	hash?: string;
	timestamp?: string;
}

/** Stable instructions that shape observable work without requesting private reasoning. */
export const HARNESS_CONTRACT = [
	"Drone harness contract:",
	"- Inspect before assuming: read the relevant files, specifications, and tool results before choosing a method.",
	"- Verify important claims, numbers, and outputs against current evidence or measured results.",
	"- Preserve source data and existing work; keep partial results and state the blocker when a step fails.",
	"- Track the requested deliverables and check the final files under the conditions that will consume them.",
	"- Report evidence and limitations, unresolved questions, and the next observable action precisely.",
	"- Use the available tools and permissions; do not claim work, evidence, or review that did not happen.",
	"- Keep progress updates concise and public. The final answer follows the answer mode below; for code or file work it also names the changed files and checks run.",
	"- Private reasoning stays private; expose actions, observations, decisions, and conclusions that the evidence supports.",
].join("\n");

/** Shared scientific contract used by every model family and specialist. */
export const SCIENCE_CONTRACT = [
	"Scientific contract:",
	"- Inspect relevant files, data, and source records before assuming or fitting.",
	"- Keep observations, interpretations, hypotheses, and unknowns separate.",
	"- Check numbers and generated outputs against the current source or a fresh run.",
	"- Preserve source data and write new results beside existing work; do not silently overwrite or delete.",
	"- Treat simulated data, teacher outputs, pseudo-labels, and self-generated validators as assumptions, not real-world error checks.",
	"- State missing evidence, failed checks, and remaining limitations in the final answer.",
].join("\n");

/** Shared response contract; family prompts only change tone and transport details. */
export const RESPONSE_CONTRACT = [
	"Response contract:",
	"- Progress narration between tools is short and only reports a new observation, choice, result, or blocker.",
	"- The final answer is the user-facing answer; its length and structure follow the answer mode.",
	"- Never claim a file was saved, a source was read, or a check passed unless the host returned that evidence.",
	"- Keep private reasoning private; expose observable actions, evidence, decisions, and conclusions.",
].join("\n");

/** 回答模式：auto = 按问题自动判断；quick = 快速问答；academic = 学术回答 */
export type AnswerMode = "auto" | "quick" | "academic";
export const ANSWER_MODES: readonly AnswerMode[] = ["auto", "quick", "academic"];

export const QUICK_ANSWER_CONTRACT = [
	"Answer mode: quick.",
	"- Answer the question directly in a few sentences or a short list; no headings.",
	"- Keep only the caveat that changes how the answer should be used.",
	"- Cite a source (Vault path, DOI or URL) only for a specific fact that depends on it; never invent one.",
].join("\n");

export const ACADEMIC_ANSWER_CONTRACT = [
	"Answer mode: academic. Write the final answer as a scholarly synthesis, in the user's language:",
	"- Structure it as Background and question → Methods and evidence → Conclusion, with short headings.",
	"- Cite each substantive claim inline as (Author, Year). End with a numbered References list: authors, year, title, venue, DOI; when the reference has a note in the local Vault, add its Vault path.",
	"- Grade every claim explicitly as established (replicated or consensus), supported by evidence (one or a few studies), or speculative (hypothesis or inference); never upgrade weak evidence.",
	"- Use precise terms, units and numbers together with their conditions (organism, sample size, method) instead of vague qualifiers.",
	"- Never invent a reference, DOI, author or number. If a citation could not be checked against a source you actually read, say so next to it.",
	"- Say which parts came from the local knowledge base and which from the web.",
].join("\n");

const ACADEMIC_CUES =
	/学术|综述|文献|论文|参考文献|引用|证据|机制|研究进展|机理|假说|研究现状|\bliterature\b|\breview\b|\bevidence\b|\bmechanis(?:m|ms|tic)\b|\bcitations?\b|\breferences?\b|\bstate of the art\b|\bsystematic\b/i;
const QUICK_CUES =
	/简单说|简短|一句话|快速回答|直接告诉|\bbriefly\b|\bin short\b|\bquick(?:ly)?\b|\btl;?dr\b/i;

/** 自动判断：显式「简短」优先；学术线索 → 学术回答；其余快速问答。手动设定（quick/academic）总是优先。 */
export function resolveAnswerMode(
	prompt: unknown,
	setting: AnswerMode = "auto",
): Exclude<AnswerMode, "auto"> {
	if (setting === "quick" || setting === "academic") return setting;
	const text = typeof prompt === "string" ? prompt : "";
	if (QUICK_CUES.test(text)) return "quick";
	return ACADEMIC_CUES.test(text) ? "academic" : "quick";
}

export function answerModeContract(mode: Exclude<AnswerMode, "auto">): string {
	return mode === "academic" ? ACADEMIC_ANSWER_CONTRACT : QUICK_ANSWER_CONTRACT;
}

const ITEM_LIMIT = 1_200;
const ITEM_COUNT_LIMIT = 8;
const CHECKPOINT_LIMIT = 8_000;

function normalize(value: unknown, limit = ITEM_LIMIT): string {
	if (typeof value !== "string") return "";
	const compact = value.replace(/\s+/gu, " ").trim();
	return compact.length > limit ? `${compact.slice(0, Math.max(0, limit - 1))}…` : compact;
}

function xmlEscape(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function list(values: readonly string[]): string[] {
	return values
		.map((value) => normalize(value))
		.filter(Boolean)
		.slice(0, ITEM_COUNT_LIMIT)
		.map((value) => `- ${xmlEscape(value)}`);
}

function section(title: string, values: readonly string[] | string): string {
	const body = Array.isArray(values) ? list(values) : [xmlEscape(normalize(values)) || "(none)"];
	return [`### ${title}`, ...(body.length ? body : ["- (none)"])].join("\n");
}

function sourceLines(sources: readonly HarnessSourceRef[] | undefined): string[] {
	return (sources ?? []).slice(0, ITEM_COUNT_LIMIT).map((source) => {
		const identity = source.id ? ` [${normalize(source.id, 120)}]` : "";
		const path = source.path ? ` (${normalize(source.path, 512)})` : "";
		return `- ${xmlEscape(`${source.kind}${identity}: ${normalize(source.label, 240)}${path}`)}`;
	});
}

/**
 * Render the per-turn effort/delegation posture. It is intentionally short so
 * changing a posture does not duplicate the stable contract.
 */
export function renderHarnessPosture(posture: HarnessPosture): string {
	const effort = posture.effort === "ultra" ? "ULTRA" : "NORMAL";
	const mode =
		posture.mode === "plan" ? "Plan mode is read-only." : "Execute only within the active permissions.";
	const delegation =
		posture.delegation === "off"
			? "Keep the work in the lead conversation."
			: posture.delegation === "light"
				? "Delegate at most one genuinely independent branch."
				: posture.delegation === "high"
					? "Parallelize independent branches when each has a clear handoff."
					: "Delegate independent branches when it shortens the path; integrate their evidence here.";
	const autonomy =
		posture.autonomy === "interactive"
			? "Ask before planning or consequential choices."
			: posture.autonomy === "autonomous"
				? "Choose routine and consequential paths; ask only when authority or input is missing."
				: "Choose safe reversible paths; ask when ambiguity materially changes scope or outcome.";
	return [
		`Harness posture: effort ${effort}. ${effort === "ULTRA" ? "Investigate an independent branch only when it can materially change the result." : "Stay focused and add branches only when they materially help."}`,
		`Delegation: ${posture.delegation}. ${delegation}`,
		`Independence: ${posture.autonomy}. ${autonomy}`,
		`${mode} The permission mode remains authoritative.`,
	].join("\n");
}

export function resolveHarnessModelFamily(provider: unknown, model: unknown): HarnessModelFamily {
	const value =
		`${typeof provider === "string" ? provider : ""}/${typeof model === "string" ? model : ""}`.toLowerCase();
	if (value.includes("astra") || value.includes("gpt-6")) return "gpt-astra";
	if (value.includes("codex")) return "codex";
	if (value.includes("claude") || value.includes("anthropic")) return "anthropic";
	if (value.includes("gemini") || value.includes("google")) return "gemini";
	if (value.includes("gpt") || value.includes("openai") || value.includes("o1") || value.includes("o3"))
		return "gpt";
	return "default";
}

const FAMILY_GUIDANCE: Record<HarnessModelFamily, string> = {
	anthropic:
		"Be direct and evidence-led. Use short progress updates and put the user-facing synthesis in the final response.",
	gemini:
		"Keep tool observations concrete and separate from conclusions. Organize the final response around the requested result and evidence.",
	gpt: "Work as a pragmatic senior scientist: inspect the project, use tools when evidence is needed, and keep commentary separate from the final answer.",
	codex:
		"Use the host instructions and available tools precisely. Keep commentary as progress and reserve the complete answer for final.",
	"gpt-astra":
		"Pursue independent branches only when they can materially change the result, then integrate their evidence before answering.",
	default:
		"Use the available tools carefully, verify observable results, and shape the final answer to the answer mode.",
};

export function renderHarnessPromptLayer(
	family: HarnessModelFamily | null,
	posture: HarnessPosture,
	role?: HarnessSpecialistRole,
	skills: readonly string[] = [],
	answerMode?: Exclude<AnswerMode, "auto">,
): string {
	const roleText = role
		? `Specialist handoff: you are the ${role} specialist. Return only Outcome, Findings, Evidence, Changes and outputs, Verification, Limitations, and Next action when those fields have content. Do not delegate or ask the user.`
		: "";
	const skillText = skills.length
		? `Loaded skill index:\n${skills
				.slice(0, ITEM_COUNT_LIMIT)
				.map((s) => `- ${s}`)
				.join("\n")}`
		: "";
	return [
		family ? `Model family guidance (${family}): ${FAMILY_GUIDANCE[family]}` : "",
		HARNESS_CONTRACT,
		SCIENCE_CONTRACT,
		RESPONSE_CONTRACT,
		answerMode ? answerModeContract(answerMode) : "",
		roleText,
		skillText,
		renderHarnessPosture(posture),
	]
		.filter(Boolean)
		.join("\n\n");
}

/**
 * Render the smaller contract used by isolated specialists. Their role prompt
 * already supplies the task-specific operating rules, so repeating the lead
 * conversation contract would spend context without adding a control.
 */
export function renderHarnessSpecialistLayer(
	family: HarnessModelFamily,
	posture: HarnessPosture,
	role: string,
	skills: readonly string[] = [],
): string {
	const skillText = skills.length
		? `Loaded skill index:\n${skills
				.slice(0, ITEM_COUNT_LIMIT)
				.map((s) => `- ${s}`)
				.join("\n")}`
		: "";
	return [
		`Specialist contract (${role}; model family ${family}): return only the requested structured handoff and do not delegate or ask the user.`,
		SCIENCE_CONTRACT,
		RESPONSE_CONTRACT,
		skillText,
		renderHarnessPosture(posture),
	]
		.filter(Boolean)
		.join("\n\n");
}

function renderSections(checkpoint: HarnessCheckpoint, findings: readonly string[]): string {
	return [
		`<drone-context-checkpoint epoch="${Math.max(0, Math.floor(checkpoint.epoch))}">`,
		section("Objective", checkpoint.objective),
		section("Deliverables", checkpoint.deliverables),
		section("Findings", findings),
		section("Work state", checkpoint.workState),
		section("Next move", checkpoint.nextMove),
		section("Relevant files", checkpoint.relevantFiles),
		checkpoint.sources?.length ? ["### Sources", ...sourceLines(checkpoint.sources)].join("\n") : "",
		"</drone-context-checkpoint>",
	]
		.filter(Boolean)
		.join("\n\n");
}

/** Render a bounded checkpoint for model context. */
export function renderHarnessCheckpoint(checkpoint: HarnessCheckpoint): string {
	let findings = checkpoint.findings.slice(0, ITEM_COUNT_LIMIT);
	let rendered = renderSections(checkpoint, findings);
	while (rendered.length > CHECKPOINT_LIMIT && findings.length > 0) {
		findings = findings.slice(0, -1);
		rendered = renderSections(checkpoint, findings);
	}
	if (rendered.length <= CHECKPOINT_LIMIT) return rendered;
	return `${rendered.slice(0, CHECKPOINT_LIMIT - 1)}…`;
}

function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value)
			.filter(([, entry]) => entry !== undefined)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => [key, canonical(entry)]),
	);
}

/**
 * Stable identity fingerprint for checkpoint changes. This is an identity
 * hash, not an authorization or evidence hash; it stays SDK-free for renderer
 * and shared-package consumers.
 */
export function checkpointFingerprint(checkpoint: HarnessCheckpoint): string {
	return identityFingerprint(checkpoint);
}

function identityFingerprint(value: unknown): string {
	const text = JSON.stringify(canonical(value)) ?? "null";
	const mask = 0xffff_ffff_ffff_ffffn;
	const prime = 0x100_0000_01b3n;
	const offset = 0xcbf2_9ce4_8422_2325n;
	return [0n, 1n, 2n, 3n]
		.map((seed) => {
			let hash = (offset ^ (seed * 0x9e37_79b9_7f4a_7c15n)) & mask;
			for (const code of text) {
				hash ^= BigInt(code.codePointAt(0) ?? 0);
				hash = (hash * prime) & mask;
			}
			return hash.toString(16).padStart(16, "0");
		})
		.join("");
}

/** The same SDK-free identity hash is used for change detection of prompt/tool contracts. */
export function contractFingerprint(input: Omit<HarnessContractFingerprint, "fingerprint">): string {
	return identityFingerprint({
		version: input.version,
		provider: input.provider,
		model: input.model,
		system: input.system,
		tools: [...input.tools].sort(),
		capabilities: [...input.capabilities].sort(),
		skills: [...input.skills].sort(),
	});
}

export function renderHarnessRedirect(signature: string, attempt: number, reason: string): string {
	return `<drone-harness-redirect attempt="${Math.max(1, Math.floor(attempt))}">\nFind the root cause of the repeated failure (${xmlEscape(normalize(signature, 240))}), change the tool, library, or method, or split the step. Do not blindly repeat the same call. Host observation: ${xmlEscape(normalize(reason, 800))}\n</drone-harness-redirect>`;
}

export function budgetStatus(used: number, limit: number): HarnessBudgetStatus {
	const safeUsed = Number.isFinite(used) && used >= 0 ? used : 0;
	const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 0;
	const percent = safeLimit ? Math.min(100, Math.round((safeUsed / safeLimit) * 100)) : 0;
	const level: HarnessBudgetStatus["level"] =
		safeLimit > 0 && safeUsed >= safeLimit
			? "exhausted"
			: percent >= 85
				? "critical"
				: percent >= 50
					? "warning"
					: "normal";
	return { used: safeUsed, limit: safeLimit, percent, level };
}
