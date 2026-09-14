import type { AskOption, AskRequest } from "@percho/shared";

const CONFIRM = /确认|应用|allow|apply|yes|ok|confirm/i;
const DANGER = /取消|拒绝|deny|cancel|\bno\b/i;

/** Two- or three-choice single-select with no previews: confirm dialog, not a questionnaire. */
export function isSimpleConfirm(request: AskRequest): boolean {
	if (request.questions.length !== 1) return false;
	const question = request.questions[0];
	if (!question) return false;
	return (
		question.type === "single" &&
		question.options.length >= 2 &&
		question.options.length <= 3 &&
		question.options.every((option) => !option.preview)
	);
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
