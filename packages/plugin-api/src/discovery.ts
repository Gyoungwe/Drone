/** Host-owned execution and persistence mechanisms for the discovery migration. Domain wire schemas remain in the optional package. */
export type DiscoveryLanguage = "python" | "r";
export type DiscoveryClassification = "public" | "internal" | "controlled" | "restricted";
export interface DiscoveryRunnerCapabilities {
	readonly kind: "container" | "fixture" | "unavailable";
	readonly languages: readonly DiscoveryLanguage[];
	readonly networkDisabled: boolean;
	readonly writesOnlyToRunDirectory: boolean;
}
export interface DiscoveryRunRequest {
	readonly requestId: string;
	readonly language: DiscoveryLanguage;
	readonly code: string;
	readonly runDirectory: string;
	readonly timeoutMs: number;
	readonly maxOutputBytes: number;
	readonly dataClassification: DiscoveryClassification;
}
export interface DiscoveryRunResult {
	readonly exitCode: number;
	readonly durationMs: number;
	readonly producedBytes: number;
	readonly outputs: readonly {
		readonly text: string;
		readonly contentKind: "summary" | "plot" | "table" | "raw";
		readonly classification: DiscoveryClassification;
	}[];
}
export interface DiscoveryRunner {
	readonly capabilities: DiscoveryRunnerCapabilities;
	run(request: DiscoveryRunRequest): Promise<DiscoveryRunResult>;
}
export interface DiscoveryKernelExecution {
	readonly id: string;
	readonly code: string;
	readonly startedAt: string;
	readonly finishedAt: string;
	readonly status: "succeeded" | "failed" | "blocked";
	readonly exitCode?: number;
	readonly output: string;
	readonly outputClassification: DiscoveryClassification;
	readonly contentKinds: readonly ("summary" | "plot" | "table" | "raw")[];
	readonly producedBytes: number;
	readonly redactedBytes: number;
	readonly blockedReason?: string;
}
export type DiscoveryAuthorizationOperation =
	| { readonly kind: "create-kernel-session"; readonly projectId: string }
	| {
			readonly kind: "execute-kernel" | "export-kernel" | "close-kernel-session";
			readonly projectId: string;
			readonly sessionId: string;
	  }
	| { readonly kind: "multipath-execution"; readonly projectId: string; readonly planId: string }
	| { readonly kind: "evaluation-execution"; readonly projectId: string; readonly runId: string };
export type DiscoveryJournalName =
	| "sessions"
	| "critics"
	| "multipath"
	| "plans"
	| "evaluations"
	| "baselines";
export interface DiscoveryJournal<T> {
	read(): Promise<T[]>;
	write(records: T[]): Promise<void>;
}
/** Temporary host ledger adapter; existing Inquiry validates its own records. */
export interface DiscoveryInquiryPort {
	recordQuestion(record: unknown): Promise<void>;
	recordAttempt(record: unknown): Promise<void>;
	recordFinding?(record: unknown): Promise<void>;
}
export interface DiscoveryExecutionReceipt {
	readonly sessionId: string;
	readonly projectId: string;
	readonly cwd: string;
	readonly runDirectory: string;
	readonly language: string;
	readonly code: string;
	readonly execution: DiscoveryKernelExecution;
}
/** Temporary opaque provider adapter; review schemas belong to the package. */
export interface DiscoveryCriticProvider {
	readonly providerId: string;
	review(input: unknown): Promise<readonly unknown[]>;
}
export interface DiscoveryHostServices {
	journal<T>(name: DiscoveryJournalName): DiscoveryJournal<T>;
	authorize(operation: DiscoveryAuthorizationOperation): Promise<void>;
	runner(language: DiscoveryLanguage): Promise<DiscoveryRunner>;
	readonly files: {
		prepareDirectory(path: string): Promise<void>;
		write(path: string, content: string, mediaType: string): Promise<void>;
	};
	readonly inquiry?: DiscoveryInquiryPort;
	readonly criticProvider?: DiscoveryCriticProvider;
	onExecution(receipt: DiscoveryExecutionReceipt): void | Promise<void>;
	legacyJournal(): Promise<{ readonly status: "unassigned"; readonly path: string } | undefined>;
}
export interface DiscoveryHostInput {
	readonly projectId: string;
	readonly projectRoot: string;
	readonly agentDir?: string;
	readonly services: DiscoveryHostServices;
}
export interface DiscoveryHostPort {
	readonly contractVersion: 1;
	status?(input: unknown): Promise<unknown>;
	init?(): Promise<void>;
	dispose?(): void | Promise<void>;
	getCapabilities?(input: unknown): Promise<unknown>;
	getKernelSession?(input: unknown): Promise<unknown>;
	recordDiscovery?(input: unknown): Promise<unknown>;
	listKernelSessions?(input: unknown): Promise<unknown>;
	createKernelSession?(input: unknown): Promise<unknown>;
	executeKernel?(input: unknown): Promise<unknown>;
	exportKernel?(input: unknown): Promise<unknown>;
	closeKernelSession?(input: unknown): Promise<unknown>;
	listCriticReviews?(input: unknown): Promise<unknown>;
	listMultipathAssessments?(input: unknown): Promise<unknown>;
	listExplorationPlans?(input: unknown): Promise<unknown>;
	listEvaluations?(input: unknown): Promise<unknown>;
	createExplorationPlan?(input: unknown): Promise<unknown>;
	runCritic?(input: unknown): Promise<unknown>;
	runMultipath?(input: unknown): Promise<unknown>;
	runEvaluation?(input: unknown): Promise<unknown>;
	listBaselines?(input: unknown): Promise<unknown>;
	putBaseline?(input: unknown): Promise<unknown>;
}
export interface DiscoveryHostLoader {
	readonly contractVersion: 1;
	load(): DiscoveryHostPort;
	create?(input: DiscoveryHostInput): DiscoveryHostPort;
}
