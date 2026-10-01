// Host adapter for the typed research receipt journal. Persistence, workspace
// binding and runtime ownership stay in the Pi host; bounded buffering and
// duplicate/run-scope policy live in @drone/research.
import { loadWorkspaceConfig } from "../extensions/workspace-config.mjs";
import {
	flushResearchReceipts,
	observeResearchReceipt,
	resetResearchReceipts,
	updateResearchLoop,
} from "./research-loop.mjs";
import { createResearchReceiptJournal as createTypedJournal } from "./research-receipt-core.mjs";
import { observeExecutionReceipt } from "./run-provenance.mjs";
import { runtimeSlot } from "./runtime-bridge.mjs";
import { toolMeta } from "./tool-manifest.mjs";

const runtimeState = runtimeSlot("research", "receiptJournal", () => ({
	owners: new Map(),
	dispose() {
		this.owners.clear();
	},
}));

export function createResearchReceiptJournal(cwd, { sessionId = null } = {}) {
	return createTypedJournal(cwd, {
		sessionId,
		ports: {
			workspace: loadWorkspaceConfig,
			status: async (workspace, runDir) => updateResearchLoop({ cwd: workspace, runDir, action: "status" }),
			flush: async (workspace, runDir) => flushResearchReceipts({ cwd: workspace, runDir }),
			reset: (workspace, runDir) => resetResearchReceipts({ cwd: workspace, runDir }),
			observeExecution: (event) => observeExecutionReceipt(event),
			observeResearch: (event) => observeResearchReceipt(event),
			isJournalTool: (name) => toolMeta(name)?.journal === true,
			owners: runtimeState.owners,
		},
	});
}
