import { describe, expect, it } from "vitest";
import { knowledgeLineDiff } from "./line-diff";

describe("bounded knowledge diff", () => {
	it("identical text stays unchanged", () =>
		expect(knowledgeLineDiff("a\nb", "a\nb").every((row) => row.kind === "same")).toBe(true));
	it("new notes preserve all proposed lines", () =>
		expect(knowledgeLineDiff("", "a\nb").map((row) => row.kind)).toEqual(["add", "add"]));
	it("removals retain original line references", () =>
		expect(knowledgeLineDiff("a\nb", "a")).toEqual([
			{ kind: "same", text: "a", oldLine: 1, newLine: 1 },
			{ kind: "remove", text: "b", oldLine: 2 },
		]));
	it("replacements preserve prefix, suffix and both versions", () => {
		const rows = knowledgeLineDiff("first\nold\nlast", "first\nnew\nlast");
		expect(rows.map((row) => row.kind)).toEqual(["same", "remove", "add", "same"]);
		expect(
			rows
				.filter((row) => row.kind !== "add")
				.map((row) => row.text)
				.join("\n"),
		).toBe("first\nold\nlast");
		expect(
			rows
				.filter((row) => row.kind !== "remove")
				.map((row) => row.text)
				.join("\n"),
		).toBe("first\nnew\nlast");
	});
	it("markup is returned as text, never executable HTML", () =>
		expect(knowledgeLineDiff("", "<img onerror=evil()>")[0]?.text).toBe("<img onerror=evil()>"));
	it("large disjoint updates allocate a linear number of rows", () => {
		const a = Array(3000).fill("old").join("\n"),
			b = Array(3000).fill("new").join("\n");
		expect(knowledgeLineDiff(a, b)).toHaveLength(6000);
	});
});
