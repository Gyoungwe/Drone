import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
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
import type { DiscoveryHostLoader, DiscoveryHostPort } from "@gyoungwe/plugin-api";
import { PluginResourceReservations } from "@gyoungwe/plugin-api/node/reservations";
import { canonicalProjectId } from "../project-id";
import type {
	CriticRequest,
	DiscoveryBaselineRecord,
	DiscoveryEvaluationCase,
	DiscoveryEvaluationObservation,
	DiscoveryEvaluationRun,
	DiscoveryExplorationPlanInput,
	DiscoveryLedgerInput,
	KernelExecution,
	MultipathPathExecutionResult,
	MultipathPlan,
} from "./contracts";
import { createDiscoveryHostInput, type DiscoveryServiceOptions } from "./host-input";

export {
	createDiscoveryHostInput,
	type DiscoveryAuthorization,
	type DiscoveryAuthorizationOperation,
	type DiscoveryServiceOptions,
} from "./host-input";

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

export interface DiscoveryServicePort {
	init(): Promise<void>;
	getCapabilities(language: DiscoveryKernelLanguage): Promise<DiscoveryCapabilities>;
	listKernelSessions(): Promise<readonly DiscoveryKernelSession[]>;
	getKernelSession(sessionId: string): Promise<DiscoveryKernelSession | null>;
	recordDiscovery(input: DiscoveryLedgerInput): Promise<void>;
	createKernelSession(input: DiscoveryKernelSessionInput): Promise<DiscoveryKernelSession>;
	executeKernel(sessionId: string, code: string): Promise<KernelExecution>;
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
	createExplorationPlan(input: DiscoveryExplorationPlanInput): Promise<DiscoveryExplorationPlan>;
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

/** The sole backend discovery surface delegates business behavior to the installed package. */
export function createDiscoveryService(
	options: DiscoveryServiceOptions,
	loader?: DiscoveryHostLoader,
	/** Internal infrastructure seam; production uses the same local-user namespace as native adapters. */
	reservations = new PluginResourceReservations(),
): { service: DiscoveryServicePort; host?: DiscoveryHostPort } {
	const stateRoot = resolve(
		options.agentDir ?? join(resolve(options.projectRoot), "runs", ".drone-discovery"),
	);
	const reserveWriter = async () => {
		await mkdir(stateRoot, { recursive: true });
		if ((await lstat(stateRoot)).isSymbolicLink())
			throw new Error("Discovery state root cannot be a symlink");
		let bindingText: string;
		try {
			bindingText = await readFile(join(stateRoot, "workspace-binding.json"), "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			reservations.reserve("state-writers", [await realpath(stateRoot)]);
			return;
		}
		const binding = JSON.parse(bindingText) as {
			schemaVersion?: unknown;
			workspaceId?: unknown;
			projectId?: unknown;
		} | null;
		if (
			binding?.schemaVersion !== 1 ||
			binding.workspaceId !== canonicalProjectId(options.projectRoot) ||
			binding.projectId !== options.projectId
		)
			throw new Error("Discovery state root belongs to another workspace or project");
		reservations.reserve("state-writers", [await realpath(stateRoot)]);
	};
	let cleanupFailure: unknown;
	const loaded = loader
		? loader.create
			? loader.create(
					createDiscoveryHostInput(options, reserveWriter, (error) => {
						cleanupFailure = error;
					}),
				)
			: loader.load()
		: undefined;
	if (loaded && loaded.contractVersion !== 1)
		throw new Error(`Unsupported discovery host contract: ${loaded.contractVersion}`);
	const pending = new Set<Promise<unknown>>();
	let stopping: Promise<void> | undefined;
	const dispose = () => {
		stopping ??= Promise.resolve().then(async () => {
			// Domain disposal aborts its kernels while accepted calls drain; do not wait for one before starting the other.
			const [domain] = await Promise.allSettled([loaded?.dispose?.(), ...pending]);
			if (domain.status === "rejected") throw domain.reason;
			if (cleanupFailure)
				throw new Error("Discovery journal cleanup failed; writer reservation retained", {
					cause: cleanupFailure,
				});
			reservations.dispose();
		});
		return stopping;
	};
	const host: DiscoveryHostPort | undefined = loaded
		? { contractVersion: 1, init: () => loaded.init?.() ?? Promise.resolve(), dispose }
		: undefined;
	const mutations = new Set<keyof DiscoveryHostPort>([
		"recordDiscovery",
		"createKernelSession",
		"executeKernel",
		"exportKernel",
		"closeKernelSession",
		"createExplorationPlan",
		"runCritic",
		"runMultipath",
		"runEvaluation",
		"putBaseline",
	]);
	// These existing contract-v1 methods authorize through the injected services before doing work.
	const authorizedMethods = new Set<keyof DiscoveryHostPort>([
		"createKernelSession",
		"executeKernel",
		"exportKernel",
		"closeKernelSession",
		"runMultipath",
		"runEvaluation",
	]);
	const methods = [
		"status",
		"getCapabilities",
		"getKernelSession",
		"recordDiscovery",
		"listKernelSessions",
		"createKernelSession",
		"executeKernel",
		"exportKernel",
		"closeKernelSession",
		"listCriticReviews",
		"listMultipathAssessments",
		"listExplorationPlans",
		"listEvaluations",
		"createExplorationPlan",
		"runCritic",
		"runMultipath",
		"runEvaluation",
		"listBaselines",
		"putBaseline",
	] as const;
	if (host && loaded)
		for (const method of methods) {
			const operation = loaded[method];
			if (typeof operation !== "function") continue;
			host[method] = (input: unknown) => {
				if (stopping) return Promise.reject(new Error("Discovery host is stopping or disposed"));
				const running = Promise.resolve().then(async () => {
					if (mutations.has(method) && (!loader?.create || !authorizedMethods.has(method)))
						await reserveWriter();
					return operation.call(loaded, input);
				});
				pending.add(running);
				void running.then(
					() => pending.delete(running),
					() => pending.delete(running),
				);
				return running;
			};
		}
	const invoke = <T>(
		method: Exclude<keyof DiscoveryHostPort, "contractVersion" | "init" | "dispose">,
		input: unknown = {},
	): Promise<T> => {
		const operation = host?.[method];
		if (typeof operation !== "function")
			return Promise.reject(
				Object.assign(
					new Error(`Discovery operation is unavailable: ${method}; install and enable a discovery plugin`),
					{ code: "DISCOVERY_UNAVAILABLE" },
				),
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
export {
	ContainerSandboxRunner as ContainerKernelRunner,
	detectContainerRuntime,
} from "@gyoungwe/plugin-api/node/execution";
