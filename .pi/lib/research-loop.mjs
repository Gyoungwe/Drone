/** Compatibility host adapter; typed loop lives in @drone/research. */
import { loadWorkspaceConfig } from "../extensions/workspace-config.mjs";
import { createResearchLoop, RESEARCH_STAGES } from "./research-loop-core.mjs";
import { verifyLiteratureReceipt } from "./literature-receipt.mjs";
import { runtimeSlot } from "./runtime-bridge.mjs";
import { sourceStatus } from "./source-archive.mjs";
export { RESEARCH_STAGES };
const loop = runtimeSlot("research", "loop-v2", () => createResearchLoop({
 workspace: loadWorkspaceConfig,
 verifyLiteratureReceipt,
 sourceStatus,
}));
export const startResearchRun = (...args) => loop.startResearchRun(...args);
export const updateResearchLoop = (...args) => loop.updateResearchLoop(...args);
export const completeResearchGate = (...args) => loop.completeResearchGate(...args);
export const observeResearchReceipt = (...args) => loop.observeResearchReceipt(...args);
export const flushResearchReceipts = (...args) => loop.flushResearchReceipts(...args);
export const resetResearchReceipts = (...args) => loop.resetResearchReceipts(...args);
export const topicIdFromResultSlug = (...args) => loop.topicIdFromResultSlug(...args);
