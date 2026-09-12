import { createRoot } from "react-dom/client";
import { ProgressNote } from "../../packages/desktop/src/renderer/src/components/chat/ProgressNote";
import {
	SessionUsageFooter,
	UsageSettlement,
} from "../../packages/desktop/src/renderer/src/components/chat/UsageSettlement";
import { KnowledgeFlowCard } from "../../packages/desktop/src/renderer/src/components/knowledge/KnowledgeFlowCard";
import { KnowledgePanel } from "../../packages/desktop/src/renderer/src/components/knowledge/KnowledgePanel";
import { KnowledgeUiRoot } from "../../packages/desktop/src/renderer/src/components/knowledge/KnowledgeUiRoot";
import { useSessionsStore } from "../../packages/desktop/src/renderer/src/stores/sessions";
import { useTranscriptStore } from "../../packages/desktop/src/renderer/src/stores/transcript";
import { reportedUsage, sumReportedUsage } from "../../packages/shared/src/usage-display";
import { SidebarActionsFixture } from "./sidebar";
import { StageTimelineFixture } from "./timeline";

const info = await (window as any).knowledgeTest.info();
useSessionsStore.setState({
	cwd: info.cwd,
	activeSessionId: "fixture",
	sessions: [
		{
			sessionId: "fixture",
			cwd: info.cwd,
			name: "隔离 UI 验收",
			active: true,
			messageCount: 0,
			createdAt: Date.now(),
		},
	],
});
const usage = sumReportedUsage([
	reportedUsage({
		responseId: "fixture",
		timestamp: 1,
		usage: { input: 200, output: 100, cacheRead: 800, cacheWrite: 0, cost: { total: 0 } },
	})!,
]);
useTranscriptStore
	.getState()
	.loadHistory("fixture", [{ kind: "user", id: "fixture-user", text: "Fixture", images: [], timestamp: 1 }]);
createRoot(document.getElementById("root")!).render(
	<div style={{ maxWidth: 1080, margin: "0 auto", padding: 16 }}>
		<div className="mb-3 text-[10px] tracking-wider text-ink-dim">
			PERCHO / KNOWLEDGE · 隔离测试库，不是用户正式笔记
		</div>
		<KnowledgeFlowCard sessionId="fixture" />
		<div className="rounded-2xl border border-border bg-surface p-4">
			<KnowledgePanel context={{ cwd: info.cwd, sessionId: "fixture" }} />
		</div>
		<div className="mt-4 space-y-3" data-testid="usage-progress-fixture">
			<ProgressNote
				progress={{
					text: "正在核对引用与产物",
					detail: "Show Me 是交付文件，不作为科学证据。",
					next: "预检最终答案并报告具体缺口。",
				}}
			/>
			<UsageSettlement usage={usage} />
			<SessionUsageFooter sessionId="fixture" />
		</div>
		<StageTimelineFixture />
		<SidebarActionsFixture />
		<KnowledgeUiRoot />
	</div>,
);
