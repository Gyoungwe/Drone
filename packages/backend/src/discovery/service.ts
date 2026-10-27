import { lstat, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type {
	ControlledKernelRunner,
	CriticProvider,
	CriticRequest,
	DiscoveryBaselineRecord,
	DiscoveryEvaluationCase,
	DiscoveryEvaluationObservation,
	DiscoveryEvaluationRun,
	DiscoveryExplorationBudget,
	DiscoveryLedgerInput,
	InquiryDiscoveryPort,
	KernelLanguage,
	KernelSession,
	MultipathPathExecutionResult,
	MultipathPlan,
	rankExplorationCandidates,
} from "@drone/discovery";
import type { QuestionPrior } from "@drone/inquiry";
import type {
	DiscoveryCapabilities,
	DiscoveryCriticReview,
	DiscoveryDataClassification,
	DiscoveryEvaluation,
	DiscoveryExplorationPlan,
	DiscoveryKernelLanguage,
	DiscoveryKernelSession,
	DiscoveryMultipathAssessment,
} from "@drone/shared";
import type {
	DiscoveryHostInput,
	DiscoveryHostLoader,
	DiscoveryHostPort,
	DiscoveryHostServices,
	DiscoveryJournalName,
} from "@gyoungwe/plugin-api";
import { JsonStore } from "../json-store";
import type { StorageRegistry } from "../storage/registry";
import { ContainerKernelRunner, type ContainerKernelRunnerOptions } from "./container-runner";

export type DiscoveryAuthorizationOperation =
	| { readonly kind: "create-kernel-session"; readonly projectId: string }
	| { readonly kind: "execute-kernel"; readonly projectId: string; readonly sessionId: string }
	| { readonly kind: "export-kernel"; readonly projectId: string; readonly sessionId: string }
	| { readonly kind: "close-kernel-session"; readonly projectId: string; readonly sessionId: string }
	| { readonly kind: "multipath-execution"; readonly projectId: string; readonly planId: string }
	| { readonly kind: "evaluation-execution"; readonly projectId: string; readonly runId: string };

export type DiscoveryAuthorization = (operation: DiscoveryAuthorizationOperation) => Promise<void>;

export interface DiscoveryKernelSessionInput {
	readonly sessionId: string;
	readonly runDirectory: string;
	readonly language: DiscoveryKernelLanguage;
	readonly dataClassification: DiscoveryDataClassification;
	readonly idleTimeoutMs?: number;
	readonly executionTimeoutMs?: number;
	readonly maxExecutions?: number;
	readonly maxOutputBytes?: number;
}

export interface DiscoveryServiceOptions {
	readonly projectId: string;
	readonly projectRoot: string;
	readonly storage?: StorageRegistry;
	readonly agentDir?: string;
	/** Existing unassigned journal root, reported without automatic adoption. */
	readonly legacyJournalRoot?: string;
	readonly inquiry?: InquiryDiscoveryPort;
	readonly authorize?: DiscoveryAuthorization;
	readonly runner?: ControlledKernelRunner;
	readonly runnerFactory?: (language: KernelLanguage) => Promise<ControlledKernelRunner>;
	readonly container?: Omit<ContainerKernelRunnerOptions, "projectRoot">;
	readonly criticProvider?: CriticProvider;
	readonly onExecution?: (input: {
		readonly sessionId: string;
		readonly projectId: string;
		readonly cwd: string;
		readonly runDirectory: string;
		readonly language: string;
		readonly code: string;
		readonly execution: Awaited<ReturnType<KernelSession["execute"]>>;
	}) => void | Promise<void>;
}

export interface DiscoveryServicePort {
	init(): Promise<void>;
	getCapabilities(language: DiscoveryKernelLanguage): Promise<DiscoveryCapabilities>;
	listKernelSessions(): Promise<readonly DiscoveryKernelSession[]>;
	getKernelSession(sessionId: string): Promise<DiscoveryKernelSession | null>;
	recordDiscovery(input: DiscoveryLedgerInput): Promise<void>;
	createKernelSession(input: DiscoveryKernelSessionInput): Promise<DiscoveryKernelSession>;
	executeKernel(
		sessionId: string,
		code: string,
	): Promise<ReturnType<KernelSession["execute"]> extends Promise<infer T> ? T : never>;
	exportKernel(sessionId: string): Promise<{
		readonly scriptPath: string;
		readonly notebookPath: string;
		readonly script: string;
		readonly notebook: string;
	}>;
	closeKernelSession(sessionId: string): Promise<void>;
	listCriticReviews(): Promise<readonly DiscoveryCriticReview[]>;
	listMultipathAssessments(): Promise<readonly DiscoveryMultipathAssessment[]>;
	listExplorationPlans(): Promise<readonly DiscoveryExplorationPlan[]>;
	listEvaluations(): Promise<readonly DiscoveryEvaluation[]>;
	createExplorationPlan(input: {
		readonly id: string;
		readonly hypothesisId: string;
		readonly prior: QuestionPrior;
		readonly budget: DiscoveryExplorationBudget;
		readonly candidates: readonly Parameters<typeof rankExplorationCandidates>[0][number][];
	}): Promise<DiscoveryExplorationPlan>;
	runCritic(request: CriticRequest): Promise<DiscoveryCriticReview>;
	runMultipath(
		plan: MultipathPlan,
		executor: (path: MultipathPlan["paths"][number]) => Promise<MultipathPathExecutionResult>,
	): Promise<DiscoveryMultipathAssessment>;
	runEvaluation(
		cases: readonly DiscoveryEvaluationCase[],
		evaluator: (item: DiscoveryEvaluationCase) => Promise<DiscoveryEvaluationObservation>,
		options?: { readonly runId?: string; readonly timeoutMs?: number },
	): Promise<DiscoveryEvaluationRun>;
	dispose(): void | Promise<void>;
	listBaselines(): Promise<readonly DiscoveryBaselineRecord[]>;
	putBaseline(record: DiscoveryBaselineRecord): Promise<void>;
}

/** Writer used by KernelSession.export; every target is checked against projectRoot/runs. */
class ProjectRunFileWriter {
	constructor(private readonly projectRoot: string) {}
	private target(path: string): string {
		if (isAbsolute(path) || path.includes("\u0000")) throw new Error("export path must be relative");
		const target = resolve(this.projectRoot, path);
		const rel = relative(resolve(this.projectRoot), target).replaceAll("\\", "/");
		if (!rel.startsWith("runs/") || rel.includes("../"))
			throw new Error("exports are restricted to project runs");
		return target;
	}
	private async rejectSymlink(target: string): Promise<void> {
		const root = resolve(this.projectRoot);
		const rel = relative(root, target).replaceAll("\\", "/");
		const parts = rel.split("/");
		let current = root;
		for (const part of parts) {
			current = join(current, part);
			try {
				if ((await lstat(current)).isSymbolicLink()) throw new Error("export path contains a symlink");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}
	}
	async prepareDirectory(path: string): Promise<void> {
		const target = this.target(`${path}/.directory`);
		await this.rejectSymlink(target);
		await mkdir(dirname(target), { recursive: true });
	}
	async write(path: string, content: string): Promise<void> {
		const target = this.target(path);
		await this.rejectSymlink(target);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, content, { encoding: "utf8", flag: "wx" }).catch(async (error: unknown) => {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			await writeFile(target, content, { encoding: "utf8" });
		});
	}
}

const journalNames: readonly DiscoveryJournalName[] = [
	"sessions",
	"critics",
	"multipath",
	"plans",
	"evaluations",
	"baselines",
];

/** Infrastructure is constructed only for an installed capability; kernels remain lazy. */
export function createDiscoveryHostInput(options: DiscoveryServiceOptions): DiscoveryHostInput {
	const projectRoot = resolve(options.projectRoot);
	const root = resolve(options.agentDir ?? join(projectRoot, "runs", ".drone-discovery"));
	options.storage?.registerDiscoveredRoot("discovery-root", root, "discovery/service", "private");
	let runnerPromise: Promise<ControlledKernelRunner> | undefined;
	const services: DiscoveryHostServices = {
		journal: <T>(name: DiscoveryJournalName) => {
			if (!journalNames.includes(name)) throw new Error("Unknown discovery journal");
			const entry = options.storage?.registerDiscoveredRoot(
				`discovery-${name}`,
				join(root, `${name}.json`),
				`discovery/${name}`,
				"private",
			);
			return new JsonStore<T[]>({
				path: join(root, `${name}.json`),
				storageId: entry?.id ?? `agent-discovery-${name}`,
				defaultValue: () => [],
			});
		},
		authorize: (operation) => {
			if (operation.projectId !== options.projectId)
				throw new Error("Discovery authorization belongs to another project");
			if (!options.authorize) throw new Error("discovery operation requires task authorization");
			return options.authorize(operation);
		},
		runner: async (language) => {
			let runner: ControlledKernelRunner;
			if (options.runner) runner = options.runner;
			else if (options.runnerFactory) runner = await options.runnerFactory(language);
			else {
				if (!runnerPromise)
					runnerPromise = ContainerKernelRunner.create({ projectRoot, ...options.container }).then(
						(value) =>
							value ?? {
								capabilities: {
									kind: "unavailable" as const,
									languages: ["python", "r"],
									networkDisabled: false,
									writesOnlyToRunDirectory: false,
								},
								run: async () => {
									throw new Error("needs-container");
								},
							},
					);
				runner = await runnerPromise;
			}
			if (runner.capabilities.kind !== "fixture") return runner;
			return {
				capabilities: runner.capabilities,
				run: (request) =>
					runner.run({ ...request, runDirectory: resolve(projectRoot, request.runDirectory) }),
			};
		},
		files: new ProjectRunFileWriter(projectRoot),
		...(options.inquiry ? { inquiry: options.inquiry } : {}),
		...(options.criticProvider ? { criticProvider: options.criticProvider } : {}),
		legacyJournal: async () => {
			if (!options.legacyJournalRoot || resolve(options.legacyJournalRoot) === root) return undefined;
			for (const name of journalNames) {
				try {
					if ((await stat(join(options.legacyJournalRoot, `${name}.json`))).isFile())
						return { status: "unassigned", path: options.legacyJournalRoot };
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
			}
			return undefined;
		},
		onExecution: (receipt) =>
			options.onExecution?.({ ...receipt, projectId: options.projectId, cwd: projectRoot }),
	};
	return { projectId: options.projectId, projectRoot, agentDir: root, services };
}

/** The sole backend discovery surface delegates business behavior to the installed package. */
export function createDiscoveryService(
	options: DiscoveryServiceOptions,
	loader?: DiscoveryHostLoader,
): { service: DiscoveryServicePort; host?: DiscoveryHostPort } {
	const host = loader
		? loader.create
			? loader.create(createDiscoveryHostInput(options))
			: loader.load()
		: undefined;
	if (host && host.contractVersion !== 1)
		throw new Error(`Unsupported discovery host contract: ${host.contractVersion}`);
	const invoke = <T>(
		method: Exclude<keyof DiscoveryHostPort, "contractVersion" | "init" | "dispose">,
		input: unknown = {},
	): Promise<T> => {
		const operation = host?.[method];
		if (typeof operation !== "function")
			return Promise.reject(
				new Error(`Discovery operation is unavailable: ${method}; install and enable a discovery plugin`),
			);
		return Promise.resolve(operation.call(host, input)) as Promise<T>;
	};
	const service: DiscoveryServicePort = {
		init: () => host?.init?.() ?? Promise.resolve(),
		dispose: () => host?.dispose?.(),
		getCapabilities: (language) => invoke("getCapabilities", { language }),
		listKernelSessions: () => invoke("listKernelSessions"),
		getKernelSession: (sessionId) => invoke("getKernelSession", { sessionId }),
		createKernelSession: (input) => invoke("createKernelSession", input),
		executeKernel: (sessionId, code) => invoke("executeKernel", { sessionId, code }),
		exportKernel: (sessionId) => invoke("exportKernel", { sessionId }),
		closeKernelSession: (sessionId) => invoke("closeKernelSession", { sessionId }),
		recordDiscovery: (input) => invoke("recordDiscovery", input),
		listCriticReviews: () => invoke("listCriticReviews"),
		listMultipathAssessments: () => invoke("listMultipathAssessments"),
		listExplorationPlans: () => invoke("listExplorationPlans"),
		listEvaluations: () => invoke("listEvaluations"),
		createExplorationPlan: (input) => invoke("createExplorationPlan", input),
		runCritic: (input) => invoke("runCritic", input),
		runMultipath: (plan, executor) => invoke("runMultipath", { plan, executor }),
		runEvaluation: (cases, evaluator, options) => invoke("runEvaluation", { cases, evaluator, options }),
		listBaselines: () => invoke("listBaselines"),
		putBaseline: (record) => invoke("putBaseline", record),
	};
	return { service, ...(host ? { host } : {}) };
}
export { ContainerKernelRunner, detectContainerRuntime } from "./container-runner";
