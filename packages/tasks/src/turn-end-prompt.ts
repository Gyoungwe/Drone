import { MAX_AUTO_RESUMES } from "./consent";

export { MAX_AUTO_RESUMES } from "./consent";

export interface TaskContinuationState {
	executionConsent?: unknown;
	state?: string;
	milestones?: readonly { state?: string }[];
	actions?: readonly { state?: string }[];
	budget?: { autoResumes?: number };
	progressCount?: number;
	lastResumeProgress?: number;
}

/**
 * Decide whether the host should offer one continuation after a productive
 * authorized turn. This policy never grants consent and never runs work.
 */
export function shouldAskToContinue(task: TaskContinuationState | null | undefined): boolean {
	if (!task?.executionConsent) return false;
	if (["completed", "cancelled", "archived"].includes(task.state || "")) return false;
	const milestones = task.milestones || [];
	if (!milestones.length || !milestones.some((milestone) => milestone.state !== "completed")) return false;
	if ((task.actions || []).some((action) => action.state === "pending")) return false;
	if ((task.budget?.autoResumes || 0) >= MAX_AUTO_RESUMES) return false;
	return (task.progressCount || 0) > (task.lastResumeProgress || 0);
}
