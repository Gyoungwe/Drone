import {
	isSubagentRunAttention,
	isSubagentRunSettled,
	type SubagentDispatchInput,
	type SubagentDispatchReceipt,
	type SubagentPanelRun,
	type SubagentPanelSnapshot,
} from "@drone/shared";
import { useMemo } from "react";
import { create } from "zustand";
import { getPi } from "../api";

/** 「查看审批」→ 审批坞滚入视野并闪一下（ApprovalDock 监听） */
export const APPROVAL_FOCUS_EVENT = "pi:approval-focus";

/** 会话维度的可用列表快照（含加载态；切会话不互相覆盖） */
export interface SubagentAgentsEntry {
	snapshot: SubagentPanelSnapshot | null;
	loading: boolean;
	error: string | null;
	loadedAt: number;
}

interface SubagentsState {
	agentsBySession: Record<string, SubagentAgentsEntry>;
	/** runId → 运行记录（后端 `subagent_run` 事件整条覆盖） */
	runsBySession: Record<string, Record<string, SubagentPanelRun>>;
	/** 审批坞「查看该运行」→ 面板高亮的 runId（面板消费后清除） */
	focusRunId: string | null;
	/** 派发表单预选（可用列表「派发」按钮 → 表单） */
	draftAgent: string | null;

	loadAgents: (sessionId: string, force?: boolean) => Promise<void>;
	hydrateRuns: (sessionId: string) => Promise<void>;
	applyRun: (sessionId: string, run: SubagentPanelRun) => void;
	dispatch: (sessionId: string, input: SubagentDispatchInput) => Promise<SubagentDispatchReceipt>;
	abort: (runId: string) => Promise<boolean>;
	focusRun: (runId: string | null) => void;
	setDraftAgent: (agent: string | null) => void;
	clearSession: (sessionId: string) => void;
}

const EMPTY_ENTRY: SubagentAgentsEntry = { snapshot: null, loading: false, error: null, loadedAt: 0 };
const EMPTY_RUNS: Record<string, SubagentPanelRun> = {};
/** 可用列表缓存时长：定义文件很少变，切页签不重复扫目录；「刷新」按钮强制重拉 */
const AGENTS_TTL_MS = 60_000;

export const useSubagentsStore = create<SubagentsState>((set, get) => ({
	agentsBySession: {},
	runsBySession: {},
	focusRunId: null,
	draftAgent: null,

	loadAgents: async (sessionId, force = false) => {
		const current = get().agentsBySession[sessionId] ?? EMPTY_ENTRY;
		if (current.loading) return;
		if (!force && current.snapshot && Date.now() - current.loadedAt < AGENTS_TTL_MS) return;
		set((state) => ({
			agentsBySession: { ...state.agentsBySession, [sessionId]: { ...current, loading: true, error: null } },
		}));
		try {
			const snapshot = await getPi().listSessionSubagents(sessionId);
			set((state) => ({
				agentsBySession: {
					...state.agentsBySession,
					[sessionId]: { snapshot, loading: false, error: null, loadedAt: Date.now() },
				},
			}));
		} catch (error) {
			set((state) => ({
				agentsBySession: {
					...state.agentsBySession,
					[sessionId]: {
						...(state.agentsBySession[sessionId] ?? EMPTY_ENTRY),
						loading: false,
						error: error instanceof Error ? error.message : String(error),
					},
				},
			}));
		}
	},

	hydrateRuns: async (sessionId) => {
		try {
			const runs = await getPi().listSubagentRuns(sessionId);
			set((state) => {
				const merged: Record<string, SubagentPanelRun> = {
					...(state.runsBySession[sessionId] ?? EMPTY_RUNS),
				};
				for (const run of runs) merged[run.runId] = run;
				return { runsBySession: { ...state.runsBySession, [sessionId]: merged } };
			});
		} catch {
			// 补水失败不阻塞：事件流仍会把后续变化推过来
		}
	},

	applyRun: (sessionId, run) =>
		set((state) => ({
			runsBySession: {
				...state.runsBySession,
				[sessionId]: { ...(state.runsBySession[sessionId] ?? EMPTY_RUNS), [run.runId]: run },
			},
		})),

	dispatch: async (sessionId, input) => {
		const receipt = await getPi().dispatchSubagents(sessionId, input);
		// 事件可能先于回执到达；回执里的记录只在没有更新的版本时落入
		set((state) => {
			const current = { ...(state.runsBySession[sessionId] ?? EMPTY_RUNS) };
			for (const run of receipt.runs) if (!current[run.runId]) current[run.runId] = run;
			return { runsBySession: { ...state.runsBySession, [sessionId]: current } };
		});
		return receipt;
	},

	abort: (runId) => getPi().abortSubagentRun(runId),
	focusRun: (runId) => set({ focusRunId: runId }),
	setDraftAgent: (agent) => set({ draftAgent: agent }),
	clearSession: (sessionId) =>
		set((state) => {
			const agentsBySession = { ...state.agentsBySession };
			const runsBySession = { ...state.runsBySession };
			delete agentsBySession[sessionId];
			delete runsBySession[sessionId];
			return { agentsBySession, runsBySession };
		}),
}));

/** 本会话运行（新的在前）；无会话返回稳定空数组 */
const EMPTY_LIST: SubagentPanelRun[] = [];
export function selectSessionRuns(state: SubagentsState, sessionId: string | null): SubagentPanelRun[] {
	if (!sessionId) return EMPTY_LIST;
	const runs = state.runsBySession[sessionId];
	if (!runs) return EMPTY_LIST;
	return Object.values(runs).sort((a, b) => b.createdAt - a.createdAt);
}

/** 页签徽标：运行中（含需要回复 / 等待审批）计数 + 是否需要用户（琥珀） */
export function summarizeRuns(runs: readonly SubagentPanelRun[]): {
	active: number;
	queued: number;
	attention: boolean;
} {
	let active = 0;
	let queued = 0;
	let attention = false;
	for (const run of runs) {
		if (run.status === "queued") queued++;
		else if (!isSubagentRunSettled(run.status)) active++;
		if (isSubagentRunAttention(run.status)) attention = true;
	}
	return { active, queued, attention };
}

/** 审批请求 → 归因的面板运行（审批坞来源胶囊 / 「查看该运行」） */
export function findRunForApproval(
	runs: readonly SubagentPanelRun[],
	requestId: string,
): SubagentPanelRun | undefined {
	return runs.find((run) => run.pendingApprovalIds.includes(requestId));
}

/** 审批坞用：某个审批请求归因到的面板运行（无则 undefined） */
export function useApprovalRun(
	sessionId: string | null,
	requestId: string | null,
): SubagentPanelRun | undefined {
	const runsRecord = useSubagentsStore((s) => (sessionId ? s.runsBySession[sessionId] : undefined));
	return useMemo(() => {
		if (!runsRecord || !requestId) return undefined;
		return findRunForApproval(Object.values(runsRecord), requestId);
	}, [runsRecord, requestId]);
}
