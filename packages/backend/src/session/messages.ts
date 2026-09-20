import {
	extractSubagentRuns,
	type ImageInput,
	isSubagentRunSettled,
	type PublicProgressStep,
	parseExpandedSkillInvocation,
	progressDisplay,
	publicTimeline,
	reportedUsage,
	type SessionMessage,
	type SessionToolCall,
	SUBAGENT_DISPATCH_CUSTOM_TYPE,
	SUBAGENT_RESULT_CUSTOM_TYPE,
	type SubagentPanelRun,
	type SubagentRunData,
	subagentDispatchRecordFromUnknown,
	subagentResultRecordFromUnknown,
	subagentRunDataFromPanelRun,
	taskStatusDisplay,
} from "@drone/shared";
import { parseSessionEntries, type SessionEntry, type SessionManager } from "@earendil-works/pi-coding-agent";

/**
 * pi 消息 → 中立 SessionMessage 的纯函数集（历史回放 / fork / recall / 导出共用）。
 * 不依赖 PiBackend 实例状态，可独立单测（见 test/recall.test.ts）。
 */

/** 消息 content 块（pi-ai 结构，仅读取所需字段） */
export interface ContentBlock {
	type: string;
	text?: string;
	thinking?: string;
	id?: string;
	name?: string;
	arguments?: Record<string, unknown>;
	data?: string;
	mimeType?: string;
}

export interface RawMessage {
	role: string;
	content?: string | ContentBlock[];
	toolCallId?: string;
	isError?: boolean;
	timestamp?: number;
	/** 工具结果结构化详情（show_image 在此带图片；模型不可见） */
	details?: unknown;
	/** toolResult 消息的工具名（getTodos 扫 todo 结果用） */
	toolName?: string;
	/** custom 消息的自定义类型（getTodos 扫 todo-reminder 恢复消息用） */
	customType?: string;
	/** LLM 停因（assistant 消息；"error" 时历史回放产错误卡；旧会话文件无此字段 → undefined） */
	stopReason?: string;
	/** LLM 错误详情（stopReason==="error" 时存在） */
	errorMessage?: string;
}

/** show_image toolResult.details → { images, paths }（兼容旧单图 { path, image } 形状；不符返回 null） */
function showImageFromDetails(details: unknown): { images: ImageInput[]; paths: string[] } | null {
	const d = details as { paths?: unknown; images?: unknown; path?: unknown; image?: unknown } | undefined;
	const toImage = (raw: unknown): ImageInput | null => {
		const img = raw as { data?: unknown; mimeType?: unknown } | undefined;
		if (typeof img?.data !== "string" || typeof img?.mimeType !== "string") return null;
		return { data: img.data, mimeType: img.mimeType };
	};
	if (Array.isArray(d?.images)) {
		const images = d.images.map(toImage).filter((img): img is ImageInput => img !== null);
		if (images.length === 0) return null;
		const paths = Array.isArray(d?.paths) ? d.paths.filter((p): p is string => typeof p === "string") : [];
		return { images, paths };
	}
	const legacy = toImage(d?.image);
	if (!legacy) return null;
	return { images: [legacy], paths: typeof d?.path === "string" ? [d.path] : [] };
}

export function blockText(content: string | ContentBlock[] | undefined): string {
	if (typeof content === "string") return content;
	return (content ?? [])
		.filter((c) => c.type === "text" && c.text)
		.map((c) => c.text ?? "")
		.join("");
}

export function blockThinking(content: ContentBlock[] | undefined): string {
	return (content ?? [])
		.filter((c) => c.type === "thinking" && c.thinking)
		.map((c) => c.thinking ?? "")
		.join("");
}

export function blockToolCalls(
	content: ContentBlock[] | undefined,
): Array<{ tool: SessionToolCall; index: number }> {
	return (content ?? [])
		.map((c, index) => ({ c, index }))
		.filter(({ c }) => c.type === "toolCall" && c.id)
		.map(({ c, index }) => ({
			tool: {
				blockIndex: index,
				id: c.id ?? "",
				name: c.name ?? "tool",
				args: JSON.stringify(c.arguments ?? {}),
				output: "",
				isError: false,
			},
			index,
		}));
}

export function blockImages(content: string | ContentBlock[] | undefined): ImageInput[] {
	if (typeof content === "string") return [];
	return (content ?? [])
		.filter((c) => c.type === "image" && c.data)
		.map((c) => ({ data: c.data as string, mimeType: (c.mimeType as string) ?? "image/png" }));
}

