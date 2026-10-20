import { describe, expect, it } from "vitest";
import { mentionedWikiTitle } from "../src/topic-probe";

describe("mentionedWikiTitle", () => {
	it("matches a distinctive Latin token from the page title", () => {
		expect(mentionedWikiTitle("LoRA 的秩一般怎么选？", ["lora-low-rank-adaptation"])).toBe(
			"lora-low-rank-adaptation",
		);
		expect(mentionedWikiTitle("SpCas9 的 PAM 在哪一侧", ["SpCas9 PAM recognition"])).toBe(
			"SpCas9 PAM recognition",
		);
	});
	it("matches a whole CJK title", () => {
		expect(mentionedWikiTitle("帮我进行一个转录组分析", ["转录组分析"])).toBe("转录组分析");
	});
	it("ignores ordinary chat and stop words", () => {
		expect(mentionedWikiTitle("你好", ["lora-low-rank-adaptation"])).toBeNull();
		expect(mentionedWikiTitle("what should I cook with this", ["what-is-attention"])).toBeNull();
		expect(mentionedWikiTitle("帮我写一封邮件", ["attention-is-all-you-need"])).toBeNull();
	});
});
