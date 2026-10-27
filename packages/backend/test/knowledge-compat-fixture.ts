/**
 * Explicit legacy knowledge fixture for SDK/worker regression tests.
 *
 * Production backend code must discover an installed knowledge host or fail
 * closed. This fixture keeps the old package implementation available only to
 * tests that exercise the compatibility behavior during migration.
 */
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

export const defaultKnowledgeRuntimeSetup = {
	configureHost: knowledgeHost.configureKnowledgeHost,
	configureRuntime: knowledgeHost.configureKnowledgeRuntime,
	configureWorker: knowledgeHost.configureKnowledgeWorker,
};
