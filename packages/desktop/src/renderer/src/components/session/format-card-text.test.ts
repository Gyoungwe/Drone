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
});
