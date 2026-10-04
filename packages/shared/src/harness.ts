/**
 * Model-facing harness contracts. This module deliberately has no SDK or
 * filesystem dependency: the session engine projects host observations into
 * these bounded values before they enter model context.
 */

export const HARNESS_CHECKPOINT_CUSTOM_TYPE = "drone-harness-checkpoint-v1" as const;

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
	"- Keep progress updates concise and public. The final response leads with the result and names relevant files and checks.",
	"- Private reasoning stays private; expose actions, observations, decisions, and conclusions that the evidence supports.",
].join("\n");

const ITEM_LIMIT = 1_200;
const ITEM_COUNT_LIMIT = 8;
const CHECKPOINT_LIMIT = 8_000;

function normalize(value: unknown, limit = ITEM_LIMIT): string {
	if (typeof value !== "string") return "";
	const compact = value.replace(/\s+/gu, " ").trim();
	return compact.length > limit ? `${compact.slice(0, Math.max(0, limit - 1))}…` : compact;
}

function escape(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function list(values: readonly string[]): string[] {
	return values
		.map((value) => normalize(value))
		.filter(Boolean)
		.slice(0, ITEM_COUNT_LIMIT)
		.map((value) => `- ${escape(value)}`);
}

function section(title: string, values: readonly string[] | string): string {
	const body = Array.isArray(values) ? list(values) : [escape(normalize(values)) || "(none)"];
	return [`### ${title}`, ...(body.length ? body : ["- (none)"])].join("\n");
}

/**
 * Render the per-turn effort/delegation posture. It is intentionally short so
 * changing a posture does not duplicate the stable contract.
 */
export function renderHarnessPosture(posture: HarnessPosture): string {
	const effort = posture.effort === "ultra" ? "ULTRA" : "NORMAL";
	const mode = posture.mode === "plan" ? "Plan mode is read-only." : "Execute only within the active permissions.";
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

function renderSections(checkpoint: HarnessCheckpoint, findings: readonly string[]): string {
	return [
		`<drone-context-checkpoint epoch="${Math.max(0, Math.floor(checkpoint.epoch))}">`,
		section("Objective", checkpoint.objective),
		section("Deliverables", checkpoint.deliverables),
		section("Findings", findings),
		section("Work state", checkpoint.workState),
		section("Next move", checkpoint.nextMove),
		section("Relevant files", checkpoint.relevantFiles),
		"</drone-context-checkpoint>",
	].join("\n\n");
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
	const text = JSON.stringify(canonical(checkpoint)) ?? "null";
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
