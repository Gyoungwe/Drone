export type AskQuestionType = "single" | "multi" | "preview" | "text";

export type AskRecommendationConfidence = "high" | "medium" | "low";

export interface AskRecommendation {
	value: string;
	reason: string;
	confidence?: AskRecommendationConfidence;
	basedOn?: string[];
}

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
	recommendation?: AskRecommendation;
	/** Whether the user can add an answer the model did not enumerate. Defaults to true. */
	allowCustomText?: boolean;
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
	/** Snapshot of the model's recommendation kept with the user's decision. */
	recommendation?: AskRecommendation;
}

export type AskResponse =
	| { kind: "answer"; mode?: "submit" | "elaborate"; answers: Record<string, AskAnswer> }
	| { kind: "cancel" };
