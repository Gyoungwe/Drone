import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { type Static, type TSchema, Type } from "typebox";
import { declaredContextWindow, validateBaseUrl } from "./measure-desktop-research-baseline-provider.mts";
import { checked, nullable, tokensFor } from "./research-baseline-io.mts";

export const categories = ["local-direct", "deep-research", "stall-loop", "external-write"] as const;
export const toolNames = ["baseline_search_external", "read", "research_check_answer", "research_deposit_knowledge",
	"research_loop", "research_prepare_knowledge", "research_read_knowledge", "research_search_knowledge",
	"research_source_status", "research_verify_literature"] as const;
export const artifactNames = ["obsidian-workbench.mjs", "workspace-config.mjs", "research-loop.mjs", "source-archive.mjs"] as const;
const closed = { additionalProperties: false }, text = Type.String({ minLength: 1 });
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const positive = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }), bool = Type.Boolean();
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const strings = Type.Array(text), tool = Type.Enum(toolNames);
const toolSet = Type.Array(tool, { minItems: 10, maxItems: 10, uniqueItems: true });
const vaultPath = Type.String({ pattern: "^(Library/Papers|Wiki)/[a-z0-9-]+\\.md$" });
const runRef = Type.Literal("${runDir}");
const archiveRef = Type.Enum(["${archiveFirstPath}", "${archiveSecondPath}"]);
const source = Type.Object({ path: Type.Union([vaultPath, archiveRef]), start_line: positive, end_line: positive, quote: text }, closed);
export const claimBindingsSchema = Type.Array(Type.Object({ claim: text,
	relationship: Type.Enum(["direct", "indirect", "hypothesis", "unsupported"]), limitations: text,
	sources: Type.Array(source, { minItems: 1, maxItems: 12 }) }, closed), { minItems: 1, maxItems: 64 });
const identity = Type.Object({ doi: Type.Enum(["10.1038/fixturea", "10.1038/fixtureb", "10.1038/fixturec", "10.1038/fixtured"]),
	zotero_key: Type.Enum(["ABCDEFGH", "IJKLMNOP", "QRSTUVWX", "YZABCDEF"]), note_path: vaultPath }, closed);
const inputs = {
	baseline_search_external: Type.Object({ query: text, run_dir: runRef }, closed),
	read: Type.Object({ path: archiveRef }, closed),
	research_check_answer: Type.Object({ draft: text }, closed),
	research_deposit_knowledge: Type.Object({ type: Type.Literal("evidence"), title: text, markdown: text,
		status: Type.Literal("proposed"), source_links: Type.Array(Type.String({ pattern: "^\\[\\[Library/Papers/[a-z0-9-]+\\.md\\]\\]$" }), { minItems: 2, maxItems: 2, uniqueItems: true }) }, closed),
	research_loop: Type.Object({ action: Type.Enum(["start", "complete", "record_external", "status"]),
		mode: Type.Optional(Type.Literal("deep_research")), query: Type.Optional(text), result_slug: Type.Optional(text),
		run_dir: Type.Optional(runRef), notes: Type.Optional(text), claim_bindings: Type.Optional(claimBindingsSchema) }, closed),
	research_prepare_knowledge: Type.Object({}, closed),
	research_read_knowledge: Type.Object({ path: vaultPath }, closed),
	research_search_knowledge: Type.Object({ query: text, kind: Type.Optional(Type.Literal("knowledge")) }, closed),
	research_source_status: Type.Object({ run_dir: runRef }, closed), research_verify_literature: identity,
};
function callFor<Name extends keyof typeof inputs>(name: Name) {
	return Type.Object({ name: Type.Literal(name), input: inputs[name] }, closed);
}
const call = Type.Union([callFor("baseline_search_external"), callFor("read"), callFor("research_check_answer"),
	callFor("research_deposit_knowledge"), callFor("research_loop"), callFor("research_prepare_knowledge"),
	callFor("research_read_knowledge"), callFor("research_search_knowledge"), callFor("research_source_status"), callFor("research_verify_literature")]);
