import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerKnowledgeInterface } from "@drone/extensions/knowledge-extension";
import zoteroLiterature from "@drone/extensions/zotero-literature";
import {
	acceptanceKinds,
	acceptanceSchema,
	acceptanceVerifier,
	CORE_ACCEPTANCE_KINDS,
	describeAcceptance,
	effectiveAcceptance,
	normalizeAcceptance,
	registerAcceptanceVerifier,
	resetAcceptanceVerifiers,
} from "@drone/tasks/acceptance";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import registerPiCore from "@gyoungwe/pi-core";
import { afterEach, describe, expect, it } from "vitest";
import { bindAcceptanceVerifierEvents } from "../src/tasks/acceptance";
import { createInstalledTaskRuntime, registerTaskRuntime } from "./fixtures/task-plugin.mjs";

/** 只捕获 registerTool、其余 API 全部 no-op 的 pi 桩。 */
function stubPi(tools = new Map()) {
	const base = {
		registerTool: (tool) => tools.set(tool.name, tool),
		getAllTools: () => [...tools.values()],
		getCommands: () => [],
		events: createEventBus(),
	};
	return { pi: new Proxy(base, { get: (t, p) => (p in t ? t[p] : () => {}) }), tools };
}

const acceptanceOf = (taskPlan) => taskPlan.parameters.properties.milestones.items.properties.acceptance;
const plan = (acceptance) => ({
	goal: "目标",
	summary: "摘要",
	milestones: [{ id: "m1", title: "里程碑", acceptance }],
});
function validationError(tool, args) {
	try {
		validateToolArguments(tool, { id: "call-1", name: tool.name, arguments: args });
		return null;
	} catch (error) {
		return error?.message || String(error);
	}
}

afterEach(() => {
	resetAcceptanceVerifiers();
	delete process.env.DRONE_KNOWLEDGE_DIR;
});

