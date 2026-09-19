import type { ProgressDisplay } from "../progress-display";
import type { ChatRow } from "./chat-rows";
import { type SummarySegment, summarizeCategories } from "./meta-summary";

/**
 * 过程块（ProcessBlock）：把一轮里「阶段说明 + 折叠工具组」这些连续的过程性行折成一个可整体收起的段。
 *
 * 消息流只讲结论——用户消息、正文、子代理结果、轮末页脚都保持独立行；夹在中间的过程行
 * （metaGroup / 只有 progress 没有正文的 assistant 消息）在渲染层合并为一个 ProcessBlock：
 *   - 运行中自动展开（用户能看到实时活动）；结束后默认收成一行摘要（N 阶段 · 工具分类汇总）；
 *   - 单独一条 metaGroup 且没有阶段说明时不包（它本身已经是一行）。
 *
 * 纯函数、零 React：桌面 MessageList 与 lan-web ChatView 共用，保证两端过程呈现一致。
 */
export interface ProcessSegment {
	kind: "process";
	key: string;
	/** 段内原始行（渲染层按原规则逐行渲染，保住 MetaGroup 的实时 working 行为） */
	rows: ChatRow[];
	/** 段内是否有仍在工作的折叠组（决定自动展开） */
	working: boolean;
	/** 阶段说明条数（progress 行） */
	stages: number;
	/** 工具调用总数（不含 subagent，见 meta-summary EXCLUDED_TOOLS） */
	tools: number;
	/** 子代理数 */
	subagents: number;
	/** 工具分类汇总（首见顺序） */
	categories: SummarySegment[];
	/** 最新一条阶段说明（收起态摘要用） */
	latestStage?: ProgressDisplay;
	/** 运行中的实时状态文本（来自最新折叠组） */
	statusText?: string;
}

export type ChatRowOrProcess = ChatRow | ProcessSegment;

function isProgressRow(row: ChatRow): row is Extract<ChatRow, { kind: "message" }> {
	return (
		row.kind === "message" &&
		row.message.kind === "assistant" &&
		Boolean(row.message.progress) &&
		!row.message.text
	);
}

/** 任务视图消息（task_plan 结果）在聊天流里不渲染，只喂右侧面板——不能把一段过程劈成两块 */
function isTaskViewRow(row: ChatRow): boolean {
	return row.kind === "message" && row.message.kind === "assistant" && Boolean(row.message.taskView);
}

function isProcessRow(row: ChatRow): boolean {
	return row.kind === "metaGroup" || isProgressRow(row) || isTaskViewRow(row);
}

function buildSegment(rows: ChatRow[]): ProcessSegment {
	const metaRows = rows.filter((r): r is Extract<ChatRow, { kind: "metaGroup" }> => r.kind === "metaGroup");
	const items = metaRows.flatMap((r) => r.items);
	const subagents = metaRows.reduce((sum, r) => sum + r.subagentCount, 0);
	const categories = summarizeCategories(items, subagents);
	const tools = categories.filter((c) => c.category !== "subagent").reduce((sum, c) => sum + c.count, 0);
	const stageRows = rows.filter(isProgressRow);
	const last = stageRows[stageRows.length - 1];
	const latestStage = last && last.message.kind === "assistant" ? last.message.progress : undefined;
	const working = metaRows.some((r) => r.working);
	const statusText = [...metaRows].reverse().find((r) => r.statusText)?.statusText;
	return {
		kind: "process",
		key: `process-${rows[0]?.key ?? "empty"}`,
		rows,
		working,
		stages: stageRows.length,
		tools,
		subagents,
		categories,
		...(latestStage ? { latestStage } : {}),
		...(statusText ? { statusText } : {}),
	};
}

/**
 * 把 buildChatRows 的行序列折成「结论行 + 过程段」。
 * 只有一条 metaGroup 且没有阶段说明的段保持原行（避免一行套一行）。
 */
export function groupProcessRows(rows: ChatRow[]): ChatRowOrProcess[] {
	const out: ChatRowOrProcess[] = [];
	let pending: ChatRow[] = [];
	const flush = () => {
		if (pending.length === 0) return;
		if (pending.length === 1 && pending[0]?.kind === "metaGroup") {
			out.push(pending[0]);
		} else {
			out.push(buildSegment(pending));
		}
		pending = [];
	};
	for (const row of rows) {
		if (isProcessRow(row)) {
			pending.push(row);
			continue;
		}
		flush();
		out.push(row);
	}
	flush();
	return out;
}
