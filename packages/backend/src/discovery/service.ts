import { lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { InquiryDiscoveryPort } from "@drone/discovery";
import {
	type ControlledKernelRunner,
	type CriticProvider,
	type CriticRequest,
	createBaseline,
	createMultiPathPlan,
	type DiscoveryBaselineRecord,
	type DiscoveryEvaluationCase,
	type DiscoveryEvaluationObservation,
	type DiscoveryEvaluationRun,
	type DiscoveryExplorationBudget,
	type DiscoveryLedgerInput,
	ExplorationBudgetLedger,
	executeMultiPath,
	type KernelLanguage,
	type KernelRunnerCapabilities,
	KernelSession,
	type KernelSessionOptions,
	type MultipathPathExecutionResult,
	type MultipathPlan,
	rankExplorationCandidates,
	recordCriticQuestions,
	recordDiscoveryToInquiry,
	runCriticReview,
	runEvaluation,
	UnavailableKernelRunner,
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
	readonly inquiry?: InquiryDiscoveryPort;
	readonly authorize?: DiscoveryAuthorization;
	readonly runner?: ControlledKernelRunner;
	readonly runnerFactory?: (language: KernelLanguage) => Promise<ControlledKernelRunner>;
	readonly container?: Omit<ContainerKernelRunnerOptions, "projectRoot">;
	readonly criticProvider?: CriticProvider;
}

interface PersistedSession {
	readonly sessionId: string;
	readonly runDirectory: string;
	readonly language: DiscoveryKernelLanguage;
	readonly dataClassification: DiscoveryDataClassification;
	readonly status: DiscoveryKernelSession["status"];
	readonly executionCount: number;
	readonly capabilities: KernelRunnerCapabilities;
	readonly createdAt: string;
}
interface PersistedCritic extends DiscoveryCriticReview {
	readonly recordedAt: string;
}
interface PersistedMultipath extends DiscoveryMultipathAssessment {
	readonly recordedAt: string;
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
}

function safeProjectId(value: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error("Invalid discovery project id");
	return value;
}
function safeSessionId(value: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error("Invalid discovery session id");
	return value;
}
function safeRunDirectory(projectRoot: string, value: string): string {
	if (isAbsolute(value) || value.includes("\u0000"))
		throw new Error("Discovery run directory must be relative");
	const normalized = value.replaceAll("\\", "/");
	const candidate = resolve(projectRoot, normalized);
	const rel = relative(resolve(projectRoot), candidate).replaceAll("\\", "/");
	if (!rel.startsWith("runs/") || rel.includes("../") || rel === "runs")
		throw new Error("Discovery runs are restricted to project runs");
	return normalized;
}
function toCapabilities(value: KernelRunnerCapabilities): DiscoveryCapabilities {
	return {
		kind: value.kind,
		languages: [...value.languages],
		networkDisabled: value.networkDisabled,
		writesOnlyToRunDirectory: value.writesOnlyToRunDirectory,
	};
}
function scopeFixtureRunner(runner: ControlledKernelRunner, projectRoot: string): ControlledKernelRunner {
	if (runner.capabilities.kind !== "fixture") return runner;
	return {
		capabilities: runner.capabilities,
		run: (request) => runner.run({ ...request, runDirectory: resolve(projectRoot, request.runDirectory) }),
	};
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

class FileBaselineStore {
	private readonly store: JsonStore<
		Awaited<
			ReturnType<import("@drone/discovery").DiscoveryBaselineStore["list"]>
		> extends readonly (infer _T)[]
			? any
			: never
	>;
	constructor(path: string) {
		this.store = new JsonStore<DiscoveryBaselineRecord[]>({
			path,
			storageId: "agent-discovery-baselines",
			defaultValue: () => [],
		});
	}
	async put(record: import("@drone/discovery").DiscoveryBaselineRecord): Promise<void> {
		const normalized = createBaseline(record);
		const records = (await this.store.read()) as import("@drone/discovery").DiscoveryBaselineRecord[];
		const index = records.findIndex(
			(item) =>
				item.metric === normalized.metric &&
				item.datasetId === normalized.datasetId &&
				item.datasetRevision === normalized.datasetRevision,
		);
		if (index >= 0) records[index] = normalized;
		else records.push(normalized);
		await this.store.write(records);
	}
	async get(
		metric: import("@drone/discovery").DiscoveryEvaluationMetric,
		datasetId: string,
		revision: string,
	): Promise<import("@drone/discovery").DiscoveryBaselineRecord | undefined> {
		return (await this.store.read()).find(
			(item: import("@drone/discovery").DiscoveryBaselineRecord) =>
				item.metric === metric && item.datasetId === datasetId && item.datasetRevision === revision,
		);
	}
	async list(): Promise<readonly import("@drone/discovery").DiscoveryBaselineRecord[]> {
		return await this.store.read();
	}
}

/** Backend composition-root service for B5d–B5f. */
export class DiscoveryService implements DiscoveryServicePort {
	readonly projectId: string;
	readonly projectRoot: string;
	private readonly options: DiscoveryServiceOptions;
	private readonly sessionsStore: JsonStore<PersistedSession[]>;
	private readonly criticsStore: JsonStore<PersistedCritic[]>;
	private readonly multipathStore: JsonStore<PersistedMultipath[]>;
	private readonly plansStore: JsonStore<DiscoveryExplorationPlan[]>;
	private readonly evaluationsStore: JsonStore<DiscoveryEvaluation[]>;
	private readonly baselineStore: FileBaselineStore;
	private readonly sessions = new Map<string, KernelSession>();
	private readonly sessionMeta = new Map<string, PersistedSession>();
	private readonly critics: PersistedCritic[] = [];
	private readonly multipaths: PersistedMultipath[] = [];
	private readonly plans: DiscoveryExplorationPlan[] = [];
	private readonly evaluations: DiscoveryEvaluation[] = [];
	private runnerPromise?: Promise<ControlledKernelRunner>;
	private initialized?: Promise<void>;
	private disposed = false;

	constructor(options: DiscoveryServiceOptions) {
		this.projectId = safeProjectId(options.projectId);
		if (!isAbsolute(options.projectRoot)) throw new Error("discovery projectRoot must be absolute");
		this.projectRoot = resolve(options.projectRoot);
		this.options = options;
		const root = resolve(options.agentDir ?? join(this.projectRoot, "runs", ".drone-discovery"));
		const path = (name: string) => join(root, name);
		this.sessionsStore = new JsonStore<PersistedSession[]>({
			path: path("sessions.json"),
			storageId: "discovery-sessions",
			defaultValue: () => [],
		});
		this.criticsStore = new JsonStore<PersistedCritic[]>({
			path: path("critics.json"),
			storageId: "discovery-critics",
			defaultValue: () => [],
		});
		this.multipathStore = new JsonStore<PersistedMultipath[]>({
			path: path("multipath.json"),
			storageId: "discovery-multipath",
			defaultValue: () => [],
		});
		this.plansStore = new JsonStore<DiscoveryExplorationPlan[]>({
			path: path("plans.json"),
			storageId: "discovery-plans",
			defaultValue: () => [],
		});
		this.evaluationsStore = new JsonStore<DiscoveryEvaluation[]>({
			path: path("evaluations.json"),
			storageId: "discovery-evaluations",
			defaultValue: () => [],
		});
		this.baselineStore = new FileBaselineStore(path("baselines.json"));
		if (options.storage) this.registerStorage(options.storage, root, path);
	}

	private registerStorage(storage: StorageRegistry, root: string, path: (name: string) => string): void {
		for (const [id, target, owner] of [
			["agent-discovery-root", root, "discovery/service"],
			["agent-discovery-sessions", path("sessions.json"), "discovery/sessions"],
			["agent-discovery-critics", path("critics.json"), "discovery/critics"],
			["agent-discovery-multipath", path("multipath.json"), "discovery/multipath"],
			["agent-discovery-plans", path("plans.json"), "discovery/plans"],
			["agent-discovery-evaluations", path("evaluations.json"), "discovery/evaluations"],
			["agent-discovery-baselines", path("baselines.json"), "discovery/baselines"],
		] as const) {
			if (!storage.get(id)) storage.register({ id, path: target, owner, schema: 1, sensitivity: "private" });
		}
	}

	async init(): Promise<void> {
		if (this.initialized) return this.initialized;
		this.initialized = (async () => {
			if (this.disposed) throw new Error("discovery service is disposed");
			const [sessions, critics, multipaths, plans, evaluations] = await Promise.all([
				this.sessionsStore.read(),
				this.criticsStore.read(),
				this.multipathStore.read(),
				this.plansStore.read(),
				this.evaluationsStore.read(),
			]);
			for (const session of sessions) {
				try {
					if (safeSessionId(session.sessionId) && session.runDirectory.startsWith("runs/"))
						this.sessionMeta.set(session.sessionId, session);
				} catch {
					// Corrupt individual records do not make the entire project unavailable.
				}
			}
			this.critics.splice(0, this.critics.length, ...critics);
			this.multipaths.splice(0, this.multipaths.length, ...multipaths);
			this.plans.splice(0, this.plans.length, ...plans);
			this.evaluations.splice(0, this.evaluations.length, ...evaluations);
		})();
		return this.initialized;
	}

	private async authorize(operation: DiscoveryAuthorizationOperation): Promise<void> {
		if (!this.options.authorize) throw new Error("discovery operation requires task authorization");
		await this.options.authorize(operation);
	}

	private runnerFor(language: KernelLanguage): Promise<ControlledKernelRunner> {
		if (this.options.runner) return Promise.resolve(this.options.runner);
		if (this.options.runnerFactory) return this.options.runnerFactory(language);
		if (!this.runnerPromise) {
			this.runnerPromise = ContainerKernelRunner.create({
				projectRoot: this.projectRoot,
				...(this.options.container ?? {}),
			}).then((runner) => runner ?? new UnavailableKernelRunner());
		}
		return this.runnerPromise;
	}

	async getCapabilities(language: DiscoveryKernelLanguage): Promise<DiscoveryCapabilities> {
		const runner = await this.runnerFor(language);
		return toCapabilities(runner.capabilities);
	}

	private async persistSessions(): Promise<void> {
		await this.sessionsStore.write([...this.sessionMeta.values()]);
	}
	private sessionProjection(id: string): DiscoveryKernelSession | null {
		const session = this.sessions.get(id);
		const meta = this.sessionMeta.get(id);
		if (!meta) return null;
		if (!session)
			return {
				sessionId: meta.sessionId,
				language: meta.language,
				dataClassification: meta.dataClassification,
				runDirectory: meta.runDirectory,
				status: meta.status,
				executionCount: meta.executionCount,
				remainingExecutions: 0,
				capabilities: toCapabilities(meta.capabilities),
			};
		const status = session.status;
		return {
			sessionId: id,
			language: meta.language,
			dataClassification: meta.dataClassification,
			runDirectory: meta.runDirectory,
			status: status.status,
			executionCount: status.executionCount,
			remainingExecutions: status.remainingExecutions,
			...(status.expiresAt ? { expiresAt: status.expiresAt } : {}),
			capabilities: toCapabilities(meta.capabilities),
		};
	}

	async listKernelSessions(): Promise<readonly DiscoveryKernelSession[]> {
		await this.init();
		return [...this.sessionMeta.keys()]
			.map((id) => this.sessionProjection(id))
			.filter((value): value is DiscoveryKernelSession => value !== null);
	}
	async getKernelSession(sessionId: string): Promise<DiscoveryKernelSession | null> {
		await this.init();
		return this.sessionProjection(safeSessionId(sessionId));
	}
	async recordDiscovery(input: DiscoveryLedgerInput): Promise<void> {
		await this.init();
		if (!this.options.inquiry) throw new Error("inquiry ledger is not configured");
		if (input.projectId !== this.projectId)
			throw new Error("discovery project does not match inquiry project");
		await recordDiscoveryToInquiry(this.options.inquiry, input);
	}
	async createKernelSession(input: DiscoveryKernelSessionInput): Promise<DiscoveryKernelSession> {
		await this.init();
		await this.authorize({ kind: "create-kernel-session", projectId: this.projectId });
		const sessionId = safeSessionId(input.sessionId);
		if (this.sessionMeta.has(sessionId)) throw new Error(`Discovery session already exists: ${sessionId}`);
		const runDirectory = safeRunDirectory(this.projectRoot, input.runDirectory);
		await mkdir(resolve(this.projectRoot, runDirectory), { recursive: true });
		const runner = scopeFixtureRunner(await this.runnerFor(input.language), this.projectRoot);
		const options: KernelSessionOptions = {
			sessionId,
			runDirectory,
			language: input.language,
			dataClassification: input.dataClassification,
			runner,
			writer: new ProjectRunFileWriter(this.projectRoot),
			...(input.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: input.idleTimeoutMs }),
			...(input.executionTimeoutMs === undefined ? {} : { executionTimeoutMs: input.executionTimeoutMs }),
			...(input.maxExecutions === undefined ? {} : { maxExecutions: input.maxExecutions }),
			...(input.maxOutputBytes === undefined ? {} : { maxOutputBytes: input.maxOutputBytes }),
		};
		const session = new KernelSession(options);
		this.sessions.set(sessionId, session);
		this.sessionMeta.set(sessionId, {
			sessionId,
			runDirectory,
			language: input.language,
			dataClassification: input.dataClassification,
			status: session.status.status,
			executionCount: session.status.executionCount,
			capabilities: runner.capabilities,
			createdAt: new Date().toISOString(),
		});
		await this.persistSessions();
		return this.sessionProjection(sessionId) as DiscoveryKernelSession;
	}
	async executeKernel(
		sessionId: string,
		code: string,
	): Promise<Awaited<ReturnType<KernelSession["execute"]>>> {
		await this.init();
		const id = safeSessionId(sessionId);
		const session = this.sessions.get(id);
		if (!session) throw new Error("Discovery kernel session is not active; create a new session");
		await this.authorize({ kind: "execute-kernel", projectId: this.projectId, sessionId: id });
		const execution = await session.execute(code);
		const meta = this.sessionMeta.get(id);
		if (meta)
			this.sessionMeta.set(id, {
				...meta,
				status: session.status.status,
				executionCount: session.status.executionCount,
			});
		await this.persistSessions();
		return execution;
	}
	async exportKernel(sessionId: string) {
		await this.init();
		const id = safeSessionId(sessionId);
		const session = this.sessions.get(id);
		if (!session) throw new Error("Discovery kernel session is not active; create a new session");
		await this.authorize({ kind: "export-kernel", projectId: this.projectId, sessionId: id });
		return session.export();
	}
	async closeKernelSession(sessionId: string): Promise<void> {
		await this.init();
		const id = safeSessionId(sessionId);
		await this.authorize({ kind: "close-kernel-session", projectId: this.projectId, sessionId: id });
		const session = this.sessions.get(id);
		session?.close();
		const meta = this.sessionMeta.get(id);
		if (meta)
			this.sessionMeta.set(id, {
				...meta,
				status: session?.status.status ?? "closed",
				executionCount: session?.status.executionCount ?? meta.executionCount,
			});
		await this.persistSessions();
	}

	async createExplorationPlan(input: {
		readonly id: string;
		readonly hypothesisId: string;
		readonly prior: QuestionPrior;
		readonly budget: DiscoveryExplorationBudget;
		readonly candidates: readonly Parameters<typeof rankExplorationCandidates>[0][number][];
	}): Promise<DiscoveryExplorationPlan> {
		await this.init();
		const ledger = new ExplorationBudgetLedger(input.budget);
		void ledger;
		const ranked = rankExplorationCandidates(input.candidates);
		const plan: DiscoveryExplorationPlan = {
			id: input.id,
			projectId: this.projectId,
			hypothesisId: input.hypothesisId,
			prior: input.prior,
			budget: input.budget,
			rankedCandidateIds: ranked.map((candidate) => candidate.id),
			createdAt: new Date().toISOString(),
		};
		this.plans.push(plan);
		await this.plansStore.write(this.plans);
		return plan;
	}
	async listExplorationPlans(): Promise<readonly DiscoveryExplorationPlan[]> {
		await this.init();
		return [...this.plans];
	}
	async runCritic(request: CriticRequest): Promise<DiscoveryCriticReview> {
		await this.init();
		const result = await runCriticReview(request, this.options.criticProvider);
		const review: PersistedCritic = {
			findingId: request.findingId,
			...result,
			questions: result.questions.map((question) => ({
				...question,
				evidenceArtifactIds: [...question.evidenceArtifactIds],
			})),
			recordedAt: new Date().toISOString(),
		};
		this.critics.push(review);
		await this.criticsStore.write(this.critics);
		if (this.options.inquiry && result.questions.length)
			await recordCriticQuestions(this.options.inquiry, {
				projectId: this.projectId,
				findingId: request.findingId,
				questions: result.questions,
			});
		return review;
	}
	async listCriticReviews(): Promise<readonly DiscoveryCriticReview[]> {
		await this.init();
		return this.critics.map(({ recordedAt: _recordedAt, ...review }) => review);
	}
	async runMultipath(
		plan: MultipathPlan,
		executor: (path: MultipathPlan["paths"][number]) => Promise<MultipathPathExecutionResult>,
	): Promise<DiscoveryMultipathAssessment> {
		await this.init();
		await this.authorize({ kind: "multipath-execution", projectId: this.projectId, planId: plan.id });
		const assessment = await executeMultiPath(createMultiPathPlan(plan), executor, {
			projectId: this.projectId,
			inquiry: this.options.inquiry,
		});
		const record: PersistedMultipath = {
			planId: plan.id,
			findingId: plan.findingId,
			grade: assessment.grade,
			intent: assessment.label,
			attemptCount: assessment.attemptCount,
			consistentCount: assessment.consistentCount,
			consistency: assessment.consistency,
			recordedAt: new Date().toISOString(),
		};
		this.multipaths.push(record);
		await this.multipathStore.write(this.multipaths);
		return record;
	}
	async listMultipathAssessments(): Promise<readonly DiscoveryMultipathAssessment[]> {
		await this.init();
		return this.multipaths.map(({ recordedAt: _recordedAt, ...value }) => value);
	}
	async runEvaluation(
		cases: readonly DiscoveryEvaluationCase[],
		evaluator: (item: DiscoveryEvaluationCase) => Promise<DiscoveryEvaluationObservation>,
		options: { readonly runId?: string; readonly timeoutMs?: number } = {},
	): Promise<DiscoveryEvaluationRun> {
		await this.init();
		const runId = options.runId ?? `evaluation-${Date.now()}`;
		await this.authorize({ kind: "evaluation-execution", projectId: this.projectId, runId });
		const result = await runEvaluation(cases, evaluator, this.baselineStore, { ...options, runId });
		const projection: DiscoveryEvaluation = {
			runId: result.runId,
			status: result.status,
			startedAt: result.startedAt,
			finishedAt: result.finishedAt,
			missingData: [...result.missingData],
			blockedCases: [...result.blockedCases],
			metrics: result.metrics.map((metric) => ({
				metric: metric.metric,
				value: metric.value,
				...(metric.baseline === undefined ? {} : { baseline: metric.baseline }),
				...(metric.delta === undefined ? {} : { delta: metric.delta }),
				passed: metric.passed,
				baselineAvailable: metric.baselineAvailable,
				caseIds: [...metric.caseIds],
			})),
		};
		this.evaluations.push(projection);
		await this.evaluationsStore.write(this.evaluations);
		return result;
	}
	async listEvaluations(): Promise<readonly DiscoveryEvaluation[]> {
		await this.init();
		return [...this.evaluations];
	}
	async listBaselines(): Promise<readonly DiscoveryBaselineRecord[]> {
		await this.init();
		return this.baselineStore.list();
	}
	async putBaseline(record: DiscoveryBaselineRecord): Promise<void> {
		await this.init();
		await this.baselineStore.put(record);
	}
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const session of this.sessions.values()) session.close();
		this.sessions.clear();
	}
}

export { ContainerKernelRunner, detectContainerRuntime } from "./container-runner";
