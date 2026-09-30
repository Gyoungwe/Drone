import { Type } from "typebox";
import type { AskResponse } from "../ask";
import type {
	PermissionAuditTailEntry,
	PermissionProbeInput,
	PermissionProbeResult,
	PermissionSettingsSaveInput,
	PermissionSettingsSaveResult,
	PermissionSettingsSnapshot,
} from "../permission-settings";
import type { ChannelWatchConfigInfo, ContextManagerConfigInfo, PermissionConfigInfo } from "../session";
import { defineDomain } from "./define";

const PermissionSettingsSnapshotSchema = Type.Unsafe<PermissionSettingsSnapshot>({ type: "object" });
const PermissionSettingsSaveInputSchema = Type.Unsafe<PermissionSettingsSaveInput>({
	type: "object",
	properties: {
		settings: { type: "object" },
		expectedMtimeMs: { anyOf: [{ type: "number" }, { type: "null" }] },
		force: { type: "boolean" },
	},
	required: ["settings", "expectedMtimeMs"],
});
const PermissionProbeInputSchema = Type.Unsafe<PermissionProbeInput>({
	type: "object",
	properties: {
		tool: { type: "string", minLength: 1 },
		input: { type: "object" },
		settings: { type: "object" },
	},
	required: ["tool", "input"],
});
const PermissionSettingsSaveResultSchema = Type.Unsafe<PermissionSettingsSaveResult>({ type: "object" });
const PermissionProbeResultSchema = Type.Unsafe<PermissionProbeResult>({ type: "object" });
const PermissionAuditTailEntrySchema = Type.Unsafe<PermissionAuditTailEntry>({ type: "object" });
const AskResponseSchema = Type.Unsafe<AskResponse>({ type: "object" });
const PermissionAnswerSchema = Type.Union([
	Type.Literal("allow"),
	Type.Literal("deny"),
	Type.Literal("allowAlways"),
	Type.Literal("allowDir"),
	Type.Literal("allowRun"),
]);
const PermissionModeSchema = Type.Union([
	Type.Literal("default"),
	Type.Literal("strict"),
	Type.Literal("fullAccess"),
]);
const ContextManagerModeSchema = Type.Union([Type.Literal("evaporation"), Type.Literal("off")]);
const PermissionConfigSchema = Type.Unsafe<PermissionConfigInfo>({ type: "object" });
const ContextManagerConfigSchema = Type.Unsafe<ContextManagerConfigInfo>({ type: "object" });
const ChannelWatchConfigSchema = Type.Unsafe<ChannelWatchConfigInfo>({ type: "object" });

/** Permissions settings host API; all methods remain desktop-only. */
export const PermissionsContract = defineDomain("permissions", {
	methods: {
		load: {
			args: Type.Tuple([]),
			result: PermissionSettingsSnapshotSchema,
		},
		save: {
			args: Type.Tuple([PermissionSettingsSaveInputSchema]),
			result: PermissionSettingsSaveResultSchema,
		},
		reset: {
			args: Type.Tuple([]),
			result: PermissionSettingsSnapshotSchema,
		},
		probe: {
			args: Type.Tuple([PermissionProbeInputSchema]),
			result: PermissionProbeResultSchema,
		},
		auditTail: {
			// TypeBox optional tuple items still produce minItems: 1 in v1.3;
			// express the zero/one argument forms explicitly for IPC callers.
			args: Type.Union([Type.Tuple([]), Type.Tuple([Type.Integer({ minimum: 1 })])]),
			result: Type.Array(PermissionAuditTailEntrySchema),
		},
		respondAsk: {
			args: Type.Tuple([Type.String({ minLength: 1 }), AskResponseSchema]),
			result: Type.Boolean(),
		},
		respondPermission: {
			args: Type.Tuple([Type.String({ minLength: 1 }), PermissionAnswerSchema]),
			result: Type.Void(),
		},
		getConfig: { args: Type.Tuple([]), result: PermissionConfigSchema },
		getMode: { args: Type.Tuple([Type.String({ minLength: 1 })]), result: PermissionModeSchema },
		setMode: {
			args: Type.Tuple([Type.String({ minLength: 1 }), PermissionModeSchema]),
			result: Type.Void(),
		},
		contextManagerGetConfig: { args: Type.Tuple([]), result: ContextManagerConfigSchema },
		contextManagerSetMode: { args: Type.Tuple([ContextManagerModeSchema]), result: Type.Void() },
		channelWatchGetConfig: { args: Type.Tuple([]), result: ChannelWatchConfigSchema },
		channelWatchSetEnabled: { args: Type.Tuple([Type.Boolean()]), result: Type.Void() },
		respondTrust: {
			args: Type.Tuple([Type.String({ minLength: 1 }), Type.Integer()]),
			result: Type.Void(),
		},
		openLocation: { args: Type.Tuple([]), result: Type.Void() },
	},
});
