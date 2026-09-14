import type { AskQuestion, AskRequest } from "@percho/shared";
import { expect, it } from "vitest";
import { confirmOptionIndex, isDangerAskOption, isSimpleConfirm, orderedAskOptions } from "./ask-simple";

const confirmQuestion = (options?: AskQuestion["options"]): AskQuestion => ({
	id: "value",
	label: "确认",
	prompt: "目标 Vault：/vault",
	type: "single",
	required: true,
	options: options ?? [
		{ value: "确认应用此方案", label: "确认应用此方案" },
		{ value: "取消，不做修改", label: "取消，不做修改" },
	],
});

const request = (patch: Partial<AskRequest> = {}): AskRequest => ({
	id: "1",
	sessionId: "s",
	toolCallId: "t",
	title: "Obsidian · 确认应用初始化方案",
	questions: [confirmQuestion()],
	...patch,
});

it("treats a two-choice setup confirm as a simple dialog", () => {
	const setup = request();
	expect(isSimpleConfirm(setup)).toBe(true);
	expect(confirmOptionIndex(setup)).toBe(0);
	expect(orderedAskOptions(setup).map((option) => option.value)).toEqual([
		"取消，不做修改",
		"确认应用此方案",
	]);
	expect(isDangerAskOption({ value: "取消，不做修改", label: "取消，不做修改" })).toBe(true);
});

it("keeps a three-choice confirm compact and puts confirm last", () => {
	const three = request({
		questions: [
			confirmQuestion([
				{ value: "确认应用此方案", label: "确认应用此方案" },
				{ value: "稍后", label: "稍后" },
				{ value: "取消，不做修改", label: "取消，不做修改" },
			]),
		],
	});
	expect(isSimpleConfirm(three)).toBe(true);
	expect(orderedAskOptions(three).map((option) => option.value)).toEqual([
		"稍后",
		"取消，不做修改",
		"确认应用此方案",
	]);
});

it("keeps questionnaires with previews or many questions in the long form", () => {
	const many = request({
		questions: [
			confirmQuestion(),
			{ id: "b", label: "b", prompt: "x", type: "text", required: true, options: [] },
		],
	});
	expect(isSimpleConfirm(many)).toBe(false);
	const preview = request({
		questions: [confirmQuestion([{ value: "确认应用此方案", label: "确认应用此方案", preview: "long" }])],
	});
	expect(isSimpleConfirm(preview)).toBe(false);
});
