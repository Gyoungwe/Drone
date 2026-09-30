import { Type } from "typebox";
import type {
	PermissionAuditTailEntry,
	PermissionProbeInput,
	PermissionProbeResult,
	PermissionSettingsSaveInput,
	PermissionSettingsSaveResult,
	PermissionSettingsSnapshot,
} from "../permission-settings";
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
	},
});
