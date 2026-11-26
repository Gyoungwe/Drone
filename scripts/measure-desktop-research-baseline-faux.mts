import type * as PiAi from "@earendil-works/pi-ai";
import type { TSchema } from "typebox";
import {
	type createResultReferences,
	type DesktopScenario,
	validateResolvedInput,
} from "./measure-desktop-research-baseline-contract.mts";

export function objectFields(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
}

export function fauxResponses(
	ai: typeof PiAi,
	scenario: DesktopScenario,
	schemas: ReadonlyMap<string, TSchema>,
	references: ReturnType<typeof createResultReferences>,
): PiAi.FauxResponseStep[] {
	return [
		...scenario.fauxCalls.map(({ name, input }) => () => {
			const schema = schemas.get(name);
			if (!schema) throw new Error(`Unregistered faux tool: ${name}`);
			const args = validateResolvedInput(name, references.resolve(input), schema);
			return ai.fauxAssistantMessage([ai.fauxToolCall(name, args as PiAi.JsonObject)], { stopReason: "toolUse" });
		}),
		() => {
			const draft = references.resolve(scenario.finalDraft);
			if (typeof draft !== "string") throw new Error("Invalid resolved final draft");
			return ai.fauxAssistantMessage(draft);
		},
	];
}

export function offlineModel(ai: typeof PiAi, responses: PiAi.FauxResponseStep[]) {
	const faux = ai.fauxProvider({ provider: "desktop-baseline-faux", tokensPerSecond: 0 });
	faux.setResponses(responses);
	return { provider: faux.provider, model: faux.getModel() };
}
