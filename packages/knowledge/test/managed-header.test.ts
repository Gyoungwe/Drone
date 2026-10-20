import { describe, expect, it } from "vitest";
import { proposedWikiText, stripManagedHeader } from "../src/wiki-policy";

describe("stripManagedHeader", () => {
	it("drops a duplicated frontmatter + title from an agent draft", () => {
		const draft =
			"---\ntype: wiki\nstatus: unverified\n---\n\n# Attention Is All You Need\n\n本页是候选综合页。";
		expect(stripManagedHeader(draft, "Attention Is All You Need")).toBe("本页是候选综合页。");
	});

	it("unwraps a ```markdown fence before stripping", () => {
		const draft = "```markdown\n# LoRA\n\n正文\n```";
		expect(stripManagedHeader(draft, "LoRA")).toBe("正文");
	});

	it("keeps a leading heading that is a different section title", () => {
		expect(stripManagedHeader("# LoRA 文献入库运行总结\n\n正文", "lora-2106 · run-1")).toBe(
			"# LoRA 文献入库运行总结\n\n正文",
		);
	});

	it("treats a shortened title as the same heading", () => {
		expect(stripManagedHeader("# 智能体设计原则\n\n正文", "智能体设计原则（Agent Design Principles）")).toBe(
			"正文",
		);
	});
});

describe("proposedWikiText", () => {
	it("writes the page header once for a new page", () => {
		const text = proposedWikiText(null, "LoRA", "---\ntype: wiki\n---\n\n# LoRA\n\n正文");
		expect(text.match(/^# LoRA$/gmu)).toHaveLength(1);
		expect(text.match(/^type: wiki$/gmu)).toHaveLength(1);
		expect(text).toContain("<!-- pi-agent:managed:start -->\n正文\n<!-- pi-agent:managed:end -->");
	});
});
