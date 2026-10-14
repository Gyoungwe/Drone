import { describe, expect, it } from "vitest";
import { EvolutionIndex, type EvolutionIndexStore } from "../src/evolution";

const ref = (kind: string, id: string) => ({ kind, id });

describe("EvolutionIndex", () => {
	it("persists proposals and keeps execution blocked until explicit approval", async () => {
		let saved: Awaited<ReturnType<EvolutionIndexStore["read"]>> = { candidates: [], decisions: [] };
		const store: EvolutionIndexStore = {
			read: async () => saved,
			write: async (value) => {
				saved = { candidates: [...value.candidates], decisions: [...value.decisions] };
			},
		};
		const index = new EvolutionIndex(store);
		const candidate = await index.propose({
			id: "evo-1",
			projectRef: ref("research-case", "case-1"),
			runRefs: [ref("run-attempt", "run-1")],
			experienceRefs: [ref("experience", "exp-1"), ref("experience", "exp-2")],
			observationCount: 2,
			proposal: "Reuse the observed workflow",
			createdAt: "2026-10-15T00:00:00.000Z",
		});
		expect(candidate.executionEligible).toBe(false);
		const restored = new EvolutionIndex(store);
		await restored.load();
		expect(restored.getCandidate("evo-1")?.contentHash).toBe(candidate.contentHash);
		const approved = await restored.approveCandidate(
			"evo-1",
			ref("decision", "decision-1"),
			"2026-10-15T01:00:00.000Z",
		);
		expect(approved.executionEligible).toBe(true);
	});

	it("records blocked reuse and refuses approval without eligibility", async () => {
		const index = new EvolutionIndex();
		const blocked = await index.recordReuseDecision({
			id: "reuse-1",
			projectRef: ref("research-case", "case-1"),
			runRef: ref("run-attempt", "run-2"),
			snapshotRef: ref("knowledge-snapshot", "snapshot-1"),
			reusable: false,
			reasons: ["stale source"],
			evaluatedAt: "2026-10-15T00:00:00.000Z",
		});
		expect(blocked.status).toBe("blocked");
		await expect(
			index.approveReuse("reuse-1", ref("decision", "decision-2"), "2026-10-15T01:00:00.000Z"),
		).rejects.toThrow(/eligible reuse/);
	});
});
