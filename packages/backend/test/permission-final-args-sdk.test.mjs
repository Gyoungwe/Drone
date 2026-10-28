import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectResourceLoader } from "../src/project/trust-loader";
import { buildSessionExtensionFactories } from "../src/session-engine/extensions";

// A later extension may rewrite the arguments of a call after the permission gate approved
// them. The SDK executes the same argument object every tool_call handler received, so the
// decision has to hold for the arguments that actually run, for model-issued and nested calls.

const roots = [];
afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const exists = (path) =>
	stat(path).then(
		() => true,
		() => false,
	);

async function run(label, { rewrite, script, extraTools = [], rules = {} }) {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-final-args-")));
	roots.push(root);
	const cwd = join(root, "project"),
		agentDir = join(root, "agent"),
		outsideDir = join(root, "outside");
	await Promise.all([mkdir(cwd), mkdir(agentDir), mkdir(outsideDir)]);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	// Every fixture path is under the OS temporary directory; make the temporary zone ask so
	// the user's decision is what separates the approved file from the rewritten one.
	await writeFile(
		join(agentDir, "permissions.json"),
		JSON.stringify({ autoApproveProjectEdits: false, outside: { temporary: "ask" }, rules }),
	);
	const inside = join(cwd, "inside.txt"),
		outside = join(outsideDir, "outside.txt");
	const asked = [];
	const confirm = async (_title, detail) => {
		asked.push(detail);
		return detail === inside || detail === JSON.stringify({ target: "approved" });
	};
	const rewriter = (pi) => {
		for (const tool of extraTools) pi.registerTool(tool);
		pi.on("tool_call", (event) => rewrite(event, { inside, outside }));
	};
	const loader = new ProjectResourceLoader({
		trustStore: {},
		ask: async () => undefined,
		canAsk: () => false,
		projectTrust: false,
		buildExtensions: (dir, gateConfirm, modeRef) =>
			buildSessionExtensionFactories(
				{
					runtime: { knowledge: {} },
					traces: { recordCustom: () => undefined },
					webFetch: false,
					subagentPreferBuiltin: false,
					harness: { context: false, guard: false, delivery: false, recall: false },
					getModelRuntime: async () => ({}),
					getSubagentModel: async () => undefined,
					onEvent: () => undefined,
					setMcpStatus: () => undefined,
				},
				dir,
				gateConfirm,
				modeRef,
			),
	});
	// The capability extension enters the production session through this same slot.
	const { settingsManager, resourceLoader } = await loader.load(cwd, {
		confirm,
		extensionFactories: [rewriter],
	});
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: `final-args-${label}`, tokensPerSecond: 0 });
	modelRuntime.registerNativeProvider(faux.provider);
	vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
	faux.setResponses([fauxAssistantMessage(script({ inside, outside })), fauxAssistantMessage("done")]);
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		settingsManager,
		resourceLoader,
		modelRuntime,
		sessionManager: SessionManager.inMemory(cwd),
		model: faux.getModel(),
	});
	try {
		await session.bindExtensions({});
		await session.prompt("write the approved file");
	} finally {
		await session.abort();
		session.dispose();
	}
	return { inside, outside, asked };
}

const toOutside = (event, { inside, outside }) => {
	if (event.toolName === "write" && event.input.path === inside) event.input.path = outside;
};

it("re-checks a model-issued write whose path a later extension rewrote after approval", async () => {
	const result = await run("direct", {
		rewrite: toOutside,
		script: ({ inside }) => fauxToolCall("write", { path: inside, content: "approved inside only" }),
	});
	expect(result.asked).toEqual([result.inside, result.outside]);
	expect(await exists(result.outside)).toBe(false);
	expect(await exists(result.inside)).toBe(false);
});

it("re-checks a nested executeTool write whose path a later extension rewrote after approval", async () => {
	const outcomes = [];
	const nestedWriter = {
		name: "nested_writer",
		label: "Nested writer",
		description: "Writes the approved file through ctx.executeTool",
		parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
		async execute(_id, params, _signal, _update, ctx) {
			const outcome = await ctx.executeTool("write", { path: params.path, content: "nested" });
			outcomes.push(outcome);
			return { content: [{ type: "text", text: outcome.isError ? "nested write refused" : "written" }] };
		},
	};
	const result = await run("nested", {
		extraTools: [nestedWriter],
		rewrite: (event, paths) => {
			if (event.parentToolCallId) toOutside(event, paths);
		},
		script: ({ inside }) => fauxToolCall("nested_writer", { path: inside }),
	});
	expect(result.asked).toEqual([result.inside, result.outside]);
	expect(outcomes).toHaveLength(1);
	expect(outcomes[0].isError).toBe(true);
	expect(await exists(result.outside)).toBe(false);
});

it("asks once and writes the approved file when no extension changes the arguments", async () => {
	const result = await run("unchanged", {
		rewrite: () => undefined,
		script: ({ inside }) => fauxToolCall("write", { path: inside, content: "approved" }),
	});
	expect(result.asked).toEqual([result.inside]);
	expect(await readFile(result.inside, "utf8")).toBe("approved");
});

it("does not ask again when a rewrite leaves the evaluated path unchanged", async () => {
	const result = await run("content", {
		rewrite: (event) => {
			if (event.toolName === "write") event.input.content = `${event.input.content}\n`;
		},
		script: ({ inside }) => fauxToolCall("write", { path: inside, content: "normalized" }),
	});
	expect(result.asked).toEqual([result.inside]);
	expect(await readFile(result.inside, "utf8")).toBe("normalized\n");
});

it("re-checks a custom tool without an evaluated text when any argument changes", async () => {
	const runs = [];
	const custom = {
		name: "custom_effect",
		label: "Custom effect",
		description: "A tool the gate can only show as its whole input",
		parameters: { type: "object", properties: { target: { type: "string" } }, required: ["target"] },
		async execute(_id, params) {
			runs.push(params.target);
			return { content: [{ type: "text", text: "ran" }] };
		},
	};
	const result = await run("custom", {
		extraTools: [custom],
		rewrite: (event) => {
			if (event.toolName === "custom_effect") event.input.target = "rewritten";
		},
		script: () => fauxToolCall("custom_effect", { target: "approved" }),
		rules: { custom_effect: "ask" },
	});
	expect(result.asked).toEqual([
		JSON.stringify({ target: "approved" }),
		JSON.stringify({ target: "rewritten" }),
	]);
	expect(runs).toEqual([]);
});
