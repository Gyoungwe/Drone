// Isolated fixture: the real subagents pane / context panel / approval dock / chat run card against a fake window.pi.
// Nothing touches ~/.pi, no model, no child session — backend behaviour is simulated by window.__fixture.

import type {
	PermissionRequest,
	SessionMeta,
	SubagentDispatchInput,
	SubagentDispatchReceipt,
	SubagentPanelRun,
	SubagentPanelSnapshot,
} from "@drone/shared";
import { SUBAGENT_RESULT_CUSTOM_TYPE } from "@drone/shared";
import { createRoot } from "react-dom/client";
import { SubagentRunCard } from "../../packages/desktop/src/renderer/src/components/chat/SubagentRunCard";
import { ContextPanel } from "../../packages/desktop/src/renderer/src/components/panel/ContextPanel";
import { ApprovalDock } from "../../packages/desktop/src/renderer/src/components/session/ApprovalDock";
import { useI18nStore } from "../../packages/desktop/src/renderer/src/i18n";
import { useDraftStore } from "../../packages/desktop/src/renderer/src/stores/drafts";
import { useSessionsStore } from "../../packages/desktop/src/renderer/src/stores/sessions";
import { useSubagentsStore } from "../../packages/desktop/src/renderer/src/stores/subagents";
import { useTranscriptStore } from "../../packages/desktop/src/renderer/src/stores/transcript";
import { useUiStore } from "../../packages/desktop/src/renderer/src/stores/ui";

const SESSION_ID = "s1";
const SESSION: SessionMeta = {
	sessionId: SESSION_ID,
	sessionFile: "/fixture/.pi/agent/sessions/s1.jsonl",
	cwd: "/fixture/percho",
	name: "权限系统梳理",
	active: true,
	messageCount: 2,
	createdAt: Date.now() - 60_000,
};
const SNAPSHOT: SubagentPanelSnapshot = {
	sessionId: SESSION_ID,
	cwd: SESSION.cwd,
	agents: [
		{
			name: "scout",
			description: "只读侦察：读文件、搜索、抓网页，不改任何东西",
			source: "builtin",
			tools: ["read", "grep", "find", "ls", "webfetch"],
			mcpAccess: "read-local",
			trusted: true,
		},
		{
			name: "lit-reviewer",
			description: "文献精读与证据卡",
			source: "user",
			tools: ["read", "webfetch"],
			mcpAccess: "none",
			trusted: true,
			path: "/fixture/.pi/agent/agents/lit-reviewer.md",
		},
		{
			name: "data-checker",
			description: "数据表质量检查（只读 bash 链）",
			source: "project",
			tools: ["read", "bash"],
			mcpAccess: "none",
			trusted: false,
			path: "/fixture/percho/.pi/agents/data-checker.md",
		},
	],
	maxConcurrent: 3,
	projectTrusted: false,
	userAgentsDir: "/fixture/.pi/agent/agents",
	projectAgentsDir: "/fixture/percho/.pi/agents",
	readOnly: false,
};

const runs = new Map<string, SubagentPanelRun>();
let seq = 0;
const fixture = {
	dispatched: [] as SubagentDispatchInput[],
	aborted: [] as string[],
	responded: [] as string[],
	runs,
	/** 模拟后端推送：面板 store + 聊天 reducer 各收一份（与 use-session-event-bridge 同一路径） */
	emit(run: SubagentPanelRun) {
		runs.set(run.runId, run);
		useSubagentsStore.getState().applyRun(SESSION_ID, run);
		useTranscriptStore
			.getState()
			.applyEvent(SESSION_ID, { type: "subagent_run", run }, { isActiveViewing: true });
	},
	advance(runId: string, patch: Partial<SubagentPanelRun>) {
		const current = runs.get(runId);
		if (!current) throw new Error(`unknown run ${runId}`);
		fixture.emit({ ...current, ...patch });
	},
	/** 子智能体的工具确认挂到父会话 gate：审批坞弹出 + 运行归因 */
	addPermission(id: string, runId: string) {
		const request: PermissionRequest = {
			id,
			sessionId: SESSION_ID,
			title: "[scout] write",
			message: "notes/permissions-map.md\n工作区内新文件 · 未启用「项目内编辑自动放行」",
			kind: "path",
		};
		useTranscriptStore.getState().addPermission(SESSION_ID, request);
		fixture.advance(runId, { status: "waiting_approval", pendingApprovalIds: [id] });
	},
	resolvePermission(id: string, runId: string) {
		useTranscriptStore.getState().resolvePermission(SESSION_ID, id);
		fixture.advance(runId, { status: "running", pendingApprovalIds: [] });
	},
	/** 主模型消费了 followUp（message_end custom 消息）*/
	deliver(runId: string) {
		const current = runs.get(runId);
		if (!current) throw new Error(`unknown run ${runId}`);
		const delivered = { ...current, contextState: "delivered" as const };
		runs.set(runId, delivered);
		useSubagentsStore.getState().applyRun(SESSION_ID, delivered);
		useTranscriptStore.getState().applyEvent(
			SESSION_ID,
			{
				type: "message_end",
				message: {
					role: "custom",
					customType: SUBAGENT_RESULT_CUSTOM_TYPE,
					content: "result",
					display: true,
					details: { v: 1, run: delivered },
					timestamp: Date.now(),
				},
			} as never,
			{ isActiveViewing: true },
		);
	},
	lastRunId: () => [...runs.keys()].at(-1) ?? null,
	draftText: () => useDraftStore.getState().bySession[SESSION_ID]?.text ?? "",
	focusRunId: () => useSubagentsStore.getState().focusRunId,
	panelTab: () => useUiStore.getState().panelTab,
	setPanelTab: (tab: "tasks" | "subagents") => useUiStore.getState().setPanelTab(tab),
	setLanguage: (language: "zh" | "en") => useI18nStore.getState().setLanguage(language),
};
(window as unknown as { __fixture: typeof fixture }).__fixture = fixture;

