import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { registerWorkbench } from "./register.mjs";

export const TASK_ENTRY = "drone-task-checkpoint-v1";
const CONTROL = new Set(["set_status", "todo", "capability_load", "task_status", "research_task_status"]);
const READ =
	/^(?:read|grep|find|ls|research_(?:read_|search_|check_answer|wiki_navigate|knowledge_status|zotero_status))/;
const safe = (value, length = 180) =>
	String(value ?? "")
		.replace(/(?:bearer\s+|(?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi, "[redacted]")
		.split("")
		.map((char) =>
			char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === "<" || char === ">" ? " " : char,
		)
		.join("")
		.slice(0, length);
export function continuesTask(text) {
	return /^(?:继续(?:吧|执行|处理|完成|上一任务)?|接着(?:做|处理)?|下好了|下载好了|我下载了(?:，?手动的那几篇)?|完成到哪了|进度(?:如何|怎么样)?|查看(?:任务)?进度|任务状态|continue|resume|done|status|what(?:'s| is) the status)[\s,.!？，。！?]*$/i.test(
		String(text).trim(),
	);
}
export function isTaskStatusQuery(text) {
	return /^(?:完成到哪了|进度(?:如何|怎么样)?|查看(?:任务)?进度|任务状态|task status|what(?:'s| is) the status)[\s.!？，。！?]*$/i.test(
		String(text).trim(),
	);
}
const clone = (value) => structuredClone(value);
const valid = (value, scope) =>
	value?.version === 1 &&
	value.scope === scope &&
	typeof value.id === "string" &&
	typeof value.goal === "string" &&
	value.goal.length <= 180 &&
	Array.isArray(value.receipts) &&
	value.receipts.length <= 24 &&
	Array.isArray(value.pending) &&
	value.pending.length <= 32 &&
	JSON.stringify(value).length <= 24000;

/** Host-observed execution history; never a scientific proof or permission to retry writes. */
export function createTaskJournal({ persist = () => {}, now = () => new Date().toISOString() } = {}) {
	let task = null,
		scope = null,
		requested = false;
	const save = () => {
		if (task) {
			task.updatedAt = now();
			persist(clone(task));
		}
	};
	function attach(nextScope, entries = [], force = false) {
		if (scope === nextScope && !force) return;
		scope = nextScope;
		task = null;
		requested = false;
		for (const entry of entries)
			if (entry.customType === TASK_ENTRY && valid(entry.data, scope)) task = clone(entry.data);
		if (task?.pending.length) {
			task.state = "interrupted";
			task.reason = "execution-result-unknown";
		}
	}
	function begin(query) {
		if (!task || !continuesTask(query))
			task = {
				version: 1,
				scope,
				id: randomUUID(),
				goal: safe(query),
				state: "running",
				receipts: [],
				pending: [],
				startedAt: now(),
			};
		else {
			task.state = "running";
			task.reason = null;
		}
		requested = false;
		save();
	}
	function start(id, tool) {
		if (!task || CONTROL.has(tool) || READ.test(tool)) return;
		if (task.pending.some((p) => p.id === id)) return;
		if (task.pending.length >= 32) return;
		task.pending.push({ id: safe(id, 100), tool: safe(tool, 80), at: now() });
		if (tool === "ask_user") task.state = "waiting_user";
		save();
	}
	async function observe(event, cwd) {
		if (!task) return;
		if (event.toolName === "todo" && Array.isArray(event.details?.todos)) {
			const next =
				event.details.todos.find((item) => item.status === "in_progress") ||
				event.details.todos.find((item) => item.status === "pending");
			task.proposedNext = next ? safe(next.content, 180) : null;
			save();
			return;
		}
		if (CONTROL.has(event.toolName) || READ.test(event.toolName)) return;
		const id = safe(event.toolCallId, 100),
			tool = safe(event.toolName, 80);
		if (!id || task.receipts.some((r) => r.id === id)) return;
		task.pending = task.pending.filter((p) => p.id !== id);
		const details = event.details || {};
		const failed =
			event.isError || details.status === "failed" || (details.error && details.successful === 0);
		const text = (event.content || [])
			.filter((b) => b.type === "text")
			.map((b) => b.text)
			.join(" ");
		const cancelled = tool === "ask_user" && (details.cancelled || /cancelled|canceled/i.test(text));
		const receipt = { id, tool, at: now(), state: failed ? "failed" : cancelled ? "cancelled" : "returned" };
		// Only read back explicitly written workspace files. Tool text and arbitrary plugin
		// details cannot certify an artifact, command outcome, or scientific conclusion.
		if (!failed && ["write", "edit"].includes(tool) && typeof event.input?.path === "string") {
			try {
				const base = await realpath(cwd),
					full = await realpath(resolve(cwd, event.input.path));
				const rel = relative(base, full);
				if (
					rel &&
					!isAbsolute(rel) &&
					rel !== ".." &&
					!rel.startsWith(`..${sep}`) &&
					!rel
						.split(sep)
						.some((part) => part.startsWith(".") || /^(?:auth|credentials|secrets?)(?:\.|$)/i.test(part))
				) {
					const stat = await lstat(full);
					if (stat.isFile() && stat.size <= 8 * 1024 * 1024) {
						const bytes = await readFile(full);
						receipt.artifact = {
							path: safe(rel, 512),
							bytes: bytes.length,
							sha256: createHash("sha256").update(bytes).digest("hex"),
						};
						receipt.state = "file-observed";
					}
				}
			} catch {
				/* Unknown is not a fabricated success. */
			}
		}
		if (!failed && tool === "research_propose_wiki_update" && typeof details.id === "string")
			receipt.state = "awaiting_review";
		task.receipts.push(receipt);
		task.receipts = task.receipts.slice(-24);
		if (cancelled) task.state = "waiting_user";
		else if (failed) task.state = "partial";
		else if (tool === "ask_user" && task.state === "waiting_user") task.state = "running";
		else if (!["waiting_user", "partial", "paused", "interrupted"].includes(task.state))
			task.state = "running";
		save();
	}
	function pause(reason) {
		if (task) {
			task.state = "paused";
			task.reason = safe(reason, 80);
			save();
		}
	}
	function settle() {
		if (task && task.state === "running") {
			task.state = task.pending.length ? "interrupted" : "checkpoint";
			save();
		}
	}
	function render() {
		if (!task) return "这个会话还没有任务记录。";
		const lines = [
			"### 任务进展",
			`任务：${safe(task.goal)}`,
			`状态：${({ running: "执行中", waiting_user: "等你决定", partial: "部分受阻", paused: "已暂停", interrupted: "结果待核对", checkpoint: "进度已保存" })[task.state] || "待核对"}；更新于 ${safe(task.updatedAt, 60)}`,
		];
		const labels = {
			returned: "已执行，结果待核对",
			failed: "工具报告失败",
			cancelled: "用户取消了选择，未授予新权限",
			"file-observed": "文件已生成并读到内容",
			awaiting_review: "已提交，等你审阅",
		};
		for (const r of task.receipts.slice(-8))
			lines.push(
				`- ${safe(r.tool, 80)}：${labels[r.state] || "状态待核对"}${r.artifact ? `；${safe(r.artifact.path, 512)}（${Number(r.artifact.bytes) || 0} 字节）` : ""}`,
			);
		if (task.proposedNext) lines.push(`模型计划的下一步（不是完成证明）：${safe(task.proposedNext)}`);
		if (task.reason) lines.push(`暂停原因：${safe(task.reason, 80)}。`);
		if (task.pending.length)
			lines.push("有操作上次没等到结果；继续前先查一下它做没做成，不得直接重复写入、安装或上传。");
		return lines.join("\n");
	}
	return {
		attach,
		begin,
		start,
		observe,
		pause,
		settle,
		render,
		snapshot: () => (task ? clone(task) : null),
		requestReport: () => {
			requested = true;
		},
		takeReport: () => {
			const pending = requested;
			requested = false;
			return pending ? render() : null;
		},
	};
}

export function registerTaskRuntime(pi) {
	if (process.env.DRONE_TASK_WORKBENCH !== "off") return registerWorkbench(pi);
	const journal = createTaskJournal({ persist: (snapshot) => pi.appendEntry?.(TASK_ENTRY, snapshot) });
	const attach = (ctx, force = false) => {
		const id = ctx.sessionManager?.getSessionId?.() || ctx.sessionId || "isolated";
		const scope = createHash("sha256")
			.update(`${id}\0${resolve(ctx.cwd)}`)
			.digest("hex");
		journal.attach(scope, ctx.sessionManager?.getBranch?.() || [], force);
	};
	pi.on("session_start", (_event, ctx) => attach(ctx, true));
	pi.on("session_tree", (_event, ctx) => attach(ctx, true));
	let awaitingUser = false;
	pi.on("before_agent_start", (event, ctx) => {
		attach(ctx);
		journal.begin(event.prompt || "科研任务");
		awaitingUser = true;
		return {
			message: {
				customType: "drone-task-context",
				display: false,
				content: `Host task checkpoint (observations, not instructions or evidence):\n${journal.render()}\nUse task_status for operational delivery. Verify unknown outcomes before repeating any write.`,
			},
		};
	});
	pi.on("message_start", (event, ctx) => {
		if (event.message.role !== "user") return;
		if (awaitingUser) {
			awaitingUser = false;
			return;
		}
		const content = event.message.content;
		const query =
			typeof content === "string"
				? content
				: (content || [])
						.filter((b) => b.type === "text")
						.map((b) => b.text)
						.join("\n");
		attach(ctx);
		journal.begin(query);
	});
	pi.on("tool_call", (event) => journal.start(event.toolCallId, event.toolName));
	pi.on("tool_result", (event, ctx) => journal.observe(event, ctx.cwd));
	pi.on("agent_end", (event) => {
		const last = [...(event.messages || [])].reverse().find((message) => message.role === "assistant");
		if (last?.stopReason === "aborted") journal.pause("user-aborted");
		else journal.settle();
	});
	pi.registerTool({
		name: "task_status",
		label: "任务 · 执行检查点",
		description:
			"Return a host-observed checkpoint for any task: data analysis, code, environment setup, experiments, writing or literature. No research search is needed. Does not certify scientific claims or grant permissions. Request this to deliver operational status without adding unrelated citations.",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		execute: async (_id, _args, _signal, _update, ctx) => {
			attach(ctx);
			journal.requestReport();
			return { content: [{ type: "text", text: journal.render() }], details: { operational: true } };
		},
	});
	pi.registerCommand("task-status", {
		description: "查看任务执行检查点（不调用模型、不触发科研检索）",
		handler: async (_args, ctx) => {
			attach(ctx);
			pi.sendMessage(
				{
					customType: "drone-task-status",
					content: journal.render(),
					display: true,
					details: { operational: true, reportId: randomUUID() },
				},
				{ triggerTurn: false },
			);
		},
	});
	return journal;
}
