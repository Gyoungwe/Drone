// Self-contained runtime adapter for packaged CLI/electron builds. Keep this file
// dependency-free; the typed source of truth lives in packages/knowledge.

export const publicationNotices = {
	"paper-citation-required":
		"本次研究回答缺少具体论文依据；Wiki 或报告链接不能替代本轮读过的文献笔记。请标明证据缺口，不要反复检索只为消除提醒。",
	"search-required": "本轮尚未完成知识库检索。请先检索，再阅读需要引用的内容。",
	"coverage-incomplete": "知识索引尚未完整可用。请检查索引状态或故障，不能将此情况当作无命中。",
	"citation-required": "检索有命中，但回答没有引用本轮读过的知识条目。",
	"citation-invalid": "回答中的知识库引用格式不合法。",
	"citation-budget": "本次回答的引用超过检查上限，请拆分为更小的回答。",
	"source-unread": "回答引用了本轮没有实际阅读的条目。",
	"delivery-changed": "本轮生成的产物在保存后发生变化，不能沿用旧的产物回执。",
	"source-changed": "引用内容在阅读后发生了变化，请读取新版本并重新检索。",
	"wiki-changed": "相关 Wiki 已变化，请读取当前版本后重新检索。",
	"search-stale": "检索后索引版本发生变化，请重新检索当前内容。",
	"binding-changed": "当前知识库绑定已变化，请重新读取导航，不沿用旧知识库的证据。",
	"navigation-changed": "本轮导航已失效，请重新读取导航并完成检索。",
	"not-prepared": "知识库准备步骤尚未完成，回答没有发布。",
	interrupted: "本次请求已中断，未完成的回答没有发布。",
	"model-error": "模型请求失败，未完成的回答没有发布。",
	"check-timeout": "回答前检查超时，草稿没有发布。",
	"check-failed": "回答前检查发生错误，草稿没有发布。",
	"empty-answer": "任务已结束，但模型没有生成可显示的回复。请查看本轮产物或要求继续交付说明。",
	"answer-too-large": "本次回答超出单次检查的大小上限，请分段完成。",
	"protocol-budget": "本轮工具上下文超过安全缓存上限，请开启新一轮任务。",
	"tool-loop-stopped":
		"【任务阶段已暂停】本阶段达到工具或上下文安全预算。已保存的结果不会因此删除；查看任务执行记录后可继续，无需新建对话。继续前先核对结果未知的操作，不要重复安装、导入或上传。",
};
const advisoryNotices = {
	"paper-citation-required":
		"这份回答没有引用具体的原始论文，主要依据是 Wiki 或已生成的报告。内容已保留，但请把它当作待查证的线索。",
	"citation-budget": "这份回答引用的来源超过了单次核验上限。内容已完整保留。",
	"citation-required": "这份回答没有引用本轮读过的知识条目，未能建立来源对应关系。内容已保留。",
	"citation-invalid": "这份回答里有格式不合法的知识库引用，该引用未被核验。内容已保留。",
	"source-unread": "这份回答引用了本轮没有实际打开过的条目，该引用未被核验。内容已保留。",
	"source-changed": "引用的内容在本轮读取后发生了变化，核验结果可能已过期。内容已保留。",
	"delivery-changed": "本轮生成的产物在保存后发生变化，其回执未被采用。内容已保留。",
	"wiki-changed": "相关 Wiki 在本轮读取后发生了变化，核验结果可能已过期。内容已保留。",
	"search-required": "本轮没有完成知识库检索，检索覆盖情况尚未确认。内容已保留。",
	"search-stale": "检索完成后知识库索引发生了变化，核验结果可能已过期。内容已保留。",
	"coverage-incomplete": "知识库索引本轮未完整就绪，这不代表库中没有相关内容。内容已保留。",
	"check-timeout": "回答前的核验超时，本次未完成核验。内容已保留。",
	"not-prepared": "知识库准备步骤未完成，本次未做核验。内容已保留。",
};
export function publicationNotice(code) {
	return publicationNotices[code] || publicationNotices["check-failed"];
}
export function advisoryNotice(code) {
	return advisoryNotices[code] || publicationNotice(code);
}
function numberIsInteger(value) {
	return typeof value === "number" && Number.isInteger(value);
}
export function advisoryLine(code, error) {
	const verified = error?.verified;
	const sources = Array.isArray(verified?.sources) ? verified.sources.length : 0;
	const deliveries = Array.isArray(verified?.deliveries) ? verified.deliveries.length : 0;
	const cited =
		typeof verified?.unverifiedCitationCount === "number" && Number.isFinite(verified.unverifiedCitationCount)
			? verified.unverifiedCitationCount
			: Array.isArray(verified?.unverifiedCitations)
				? verified.unverifiedCitations.length
				: 0;
	const notice =
		code === "citation-budget" &&
		numberIsInteger(verified?.citationCount) &&
		numberIsInteger(verified?.citationLimit)
			? `这份回答引用了 ${verified.citationCount} 处来源，超过单次核验上限（${verified.citationLimit} 处）。内容已完整保留。`
			: advisoryNotice(code);
	const parts = [];
	if (sources) parts.push(`已核对 ${sources} 处来源的读取记录与当前版本`);
	if (deliveries) parts.push(`已核对 ${deliveries} 份本轮产物`);
	if (cited) parts.push(`${sources ? "另有" : "共"} ${cited} 处引用未逐条核验`);
	const detail = parts.length ? `${parts.join("、")}。` : "";
	return `${notice}${detail ? ` ${detail}` : ""}${sources || deliveries ? " 来源核对不代表科学结论已获验证。" : ""}`;
}
function errorMessage(error) {
	return error && typeof error === "object" && "message" in error ? String(error.message || "") : "";
}
function errorCode(error) {
	return error && typeof error === "object" && "code" in error ? String(error.code || "") : "";
}
export function knowledgeFailure(error) {
	const code = classifyFailureCode(error);
	const paths = [];
	const rawPaths = error && typeof error === "object" && "paths" in error ? error.paths : [];
	for (const path of Array.isArray(rawPaths) ? rawPaths : []) {
		if (typeof path === "string" && path.length <= 512 && !/[\r\n<>]/.test(path)) paths.push(path);
		if (paths.length >= 6) break;
	}
	return { code, message: publicationNotice(code), paths };
}
function classifyFailureCode(error) {
	const code = errorCode(error);
	if (code in publicationNotices) return code;
	const text = errorMessage(error);
	if (/binding changed/i.test(text)) return "binding-changed";
	if (/navigation changed/i.test(text)) return "navigation-changed";
	if (/navigation|prepare_knowledge/i.test(text)) return "not-prepared";
	return "check-failed";
}
