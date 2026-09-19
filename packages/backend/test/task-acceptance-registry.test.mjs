import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import zoteroLiterature from "../../../.pi/extensions/zotero-literature.mjs";
import { registerKnowledgeInterface } from "../../../.pi/lib/knowledge/extension.mjs";
import {
	acceptanceKinds,
	acceptanceSchema,
	acceptanceVerifier,
	CORE_ACCEPTANCE_KINDS,
	describeAcceptance,
	normalizeAcceptance,
	registerAcceptanceVerifier,
	resetAcceptanceVerifiers,
} from "../../../.pi/lib/tasks/acceptance.mjs";
import { registerTaskRuntime } from "../../../.pi/lib/tasks/runtime.mjs";

/** 只捕获 registerTool、其余 API 全部 no-op 的 pi 桩。 */
function stubPi(tools = new Map()) {
	const base = {
		registerTool: (tool) => tools.set(tool.name, tool),
		getCommands: () => [],
		events: { on() {}, emit: async () => {} },
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
	it("rejects host-owned kinds, malformed kinds and reserved field names", () => {
		expect(() => registerAcceptanceVerifier("file")).toThrow(/owned by the host/);
		expect(() => registerAcceptanceVerifier("Bad-Kind")).toThrow(/must match/);
		expect(() => registerAcceptanceVerifier("x_kind", { fields: ["path"] })).toThrow(/invalid field "path"/);
		expect(() => registerAcceptanceVerifier("x_kind", { fields: ["kind"] })).toThrow(/invalid field "kind"/);
		expect(() => registerAcceptanceVerifier("x_kind", { fields: ["sha256"] })).toThrow(
			/invalid field "sha256"/,
		);
		expect(() => registerAcceptanceVerifier("x_kind", { verify: "nope" })).toThrow(/must be a function/);
		expect(acceptanceKinds()).toEqual([...CORE_ACCEPTANCE_KINDS]);
	});

	it("schema captured before registration sees kinds AND fields registered later (model view + pi validation)", () => {
		const { pi, tools } = stubPi();
		registerTaskRuntime(pi); // task_plan 先注册，schema 对象此刻已经创建
		const taskPlan = tools.get("task_plan");
		expect(taskPlan).toBeTruthy();
		expect(acceptanceOf(taskPlan).properties.kind.enum).toEqual(["file", "human_review"]);
		expect(Object.keys(acceptanceOf(taskPlan).properties)).toEqual(["kind", "path", "sha256"]);

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
		registerKnowledgeInterface(pi, { readOnly: false }); // → registerTaskRuntime → task_plan
		const taskPlan = tools.get("task_plan");
		expect(taskPlan).toBeTruthy();
		expect(acceptanceOf(taskPlan).properties.kind.enum).not.toContain("zotero_item");

		zoteroLiterature(stubPi().pi); // → registerZoteroAcceptance()

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
		expect(Object.keys(schema.properties)).toEqual(["kind", "path", "sha256"]);
		expect(schema.properties.kind.enum).toBe(schema.properties.kind.enum); // 仍是活引用
	});
});
