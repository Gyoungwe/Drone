import { describe, expect, it } from "vitest";
import { compareClaims } from "../../../.pi/lib/knowledge/claim-conflicts.mjs";

const claim = (overrides = {}) => ({
	claim: "Wg activates wing-margin growth",
	subject: "Wg",
	predicate: "activates",
	value: "wing-margin growth",
	organism: "Drosophila melanogaster",
	tissue: "wing disc",
	stage: "third instar",
	method: "RNAi",
	sourcePath: "Library/Papers/a.md",
	sourceHash: "a".repeat(64),
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
});
