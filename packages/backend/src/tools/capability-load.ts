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
		description: `Load one or more tool/skill capability packs only when the current task needs them. This reduces unrelated tool schemas in context. Available packs: ${catalog}. If a required tool, skill, or next-stage contract is not currently available, call this again with the smallest required capability set and a precise task instead of guessing a tool name. Calls are additive within the current turn and safe to repeat. Each skill capability (analysis, literature, writing, planning, visualization, coding) exposes only its own skills, at most ${CAPABILITY_SKILL_LIMIT} ranked by the task; loading several gives their union. Mixed tasks (e.g. analysis + journal figure) should load every needed capability. coding carries the shell (bash/powershell), edit and write tools: load it when commands must run (analysis pipelines, mamba environment setup) or files must be written. Loaded next to other skill capabilities without an engineering task, coding adds tools only, not engineering skills. Only skill metadata (name, description, SKILL.md path) is exposed; read the chosen SKILL.md before acting.`,
		promptSnippet: `capability_load({capabilities:[${CAPABILITY_IDS.join("|")}], task?})`,
		parameters: params,
		execute: async (_id, input): Promise<AgentToolResult<CapabilityLoadDetails>> => {
			const before = new Set(runtime.state().activeCapabilities);
			const unique = [...new Set(input.capabilities)] as CapabilityId[];
			const { state } = runtime.activate(unique, input.task);
			const added = state.activeCapabilities.filter((id) => !before.has(id));
			const skills = runtime.visibleSkillMetadata();
			const primary = skills.find((skill) => skill.role === "primary");
			const lines: string[] = [];
			if (primary?.filePath)
				lines.push(
					`Read first: ${primary.filePath} (primary skill ${primary.name}) with the read tool before acting; follow it instead of general knowledge.`,
				);
			else if (skills.length)
				lines.push(
					"Read first: the SKILL.md of the skill you pick below, with the read tool, before acting; follow it instead of general knowledge.",
				);
			lines.push(
				`Capabilities active: ${state.activeCapabilities.join(", ") || "core"}; ${state.activeTools.length} tools available${added.length ? `; newly added: ${added.join(", ")}` : "; no new pack was needed"}.`,
			);
			if (skills.length) {
				lines.push("Visible skills, most relevant first (metadata only, bodies are not loaded):");
				const omitted: string[] = [];
				let size = lines.join("\n").length;
				for (const skill of skills) {
					const tag = skill.role === "primary" ? " [primary]" : skill.role === "base" ? " [base]" : "";
					const line = `- ${skill.name}${tag}: ${oneLine(skill.description, 140)}${skill.filePath ? ` (SKILL.md: ${skill.filePath})` : ""}`;
					if (size + line.length > OUTPUT_BUDGET && skill.role !== "primary") {
						omitted.push(skill.name);
						continue;
					}
					lines.push(line);
					size += line.length + 1;
				}
				if (omitted.length) lines.push(`Also visible (see the skill list for paths): ${omitted.join(", ")}`);
			}
			lines.push("You may call capability_load again when a later stage needs another contract.");
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { ...state, uiOnly: false },
			};
		},
	};
}

/** Approximate character budget for the listed skills (the tail is reduced to names only). */
const OUTPUT_BUDGET = 3000;

function oneLine(text: string, max = 200): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
