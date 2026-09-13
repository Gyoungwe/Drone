import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { CAPABILITY_CATALOG, CAPABILITY_IDS, type CapabilityId, type CapabilityState } from "@percho/shared";
import { Type } from "typebox";
import type { CapabilityRuntime } from "../capabilities/runtime";

const capabilityLiteral = Type.Union(CAPABILITY_IDS.map((id) => Type.Literal(id)));
const params = Type.Object({
	capabilities: Type.Array(capabilityLiteral, { minItems: 1, maxItems: CAPABILITY_IDS.length }),
});

export interface CapabilityLoadDetails extends CapabilityState {
	uiOnly: false;
}

export function makeCapabilityLoadTool(runtime: CapabilityRuntime): ToolDefinition<typeof params> {
	const catalog = CAPABILITY_CATALOG.map((item) => `${item.id}: ${item.summary}`).join("; ");
	return {
		name: "capability_load",
		label: "Load capability tools",
		description: `Load one or more tool/skill capability packs only when the current task needs them. This reduces unrelated tool schemas in context. Available packs: ${catalog}. If a required tool is not currently available, call this instead of guessing a tool name.`,
		promptSnippet:
			"capability_load({capabilities:[knowledge|research|coding|web|files|visualization|external]})",
		parameters: params,
		execute: async (_id, input): Promise<AgentToolResult<CapabilityLoadDetails>> => {
			const unique = [...new Set(input.capabilities)] as CapabilityId[];
			const { state } = runtime.activate(unique);
			const skills = state.visibleSkills.length
				? `; skills: ${state.visibleSkills.slice(0, 12).join(", ")}`
				: "";
			return {
				content: [
					{
						type: "text",
						text: `Capabilities active: ${state.activeCapabilities.join(", ") || "core"}; ${state.activeTools.length} tools available${skills}.`,
					},
				],
				details: { ...state, uiOnly: false },
			};
		},
	};
}
