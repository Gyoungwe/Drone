import { describe, expect, it } from "vitest";
import {
	avatarStateForPanelStatus,
	avatarStateForRunUi,
	SUBAGENT_HUES,
	subagentAvatarClassName,
	subagentHue,
	subagentSourceBadge,
} from "./subagent-avatar";

describe("subagent avatar · 哈希定色", () => {
	it("同名任何时刻同色，且落在 8 色板内", () => {
		for (const name of ["scout", "lit-reviewer", "data-checker", "wiki-curator", "", "中文名"]) {
			const hue = subagentHue(name);
			expect(hue).toBe(subagentHue(name));
			expect(hue).toBeGreaterThanOrEqual(0);
			expect(hue).toBeLessThan(SUBAGENT_HUES);
			expect(Number.isInteger(hue)).toBe(true);
		}
	});

	it("djb2 参考值固定（改哈希算法会让已有用户的头像换色，必须显式决定）", () => {
		expect(subagentHue("scout")).toBe(3);
		expect(subagentHue("lit-reviewer")).toBe(4);
		expect(subagentHue("data-checker")).toBe(1);
		expect(subagentHue("wiki-curator")).toBe(2);
	});

	it("class 名 = 基类 + 尺寸 + 色槽（+ 额外 class）", () => {
		expect(subagentAvatarClassName("scout", "lg")).toBe("sa-av lg h3");
		expect(subagentAvatarClassName("scout", "sm", "mt-0.5")).toBe("sa-av sm h3 mt-0.5");
	});
});

describe("subagent avatar · 状态映射", () => {
	it("面板状态 → 表情：排队 / 运行 / 等待（审批或回复）/ 完成 / 失败 / 中止", () => {
		expect(avatarStateForPanelStatus("queued")).toBe("queued");
		expect(avatarStateForPanelStatus("running")).toBe("running");
		expect(avatarStateForPanelStatus("needs_reply")).toBe("waiting");
		expect(avatarStateForPanelStatus("waiting_approval")).toBe("waiting");
		expect(avatarStateForPanelStatus("done")).toBe("done");
		expect(avatarStateForPanelStatus("error")).toBe("error");
		expect(avatarStateForPanelStatus("aborted")).toBe("aborted");
	});

	it("模型调用的运行卡：running / done / error；有待回复的上级请求时抬眼", () => {
		expect(avatarStateForRunUi("running")).toBe("running");
		expect(avatarStateForRunUi("running", { expectsReply: true })).toBe("waiting");
		expect(avatarStateForRunUi("done")).toBe("done");
		expect(avatarStateForRunUi("error")).toBe("error");
	});

	it("来源角标 D / U / P", () => {
		expect(subagentSourceBadge("builtin")).toBe("D");
		expect(subagentSourceBadge(undefined)).toBe("D");
		expect(subagentSourceBadge("user")).toBe("U");
		expect(subagentSourceBadge("project")).toBe("P");
	});
});
