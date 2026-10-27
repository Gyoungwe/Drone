/**
 * Explicit legacy knowledge fixture for SDK/worker regression tests.
 *
 * Production backend code must discover an installed knowledge host or fail
 * closed. This fixture keeps the old package implementation available only to
 * tests that exercise the compatibility behavior during migration.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type { KnowledgeWorkerMetadata } from "@drone/shared";
import * as knowledgeHost from "@gyoungwe/pi-knowledge/host";
import type { KnowledgeCompatibilityPort } from "../src/knowledge/ui";

export const defaultKnowledgeCompatibility = {
	read: {
		overview: knowledgeHost.knowledgeOverview,
		search: knowledgeHost.searchKnowledge,
		read: knowledgeHost.knowledgeReadNote,
		noteLinks: knowledgeHost.knowledgeNoteLinks,
		graph: knowledgeHost.knowledgeGraph,
	},
	maintenance: {
		plan: knowledgeHost.planMaintenance,
		run: knowledgeHost.runMaintenance,
	},
	dailyDiscovery: {
		systemPrompt: knowledgeHost.DAILY_DISCOVERY_SYSTEM,
		buildMessage: knowledgeHost.buildDailyDiscoveryMessage,
		parseIdeas: knowledgeHost.parseDailyIdeas,
	},
	researchResource: {
		resolveContext: knowledgeHost.resolveKnowledgeContext,
		ingestSnapshot: knowledgeHost.ingestKnowledgeSnapshot,
	},
	experience: knowledgeHost.recordTerminalJobExperience,
	publication: knowledgeHost.registerAnswerPublication,
	vault: {
		readBinding: knowledgeHost.readKnowledgeBinding,
		readNote: knowledgeHost.readNoteFile,
		containedFile: knowledgeHost.containedVaultFile,
		createFileOnly: knowledgeHost.createVaultFileOnly,
		replaceFile: knowledgeHost.replaceVaultFile,
		isConflict: (error: unknown) => error instanceof knowledgeHost.VaultFileConflictError,
	},
	uiState: {
		subscribe: knowledgeHost.subscribeKnowledgeUi,
		notify: knowledgeHost.notifyKnowledgeUi,
	},
	reviewWikiWithModel: knowledgeHost.reviewWikiWithModel,
	call(name: string, input: unknown): unknown {
		const fn = (knowledgeHost as unknown as Record<string, (value: unknown) => unknown>)[name];
		if (!fn) throw new Error(`Unknown knowledge UI operation: ${name}`);
		return fn(input);
	},
	backgroundReviewer: (options: unknown) =>
		new knowledgeHost.BackgroundReviewer(
			options as ConstructorParameters<typeof knowledgeHost.BackgroundReviewer>[0],
		),
} as unknown as KnowledgeCompatibilityPort;

type LegacyWorkerResource = {
	path: string;
	manifestPath: string;
	metadata: KnowledgeWorkerMetadata;
};

export function resolveLegacyKnowledgeWorkerResource(
	root = process.env.DRONE_RESEARCH_WORKBENCH_ROOT,
): LegacyWorkerResource {
	const workbenchRoot = root ?? fileURLToPath(new URL("../../../.pi", import.meta.url));
	const path = join(workbenchRoot, "extensions", "knowledge-worker.mjs");
	const manifestPath = join(workbenchRoot, "extensions", ".knowledge-worker-manifest.json");
	if (!existsSync(path)) throw new Error(`Knowledge worker resource is missing from the host: ${path}`);
	if (!existsSync(manifestPath))
		throw new Error(`Knowledge worker manifest is missing from the host: ${manifestPath}`);
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
	const expected = typeof manifest.outputSha256 === "string" ? manifest.outputSha256 : "";
	if (!/^[a-f0-9]{64}$/u.test(expected))
		throw new Error(`Knowledge worker manifest has no valid output hash: ${manifestPath}`);
	const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
	if (actual !== expected) throw new Error(`Knowledge worker resource hash mismatch: ${path}`);
	const version = `${typeof manifest.version === "number" || typeof manifest.version === "string" ? manifest.version : "1"}:${expected.slice(0, 16)}`;
	return { path, manifestPath, metadata: { version, source: path, integrity: expected } };
}

/** The observer lets lifecycle tests confirm the real worker has exited. */
export function configureBackendKnowledgeWorker(onWorker?: (worker: Worker) => void): void {
	knowledgeHost.configureKnowledgeHost({
		loadWorkspaceConfig: async (cwd) => {
			const root =
				process.env.DRONE_RESEARCH_WORKBENCH_ROOT ?? fileURLToPath(new URL("../../../.pi", import.meta.url));
			const mod = await import(
				/* @vite-ignore */ pathToFileURL(join(root, "extensions", "workspace-config.mjs")).href
			);
			return mod.loadWorkspaceConfig(cwd);
		},
	});
	knowledgeHost.configureKnowledgeRuntime({
		emitProcessEvent: (event, payload) => (process as any).emit(event, payload),
	});
	knowledgeHost.configureKnowledgeWorker(
		(_url, options) => {
			const resource = resolveLegacyKnowledgeWorkerResource();
			const workerData =
				options?.workerData && typeof options.workerData === "object" ? options.workerData : {};
			const worker = new Worker(pathToFileURL(resource.path), {
				...options,
				workerData: { ...workerData, workerResource: resource.metadata },
			} as any);
			onWorker?.(worker);
			return worker;
		},
		() => resolveLegacyKnowledgeWorkerResource().metadata,
	);
}
