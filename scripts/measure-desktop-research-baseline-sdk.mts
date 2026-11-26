import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type * as PiAi from "@earendil-works/pi-ai";
import type * as Sdk from "@earendil-works/pi-coding-agent";
import type * as Knowledge from "@gyoungwe/pi-knowledge/host";
import { type TSchema, Type } from "typebox";
import { artifactNames, createResultReferences, liveObservation, toolNames, unroutedObservation } from "./measure-desktop-research-baseline-contract.mts";
import {
	acquireFixtureArchive, assertFixtureRead, type DesktopFixture, type DesktopSetupRunner, installFixtureFetch, setupDesktopFixture,
} from "./measure-desktop-research-baseline-fixture.mts";
import { fauxResponses, objectFields, offlineModel } from "./measure-desktop-research-baseline-faux.mts";
import { finishObservation, observeDesktopEvents, snapshotVault } from "./measure-desktop-research-baseline-observe.mts";
import { declaredContextWindow, gatewayFetch, type LiveProvider, liveUsage, scenarioRuntime, withLiveConfig } from "./measure-desktop-research-baseline-provider.mts";
import { checked, readJson } from "./research-baseline-io.mts";

const repo = resolve(import.meta.dirname, "..");
const artifacts = artifactNames.map((name) => join(repo, ".pi/extensions", name));
const deposit = "research_deposit_knowledge";
const setup = "research_setup_obsidian";
const acquire = "baseline_search_external";
const policyPath = "<inline:1>";
const text = Type.String({ minLength: 1 });
const schemaShape = Type.Object({ type: Type.Literal("object"), properties: Type.Object({}), required: Type.Optional(Type.Array(text)) });

type Runtime = { sdk: typeof Sdk; ai: typeof PiAi; knowledge: typeof Knowledge };

export async function loadDesktopAssembly(sdk: typeof Sdk, fixture: DesktopFixture, factory?: Sdk.ExtensionFactory) {
	const { workspace: cwd, agentDir, skillPath } = fixture;
	const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const loader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager,
		noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true,
		additionalSkillPaths: [skillPath], additionalExtensionPaths: artifacts,
		extensionFactories: factory ? [factory] : [],
		extensionsOverride: (base) => ({ ...base,
			extensions: [...base.extensions].sort((left, right) => Number(right.path === policyPath) - Number(left.path === policyPath)) }),
	});
	await loader.reload({ resolveProjectTrust: async () => true });
	const loaded = loader.getExtensions();
	if (loaded.errors.length) throw new Error("Desktop extension load failed");
	const paths = loaded.extensions.map(({ path }) => path).sort();
	const expected = [...artifacts, ...(factory ? [policyPath] : [])].sort();
	if (paths.join() !== expected.join()) throw new Error("Desktop extension assembly differs from allowlist");
	if (loader.getSkills().skills.map(({ filePath }) => filePath).join() !== skillPath) throw new Error("Pinned research skill failed to load exclusively");
	const definitions = new Map<string, Sdk.ToolDefinition>();
	for (const extension of loaded.extensions) for (const [name, { definition }] of extension.tools) {
		if (definitions.has(name) || name !== definition.name) throw new Error(`Duplicate or mismatched registration: ${name}`);
		const shape = checked(schemaShape, definition.parameters, `registered ${name} schema`);
		if (shape.required?.some((key) => !Object.hasOwn(shape.properties, key))) throw new Error(`Unregistered required parameter: ${name}`);
		definitions.set(name, definition);
	}
	return { loader, settingsManager, definitions };
}

export async function createDesktopSession(
	sdk: typeof Sdk, fixture: DesktopFixture, assembly: Awaited<ReturnType<typeof loadDesktopAssembly>>,
	tools: string[], selected: ReturnType<typeof offlineModel> | LiveProvider,
) {
	const { workspace: cwd, agentDir } = fixture;
	const { session } = await sdk.createAgentSession({ cwd, agentDir, ...await scenarioRuntime(sdk, agentDir, selected),
		settingsManager: assembly.settingsManager, resourceLoader: assembly.loader, tools,
		sessionManager: sdk.SessionManager.inMemory(cwd) });
	return session;
}

function setupRunner({ sdk, ai, knowledge }: Runtime): DesktopSetupRunner {
	return async ({ fixture, toolName, input }) => {
		const assembly = await loadDesktopAssembly(sdk, fixture);
		const definition = assembly.definitions.get(toolName);
		if (!definition) throw new Error("Missing native setup tool");
		checked(definition.parameters, input, "native setup tool input");
		const model = offlineModel(ai, [ai.fauxAssistantMessage([ai.fauxToolCall(toolName, input)],
			{ stopReason: "toolUse" }), ai.fauxAssistantMessage("Fixture setup finished.")]);
		const session = await createDesktopSession(sdk, fixture, assembly, [toolName], model);
		try {
			const uiContext = { select: async (_title: string, options: string[]) => {
				if (!options.includes("确认应用此方案")) throw new Error("Missing native setup confirmation option");
				return "确认应用此方案";
			} };
			await session.bindExtensions({ uiContext: uiContext as Sdk.ExtensionUIContext });
			await session.prompt("Initialize the isolated fixture knowledge Vault and project.");
			const result = session.messages.find((message) => message.role === "toolResult" && message.toolName === setup);
			if (result?.role !== "toolResult" || result.isError) throw new Error("Native setup tool failed");
			return await verifySetup(knowledge, fixture, result.details);
		} finally {
			session.dispose();
		}
	};
}

