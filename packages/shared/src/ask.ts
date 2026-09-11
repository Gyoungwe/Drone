export type AskQuestionType = "single" | "multi" | "preview";

export interface AskOption {
	value: string;
	label: string;
	description?: string;
	preview?: string;
	recommended?: boolean;
}

export interface AskQuestion {
	id: string;
	label: string;
	prompt: string;
	type: AskQuestionType;
	required: boolean;
	options: AskOption[];
}

export interface AskRequest {
	id: string;
	sessionId: string;
	toolCallId: string;
	title?: string;
	questions: AskQuestion[];
}

export interface AskAnswer {
	values?: string[];
	customText?: string;
	note?: string;
	optionNotes?: Record<string, string>;
}

export type AskResponse =
	| { kind: "answer"; mode?: "submit" | "elaborate"; answers: Record<string, AskAnswer> }
	| { kind: "cancel" };
