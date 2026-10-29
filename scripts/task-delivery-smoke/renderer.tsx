import "../../packages/desktop/src/renderer/src/plugins/host-api";
import * as taskUi from "@installed-task-ui";
import taskUiManifest from "@installed-task-ui-manifest";
import { createRoot } from "react-dom/client";
import { getPi } from "../../packages/desktop/src/renderer/src/api";
import { MessageItem } from "../../packages/desktop/src/renderer/src/components/chat/MessageItem";
import { ChangesPane } from "../../packages/desktop/src/renderer/src/components/panel/ChangesPane";
import {
	PluginEntryHost,
	usePluginEntries,
} from "../../packages/desktop/src/renderer/src/plugins/PluginRegions";

import { useUiPluginRegistry } from "../../packages/desktop/src/renderer/src/plugins/registry";
import { UI_REGIONS, UI_SLOTS } from "../../packages/desktop/src/renderer/src/plugins/slots";
import { useSessionsStore } from "../../packages/desktop/src/renderer/src/stores/sessions";
import { useThemeStore } from "../../packages/desktop/src/renderer/src/stores/theme";
import {
	selectTranscript,
	useTranscriptStore,
} from "../../packages/desktop/src/renderer/src/stores/transcript";
import { useUiStore } from "../../packages/desktop/src/renderer/src/stores/ui";
import { useUiPluginsStore } from "../../packages/desktop/src/renderer/src/stores/ui-plugins";
import { localResourceHref } from "../../packages/shared/src/resource-links";

const applied = useUiPluginRegistry.getState().applyPlugin(taskUiManifest, taskUi, [UI_SLOTS.Message]);
if (!applied.ok) throw new Error(`Installed task UI registration failed: ${applied.missing.join(", ")}`);
useUiPluginsStore.setState({ config: { enabled: true, plugins: {}, assignments: {} } });

document.documentElement.dataset.theme = "light";
useThemeStore.setState({ resolved: "light" });
(window as any).deliveryFixture = {
	open: (path: string, cwd: string) => useUiStore.getState().openResourcePreview({ href: path, cwd }),
	theme: (resolved: "light" | "dark") => {
		document.documentElement.dataset.theme = resolved;
		useThemeStore.setState({ resolved });
	},
	preview: (path: string, cwd: string) => getPi().previewFile(path, cwd),
	clearPreview: () => useUiStore.getState().clearResourcePreview(),
	show(views: any[], cwd: string) {
		useSessionsStore.setState({
			activeSessionId: "fixture",
			cwd,
			sessions: [{ sessionId: "fixture", cwd }] as any,
		});
		useTranscriptStore.getState().loadHistory("fixture", [
			{
				kind: "assistant",
				id: "answer",
				text: `报告已生成：[打开报告](${localResourceHref(`${cwd}/报告 (1)#100%.csv`)})\n\n[R 小写](./lowercase.r) · [R 大写](./uppercase.R) · [Python 大写](./uppercase.PY) · [Python 混合大小写](./mixed.Py)`,
				thinking: "",
				tools: [],
				timestamp: 0,
			},
			...views.map((taskView, i) => ({
				kind: "assistant",
				id: `task-${i}`,
				hostStatus: true,
				taskView,
				text: "宿主状态",
				thinking: "",
				tools: [],
				timestamp: i,
			})),
		] as any);
	},
};
function Fixture() {
	const messages = useTranscriptStore((s) => selectTranscript(s, "fixture").messages);
	const resource = useUiStore((s) => s.resourcePreview);
	return (
		<div style={{ display: "flex", height: "100vh" }}>
			<main id="conversation" style={{ flex: 1, minWidth: 0, padding: 24 }}>
				<h1>任务交付测试</h1>
				<p>报告已生成，请从产物链接打开。</p>
				{messages.map((message) => (
					<MessageItem key={message.id} message={message} sessionId="fixture" />
				))}
			</main>
			{resource && (
				<section id="artifact-preview" style={{ display: "contents" }}>
					<ChangesPane sessionId="fixture" />
				</section>
			)}
			<TaskPanelFixture />
		</div>
	);
}
const root = document.getElementById("root");
if (!root) throw new Error("Fixture root missing");
createRoot(root).render(<Fixture />);

function TaskPanelFixture() {
	const entries = usePluginEntries(UI_REGIONS.PanelTab);
	return (
		<aside className="context-pane">
			{entries
				.filter((entry) => entry.pluginName === taskUiManifest.name)
				.map((entry) => (
					<PluginEntryHost key={entry.id} entry={entry} />
				))}
		</aside>
	);
}
