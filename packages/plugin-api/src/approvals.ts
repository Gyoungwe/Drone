/** Permission scopes that a Drone manifest may declare for host-mediated work. */
export type PluginFilesystemPermission =
	| "workspace-read"
	| "workspace"
	| "workspace-write"
	| "configured-vault"
	| "configured-vault-write"
	| "vault-read"
	/** Declares explicit state/lease roots; requires a scoped storage broker, not arbitrary file access. */
	| "application-state"
	| "application-state-write"
	| "binary-state-read"
	| "binary-state-write";

export type PluginApprovalCategory = "subprocess-install" | "background-model-spend";

export interface PluginPermissionDeclaration {
	readonly filesystem: readonly PluginFilesystemPermission[];
	readonly network: readonly string[];
	readonly subprocess: readonly string[];
	readonly externalWrites: boolean;
	/** Absence denies background model spend. Declarations do not grant authorization. */
	readonly model?: readonly "background-model-spend"[];
}
