import { describe, expect, it } from "vitest";
import { filterResearchPaths } from "./research-browser";

describe("research browser path filtering", () => {
	it("keeps directory entries and matches paths case-insensitively", () => {
		expect(filterResearchPaths(["data/", "data/sample.csv", "README.md"], "SAMPLE")).toEqual([
			"data/sample.csv",
		]);
		expect(filterResearchPaths(["data/", "README.md"], " ")).toEqual(["data/", "README.md"]);
	});
});
