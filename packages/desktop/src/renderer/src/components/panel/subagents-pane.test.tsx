import type { SessionMeta, SubagentPanelRun, SubagentPanelSnapshot } from "@drone/shared";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api", () => ({
	getPi: () => ({
		listSessionSubagents: vi.fn(),
		listSubagentRuns: vi.fn(async () => []),
		dispatchSubagents: vi.fn(),
		abortSubagentRun: vi.fn(),
		openResourceExternal: vi.fn(),
		pickDirectory: vi.fn(),
	}),
}));
vi.mock("../../i18n", () => ({
	useT: () => (key: string, params?: Record<string, string | number>) =>
		params ? `${key}:${Object.values(params).join(",")}` : key,
	useI18nStore: (selector: (s: { language: "zh" | "en" }) => unknown) => selector({ language: "zh" }),
}));
// renderToStaticMarkup 走 useSyncExternalStore 的服务端快照（= store 初始态），setState 对真 zustand hook 不可见；
// 这里把 hook 换成「读当前 state 的纯函数」，getState / setState 仍指向真 store，测试用例照常摆状态。
vi.mock("../../stores/sessions", () => {
	const state: {
		sessions: SessionMeta[];
		activeSessionId: string | null;
		permissionModes: Record<string, "default" | "fullAccess">;
	} = { sessions: [], activeSessionId: null, permissionModes: {} };
	const hook = (selector: (s: typeof state) => unknown) => selector(state);
	return {
		useSessionsStore: Object.assign(hook, {
			getState: () => state,
			setState: (patch: Partial<typeof state>) => Object.assign(state, patch),
		}),
	};
});
vi.mock("../../stores/subagents", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../stores/subagents")>();
	const real = actual.useSubagentsStore;
	const hook = (selector?: (s: ReturnType<typeof real.getState>) => unknown) =>
		selector ? selector(real.getState()) : real.getState();
	return {
		...actual,
		useSubagentsStore: Object.assign(hook, {
			getState: real.getState,
			setState: real.setState,
			subscribe: real.subscribe,
			getInitialState: real.getInitialState,
		}),
	};
});
vi.mock("../../stores/settings", () => ({
	useSettingsStore: (selector: (s: { openWith: () => void }) => unknown) => selector({ openWith: () => {} }),
}));
vi.mock("../chat/InlineSubagentTranscript", () => ({ InlineSubagentTranscript: () => null }));
vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

import { useSessionsStore } from "../../stores/sessions";
import { useSubagentsStore } from "../../stores/subagents";
import { SubagentsPane } from "./SubagentsPane";

const SESSION: SessionMeta = { sessionId: "s1", cwd: "/proj", active: true, messageCount: 0, createdAt: 1 };
const SNAPSHOT: SubagentPanelSnapshot = {
	sessionId: "s1",
	cwd: "/proj",
	agents: [
		{
			name: "scout",
			description: "recon",
			source: "builtin",
			tools: ["read", "grep"],
			mcpAccess: "read-local",
			trusted: true,
		},
		{
			name: "lit-reviewer",
			description: "papers",
			source: "user",
			tools: ["read", "webfetch"],
			mcpAccess: "none",
			trusted: true,
		},
		{
			name: "data-checker",
			description: "csv",
			source: "project",
			tools: ["read", "bash"],
			mcpAccess: "none",
			trusted: false,
		},
	],
	maxConcurrent: 3,
	projectTrusted: false,
	userAgentsDir: "/home/u/.pi/agent/agents",
	projectAgentsDir: "/proj/.pi/agents",
	readOnly: false,
};

function run(overrides: Partial<SubagentPanelRun>): SubagentPanelRun {
	return {
		runId: "r1",
		dispatchId: "d1",
		parentSessionId: "s1",
		agent: "scout",
		source: "builtin",
		task: "map the rules",
		cwd: "/proj",
		requiredTools: [],
		followUp: true,
		status: "running",
		contextState: "none",
		createdAt: 1,
		startedAt: 1,
		pendingApprovalIds: [],
		...overrides,
	};
}

function render(sessionId: string | null = "s1"): string {
	return renderToStaticMarkup(createElement(SubagentsPane, { sessionId }));
}

beforeEach(() => {
	useSessionsStore.setState({ sessions: [SESSION], activeSessionId: "s1", permissionModes: {} });
	useSubagentsStore.setState({
		agentsBySession: { s1: { snapshot: SNAPSHOT, loading: false, error: null, loadedAt: Date.now() } },
		runsBySession: {},
		focusRunId: null,
		draftAgent: null,
	});
});

