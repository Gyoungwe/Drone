import { type HostEventTopic, isHostEventTopic } from "@drone/backend";

const INVALID_DECLARATION = "drone.hostEvents must be a non-empty list of distinct known host event topics";

export function parseHostEventsDeclaration(value: unknown): HostEventTopic[] {
	if (!Array.isArray(value) || value.length === 0) throw new Error(INVALID_DECLARATION);
	const topics: readonly unknown[] = value;
	const result: HostEventTopic[] = [];
	for (const topic of topics) {
		if (typeof topic !== "string") throw new Error(INVALID_DECLARATION);
		if (!isHostEventTopic(topic)) throw new Error(`${INVALID_DECLARATION}: ${topic}`);
		if (result.includes(topic)) throw new Error(INVALID_DECLARATION);
		result.push(topic);
	}
	return result.sort();
}
