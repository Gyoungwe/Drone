import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { expect } from "vitest";
import { SkillVisibility } from "../../src/capabilities/resource-loader";
import { CapabilityRuntime } from "../../src/capabilities/runtime";
import { getPluginSessionCaller } from "../../src/plugins/session-caller";
import { packageChildren } from "./helpers.mjs";

async function loadReadOnlyExtensions(ctx) {
	ctx.stage = "real-readonly-sdk-session";
	ctx.bootstrap = ctx.bridge.beginNative(
		ctx.window,
		(path) => [...ctx.sources].find(([, value]) => value.nativeEntrypoint === path)?.[0],
	);
	ctx.settingsManager = SettingsManager.inMemory({});
	ctx.resourceLoader = new DefaultResourceLoader({
		cwd: ctx.workspace,
		agentDir: ctx.agentDir,
		settingsManager: ctx.settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noContextFiles: true,
		additionalExtensionPaths: [...ctx.sources.values()].map((value) => value.nativeEntrypoint),
		extensionFactoryForPath: ctx.bootstrap.factoryForPath,
	});
	await ctx.resourceLoader.reload({ resolveProjectTrust: async () => true });
	expect(ctx.resourceLoader.getExtensions().errors).toEqual([]);
}

export async function configureOfflineModel(ctx) {
	ctx.modelRuntime = await ModelRuntime.create({
		authPath: join(ctx.agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	ctx.faux = fauxProvider({ provider: "packed-knowledge-offline", tokensPerSecond: 0 });
	ctx.modelRuntime.registerNativeProvider(ctx.faux.provider);
	await ctx.modelRuntime.setRuntimeApiKey("packed-knowledge-offline", "synthetic-offline-only");
	ctx.faux.setResponses([
		fauxAssistantMessage(
			[
				fauxToolCall("knowledge_status", {}),
				fauxToolCall("knowledge_search", { query: "Orchid" }),
				fauxToolCall("effect_probe_unknown", {}),
				fauxToolCall("effect_probe_write", {}),
			],
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage("Read-only acceptance finished."),
	]);
}

async function bindReadOnlySession(ctx) {
	({ session: ctx.session } = await createAgentSession({
		cwd: ctx.workspace,
		agentDir: ctx.agentDir,
		settingsManager: ctx.settingsManager,
		resourceLoader: ctx.resourceLoader,
		modelRuntime: ctx.modelRuntime,
		sessionManager: SessionManager.inMemory(ctx.workspace),
		model: ctx.faux.getModel(),
	}));
	const capabilities = new CapabilityRuntime(new SkillVisibility());
	capabilities.bind(ctx.session);
	capabilities.activate(["knowledge"]);
	for (const name of ["knowledge_status", "knowledge_search", "effect_probe_unknown", "effect_probe_write"])
		expect(
			ctx.session.getActiveToolNames(),
			"declared capability metadata survives process registration",
		).toContain(name);
	ctx.sessions.add({
		session: ctx.session,
		cwd: ctx.workspace,
		readOnly: true,
		unsubscribe: () => undefined,
	});
	ctx.bootstrap.bindSession(ctx.session.sessionId);
	ctx.readOnlyErrors = [];
	await ctx.session.bindExtensions({ onError: (error) => ctx.readOnlyErrors.push(error) });
	ctx.selection = ctx.bridge.selectSession(ctx.window, ctx.session.sessionId);
	expect(getPluginSessionCaller(ctx.sessions, ctx.session.sessionId).scope.workspaceDirectory).toBe(
		ctx.workspace,
	);
	expect(getPluginSessionCaller(ctx.sessions, ctx.session.sessionId).readOnly).toBe(true);
	await ctx.session.prompt(
		"Check knowledge status and search Orchid, then execute the two negative controls.",
	);
	await ctx.session.waitForIdle();
}

async function verifyReadOnlyTools(ctx) {
	// This direct SDK probe deliberately attempts a prompt on a host read-only attachment.
	// The host must deny write hooks while its read tools remain usable; production UI blocks the prompt.
	const deniedWriteHooks = new Set([
		"before_agent_start",
		"message_start",
		"context",
		"tool_execution_start",
		"tool_result",
		"tool_execution_end",
	]);
	expect(ctx.readOnlyErrors.some((error) => error.event === "before_agent_start")).toBe(true);
	for (const error of ctx.readOnlyErrors) {
		expect(deniedWriteHooks.has(error.event)).toBe(true);
		expect(error.error).toBe(`Plugin operation denied: native:event:${error.event}`);
		expect(error.extensionPath).toBe(ctx.source.nativeEntrypoint);
	}
	ctx.results = ctx.session.messages.filter((message) => message.role === "toolResult");
	for (const name of ["knowledge_status", "knowledge_search"])
		expect(ctx.results.find((result) => result.toolName === name)?.isError, name).toBe(false);
	expect(ctx.results.find((result) => result.toolName === "knowledge_search").details.hits[0].path).toBe(
		ctx.uiSearch.hits[0].path,
	);
	for (const name of ["effect_probe_unknown", "effect_probe_write"]) {
		const result = ctx.results.find((value) => value.toolName === name);
		expect(result?.isError, name).toBe(true);
		expect(result.content[0].text).toContain("Plugin operation denied");
	}
	const controlBinding = await ctx.bridge.bind("effect-controls", ctx.window);
	expect(await ctx.bridge.invoke(ctx.window, controlBinding, "count", null, ctx.selection)).toBe(0);
	await expect(
		ctx.bridge.invoke(ctx.window, ctx.binding, "not_registered", null, ctx.selection),
	).rejects.toThrow("not registered");
	expect(
		ctx.approvals.every(
			(approval) =>
				approval.operation === null ||
				(ctx.source.requestsStateWrite &&
					["applyReview", "setReviewPolicy", "capability:state.writeJson"].includes(approval.operation)),
		),
	).toBe(true);
	expect(
		ctx.capabilityScopes.some(
			(call) => call.scope.kind === "session" && call.scope.sessionId === ctx.session.sessionId,
		),
	).toBe(true);
	expect(await packageChildren(ctx.packageRoot)).toEqual(ctx.processes);
}

async function verifyReadOnlyPolicy(ctx) {
	if (ctx.source.requestsStateWrite) {
		const current = await ctx.bridge.invoke(ctx.window, ctx.binding, "preferences", null, ctx.selection);
		const before = await readFile(join(ctx.state, "review-policy.json"), "utf8");
		await expect(
			ctx.bridge.invoke(
				ctx.window,
				ctx.binding,
				"setReviewPolicy",
				{ bindingRevision: 1, expectedVersion: current.reviewPolicy.version, mode: "automatic" },
				ctx.selection,
			),
		).rejects.toThrow("denied");
		expect(await readFile(join(ctx.state, "review-policy.json"), "utf8")).toBe(before);
		ctx.stateReceipt.readOnlySessionRejected = true;
	}
}

export async function createWritableSession(ctx) {
	ctx.stage = "real-writable-sdk-session";
	ctx.writeBootstrap = ctx.bridge.beginNative(
		ctx.window,
		(path) => [...ctx.sources].find(([, value]) => value.nativeEntrypoint === path)?.[0],
	);
	const writeLoader = new DefaultResourceLoader({
		cwd: ctx.workspace,
		agentDir: ctx.agentDir,
		settingsManager: ctx.settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noContextFiles: true,
		additionalExtensionPaths: [ctx.source.nativeEntrypoint],
		extensionFactoryForPath: ctx.writeBootstrap.factoryForPath,
	});
	await writeLoader.reload({ resolveProjectTrust: async () => true });
	expect(writeLoader.getExtensions().errors).toEqual([]);
	({ session: ctx.writeSession } = await createAgentSession({
		cwd: ctx.workspace,
		agentDir: ctx.agentDir,
		settingsManager: ctx.settingsManager,
		resourceLoader: writeLoader,
		modelRuntime: ctx.modelRuntime,
		sessionManager: SessionManager.inMemory(ctx.workspace),
		model: ctx.faux.getModel(),
	}));
	ctx.sessions.add({ session: ctx.writeSession, cwd: ctx.workspace, unsubscribe: () => undefined });
	ctx.writeBootstrap.bindSession(ctx.writeSession.sessionId);
	ctx.errors = [];
	await ctx.writeSession.bindExtensions({ onError: (error) => ctx.errors.push(error) });
	ctx.writeSelection = ctx.bridge.selectSession(ctx.window, ctx.writeSession.sessionId);
	ctx.faux.setResponses([
		fauxAssistantMessage(fauxToolCall("knowledge_search", { query: "Orchid" }), {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage("Writable session searched through the same owner."),
	]);
	await ctx.writeSession.prompt("Search current Orchid evidence.");
	expect(ctx.writeSession.messages.find((message) => message.role === "toolResult")).toMatchObject({
		toolName: "knowledge_search",
		isError: false,
	});
	expect(await packageChildren(ctx.packageRoot)).toEqual(ctx.processes);
	ctx.reviewWrite = (operation, input) =>
		ctx.bridge.invoke(ctx.window, ctx.binding, operation, input, ctx.writeSelection);
}

export async function createReadOnlySession(ctx) {
	await loadReadOnlyExtensions(ctx);
	await configureOfflineModel(ctx);
	await bindReadOnlySession(ctx);
}

export async function verifyReadOnlySession(ctx) {
	await verifyReadOnlyTools(ctx);
	await verifyReadOnlyPolicy(ctx);
}
