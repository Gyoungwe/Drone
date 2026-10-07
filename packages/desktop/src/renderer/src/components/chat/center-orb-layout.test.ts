import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { drawCenterOrb } from "./center-orb-draw";

function fakeCtx() {
	const createRadialGradient = vi.fn(() => ({ addColorStop: vi.fn() }));
	const noop = vi.fn();
	const ctx = {
		createRadialGradient,
		beginPath: noop,
		arc: noop,
		fill: noop,
		stroke: noop,
		moveTo: noop,
		lineTo: noop,
		fillStyle: "",
		strokeStyle: "",
		lineWidth: 1,
		lineCap: "butt",
	};
	return { ctx: ctx as unknown as CanvasRenderingContext2D, createRadialGradient };
}

describe("CenterOrb 不覆盖对话文字", () => {
	it("流内模式（mask:false）不画同色遮罩圆盘", () => {
		const { ctx, createRadialGradient } = fakeCtx();
		drawCenterOrb(ctx, 64, 1.2, false, { mask: false });
		expect(createRadialGradient).not.toHaveBeenCalled();
	});
	it("默认仍可画遮罩（保留给需要压字的调用方）", () => {
		const { ctx, createRadialGradient } = fakeCtx();
		drawCenterOrb(ctx, 64, 1.2, true);
		expect(createRadialGradient).toHaveBeenCalledTimes(1);
	});
	it("CenterOrb 不再 absolute 覆盖整个消息区，MessageList 把它放在内容列末尾", () => {
		const orb = readFileSync(new URL("./CenterOrb.tsx", import.meta.url), "utf8");
		expect(orb).not.toMatch(/absolute inset-0 z-20/);
		expect(orb).toMatch(/mask: false/);
		const list = readFileSync(new URL("./MessageList.tsx", import.meta.url), "utf8");
		const contentStart = list.indexOf("ref={contentRef}");
		const orbAt = list.indexOf("<CenterOrb");
		expect(contentStart).toBeGreaterThan(-1);
		expect(orbAt).toBeGreaterThan(contentStart);
		expect(list.indexOf("{items}")).toBeLessThan(orbAt);
	});
});
