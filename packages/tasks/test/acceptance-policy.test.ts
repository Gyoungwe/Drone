import { describe, expect, it } from "vitest";
import {
	acceptanceKinds,
	acceptanceSchema,
	acceptanceVerifier,
	CORE_ACCEPTANCE_KINDS,
	createAcceptanceRegistry,
	describeAcceptance,
	effectiveAcceptance,
	normalizeAcceptance,
	registerAcceptanceVerifier,
	resetAcceptanceVerifiers,
} from "../src/acceptance-policy";

const clean = (value: unknown, max = 512): string | null =>
	typeof value === "string" ? value.slice(0, max) : null;

describe("task acceptance policy", () => {
	it("starts with host-owned acceptance kinds and a live schema", () => {
		const registry = createAcceptanceRegistry();
		const schema = acceptanceSchema(registry);
		expect(acceptanceKinds(registry)).toEqual([...CORE_ACCEPTANCE_KINDS]);
		expect(schema.properties.kind?.enum).toEqual([...CORE_ACCEPTANCE_KINDS]);
		expect(Object.keys(schema.properties)).toEqual(["kind", "path", "sha256"]);

		registerAcceptanceVerifier(registry, "lab_sample", { fields: ["sampleId", "batch"] });
		expect(schema.properties.kind?.enum).toContain("lab_sample");
		expect(Object.keys(schema.properties)).toEqual(
			expect.arrayContaining(["kind", "path", "sha256", "sampleId", "batch"]),
		);
	});

	it("rejects host-owned kinds, malformed kinds and reserved fields", () => {
		const registry = createAcceptanceRegistry();
		expect(() => registerAcceptanceVerifier(registry, "file")).toThrow(/owned by the host/);
		expect(() => registerAcceptanceVerifier(registry, "Bad-Kind")).toThrow(/must match/);
		expect(() => registerAcceptanceVerifier(registry, "sample_kind", { fields: ["path"] })).toThrow(
			/invalid field "path"/,
		);
		expect(() => registerAcceptanceVerifier(registry, "sample_kind", { verify: "nope" as never })).toThrow(
			/must be a function/,
		);
	});

	it("normalizes declared fields and discards undeclared input", () => {
		const registry = createAcceptanceRegistry();
		registerAcceptanceVerifier(registry, "lab_sample", { fields: ["sampleId"] });
		expect(
			normalizeAcceptance(
				registry,
				{ kind: "lab_sample", sampleId: "S-1", batch: "dropped", path: "out/a.txt", sha256: "bad" },
				clean,
			),
		).toEqual({ kind: "lab_sample", path: "out/a.txt", sha256: null, sampleId: "S-1" });
	});

	it("keeps approved acceptance immutable when host binds identity fields", () => {
		const milestone = {
			acceptance: { kind: "lab_sample", sampleId: "planned" },
			bound: { fields: { sampleId: "observed" } },
		};
		expect(effectiveAcceptance(milestone)).toEqual({ kind: "lab_sample", sampleId: "observed" });
		expect(milestone.acceptance.sampleId).toBe("planned");
	});

	it("uses verifier labels and falls back safely when a label throws", () => {
		const registry = createAcceptanceRegistry();
		registerAcceptanceVerifier(registry, "lab_sample", {
			label: (acceptance) => `样本 ${acceptance.sampleId}`,
		});
		expect(describeAcceptance(registry, { kind: "lab_sample", sampleId: "S-1" })).toBe("样本 S-1");
		registerAcceptanceVerifier(registry, "broken_kind", {
			label: () => {
				throw new Error("broken");
			},
		});
		expect(describeAcceptance(registry, { kind: "broken_kind" })).toBe("broken_kind");
		expect(describeAcceptance(registry, { kind: "file", path: "out/a.txt" })).toBe("生成文件 out/a.txt");
	});

	it("resets extension entries while preserving the registry schema object", () => {
		const registry = createAcceptanceRegistry();
		const schema = acceptanceSchema(registry);
		registerAcceptanceVerifier(registry, "lab_sample", { fields: ["sampleId"] });
		resetAcceptanceVerifiers(registry);
		expect(acceptanceVerifier(registry, "lab_sample")).toBeNull();
		expect(acceptanceKinds(registry)).toEqual([...CORE_ACCEPTANCE_KINDS]);
		expect(Object.keys(schema.properties)).toEqual(["kind", "path", "sha256"]);
		expect(schema.properties.kind?.enum).toEqual([...CORE_ACCEPTANCE_KINDS]);
	});
});
