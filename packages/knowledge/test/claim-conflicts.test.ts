import { describe, expect, it } from "vitest";
import { compareClaims, type KnowledgeClaim } from "../src/index";

const claim = (overrides: Partial<KnowledgeClaim> = {}): KnowledgeClaim => ({
	claim: "Wg activates wing-margin growth",
	subject: "Wg",
	predicate: "activates",
	value: "wing-margin growth",
	organism: "Drosophila melanogaster",
	tissue: "wing disc",
	stage: "third instar",
	method: "RNAi",
	relation: "observation",
	...overrides,
});

describe("structured knowledge claim comparison", () => {
	it("only calls same-condition opposite observations a blocking contradiction", () => {
		const result = compareClaims(
			claim(),
			claim({
				claim: "Wg does not activate wing-margin growth",
				value: "does not activate wing-margin growth",
			}),
		);
		expect(result).toMatchObject({ relation: "contradicts", confidence: "high", blocking: true });
	});

	it("treats different stages as refinement or unresolved, never as a contradiction", () => {
		const result = compareClaims(claim(), claim({ stage: "pupal" }));
		expect(result.relation).toBe("unresolved");
		expect(result.blocking).toBe(false);
	});

	it("keeps interpretation versus observation separate", () => {
		const result = compareClaims(
			claim(),
			claim({ relation: "interpretation", claim: "Wg may activate wing-margin growth" }),
		);
		expect(result.relation).toBe("unresolved");
		expect(result.blocking).toBe(false);
	});

	it("preserves legacy claim equivalence when case folding introduces a combining mark", () => {
		const result = compareClaims(
			claim({ subject: "İ" }),
			claim({ subject: "i", value: "does not activate wing-margin growth" }),
		);
		expect(result).toEqual({
			relation: "contradicts",
			confidence: "high",
			reason: "同一对象、同一条件、同一观察命题的方向相反。",
			blocking: true,
		});
	});
});
