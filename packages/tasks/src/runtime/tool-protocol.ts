/** Repair only the known legacy host-status interleaving, in provider context.
 * Keep signed assistant/tool blocks and persisted history unchanged. Never invent,
 * drop or replay a result; incomplete/foreign batches are deliberately untouched.
 */
export function restoreTaskToolOrder(messages) {
	const output = [];
	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];
		output.push(message);
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		const calls = message.content.filter((b) => b.type === "toolCall");
		if (!calls.length) continue;
		const pending = new Set(calls.map((b) => b.id));
		if (pending.size !== calls.length || [...pending].some((id) => typeof id !== "string" || !id)) continue;
		const results = [],
			statuses = [];
		let j = i + 1;
		for (; j < messages.length && pending.size; j++) {
			const next = messages[j];
			if (next.role === "custom" && next.customType === "drone-task-status") statuses.push(next);
			else if (next.role === "toolResult" && pending.has(next.toolCallId)) {
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