const expected = Type.Object({ gateStage: text, runStatus: text, stopReason: text }, closed);
const scenarioSchema = Type.Object({ id: Type.Enum(categories), prompt: text,
	files: Type.Record(Type.String({ pattern: "^(vault/(Library/Papers|Wiki)|sources/archive)/[a-zA-Z0-9-]+\\.md$" }),
		text, { ...closed, minProperties: 1 }), identities: Type.Record(Type.String({ pattern: "^[A-Z0-9]{8}$" }),
		Type.Object({ doi: identity.properties.doi, note_path: vaultPath }, closed), { ...closed, maxProperties: 2 }),
	fauxRepeat: Type.Literal(1), fauxCalls: Type.Array(call, { minItems: 1, maxItems: 24 }), finalDraft: text, expected }, closed);
const fixtureSchema = Type.Object({ schemaVersion: Type.Literal(2), toolSet,
	scenarios: Type.Array(scenarioSchema, { minItems: 4, maxItems: 4 }) }, closed);
export type DesktopScenario = Static<typeof scenarioSchema>;
export type FixtureIdentity = Static<typeof identity>;
const identityRows = [
	["10.1038/fixturea", "ABCDEFGH", "amberwing-north"], ["10.1038/fixtureb", "IJKLMNOP", "amberwing-south"],
	["10.1038/fixturec", "QRSTUVWX", "copperleaf-first"], ["10.1038/fixtured", "YZABCDEF", "copperleaf-second"],
];
const referenceNames = ["runDir", "archiveFirstPath", "archiveSecondPath"];

export function resolveReferences(value: unknown, references: ReadonlyMap<string, string>): unknown {
	return JSON.parse(JSON.stringify(value, (_key, item: unknown) => {
		if (typeof item !== "string") return item;
		const resolved = item.replace(/\$\{([^}]*)\}/g, (_match, name: string) => {
			if (!referenceNames.includes(name)) throw new Error(`Unknown reference: ${name}`);
			const replacement = references.get(name);
			if (replacement === undefined) throw new Error(`Missing successful tool result reference: ${name}`);
			return replacement;
		});
		if (resolved.includes("${")) throw new Error("Unknown reference syntax");
		return resolved;
	}));
}

export function validateFixtureIdentity(scenario: DesktopScenario, value: FixtureIdentity) {
	const row = identityRows.find(([doi]) => doi === value.doi);
	const lines = scenario.files[`vault/${value.note_path}`]?.split("\n");
	if (!row || row[1] !== value.zotero_key || value.note_path !== `Library/Papers/${row[2]}.md` ||
		lines?.length !== 5 || lines[4] !== "" || lines[2] !== value.doi || lines[3] !== `zotero:${value.zotero_key}`) {
		throw new Error("Invalid fixture identity or note marker");
	}
}

function validateScenario(scenario: DesktopScenario) {
	if (/research_(search_sources|read_source|answer_sources|deposit_research_note)/.test(scenario.prompt)) throw new Error("Invalid Desktop prompt");
	const identities = fixtureIdentities(scenario);
	if (identities.length !== (["local-direct", "external-write"].includes(scenario.id) ? 2 : 0)) throw new Error("Invalid fixture identities");
	for (const item of identities) validateFixtureIdentity(scenario, item);
	const available = new Map<string, string>();
	for (const entry of scenario.fauxCalls) {
		resolveReferences(entry.input, available);
		if (entry.name === "research_check_answer" && entry.input.draft !== scenario.finalDraft) throw new Error("Preflight draft differs from final draft");
		if (entry.name === "research_verify_literature" && !identities.some((item) => item.doi === entry.input.doi && item.zotero_key === entry.input.zotero_key && item.note_path === entry.input.note_path)) throw new Error("Invalid call identity");
		if (entry.name === "research_loop") validateLoopInput(scenario, entry.input);
		if (entry.name === "research_loop" && entry.input.action === "start") available.set("runDir", "run");
		if (entry.name === "baseline_search_external") {
			available.set("archiveFirstPath", "first"); available.set("archiveSecondPath", "second");
		}
	}
	resolveReferences(scenario.finalDraft, available);
}

