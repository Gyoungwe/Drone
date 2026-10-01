import { describe, expect, it } from "vitest";
import { advisoryLine, knowledgeFailure, publicationNotice } from "../src/publication-policy";

describe("knowledge publication policy", () => {
	it("classifies bounded failure codes and paths without exposing arbitrary error text", () => {
		const result = knowledgeFailure({
			code: "source-changed",
			paths: ["Wiki/Topic.md", "bad\npath", "<unsafe>"],
		});
		expect(result).toEqual({
			code: "source-changed",
			message: "引用内容在阅读后发生了变化，请读取新版本并重新检索。",
			paths: ["Wiki/Topic.md"],
		});
	});

	it("maps changed-navigation errors to a stable publication code", () => {
		expect(knowledgeFailure(new Error("Navigation changed; call prepare again"))).toMatchObject({
			code: "navigation-changed",
			message: "本轮导航已失效，请重新读取导航并完成检索。",
		});
	});

	it("renders verification counts in nonblocking advisories", () => {
		expect(
			advisoryLine("citation-budget", {
				verified: {
					citationCount: 8,
					citationLimit: 6,
					sources: ["a"],
					deliveries: ["b"],
					unverifiedCitationCount: 2,
				},
			}),
		).toContain("引用了 8 处来源");
		expect(advisoryLine("source-unread")).toBe(
			"这份回答引用了本轮没有实际打开过的条目，该引用未被核验。内容已保留。",
		);
	});

	it("falls back to a safe check-failed notice for unknown codes", () => {
		expect(publicationNotice("unknown-code")).toBe("回答前检查发生错误，草稿没有发布。");
	});
});
