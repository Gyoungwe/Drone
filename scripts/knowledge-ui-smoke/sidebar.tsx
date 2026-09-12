import { ProjectSidebar } from "../../packages/desktop/src/renderer/src/components/projects/ProjectSidebar";
import { useI18nStore } from "../../packages/desktop/src/renderer/src/i18n";
import { useSettingsStore } from "../../packages/desktop/src/renderer/src/stores/settings";

let restoreRefresh: (() => Promise<void>) | undefined;
(window as any).sidebarFixture = {
	begin() {
		restoreRefresh = useSettingsStore.getState().refresh;
		useSettingsStore.setState({ open: false, category: "general", refresh: async () => {} });
		useI18nStore.getState().setLanguage("zh");
	},
	state() {
		const { open, category } = useSettingsStore.getState();
		return { open, category };
	},
	reset() {
		useSettingsStore.setState({ open: false, category: "general" });
	},
	language(value: "zh" | "en") {
		useI18nStore.getState().setLanguage(value);
	},
	end() {
		if (restoreRefresh)
			useSettingsStore.setState({ open: false, category: "general", refresh: restoreRefresh });
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
				<ProjectSidebar />
			</div>
		</section>
	);
}
