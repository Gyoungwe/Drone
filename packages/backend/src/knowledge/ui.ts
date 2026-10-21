import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import * as knowledgeUiService from "@drone/knowledge/host";
import * as knowledgeUiState from "@drone/knowledge/host";
import * as knowledgeWikiModelReview from "@drone/knowledge/host";
import {
	configureKnowledgeRuntime,
	configureKnowledgeWorker,
	KNOWLEDGE_WORKER_LIFECYCLE_EVENT,
	type KnowledgeWorkerLifecycleEvent,
	type KnowledgeWorkerMetadata,
} from "@drone/knowledge/host";
import { getResearchRun, listResearchRuns } from "@drone/research/research-run-ui";
import type { KnowledgeApi, KnowledgeUiEvent } from "@drone/shared";
import { KnowledgeWebDavService } from "./webdav";

type Handler = (event: KnowledgeUiEvent) => void;

export interface KnowledgeWorkerLifecycleSnapshot {
	readonly currentVersion: string | null;
	readonly nextSessionVersion: string | null;
	readonly state: "unconfigured" | "staged" | "verified" | "enabled" | "disabled" | "rolled_back";
	readonly source?: string;
	readonly integrity?: string;
	readonly lastError?: string;
	readonly events: readonly KnowledgeWorkerLifecycleEvent[];
}

const workerLifecycle: {
	currentVersion: string | null;
	nextSessionVersion: string | null;
	state: KnowledgeWorkerLifecycleSnapshot["state"];
	source?: string;
	integrity?: string;
	lastError?: string;
	events: KnowledgeWorkerLifecycleEvent[];
} = {
	currentVersion: null,
	nextSessionVersion: null,
	state: "unconfigured",
	events: [],
};

process.on(KNOWLEDGE_WORKER_LIFECYCLE_EVENT, (value: unknown) => {
	if (!value || typeof value !== "object") return;
	const event = value as Partial<KnowledgeWorkerLifecycleEvent>;
	if (typeof event.stage !== "string" || typeof event.version !== "string" || typeof event.at !== "string")
		return;
	const bounded: KnowledgeWorkerLifecycleEvent = {
		stage: event.stage as KnowledgeWorkerLifecycleEvent["stage"],
		version: event.version.slice(0, 200),
		...(typeof event.previousVersion === "string"
			? { previousVersion: event.previousVersion.slice(0, 200) }
			: {}),
		...(typeof event.source === "string" ? { source: event.source.slice(0, 1000) } : {}),
		...(typeof event.integrity === "string" ? { integrity: event.integrity.slice(0, 200) } : {}),
		...(typeof event.reason === "string" ? { reason: event.reason.slice(0, 400) } : {}),
		...(typeof event.pendingRequests === "number" ? { pendingRequests: event.pendingRequests } : {}),
		at: event.at,
	};
	workerLifecycle.events = [...workerLifecycle.events, bounded].slice(-32);
	workerLifecycle.state =
		bounded.stage === "reloaded" ? "enabled" : bounded.stage === "drained" ? "disabled" : bounded.stage;
	if (
		bounded.stage === "staged" &&
		workerLifecycle.currentVersion &&
		bounded.version !== workerLifecycle.currentVersion
	)
		workerLifecycle.nextSessionVersion = bounded.version;
	if (["enabled", "reloaded", "verified"].includes(bounded.stage)) {
		workerLifecycle.currentVersion = bounded.version;
		workerLifecycle.nextSessionVersion = null;
	}
	if (bounded.stage === "rolled_back") {
		workerLifecycle.lastError = bounded.reason;
		workerLifecycle.nextSessionVersion = null;
	}
	if (bounded.source) workerLifecycle.source = bounded.source;
	if (bounded.integrity) workerLifecycle.integrity = bounded.integrity;
});

export function getKnowledgeWorkerLifecycle(): KnowledgeWorkerLifecycleSnapshot {
	return {
		currentVersion: workerLifecycle.currentVersion,
		nextSessionVersion: workerLifecycle.nextSessionVersion,
		state: workerLifecycle.state,
		...(workerLifecycle.source ? { source: workerLifecycle.source } : {}),
		...(workerLifecycle.integrity ? { integrity: workerLifecycle.integrity } : {}),
		...(workerLifecycle.lastError ? { lastError: workerLifecycle.lastError } : {}),
		events: workerLifecycle.events.map((event) => ({ ...event })),
	};
}

