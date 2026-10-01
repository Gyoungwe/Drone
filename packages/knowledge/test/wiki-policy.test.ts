import { describe, expect, it } from "vitest";
import {
	immutableWikiProposalHash,
	managedParts,
	proposedWikiText,
	targetWikiPath,
	validateSpecialistHtml,
	validateWikiSourcePaths,
} from "../src/wiki-policy";

describe("wiki policy", () => {
	it("accepts only static bounded specialist explainers", () => {
		expect(
			validateSpecialistHtml('<html><body><img src="data:image/png;base64,AA=="></body></html>'),
		).toContain("<body>");
		expect(() => validateSpecialistHtml("<html><body><script>alert(1)</script></body></html>")).toThrow(
			"active",
		);
		expect(() =>
			validateSpecialistHtml('<html><body><img src="https://example.com/a.png"></body></html>'),
		).toThrow("external");
	});

	it("requires existing Vault-relative source notes", () => {
		expect(() => validateWikiSourcePaths(["Library/Papers/source.md"])).not.toThrow();
		expect(() => validateWikiSourcePaths([])).toThrow("1–12");
		expect(() => validateWikiSourcePaths(["../source.md"])).toThrow("source_paths[0]");
		expect(() => validateWikiSourcePaths(["https://example.com/source.md"])).toThrow("source_paths[0]");
	});

	it("limits targets to one shared or current-project Wiki note", () => {
		expect(targetWikiPath("Wiki/Autotomy.md", "alpha")).toBe("Wiki/Autotomy.md");
		expect(targetWikiPath("Projects/alpha/Wiki/Autotomy.md", "alpha")).toContain("Projects/alpha");
		expect(() => targetWikiPath("Wiki/Index.md", "alpha")).toThrow("navigation");
		expect(() => targetWikiPath("Projects/beta/Wiki/Autotomy.md", "alpha")).toThrow("navigation");
	});

	it("preserves human text while replacing one managed block", () => {
		const original =
			"# Title\n\nHuman paragraph.\n\n<!-- pi-agent:managed:start -->\nold\n<!-- pi-agent:managed:end -->\n";
		const updated = proposedWikiText(original, "Title", "new");
		expect(updated).toContain("Human paragraph.");
		expect(updated).toContain("<!-- pi-agent:managed:start -->\nnew\n<!-- pi-agent:managed:end -->");
		expect(managedParts(updated).body).toBe("new");
		expect(() => managedParts("<!-- pi-agent:managed:start -->\nonly one")).toThrow("markers");
	});

	it("hashes proposal identity and content deterministically", () => {
		const proposal = {
			id: "id",
			vaultId: "vault",
			bindingRevision: 1,
			project: "alpha",
			path: "Wiki/Autotomy.md",
			title: "Autotomy",
			rationale: "new evidence",
			createdAt: 1,
			before: null,
			after: "new",
			sources: [{ path: "Library/Papers/a.md" }],
		};
		expect(immutableWikiProposalHash(proposal)).toBe(immutableWikiProposalHash({ ...proposal }));
		expect(immutableWikiProposalHash({ ...proposal, after: "changed" })).not.toBe(
			immutableWikiProposalHash(proposal),
		);
	});
});
