/** Generic bounded local execution contracts; no research-domain or host dependency. */
export type SandboxLanguage = "python" | "r";
export type SandboxClassification = "public" | "internal" | "controlled" | "restricted";
export interface SandboxCapabilities {
	readonly kind: "container" | "fixture" | "unavailable";
	readonly languages: readonly SandboxLanguage[];
	readonly networkDisabled: boolean;
	readonly writesOnlyToRunDirectory: boolean;
}
export interface SandboxRunRequest {
	/** Cancellation settles only after this execution's owned resources are removed and verified. */
	readonly signal?: AbortSignal;
	readonly requestId: string;
	readonly language: SandboxLanguage;
	readonly code: string;
	readonly runDirectory: string;
	readonly timeoutMs: number;
	readonly maxOutputBytes: number;
	readonly dataClassification: SandboxClassification;
}
export interface SandboxRunOutput {
	readonly text: string;
	readonly contentKind: "summary" | "plot" | "table" | "raw";
	readonly classification: SandboxClassification;
}
export interface SandboxRunResult {
	readonly exitCode: number;
	readonly outputs: readonly SandboxRunOutput[];
	readonly durationMs: number;
	readonly producedBytes: number;
}
export interface ControlledSandboxRunner {
	readonly capabilities: SandboxCapabilities;
	run(request: SandboxRunRequest): Promise<SandboxRunResult>;
}
