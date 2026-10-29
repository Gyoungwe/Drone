/**
 * Versioned host seam for the portable pi-core package.
 *
 * This contract deliberately does not mention Electron, the Pi SDK, or
 * backend implementation types.  A host discovers a loader from an installed
 * package and only then asks it for the per-process core tool surface.
 */
export const CORE_HOST_CONTRACT_VERSION = 1 as const;
export type CoreHostContractVersion = typeof CORE_HOST_CONTRACT_VERSION;

export type CoreToolFactory = () => unknown;

export type CoreMemoryType = "user" | "feedback" | "project" | "reference";

export interface CoreMemoryEntry {
	readonly name: string;
	readonly description: string;
	readonly type: CoreMemoryType;
	readonly body: string;
}

/** The host-facing functions exported by the installed pi-core package. */
export interface CoreHostPort {
	readonly contractVersion: CoreHostContractVersion;
	readonly makeDeliverFilesTool: CoreToolFactory;
	readonly makeMemorySaveTool: CoreToolFactory;
	readonly makeStatusTool: CoreToolFactory;
	readonly makeTodoTool: CoreToolFactory;
	readonly memoryIndexPrompt: (cwd: string) => readonly string[];
	readonly writeMemory: (cwd: string, entry: CoreMemoryEntry) => string;
}

/** Stable loader exported from pi-core's declared host entrypoint. */
export interface CoreHostLoader {
	readonly contractVersion: CoreHostContractVersion;
	readonly load: () => CoreHostPort;
}
