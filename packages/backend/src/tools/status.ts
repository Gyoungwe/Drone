import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const statusParams = Type.Object({
	kind: Type.Optional(
		Type.Union([Type.Literal("plan"), Type.Literal("update"), Type.Literal("summary")], {
			description:
				"Public stage plan, progress update, or short completed-stage summary; not internal reasoning.",
		}),
	),
	detail: Type.Optional(
		Type.String({
			maxLength: 400,
			description:
				"Brief public plan/progress explanation: goal, evidence gap, or observable reason for next action. Never hidden chain-of-thought, internal deliberation or unsupported conclusions.",
		}),
	),
	next: Type.Optional(
		Type.String({ maxLength: 160, description: "Next visible action, not a claim of completed work." }),
	),
	text: Type.String({
		minLength: 1,
		maxLength: 60,
		description:
			"Short user-visible description of the current action. Do not include hidden reasoning, conclusions, or percentages.",
	}),
	phase: Type.Optional(
		Type.Union([
			Type.Literal("planning"),
			Type.Literal("literature-search"),
			Type.Literal("knowledge-search"),
			Type.Literal("web-search"),
			Type.Literal("reading"),
			Type.Literal("verification"),
			Type.Literal("synthesis"),
			Type.Literal("deposit"),
			Type.Literal("archive"),
			Type.Literal("skill-evolution"),
			Type.Literal("other"),
		]),
	),
});

export interface StatusToolDetails {
	status: string;
	phase: string;
	uiOnly: true;
	detail?: string;
	next?: string;
	kind?: "plan" | "update" | "summary";
}

export function makeStatusTool(): ToolDefinition<typeof statusParams> {
	return {
		name: "set_status",
		label: "Set Live Status",
		description:
			"Update the short live activity label visible to the user for the current run. For each new substantial tool batch, provide a concise public plan/update FIRST, then the tools; put a short summary of observed results AFTER the finished batch before moving on. You may place it as the first tool call in a batch; the UI preserves declared call order, not parallel completion order. Avoid repeated status-only loops. Keep it concrete and present-tense. Its bounded public plan/progress explanation is shown in the conversation, clearly separate from hidden reasoning and final findings. Never include conclusions, chain-of-thought, confidence scores, or fake percentages.",
		promptSnippet: "set_status({text, kind?, phase?, detail?, next?})",
		parameters: statusParams,
		execute: async (_id, params): Promise<AgentToolResult<StatusToolDetails>> => {
			const status = params.text.replace(/\s+/g, " ").trim();
			return {
				content: [{ type: "text", text: `Status updated: ${status}` }],
				details: {
					status,
					phase: params.phase ?? "other",
					uiOnly: true,
					...(params.kind ? { kind: params.kind } : {}),
					...(params.detail ? { detail: params.detail.trim() } : {}),
					...(params.next ? { next: params.next.trim() } : {}),
				},
			};
		},
	};
}
