import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { projectIdentity } from "./config.mjs";

/**
 * 知识扩展的**无状态纯工具**：不闭包 registerKnowledgeInterface 的会话/回合可变态，
 * 仅依赖入参与导入。从 1100 行的注册闭包里拆出这批纯函数，便于单独复用与阅读，
 * 且不触碰承载门控生命周期的可变闭包。
 */

/** 工具结果信封：JSON 文本供模型读，details 供 UI 读。 */
export const result = (data) => ({
	content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
	details: data,
});

/** 当前项目知识身份：读 .pi/research-workspace.json 的 knowledgeProjectId，缺失回退稳定标识。 */
export async function currentProject(cwd) {
	let value;
	try {
		value = JSON.parse(await readFile(join(cwd, ".pi/research-workspace.json"), "utf8")).knowledgeProjectId;
	} catch {
		/* stable fallback */
	}
	return projectIdentity(cwd, value);
}

/** 归一化出稳定的 explainer topic id（去时间戳后缀、非字母数字转连字符、限长）。 */
export function explainerTopicId(value, title = "research-topic") {
	const base = String(value || title)
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[-_]20\d{6,14}$/, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 96);
	return base || "research-topic";
}

/** 会话身份（sessionManager 优先，回退 ctx.sessionId）。 */
export const sessionIdentity = (ctx) => ctx?.sessionManager?.getSessionId?.() || ctx?.sessionId || null;

/** 提示词是否含「延续上一主题」的信号（中英关键词启发）。 */
export const continuationHint = (value) =>
	/(?:previous|prior|last|earlier|continue|resume|what about|how about|why|then|it|that|those|之前|上个|继续|刚才|它|那个|那它|为什么|怎么|如何|还有|然后)/i.test(
		String(value || ""),
	);

/** 本轮提示是否延续给定 topic（显式切换关键词 → 否；延续信号或命中 topic 词表 → 是；空文本延续）。 */
export function continuesTopic(prompt, topic) {
	if (!topic) return false;
	const text = String(prompt || "").trim();
	if (!text) return true;
	if (/(?:switch|new topic|different topic|换个|另一个|新的主题|切换主题)/i.test(text)) return false;
	if (continuationHint(text)) return true;
	const lower = text.toLowerCase();
	return [topic.id, topic.title, ...(topic.aliases || []), ...(topic.entities || [])]
		.filter((value) => typeof value === "string" && value.trim().length >= 2)
		.some((value) => lower.includes(value.toLowerCase()));
}