/**
 * 解析撤回目标 user entry：entryId 直接校验（非 user 消息拒绝）；否则按 text（+timestamp
 * 优先比对）从分支尾部向前匹配最近一条 user 消息 entry（实时消息无 entryId 时兜底）。
 * 导出供单测：只依赖 SessionManager 的只读接口。
 */
export function resolveRecallEntryId(
	sm: Pick<SessionManager, "getEntry" | "getBranch">,
	ref: { entryId?: string; text?: string; timestamp?: number },
): string {
	if (ref.entryId) {
		const e = sm.getEntry(ref.entryId);
		if (!e) throw new Error("Recall target message not found");
		if (e.type !== "message" || (e.message as RawMessage).role !== "user") {
			throw new Error("Recall target is not a user message");
		}
		return ref.entryId;
	}
	if (ref.text !== undefined || ref.timestamp !== undefined) {
		const branch = sm.getBranch();
		for (let i = branch.length - 1; i >= 0; i--) {
			const e = branch[i];
			if (e?.type !== "message") continue;
			const m = e.message as RawMessage;
			if (m.role !== "user") continue;
			// timestamp 同时给出时必须相等（毫秒碰撞军见，双重锚定防同文消息错配）
			if (ref.timestamp !== undefined && m.timestamp !== ref.timestamp) continue;
			if (ref.text !== undefined && blockText(m.content) !== ref.text) continue;
			return e.id;
		}
	}
	throw new Error("Recall target message not found");
}

/** 解析 fork 目标 entry：entryId 直接校验；否则按正文文本从分支尾部向前匹配 assistant 消息 */
export function resolveForkEntryId(
	sm: Pick<SessionManager, "getEntry" | "getBranch">,
	ref: { entryId?: string; text?: string },
): string {
	if (ref.entryId) {
		const e = sm.getEntry(ref.entryId);
		if (e) {
			// 只接受 assistant 消息作为 fork 点（与 text 分支同语义）；user/tool 条目拒绝防破坏分支结构（B7）
			if (e.type !== "message" || (e.message as RawMessage).role !== "assistant") {
				throw new Error("Fork target is not an assistant message");
			}
			return ref.entryId;
		}
		// entryId 未命中（如实时消息 entryId 缺失/已失效）→ 走 text 兑底
	}
	if (ref.text) {
		const branch = sm.getBranch();
		for (let i = branch.length - 1; i >= 0; i--) {
			const e = branch[i];
			if (e?.type !== "message") continue;
			const m = e.message as RawMessage;
			if (m.role !== "assistant") continue;
			if (blockText(m.content) === ref.text) return e.id;
		}
	}
	throw new Error("Fork target message not found");
}

/**
 * 只读解析会话文件内容（LAN 历史会话透视用）：不走 SessionManager.open（可能迁移写盘），
 * 纯函数 parseSessionEntries + 从文件末尾（leaf tip）沿 parentId 回溯出当前分支。
 * 分支语义与 getBranch() 一致：只保留当前分支上的消息。
 */
export function readSessionMessagesFromContent(content: string): SessionMessage[] {
	const entries = parseSessionEntries(content);
	// 当前分支：从最后一条 entry（leaf）沿 parentId 回溯
	const byId = new Map<string, (typeof entries)[number]>();
	for (const entry of entries) {
		if (entry.type !== "session") byId.set(entry.id, entry);
	}
	const branch: (typeof entries)[number][] = [];
	let cursor = entries.length > 0 ? entries[entries.length - 1] : null;
	while (cursor && cursor.type !== "session") {
		branch.unshift(cursor);
		cursor = cursor.parentId ? (byId.get(cursor.parentId) ?? null) : null;
	}
	const raw = branch.flatMap((entry): unknown[] => {
		if (entry.type === "message") return [entry.message];
		if (entry.type === "custom_message")
			return [{ ...entry, role: "custom", timestamp: new Date(entry.timestamp).getTime() }];
		const panel = subagentPanelRawMessage(entry);
		return panel ? [panel] : [];
	});
	return toSessionMessages(raw);
}