describe("acceptance verifier registry (hook 2)", () => {
	it("registers one task workbench per Pi host even when two extension graphs load it", () => {
		const tools = new Map();
		const listeners = new Map();
		const pi = {
			registerTool: (tool) => tools.set(tool.name, tool),
			getAllTools: () => [...tools.values()],
			registerCommand: () => {},
			on: (name, _listener) => listeners.set(name, (listeners.get(name) || 0) + 1),
			events: createEventBus(),
		};
		const first = registerTaskRuntime(pi);
		const second = registerTaskRuntime(pi, { readKnowledgeBinding: async () => null });

		expect(second).toBe(first);
		expect(listeners.size).toBe(12);
		expect([...listeners.values()].every((count) => count === 1)).toBe(true);
		expect(tools.has("task_plan")).toBe(true);
		expect(tools.size).toBe(5);
	});

	it("uses the shared event bus when extension facades are sealed per bundle", () => {
		const tools = new Map();
		const listeners = new Map();
		const subscriptions = new Map();
		const makeEvents = () => ({
			on(name, listener) {
				const entries = subscriptions.get(name) || [];
				entries.push(listener);
				subscriptions.set(name, entries);
				return () =>
					subscriptions.set(
						name,
						entries.filter((entry) => entry !== listener),
					);
			},
			emit(name, payload) {
				for (const listener of subscriptions.get(name) || []) listener(payload);
			},
		});
		const registerTool = (tool) => tools.set(tool.name, tool);
		const registerCommand = () => {};
		const on = (name) => listeners.set(name, (listeners.get(name) || 0) + 1);
		const first = Object.freeze({
			registerTool,
			getAllTools: () => [...tools.values()],
			registerCommand,
			on,
			events: makeEvents(),
		});
		const second = Object.freeze({
			registerTool,
			getAllTools: () => [...tools.values()],
			registerCommand,
			on,
			events: makeEvents(),
		});

		const journal = registerTaskRuntime(first);
		expect(registerTaskRuntime(second, { readKnowledgeBinding: async () => null })).toBe(journal);
		expect(listeners.size).toBe(12);
		expect(tools.size).toBe(5);
	});

	it("isolates sealed facades that have independent event buses", () => {
		const makeHost = () => {
			const tools = new Map();
			const listeners = new Map();
			const subscriptions = new Map();
			const events = {
				on(name, listener) {
					const entries = subscriptions.get(name) || [];
					entries.push(listener);
					subscriptions.set(name, entries);
					return () =>
						subscriptions.set(
							name,
							entries.filter((entry) => entry !== listener),
						);
				},
				emit(name, payload) {
					for (const listener of subscriptions.get(name) || []) listener(payload);
				},
			};
			const pi = Object.freeze({
				registerTool: (tool) => tools.set(tool.name, tool),
				getAllTools: () => [...tools.values()],
				registerCommand: () => {},
				appendEntry: () => {},
				sendMessage: () => {},
				on: (name) => listeners.set(name, (listeners.get(name) || 0) + 1),
				events: Object.freeze(events),
			});
			return { pi, tools, listeners };
		};

		const first = makeHost();
		const second = makeHost();
		const firstJournal = registerTaskRuntime(first.pi);
		const secondJournal = registerTaskRuntime(second.pi);

		expect(secondJournal).not.toBe(firstJournal);
		expect(first.listeners.size).toBe(12);
		expect(second.listeners.size).toBe(12);
		expect(first.tools.size).toBe(5);
		expect(second.tools.size).toBe(5);
	});

	it("shares one session journal across independent event buses without a process ledger", () => {
		const makeHost = () => {
			const tools = new Map();
			const listeners = new Map();
			const pi = Object.freeze({
				registerTool: (tool) => tools.set(tool.name, tool),
				getAllTools: () => [...tools.values()],
				registerCommand: () => {},
				appendEntry: () => {},
				sendMessage: () => {},
				on: (name, listener) => {
					const entries = listeners.get(name) || [];
					entries.push(listener);
					listeners.set(name, entries);
				},
				events: Object.freeze(createEventBus()),
			});
			return { pi, tools, listeners };
		};
		const first = makeHost();
		const second = makeHost();
		const manager = {
			getSessionId: () => "independent-bus-session",
			getBranch: () => [],
		};
		const ctx = { sessionManager: manager, sessionId: "independent-bus-session", cwd: tmpdir() };
		const firstJournal = registerTaskRuntime(first.pi);
		registerTaskRuntime(second.pi);
		for (const host of [first, second])
			for (const listener of host.listeners.get("session_start") || []) listener({}, ctx);

		const milestones = firstJournal.plan({
			goal: "一次受控 MCP 调用",
			summary: "只调用已批准的工具",
			milestones: [{ id: "call", title: "调用工具", acceptance: { kind: "human_review" } }],
		});
		const planned = firstJournal.view();
		firstJournal.command({
			action: "authorize-task",
			taskId: planned.tasks[0].id,
			revision: planned.revision,
		});
		expect(milestones).toHaveLength(1);
		const results = (second.listeners.get("tool_call") || []).map((listener) =>
			listener({ toolName: "mcp", toolCallId: "call-1", input: {} }),
		);
		expect(results.every((result) => result === undefined)).toBe(true);

		const other = makeHost();
		registerTaskRuntime(other.pi);
		const otherManager = { getSessionId: () => "other-session", getBranch: () => [] };
		const otherCtx = { sessionManager: otherManager, sessionId: "other-session", cwd: tmpdir() };
		for (const listener of other.listeners.get("session_start") || []) listener({}, otherCtx);
		const blocked = (other.listeners.get("tool_call") || []).map((listener) =>
			listener({ toolName: "mcp", toolCallId: "call-2", input: {} }),
		);
		expect(blocked.some((result) => result?.block === true)).toBe(true);
	});

	it("rejects host-owned kinds, malformed kinds and reserved field names", () => {
		expect(() => registerAcceptanceVerifier("file")).toThrow(/owned by the host/);
		expect(() => registerAcceptanceVerifier("Bad-Kind")).toThrow(/must match/);
		expect(() => registerAcceptanceVerifier("x_kind", { fields: ["path"] })).toThrow(/invalid field "path"/);
		expect(() => registerAcceptanceVerifier("x_kind", { fields: ["kind"] })).toThrow(/invalid field "kind"/);
		expect(() => registerAcceptanceVerifier("x_kind", { fields: ["sha256"] })).toThrow(
			/invalid field "sha256"/,
		);
		expect(() => registerAcceptanceVerifier("x_kind", { verify: "nope" })).toThrow(/must be a function/);
		expect(() => registerAcceptanceVerifier("x_kind", { identify: "nope" })).toThrow(/must be a function/);
		expect(acceptanceKinds()).toEqual([...CORE_ACCEPTANCE_KINDS]);
	});

	it("keeps identify optional and merges host-bound identity without rewriting the approved acceptance", () => {
		const verifier = registerAcceptanceVerifier("x_kind", { fields: ["doi"] });
		expect(verifier.identify).toBeNull();
		const milestone = {
			acceptance: { kind: "x_kind", path: "", sha256: null, doi: "" },
			bound: { fields: { doi: "10.1/bound" }, via: "tool" },
		};
		expect(effectiveAcceptance(milestone)).toEqual({
			kind: "x_kind",
			path: "",
			sha256: null,
			doi: "10.1/bound",
		});
		expect(milestone.acceptance.doi).toBe("");
		expect(effectiveAcceptance({ acceptance: { kind: "x_kind", doi: "10.1/planned" } })).toEqual({
			kind: "x_kind",
			doi: "10.1/planned",
		});
	});

	it("schema captured before registration sees kinds AND fields registered later (model view + pi validation)", () => {
		const { pi, tools } = stubPi();
		registerTaskRuntime(pi); // task_plan 先注册，schema 对象此刻已经创建
		const taskPlan = tools.get("task_plan");
		expect(taskPlan).toBeTruthy();
		expect(acceptanceOf(taskPlan).properties.kind.enum).toEqual(["file", "human_review"]);
		expect(Object.keys(acceptanceOf(taskPlan).properties)).toEqual(["kind", "path", "sha256", "rootKind"]);

		registerAcceptanceVerifier("lab_sample", {
			fields: ["sampleId", "batch"],
			label: (a) => `样本 ${a.sampleId}`,
		});

		const schema = acceptanceOf(taskPlan);
		expect(schema.properties.kind.enum).toContain("lab_sample");
		expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(["sampleId", "batch"]));
		expect(schema.additionalProperties).toBe(false);

		expect(validationError(taskPlan, plan({ kind: "lab_sample", sampleId: "S-1", batch: "B7" }))).toBeNull();
		expect(validationError(taskPlan, plan({ kind: "lab_sample", nope: "x" }))).toMatch(
			/additional properties/,
		);
		expect(validationError(taskPlan, plan({ kind: "unknown_kind" }))).toMatch(/kind/);
	});

	it("real load order: task_plan (obsidian-workbench) before zotero-literature still validates zotero_item + doi", () => {
		delete process.env.PI_SUBAGENT_CHILD;
		process.env.DRONE_KNOWLEDGE_DIR = join(tmpdir(), "drone-acceptance-registry-test");
		const { pi, tools } = stubPi();
		registerPiCore(pi);
		registerKnowledgeInterface(pi, { readOnly: false });
		const taskPlan = tools.get("task_plan");
		expect(taskPlan).toBeTruthy();
		expect(acceptanceOf(taskPlan).properties.kind.enum).not.toContain("zotero_item");

		zoteroLiterature(pi);
		const runtime = createInstalledTaskRuntime();
		bindAcceptanceVerifierEvents(pi.events, runtime);
		pi.events.emit("drone:runtime/v1", { version: 1, runtime });

		const schema = acceptanceOf(taskPlan);
		expect(schema.properties.kind.enum).toEqual(expect.arrayContaining(["wiki_review", "zotero_item"]));
		expect(Object.keys(schema.properties)).toEqual(
			expect.arrayContaining(["doi", "libraryId", "collection"]),
		);
		expect(
			validationError(taskPlan, plan({ kind: "zotero_item", doi: "10.1000/xyz123", collection: "Reading" })),
		).toBeNull();
		expect(describeAcceptance({ kind: "zotero_item", doi: "10.1000/xyz123" })).toContain("10.1000/xyz123");
	});

	it("normalizeAcceptance keeps declared fields only; reset keeps the core schema intact", () => {
		registerAcceptanceVerifier("lab_sample", { fields: ["sampleId"] });
		const clean = (value, max = 512) => (typeof value === "string" ? value.slice(0, max) : null);
		expect(
			normalizeAcceptance(
				{ kind: "lab_sample", sampleId: "S-1", batch: "dropped", path: "out/a.txt" },
				clean,
			),
		).toEqual({ kind: "lab_sample", path: "out/a.txt", sha256: null, sampleId: "S-1" });
		expect(acceptanceVerifier("lab_sample")?.evidenceKind).toBe("lab_sample-verified");

		resetAcceptanceVerifiers();
		expect(acceptanceVerifier("lab_sample")).toBeNull();
		expect(acceptanceKinds()).toEqual(["file", "human_review"]);
		const schema = acceptanceSchema();
		expect(Object.keys(schema.properties)).toEqual(["kind", "path", "sha256", "rootKind"]);
		expect(schema.properties.kind.enum).toBe(schema.properties.kind.enum); // 仍是活引用
	});
});
