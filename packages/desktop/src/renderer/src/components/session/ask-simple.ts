import type { AskOption, AskRequest } from "@drone/shared";

const CONFIRM = /确认|应用|\b(?:allow|apply|yes|ok|confirm)\b/i;
const CUSTOM = /自定义|其他|\b(?:custom|other)\b/i;
const DANGER = /取消|拒绝|deny|cancel|\bno\b/i;

/** Only semantic confirmations become compact buttons. Normal choices keep the full form. */
export function isSimpleConfirm(request: AskRequest): boolean {
	if (request.questions.length !== 1) return false;
	const question = request.questions[0];
	if (question?.type !== "single") return false;
	if (question.options.length < 2 || question.options.length > 3) return false;
	if (question.options.some((option) => option.preview || CUSTOM.test(`${option.label} ${option.value}`)))
		return false;
	// A compact dialog must be reversible confirmation, never a configuration choice.
	const hasConfirm = question.options.some((option) => CONFIRM.test(option.label || option.value));
	const hasCancel = question.options.some((option) => DANGER.test(option.label || option.value));
	return hasConfirm && hasCancel;
}

export function confirmOptionIndex(request: AskRequest): number {
	const options = request.questions[0]?.options ?? [];
	const hit = options.findIndex((option) => CONFIRM.test(option.label || option.value));
	return hit >= 0 ? hit : 0;
}

export function isDangerAskOption(option: AskOption): boolean {
	return DANGER.test(option.label || option.value);
}

/** Confirm action last, matching AskDialog's Cancel → Submit footer. */
export function orderedAskOptions(request: AskRequest): AskOption[] {
	const options = request.questions[0]?.options ?? [];
	const chosen = options[confirmOptionIndex(request)];
	if (!chosen) return options;
	return [...options.filter((option) => option !== chosen), chosen];
}
