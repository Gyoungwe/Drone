import { describe, expect, it } from "vitest";
import { approveEvolutionCandidate, createEvolutionCandidate } from "./evolution";
import { createCapabilityValidationGate } from "./research-contracts";
import {
	compareCapabilityVersions,
	createCapabilityMatrixEntry,
	createValidationPromotionRecord,
	materializeApprovedEvolutionCandidate,
	projectCapabilityMatrixEntry,
	resolveCapabilityMatrixEntry,
	retireCapabilityVersion,
} from "./v2-closure";

const now = "2026-10-15T00:00:00.000Z";
const hash = "a".repeat(64);
const parent = (kind: string, id: string) => ({ kind, id, revision: 0, contentHash: hash });

function gate(id: string, validation: "static" | "fixture" | "scientific") {
	return createCapabilityValidationGate({
		id,
		capabilityRef: "analysis@1.2.3",
		validation,
		status: "passed",
		detail: "pass",
		evidenceRefs: [parent("artifact", `${id}-artifact`)],
		checkedAt: now,
	});
}

describe("v2 closure contracts", () => {
	it("keeps a complete capability matrix row addressable by exact version", () => {
		const entry = createCapabilityMatrixEntry({
			id: "matrix-analysis-123",
			capabilityId: "analysis",
			version: "1.2.3",
			inputRange: {
				assays: ["bulk-rnaseq"],
				formats: ["fastq"],
				references: ["Drosophila r109"],
				sampleCount: { min: 2 },
			},
			validationGates: [parent("gate", "static")],
			applicability: {
				assays: ["bulk-rnaseq"],
				dataScopes: ["public"],
				references: ["Drosophila r109"],
				methods: ["salmon"],
			},
			evidenceRefs: [parent("capsule", "capsule-1")],
			invalidationConditions: ["reference changes", "environment probe expires"],
			status: "registered",
			evidenceState: "verified",
			validationScope: "scientific-review",
			freshness: "fresh",
			updatedAt: now,
		});
		expect(resolveCapabilityMatrixEntry([entry], "analysis@1.2.3").capabilityRef).toBe("analysis@1.2.3");
		expect(() => resolveCapabilityMatrixEntry([entry], "analysis")).toThrow(/capabilityId@version/);
		expect(projectCapabilityMatrixEntry(entry).canReuse).toBe(true);
	});

	it("does not promote fixture lineage into scientific evidence", () => {
		const record = createValidationPromotionRecord({
			id: "promotion-fixture",
			capabilityRef: "analysis@1.2.3",
			researchCaseRef: parent("research-case", "case-1"),
			runAttemptRef: parent("run-attempt", "run-1"),
			artifactRefs: [parent("artifact", "artifact-1")],
			knowledgeRefs: [parent("knowledge-snapshot", "knowledge-1")],
			experienceRefs: [parent("experience", "experience-1")],
			validationGates: [gate("static", "static"), gate("fixture", "fixture")],
			runStatus: "succeeded",
			createdAt: now,
		});
		expect(record.validationScope).toBe("integration");
		expect(record.scientificallyVerified).toBe(false);
		expect(record.claimState).toBe("inferred");
	});

	it("requires explicit approval before materializing and supports retirement/comparison", () => {
		const candidate = createEvolutionCandidate({
			id: "evolution-1",
			projectRef: parent("project", "project-1"),
			runRefs: [parent("run-attempt", "run-1")],
			experienceRefs: [parent("experience", "exp-1"), parent("experience", "exp-2")],
			observationCount: 2,
			proposal: "Use the public Pasilla adapter",
			createdAt: now,
		});
		expect(() =>
			materializeApprovedEvolutionCandidate({
				candidate,
				capabilityId: "analysis",
				version: "1.0.0",
				contractHash: hash,
				validationRefs: [],
				createdAt: now,
			}),
		).toThrow(/approved/);
		const approved = approveEvolutionCandidate(candidate, parent("approval", "approval-1"), now);
		const version = materializeApprovedEvolutionCandidate({
			candidate: approved,
			capabilityId: "analysis",
			version: "1.0.0",
			contractHash: hash,
			validationRefs: [parent("capsule", "capsule-1")],
			createdAt: now,
		});
		const retired = retireCapabilityVersion(version, {
			reason: "superseded",
			byRef: parent("decision", "decision-1"),
			retiredAt: now,
		});
		expect(retired.status).toBe("retired");
		expect(compareCapabilityVersions(version, retired).recommended).toBe("right");
	});
});
