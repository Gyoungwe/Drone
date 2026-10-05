import { describe, expect, it } from "vitest";
import { formatCardText } from "./format-card-text";

describe("formatCardText", () => {
	it("keeps paragraphs and expands inline numbered requests", () => {
		expect(formatCardText("请确认：1. 目标范围 2. 输出格式\n3. 截止时间")).toBe(
			"请确认：\n1. 目标范围\n2. 输出格式\n3. 截止时间",
		);
	});

	it("normalizes inline bullets without changing ordinary sentence punctuation", () => {
		expect(formatCardText("选择：• 继续 • 暂停；说明保持在这一行")).toBe(
			"选择：\n• 继续\n• 暂停；说明保持在这一行",
		);
	});

	it("keeps isolated range and section markers inside ordinary sentences", () => {
		expect(formatCardText("样本量取 1 - 5 之间，见第 3. 节")).toBe("样本量取 1 - 5 之间，见第 3. 节");
		expect(formatCardText("Use range 1 - 5 for now")).toBe("Use range 1 - 5 for now");
	});

	it("splits a list marker after a colon", () => {
		expect(formatCardText("下一步：- 读取数据")).toBe("下一步：\n- 读取数据");
	});

	it("requires repeated markers of the same kind for inline lists", () => {
		expect(formatCardText("- 继续 - 暂停")).toBe("- 继续\n- 暂停");
	});
});
