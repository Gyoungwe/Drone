import type { AskRequest, AskResponse, DecisionRecord } from "@drone/shared";

export type DecisionConfirmationAction = "revoke" | "confirm";

export function decisionConfirmationRequest(
	decision: DecisionRecord,
	action: DecisionConfirmationAction,
	copy: { title: string; message: string; confirm: string; cancel: string },
): AskRequest {
	return {
		id: `decision-confirm:${decision.id}:${action}`,
		sessionId: "decision-ledger",
		toolCallId: `decision:${decision.id}`,
		title: copy.title,
		questions: [
			{
				id: "decision-action",
				label: copy.title,
				prompt: copy.message,
				type: "single",
				required: true,
				options: [
					{ value: "cancel", label: copy.cancel },
					{ value: "confirm", label: copy.confirm },
				],
			},
		],
	};
}

export function decisionConfirmationChoice(response: AskResponse): "confirm" | "cancel" {
	if (response.kind !== "answer") return "cancel";
	return response.answers["decision-action"]?.values?.[0] === "confirm" ? "confirm" : "cancel";
}
