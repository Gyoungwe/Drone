import type { AskAnswer, AskQuestion, AskRequest, AskResponse } from "./ask";

/**
 * 对话流内联问询卡（P9）：复用 ask_user 的请求 / 应答结构，不新建工具。
 * 能放进流里的放进流里——简单单选 / 多选 / 文本题走内联卡；带方案投影、授权、预览选项的复杂题仍走 AskDialog 抽屉。
 */
export const INLINE_ASK_MAX_QUESTIONS = 4;
export const INLINE_ASK_MAX_OPTIONS = 9;

export function isInlineAsk(request: AskRequest): boolean {
	if (request.proposal || request.decisionProposal) return false;
	if ((request.kind ?? request.purpose) === "authorization") return false;
	if (!request.questions.length || request.questions.length > INLINE_ASK_MAX_QUESTIONS) return false;
	return request.questions.every(
		(q) =>
			(q.type === "single" || q.type === "multi" || q.type === "text") &&
			q.options.length <= INLINE_ASK_MAX_OPTIONS &&
			!q.options.some((o) => o.preview),
	);
}

export type InlineDrafts = Record<string, { values: string[]; custom: string; skipped: boolean }>;

export function emptyDrafts(request: AskRequest): InlineDrafts {
	return Object.fromEntries(request.questions.map((q) => [q.id, { values: [], custom: "", skipped: false }]));
}

/** 数字键 1–9 选第 n 个选项：单选替换，多选切换。 */
export function pickByNumber(question: AskQuestion, values: string[], digit: number): string[] {
	const option = question.options[digit - 1];
	if (!option) return values;
	if (question.type === "multi")
		return values.includes(option.value)
			? values.filter((v) => v !== option.value)
			: [...values, option.value];
	return [option.value];
}

export function isAnswered(_question: AskQuestion, draft: InlineDrafts[string] | undefined): boolean {
	if (!draft) return false;
	return draft.values.length > 0 || draft.custom.trim().length > 0;
}

/** 必答题里还没答的（跳过不算答）。 */
export function missingRequired(request: AskRequest, drafts: InlineDrafts): AskQuestion[] {
	return request.questions.filter((q) => q.required && !isAnswered(q, drafts[q.id]));
}

export function buildInlineResponse(request: AskRequest, drafts: InlineDrafts): AskResponse {
	const answers: Record<string, AskAnswer> = {};
	for (const q of request.questions) {
		const d = drafts[q.id];
		if (!d || d.skipped || !isAnswered(q, d)) continue;
		answers[q.id] = {
			...(d.values.length ? { values: d.values } : {}),
			...(d.custom.trim() ? { customText: d.custom.trim() } : {}),
			...(q.recommendation ? { recommendation: q.recommendation } : {}),
		};
	}
	return { kind: "answer", mode: "submit", answers };
}

/** 回答后留在流里的一行摘要：选项显示 label，自行输入原样，跳过不出现。 */
export function answerSummary(request: AskRequest, response: AskResponse): string {
	if (response.kind !== "answer") return "";
	const parts: string[] = [];
	for (const q of request.questions) {
		const a = response.answers[q.id];
		if (!a) continue;
		const labels = (a.values ?? []).map((v) => q.options.find((o) => o.value === v)?.label ?? v);
		if (a.customText) labels.push(a.customText);
		if (labels.length) parts.push(labels.join("、"));
	}
	return parts.join("；");
}
