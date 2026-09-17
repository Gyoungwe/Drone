import { afterEach, expect, it } from "vitest";
import { useUiStore } from "./ui";

afterEach(() =>
	useUiStore.setState({ taskSidebarOpen: false, diffSidebarOpen: false, resourcePreview: null }),
);
it("the task workbench button opens and closes a real mutually exclusive sidebar", () => {
	useUiStore.getState().showDiffSidebar();
	useUiStore.getState().toggleTaskSidebar();
	expect(useUiStore.getState().taskSidebarOpen).toBe(true);
	expect(useUiStore.getState().diffSidebarOpen).toBe(false);
	useUiStore.getState().toggleTaskSidebar();
	expect(useUiStore.getState().taskSidebarOpen).toBe(false);
});
it("opening a resource closes the workbench instead of overlaying its requests", () => {
	useUiStore.getState().setTaskSidebarOpen(true);
	useUiStore.getState().openResourcePreview({ href: "report.md" });
	expect(useUiStore.getState().taskSidebarOpen).toBe(false);
	expect(useUiStore.getState().diffSidebarOpen).toBe(true);
});
