import { describe, expect, it } from "vitest";
import { createSemanticModel } from "../src/semantic-model";

const node = (path: string, title = path, kind = "note", identity?: string) => ({
	path,
	title,
	kind,
	identity,
});

describe("semantic knowledge graph model", () => {
	it("merges Library and Projects paper mirrors while keeping duplicate hints out of degree", () => {
		const model = createSemanticModel({
			nodes: [
				node("Projects/a/Papers/p.md", "Paper", "note", "10.1000/x"),
				node("Library/Papers/p.md", "Paper", "note", "10.1000/x"),
				node("Wiki/topic.md"),
			],
			edges: [{ source: "Wiki/topic.md", target: "Projects/a/Papers/p.md" }],
		});
		expect(model.nodes.map((item) => item.path)).toEqual(["Library/Papers/p.md", "Wiki/topic.md"]);
		expect(model.duplicates).toEqual([
			{ canonical: "Library/Papers/p.md", duplicate: "Projects/a/Papers/p.md" },
		]);
		expect(model.nodes.find((item) => item.path === "Library/Papers/p.md")?.degree).toBe(1);
		expect(model.relations.some((item) => item.type === "duplicate")).toBe(true);
	});

	it("filters infrastructure in semantic view and keeps it in all-files view", () => {
		const input = { nodes: [node("Index.md", "Index", "navigation"), node("Library/a.md")], edges: [] };
		expect(createSemanticModel(input).nodes.map((item) => item.path)).toEqual(["Library/a.md"]);
		expect(createSemanticModel(input, { view: "all" }).nodes.map((item) => item.path)).toEqual([
			"Index.md",
			"Library/a.md",
		]);
	});

	it("is deterministic when input order changes and includes isolated community/layout", () => {
		const a = {
			nodes: [node("b.md"), node("a.md"), node("lonely.md")],
			edges: [{ source: "a.md", target: "b.md" }],
		};
		const first = createSemanticModel(a);
		const second = createSemanticModel({ nodes: [...a.nodes].reverse(), edges: [...a.edges].reverse() });
		expect(first.communities).toEqual(second.communities);
		expect(first.layout).toEqual(second.layout);
		expect(first.nodes.find((item) => item.path === "lonely.md")?.community).toBe(-1);
	});

	it("anchors research questions and places shared evidence between them", () => {
		const model = createSemanticModel({
			nodes: [
				{ ...node("q1.md", "Question one"), contentType: "question" },
				{ ...node("q2.md", "Question two"), contentType: "question" },
				{ ...node("paper.md", "Paper"), contentType: "paper" },
				{ ...node("software.md", "Software"), contentType: "software" },
			],
			edges: [
				{ source: "q1.md", target: "paper.md" },
				{ source: "q2.md", target: "paper.md" },
				{ source: "q1.md", target: "software.md" },
			],
		});
		const q1 = model.nodes.find((item) => item.path === "q1.md");
		const q2 = model.nodes.find((item) => item.path === "q2.md");
		const paper = model.nodes.find((item) => item.path === "paper.md");
		const software = model.nodes.find((item) => item.path === "software.md");
		expect(q1?.isMain).toBe(true);
		expect(q2?.isMain).toBe(true);
		expect(paper?.sharedWith).toEqual(["q1.md", "q2.md"]);
		expect(paper?.x).toBeCloseTo(((q1?.x ?? 0) + (q2?.x ?? 0)) / 2, 0);
		expect(software?.y ?? 0).toBeGreaterThan(q1?.y ?? 0);
	});
});
