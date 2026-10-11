import { describe, expect, it } from "vitest";
import {
	buildValidationEvidenceCapsule,
	capabilityReference,
	parseCapabilityReference,
	resolveCapabilityVersion,
	transitionCapabilityRequest,
} from "./capability-discovery";
import {
	createCapabilityRequest,
	createCapabilityValidationGate,
	createCapabilityVersion,
} from "./research-contracts";

const now = "2026-10-12T00:00:00.000Z";
const parent = { kind: "research-case", id: "case-1" };

describe("capability discovery contracts", () => {
	it("requires exact capabilityId@version references", () => {
		expect(parseCapabilityReference("assembly@1.0.0")).toEqual({
			capabilityId: "assembly",
			version: "1.0.0",
		});
		expect(capabilityReference({ capabilityId: "drone/assembly", version: "2026.10" })).toBe(
			"drone/assembly@2026.10",
		);
		expect(() => parseCapabilityReference("assembly")).toThrow(/capabilityId@version/);
		expect(() => parseCapabilityReference("assembly@")).toThrow();
	});

	it("fails closed for unknown and ambiguous registered versions", () => {
		const version = createCapabilityVersion({
			id: "assembly-v1",
			capabilityId: "assembly",
			version: "1.0.0",
			status: "candidate",
			contractHash: "a".repeat(64),
			validationRefs: [],
			createdAt: now,
		});
		expect(resolveCapabilityVersion([version], "assembly@1.0.0")).toBe(version);
		expect(() => resolveCapabilityVersion([], "assembly@1.0.0")).toThrow(/not registered/);
		expect(() =>
			resolveCapabilityVersion([version, { ...version, id: "assembly-v1-copy" }], "assembly@1.0.0"),
		).toThrow(/ambiguous/);
	});

	it("keeps request transitions separate from recommendation and execution", () => {
		const request = createCapabilityRequest({
			id: "request-1",
			caseRef: parent,
			assay: "unknown-assay",
			question: "Can this be analyzed?",
			requirements: [],
			status: "open",
			createdAt: now,
			updatedAt: now,
		});
		const researching = transitionCapabilityRequest(request, "researching", { now });
		const blocked = transitionCapabilityRequest(researching, "blocked", {
			now,
			gapReason: "environment-not-ready",
		});
		expect(blocked.status).toBe("blocked");
		expect(() => transitionCapabilityRequest(request, "resolved", { now })).toThrow(/transition/);
	});

	it("aggregates static, fixture and scientific gates into an evidence capsule", () => {
		const gates = (["static", "fixture", "scientific"] as const).map((validation, index) =>
			createCapabilityValidationGate({
				id: `gate-${validation}`,
				capabilityRef: "assembly@1.0.0",
				validation,
				status: "passed",
				detail: "ok",
				evidenceRefs: [],
				checkedAt: now,
				revision: index,
			}),
		);
		const capsule = buildValidationEvidenceCapsule({
			id: "capsule-1",
			capabilityRef: "assembly@1.0.0",
			gates,
			createdAt: now,
		});
		expect(capsule.status).toBe("validated");
		expect(capsule.gateRefs).toHaveLength(3);
	});
});