async function verifySetup(knowledge: typeof Knowledge, fixture: DesktopFixture, details: unknown) {
	const receipt = checked(Type.Object({ scope: Type.Literal("application"), vault: text, project: text,
		bindingRevision: Type.Integer({ minimum: 1 }) }), details, "native setup receipt");
	const binding = await knowledge.readKnowledgeBinding({ fresh: true });
	const config = checked(Type.Object({ knowledgeProjectId: text }), await readJson(join(fixture.workspace, ".pi/research-workspace.json")), "workspace project read-back");
	if (!binding || binding.vault !== receipt.vault || binding.revision !== receipt.bindingRevision || config.knowledgeProjectId !== receipt.project) {
		throw new Error("Native setup binding or project did not persist");
	}
	const service = await knowledge.getKnowledgeService(binding);
	await service.request("reconcile");
	const index = checked(Type.Object({ coverage: text, pendingChanges: Type.Integer(), problems: Type.Array(Type.Unknown()) }),
		await service.request("status"), "native index status");
	if (index.coverage !== "ready" || index.pendingChanges !== 0 || index.problems.length !== 0) {
		const diagnostics = index.problems.map((problem) => {
			const { path, message } = objectFields(problem);
			const kind = path === "<watcher>" || path === "<inventory>" ? path : "note";
			const code = typeof message === "string" ? /\b(?:EPERM|EACCES|ENOSPC|EMFILE|ENOSYS|EEXIST)\b/.exec(message)?.[0] : undefined;
			return code ? `${kind}:${code}` : kind;
		});
		throw new Error(`Native index not ready (${index.coverage}; pending ${index.pendingChanges}; problems ${diagnostics.join(", ")})`);
	}
	return { vault: binding.vault, project: config.knowledgeProjectId, bindingRevision: binding.revision,
		indexReady: true };
}

function researchPolicy(fixture: DesktopFixture, references: ReturnType<typeof createResultReferences>, live?: LiveProvider) {
	const state = { toolCalls: [] as string[], requested: 0, denied: 0, depositExecuteEntered: 0, limitReached: false,
		runDir: "", escalated: false, error: "", vaultBeforeDeposit: undefined as Awaited<ReturnType<typeof snapshotVault>> | undefined };
	const pending = new Map<string, { name: string; input: Record<string, unknown> }>();
	const factory: Sdk.ExtensionFactory = (pi) => {
		pi.registerTool({ name: acquire, label: "Fixture archive acquisition", description: "Copy pinned synthetic instrument records into the active research run; no network.",
			parameters: Type.Object({ query: text, run_dir: text }), async execute(_id, { run_dir, query }) {
				if (run_dir !== state.runDir) throw new Error("Archive acquisition requires the current run");
				const details = await acquireFixtureArchive(fixture, run_dir, query);
				return { content: [{ type: "text", text: JSON.stringify(details) }], details };
			} });
		pi.on("tool_call", async ({ toolName, input, toolCallId }, ctx) => {
			if (toolName === deposit) {
				state.requested++;
				state.denied++;
				try { state.vaultBeforeDeposit ??= await snapshotVault(fixture.vault); }
				catch { state.error = "Vault snapshot failed before deposit denial"; }
			}
			if (state.toolCalls.length === 24) {
				state.limitReached = true;
				ctx.abort();
				return { block: true, reason: "Desktop baseline harness tool limit" };
			}
			state.toolCalls.push(toolName);
			if (toolName === deposit) return { block: true, reason: "Desktop baseline approval denied" };
			if (!toolNames.some((name) => name === toolName)) {
				state.error = "Tool outside Desktop allowlist";
				return { block: true, reason: state.error };
			}
			if (toolName === "read") {
				const { path } = objectFields(input);
				try {
					if (typeof path !== "string") throw new Error("Invalid read path");
					await assertFixtureRead(fixture, path, state.runDir || undefined);
				} catch {
					state.error = "Raw read outside the verified fixture read boundary";
					return { block: true, reason: state.error };
				}
			}
			pending.set(toolCallId, { name: toolName, input });
		});
		pi.on("tool_execution_end", async ({ toolCallId, isError, result }) => {
			const entry = pending.get(toolCallId);
			pending.delete(toolCallId);
			if (!entry || isError) return;
			const details = objectFields(result).details;
			await references.observe(entry, { isError, details });
			if (live && entry.name === "research_loop" && entry.input.action === "escalate")
				state.escalated = objectFields(objectFields(details).metadata).mode === "deep_research";
			if (entry.name === "research_loop" && entry.input.action === "start") {
				const runDir = references.resolve("${runDir}");
				if (typeof runDir !== "string") throw new Error("Native start did not return a run directory");
				state.runDir = runDir;
				state.escalated = false;
			}
		});
	};
	return { state, factory };
}