export function fixtureIdentities(scenario: DesktopScenario): FixtureIdentity[] {
	return Object.entries(scenario.identities).map(([zotero_key, value]) => checked(identity, { ...value, zotero_key }, "fixture identity"));
}

function validateLoopInput(scenario: DesktopScenario, input: Static<typeof inputs.research_loop>) {
	if (input.action === "start" && (!input.query || !input.result_slug || input.mode !== "deep_research" || !/^[a-z0-9-]+$/.test(input.result_slug))) throw new Error("Invalid start input");
	if (input.action !== "start" && !input.run_dir) throw new Error("Invalid run reference");
	if (input.action === "complete" && !input.claim_bindings) throw new Error("Missing claim bindings");
	for (const binding of input.claim_bindings ?? []) for (const item of binding.sources) {
		const path = item.path === "${archiveFirstPath}" ? "sources/archive/winterglass-first.md" :
			item.path === "${archiveSecondPath}" ? "sources/archive/winterglass-second.md" : `vault/${item.path}`;
		const lines = scenario.files[path]?.split("\n");
		if (!lines || item.start_line !== 2 || item.end_line !== 2 || item.quote !== lines[1]) throw new Error("Invalid source quote or range");
	}
}

export function validateDesktopFixture(value: unknown) {
	const fixture = checked(fixtureSchema, value, "Desktop fixture");
	if (fixture.scenarios.some(({ id }, index) => id !== categories[index])) throw new Error("Invalid scenario order");
	for (const scenario of fixture.scenarios) validateScenario(scenario);
	return fixture;
}

export function validateDesktopScenario(value: unknown) {
	const scenario = checked(scenarioSchema, value, "Desktop scenario");
	validateScenario(scenario);
	return scenario;
}

export async function containedRealPath(root: string, path: string) {
	if (!isAbsolute(path) || path.includes("\\") || path.split(sep).includes("..")) throw new Error("Path outside allowed root");
	const base = await realpath(root), target = await realpath(path), offset = relative(base, target);
	if (!offset || offset === ".." || offset.startsWith(`..${sep}`) || isAbsolute(offset)) throw new Error("Path outside allowed root");
	if (target !== resolve(path)) throw new Error("Path contains a symbolic link");
	return target;
}

export function createResultReferences(resultsRoot: string) {
	const references = new Map<string, string>();
	return { resolve: (value: unknown) => resolveReferences(value, references),
		async observe(entry: { name: string; input: Record<string, unknown> }, result: { isError: boolean; details: unknown }) {
			if (result.isError) return;
			if (entry.name === "research_loop" && entry.input.action === "start") {
				const details = checked(Type.Object({ run_dir: text, metadata: Type.Object({ status: Type.Literal("running") }),
					evidence_gate: Type.Object({ stage: Type.Literal("created") }) }), result.details, "start details");
				const run = await containedRealPath(resultsRoot, details.run_dir);
				references.clear(); references.set("runDir", run);
			}
			if (entry.name !== "baseline_search_external") return;
			const details = checked(Type.Object({ acquisition: Type.Literal("fixture-copy"), run_dir: text,
				archiveFirstPath: text, archiveSecondPath: text }), result.details, "archive details");
			const run = references.get("runDir");
			if (!run || details.run_dir !== run || entry.input.run_dir !== run) throw new Error("Invalid archive run reference");
			const [first, second] = await Promise.all([containedRealPath(resolve(run, "sources"), details.archiveFirstPath),
				containedRealPath(resolve(run, "sources"), details.archiveSecondPath)]);
			references.set("archiveFirstPath", first); references.set("archiveSecondPath", second);
		} };
}

export function validateResolvedInput(name: string, value: unknown, registeredSchema: TSchema) {
	if (!toolNames.some((allowed) => name === allowed)) throw new Error("Tool outside Desktop allowlist");
	return checked(registeredSchema, value, `resolved ${name} input`);
}

