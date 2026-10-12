import { describe, expect, it } from "vitest";
import {
	contextLevel,
	localDate,
	parseTurnMeta,
	remainingTokens,
	serializeTurnMeta,
	turnContextNote,
} from "./context-meta";

describe("context meta (P16)", () => {
	it("uses the local date, not UTC", () => {
		// 2026-10-12T17:30Z = 10-13 01:30 Asia/Shanghai
		expect(localDate(new Date("2026-10-12T17:30:00Z"), "Asia/Shanghai").date).toBe("2026-10-13");
		expect(localDate(new Date("2026-10-12T17:30:00Z"), "UTC").date).toBe("2026-10-12");
	});
	it("renders the per-turn note", () => {
		const note = turnContextNote({
			usedTokens: 50_000,
			contextWindow: 200_000,
			now: new Date("2026-10-13T02:00:00Z"),
			timeZone: "Asia/Shanghai",
		});
		expect(note).toContain("today 2026-10-13 (Asia/Shanghai)");
		expect(note).toContain("~150000 of 200000 tokens (75%)");
		expect(
			turnContextNote({ usedTokens: null, contextWindow: 200_000, now: new Date(), timeZone: "UTC" }),
		).toContain("unknown");
		expect(remainingTokens(300, 200)).toBe(0);
	});
	it("round-trips turn metadata and drops junk", () => {
		const meta = {
			mode: "lead",
			provider: "anthropic",
			model: "m",
			effort: "high",
			contextTokens: 1200,
			contextWindow: null,
		};
		expect(parseTurnMeta(serializeTurnMeta(meta))).toEqual(meta);
		expect(parseTurnMeta({ model: 3, contextTokens: Number.NaN, effort: "low" })).toEqual({ effort: "low" });
		expect(parseTurnMeta("{bad")).toBeNull();
	});
	it("buckets usage", () => {
		expect([contextLevel(null), contextLevel(10), contextLevel(70), contextLevel(90)]).toEqual([
			"unknown",
			"ok",
			"warn",
			"high",
		]);
	});
});
