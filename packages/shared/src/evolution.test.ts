import { describe, expect, it } from "vitest";
import {
	approveEvolutionCandidate,
	approveKnowledgeReuse,
	createEvolutionCandidate,
	createKnowledgeReuseDecision,
	revokeEvolutionCandidate,
	revokeKnowledgeReuse,
	supersedeEvolutionCandidate,
} from "./evolution";

const ref = (kind: string, id: string) => ({ kind, id });
const base = () =>
	createEvolutionCandidate({
		id: "evo-1",
		projectRef: ref("research-case", "case-1"),
		runRefs: [ref("run-attempt", "run-1")],
		experienceRefs: [ref("experience", "exp-1"), ref("experience", "exp-2")],
		observationCount: 2,
		proposal: "Reuse the verified workflow contract",
		createdAt: "2026-10-15T00:00:00.000Z",
	});

describe("evidence-gated evolution contracts", () => {
	it("requires repeated observations and stays non-executable before approval", () => {
		expect(() =>
			createEvolutionCandidate({
				id: "evo-1",
				projectRef: ref("research-case", "case-1"),
				runRefs: [ref("run-attempt", "run-1")],
				experienceRefs: [ref("experience", "exp-1")],
				observationCount: 1,
				proposal: "unsafe",
				createdAt: "2026-10-15T00:00:00.000Z",
			}),
		).toThrow(/repeated observations/);
		expect(() =>
			createEvolutionCandidate({
				id: "evo-2",
				projectRef: ref("research-case", "case-1"),
				runRefs: [ref("run-attempt", "run-1")],
				experienceRefs: [ref("experience", "exp-1")],
				observationCount: 2,
				proposal: "incomplete lineage",
				createdAt: "2026-10-15T00:00:00.000Z",
			}),
		).toThrow(/lineage must cover/);
		expect(base().executionEligible).toBe(false);
	});

	it("requires explicit human approval before executable evolution", () => {
		const approved = approveEvolutionCandidate(
			base(),
			ref("decision", "decision-1"),
			"2026-10-15T01:00:00.000Z",
		);
		expect(approved.status).toBe("approved");
		expect(approved.executionEligible).toBe(true);
		expect(approved.parentRefs).toHaveLength(2);
	});

	it("preserves supersede and revoke lineage and disables reuse", () => {
		const superseded = supersedeEvolutionCandidate(
			base(),
			ref("evolution-candidate", "evo-2"),
			"2026-10-15T01:00:00.000Z",
		);
		expect(superseded.status).toBe("superseded");
		expect(superseded.executionEligible).toBe(false);
		const revoked = revokeEvolutionCandidate(
			base(),
			ref("decision", "decision-2"),
			"review required",
			"2026-10-15T02:00:00.000Z",
		);
		expect(revoked.status).toBe("revoked");
		expect(revoked.executionEligible).toBe(false);
	});

	it("separates reuse eligibility from approval and supports revocation", () => {
		const decision = createKnowledgeReuseDecision({
			id: "reuse-1",
			projectRef: ref("research-case", "case-1"),
			runRef: ref("run-attempt", "run-2"),
			snapshotRef: ref("knowledge-snapshot", "snapshot-1"),
			reusable: true,
			reasons: [],
			evaluatedAt: "2026-10-15T00:00:00.000Z",
		});
		expect(decision.status).toBe("eligible");
		expect(decision.executionEligible).toBe(false);
		const approved = approveKnowledgeReuse(
			decision,
			ref("decision", "decision-3"),
			"2026-10-15T01:00:00.000Z",
		);
		expect(approved.executionEligible).toBe(true);
		const revoked = revokeKnowledgeReuse(approved, ref("decision", "decision-4"), "2026-10-15T02:00:00.000Z");
		expect(revoked.status).toBe("revoked");
		expect(revoked.executionEligible).toBe(false);
	});
});
