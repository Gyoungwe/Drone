import { discoveryPrompt } from "@drone/extensions/internal/discovery-prompt";
import { describe, expect, it } from "vitest";

describe("/发现 discovery prompt", () => {
	it("diverges, self-critiques on novelty/basis/testability, keeps at most 3 and offers to save ideas", () => {
		const prompt = discoveryPrompt("蚜虫翅型分化");
		expect(prompt).toContain("蚜虫翅型分化");
		expect(prompt).toContain("search the local Vault first");
		expect(prompt).toMatch(/Novelty.*Basis.*Testability/s);
		expect(prompt).toContain("independent critic subagent");
		expect(prompt).toContain("at most 3 ideas");
		expect(prompt).toContain('type "idea"');
		expect(prompt).toContain("ask_user");
	});
	it("falls back to the current conversation when no topic is given", () => {
		expect(discoveryPrompt("  ")).toContain("current conversation topic");
	});
});