describe("SubagentsPane · 状态渲染", () => {
	it("无会话 / 只读会话：边界空态，不渲染表单", () => {
		expect(render(null)).toContain("panel.subagents.noSession");
		useSessionsStore.setState({ sessions: [{ ...SESSION, readOnly: true }] });
		const html = render();
		expect(html).toContain("panel.subagents.readOnly");
		expect(html).not.toContain('data-testid="subagents-dispatch"');
	});

	it("可用列表：三种来源 + 头像哈希定色；未信任的项目级定义禁用派发按钮并标注", () => {
		const html = render();
		expect(html.match(/data-testid="subagent-agent-row"/g)).toHaveLength(3);
		expect(html).toContain("panel.subagents.untrustedHint:1");
		const checker = html.slice(html.indexOf('data-agent="data-checker"'));
		expect(checker).toContain("panel.subagents.untrusted");
		expect(checker).toMatch(
			/data-testid="subagent-agent-pick"[^>]*disabled|disabled[^>]*data-testid="subagent-agent-pick"/,
		);
		expect(html).toMatch(/class="sa-av md h3[ "]/); // scout → h3
		expect(html).toContain('data-state="idle"');
	});

	it("派发表单：默认单任务、followUp 勾选、运行槽计数；没有会话运行时空态", () => {
		const html = render();
		expect(html.match(/data-testid="subagent-task-row"/g)).toHaveLength(1);
		expect(html).toMatch(
			/data-testid="subagent-followup"[^>]*checked|checked[^>]*data-testid="subagent-followup"/,
		);
		expect(html).toContain("0/3");
		expect(html).toContain("panel.subagents.runsEmpty");
		expect(html).toContain("panel.subagents.dispatch<");
	});

	it("运行列表：七种状态映射到胶囊 + 头像表情 + 操作按钮", () => {
		const runs: Record<string, SubagentPanelRun> = {
			q: run({ runId: "q", status: "queued", queuePosition: 2, startedAt: undefined }),
			r: run({ runId: "r", status: "running", childSessionId: "c1", sessionFile: "/tmp/r.jsonl" }),
			n: run({
				runId: "n",
				status: "needs_reply",
				childSessionId: "c2",
				supervisorRequest: { id: "q1", reason: "need_decision", message: "which?", expectsReply: true },
			}),
			w: run({
				runId: "w",
				status: "waiting_approval",
				childSessionId: "c3",
				pendingApprovalIds: ["perm-1"],
			}),
			d: run({
				runId: "d",
				status: "done",
				content: "five fields",
				contextState: "delivered",
				endedAt: 5,
				sessionFile: "/tmp/d.jsonl",
			}),
			e: run({ runId: "e", status: "error", error: "exit 1 · zotero down", endedAt: 5 }),
			a: run({ runId: "a", status: "aborted", endedAt: 5, sessionFile: "/tmp/a.jsonl" }),
		};
		useSubagentsStore.setState({ runsBySession: { s1: runs } });
		const html = render();
		expect(html.match(/data-testid="subagent-run-card"/g)).toHaveLength(7);
		for (const status of [
			"queued",
			"running",
			"needs_reply",
			"waiting_approval",
			"done",
			"error",
			"aborted",
		]) {
			expect(html).toContain(`panel.subagents.status.${status}`);
			expect(html).toContain(`data-status="${status}"`);
		}
		for (const state of ["queued", "running", "waiting", "done", "error", "aborted"]) {
			expect(html).toContain(`data-state="${state}"`);
		}
		expect(html).toContain("panel.subagents.queueReason:2");
		expect(html).toContain("panel.subagents.context.delivered");
		expect(html).toContain("exit 1 · zotero down");
		expect(html).toContain("sa-run-aborted");
		expect(html).toContain("panel.subagents.actions.cancel");
		expect(html).toContain("panel.subagents.actions.abort");
		expect(html).toContain("panel.subagents.actions.cite");
		expect(html).toContain("panel.subagents.actions.retry");
		expect(html).toContain("panel.subagents.actions.redispatch");
		expect(html).toContain("panel.subagents.actions.replay");
		expect(html).toContain("message.subagent.needDecision");
		// 运行槽：本会话 running / needs_reply / waiting_approval / queued 都占用，封顶到上限
		expect(html).toContain("3/3");
		expect(html).toContain("panel.subagents.dispatchQueue");
	});

	it("fullAccess 会话：派发表单顶部提示子智能体同样不再逐项确认", () => {
		expect(render()).not.toContain("subagents-full-access");
		useSessionsStore.setState({ permissionModes: { s1: "fullAccess" } });
		const html = render();
		expect(html).toContain('data-testid="subagents-full-access"');
		expect(html).toContain("panel.subagents.fullAccessHint");
	});
});