const usage = Type.Partial(Type.Object({ input: count, output: count, cacheRead: count, cacheWrite: count, reasoning: count }, closed));
const breaker = Type.Object({ id: text, reason: text, limitKind: text,
	limits: Type.Object({ maxBilledTokens: positive }), measured: Type.Object({ steps: count }) });
export const observationSchema = Type.Object({ scenarioId: Type.Enum(categories), contextWindow: positive, toolSet,
	toolCalls: Type.Array(tool, { maxItems: 24 }), usage: Type.Array(nullable(usage), { minItems: 1 }),
	routeObserved: Type.Enum(["fast_readonly", "deep_research", "escalated", "unrouted"]), runStatus: text,
	evidence: Type.Object({ gateStage: text, gateStatus: text, answerable: bool, boundSourceCount: count,
		identityVerifiedNoteCount: count, archiveVerifiedCount: count, publicationCheckedVaultCitationCount: count,
		archivedTextRead: bool, originalFulltextReadThisTurn: Type.Literal(false), scientificallyVerified: Type.Literal(false) }, closed),
	preflight: Type.Object({ checked: bool, ok: nullable(bool), warnings: strings, errors: strings }, closed),
	publication: Type.Object({ published: bool, rejected: bool, warnings: strings, errors: strings }, closed),
	stop: Type.Object({ reason: Type.Enum(["completed", "completed-with-write-denied", "stalled", "repeated-tool-loop",
		"budget-exceeded", "quota-unconfirmable", "harness-tool-limit", "voluntary-stop", "user-abort", "error"]), breakerReceipt: nullable(breaker) }, closed),
	approvals: Type.Object({ requested: count, denied: count, approved: Type.Literal(0), depositExecuteEntered: Type.Literal(0), vaultUnchanged: Type.Literal(true) }, closed),
	networkViolations: Type.Literal(0), elapsedMs: count, expectationMatched: bool }, closed);

export function validateDesktopObservation(value: unknown) {
	const observation = checked(observationSchema, value, "Desktop observation");
	if (observation.approvals.requested !== observation.approvals.denied ||
		(observation.publication.published && observation.publication.rejected)) throw new Error("Invalid Desktop observation invariants");
	return observation;
}

type Observation = Static<typeof observationSchema>;
export function liveObservation(observed: Observation, scenario: DesktopScenario, usage: Observation["usage"], escalated: boolean) {
	const { gateStage, answerable } = observed.evidence;
	const expected = scenario.expected;
	return { ...observed, usage, routeObserved: escalated ? "escalated" as const : observed.routeObserved,
		expectationMatched: expected.gateStage === gateStage && expected.runStatus === observed.runStatus &&
			expected.stopReason === observed.stop.reason && observed.approvals.requested === Number(scenario.id === "external-write") &&
			answerable === (expected.runStatus === "completed") };
}

export function unroutedObservation(data: Pick<Observation, "scenarioId" | "contextWindow" | "usage" | "elapsedMs" | "preflight" | "publication"> & {
	toolSet: string[]; toolCalls: string[]; networkViolations: number; approvals: { requested: number; denied: number;
		approved: number; depositExecuteEntered: number; vaultUnchanged: boolean } }, assistantStop: string, limitReached: boolean) {
	const reason = limitReached ? "harness-tool-limit" : assistantStop === "error" ? "error" : assistantStop === "aborted" ? "user-abort" : "voluntary-stop";
	return validateDesktopObservation({ ...data, routeObserved: "unrouted", runStatus: "not-started", expectationMatched: false,
		evidence: { gateStage: "not-started", gateStatus: "not-started", answerable: false, boundSourceCount: 0,
			identityVerifiedNoteCount: 0, archiveVerifiedCount: 0, publicationCheckedVaultCitationCount: 0,
			archivedTextRead: false, originalFulltextReadThisTurn: false, scientificallyVerified: false }, stop: { reason, breakerReceipt: null } });
}

