import { describe, expect, it } from "vitest";
import { remainingExplanation } from "../src/remaining";

describe("remaining task explanation", () => {
	it("keeps incomplete file work grounded in host observations", () => {
		const task = {
			milestones: [
				{ id: "report", title: "报告", state: "pending", acceptance: { kind: "file", path: "report.md" } },
			],
		};
		const before = structuredClone(task);
		const report = remainingExplanation(task);
		expect(report).toContain("已验收 0/1");
		expect(report).toContain("不能据此断言文件不存在");
		expect(report).toContain("report.md");
		expect(task).toEqual(before);
	});

	it("supports extension pending hints without coupling to the registry", () => {
		const report = remainingExplanation(
			{
				milestones: [{ id: "paper", title: "文献入库", acceptance: { kind: "zotero_item" } }],
			},
			{
				acceptanceVerifier: (kind) =>
					kind === "zotero_item"
						? { pending: () => ({ reason: "还没有读回文献", next: "先核对 Zotero" }) }
						: null,
			},
		);
		expect(report).toContain("还没有读回文献");
		expect(report).toContain("先核对 Zotero");
	});

	it("reports pending actions, uncertain effects, and extra returned operations", () => {
		const report = remainingExplanation({
			milestones: [
				{ id: "done", title: "报告", state: "completed", acceptance: { kind: "file", path: "report.md" } },
			],
			actions: [{ title: "确认来源", reason: "等待审阅", state: "pending", milestoneId: "other" }],
			operations: [{ state: "returned" }, { state: "unknown" }],
		});
		expect(report).toContain("有操作上次没等到结果");
		expect(report).toContain("需要你：确认来源；等待审阅");
		expect(report).toContain("1 步命令/外部操作只有返回记录");
	});
});
