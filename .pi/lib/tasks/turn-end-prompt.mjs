// @ts-nocheck
/** Compatibility artifact generated from packages/tasks/src/runtime/turn-end-prompt.ts; packaged resources share the .pi runtime bridge. */
import { MAX_AUTO_RESUMES } from "./consent.mjs";
function shouldAskToContinue(task) {
  if (!task?.executionConsent) return false;
  if (["completed", "cancelled", "archived"].includes(task.state)) return false;
  const milestones = task.milestones || [];
  if (!milestones.length) return false;
  if (!milestones.some((m) => m.state !== "completed")) return false;
  if ((task.actions || []).some((a) => a.state === "pending")) return false;
  if ((task.budget?.autoResumes || 0) >= MAX_AUTO_RESUMES) return false;
  return (task.progressCount || 0) > (task.lastResumeProgress || 0);
}
export {
  shouldAskToContinue
};
