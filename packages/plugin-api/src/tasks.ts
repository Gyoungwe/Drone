/**
 * Host-neutral task/workbench contract.
 *
 * The task package owns acceptance semantics; a host owns the isolated
 * registry instance and decides which installed extension registrations are
 * admitted.  This module intentionally has no Drone, Electron or Pi SDK
 * dependency so native Pi and Desktop can share the same seam.
 */
export const TASK_HOST_CONTRACT_VERSION = 1 as const;
export type TaskHostContractVersion = typeof TASK_HOST_CONTRACT_VERSION;

export type TaskAcceptanceDefinition = Readonly<Record<string, unknown>>;

export interface TaskAcceptanceHostPort {
	readonly contractVersion: TaskHostContractVersion;
	readonly registerAcceptanceVerifier: (kind: string, definition: TaskAcceptanceDefinition) => void;
	readonly readAcceptanceVerifier: (kind: string) => unknown;
}

export interface TaskHostLoader {
	readonly contractVersion: TaskHostContractVersion;
	readonly load: () => TaskAcceptanceHostPort;
}