/** 子智能体面板的 custom entry（派发 / 结果记录，模型不可见）→ 中立 raw custom 消息；其余返回 null */
function subagentPanelRawMessage(entry: {
	type: string;
	customType?: unknown;
	data?: unknown;
	timestamp?: string;
}): RawMessage | null {
	if (entry.type !== "custom" || typeof entry.customType !== "string") return null;
	if (entry.customType !== SUBAGENT_DISPATCH_CUSTOM_TYPE && entry.customType !== SUBAGENT_RESULT_CUSTOM_TYPE)
		return null;
	return {
		role: "custom",
		customType: entry.customType,
		details: entry.data,
		timestamp: entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now(),
	};
}

/** 会话树分支里的面板记录（live 会话的 session.messages 不含 custom entry，需另行并回消息流） */
export function subagentPanelRawMessages(branch: readonly SessionEntry[]): RawMessage[] {
	return branch.map(subagentPanelRawMessage).filter((message): message is RawMessage => message !== null);
}

export interface ToSessionMessagesOptions {
	/**
	 * 仍在进程内运行的面板 runId：回放时这些运行保持原状态；其余未到终态的运行按「已中止」
	 * （进程重启 / 会话重开时子会话已不存在）显示。
	 */
	liveSubagentRunIds?: ReadonlySet<string>;
}

/**
 * pi 消息 → 中立 SessionMessage 列表。
 * toolResult 消息单独出现（带 toolCallId），把输出回填到对应工具卡片。
 */
