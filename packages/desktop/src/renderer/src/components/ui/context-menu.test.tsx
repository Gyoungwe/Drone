import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fileAction = vi.fn(async () => null);
vi.mock("../../api", () => ({ getPi: () => ({ fileAction }) }));
vi.stubGlobal("React", React);
vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });

import { useDraftStore } from "../../stores/drafts";
import { usePinsStore } from "../../stores/pins";
import { useSessionsStore } from "../../stores/sessions";
import { ContextMenuView, useContextMenuStore } from "./ContextMenu";
import { buildFileMenu, buildTabMenu } from "./file-menu";

const t = ((key: string) => key) as never;

describe("context menus (P7)", () => {
	beforeEach(() => fileAction.mockClear());
	it("file menu has the 12 actions in 5 groups and routes host actions", () => {
		const groups = buildFileMenu({ path: "/p/data/a.csv", cwd: "/p" }, t);
		expect(groups.map((g) => g.length)).toEqual([3, 3, 2, 2, 2]);
		const item = (id: string) => groups.flat().find((i) => i.id === id);
		item("reveal")?.onSelect();
		item("cut")?.onSelect();
		expect(fileAction).toHaveBeenCalledWith("reveal", "/p/data/a.csv", "/p", null);
		expect(fileAction).toHaveBeenCalledWith("cut", "/p/data/a.csv", "/p", null);
		expect(item("delete")?.danger).toBe(true);
	});
	it("add to chat attaches the relative path to the active draft", () => {
		vi.stubGlobal("window", { dispatchEvent: vi.fn() });
		useSessionsStore.setState({ activeSessionId: "s1" });
		buildFileMenu({ path: "/p/data/a.csv", cwd: "/p" }, t)
			.flat()
			.find((i) => i.id === "addToChat")
			?.onSelect();
		expect(useDraftStore.getState().bySession.s1?.attachments).toEqual(["data/a.csv"]);
	});
	it("rename opens the inline prompt instead of window.prompt", () => {
		buildFileMenu({ path: "/p/a.csv" }, t)
			.flat()
			.find((i) => i.id === "rename")
			?.onSelect();
		expect(useContextMenuStore.getState().prompt?.initial).toBe("a.csv");
	});
	it("tab menu has 8 actions, disables impossible ones and toggles pin", () => {
		useSessionsStore.setState({
			sessions: [
				{ sessionId: "a", cwd: "/p", active: true, messageCount: 0, createdAt: 0 },
				{ sessionId: "b", cwd: "/p", active: true, messageCount: 0, createdAt: 0 },
			],
		});
		const groups = buildTabMenu("b", t);
		expect(groups.flat()).toHaveLength(8);
		const item = (id: string) => groups.flat().find((i) => i.id === id);
		expect(item("closeRight")?.disabled).toBe(true);
		expect(item("rename")?.disabled).toBe(true);
		expect(item("delete")?.disabled).toBe(true);
		item("pin")?.onSelect();
		expect(usePinsStore.getState().isPinned("task", "b")).toBe(true);
		expect(
			buildTabMenu("b", t)
				.flat()
				.find((i) => i.id === "pin")?.label,
		).toBe("contextMenu.tab.unpin");
	});
	it("renders groups with menuitems", () => {
		const html = renderToStaticMarkup(
			createElement(ContextMenuView, {
				x: 10,
				y: 10,
				onClose: () => {},
				groups: buildFileMenu({ path: "/p/a.csv", cwd: "/p" }, t),
			}),
		);
		expect(html.match(/role="menuitem"/g)).toHaveLength(12);
		expect(html).toContain("contextMenu.file.openInEditor");
	});
});
