import { CAPABILITY_CATALOG, CAPABILITY_IDS, type CapabilityId, type CapabilityState } from "@drone/shared";
import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { CapabilityRuntime } from "../capabilities/runtime";

const capabilityLiteral = Type.Union(CAPABILITY_IDS.map((id) => Type.Literal(id)));
const params = Type.Object({
	capabilities: Type.Array(capabilityLiteral, { minItems: 1, maxItems: CAPABILITY_IDS.length }),
	task: Type.Optional(
		Type.String({
			maxLength: 1000,
			description:
				"Current research subtask or exact installed skill name; narrows skill discovery without loading bodies.",
		}),
	),
});

export interface CapabilityLoadDetails extends CapabilityState {
	uiOnly: false;
}

export function makeCapabilityLoadTool(runtime: CapabilityRuntime): ToolDefinition<typeof params> {
	const catalog = CAPABILITY_CATALOG.map((item) => `${item.id}: ${item.summary}`).join("; ");
	return {
		name: "capability_load",
		label: "Load capability tools",
		description: `Load one or more tool/skill capability packs only when the current task needs them. This reduces unrelated tool schemas in context. Available packs: ${catalog}. If a required tool, skill, or next-stage contract is not currently available, call this again with the smallest required capability set and a precise task instead of guessing a tool name. Calls are additive within the current turn and safe to repeat. For research skills, pass task describing the specific subtask (e.g. scanpy single-cell analysis). Only relevant installed skill metadata is exposed, not all skills.`,
		promptSnippet:
			"capability_load({capabilities:[knowledge|research|coding|web|files|visualization|external]})",
		parameters: params,
		execute: async (_id, input): Promise<AgentToolResult<CapabilityLoadDetails>> => {
			const before = new Set(runtime.state().activeCapabilities);
			const unique = [...new Set(input.capabilities)] as CapabilityId[];
			const { state } = runtime.activate(unique, input.task);
			const added = state.activeCapabilities.filter((id) => !before.has(id));
			const skills = state.visibleSkills.length
				? `; skills: ${state.visibleSkills.slice(0, 12).join(", ")}`
				: "";
			return {
				content: [
					{
						type: "text",
						text: `Capabilities active: ${state.activeCapabilities.join(", ") || "core"}; ${state.activeTools.length} tools available${added.length ? `; newly added: ${added.join(", ")}` : "; no new pack was needed"}${skills}. You may call capability_load again when a later stage needs another contract.`,
					},
				],
				details: { ...state, uiOnly: false },
			};
		},
	};
}
