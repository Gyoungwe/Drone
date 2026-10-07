import {
	CAPABILITY_CATALOG,
	CAPABILITY_IDS,
	CAPABILITY_SKILL_LIMIT,
	type CapabilityId,
	type CapabilityState,
} from "@drone/shared";
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
		description: `Load one or more tool/skill capability packs only when the current task needs them. This reduces unrelated tool schemas in context. Available packs: ${catalog}. If a required tool, skill, or next-stage contract is not currently available, call this again with the smallest required capability set and a precise task instead of guessing a tool name. Calls are additive within the current turn and safe to repeat. Each skill capability (analysis, literature, writing, planning, visualization, coding) exposes only its own skills, at most ${CAPABILITY_SKILL_LIMIT} ranked by the task; loading several gives their union. Mixed tasks (e.g. analysis + journal figure) should load every needed capability. Only skill metadata (name, description, SKILL.md path) is exposed; read the chosen SKILL.md before acting.`,
		promptSnippet: `capability_load({capabilities:[${CAPABILITY_IDS.join("|")}], task?})`,
		parameters: params,
		execute: async (_id, input): Promise<AgentToolResult<CapabilityLoadDetails>> => {
			const before = new Set(runtime.state().activeCapabilities);
			const unique = [...new Set(input.capabilities)] as CapabilityId[];
			const { state } = runtime.activate(unique, input.task);
			const added = state.activeCapabilities.filter((id) => !before.has(id));
			const skills = runtime.visibleSkillMetadata();
			const lines = [
				`Capabilities active: ${state.activeCapabilities.join(", ") || "core"}; ${state.activeTools.length} tools available${added.length ? `; newly added: ${added.join(", ")}` : "; no new pack was needed"}.`,
			];
			if (skills.length) {
				lines.push("Visible skills (metadata only, bodies are not loaded):");
				for (const skill of skills)
					lines.push(
						`- ${skill.name}: ${oneLine(skill.description)}${skill.filePath ? ` (SKILL.md: ${skill.filePath})` : ""}`,
					);
				lines.push(
					"Before acting on a skill's domain, read that skill's SKILL.md with the read tool and follow it; do not rely on general knowledge instead.",
				);
			}
			lines.push("You may call capability_load again when a later stage needs another contract.");
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { ...state, uiOnly: false },
			};
		},
	};
}

function oneLine(text: string, max = 200): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
