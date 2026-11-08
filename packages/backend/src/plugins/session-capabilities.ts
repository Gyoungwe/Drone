import type {
	PluginSessionConfirmInput,
	PluginSessionInputRequest,
	PluginSessionSelectInput,
} from "@gyoungwe/plugin-api/runtime";
import { hostText } from "../reply-language";
import type { DecisionFanout } from "../services/decision-fanout";
import type { SessionDirectory } from "../session/registry";
import { withSessionQuestion } from "../session-engine/session-questions";
import type { PluginCapabilityContext, PluginCapabilityHandler } from "./runtime-capabilities";
import { requirePluginSession } from "./session-caller";

const title = { type: "string", minLength: 1, maxLength: 512 };
/** Question text; task authorization and progress prompts carry several paragraphs. */
const questionText = { type: "string", minLength: 1, maxLength: 16000 };
const cancelled = {
	type: "object",
	properties: { kind: { const: "cancelled" } },
	required: ["kind"],
	additionalProperties: false,
};
export function sessionCapabilityHandlers(
	registry: SessionDirectory,
): Record<
	| "session.inspect"
	| "session.tools"
	| "session.capabilities"
	| "session.select"
	| "session.input"
	| "session.confirm",
	PluginCapabilityHandler
> {
	function questionEntry(context: PluginCapabilityContext) {
		const entry = requirePluginSession(registry, context);
		if (entry.readOnly || !entry.session.settingsManager.isProjectTrusted())
			throw new Error("Session questions require a writable trusted session");
		return entry;
	}
	async function question<T>(
		context: PluginCapabilityContext,
		execute: Parameters<typeof withSessionQuestion<T>>[3],
	) {
		const entry = questionEntry(context);
		const result = await withSessionQuestion(entry, context.signal, context.questions, execute);
		questionEntry(context);
		return result;
	}
	return {
		"session.tools": {
			effect: "read",
			inputSchema: { type: "null" },
			resultSchema: {
				type: "array",
				items: {
					type: "object",
					properties: { name: { type: "string" }, readOnlyHint: { type: ["boolean", "null"] } },
					required: ["name", "readOnlyHint"],
					additionalProperties: false,
				},
			},
			execute: async (_input, context) =>
				requirePluginSession(registry, context)
					.session.getAllTools()
					.map((tool) => ({
						name: tool.name,
						readOnlyHint: tool.annotations?.readOnlyHint ?? null,
					})),
		},
		"session.inspect": {
			effect: "read",
			inputSchema: { type: "null" },
			resultSchema: {
				type: "object",
				properties: {
					agentActive: { type: "boolean" },
					projectTrusted: { type: "boolean" },
					readOnly: { type: "boolean" },
				},
				required: ["agentActive", "projectTrusted", "readOnly"],
				additionalProperties: false,
			},
			execute: async (_input, context) => {
				const entry = requirePluginSession(registry, context);
				return {
					agentActive: entry.session.isStreaming,
					projectTrusted: entry.session.settingsManager.isProjectTrusted(),
					readOnly: entry.readOnly === true,
				};
			},
		},
		// The host's capability checkpoint on the actual branch: which capability packs are active.
		"session.capabilities": {
			effect: "read",
			inputSchema: { type: "null" },
			resultSchema: { type: "array", items: { type: "string" }, maxItems: 16 },
			execute: async (_input, context) => {
				const branch = requirePluginSession(registry, context).session.sessionManager.getBranch();
				const checkpoint = branch.findLast(
					(entry) => entry.type === "custom" && entry.customType === "drone-capability-checkpoint-v1",
				);
				const ids = (checkpoint as { data?: { capabilities?: unknown } } | undefined)?.data?.capabilities;
				return Array.isArray(ids) ? ids.filter((id) => typeof id === "string").slice(0, 16) : [];
			},
		},
		"session.select": {
			effect: "write",
			// A question is itself the user's decision point and grants nothing; no extra dialog.
			approval: "own",
			readCallable: true,
			inputSchema: {
				type: "object",
				properties: {
					title: questionText,
					options: { type: "array", items: title, minItems: 1, maxItems: 32, uniqueItems: true },
				},
				required: ["title", "options"],
				additionalProperties: false,
			},
			resultSchema: {
				anyOf: [
					cancelled,
					{
						type: "object",
						properties: { kind: { const: "selected" }, value: title },
						required: ["kind", "value"],
						additionalProperties: false,
					},
				],
			},
			execute: async (raw, context) => {
				const input = raw as PluginSessionSelectInput;
				return question(context, async (ui, signal) => {
					const value = await ui.select(input.title, [...input.options], { signal });
					return value === undefined ? { kind: "cancelled" } : { kind: "selected", value };
				});
			},
		},
		"session.input": {
			effect: "write",
			// A question is itself the user's decision point and grants nothing; no extra dialog.
			approval: "own",
			readCallable: true,
			inputSchema: {
				type: "object",
				properties: { title: questionText, placeholder: { type: "string", maxLength: 1024 } },
				required: ["title"],
				additionalProperties: false,
			},
			resultSchema: {
				anyOf: [
					cancelled,
					{
						type: "object",
						properties: {
							kind: { const: "input" },
							value: { type: "string", maxLength: 16000 },
						},
						required: ["kind", "value"],
						additionalProperties: false,
					},
				],
			},
			execute: async (raw, context) => {
				const input = raw as PluginSessionInputRequest;
				return question(context, async (ui, signal) => {
					const value = await ui.input(input.title, input.placeholder, { signal });
					return value === undefined ? { kind: "cancelled" } : { kind: "input", value };
				});
			},
		},
		"session.confirm": {
			effect: "write",
			// A question is itself the user's decision point and grants nothing; no extra dialog.
			approval: "own",
			readCallable: true,
			inputSchema: {
				type: "object",
				properties: { title, message: { type: "string", minLength: 1, maxLength: 4000 } },
				required: ["title", "message"],
				additionalProperties: false,
			},
			resultSchema: {
				anyOf: [
					cancelled,
					{
						type: "object",
						properties: { kind: { const: "confirmed" }, value: { type: "boolean" } },
						required: ["kind", "value"],
						additionalProperties: false,
					},
				],
			},
			execute: async (raw, context) => {
				const input = raw as PluginSessionConfirmInput;
				const yes = hostText("确认", "Confirm"),
					no = hostText("拒绝", "Decline");
				return question(context, async (ui, signal) => {
					const value = await ui.select(`${input.title}\n\n${input.message}`, [yes, no], { signal });
					return value === undefined ? { kind: "cancelled" } : { kind: "confirmed", value: value === yes };
				});
			},
		},
	};
}

