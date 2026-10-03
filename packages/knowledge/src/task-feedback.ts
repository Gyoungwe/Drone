import { lstat, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export interface TaskFeedbackEvent {
	toolCallId?: unknown;
	toolName?: unknown;
	details?: Record<string, unknown> | null;
	content?: readonly TaskFeedbackContent[];
	isError?: boolean;
	input?: Record<string, unknown> | null;
}

export interface TaskFeedbackContent {
	type?: string;
	text?: unknown;
}

export interface TaskFeedbackContext {
	cwd: string;
}

export interface TaskFeedbackFile {
	name: string;
	path: string;
}

export interface TaskFeedbackFailure {
	tool: string;
	reason: string;
}

export interface TaskFeedbackFacts {
	archivedSources: number;
	summarySaved: boolean;
	explainerSaved: boolean;
	pendingWikiCandidates: number;
	files: TaskFeedbackFile[];
	failures: TaskFeedbackFailure[];
}

export interface TaskFeedback {
	begin(): void;
	observe(event: TaskFeedbackEvent, ctx: TaskFeedbackContext): Promise<void>;
	facts(): TaskFeedbackFacts;
	report(reason: string, message: string, paths?: readonly string[]): string;
}

const replaceControl = (text: unknown): string =>
	[...String(text || "")].map((char) => (char.charCodeAt(0) < 32 ? " " : char)).join("");

const clean = (text: unknown, limit = 300): string =>
	replaceControl(text)
		.replace(/(?:bearer\s+|api[_-]?key[=:]\s*)[^\s]+/gi, "[redacted]")
		.trim()
		.slice(0, limit);

/** Observed tool receipts only; raw model drafts and thinking are never retained. */
export function createTaskFeedback(): TaskFeedback {
	let failures: TaskFeedbackFailure[] = [];
	let files = new Map<string, TaskFeedbackFile>();
	let seen = new Set<unknown>();
	let archiveCount = 0;
	let summarySaved = false;
	let explainerSaved = false;
	let candidates = new Set<unknown>();

	const begin = (): void => {
		failures = [];
		files = new Map();
		seen = new Set();
		archiveCount = 0;
		summarySaved = false;
		explainerSaved = false;
		candidates = new Set();
	};

	const observe = async (event: TaskFeedbackEvent, ctx: TaskFeedbackContext): Promise<void> => {
		if (seen.has(event.toolCallId)) return;
		seen.add(event.toolCallId);
		if (seen.size > 512) {
			const oldest = seen.values().next().value;
			seen.delete(oldest);
		}
		const details = event.details || {};
		const content = event.content || [];
		if (event.isError || details.status === "failed" || (details.error && details.successful === 0)) {
			failures.push({
				tool: clean(event.toolName, 60),
				reason: clean(
					details.reason ||
						details.error ||
						content
							.filter((block) => block.type === "text")
							.map((block) => block.text)
							.join(" "),
				),
			});
			failures = failures.slice(-6);
			return;
		}
		let path: unknown = null;
		if (event.toolName === "research_propose_wiki_update" && details.id) candidates.add(details.id);
		if (event.toolName === "research_archive_source" && details.status === "downloaded") archiveCount++;
		if (event.toolName === "research_summarize_run" && details.summary_saved) {
			summarySaved = true;
			path = details.run;
		}
		if (event.toolName === "research_archive_explainer" && details.knowledge_status === "written") {
			explainerSaved = true;
			path = details.note;
		}
		if (["write", "edit"].includes(String(event.toolName))) path = event.input?.path;
		if (typeof path !== "string") return;
		try {
			const full = await realpath(resolve(ctx.cwd, path));
			const rel = relative(await realpath(ctx.cwd), full);
			// Only advertise files in this workspace's results directory.
			if (rel.startsWith(`results${sep}`) && (await lstat(full)).isFile()) {
				files.delete(full);
				files.set(full, { name: clean(rel.split(sep).at(-1), 100), path: full });
				while (files.size > 8) files.delete(files.keys().next().value as string);
			}
		} catch {
			// Failed or outside-workspace files are not advertised.
		}
	};

	const facts = (): TaskFeedbackFacts => ({
		archivedSources: archiveCount,
		summarySaved,
		explainerSaved,
		pendingWikiCandidates: candidates.size,
		files: [...files.values()],
		failures: [...failures],
	});

	const report = (reason: string, message: string, paths: readonly string[] = []): string => {
		const interrupted = reason === "interrupted";
		const current = facts();
		const lines = [
			interrupted
				? "本次请求已中断，未完成的回答没有发布。"
				: `【知识库检查未通过】本轮的最终回答尚未完成发布（${clean(reason, 60)}）。`,
			...(interrupted ? [] : [clean(message, 450)]),
		];
		if (paths.length)
			lines.push(
				"需要处理的条目：" +
					paths
						.slice(0, 6)
						.map((path) => `\`${clean(path, 512).replaceAll("`", "")}\``)
						.join("、"),
			);
		if (current.archivedSources || current.summarySaved || current.files.length)
			lines.push(
				`已完成的工作仍然保留：归档来源 ${current.archivedSources} 项；研究摘要${current.summarySaved ? "已保存" : "尚未确认保存"}；Show Me ${current.explainerSaved ? "已归档" : "尚未确认归档"}；待审核 Wiki 候选 ${current.pendingWikiCandidates} 个。`,
			);
		if (current.files.length)
			lines.push(
				"本轮实际写入的产物（内容仍需核验）：\n" +
					current.files
						.map((file) => `- [${file.name.replace(/[[\]]/g, "")}](${pathToFileURL(file.path).href})`)
						.join("\n"),
			);
		if (current.failures.length)
			lines.push(
				"过程中还发生过以下工具问题；部分可能已改用其他路径继续：\n" +
					current.failures
						.slice(-3)
						.map((entry) => `- ${entry.tool}：${entry.reason}`)
						.join("\n"),
			);
		lines.push(
			interrupted
				? "已记录的工具结果仍可在本会话查看。可以继续剩余工作；不需要重新下载已经保存的资料。"
				: "接下来应根据具体检查原因补读或修正引用，再预检回答；不需要重新下载已经保存的资料。这里报告的是执行状态，不是对未发布研究结论的认可。",
		);
		return lines.join("\n\n");
	};

	return { begin, observe, facts, report };
}

export interface ResearchToolResultEvent {
	toolName?: unknown;
	content?: readonly TaskFeedbackContent[];
	details?: Record<string, unknown> | null;
	isError?: boolean;
}

/** Prevent binary PDF bytes and explicit failed receipts from masquerading as evidence. */
export function guardResearchToolResult(
	event: ResearchToolResultEvent,
):
	| { content: Array<{ type: "text"; text: string }>; isError: true; details: Record<string, unknown> }
	| { isError: true }
	| undefined {
	if (!["fetch_content", "webfetch", "research_archive_source"].includes(String(event.toolName))) return;
	const text = (event.content || [])
		.filter((block) => block.type === "text")
		.map((block) => String(block.text || ""))
		.join("\n");
	if (
		/(?:^|\n)%PDF-\d\.\d/.test(text.slice(0, 1800)) &&
		(text.includes("\u0000") || /(?:\uFFFD|\d+\s+\d+\s+obj|\nstream)/.test(text.slice(0, 6000)))
	)
		return {
			content: [
				{
					type: "text",
					text: "读取未完成：工具返回了 PDF 二进制，不是可读正文。请归档原 PDF 后使用已有的文本提取工具读取需要的页或段落；不要把这些字节当作证据，也不要重复把二进制送入上下文。",
				},
			],
			isError: true,
			details: { ...(event.details || {}), error: "binary-pdf-returned", contentGuard: "binary-pdf" },
		};
	const details = event.details;
	if (!event.isError && (details?.status === "failed" || (details?.error && details.successful === 0)))
		return { isError: true };
}