const api = {
	platform: "win32",
	listSessionSubagents: async () => SNAPSHOT,
	listSubagentRuns: async () => [...runs.values()],
	dispatchSubagents: async (
		_sessionId: string,
		input: SubagentDispatchInput,
	): Promise<SubagentDispatchReceipt> => {
		fixture.dispatched.push(input);
		const dispatchId = `d${++seq}`;
		const created = input.tasks.map(
			(task, index): SubagentPanelRun => ({
				runId: `r${++seq}`,
				dispatchId,
				parentSessionId: SESSION_ID,
				agent: task.agent,
				source: SNAPSHOT.agents.find((agent) => agent.name === task.agent)?.source ?? "builtin",
				task: task.task,
				cwd: input.cwd ?? SESSION.cwd,
				requiredTools: task.requiredTools ?? [],
				followUp: input.followUp !== false,
				status: "queued",
				contextState: "none",
				queuePosition: index + 1,
				createdAt: Date.now() + index,
				pendingApprovalIds: [],
			}),
		);
		for (const run of created) fixture.emit(run);
		return { dispatchId, runs: created };
	},
	abortSubagentRun: async (runId: string) => {
		fixture.aborted.push(runId);
		fixture.advance(runId, { status: "aborted", endedAt: Date.now(), queuePosition: undefined });
		return true;
	},
	respondPermission: async (requestId: string) => {
		fixture.responded.push(requestId);
	},
	steerSubagent: async () => {},
	replySubagentSupervisor: async () => {},
	peekSubagentMessages: async () => [],
	pickDirectory: async () => null,
	openResourceExternal: async () => {},
	getContextUsage: async () => null,
	getTodos: async () => [],
};
// 其余 window.pi 方法：查询类返回空，订阅类返回退订函数——面板树里其它面板挂载时不会因缺方法崩溃
(window as unknown as { pi: unknown }).pi = new Proxy(api, {
	get(target, key) {
		if (typeof key !== "string") return undefined;
		if (key in target) return target[key as keyof typeof target];
		if (key.startsWith("on")) return () => () => {};
		return async () => null;
	},
});

useSessionsStore.setState({ sessions: [SESSION], activeSessionId: SESSION_ID, cwd: SESSION.cwd });
useUiStore.getState().openPanel("subagents");

function ChatColumn() {
	const messages = useTranscriptStore((s) => s.bySession[SESSION_ID]?.messages);
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex-1 overflow-y-auto px-5 py-4">
				<div className="mx-auto flex max-w-[760px] flex-col gap-4">
					<p className="text-[11px] text-ink-faint">
						DRONE / SUBAGENTS · 隔离界面测试，不写用户文件，无模型调用
					</p>
					<div className="self-end rounded-2xl bg-hover px-3 py-2 text-[13px] text-ink">
						帮我梳理一下这个仓库的权限系统。
					</div>
					<div className="text-[13px] text-ink">我先看 permissions/ 目录与 docs，再给你字段表和评估链。</div>
					{(messages ?? []).map((message) =>
						message.kind === "subagent" ? <SubagentRunCard key={message.id} runs={message.runs} /> : null,
					)}
				</div>
			</div>
			<ApprovalDock sessionId={SESSION_ID} hideComposer />
		</div>
	);
}

function Fixture() {
	return (
		<div className="flex h-screen bg-canvas text-ink" data-testid="fixture-root">
			<ChatColumn />
			<ContextPanel />
		</div>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(<Fixture />);
