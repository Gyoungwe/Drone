import type { KnowledgeGraph } from "@drone/shared";
import { describe, expect, it } from "vitest";
import {
	classifyKnowledgeHit,
	classifyKnowledgePath,
	classifyRecentKnowledgeNote,
	deriveKnowledgeCategoryCounts,
} from "./knowledge-home-model";

const graph: KnowledgeGraph = {
	nodes: [
		{ path: "Papers/a.md", title: "A", kind: "note", degree: 1 },
		{ path: "Methods/b.md", title: "B", kind: "note", degree: 1 },
		{ path: "Software/c.md", title: "C", kind: "note", degree: 0 },
		{ path: "Ideas/d.md", title: "D", kind: "note", degree: 0 },
	],
	edges: [],
	totalNotes: 4,
	health: { isolated: 2, duplicates: 0, infrastructure: 0 },
};

describe("knowledge home category projections", () => {
	it("classifies only path/frontmatter vocabulary and preserves unknowns", () => {
		expect(classifyKnowledgePath("Papers/one.md")).toBe("paper");
		expect(classifyKnowledgePath("Methods/one.md")).toBe("method");
		expect(classifyKnowledgePath("notes/one.md")).toBe("other");
		expect(classifyKnowledgeHit("software", "notes/one.md")).toBe("software");
	});

	it("derives category counts only from a complete graph", () => {
		expect(deriveKnowledgeCategoryCounts(graph, 4)).toEqual({
			all: 4,
			paper: 1,
			software: 1,
			method: 1,
			idea: 1,
		});
		expect(
			deriveKnowledgeCategoryCounts(
				{
					...graph,
					health: {
						isolated: graph.health?.isolated ?? 0,
						duplicates: graph.health?.duplicates ?? 0,
						infrastructure: graph.health?.infrastructure ?? 0,
						truncated: true,
					},
				},
				4,
			),
		).toEqual({ all: 4, paper: null, software: null, method: null, idea: null });
	});
});

it("does not let filename keywords override a category folder or explicit type", () => {
	expect(classifyKnowledgePath("Library/Methods/mapping-tools.md")).toBe("method");
	expect(classifyKnowledgePath("Library/Software/paper-protocol.md")).toBe("software");
	expect(classifyKnowledgeHit("method", "Library/Software/paper-tools.md")).toBe("method");
	expect(classifyKnowledgeHit("concept", "Library/Methods/mapping-tools.md")).toBe("other");
});

it("uses the observed category for recent labels even when the path suggests another category", () => {
	const path = "Library/Software/paper-tools.md";
	const groups = { method: [{ path, title: "Mapping tools", kind: "note" as const, updatedAt: 1 }] };
	expect(classifyRecentKnowledgeNote(path, groups)).toBe("method");
	expect(classifyRecentKnowledgeNote("Library/Methods/mapping-tools.md", {})).toBe("other");
});