export function toSessionMessages(
	rawMessages: readonly unknown[],
	options: ToSessionMessagesOptions = {},
): SessionMessage[] {
	const out: SessionMessage[] = [];
	const toolById = new Map<string, SessionToolCall>();
	// 面板派发运行：派发记录建行，结果记录（custom 消息或 entry）原地更新同一行里的同一 run
	const panelRuns = new Map<string, { runs: SubagentRunData[]; index: number }>();
	const upsertPanelRun = (run: SubagentPanelRun, timestamp: number) => {
		const data = subagentRunDataFromPanelRun(run);
		const existing = panelRuns.get(run.runId);
		if (existing) {
			existing.runs[existing.index] = data;
			return;
		}
		const row = out.find(
			(message): message is Extract<SessionMessage, { role: "subagent" }> =>
				message.role === "subagent" && message.runs.some((item) => item.panel?.dispatchId === run.dispatchId),
		);
		if (row) {
			row.runs.push(data);
			panelRuns.set(run.runId, { runs: row.runs, index: row.runs.length - 1 });
			return;
		}
		const runs = [data];
		out.push({ role: "subagent", runs, timestamp });
		panelRuns.set(run.runId, { runs, index: 0 });
	};
	// Pair completed public status with its declaring assistant, not result arrival order.
	// A later user turn cannot supply a result for an older status call.
	const progressByMessage = new WeakMap<RawMessage, PublicProgressStep[]>();
	const owners = new Map<string, { message: RawMessage; blockIndex: number }>();
	const pairedStatuses = new Set<RawMessage>();
	for (const raw of rawMessages as RawMessage[]) {
		if (raw.role === "user") owners.clear();
		if (raw.role === "assistant" && Array.isArray(raw.content))
			for (const [blockIndex, block] of raw.content.entries()) {
				if (block.type === "toolCall" && block.name === "set_status" && block.id)
					owners.set(block.id, { message: raw, blockIndex });
			}
		if (raw.role !== "toolResult" || raw.toolName !== "set_status" || !raw.toolCallId) continue;
		const owner = owners.get(raw.toolCallId);
		if (!owner) continue;
		pairedStatuses.add(raw);
		const progress = raw.isError ? undefined : progressDisplay(raw.details);
		const existing = (progressByMessage.get(owner.message) || []).filter(
			(step) => step.id !== raw.toolCallId,
		);
		if (progress) existing.push({ id: raw.toolCallId, blockIndex: owner.blockIndex, progress });
		progressByMessage.set(owner.message, existing);
	}
	let responseIndex = 0;

	for (const raw of rawMessages as RawMessage[]) {
		// 面板派发 / 结果记录（其余 custom 消息照旧走宿主状态展示等既有分支）
		if (raw.role === "custom" && raw.customType === SUBAGENT_DISPATCH_CUSTOM_TYPE) {
			const record = subagentDispatchRecordFromUnknown(raw.details);
			for (const run of record?.runs ?? []) upsertPanelRun(run, raw.timestamp ?? Date.now());
			continue;
		}
		if (raw.role === "custom" && raw.customType === SUBAGENT_RESULT_CUSTOM_TYPE) {
			const record = subagentResultRecordFromUnknown(raw.details);
			// followUp custom 消息出现在上下文里 = 已进入上下文；entry（未勾选 followUp）保持 none
			if (record)
				upsertPanelRun(
					{ ...record.run, contextState: record.run.followUp ? "delivered" : "none" },
					raw.timestamp ?? Date.now(),
				);
			continue;
		}
		const report = taskStatusDisplay(raw);
		if (report) {
			out.push({
				role: "assistant",
				hostStatus: true,
				...(report.taskView ? { taskView: report.taskView } : {}),
				text: report.text,
				timestamp: report.timestamp,
				thinking: "",
				tools: [],
				images: [],
			});
			continue;
		}
		if (raw.role === "user") {
			const sourceText = blockText(raw.content);
			const invocation = parseExpandedSkillInvocation(sourceText);
			out.push({
				role: "user",
				text: invocation ? (invocation.args ?? "") : sourceText,
				thinking: "",
				tools: [],
				images: blockImages(raw.content),
				timestamp: raw.timestamp ?? Date.now(),
				...(invocation ? { skill: { name: invocation.name, args: invocation.args }, sourceText } : {}),
			});
			continue;
		}
		if (raw.role === "assistant") {
			const usage = reportedUsage(raw);
			const cycleId = `response-${responseIndex++}`;
			const content = Array.isArray(raw.content) ? raw.content : [];
			const toolBlocks = blockToolCalls(content).filter((block) => block.tool.name !== "set_status");
			const tools = toolBlocks.map((b) => b.tool);
			for (const tool of tools) toolById.set(tool.id, tool);
			const text = blockText(raw.content);
			// 正文后的工具（块序在首个 text 块之后，同 turn 内 text→toolCall 交错）：拆成独立 meta 消息
			// 排在正文消息之后，与 renderer finalizeStreaming 的拆分一致——否则渲染时会被倒挂到正文上方
			const textIndex = content.findIndex((c) => c?.type === "text" && c.text);
			const steps = progressByMessage.get(raw);
			if (steps?.length) {
				const parts = publicTimeline({
					text,
					thinking: blockThinking(content),
					tools,
					steps,
					textBlockIndex: textIndex < 0 ? null : textIndex,
				});
				for (const [index, part] of parts.entries())
					out.push({
						role: "assistant",
						cycleId,
						text: part.kind === "text" ? part.text : "",
						thinking: part.kind === "meta" ? part.thinking : "",
						tools: part.kind === "meta" ? part.tools : [],
						images: [],
						timestamp: raw.timestamp ?? Date.now(),
						...(part.kind === "progress" ? { progress: part.progress } : {}),
						...(index === 0 && usage ? { usage } : {}),
						...(index === parts.length - 1 && raw.stopReason ? { stopReason: raw.stopReason } : {}),
						...(index === parts.length - 1 && raw.errorMessage ? { errorMessage: raw.errorMessage } : {}),
					});
				continue;
			}

			const postBlocks = text && textIndex >= 0 ? toolBlocks.filter((b) => b.index > textIndex) : [];
			if (postBlocks.length > 0) {
				const preTools = toolBlocks.filter((b) => b.index < textIndex).map((b) => b.tool);
				const timestamp = raw.timestamp ?? Date.now();
				if (text || preTools.length > 0) {
					out.push({
						role: "assistant",
						...(usage ? { usage } : {}),
						cycleId,
						text,
						thinking: blockThinking(content),
						tools: preTools,
						images: [],
						timestamp,
					});
				}
				out.push({
					role: "assistant",
					text: "",
					thinking: "",
					cycleId,
					tools: postBlocks.map((b) => b.tool),
					images: [],
					timestamp,
				});
				continue;
			}
			const message: SessionMessage = {
				role: "assistant",
				...(usage ? { usage } : {}),
				cycleId,
				text,
				thinking: blockThinking(content),
				tools,
				images: [],
				timestamp: raw.timestamp ?? Date.now(),
				...(raw.stopReason ? { stopReason: raw.stopReason } : {}),
				...(typeof raw.errorMessage === "string" && raw.errorMessage.length > 0
					? { errorMessage: raw.errorMessage }
					: {}),
			};
			// 错误轮次（LLM 请求失败）text/thinking/tools 全空，但错误信息必须在回放中可见——
			// 否则历史回放产不出错误卡（live 产卡与回放必须一致，spec §2 原则 1）
			if (
				message.text ||
				message.thinking ||
				message.tools.length > 0 ||
				message.stopReason === "error" ||
				message.usage
			) {
				out.push(message);
			}
			continue;
		}
		if (raw.role === "toolResult") {
			if (raw.toolName === "set_status" && !raw.isError && !pairedStatuses.has(raw)) {
				const progress = progressDisplay(raw.details);
				if (progress)
					out.push({
						role: "assistant",
						text: "",
						thinking: "",
						tools: [],
						images: [],
						timestamp: raw.timestamp ?? Date.now(),
						progress,
					});
			}
			const tool = raw.toolCallId ? toolById.get(raw.toolCallId) : undefined;
			if (tool) {
				tool.output = blockText(raw.content);
				tool.isError = raw.isError === true;
				// 工具执行结束时刻（entry 自带；轮次计时 deriveTurnTimings 的历史回放数据源）
				if (typeof raw.timestamp === "number") tool.endedAt = raw.timestamp;
				// edit：unified patch 提取进 SessionToolCall.diff（diff 侧栏历史回放数据源；模型不可见）
				if (tool.name === "edit" && !tool.isError) {
					const patch = (raw.details as { patch?: unknown } | undefined)?.patch;
					if (typeof patch === "string" && patch.length > 0) tool.diff = patch;
				}
				// show_image：图片从 details 提取为独立图片消息（紧随其 assistant 消息之后）
				if (tool.name === "show_image" && !tool.isError) {
					const shown = showImageFromDetails(raw.details);
					if (shown) {
						out.push({
							role: "image",
							images: shown.images,
							paths: shown.paths,
							timestamp: raw.timestamp ?? Date.now(),
						});
					}
				}
				// subagent：details 带 results/sessionFile → 独立子代理消息（结构检测，不依赖工具名）
				if (!tool.isError) {
					const runs = extractSubagentRuns(raw.details);
					if (runs) {
						out.push({
							role: "subagent",
							runs,
							timestamp: raw.timestamp ?? Date.now(),
						});
					}
				}
			}
		}
	}
	// 未到终态且不在进程内的面板运行：子会话已随进程 / 会话消失，按已中止显示（不算失败）
	for (const [runId, slot] of panelRuns) {
		const data = slot.runs[slot.index];
		const panel = data?.panel;
		if (!data || !panel || isSubagentRunSettled(panel.status) || options.liveSubagentRunIds?.has(runId))
			continue;
		const aborted: SubagentPanelRun = {
			...panel,
			status: "aborted",
			queuePosition: undefined,
			pendingApprovalIds: [],
		};
		slot.runs[slot.index] = subagentRunDataFromPanelRun(aborted);
	}
	return out;
}

