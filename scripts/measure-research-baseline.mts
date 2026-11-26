import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { parseArgs, promisify } from "node:util";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { isMainModule } from "./is-main-module.mjs";
import { checked, nullable, readJson, saveReport, sha256, tokensFor } from "./research-baseline-io.mts";

const root = resolve(import.meta.dirname, "..");
const runsDir = join(root, ".local/baseline-runs");
const skillPath = join(root, ".pi/skills/research-workflow/SKILL.md");
const researchPackage = join(root, "vendor/plugins/pi-research");
const categories = ["local-direct", "deep-research", "stall-loop", "external-write"] as const;
const externalSearch = "baseline_search_external";
const deposit = "research_deposit_research_note";
const toolNames = [externalSearch, "research_answer_sources", deposit, "research_loop",
	"research_read_source", "research_search_sources"] as const;
const toolLimit = 24;
const closed = { additionalProperties: false };
const text = Type.String({ minLength: 1 });
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const bool = Type.Boolean();
const commit = Type.String({ pattern: "^[a-f0-9]{40}$" });
const toolSchema = Type.Enum(toolNames);
const toolSetSchema = Type.Array(toolSchema, {
	minItems: toolNames.length, maxItems: toolNames.length, uniqueItems: true,
});
const scenarioSchema = Type.Object({
	id: Type.Enum(categories), prompt: text,
	files: Type.Record(Type.String({ pattern: "^(vault/(Library/Papers|Wiki)|sources(/archive)?)/[a-z0-9-]+\\.md$" }),
		text, { ...closed, minProperties: 1 }),
	fauxRepeat: Type.Integer({ minimum: 1, maximum: toolLimit + 1 }),
	fauxCalls: Type.Array(Type.Object({ name: toolSchema,
		input: Type.Record(Type.String(), Type.Union([text, count, bool, Type.Array(text)])) }, closed),
		{ minItems: 1, maxItems: toolLimit + 1 }),
}, closed);
const fixtureSchema = Type.Object({ schemaVersion: Type.Literal(1), toolSet: toolSetSchema,
	scenarios: Type.Array(scenarioSchema, { minItems: categories.length, maxItems: categories.length }),
}, closed);
const usageSchema = Type.Partial(Type.Object({ input: count, output: count, cacheRead: count,
	cacheWrite: count, reasoning: count }, closed));
const modeSchema = Type.Enum(["offline-faux", "live-sdk"]);
const thinkingSchema = Type.Enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const routeSchema = Type.Enum(["fast_readonly", "deep_research", "escalated", "unrouted"]);
const stopSchema = Type.Enum(["completed", "fast-path-answered", "escalated-to-deep", "breaker-stalled",
	"breaker-budget", "breaker-unknown-quota", "publication-tool-limit", "user-abort", "error"]);
const evidenceSchema = Type.Object({ gateStage: text, answerable: bool, citationCount: count,
	verifiedCitationCount: count, originalSourceRead: bool }, closed);
