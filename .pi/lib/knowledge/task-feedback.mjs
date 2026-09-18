import { lstat, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const replaceControl = (text) =>
	[...String(text || "")].map((char) => (char.charCodeAt(0) < 32 ? " " : char)).join("");
const clean = (text, limit = 300) =>
	replaceControl(text)
		.replace(/(?:bearer\s+|api[_-]?key[=:]\s*)[^\s]+/gi, "[redacted]")
		.trim()
		.slice(0, limit);
/** Observed tool receipts only. No raw model drafts/thinking and no new model request. */
export function createTaskFeedback() {
	let failures = [],
		files = new Map(),
		seen = new Set(),
		archiveCount = 0,
		summarySaved = false,
		explainerSaved = false,
		candidates = new Set();
	const begin = () => {
		failures = [];
		files = new Map();
		seen = new Set();
		archiveCount = 0;
		summarySaved = false;
		explainerSaved = false;
		candidates = new Set();
	};
	async function observe(event, ctx) {
		if (seen.has(event.toolCallId)) return;
		seen.add(event.toolCallId);
		if (seen.size > 512) seen.delete(seen.values().next().value);
		const d = event.details || {},
			content = event.content || [];
		if (event.isError || d.status === "failed" || (d.error && d.successful === 0)) {
			failures.push({
				tool: clean(event.toolName, 60),
				reason: clean(
					d.reason ||
						d.error ||
						content
							.filter((b) => b.type === "text")
							.map((b) => b.text)
							.join(" "),
				),
			});
			failures = failures.slice(-6);
			return;
		}
		let path = null;
		if (event.toolName === "research_propose_wiki_update" && d.id) candidates.add(d.id);
		if (event.toolName === "research_archive_source" && d.status === "downloaded") archiveCount++;
		if (event.toolName === "research_summarize_run" && d.summary_saved) {
			summarySaved = true;
			path = d.run;
		}
		if (event.toolName === "research_archive_explainer" && d.knowledge_status === "written") {
			explainerSaved = true;
			path = d.note;
		}
		if (["write", "edit"].includes(event.toolName)) path = event.input?.path;
		if (typeof path === "string") {
			try {
				const full = await realpath(resolve(ctx.cwd, path)),
					rel = relative(await realpath(ctx.cwd), full);
				// Only return output links in this actual workspace, not arbitrary documents read by tools.
				if (rel.startsWith(`results${sep}`) && (await lstat(full)).isFile()) {
					files.delete(full);
					files.set(full, { name: clean(rel.split(sep).at(-1), 100), path: full });
					while (files.size > 8) files.delete(files.keys().next().value);
				}
			} catch {
				/* failed or outside-workspace files are not advertised */
			}
		}
	}
	function facts() {
		return {
			archivedSources: archiveCount,
			summarySaved,
			explainerSaved,
			pendingWikiCandidates: candidates.size,
			files: [...files.values()],
			failures: [...failures],
		};
	}
	function report(reason, message, paths = []) {
		const interrupted = reason === "interrupted";
		const d = facts(),
			lines = [
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
						.map((p) => `\`${clean(p, 512).replaceAll("`", "")}\``)
						.join("、"),
			);
		if (d.archivedSources || d.summarySaved || d.files.length)
			lines.push(
				`已完成的工作仍然保留：归档来源 ${d.archivedSources} 项；研究摘要${d.summarySaved ? "已保存" : "尚未确认保存"}；Show Me ${d.explainerSaved ? "已归档" : "尚未确认归档"}；待审核 Wiki 候选 ${d.pendingWikiCandidates} 个。`,
			);
		if (d.files.length)
			lines.push(
				"本轮实际写入的产物（内容仍需核验）：\n" +
					d.files.map((f) => `- [${f.name.replace(/[[\]]/g, "")}](${pathToFileURL(f.path).href})`).join("\n"),
			);
		if (d.failures.length)
			lines.push(
				"过程中还发生过以下工具问题；部分可能已改用其他路径继续：\n" +
					d.failures
						.slice(-3)
						.map((e) => `- ${e.tool}：${e.reason}`)
						.join("\n"),
			);
		lines.push(
			interrupted
				? "已记录的工具结果仍可在本会话查看。可以继续剩余工作；不需要重新下载已经保存的资料。"
				: "接下来应根据具体检查原因补读或修正引用，再预检回答；不需要重新下载已经保存的资料。这里报告的是执行状态，不是对未发布研究结论的认可。",
		);
		return lines.join("\n\n");
	}
	return { begin, observe, facts, report };
}
/** Prevent obvious binary transport and explicit failed receipts from masquerading as readable evidence. */
export function guardResearchToolResult(event) {
	if (!["fetch_content", "webfetch", "research_archive_source"].includes(event.toolName)) return;
	const text = (event.content || [])
		.filter((b) => b.type === "text")
		.map((b) => b.text)
		.join("\n");
	if (
		/(?:^|\n)%PDF-\d\.\d/.test(text.slice(0, 1800)) &&
		(text.includes("\u0000") || /(?:\uFFFD|\d+\s+\d+\s+obj|\nstream)/.test(text.slice(0, 6000)))
	) {
		return {
			content: [
				{
					type: "text",
					text: "读取未完成：工具返回了 PDF 二进制，不是可读正文。请归档原 PDF 后使用已有的文本提取工具读取需要的页或段落；不要把这些字节当作证据，也不要重复把二进制送入上下文。",
				},
			],
			isError: true,
			details: { ...event.details, error: "binary-pdf-returned", contentGuard: "binary-pdf" },
		};
	}
	const d = event.details;
	if (!event.isError && (d?.status === "failed" || (d?.error && d?.successful === 0)))
		return { isError: true };
}