/**
 * 配对消息与会话树 entry id（assistant 供 fork 定位、user 供撤回定位）：branch 上
 * 同角色消息 entry 按 timestamp 建队列，与上下文消息同序消费；compaction 只截断更早
 * entry，不影响配对。user/assistant 分开建表，避免同 ms 碰撞时串角色。
 * 原地修改 messages 的 entryId 字段。
 */
export function assignEntryIds(messages: SessionMessage[], branch: readonly SessionEntry[]): void {
	const assistantByTimestamp = new Map<number, string[]>();
	const userByTimestamp = new Map<number, string[]>();
	for (const e of branch) {
		if (e.type !== "message") continue;
		const m = e.message as RawMessage;
		if (typeof m.timestamp !== "number") continue;
		const table = m.role === "assistant" ? assistantByTimestamp : m.role === "user" ? userByTimestamp : null;
		if (!table) continue;
		const queue = table.get(m.timestamp);
		if (queue) queue.push(e.id);
		else table.set(m.timestamp, [e.id]);
	}
	for (const message of messages) {
		// 无正文的拆分消息（同 turn 正文后的工具组）不参与配对：无 fork 按钮不消费 entry 队列，
		// 避免挤占后续正文消息的 entryId（同 ms timestamp 碰撞时）
		if (message.role === "assistant") {
			if (!message.text || message.hostStatus) continue;
			const id = assistantByTimestamp.get(message.timestamp)?.shift();
			if (id) message.entryId = id;
			continue;
		}
		if (message.role === "user") {
			const id = userByTimestamp.get(message.timestamp)?.shift();
			if (id) message.entryId = id;
		}
	}
}
