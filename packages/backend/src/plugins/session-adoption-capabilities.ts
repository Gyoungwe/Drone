import type {
	PluginRecordAdoptions,
	PluginSessionRecordAdoptionCommitInput,
	PluginSessionRecordAdoptionInspectionInput,
} from "@gyoungwe/plugin-api/runtime";
import { Type } from "typebox";
import { hostText } from "../reply-language";
import type { SessionDirectory } from "../session/registry";
import type { SessionRecordStore } from "../session-engine/session-records";
import type { PluginCapabilityContext, PluginCapabilityHandler } from "./runtime-capabilities";
import { requirePluginSession } from "./session-caller";

const logicalType = Type.String({ minLength: 1, maxLength: 128 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
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

/** The host composition root supplies declarations from this activation's verified installed source. */
export function sessionAdoptionCapabilityHandlers(
	registry: SessionDirectory,
	store: SessionRecordStore,
	declarations: PluginRecordAdoptions | undefined,
): Record<"session.records.adoption.inspect" | "session.records.adoption.commit", PluginCapabilityHandler> {
	function declarationFor(type: string) {
		const declaration = declarations?.[type];
		if (!declaration || !Object.hasOwn(declarations, type))
			throw new Error(`Undeclared legacy checkpoint adoption: ${type}`);
		return declaration;
	}
	function entryFor(context: PluginCapabilityContext) {
		const entry = requirePluginSession(registry, context);
		if (entry.readOnly || !entry.session.settingsManager.isProjectTrusted())
			throw new Error("Legacy checkpoint adoption requires a writable trusted session");
		return entry;
	}
	const detail = (raw: unknown, commit: boolean) => {
		const input = raw as PluginSessionRecordAdoptionInspectionInput;
		const declaration = declarationFor(input.type);
		return `${hostText(commit ? "将旧会话检查点导入当前插件" : "读取供迁移的旧会话检查点", commit ? "Import a legacy session checkpoint into this plugin" : "Read a legacy session checkpoint for migration")}: ${declaration.legacyType} → ${input.type}. ${hostText("旧记录的创建者和包版本无法证明；以下版本仅是此迁移器支持的范围，不表示旧记录来自这些版本", "The legacy creator and package version are unknown; these versions describe supported migrators, not proven legacy provenance")}: ${declaration.fromVersions.join(", ")}. ${hostText("不授予文件、模型或执行权限，也不产生科学验收证明", "No file, model, execution authority or scientific acceptance proof is granted")}.`;
	};
	return {
		"session.records.adoption.inspect": {
			effect: "write",
			approval: "always",
			inputSchema: Type.Object({ type: logicalType }, { additionalProperties: false }),
			resultSchema: Type.Object(
				{
					state: Type.Union(
						["candidate", "absent", "already-adopted", "deferred"].map((state) => Type.Literal(state)),
					),
					legacyType: logicalType,
					supportedFromVersions: Type.Array(Type.String()),
					creator: Type.Literal("unknown"),
					packageVersion: Type.Literal("unknown"),
					candidate: Type.Union([
						Type.Null(),
						Type.Object({ id: Type.String(), hash, data: json }, { additionalProperties: false }),
					]),
				},
				{ additionalProperties: false },
			),
			approvalDetail: (raw) => detail(raw, false),
			execute: async (raw, context) => {
				const input = raw as PluginSessionRecordAdoptionInspectionInput;
				return store.inspectAdoption(
					entryFor(context),
					context.pluginId,
					input.type,
					declarationFor(input.type),
					() => {
						entryFor(context);
					},
				);
			},
		},
		"session.records.adoption.commit": {
			effect: "write",
			approval: "always",
			inputSchema: Type.Object(
				{
					type: logicalType,
					legacyId: Type.String({ minLength: 1, maxLength: 128 }),
					legacyHash: hash,
					data: json,
				},
				{ additionalProperties: false },
			),
			resultSchema: Type.Object(
				{
					state: Type.Literal("adopted"),
					id: Type.String(),
					durability: Type.Literal("durable"),
					legacyId: Type.String(),
					legacyHash: hash,
				},
				{ additionalProperties: false },
			),
			approvalDetail: (raw) => detail(raw, true),
			execute: async (raw, context) => {
				const input = raw as PluginSessionRecordAdoptionCommitInput;
				return store.commitAdoption(
					entryFor(context),
					context.pluginId,
					input,
					declarationFor(input.type),
					() => {
						entryFor(context);
					},
				);
			},
		},
	};
}
