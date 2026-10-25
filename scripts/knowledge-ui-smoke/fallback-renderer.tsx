import { createRoot } from "react-dom/client";
import { KnowledgeUiRoot } from "../../packages/desktop/src/renderer/src/components/knowledge/KnowledgeUiRoot";
import { KnowledgeView } from "../../packages/desktop/src/renderer/src/components/knowledge/KnowledgeView";
import { useUiPluginRegistry } from "../../packages/desktop/src/renderer/src/plugins/registry";
import { useSessionsStore } from "../../packages/desktop/src/renderer/src/stores/sessions";
import { useSettingsStore } from "../../packages/desktop/src/renderer/src/stores/settings";
import { useUiStore } from "../../packages/desktop/src/renderer/src/stores/ui";
import { useUiPluginsStore } from "../../packages/desktop/src/renderer/src/stores/ui-plugins";

const info = await (window as any).knowledgeTest.info();
useSessionsStore.setState({ cwd: info.cwd });
useSettingsStore.setState({ refresh: async () => {} });
const manifest = {
	name: "host-mount-fixture",
	version: "1.0.0",
	droneUi: 1 as const,
	main: "fixture.js",
	contributions: [{ id: "page", region: "knowledge.page", export: "Page" }],
};
function Page() {
	return <p data-testid="fixture-plugin-page">Synthetic mount fixture</p>;
}
function BrokenPage(): never {
	throw new Error("intentional fixture render failure");
}
(window as any).knowledgeMountFixture = {
	install(broken = false) {
		useUiPluginRegistry.getState().removePlugin(manifest.name);
		const result = useUiPluginRegistry
			.getState()
			.applyPlugin(manifest, { Page: broken ? BrokenPage : Page }, []);
		if (!result.ok) throw new Error(result.missing.join(", "));
		useUiPluginsStore.setState({ config: { enabled: true, plugins: {}, assignments: {} } });
	},
	remove() {
		useUiPluginRegistry.getState().removePlugin(manifest.name);
	},
	master(enabled: boolean) {
		useUiPluginsStore.setState({ config: { enabled, plugins: {}, assignments: {} } });
	},
	settings() {
		const { view, capabilityDrawer } = useUiStore.getState();
		return { view, capabilityDrawer };
	},
};
const root = document.getElementById("root");
if (!root) throw new Error("knowledge-ui-smoke: root missing");
createRoot(root).render(
	<>
		<KnowledgeView />
		<KnowledgeUiRoot />
	</>,
);
