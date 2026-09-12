import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AskQuestion, AskRequest, AskResponse } from "@percho/shared";
import { Type } from "typebox";

const optionSchema = Type.Object({
	value: Type.String(),
	label: Type.String(),
	description: Type.Optional(Type.String()),
	preview: Type.Optional(Type.String()),
	recommended: Type.Optional(Type.Boolean()),
});
const questionSchema = Type.Object({
	id: Type.String(),
	label: Type.Optional(Type.String()),
	prompt: Type.String(),
	type: Type.Optional(Type.Union([Type.Literal("single"), Type.Literal("multi"), Type.Literal("preview")])),
	required: Type.Optional(Type.Boolean()),
	options: Type.Array(optionSchema, { minItems: 1 }),
});
const paramsSchema = Type.Object({
	title: Type.Optional(Type.String()),
	questions: Type.Array(questionSchema, { minItems: 1 }),
});

type RawParams = {
	title?: string;
	questions: Array<{
		id: string;
		label?: string;
		prompt: string;
		type?: AskQuestion["type"];
		required?: boolean;
		options: AskQuestion["options"];
	}>;
};

export interface AskUserToolDeps {
	ask: (request: Omit<AskRequest, "id" | "sessionId">, signal?: AbortSignal) => Promise<AskResponse>;
}

function normalizeQuestions(params: RawParams): AskQuestion[] {
	const ids = new Set<string>();
	return params.questions.map((q, index) => {
		const id = q.id.trim();
		if (!id || ids.has(id)) throw new Error(`Invalid ask_user question id: ${q.id}`);
		ids.add(id);
		if (!q.prompt.trim()) throw new Error(`Question ${index + 1}: prompt is required`);
		const values = new Set<string>();
		const options = q.options.map((option) => {
			const value = option.value.trim();
			if (!value || values.has(value))
				throw new Error(`Question ${index + 1}: option values must be unique and non-empty`);
			values.add(value);
			return {
				...option,
				value,
				label: option.label.trim() || value,
				description: option.description?.trim() || undefined,
				preview: option.preview?.trim() || undefined,
			};
		});
		const type = q.type ?? "single";
		if (type === "preview" && options.some((option) => !option.preview))
			throw new Error(`Question ${index + 1}: preview questions require preview text for every option`);
		return {
			id,
			label: q.label?.trim() || `Q${index + 1}`,
			prompt: q.prompt.trim(),
			type,
			required: q.required ?? false,
			options,
		};
	});
}

function resultFromResponse(params: RawParams, questions: AskQuestion[], response: AskResponse | undefined) {
	if (!response || response.kind === "cancel")
		return {
			title: params.title,
			cancelled: true,
			mode: "submit" as const,
			questions: questions.map(summary),
			answers: {},
		};
	const answers: Record<
		string,
		{
			values: string[];
			labels: string[];
			indices: number[];
			customText?: string;
			note?: string;
			optionNotes?: Record<string, string>;
		}
	> = {};
	for (const [id, input] of Object.entries(response.answers)) {
		const question = questions.find((q) => q.id === id);
		if (!question) throw new Error(`Unknown ask_user question id: ${id}`);
		const selected = (input.values ?? []).map((value) => {
			const index = question.options.findIndex((option) => option.value === value);
			if (index < 0) throw new Error(`Unknown option value "${value}" for question "${id}"`);
			const option = question.options[index];
			if (!option) throw new Error(`Missing option value "${value}" for question "${id}"`);
			return { value, label: option.label, index: index + 1 };
		});
		const customText = input.customText?.trim() ? input.customText : undefined;
		if (question.type === "single" && selected.length > 1)
			throw new Error(`Question "${id}" accepts one option`);
		if (!selected.length && !customText && !input.note?.trim()) continue;
		const selectedNotes = input.optionNotes
			? Object.fromEntries(
					selected
						.map((item) => [item.value, input.optionNotes?.[item.value]])
						.filter((entry): entry is [string, string] => Boolean(entry[1])),
				)
			: undefined;
		answers[id] = {
			values: [...selected.map((x) => x.value), ...(customText ? [customText] : [])],
			labels: [...selected.map((x) => x.label), ...(customText ? [customText] : [])],
			indices: selected.map((x) => x.index),
			...(customText ? { customText } : {}),
			...(input.note?.trim() ? { note: input.note } : {}),
			...(selectedNotes && Object.keys(selectedNotes).length ? { optionNotes: selectedNotes } : {}),
		};
	}
	return {
		title: params.title,
		cancelled: false,
		mode: response.mode ?? "submit",
		questions: questions.map(summary),
		answers,
	};
}

function summary(q: AskQuestion) {
	return { id: q.id, label: q.label, prompt: q.prompt, type: q.type };
}
function textResult(result: ReturnType<typeof resultFromResponse>): string {
	if (result.cancelled) return "User cancelled the clarification form.";
	const lines = result.questions.map((q) => {
		const answer = result.answers[q.id];
		if (!answer) return `${q.label}: (no answer)`;
		const parts = [...answer.labels];
		if (answer.customText) parts.push(answer.customText);
		return `${q.label}: ${parts.length ? parts.join(", ") : "(no answer)"}`;
	});
	return lines.join("\n");
}

export function makeAskUserTool(deps: AskUserToolDeps): ToolDefinition<typeof paramsSchema> {
	return {
		name: "ask_user",
		label: "Ask User",
		description:
			"Ask the user structured clarification questions in the Percho desktop UI before proceeding.",
		promptSnippet:
			"Clarify ambiguous or preference-sensitive decisions with a short interactive interview before proceeding",
		parameters: paramsSchema,
		async execute(toolCallId, params, signal): Promise<AgentToolResult<unknown>> {
			const raw = params as RawParams;
			const questions = normalizeQuestions(raw);
			const response = await deps.ask(
				{ toolCallId, title: raw.title?.trim() || undefined, questions },
				signal,
			);
			const details = resultFromResponse(raw, questions, response);
			return { content: [{ type: "text", text: textResult(details) }], details };
		},
	};
}
