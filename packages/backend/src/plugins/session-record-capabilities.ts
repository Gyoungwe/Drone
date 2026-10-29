import type { PluginSessionNotifyInput, PluginSessionRecordAppendInput } from "@gyoungwe/plugin-api/runtime";
import { Type } from "typebox";
import { hostText } from "../reply-language";
import type { SessionDirectory } from "../session/registry";
import type { SessionRecordStore } from "../session-engine/session-records";
import type { PluginCapabilityContext, PluginCapabilityHandler } from "./runtime-capabilities";
import { requirePluginSession } from "./session-caller";

const json = Type.Cyclic(
	{
		Json: Type.Union([
			Type.Null(),
			Type.Boolean(),
			Type.Number(),
			Type.String(),
			Type.Array(Type.Ref("Json")),
			Type.Record(Type.String(), Type.Ref("Json")),
		]),
	},
	"Json",
);
const logicalType = Type.String({ minLength: 1, maxLength: 128 });
const durability = Type.Union([Type.Literal("durable"), Type.Literal("deferred")]);

export function sessionRecordCapabilityHandlers(
	registry: SessionDirectory,
	store: SessionRecordStore,
): Record<"session.records.read" | "session.records.append" | "session.notify", PluginCapabilityHandler> {
	function entryFor(context: PluginCapabilityContext, writable: boolean) {
		const entry = requirePluginSession(registry, context);
		if (writable && (entry.readOnly || !entry.session.settingsManager.isProjectTrusted()))
			throw new Error("Session record writes require a writable trusted session");
		return entry;
	}
	return {
		"session.records.read": {
			effect: "read",
			inputSchema: Type.Null(),
			resultSchema: Type.Object(
				{
					mode: Type.Union([Type.Literal("persistent"), Type.Literal("memory")]),
					state: Type.Union([durability, Type.Literal("needs-reopen")]),
					error: Type.Union([Type.Null(), Type.String()]),
					records: Type.Array(
						Type.Object(
							{ id: Type.String(), type: logicalType, data: json },
							{ additionalProperties: false },
						),
					),
				},
				{ additionalProperties: false },
			),
			execute: async (_input, context) =>
				store.read(entryFor(context, false), context.pluginId, () => {
					entryFor(context, false);
				}),
		},
		"session.records.append": {
			effect: "write",
			approval: "own",
			inputSchema: Type.Object({ type: logicalType, data: json }, { additionalProperties: false }),
			resultSchema: Type.Object({ id: Type.String(), durability }, { additionalProperties: false }),
			approvalDetail: (input) =>
				`${hostText("追加当前插件的会话检查点", "Append own-source session checkpoint")}: ${(input as PluginSessionRecordAppendInput).type}`,
			execute: async (input, context) =>
				store.append(
					entryFor(context, true),
					context.pluginId,
					input as PluginSessionRecordAppendInput,
					() => {
						entryFor(context, true);
					},
				),
		},
		"session.notify": {
			effect: "write",
			inputSchema: Type.Object(
				{ content: Type.String({ minLength: 1, maxLength: 16000 }) },
				{ additionalProperties: false },
			),
			resultSchema: Type.Object({ durability }, { additionalProperties: false }),
			approvalDetail: () =>
				hostText(
					"显示当前插件的会话通知（不触发模型）",
					"Display an own-source session notification (no model turn)",
				),
			execute: async (input, context) =>
				store.notify(
					entryFor(context, true),
					context.pluginId,
					(input as PluginSessionNotifyInput).content,
					() => {
						entryFor(context, true);
					},
				),
		},
	};
}
