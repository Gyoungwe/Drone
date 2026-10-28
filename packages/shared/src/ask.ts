import type { CausalEnvelope } from "./causality";
import { contractContentHash } from "./research-contracts";

export type AskQuestionType = "single" | "multi" | "preview" | "text";
export type AskRequestKind = "clarification" | "authorization";

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

/** Renderer-safe projection of a generated decision proposal. No backend entities or credentials cross IPC. */
export interface AskDecisionProposal {
	proposalHash: string;
	lineage?: CausalEnvelope;
	contextHash?: string;
	capabilityHash?: string;
	workflowHash?: string;
	recommendation?: AskRecommendation;
	reason?: string;
	evidence?: string[];
	benefits?: string[];
	costs?: string[];
	risks?: string[];
	resources?: string[];
	authorizationActions?: Array<{
		id: string;
		label: string;
		description?: string;
		risk?: "low" | "high";
		independent?: boolean;
	}>;
	authorizationScopeHash?: string;
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
	kind?: AskRequestKind;
	/** Compatibility spelling for integrations that call this a purpose. */
	purpose?: AskRequestKind;
	questions: AskQuestion[];
	proposal?: AskDecisionProposal;
	/** Alias retained while integrations migrate from the generic ask path. */
	decisionProposal?: AskDecisionProposal;
}

export interface AskResolved {
	sessionId: string;
	requestId: string;
}

export interface AskAnswer {
	values?: string[];
	customText?: string;
	note?: string;
	optionNotes?: Record<string, string>;
	/** Snapshot of the model's recommendation kept with the user's decision. */
	recommendation?: AskRecommendation;
}

export interface AskDecision {
	proposalHash: string;
	lineage?: CausalEnvelope;
	choice?: string;
	choices?: string[];
	customText?: string;
	notes?: string;
	decisionHash: string;
	authorizationScopeHash?: string;
	authorizedActionIds?: string[];
}

export type AskResponse =
	| {
			kind: "answer";
			mode?: "submit" | "elaborate";
			answers: Record<string, AskAnswer>;
			/** Persisted selection receipt; recommendation is never copied as an answer. */
			decision?: AskDecision;
	  }
	| { kind: "cancel" };

/** Hash the actual submitted selection, including custom text, never the recommendation. */
export function askDecisionHash(
	proposalHash: string,
	selection: Pick<AskDecision, "choice" | "choices" | "customText" | "notes">,
): string {
	return contractContentHash({ proposalHash, ...selection });
}
