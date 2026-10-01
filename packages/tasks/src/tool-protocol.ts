export interface TaskProtocolBlock {
	type?: unknown;
	id?: unknown;
	[key: string]: unknown;
}

export interface TaskProtocolMessage {
	role?: unknown;
	content?: readonly TaskProtocolBlock[];
	customType?: unknown;
	toolCallId?: unknown;
	[key: string]: unknown;
}

/**
 * Repair only the known legacy host-status interleaving in provider context.
 * Signed blocks and persisted history remain untouched; incomplete or foreign
 * batches are deliberately returned in their original order.
 */
export function restoreTaskToolOrder<T extends TaskProtocolMessage>(messages: readonly T[]): T[] {
	const output: T[] = [];
	for (let i = 0; i < messages.length; i++) {
		const message = messages.at(i);
		if (!message) continue;
		output.push(message);
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		const calls = message.content.filter((block) => block.type === "toolCall");
		if (!calls.length) continue;
		const ids = calls.map((block) => block.id);
		const pending = new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0));
		if (pending.size !== ids.length) continue;
		const results: T[] = [];
		const statuses: T[] = [];
		let j = i + 1;
		for (; j < messages.length && pending.size; j++) {
			const next = messages.at(j);
			if (!next) break;
			if (next.role === "custom" && next.customType === "drone-task-status") statuses.push(next);
			else if (
				next.role === "toolResult" &&
				typeof next.toolCallId === "string" &&
				pending.has(next.toolCallId)
			) {
				pending.delete(next.toolCallId);
				results.push(next);
			} else break;
		}
		if (!pending.size && statuses.length) {
			output.push(...results, ...statuses);
			i = j - 1;
		}
	}
	return output;
}
