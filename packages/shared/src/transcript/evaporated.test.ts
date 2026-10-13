import { describe, expect, it } from "vitest";
import { reduceEvent } from "./reducer";
import { emptyTranscript } from "./types";

describe("H4 context_evaporated", () => {
	it("appends one system row and merges consecutive batches", () => {
		let s = reduceEvent(emptyTranscript(), { type: "context_evaporated", count: 2 });
		s = reduceEvent(s, { type: "context_evaporated", count: 3 });
		expect(s.messages).toHaveLength(1);
		expect(s.messages[0]).toMatchObject({ kind: "system", evaporated: { count: 5 } });
		expect(reduceEvent(s, { type: "context_evaporated", count: 0 })).toBe(s);
	});
});
