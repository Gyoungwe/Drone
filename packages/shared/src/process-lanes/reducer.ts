import type { UIMessage } from "../transcript/types";
import { workflowStage } from "../workflow-catalog";
import { deriveProcessEvents } from "./events";
import type {
	ProcessEvent,
	ProcessLaneId,
	ProcessLaneState,
	ProcessNode,
	ProcessNodeId,
	ProcessText,
} from "./types";

export const textPair = (zh: string, en = zh): ProcessText => ({ zh, en });
const reasonLine = (reason: string): ProcessText => {
	const labels: Record<string, ProcessText> = {
		"task-authorization-required": textPair(
			"等待你确认任务范围",
			"Waiting for you to confirm the task scope",
		),
		"task-selection-required": textPair(
			"等待你选择要继续的任务",
			"Waiting for you to choose a task to continue",
		),
		"reconcile-before-retry": textPair(
			"先核对上一次操作结果",
			"Check the previous operation before retrying",
		),
		"stage-budget": textPair(
			"本阶段暂告一段落，当前结果已保留",
			"This stage is paused; current results are kept",
		),
		"total-budget": textPair("已达到本次任务的执行上限", "The execution limit for this task was reached"),
		"binding-changed": textPair("知识库绑定已变化，请重新读取", "The knowledge base changed; read it again"),
		waiting_user: textPair("等待你处理一项请求", "Waiting for you to handle a request"),
	};
	return labels[reason] ?? textPair("需要先处理一项请求", "A request needs attention first");
};
export function initialProcessLaneState(): ProcessLaneState {
	return {
		lanes: [
			{ id: "entry", empty: "等一句话进来" },
			{ id: "gate", empty: "这一轮没停过" },
			{ id: "execution", empty: "还没开工" },
			{ id: "evidence", empty: "这一轮没查文献" },
			{ id: "deposit", empty: "没有写入知识库" },
			{ id: "answer", empty: "还没到回答" },
		],
		nodes: [],
		edges: [],
		current: null,
		turnIndex: -1,
		reads: [],
		statusQuery: false,
		taskId: null,
	};
}
const stopLines = (reason: string): ProcessNode["lines"] => [
	textPair("等待应用完成处理", "Waiting for the application to finish"),
	reasonLine(reason),
	textPair("这条消息不会自动重试", "This message will not retry automatically"),
];
const knownStages: Record<string, [ProcessNodeId, ProcessLaneId, string, string]> = {
	local_query_recorded: ["local", "evidence", "本地查询已记录", "Local query recorded"],
	sources_inspected: ["inspect", "evidence", "来源核对已记录", "Source inspection recorded"],
	sources_archived: ["archived", "evidence", "原文归档已记录", "Source archive recorded"],
	sources_reused: ["archived", "evidence", "已有来源复用已记录", "Source reuse recorded"],
	claims_bound: ["bound", "evidence", "主张绑定已记录", "Claim binding recorded"],
	answerable: ["answer", "answer", "已收到可用于回答的信息", "Answerable information received"],
};
/** Pure, immutable projection. It neither grants consent nor verifies files. */
export function reduceProcessEvent(previous: ProcessLaneState, event: ProcessEvent): ProcessLaneState {
	let state: ProcessLaneState = {
		...previous,
		nodes: previous.nodes.map((n) => ({ ...n })),
		edges: [...previous.edges],
		reads: [...previous.reads],
	};
	const put = (
		id: ProcessNodeId,
		lane: ProcessLaneId,
		lines: ProcessNode["lines"],
		fields: Partial<ProcessNode> = {},
	) => {
		const index = state.nodes.findIndex((n) => n.id === id);
		const node: ProcessNode = {
			...(index >= 0 ? state.nodes[index] : {}),
			id,
			lane,
			lines,
			state: "recorded",
			...fields,
		};
		if (index < 0) state.nodes.push(node);
		else state.nodes[index] = node;
		state.current = id;
	};
	const edge = (from: ProcessNodeId, to: ProcessNodeId, kind: "receipt" | "branch" = "receipt") => {
		if (
			!state.statusQuery &&
			state.nodes.some((n) => n.id === from) &&
			state.nodes.some((n) => n.id === to) &&
			!state.edges.some((e) => e.from === from && e.to === to)
		)
			state.edges.push({ from, to, kind });
	};
	const doing = (lines: ProcessNode["lines"]) => put("doing", "execution", lines, { state: "active" });
	const hostGate = (reason: string, from: ProcessNodeId = "doing") => {
		put(
			"hostGate",
			"gate",
			[
				textPair("等待应用完成处理", "Waiting for the application to finish"),
				textPair("需要你处理一项请求", "A request needs your attention"),
				reasonLine(reason),
			],
			{ state: "blocked", code: reason },
		);
		edge(from, "hostGate", "branch");
		doing(stopLines(reason));
		state.current = "hostGate";
	};
	const taskGate = (reason = "task-authorization-required") => {
		put(
			"taskGate",
			"gate",
			[
				textPair("保存文件前需要你确认", "Your confirmation is needed before saving files"),
				textPair("只读研究操作仍可继续", "Read-only research operations may continue"),
				reasonLine(reason),
			],
			{ state: "waiting", code: reason },
		);
		edge("picked", "taskGate", "branch");
		doing([
			textPair("等待确认", "Waiting for consent"),
			textPair("文件保存已暂停", "File saving is paused"),
			textPair("只读研究操作仍可继续", "Read-only research operations may continue"),
		]);
		state.current = "taskGate";
	};
	switch (event.type) {
		case "user-input":
			state.turnIndex++;
			state.reads = [];
			state.statusQuery = false;
			state.nodes = state.nodes.filter((n) => !["read", "cited", "check"].includes(n.id));
			state.edges = state.edges.filter(
				(e) => !["read", "cited", "check"].includes(e.from) && !["read", "cited", "check"].includes(e.to),
			);
			put("ask", "entry", [textPair(event.text.slice(0, 180)), textPair(""), textPair("")]);
			break;
		case "turn-route": {
			const route = event.route;
			state.statusQuery = route.intake === "status" || route.intake === "task-command";
			if (state.statusQuery) {
				if (route.landing === "host-gate") hostGate(route.host?.reason ?? "waiting_user", "picked");
				else
					doing([
						textPair("查看已有进度", "Reading saved progress"),
						textPair("节点选择保持原位", "Workflow selection is preserved"),
						textPair("这句不重试", "This question does not retry"),
					]);
				state.current = "doing";
				break;
			}
			if (!route.keptCheckpoint || route.intake === "new-topic" || route.intake === "read-only") {
				const ask = state.nodes.find((n) => n.id === "ask");
				state = { ...initialProcessLaneState(), turnIndex: state.turnIndex, nodes: ask ? [ask] : [] };
			}
			const selected = state.nodes.find((n) => n.id === "picked");
			// A continuation is a new public route explanation even when it keeps the
			// previous workflow. Refresh the picked node so the Process panel does not
			// show the older turn's route while the user is deciding what to do next.
			if (!selected || route.primary !== null || route.intake === "continuation") {
				const stage = route.stage ? workflowStage(route.stage) : undefined;
				const landing = {
					workflow: textPair("落点 · 工作流", "Landing · workflow"),
					"host-gate": textPair("落点 · 需要处理", "Landing · needs attention"),
					library: textPair("落点 · 文献只读", "Landing · read-only literature"),
					ordinary: textPair("落点 · 普通", "Landing · ordinary"),
				};
				put(
					"picked",
					"entry",
					[
						textPair(stage?.label.zh ?? "普通对话", stage?.label.en ?? "Ordinary conversation"),
						textPair(route.primary ?? "未选主技能", route.primary ?? "No primary workflow"),
						landing[route.landing],
					],
					{ route, code: "drone-turn-route" },
				);
			}
			edge("ask", "picked");
			if (route.landing === "workflow") {
				const de = route.stage === "de";
				doing(
					de
						? [
								textPair("先核对计数和设计", "Check counts and design first"),
								textPair("生物学重复要齐", "Biological replicates are required"),
								textPair("保存文件前需要任务授权", "Task authorization is required before saving files"),
							]
						: route.stage === "vault"
							? [
									textPair("已切换到知识库", "Switched to the knowledge base"),
									textPair("等待阅读结果", "Waiting for reading results"),
									textPair(
										"保存的知识不会自动作为引用",
										"Saved knowledge is not automatically used as a citation",
									),
								]
							: [
									textPair("已准备本轮使用的技能", "The workflow is ready for this turn"),
									textPair("这一轮还没执行", "No execution receipt this turn"),
									textPair("检索到的条目仍需阅读", "Retrieved items still need to be read"),
								],
				);
				edge("picked", "doing");
			} else if (route.landing === "library") {
				put("libGate", "gate", [
					textPair("只读复用已有文献", "Reuse existing literature read-only"),
					textPair("等待确认已读取的文献", "Waiting for confirmation that the literature was read"),
					textPair("当前为只读复用", "Read-only reuse is active"),
				]);
				edge("picked", "libGate", "branch");
			} else if (route.landing === "host-gate") hostGate(route.host?.reason ?? "waiting_user", "picked");
			break;
		}
		case "tool-receipt":
		case "subagent": {
			const old = state.nodes.find((n) => n.id === "doing");
			const receipts = [
				...(old?.receipts ?? []).filter((r) => r.id !== event.id),
				{ id: event.id, name: event.name, state: event.state },
			].slice(-64);
			if (state.statusQuery && old) put("doing", "execution", old.lines, { receipts });
			else
				doing(
					event.type === "tool-receipt" && event.hits
						? [
								textPair("搜到了，还没读", "Found a source; not read yet"),
								textPair("命中挂在正在做下面", "Hits stay with current activity"),
								textPair("不进本轮读过", "Not added to this turn's reads"),
							]
						: event.type === "tool-receipt" && event.name === "read" && event.state === "done"
							? [
									textPair("读取操作已记录", "Read operation recorded"),
									textPair("只读研究操作仍可继续", "Read-only research operations may continue"),
									textPair("保存文件前需要任务授权", "Task authorization is required before saving files"),
								]
							: [
									textPair("正在执行操作", "Running an operation"),
									textPair(
										event.state === "running"
											? "等待操作结果"
											: event.state === "error"
												? "操作失败，已保留记录"
												: "操作结果已收到",
										event.state === "running"
											? "Waiting for the operation result"
											: event.state === "error"
												? "Failed call recorded"
												: "Operation result received",
									),
									textPair("保存仍受任务授权约束", "Saving remains subject to task authorization"),
								],
				);
			const n = state.nodes.find((n) => n.id === "doing");
			if (n) n.receipts = receipts;
			if (event.type === "tool-receipt" && event.blockedReason) {
				if (["task-authorization-required", "task-selection-required"].includes(event.blockedReason))
					taskGate(event.blockedReason);
				else hostGate(event.blockedReason);
			}
			break;
		}
		case "task-view": {
			if (event.view.selectionRequired) {
				taskGate("task-selection-required");
				break;
			}
			const task = event.view.tasks.find((t) => t.id === event.view.activeTaskId);
			if (!task) break;
			state.taskId = task.id;
			if (task.reason === "task-authorization-required") {
				taskGate();
				break;
			}
			const gate = state.nodes.find((n) => n.id === "taskGate");
			if (gate && task.planApproved && gate.state !== "open") {
				put(
					"taskGate",
					"gate",
					[
						textPair("你已确认这次任务", "You approved this task"),
						textPair("已获得保存文件的授权", "Authorization to save files is active"),
						textPair("planApproved"),
					],
					{ state: "open", code: "planApproved", demo: event.demo },
				);
				if (!state.statusQuery)
					doing([
						textPair("按已确认的范围保存文件", "Saving files within the confirmed scope"),
						textPair("任务授权已确认", "Task authorization was confirmed"),
						textPair("哈希仍要核对", "Hashes still require checking"),
					]);
			}
			if (task.state === "blocked" || task.state === "waiting_user") hostGate(task.reason ?? "waiting_user");
			else if (state.nodes.find((n) => n.id === "hostGate")?.state === "blocked" && !state.statusQuery)
				put(
					"hostGate",
					"gate",
					[
						textPair("宿主已更新状态", "Host state updated"),
						textPair(task.state),
						textPair(task.reason ?? ""),
					],
					{ state: "open", code: task.reason ?? undefined },
				);
			break;
		}
		case "research-stage": {
			if (event.stage === "external_search_recorded") {
				doing([
					textPair("外部检索已记录", "External search recorded"),
					textPair("命中不算已读", "Search hits are not reads"),
					textPair("已记录当前处理阶段"),
				]);
				break;
			}
			const stage = knownStages[event.stage];
			if (!stage) break;
			put(
				stage[0],
				stage[1],
				[
					textPair(stage[2], stage[3]),
					textPair("以应用记录的结果为准", "Based on the recorded result"),
					textPair("已记录当前处理阶段"),
				],
				{ code: event.stage },
			);
			edge("doing", stage[0]);
			break;
		}
		case "knowledge-read":
			state.reads = [...state.reads.filter((r) => r.path !== event.read.path), event.read].slice(-128);
			put(
				"read",
				"evidence",
				[
					textPair(`本轮已读取 ${state.reads.length} 项`, `${state.reads.length} items read this turn`),
					textPair("已记录读取时的文件校验信息", "Read-time file checks recorded"),
					textPair("这些内容可用于当前回答"),
				],
				{ paths: state.reads.map((r) => r.path) },
			);
			edge("doing", "read");
			// A newer read invalidates any prior citation display until the next host check.
			state.nodes = state.nodes.filter((n) => n.id !== "cited" && n.id !== "check");
			state.edges = state.edges.filter((e) => e.from !== "cited" && e.to !== "cited" && e.to !== "check");
			break;
		case "deposit":
			put(
				"deposit",
				"deposit",
				[
					textPair("知识已保存", "Knowledge saved"),
					textPair(
						"保存的知识不会自动作为本轮引用",
						"Saved knowledge is not automatically cited in this turn",
					),
					textPair(`内容类型：${event.kind}`, `Content type: ${event.kind}`),
				],
				{ paths: event.path ? [event.path] : [] },
			);
			edge("doing", "deposit");
			break;
		case "wiki":
		case "zotero":
			put(event.type, "deposit", [
				textPair(
					event.type === "wiki" ? "Wiki 建议已生成" : "Zotero 记录已保存",
					event.type === "wiki" ? "Wiki proposal receipt" : "Separate Zotero receipt",
				),
				textPair(event.status),
				textPair(
					event.type === "wiki" ? "尚未经过人工批准" : "与知识库记录分别保存",
					event.type === "wiki" ? "Does not imply human approval" : "Separate from Vault receipt",
				),
			]);
			edge("doing", event.type);
			break;
		case "answer-check": {
			const paths = [
				...new Set(
					event.sources
						.filter((s) => state.reads.some((r) => r.path === s.path && r.hash === s.hash))
						.map((s) => s.path),
				),
			].slice(0, 12);
			state.nodes = state.nodes.filter((n) => n.id !== "cited");
			state.edges = state.edges.filter((e) => e.from !== "cited" && e.to !== "cited");
			if (paths.length) {
				put(
					"cited",
					"answer",
					[
						textPair(`${paths.length} 条 [[路径]]`, `${paths.length} [[paths]]`),
						textPair("本轮已读且校验哈希一致", "Read this turn; checked hashes match"),
						textPair("最多 12 条", "At most 12"),
					],
					{ paths },
				);
				edge("read", "cited");
			}
			put(
				"check",
				"answer",
				[
					textPair(
						event.ok ? (event.warning ? "回答校验有提醒" : "回答校验通过") : "回答校验未通过",
						event.ok
							? event.warning
								? "Answer checked with warnings"
								: "Answer check passed"
							: "Answer check failed",
					),
					textPair(event.reason ?? "scientificallyVerified=false"),
					textPair("不代表科学验证", "Does not imply scientific verification"),
				],
				{ state: event.ok && !event.warning ? "recorded" : "blocked", code: event.reason },
			);
			edge("cited", "check");
			break;
		}
	}
	return state;
}
export function deriveProcessLaneState(messages: readonly UIMessage[]): ProcessLaneState {
	return deriveProcessEvents(messages).reduce(reduceProcessEvent, initialProcessLaneState());
}
/** Historical turn snapshots include inherited workflow/gates but fresh turn-scoped reads. */
export function deriveProcessLaneTurns(messages: readonly UIMessage[]): ProcessLaneState[] {
	const turns: ProcessLaneState[] = [];
	let state = initialProcessLaneState();
	for (const event of deriveProcessEvents(messages)) {
		state = reduceProcessEvent(state, event);
		if (state.turnIndex >= 0) turns[state.turnIndex] = state;
	}
	return turns;
}
