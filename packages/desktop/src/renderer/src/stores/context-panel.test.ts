import { afterEach, expect, it } from "vitest";
import { useUiStore } from "./ui";

afterEach(() =>
	useUiStore.setState({
		panelOpen: true,
		idleOpen: true,
		panelTab: "tasks",
		resourcePreview: null,
		diffFocus: null,
		processFocus: null,
	}),
);

it("a chip jump opens the panel on the requested tab without touching the idle choice", () => {
	useUiStore.setState({ panelOpen: false, idleOpen: false });
	useUiStore.getState().openPanel("changes");
	expect(useUiStore.getState().panelOpen).toBe(true);
	expect(useUiStore.getState().panelTab).toBe("changes");
	expect(useUiStore.getState().idleOpen).toBe(false);
});

it("opening a resource switches to the changes tab and replaces the diff view", () => {
	useUiStore.getState().setPanelTab("tasks");
	useUiStore.getState().openResourcePreview({ href: "report.md" });
	expect(useUiStore.getState().panelTab).toBe("changes");
	expect(useUiStore.getState().resourcePreview?.href).toBe("report.md");
	useUiStore.getState().showDiffSidebar();
	expect(useUiStore.getState().resourcePreview).toBeNull();
});

it("run boundaries auto-expand the panel and fall back to the remembered idle choice", () => {
	// 空闲时手动关闭 → 记住
	useUiStore.getState().togglePanel(false);
	expect(useUiStore.getState().panelOpen).toBe(false);
	expect(useUiStore.getState().idleOpen).toBe(false);
	// 运行开始自动展开；运行中关闭只影响本次运行
	useUiStore.getState().onRunStart();
	expect(useUiStore.getState().panelOpen).toBe(true);
	useUiStore.getState().togglePanel(true);
	expect(useUiStore.getState().panelOpen).toBe(false);
	expect(useUiStore.getState().idleOpen).toBe(false);
	// 运行结束回到空闲选择
	useUiStore.getState().onRunStart();
	useUiStore.getState().onRunEnd();
	expect(useUiStore.getState().panelOpen).toBe(false);
});

it("focusing a diff section or a process turn lands on the matching tab", () => {
	useUiStore.getState().setDiffFocus("tool-1");
	expect(useUiStore.getState().panelTab).toBe("changes");
	expect(useUiStore.getState().diffFocus?.sectionKey).toBe("tool-1");
	useUiStore.getState().focusProcessTurn(2);
	expect(useUiStore.getState().panelTab).toBe("process");
	expect(useUiStore.getState().processFocus?.turnIndex).toBe(2);
});