/**
 * Backend UI calls can construct KnowledgeService before a Pi extension is
 * loaded. Install the same generated worker seam used by the extension entry
 * so review and graph IPC work in both development and packaged hosts.
 */
export function configureBackendKnowledgeWorker(): void {
	configureKnowledgeRuntime({ emitProcessEvent: (event, payload) => (process as any).emit(event, payload) });
	configureKnowledgeWorker(
		(_url, options) => {
			const resource = resolveBackendKnowledgeWorkerResource();
			const workerData =
				options && typeof options === "object" && options.workerData && typeof options.workerData === "object"
					? options.workerData
					: {};
			return new Worker(pathToFileURL(resource.path), {
				...options,
				workerData: { ...workerData, workerResource: resource.metadata },
			} as any);
		},
		() => resolveBackendKnowledgeWorkerResource().metadata,
	);
}

export function resolveBackendKnowledgeWorkerPath(root = process.env.DRONE_RESEARCH_WORKBENCH_ROOT): string {
	const workbenchRoot = root ?? fileURLToPath(new URL("../../../../.pi", import.meta.url));
	const workerPath = join(workbenchRoot, "extensions", "knowledge-worker.mjs");
	if (!existsSync(workerPath))
		throw new Error(`Knowledge worker resource is missing from the host: ${workerPath}`);
	return workerPath;
}

export interface BackendKnowledgeWorkerResource {
	readonly path: string;
	readonly manifestPath: string;
	readonly metadata: KnowledgeWorkerMetadata;
}

/**
 * Resolve and verify the generated worker and its checked-in build manifest.
 * A file that merely exists is insufficient: packaged resources can be stale
 * or partially copied, so the host refuses to start a worker whose bytes do
 * not match the manifest hash.
 */
export function resolveBackendKnowledgeWorkerResource(
	root = process.env.DRONE_RESEARCH_WORKBENCH_ROOT,
): BackendKnowledgeWorkerResource {
	const workbenchRoot = root ?? fileURLToPath(new URL("../../../../.pi", import.meta.url));
	const path = join(workbenchRoot, "extensions", "knowledge-worker.mjs");
	const manifestPath = join(workbenchRoot, "extensions", ".knowledge-worker-manifest.json");
	if (!existsSync(path)) throw new Error(`Knowledge worker resource is missing from the host: ${path}`);
	if (!existsSync(manifestPath))
		throw new Error(`Knowledge worker manifest is missing from the host: ${manifestPath}`);
	let manifest: Record<string, unknown>;
	try {
		manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
	} catch (error) {
		throw new Error(`Knowledge worker manifest is invalid: ${manifestPath}`, { cause: error });
	}
	const expected = typeof manifest.outputSha256 === "string" ? manifest.outputSha256 : "";
	if (!/^[a-f0-9]{64}$/u.test(expected))
		throw new Error(`Knowledge worker manifest has no valid output hash: ${manifestPath}`);
	const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
	if (actual !== expected) throw new Error(`Knowledge worker resource hash mismatch: ${path}`);
	const version = `${typeof manifest.version === "number" || typeof manifest.version === "string" ? manifest.version : "1"}:${expected.slice(0, 16)}`;
	return {
		path,
		manifestPath,
		metadata: { version, source: path, integrity: expected },
	};
}

// Session/UI services are imported before the host loads its extension list.
// Configure lazily through the path above; the environment root is resolved
// when the first worker is created, after Electron has selected dev/packaged
// resources.
configureBackendKnowledgeWorker();

