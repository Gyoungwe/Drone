import { createRoot } from "react-dom/client";
import { ProgressNote } from "../../packages/desktop/src/renderer/src/components/chat/ProgressNote";
import { RunInspector } from "../../packages/desktop/src/renderer/src/components/chat/RunInspector";
import {
	SessionUsageFooter,
	UsageSettlement,
} from "../../packages/desktop/src/renderer/src/components/chat/UsageSettlement";
import { KnowledgeFlowCard } from "../../packages/desktop/src/renderer/src/components/knowledge/KnowledgeFlowCard";
import { KnowledgePanel } from "../../packages/desktop/src/renderer/src/components/knowledge/KnowledgePanel";
import { KnowledgeUiRoot } from "../../packages/desktop/src/renderer/src/components/knowledge/KnowledgeUiRoot";
import { SkillsPanel } from "../../packages/desktop/src/renderer/src/components/settings/SkillsPanel";
import { useSessionsStore } from "../../packages/desktop/src/renderer/src/stores/sessions";
import { useSettingsStore } from "../../packages/desktop/src/renderer/src/stores/settings";
import { useTranscriptStore } from "../../packages/desktop/src/renderer/src/stores/transcript";
import { reportedUsage, sumReportedUsage } from "../../packages/shared/src/usage-display";
import { SidebarActionsFixture } from "./sidebar";
import { StageTimelineFixture } from "./timeline";

const info = await (window as any).knowledgeTest.info();
useSessionsStore.setState({
	cwd: info.cwd,
	activeSessionId: "fixture",
	models: [{ provider: "fixture", providerName: "Fixture", id: "research-model", label: "Research Model", authed: true, thinkingLevels: ["off", "low", "medium", "high"] }],
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
useSettingsStore.setState({
	modelPrefs: { hiddenModels: {}, subagentModels: { "knowledge-wiki-editor": "fixture/research-model" }, subagentThinking: { "knowledge-wiki-editor": "high" } },
	capabilities: {
		activeCapabilities: ["knowledge", "research"],
		activeTools: ["ask_user", "capability_load", "read", "research_search_knowledge"],
		visibleSkills: ["research-vault", "research-workflow"],
		footprint: { allToolSchemaBytes: 27854, activeToolSchemaBytes: 21494, reductionRatio: 0.2283, allTools: 45, activeTools: 37, totalSkills: 64, visibleSkills: 24 },
		tools: [
			{ name: "ask_user", capabilities: [], schemaBytes: 640, active: true, alwaysOn: true, invocations: 1, lastUsedAt: Date.now() - 1000 },
			{ name: "research_search_knowledge", capabilities: ["knowledge", "research"], schemaBytes: 980, active: true, alwaysOn: false, invocations: 2, lastUsedAt: Date.now() },
			{ name: "bash", capabilities: ["coding"], schemaBytes: 1200, active: false, alwaysOn: false, invocations: 0 },
		],
	},
	skills: [
		{ name: "research-vault", description: "Evidence-aware Vault workflow", scope: "temporary", source: "research-workbench", path: "/fixture/research-vault/SKILL.md", disableModelInvocation: false },
		{ name: "research-workflow", description: "Research workflow", scope: "temporary", source: "research-workbench", path: "/fixture/research-workflow/SKILL.md", disableModelInvocation: false },
	],
	skillDiagnostics: [],
	extensions: [{ name: "knowledge.mjs", path: "/fixture/knowledge.mjs", scope: "temporary", source: "research-workbench", hidden: false, toolsCount: 1, tools: ["research_search_knowledge"], commands: [], flagsCount: 0, shortcutsCount: 0 }],
	extensionErrors: [],
});

const runFixture = {
	turnIndex: 0,
	models: [{ provider: "fixture", model: "research-model", responses: 2 }],
	publicStages: [{ text: "已定位相关来源", detail: "读取当前版本后进入预检", next: "检查最终答案" }],
	tools: [{ key: "read", name: "read", state: "done" as const }, { key: "gate", name: "research_check_answer", state: "done" as const }],
	subagents: [{ key: "nav", agent: "knowledge-navigator", status: "done" as const, model: "fixture/research-model", tokens: 420 }],
	sourcePaths: ["Library/Papers/source.md"], artifacts: ["results/show-me.html"],
	publication: { status: "passed" as const }, skill: "research-workflow", errors: 0,
};

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
		<div className="mt-4 rounded-2xl border border-border bg-surface p-4" data-testid="tools-skills-fixture">
			<SkillsPanel />
		</div>
		<div className="mt-4" data-testid="run-inspector-fixture">
			<RunInspector run={runFixture} timing={{ turnIndex: 0, startedAt: 1000, endedAt: 4500 }} usage={usage} />
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