/** Agent decisions a plugin records in the caller's project journal, as native plugins emit drone:decision-record/v1. */
export function sessionDecisionCapabilityHandlers(
	registry: SessionDirectory,
	decisions: DecisionFanout,
): Record<"session.decision.record", PluginCapabilityHandler> {
	return {
		"session.decision.record": {
			effect: "write",
			// A journal entry the user can review and revoke; it grants nothing, so no extra dialog.
			approval: "own",
			readCallable: true,
			inputSchema: {
				type: "object",
				properties: {
					id: { type: "string", minLength: 1, maxLength: 200 },
					kind: { enum: ["task-authorization", "rebind", "zotero-write"] },
					summary: { type: "string", minLength: 1, maxLength: 2000 },
					basis: { type: "array", items: { type: "string", maxLength: 512 }, maxItems: 32 },
				},
				required: ["id", "kind", "summary", "basis"],
				additionalProperties: false,
			},
			resultSchema: { type: "null" },
			execute: async (raw, context) => {
				const entry = requirePluginSession(registry, context);
				const input = raw as { id: string; kind: string; summary: string; basis: string[] };
				// The host names the plugin, the project and the time; a plugin cannot replace another's record.
				decisions.publish(
					{ ...input, id: `${context.pluginId}:${input.id}`, at: new Date().toISOString() },
					entry.cwd,
				);
				return null;
			},
		},
	};
}
