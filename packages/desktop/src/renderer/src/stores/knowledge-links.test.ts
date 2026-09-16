import { knowledgeLinksForDisplay, parseKnowledgeHref } from "@drone/shared";
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
