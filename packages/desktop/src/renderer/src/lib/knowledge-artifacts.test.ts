import type { KnowledgeFlowCard } from "@drone/shared";
import { expect, it } from "vitest";
import { mergeKnowledgeArtifacts } from "./knowledge-artifacts";

it("keeps knowledge receipts independent of task journal records", () => {
	expect(mergeKnowledgeArtifacts([])).toEqual([]);
});
it("deduplicates only actual receipt paths within the session workspace", () => {
	const card: KnowledgeFlowCard = {
		key: "one",
		kind: "artifact",
		title: "Report",
		path: "results/report.md",
		status: "saved",
		detail: "Receipt",
		at: 1,
	};
	expect(
		mergeKnowledgeArtifacts(
			[card, { ...card, key: "two", path: "C:/PROJECT/results/report.md" }],
			"C:/project",
		),
	).toHaveLength(1);
	expect(mergeKnowledgeArtifacts([{ ...card, path: undefined }])).toEqual([]);
});
