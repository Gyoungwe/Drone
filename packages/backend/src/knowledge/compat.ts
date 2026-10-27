/**
 * Transitional composition root for the optional knowledge package.
 *
 * The service and IPC contracts in `ui.ts` stay host-neutral.  This module is
 * the only backend composition surface that reaches the packaged knowledge
 * implementation while the no-plugin compatibility path is still supported.
 */
import * as knowledgeHost from "@gyoungwe/pi-knowledge/host";

export {
	KNOWLEDGE_WORKER_LIFECYCLE_EVENT,
	type KnowledgeWorkerLifecycleEvent,
	type KnowledgeWorkerMetadata,
} from "@drone/shared";

export {
	configureKnowledgeHost,
	configureKnowledgeRuntime,
	configureKnowledgeWorker,
} from "@gyoungwe/pi-knowledge/host";

/**
 * The only legacy implementation surface consumed by the backend knowledge
 * service. Keeping these defaults here means `ui.ts` can depend on the
 * host-neutral contracts and the compatibility package can be deleted as one
 * composition-root change when the installed provider is mandatory.
 */
export const knowledgeCompatibility = {
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
} as const;
