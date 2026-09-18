import { knowledgeLinkLabel, knowledgeLinksForDisplay, parseKnowledgeHref } from "@drone/shared";
import { expect, it } from "vitest";

it("turns Vault aliases and Unicode paths into actual display links", () => {
	const result = knowledgeLinksForDisplay("See [[Library/Papers/文献|文章]] and [[Wiki/Topic.md]].");
	expect(result).toContain("[文章](#drone-note=");
	expect(result).not.toContain("[[");
	expect(parseKnowledgeHref(`#drone-note=${encodeURIComponent("Library/Papers/文献.md")}`)).toBe(
		"Library/Papers/文献.md",
	);
});
it("keeps inline and fenced code unchanged", () => {
	const text = "`[[Wiki/No]]`\n\n```text\n[[Wiki/No]]\n```\n[[Wiki/Yes]]";
	const result = knowledgeLinksForDisplay(text);
	expect(result).toContain("`[[Wiki/No]]`");
	expect(result).toContain("```text\n[[Wiki/No]]\n```");
	expect(result).toContain("[Wiki/Yes]");
});
it("does not make unknown, traversal or malformed targets clickable", () => {
	for (const text of ["[[javascript:alert(1)]]", "[[Wiki/../../secret]]", "[[OtherUnknown]]"])
		expect(knowledgeLinksForDisplay(text)).toBe(text);
	expect(parseKnowledgeHref("#drone-note=%ZZ")).toBeNull();
});
// Long slug+hash filenames used to be inlined whole, which broke the reading flow of
// long research answers. The label is shortened; the href keeps the exact path.
it("shortens slug-and-hash filenames without changing the link target", () => {
	const path =
		"Library/Papers/edger-a-bioconductor-package-for-differential-expression-analysi-ec996d3ae6a33ca7";
	const result = knowledgeLinksForDisplay(`See [[${path}]].`);
	expect(result).toContain(`(#drone-note=${encodeURIComponent(`${path}.md`)} "${path}.md")`);
	const label = result.slice(result.indexOf("[") + 1, result.indexOf("]"));
	// The hash stays in the href (it is part of the real path) but leaves the label.
	expect(label).not.toContain("ec996d3ae6a33ca7");
	expect(label.length).toBeLessThanOrEqual(41);
	expect(label.startsWith("edger a bioconductor")).toBe(true);
});
it("keeps short names intact and never cuts mid-word", () => {
	// Short paths keep their folder: it tells the reader what kind of source this is.
	expect(knowledgeLinkLabel("Library/Papers/tergum-nat-commun-2022.md")).toBe(
		"Library/Papers/tergum-nat-commun-2022",
	);
	expect(knowledgeLinkLabel("Wiki/Topic.md")).toBe("Wiki/Topic");
	expect(knowledgeLinkLabel(`Library/Papers/${"x".repeat(80)}.md`)).toMatch(/…$/);
	// Only when the path is long does it fall back to a hash-stripped stem.
	expect(knowledgeLinkLabel(`Library/Papers/${"long-slug-".repeat(5)}name-a1b2c3d4e5f6a7.md`)).not.toContain(
		"a1b2c3d4e5f6a7",
	);
});
// An explicit alias is authored intent and must win over the derived label.
it("prefers an explicit alias over the derived short label", () => {
	const result = knowledgeLinksForDisplay("[[Library/Papers/some-very-long-slug-name|edgeR]]");
	expect(result).toContain("[edgeR](");
});
