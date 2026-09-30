import { Type } from "typebox";
import type { DiagnosticsSnapshot } from "../diagnostics";
import type { AppInfo } from "../session";
import { defineDomain } from "./define";

const AppInfoSchema = Type.Object(
	{
		name: Type.String(),
		version: Type.String(),
		electron: Type.String(),
		chrome: Type.String(),
		node: Type.String(),
		platform: Type.String(),
		arch: Type.String(),
		repoUrl: Type.String(),
	},
	{ additionalProperties: false },
);

// The diagnostics payload is already defined as a shared, redacted snapshot.
// Keep the contract schema intentionally shallow here so adding diagnostic
// metadata remains backward compatible with older renderers.
const DiagnosticsSnapshotSchema = Type.Unsafe<DiagnosticsSnapshot>({ type: "object" });

/** Host API contract for application metadata and diagnostics. */
export const AppContract = defineDomain("app", {
	methods: {
		getInfo: {
			args: Type.Tuple([]),
			result: Type.Unsafe<AppInfo>(AppInfoSchema),
		},
		getDiagnostics: {
			args: Type.Tuple([]),
			result: DiagnosticsSnapshotSchema,
		},
		getDailyDir: {
			args: Type.Tuple([]),
			result: Type.String({ minLength: 1 }),
		},
	},
});
