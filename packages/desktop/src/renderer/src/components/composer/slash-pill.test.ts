import { describe, expect, it } from "vitest";
import {
	COMPOSER_CHIP_GAP_PX,
	caretAtStart,
	chipIndentPx,
	chipsFitInline,
	chipsTotalWidth,
	slashPillView,
} from "./slash-pill";

describe("slashPillView", () => {
	it("skill 胶囊显示裸名（不再是等宽的 /skill:xxx），发送命令保持完整", () => {
		const view = slashPillView("skill:nature-academic-search", "zh");
		expect(view.label).toBe("nature-academic-search");
		expect(view.command).toBe("/skill:nature-academic-search");
		expect(view.isSkill).toBe(true);
	});
	it("有产品名的 skill 按界面语言显示", () => {
		expect(slashPillView("skill:research-vault", "zh").label).toBe("Obsidian 知识库");
		expect(slashPillView("skill:research-vault", "en").label).toBe("Obsidian knowledge");
	});
	it("内置 / 模板命令仍显示 /name", () => {
		expect(slashPillView("compact", "zh")).toEqual({
			label: "/compact",
			command: "/compact",
			isSkill: false,
		});
	});
});

describe("行首胶囊布局", () => {
	it("总宽 = 各胶囊宽度 + 间距，忽略未渲染（0 宽）的胶囊", () => {
		expect(chipsTotalWidth([])).toBe(0);
		expect(chipsTotalWidth([120])).toBe(120);
		expect(chipsTotalWidth([120, 0, 80])).toBe(200 + COMPOSER_CHIP_GAP_PX);
	});
	it("不超过 60% 宽度时内联到首行，否则独占上方一行；未测得宽度时按内联", () => {
		expect(chipsFitInline(0, 0)).toBe(true);
		expect(chipsFitInline(200, 700)).toBe(true);
		expect(chipsFitInline(420, 700)).toBe(true);
		expect(chipsFitInline(421, 700)).toBe(false);
	});
	it("首行缩进 = 胶囊总宽取整 + 间距；无胶囊不缩进", () => {
		expect(chipIndentPx(0)).toBe(0);
		expect(chipIndentPx(120.2)).toBe(121 + COMPOSER_CHIP_GAP_PX);
	});
	it("光标在最前且无选区时，Backspace 才撤销胶囊", () => {
		expect(caretAtStart(0, 0)).toBe(true);
		expect(caretAtStart(0, 3)).toBe(false);
		expect(caretAtStart(2, 2)).toBe(false);
		expect(caretAtStart(null, null)).toBe(false);
	});
});
