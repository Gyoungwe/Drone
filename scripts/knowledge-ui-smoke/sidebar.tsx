import { WorkbenchNav } from "../../packages/desktop/src/renderer/src/components/workbench/WorkbenchNav";
import { useI18nStore } from "../../packages/desktop/src/renderer/src/i18n";
import { useSettingsStore } from "../../packages/desktop/src/renderer/src/stores/settings";
import { useUiStore } from "../../packages/desktop/src/renderer/src/stores/ui";

let restoreRefresh: (() => Promise<void>) | undefined;
(window as any).sidebarFixture = {
	begin() {
		restoreRefresh = useSettingsStore.getState().refresh;
		useSettingsStore.setState({ open: false, category: "general", refresh: async () => {} });
		useI18nStore.getState().setLanguage("zh");
	},
	state() {
		const { open, category } = useSettingsStore.getState();
		return { open, category, view: useUiStore.getState().view };
	},
	reset() {
		useSettingsStore.setState({ open: false, category: "general" });
		useUiStore.getState().setView("chat");
	},
	language(value: "zh" | "en") {
		useI18nStore.getState().setLanguage(value);
	},
	end() {
		if (restoreRefresh)
			useSettingsStore.setState({ open: false, category: "general", refresh: restoreRefresh });
		useUiStore.getState().setView("chat");
		useI18nStore.getState().setLanguage("zh");
	},
};
export function SidebarActionsFixture() {
	return (
		<section
			data-testid="sidebar-actions-fixture"
			className="mt-4 hidden rounded-xl border border-border p-4"
		>
			<div className="mb-2 text-[10px] text-ink-faint">侧边栏按钮对齐 · 真实组件 / 隔离 UI 验收</div>
			<div className="flex h-80">
				<WorkbenchNav />
			</div>
		</section>
	);
}