const observationSchema = Type.Object({
	contextWindow: Type.Integer({ minimum: 1 }), toolSet: toolSetSchema,
	toolCalls: Type.Array(toolSchema, { maxItems: toolLimit }),
	usage: Type.Array(nullable(usageSchema), { minItems: 1 }), evidence: evidenceSchema,
	routeObserved: routeSchema, stopReason: stopSchema, elapsedMs: count, writeEffectsAttempted: Type.Literal(0),
}, closed);
const replaySchema = Type.Object({ config: Type.Object({ name: text }), aggregate: Type.Object({
	sessions: count, sessionsT1: count, sessionsT2: count, sessionsT3: count,
	cacheWriteMeanPerStep: Type.Number({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
	plateauSlopeRatio: nullable(Type.Number({ minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER })),
}) });

type Scenario = Static<typeof scenarioSchema>;
type Observation = Static<typeof observationSchema>;
type Options = { mode?: string; provider?: string; model?: string; thinking?: string;
	fixture?: string; out?: string; "replay-summary"?: string };
type Config = ReturnType<typeof modelConfig>;
type RunScenario = (scenario: Scenario, config: Config) => Promise<unknown>;

function modelConfig(options: Options) {
	const mode = checked(modeSchema, options.mode ?? "offline-faux", "mode");
	if (mode === "offline-faux") {
		if ([options.provider, options.model, options.thinking].some((value) => value !== undefined)) throw new Error("The faux model is pinned");
		return { mode, provider: "baseline-faux", model: "faux-1", thinkingLevel: "off" } as const;
	}
	return { mode, provider: checked(text, options.provider, "--provider"),
		model: checked(text, options.model, "--model"), thinkingLevel: checked(thinkingSchema, options.thinking, "--thinking") };
}

function scenarioMetric(scenario: Scenario, observed: Observation, mode: Config["mode"]) {
	const { usage, toolCalls, evidence } = observed;
	const calls = (name: string) => toolCalls.filter((call) => call === name).length;
	const requested = calls(deposit), externalCalls = calls(externalSearch);
	return {
		scenarioId: scenario.id, category: scenario.id, routeObserved: observed.routeObserved,
		tokens: tokensFor(mode === "live-sdk" ? usage : usage.map(() => null)),
		steps: { llmTurns: usage.length, toolCalls: toolCalls.length,
			toolCallsByName: Object.fromEntries([...new Set(toolCalls)].sort().map((name) => [name, calls(name)])),
			readCount: calls("research_read_source"), searchCount: calls("research_search_sources") + externalCalls,
			externalCalls, specialistRuns: 0, elapsedMs: observed.elapsedMs },
		approvals: { requested, approved: 0, denied: requested, writeEffectsAttempted: observed.writeEffectsAttempted,
			unexpectedWriteRequests: scenario.id === "external-write" ? 0 : requested },
		evidence: { ...evidence, unresolvedCitations: evidence.citationCount - evidence.verifiedCitationCount,
			metacognitiveOk: null, metacognitiveFailures: [], scientificallyVerified: false as const },
		stop: { reason: observed.stopReason, breakerReceiptId: null, evapEvents: 0, evictedToolCallIds: 0 },
	};
}

function aggregate(metric: ReturnType<typeof scenarioMetric>) {
	return { count: 1, meanFirstTurnInputTokens: metric.tokens.firstTurnInput,
		meanCumulativeInputTokens: metric.tokens.cumulativeInput, meanCumulativeOutputTokens: metric.tokens.cumulativeOutput,
		meanSteps: metric.steps.toolCalls, totalApprovalsRequested: metric.approvals.requested,
		unexpectedWriteRequests: metric.approvals.unexpectedWriteRequests, evidencePassRate: Number(metric.evidence.answerable) };
}

async function repoState() {
	const [skill, sdk, lock, installed] = await Promise.all([
		readFile(skillPath), readJson(join(root, "node_modules/@earendil-works/pi-coding-agent/package.json")),
		readJson(join(root, "plugins.lock.json")), readJson(join(researchPackage, ".drone-fetch.json")),
	]);
	const plugins = checked(Type.Object({ plugins: Type.Array(Type.Object({ name: text, commit,
		tarballSha256: text })) }), lock, "plugin lock").plugins;
	const pinned = plugins.find(({ name }) => name === "@gyoungwe/pi-research");
	const staged = checked(Type.Object({ commit, sha256: text }), installed, "staged research package");
	if (pinned?.commit !== staged.commit || pinned.tarballSha256 !== staged.sha256) {
		throw new Error("Staged research package differs from plugins.lock.json");
	}
	return { droneCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
		pluginsCommit: staged.commit, piSdkVersion: checked(Type.Object({ version: text }), sdk, "SDK version").version,
		researchSkillSha256: sha256(skill), researchSkillBytes: skill.byteLength };
}

async function replaySummary(path: string | undefined) {
	if (path === undefined) return null;
	const { config, aggregate: scores } = checked(replaySchema, await readJson(path), "replay summary");
	return { config: config.name, sessions: scores.sessions, t1Sessions: scores.sessionsT1,
		t2Sessions: scores.sessionsT2, t3Sessions: scores.sessionsT3, cacheWriteMeanPerStep: scores.cacheWriteMeanPerStep,
		plateauSlopeRatio: scores.plateauSlopeRatio };
}

export async function measureResearchBaseline(options: Options, runScenario: RunScenario = runIsolated) {
	const config = modelConfig(options);
	const runId = randomUUID();
	const out = options.out === undefined ? join(runsDir, `${runId}.json`) : checked(text, options.out, "--out");
	const fixture = checked(fixtureSchema, await readJson(options.fixture ?? join(root, "fixtures/research-wiring-baseline.json")), "scenario fixture");
	if (fixture.scenarios.some(({ id }, index) => id !== categories[index])) throw new Error("Invalid scenario order or ID");
	const [state, replay] = await Promise.all([repoState(), replaySummary(options["replay-summary"])]);
	const scenarios = [];
	const toolSet = [...fixture.toolSet].sort();
	let contextWindow: number | undefined;
	for (const scenario of fixture.scenarios) {
		const observed = checked(observationSchema, await runScenario(scenario, config), `output for ${scenario.id}`);
		if ([...observed.toolSet].sort().join() !== toolSet.join() ||
			observed.evidence.verifiedCitationCount > observed.evidence.citationCount ||
			(contextWindow !== undefined && contextWindow !== observed.contextWindow)) {
			throw new Error(`Invalid output for ${scenario.id}`);
		}
		contextWindow = observed.contextWindow;
		scenarios.push(scenarioMetric(scenario, observed, config.mode));
	}
	if (contextWindow === undefined) throw new Error("No scenarios measured");
	const report = { kind: "drone.research.baseline" as const, schemaVersion: 1 as const, runId,
		generatedAt: new Date().toISOString(), mode: config.mode, repoState: state,
		modelConfig: { provider: config.provider, model: config.model, thinkingLevel: config.thinkingLevel,
			contextWindow, evapMode: "off" as const }, toolSet, replaySummary: replay, scenarios,
		aggregate: Object.fromEntries(scenarios.map((metric) => [metric.category, aggregate(metric)])) };
	await saveReport(out, report);
	return report;
}

async function runIsolated(scenario: Scenario, config: Config) {
	const apiKey = config.mode === "offline-faux" ? "faux-only" : process.env.DRONE_BASELINE_API_KEY?.trim();
	if (!apiKey) throw new Error("Set DRONE_BASELINE_API_KEY to dedicated baseline test credentials");
	await mkdir(runsDir, { recursive: true });
	const sandbox = await mkdtemp(join(runsDir, ".sdk-"));
	const cwd = join(sandbox, "workspace");
	const home = join(sandbox, "home");
	const agentDir = join(sandbox, "agent");
	try {
		await Promise.all([cwd, home, agentDir].map((path) => mkdir(path)));
		for (const [path, body] of Object.entries(scenario.files)) {
			const target = join(cwd, path);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, body, { flag: "wx" });
		}
		const code = `import { runSdkProbe } from ${JSON.stringify(import.meta.url)};
			console.log(JSON.stringify(await runSdkProbe(...JSON.parse(process.argv[2]))));`;
		const { stdout } = await promisify(execFile)(process.execPath,
			["--input-type=module", "--eval", code, "baseline-probe", JSON.stringify([scenario, config])], {
				cwd, encoding: "utf8", timeout: 300_000,
				env: { HOME: home, USERPROFILE: home, TMPDIR: sandbox, PI_CODING_AGENT_DIR: agentDir,
					DRONE_KNOWLEDGE_DIR: join(sandbox, "knowledge"), DRONE_BASELINE_API_KEY: apiKey },
			});
		return JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
	} finally {
		await rm(sandbox, { recursive: true, force: true });
	}
}

const gateDetails = Type.Object({ evidence_gate: Type.Object({ stage: text, answerable: bool }),
	citations: Type.Optional(Type.Array(Type.Unknown())), metadata: Type.Optional(Type.Object({ mode: Type.Optional(routeSchema) })) });
const citedRead = Type.Object({ hash: text, read_hash: text, read_receipts: Type.Array(Type.Unknown(), { minItems: 1 }) });
const hashedSource = Type.Object({ hash: text });

function watchSession(archiveHashes: Set<string>) {
	const readHashes = new Set<string>();
	const state: Pick<Observation, "usage" | "evidence" | "routeObserved" | "stopReason"> & {
		toolCalls: string[]; limitReached: boolean; writeEffectsAttempted: number;
	} = { usage: [], toolCalls: [],
		evidence: { gateStage: "not-started", answerable: false, citationCount: 0, verifiedCitationCount: 0, originalSourceRead: false },
		routeObserved: "unrouted", stopReason: "completed",
		limitReached: false, writeEffectsAttempted: 0 };
	function observe(event: AgentSessionEvent) {
		if (event.type === "message_end" && event.message.role === "assistant") {
			const { usage, stopReason } = event.message;
			state.usage.push(usage && (usage.totalTokens > 0 || usage.reasoning !== undefined) ? {
				input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite,
				...(usage.reasoning === undefined ? {} : { reasoning: usage.reasoning }),
			} : null);
			if (stopReason === "aborted") state.stopReason = "user-abort";
			if (stopReason === "error" || stopReason === "length") state.stopReason = "error";
		}
		if (event.type !== "tool_execution_end" || event.isError) return;
		const details: unknown = event.result.details;
		if (event.toolName === deposit) state.writeEffectsAttempted++;
		if (event.toolName === "research_read_source" && Check(hashedSource, details)) {
			readHashes.add(details.hash);
			state.evidence.originalSourceRead ||= archiveHashes.has(details.hash);
		}
		if (!Check(gateDetails, details)) return;
		state.routeObserved = details.metadata?.mode ?? state.routeObserved;
		state.evidence.gateStage = details.evidence_gate.stage;
		state.evidence.answerable = details.evidence_gate.answerable;
		state.evidence.citationCount = details.citations?.length ?? 0;
		state.evidence.verifiedCitationCount = details.citations?.filter((citation) =>
			Check(citedRead, citation) && citation.hash === citation.read_hash && readHashes.has(citation.hash)).length ?? 0;
	}
	return { state, observe };
}

export async function runSdkProbe(scenario: Scenario, config: Config) {
	const sdk = await import("@earendil-works/pi-coding-agent");
	const cwd = process.cwd(), agentDir = process.env.PI_CODING_AGENT_DIR, key = process.env.DRONE_BASELINE_API_KEY;
	if (!agentDir || !key) throw new Error("Missing isolated SDK directory or credentials");
	const runtime = await sdk.ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null,
		modelsStorePath: join(agentDir, "models.json"), allowModelNetwork: false, refreshOnCreate: false });
	if (config.mode === "offline-faux") {
		const { fauxProvider, fauxAssistantMessage, fauxToolCall } = await import("@earendil-works/pi-ai");
		const faux = fauxProvider({ provider: config.provider, tokensPerSecond: 0 });
		runtime.registerNativeProvider(faux.provider);
		const calls = Array.from({ length: scenario.fauxRepeat }, () => scenario.fauxCalls).flat();
		faux.setResponses([...calls.map(({ name, input }) => fauxAssistantMessage([fauxToolCall(name, input)],
			{ stopReason: "toolUse" })), fauxAssistantMessage("Synthetic baseline sequence complete.")]);
	}
	const model = runtime.getModel(config.provider, config.model);
	if (!model) throw new Error("Pinned SDK model is not available");
	await runtime.setRuntimeApiKey(config.provider, key);
	const archives = Object.entries(scenario.files).filter(([path]) => path.startsWith("sources/archive/"));
	const { state, observe } = watchSession(new Set(archives.map(([, body]) => sha256(body))));
	const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const resourceLoader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager,
		noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true,
		additionalExtensionPaths: [join(researchPackage, "dist/index.mjs")], additionalSkillPaths: [skillPath],
		extensionFactories: [(pi) => {
			pi.registerTool({ name: externalSearch, label: "Fixture external search",
				description: "Look up external source records in the pinned synthetic archive.", parameters: Type.Object({ query: text }),
				async execute(_id, { query }) {
					const matches = archives.filter(([, body]) => body.toLowerCase().includes(query.toLowerCase()));
					return { content: [{ type: "text", text: JSON.stringify(matches.map(([path]) => path)) }], details: {} };
				} });
			pi.on("tool_call", (event, ctx) => {
				if (state.toolCalls.length >= toolLimit) {
					state.limitReached = true;
					ctx.abort();
					return { block: true, reason: "Baseline publication tool limit reached" };
				}
				state.toolCalls.push(event.toolName);
				if (event.toolName === deposit) return { block: true, reason: "Baseline approval denied" };
			});
		}] });
	await resourceLoader.reload({ resolveProjectTrust: async () => true });
	if (resourceLoader.getExtensions().errors.length) throw new Error("Baseline extension failed to load");
	if (!resourceLoader.getSkills().skills.some(({ filePath }) => filePath === skillPath)) {
		throw new Error("Pinned research skill failed to load");
	}
	const { session } = await sdk.createAgentSession({ cwd, agentDir, model, modelRuntime: runtime,
		thinkingLevel: config.thinkingLevel, tools: [...toolNames], resourceLoader, settingsManager,
		sessionManager: sdk.SessionManager.inMemory(cwd) });
	try {
		await session.bindExtensions({});
		if (session.thinkingLevel !== config.thinkingLevel) throw new Error("SDK changed the pinned thinking level");
		return await measureSession(session, observe, state, model.contextWindow, scenario.prompt);
	} finally {
		session.dispose();
	}
}

async function measureSession(session: AgentSession,
	observe: ReturnType<typeof watchSession>["observe"], state: ReturnType<typeof watchSession>["state"], contextWindow: number, prompt: string) {
	const toolSet = session.getActiveToolNames().sort();
	if (toolSet.join() !== toolNames.join()) throw new Error("SDK tool set differs from the pinned allowlist");
	const unsubscribe = session.subscribe(observe);
	const started = performance.now();
	try { await session.prompt(prompt); } finally { unsubscribe(); }
	const { limitReached, ...observed } = state;
	return { ...observed, contextWindow, toolSet, elapsedMs: Math.round(performance.now() - started),
		stopReason: limitReached ? "publication-tool-limit" : observed.stopReason };
}

if (isMainModule(import.meta.url)) {
	const options = parseArgs({ options: { mode: { type: "string" }, fixture: { type: "string" }, out: { type: "string" },
		provider: { type: "string" }, model: { type: "string" }, thinking: { type: "string" }, "replay-summary": { type: "string" } } }).values;
	await measureResearchBaseline(options);
}
