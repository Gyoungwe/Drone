import { decodeTaskView, type TaskView } from "./task-workbench";
/** Explicit host custom-message presentation, never a general custom/draft passthrough. */
export function taskStatusDisplay(
	raw: unknown,
): { id: string; text: string; timestamp: number; taskView?: TaskView } | null {
	if (!raw || typeof raw !== "object") return null;
	const message = raw as {
		role?: unknown;
		customType?: unknown;
		display?: unknown;
		content?: unknown;
		timestamp?: unknown;
		details?: { reportId?: unknown; taskView?: unknown };
	};
	if (
		message.role !== "custom" ||
		message.customType !== "percho-task-status" ||
		message.display !== true ||
		typeof message.content !== "string" ||
		message.content.length > 16000 ||
		typeof message.details?.reportId !== "string" ||
		!/^[a-zA-Z0-9-]{1,100}$/.test(message.details.reportId)
	)
		return null;
	return {
		id: `task-status-${message.details.reportId}`,
		...(decodeTaskView(message.details.taskView)
			? { taskView: decodeTaskView(message.details.taskView) }
			: {}),
		text: message.content,
		timestamp: typeof message.timestamp === "number" ? message.timestamp : Date.now(),
	};
}
