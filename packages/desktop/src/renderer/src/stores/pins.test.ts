import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
	getItem: (k: string) => storage.get(k) ?? null,
	setItem: (k: string, v: string) => void storage.set(k, v),
});

describe("pins store", () => {
	beforeEach(() => {
		storage.clear();
		vi.resetModules();
	});
	it("toggles and persists pins across reloads", async () => {
		const { usePinsStore, PINS_KEY } = await import("./pins");
		usePinsStore.getState().togglePin("task", "s1");
		usePinsStore.getState().togglePin("project", "/p");
		expect(usePinsStore.getState().isPinned("task", "s1")).toBe(true);
		expect(JSON.parse(storage.get(PINS_KEY) ?? "[]")).toEqual(["task:s1", "project:/p"]);
		vi.resetModules();
		const again = await import("./pins");
		expect(again.usePinsStore.getState().isPinned("project", "/p")).toBe(true);
		again.usePinsStore.getState().togglePin("task", "s1");
		expect(again.usePinsStore.getState().isPinned("task", "s1")).toBe(false);
	});
});
