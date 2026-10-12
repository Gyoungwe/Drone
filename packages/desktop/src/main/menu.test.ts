import { describe, expect, it, vi } from "vitest";
import { buildMenuTemplate } from "./menu";

describe("native menu template", () => {
	it("wires accelerators to desktop commands", () => {
		const send = vi.fn();
		const template = buildMenuTemplate(send, "zh");
		const items = template.flatMap((m) => (Array.isArray(m.submenu) ? m.submenu : []));
		const byAccel = new Map(items.filter((i) => i.accelerator).map((i) => [i.accelerator, i]));
		for (const accel of [
			"CmdOrCtrl+K",
			"CmdOrCtrl+N",
			"CmdOrCtrl+W",
			"CmdOrCtrl+,",
			"CmdOrCtrl+Shift+[",
			"CmdOrCtrl+Shift+]",
		])
			expect(byAccel.has(accel)).toBe(true);
		// renderer-only shortcuts stay out of the menu so typing in inputs keeps working
		expect(byAccel.has("CmdOrCtrl+Enter")).toBe(false);
		const click = byAccel.get("CmdOrCtrl+K")?.click as (() => void) | undefined;
		click?.();
		expect(send).toHaveBeenCalledWith("search");
		expect(template.some((m) => m.role === "editMenu")).toBe(true);
	});
});