const artifact = Type.Object({ path: text, sha256: hash }, closed);
const tokenMetrics = Type.Object({ firstTurnInput: nullable(count), cumulativeInput: nullable(count),
	cumulativeOutput: nullable(count), cacheRead: nullable(count), cacheWrite: nullable(count), reasoning: nullable(count),
	billedTotal: nullable(count), usageReported: bool, reportedFields: Type.Array(Type.Enum(["input", "output", "cacheRead", "cacheWrite", "reasoning"])),
	unknownUsageSteps: count }, closed);
const scenarioReport = Type.Object({ ...observationSchema.properties, tokens: tokenMetrics,
	cost: nullable(Type.Number({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })) }, closed);
export const reportSchema = Type.Object({ kind: Type.Literal("drone.research.desktop-baseline"), schemaVersion: Type.Literal(2),
	runId: text, generatedAt: text, mode: Type.Enum(["offline-faux", "live-sdk"]), toolSet,
	repoState: Type.Object({ droneCommit: text, pluginsCommit: text, piSdkVersion: text }),
	assembly: Type.Object({ artifacts: Type.Array(artifact, { minItems: 4, maxItems: 4 }), resources: Type.Array(artifact, { minItems: 1 }) }, closed),
	modelConfig: Type.Object({ provider: text, model: text, thinkingLevel: text, contextWindow: Type.Optional(positive),
		declaredContextWindow: Type.Optional(Type.Literal(declaredContextWindow)), baseUrl: nullable(text),
		breakerBudget: Type.Object({ maxBilledTokens: Type.Literal(500000) }, closed), budgetEvidence: nullable(breaker) }, closed),
	policy: Type.Object({ networkPolicy: text, acquisition: Type.Literal("fixture-copy"), identityTransport: Type.Literal("in-memory-zotero"),
		approvalMechanism: Type.Literal("baseline-tool-call-policy"), breakerUsageSource: Type.Enum(["sdk-faux-estimate", "sdk-provider"]),
		setupConsent: Type.Literal("synthetic-unmeasured") }, closed),
	scenarios: Type.Array(scenarioReport, { minItems: 4, maxItems: 4 }) }, closed);

export function validateDesktopReport(value: unknown) {
	const report = checked(reportSchema, value, "Desktop report");
	const { baseUrl, contextWindow, declaredContextWindow, budgetEvidence } = report.modelConfig;
	const offline = report.mode === "offline-faux";
	if (report.scenarios.some((item, index) => item.scenarioId !== categories[index]) ||
		report.assembly.artifacts.some((item, index) => item.path !== `.pi/extensions/${artifactNames[index]}`)) throw new Error("Invalid Desktop report provenance");
	if (offline ? baseUrl !== null || contextWindow === undefined || declaredContextWindow !== undefined || !budgetEvidence :
		baseUrl === null || contextWindow !== undefined || declaredContextWindow === undefined) throw new Error("Invalid Desktop mode model config");
	if (!offline && baseUrl !== null) validateBaseUrl(baseUrl);
	const receipts = report.scenarios.flatMap(({ stop }) => stop.breakerReceipt ? [stop.breakerReceipt] : []);
	if ((offline ? budgetEvidence?.limits.maxBilledTokens !== 500000 : receipts.some((receipt) => receipt.limits.maxBilledTokens !== 500000)) ||
		(budgetEvidence ? !receipts.some((receipt) => JSON.stringify(receipt) === JSON.stringify(budgetEvidence)) : receipts.length)) throw new Error("Invalid budget receipt reference");
	for (const item of report.scenarios) {
		const { tokens, cost, ...observation } = item;
		validateDesktopObservation(observation);
		if (item.contextWindow !== (contextWindow ?? declaredContextWindow)) throw new Error("Invalid context window");
		if (report.mode === "offline-faux" && item.usage.some((sample) => sample !== null)) throw new Error("Invalid offline model usage");
		if (report.mode === "offline-faux" && cost !== null) throw new Error("Invalid offline model cost");
		const expected = tokensFor(item.usage);
		if (Object.entries(expected).some(([key, value]) => JSON.stringify(tokens[key as keyof typeof tokens]) !== JSON.stringify(value))) throw new Error("Invalid model token totals");
	}
	return report;
}
