import { describe, expect, it } from "vitest";
import { childCausalEnvelope, createCausalEnvelope, runAttemptId } from "./causality";
import { type ContractParentRef, computeResearchContractHash, createRunAttempt } from "./research-contracts";

const caseRef: ContractParentRef = { kind: "research-case", id: "case-1" };

describe("causal lineage", () => {
	it("validates IDs and derives child events without changing the attempt", () => {
		const root = createCausalEnvelope({ eventId: "event:root", runAttemptId: "run:one" });
		const child = childCausalEnvelope(root, { eventId: "event:child" });
		expect(child).toMatchObject({
			eventId: "event:child",
			causationId: "event:root",
			runAttemptId: "run:one",
		});
		expect(() => createCausalEnvelope({ eventId: "bad id" })).toThrow("Event ID is invalid");
		expect(runAttemptId("run:one")).toBe("run:one");
	});

	it("keeps lineage outside the research contract content hash", () => {
		const plain = createRunAttempt({
			id: "attempt-1",
			caseRef,
			status: "queued",
			attempt: 1,
			inputRefs: [],
			outputRefs: [],
		});
		const lined = createRunAttempt({
			...plain,
			lineage: createCausalEnvelope({ eventId: "event:attempt", runAttemptId: "run:one" }),
		});
		expect(lined.contentHash).toBe(plain.contentHash);
		expect(computeResearchContractHash(lined)).toBe(lined.contentHash);
	});

	it("uses parentRefs for a child attempt without inventing a second parent field", () => {
		const parent = createRunAttempt({
			id: "attempt-parent",
			caseRef,
			status: "failed",
			attempt: 1,
			inputRefs: [],
			outputRefs: [],
			finishedAt: "2026-10-14T00:00:00.000Z",
		});
		const child = createRunAttempt({
			id: "attempt-child",
			caseRef,
			status: "queued",
			attempt: 2,
			inputRefs: [],
			outputRefs: [],
			parentRefs: [
				{ kind: parent.kind, id: parent.id, revision: parent.revision, contentHash: parent.contentHash },
			],
		});
		expect(child.parentRefs).toEqual([
			{ kind: "run-attempt", id: "attempt-parent", revision: 0, contentHash: parent.contentHash },
		]);
	});
});
