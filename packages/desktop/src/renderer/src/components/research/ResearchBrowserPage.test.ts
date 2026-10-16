import { describe, expect, it } from "vitest";
import { filterResearchPaths, normalizeProjectLink } from "./research-browser";

describe("research browser path filtering", () => {
	it("keeps directory entries and matches paths case-insensitively", () => {
		expect(filterResearchPaths(["data/", "data/sample.csv", "README.md"], "SAMPLE")).toEqual([
			"data/sample.csv",
		]);
		expect(filterResearchPaths(["data/", "README.md"], " ")).toEqual(["data/", "README.md"]);
	});

	it("resolves links from the current document while confining them to the project root", () => {
		expect(normalizeProjectLink("../data/result.csv", "/project/docs/readme.md", "/project")).toBe(
			"data/result.csv",
		);
		expect(normalizeProjectLink("../../.env", "/project/docs/readme.md", "/project")).toBeNull();
	});
});