/** Host-facing knowledge management boundary; keeps IPC adapters independent of implementation state. */
export interface KnowledgeUiServicePort {
	connect(): Promise<void>;
	subscribe(listener: Handler): () => void;
	notify(text: string, severity?: string, sessionId?: string | null): Promise<void>;
	specialistSettings(
		input: Parameters<KnowledgeApi["setKnowledgeSpecialistSettings"]>[0],
	): ReturnType<KnowledgeApi["setKnowledgeSpecialistSettings"]>;
	reviewWithModel(
		input: Parameters<KnowledgeApi["reviewKnowledgeWithModel"]>[0],
		options: unknown,
	): ReturnType<KnowledgeApi["reviewKnowledgeWithModel"]>;
	overview(
		input: Parameters<KnowledgeApi["getKnowledgeOverview"]>[0],
	): ReturnType<KnowledgeApi["getKnowledgeOverview"]>;
	researchRuns(
		input: Parameters<KnowledgeApi["getResearchRuns"]>[0],
	): ReturnType<KnowledgeApi["getResearchRuns"]>;
	researchRun(
		input: Parameters<KnowledgeApi["getResearchRun"]>[0],
	): ReturnType<KnowledgeApi["getResearchRun"]>;
	setupPreview(
		input: Parameters<KnowledgeApi["previewKnowledgeSetup"]>[0],
	): ReturnType<KnowledgeApi["previewKnowledgeSetup"]>;
	jobs(input: Parameters<KnowledgeApi["getKnowledgeJobs"]>[0]): ReturnType<KnowledgeApi["getKnowledgeJobs"]>;
	reviews(
		input: Parameters<KnowledgeApi["getKnowledgeReviews"]>[0],
	): ReturnType<KnowledgeApi["getKnowledgeReviews"]>;
	preview(
		input: Parameters<KnowledgeApi["previewKnowledgeReview"]>[0],
	): ReturnType<KnowledgeApi["previewKnowledgeReview"]>;
	decide(
		input: Parameters<KnowledgeApi["decideKnowledgeReview"]>[0],
	): ReturnType<KnowledgeApi["decideKnowledgeReview"]>;
	read(
		input: Parameters<KnowledgeApi["readKnowledgeNote"]>[0],
	): ReturnType<KnowledgeApi["readKnowledgeNote"]>;
	maintain(
		input: Parameters<KnowledgeApi["maintainKnowledge"]>[0],
	): ReturnType<KnowledgeApi["maintainKnowledge"]>;
	openTarget(
		input: Parameters<KnowledgeApi["openKnowledgeTarget"]>[0],
	): Promise<{ path: string; kind: "note" | "vault" }>;
	semanticStatus(
		input: Parameters<KnowledgeApi["getKnowledgeSemanticStatus"]>[0],
	): ReturnType<KnowledgeApi["getKnowledgeSemanticStatus"]>;
	saveSemanticSettings(
		input: Parameters<KnowledgeApi["saveKnowledgeSemanticSettings"]>[0],
	): ReturnType<KnowledgeApi["saveKnowledgeSemanticSettings"]>;
	testSemanticProvider(
		input: Parameters<KnowledgeApi["testKnowledgeSemanticProvider"]>[0],
	): ReturnType<KnowledgeApi["testKnowledgeSemanticProvider"]>;
	indexSemantic(
		input: Parameters<KnowledgeApi["indexKnowledgeSemantic"]>[0],
	): ReturnType<KnowledgeApi["indexKnowledgeSemantic"]>;
	cancelSemanticIndex(
		input: Parameters<KnowledgeApi["cancelKnowledgeSemanticIndex"]>[0],
	): ReturnType<KnowledgeApi["cancelKnowledgeSemanticIndex"]>;
	search(input: Parameters<KnowledgeApi["searchKnowledge"]>[0]): ReturnType<KnowledgeApi["searchKnowledge"]>;
	noteLinks(
		input: Parameters<KnowledgeApi["getKnowledgeNoteLinks"]>[0],
	): ReturnType<KnowledgeApi["getKnowledgeNoteLinks"]>;
	graph(
		input: Parameters<KnowledgeApi["getKnowledgeGraph"]>[0],
	): ReturnType<KnowledgeApi["getKnowledgeGraph"]>;
	dailyContext(sinceMs: number): Promise<import("../services/daily-discovery").DailyDiscoveryContext>;
	saveIdea(idea: import("@drone/knowledge/host").DailyIdea): Promise<{ path: string }>;
	/** 记忆注入用的相关知识条目（复用知识库索引与语义向量）。 */
	relatedForMemory(
		cwd: string,
		query: string,
		limit?: number,
	): Promise<Array<{ path: string; title: string; text: string }>>;
	/** 观察记忆沉淀为本项目知识库「记忆」笔记。 */
	saveMemory(cwd: string, memory: import("@drone/knowledge/host").MemoryNoteInput): Promise<{ path: string }>;
	topics(
		input: Parameters<KnowledgeApi["getKnowledgeTopics"]>[0],
	): ReturnType<KnowledgeApi["getKnowledgeTopics"]>;
	archiveTopic(
		input: Parameters<KnowledgeApi["archiveKnowledgeTopic"]>[0],
	): ReturnType<KnowledgeApi["archiveKnowledgeTopic"]>;
	getCloudStatus(): ReturnType<KnowledgeApi["getKnowledgeCloudStatus"]>;
	probeCloud(): ReturnType<KnowledgeApi["probeKnowledgeCloud"]>;
	initializeCloud(): ReturnType<KnowledgeApi["initializeKnowledgeCloud"]>;
	setCloudPassword(
		input: Parameters<KnowledgeApi["setKnowledgeCloudPassword"]>[0],
	): ReturnType<KnowledgeApi["setKnowledgeCloudPassword"]>;
	readCloudNote(
		input: Parameters<KnowledgeApi["readKnowledgeCloudNote"]>[0],
	): ReturnType<KnowledgeApi["readKnowledgeCloudNote"]>;
	writeCloudNote(
		input: Parameters<KnowledgeApi["writeKnowledgeCloudNote"]>[0],
	): ReturnType<KnowledgeApi["writeKnowledgeCloudNote"]>;
	syncCloud(
		input: Parameters<KnowledgeApi["syncKnowledgeCloud"]>[0],
	): ReturnType<KnowledgeApi["syncKnowledgeCloud"]>;
	dispose(): void;
}
/** Dynamic resource boundary works in source and electron-builder layouts. */
export class KnowledgeUiService implements KnowledgeUiServicePort {
	private listeners = new Set<Handler>();
	private unsubscribe: (() => void) | null = null;
	private disposed = false;
	private loading: Promise<void> | null = null;
	private readonly cloud = new KnowledgeWebDavService();
	private root() {
		return (
			process.env.DRONE_RESEARCH_WORKBENCH_ROOT ?? fileURLToPath(new URL("../../../../.pi", import.meta.url))
		);
	}
	private async workspaceConfig(cwd: string) {
		const mod = await import(
			/* @vite-ignore */ pathToFileURL(join(this.root(), "extensions", "workspace-config.mjs")).href
		);
		return mod.loadWorkspaceConfig(cwd);
	}
	async connect(): Promise<void> {
		if (!process.env.DRONE_KNOWLEDGE_DIR || this.unsubscribe || this.disposed) return;
		if (!this.loading)
			this.loading = Promise.resolve()
				.then(() => {
					if (!this.disposed)
						this.unsubscribe = knowledgeUiState.subscribeKnowledgeUi((event: KnowledgeUiEvent) => {
							for (const listener of this.listeners) {
								try {
									listener(event);
								} catch {
									/* closed renderer */
								}
							}
						});
				})
				.finally(() => {
					this.loading = null;
				});
		return this.loading;
	}
	subscribe(listener: Handler): () => void {
		this.listeners.add(listener);
		void this.connect().catch(() => {});
		return () => this.listeners.delete(listener);
	}
	async notify(text: string, severity = "info", sessionId: string | null = null): Promise<void> {
		await this.connect();
		knowledgeUiState.notifyKnowledgeUi(text, severity, sessionId ?? undefined);
	}
	private async call(name: string, input: unknown): Promise<any> {
		await this.connect();
		const fn = (knowledgeUiService as unknown as Record<string, (value: unknown) => unknown>)[name];
		if (!fn) throw new Error(`Unknown knowledge UI operation: ${name}`);
		return fn(input);
	}
	specialistSettings(
		input: Parameters<KnowledgeApi["setKnowledgeSpecialistSettings"]>[0],
	): ReturnType<KnowledgeApi["setKnowledgeSpecialistSettings"]> {
		return this.call("knowledgeSpecialistSettings", input);
	}
	async reviewWithModel(
		input: Parameters<KnowledgeApi["reviewKnowledgeWithModel"]>[0],
		options: unknown,
	): ReturnType<KnowledgeApi["reviewKnowledgeWithModel"]> {
		return (await knowledgeWikiModelReview.reviewWikiWithModel(
			input,
			options as Parameters<typeof knowledgeWikiModelReview.reviewWikiWithModel>[1],
		)) as Awaited<ReturnType<KnowledgeApi["reviewKnowledgeWithModel"]>>;
	}
	overview(
		input: Parameters<KnowledgeApi["getKnowledgeOverview"]>[0],
	): ReturnType<KnowledgeApi["getKnowledgeOverview"]> {
		return this.call("knowledgeOverview", input);
	}
	async researchRuns(
		input: Parameters<KnowledgeApi["getResearchRuns"]>[0] = {},
	): ReturnType<KnowledgeApi["getResearchRuns"]> {
		const cwd = input?.cwd || process.cwd();
		const config = await this.workspaceConfig(cwd);
		return listResearchRuns({ ...input, resultsRoot: config.resultsRoot });
	}
	async researchRun(
		input: Parameters<KnowledgeApi["getResearchRun"]>[0],
	): ReturnType<KnowledgeApi["getResearchRun"]> {
		const cwd = input?.cwd || process.cwd();
		const config = await this.workspaceConfig(cwd);
		return getResearchRun({ ...input, resultsRoot: config.resultsRoot, vaultRoot: config.obsidianVault });
	}
	setupPreview(
		input: Parameters<KnowledgeApi["previewKnowledgeSetup"]>[0],
	): ReturnType<KnowledgeApi["previewKnowledgeSetup"]> {
		return this.call("knowledgeSetupPreview", input);
	}
	jobs(input: Parameters<KnowledgeApi["getKnowledgeJobs"]>[0]): ReturnType<KnowledgeApi["getKnowledgeJobs"]> {
		return this.call("knowledgeJobs", input);
	}
	reviews(
		input: Parameters<KnowledgeApi["getKnowledgeReviews"]>[0],
	): ReturnType<KnowledgeApi["getKnowledgeReviews"]> {
		return this.call("knowledgeReviews", input);
	}
	preview(
		input: Parameters<KnowledgeApi["previewKnowledgeReview"]>[0],
	): ReturnType<KnowledgeApi["previewKnowledgeReview"]> {
		return this.call("knowledgePreviewReview", input);
	}
	decide(
		input: Parameters<KnowledgeApi["decideKnowledgeReview"]>[0],
	): ReturnType<KnowledgeApi["decideKnowledgeReview"]> {
		return this.call("knowledgeDecideReview", input);
	}
	read(
		input: Parameters<KnowledgeApi["readKnowledgeNote"]>[0],
	): ReturnType<KnowledgeApi["readKnowledgeNote"]> {
		return this.call("knowledgeReadNote", input);
	}
	maintain(
		input: Parameters<KnowledgeApi["maintainKnowledge"]>[0],
	): ReturnType<KnowledgeApi["maintainKnowledge"]> {
		return this.call("knowledgeMaintenance", input);
	}
	openTarget(
		input: Parameters<KnowledgeApi["openKnowledgeTarget"]>[0],
	): Promise<{ path: string; kind: "note" | "vault" }> {
		return this.call("knowledgeOpenTarget", input);
	}
	semanticStatus(
		input: Parameters<KnowledgeApi["getKnowledgeSemanticStatus"]>[0],
	): ReturnType<KnowledgeApi["getKnowledgeSemanticStatus"]> {
		return this.call("knowledgeSemanticStatus", input);
	}
	saveSemanticSettings(
		input: Parameters<KnowledgeApi["saveKnowledgeSemanticSettings"]>[0],
	): ReturnType<KnowledgeApi["saveKnowledgeSemanticSettings"]> {
		return this.call("saveKnowledgeSemanticSettings", input);
	}
	testSemanticProvider(
		input: Parameters<KnowledgeApi["testKnowledgeSemanticProvider"]>[0],
	): ReturnType<KnowledgeApi["testKnowledgeSemanticProvider"]> {
		return this.call("testKnowledgeSemanticProvider", input);
	}
	indexSemantic(
		input: Parameters<KnowledgeApi["indexKnowledgeSemantic"]>[0],
	): ReturnType<KnowledgeApi["indexKnowledgeSemantic"]> {
		return this.call("indexKnowledgeSemantic", input);
	}
	cancelSemanticIndex(
		input: Parameters<KnowledgeApi["cancelKnowledgeSemanticIndex"]>[0],
	): ReturnType<KnowledgeApi["cancelKnowledgeSemanticIndex"]> {
		return this.call("cancelKnowledgeSemanticIndex", input);
	}
	search(input: Parameters<KnowledgeApi["searchKnowledge"]>[0]): ReturnType<KnowledgeApi["searchKnowledge"]> {
		return this.call("searchKnowledge", input);
	}
	noteLinks(
		input: Parameters<KnowledgeApi["getKnowledgeNoteLinks"]>[0],
	): ReturnType<KnowledgeApi["getKnowledgeNoteLinks"]> {
		return this.call("knowledgeNoteLinks", input);
	}
	graph(
		input: Parameters<KnowledgeApi["getKnowledgeGraph"]>[0],
	): ReturnType<KnowledgeApi["getKnowledgeGraph"]> {
		return this.call("knowledgeGraph", input);
	}
	dailyContext(sinceMs: number): Promise<import("../services/daily-discovery").DailyDiscoveryContext> {
		return this.call("dailyDiscoveryContext", { sinceMs });
	}
	saveIdea(idea: import("@drone/knowledge/host").DailyIdea): Promise<{ path: string }> {
		return this.call("saveDiscoveryIdea", { idea });
	}
	relatedForMemory(
		cwd: string,
		query: string,
		limit = 4,
	): Promise<Array<{ path: string; title: string; text: string }>> {
		return this.call("memoryRelatedKnowledge", { cwd, query, limit });
	}
	saveMemory(
		cwd: string,
		memory: import("@drone/knowledge/host").MemoryNoteInput,
	): Promise<{ path: string }> {
		return this.call("saveMemoryNote", { cwd, memory });
	}
	topics(
		input: Parameters<KnowledgeApi["getKnowledgeTopics"]>[0],
	): ReturnType<KnowledgeApi["getKnowledgeTopics"]> {
		return this.call("getKnowledgeTopics", input);
	}
	archiveTopic(
		input: Parameters<KnowledgeApi["archiveKnowledgeTopic"]>[0],
	): ReturnType<KnowledgeApi["archiveKnowledgeTopic"]> {
		return this.call("archiveKnowledgeTopic", input);
	}
	getCloudStatus(): ReturnType<KnowledgeApi["getKnowledgeCloudStatus"]> {
		return this.cloud.getStatus();
	}
	probeCloud(): ReturnType<KnowledgeApi["probeKnowledgeCloud"]> {
		return this.cloud.probe();
	}
	initializeCloud(): ReturnType<KnowledgeApi["initializeKnowledgeCloud"]> {
		return this.cloud.initialize();
	}
	setCloudPassword(
		input: Parameters<KnowledgeApi["setKnowledgeCloudPassword"]>[0],
	): ReturnType<KnowledgeApi["setKnowledgeCloudPassword"]> {
		return this.cloud.setPassword(input.password);
	}
	readCloudNote(
		input: Parameters<KnowledgeApi["readKnowledgeCloudNote"]>[0],
	): ReturnType<KnowledgeApi["readKnowledgeCloudNote"]> {
		return this.cloud.read(input.path);
	}
	writeCloudNote(
		input: Parameters<KnowledgeApi["writeKnowledgeCloudNote"]>[0],
	): ReturnType<KnowledgeApi["writeKnowledgeCloudNote"]> {
		return this.cloud.write(input);
	}
	syncCloud(
		input: Parameters<KnowledgeApi["syncKnowledgeCloud"]>[0],
	): ReturnType<KnowledgeApi["syncKnowledgeCloud"]> {
		return this.cloud.sync(input);
	}
	dispose(): void {
		this.disposed = true;
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.listeners.clear();
	}
}
