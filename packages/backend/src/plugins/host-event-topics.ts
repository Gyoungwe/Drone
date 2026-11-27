export const HOST_EVENT_TOPICS = [
	"inquiry.compute",
	"inquiry.task-terminal",
	"inquiry.local-execution",
	"inquiry.decision",
] as const;

export type HostEventTopic = (typeof HOST_EVENT_TOPICS)[number];

export function isHostEventTopic(value: unknown): value is HostEventTopic {
	return typeof value === "string" && HOST_EVENT_TOPICS.some((topic) => topic === value);
}
