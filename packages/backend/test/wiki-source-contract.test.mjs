import { expect, it } from "vitest";
import { stageWikiProposal, validateWikiSourcePaths } from "../../../.pi/lib/knowledge/wiki-review.mjs";

it.each(["results/run/paper.pdf", "https://example.org/paper", "../outside.md", "C:\\outside.md"])(
	"reports the source field before trying any binding or write: %s",
	async (source) => {
		await expect(
			stageWikiProposal(null, null, null, { path: "Wiki/valid.md", source_paths: [source] }),
		).rejects.toMatchObject({ code: "source-note-required", field: "source_paths[0]", retryable: false });
	},
);
it("accepts generic source notes for data, methods and software as well as papers", () => {
	expect(() =>
		validateWikiSourcePaths(["Library/Methods/statistics.md", "Projects/analysis/Methods/environment.md"]),
	).not.toThrow();
});