function measuredSchemas(sdk: typeof Sdk, fixture: DesktopFixture, definitions: Map<string, Sdk.ToolDefinition>, state: { depositExecuteEntered: number }) {
	if (definitions.has("read")) throw new Error("Native extension shadows SDK built-in read");
	const schemas = new Map<string, TSchema>([["read", sdk.createReadToolDefinition(fixture.workspace).parameters]]);
	for (const name of toolNames) {
		if (name === "read") continue;
		const definition = definitions.get(name);
		if (!definition) throw new Error(`Required Desktop tool not registered: ${name}`);
		if (name === deposit) {
			const execute = definition.execute;
			definition.execute = (...args) => {
				state.depositExecuteEntered++;
				return execute.apply(definition, args);
			};
		}
		schemas.set(name, definition.parameters);
	}
	return schemas;
}

export async function runDesktopScenario(fixture: DesktopFixture, live?: LiveProvider, transport = globalThis.fetch) {
	const guard = installFixtureFetch(fixture.identities);
	try {
		const [sdk, ai, knowledge] = await Promise.all([
			import("@earendil-works/pi-coding-agent"), import("@earendil-works/pi-ai"), import("@gyoungwe/pi-knowledge/host"),
		]);
		return await withLiveConfig(fixture, live, () => measure({ sdk, ai, knowledge }, fixture, guard, live, transport));
	} finally {
		guard.restore();
	}
}

async function measure({ sdk, ai, knowledge }: Runtime, fixture: DesktopFixture,
	guard: ReturnType<typeof installFixtureFetch>, live: LiveProvider | undefined, transport: typeof fetch) {
	const references = createResultReferences(fixture.resultsRoot);
	const { state, factory } = researchPolicy(fixture, references, live);
	const events = observeDesktopEvents();
	const usage: ReturnType<typeof liveUsage>[] = [];
	let session: Sdk.AgentSession | undefined;
	let unsubscribe: (() => void) | undefined;
	try {
		await setupDesktopFixture(fixture, setupRunner({ sdk, ai, knowledge }));
		const assembly = await loadDesktopAssembly(sdk, fixture, factory);
		const schemas = measuredSchemas(sdk, fixture, assembly.definitions, state);
		const selected = live ?? offlineModel(ai, fauxResponses(ai, fixture.scenario, schemas, references));
		if (live) globalThis.fetch = gatewayFetch(live.baseUrl, globalThis.fetch, transport, guard.violations);
		session = await createDesktopSession(sdk, fixture, assembly, [...toolNames], selected);
		const errors: string[] = [];
		await session.bindExtensions({ onError: ({ event }) => errors.push(event ?? "extension-error") });
		const toolSet = session.getActiveToolNames().sort();
		if (toolSet.join() !== toolNames.join()) throw new Error("SDK active tool set differs from Desktop allowlist");
		unsubscribe = session.subscribe((event) => {
			events.observe(event);
			if (live && event.type === "message_end" && event.message.role === "assistant") usage.push(liveUsage(event.message.usage));
		});
		const vaultBefore = await snapshotVault(fixture.vault);
		const started = performance.now();
		await session.prompt(fixture.scenario.prompt);
		if (errors.length || state.error) throw new Error(state.error || `Desktop extension event failed: ${errors.join(", ")}`);
		if (!live && !state.runDir) throw new Error(`Native run did not start (${events.state.failedTools.join(", ")})`);
		const contextWindow = "apiKey" in selected ? declaredContextWindow : selected.model.contextWindow;
		const baseline = { toolSet, contextWindow, elapsedMs: Math.round(performance.now() - started), networkViolations: guard.violations.length };
		const before = state.vaultBeforeDeposit ?? vaultBefore;
		const { preflight, publication, assistantStop } = events.state;
		const observed = state.runDir ? await finishObservation({ ...baseline, fixture, runDir: state.runDir,
			vaultBefore: before, events: events.state, counters: state }) : unroutedObservation({ ...baseline, preflight, publication,
			scenarioId: fixture.scenario.id, toolCalls: state.toolCalls, usage,
			approvals: { requested: state.requested, denied: state.denied, approved: 0, depositExecuteEntered: state.depositExecuteEntered,
				vaultUnchanged: isDeepStrictEqual(before, await snapshotVault(fixture.vault)) } }, assistantStop, state.limitReached);
		return { observation: live ? liveObservation(observed, fixture.scenario, usage, state.escalated) : observed,
			provider: "apiKey" in selected ? selected.provider : selected.model.provider, model: "apiKey" in selected ? selected.model : selected.model.id,
			registeredToolNames: [...schemas.keys(), ...[...assembly.definitions.keys()].filter((name) => !schemas.has(name))].sort() };
	} finally {
		try { session?.dispose(); } finally {
			try { await knowledge.closeKnowledgeServices(); } finally {
				try { unsubscribe?.(); } finally { guard.assertClean(); }
			}
		}
	}
}
