import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const statusParams = Type.Object({
	text: Type.String({
		minLength: 1,
		maxLength: 60,
		description: "Short user-visible description of the current action. Do not include hidden reasoning, conclusions, or percentages.",
	}),
	phase: Type.Optional(
		Type.Union([
			Type.Literal("planning"), Type.Literal("literature-search"), Type.Literal("knowledge-search"),
			Type.Literal("web-search"), Type.Literal("reading"), Type.Literal("verification"),
			Type.Literal("synthesis"), Type.Literal("deposit"), Type.Literal("archive"),
			Type.Literal("skill-evolution"), Type.Literal("other"),
		]),
	),
});

export interface StatusToolDetails {
	status: string;
	phase: string;
	uiOnly: true;
}

export function makeStatusTool(): ToolDefinition<typeof statusParams> {
	return {
		name: "set_status",
		label: "Set Live Status",
		description:
			"Update the short live activity label visible to the user for the current run. Use this for meaningful multi-step work so the user can see what you are doing now. Keep it concrete and present-tense. This is UI state, not a chat message or hidden reasoning. Never include conclusions, chain-of-thought, confidence scores, or fake percentages.",
		promptSnippet: "set_status({text, phase?})",
		parameters: statusParams,
		execute: async (_id, params): Promise<AgentToolResult<StatusToolDetails>> => {
			const status = params.text.replace(/\s+/g, " ").trim();
			return {
				content: [{ type: "text", text: `Status updated: ${status}` }],
				details: { status, phase: params.phase ?? "other", uiOnly: true },
			};
		},
	};
}
