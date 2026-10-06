import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp/drone-figure-annotations-test" } }));

import { normalizeAnnotations } from "./figure-annotations";

describe("figure annotations", () => {
	it("clamps positions, trims text, drops duplicates and junk", () => {
		const result = normalizeAnnotations([
			{ id: "a", x: 1.4, y: -0.2, text: "x".repeat(3000), createdAt: "t" },
			{ id: "a", x: 0.5, y: 0.5, text: "dup", createdAt: "t" },
			{ x: 0.1, y: 0.1, text: "no id" },
			null,
			{ id: "b", x: 0.25, y: 0.75, text: "legend overlaps", createdAt: "t2" },
		]);
		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({ id: "a", x: 1, y: 0 });
		expect(result[0]?.text).toHaveLength(2000);
		expect(result[1]).toEqual({ id: "b", x: 0.25, y: 0.75, text: "legend overlaps", createdAt: "t2" });
		expect(normalizeAnnotations("nope")).toEqual([]);
	});
});
