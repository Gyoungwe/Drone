import type { UIMessage } from "../transcript/types";
import type { ProcessEvent, ProcessRead } from "./types";

function object(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
function json(text: string): Record<string, unknown> | undefined {
	if (!text || text.length > 1_000_000) return;
	try {
		return object(JSON.parse(text));
	} catch {
		return;
	}
}
function source(value: unknown): ProcessRead | undefined {
	const s = object(value);
	return typeof s?.path === "string" &&
		typeof s.hash === "string" &&
		s.path.length <= 600 &&
		s.hash.length <= 128
		? { path: s.path, hash: s.hash }
		: undefined;
}
/** Public receipts only. Neither assistant prose nor thinking is interpreted as evidence. */
export function deriveProcessEvents(messages: readonly UIMessage[]): ProcessEvent[] {
	const events: ProcessEvent[] = [];
	const seen = new Map<string, number>();
	let seq = 0;
	const push = (event: ProcessEvent) => {
		const key = `${event.type}:${event.id}`;
		const index = seen.get(key);
		if (index !== undefined) events[index] = { ...event, seq: events[index]?.seq ?? event.seq };
		else {
			seen.set(key, events.length);
			events.push(event);
		}
	};
	for (const message of messages) {
		if (message.kind === "user") {
			push({ type: "user-input", id: message.id, seq: seq++, text: message.text });
			continue;
		}
		if (message.kind === "subagent") {
			for (const run of message.runs)
				push({ type: "subagent", id: run.key, seq: seq++, name: run.agent, state: run.status });
		}
		if (message.kind !== "assistant") continue;
		if (message.route) push({ type: "turn-route", id: message.id, seq: seq++, route: message.route });
		for (const tool of message.tools) {
			const id = tool.id || tool.key;
			const result = tool.state === "running" ? undefined : json(tool.output);
			const reason =
				typeof result?.code === "string"
					? result.code
					: tool.state === "error"
						? tool.output.match(
								/task-authorization-required|task-selection-required|reconcile-before-retry|stage-budget|total-budget|binding-changed|no-progress/,
							)?.[0]
						: undefined;
			push({
				type: "tool-receipt",
				id,
				seq: seq++,
				name: tool.name,
				state: tool.state,
				blockedReason:
					reason ??
					(tool.state === "error" && /No authorized task contract exists/.test(tool.output)
						? "task-authorization-required"
						: undefined),
				hits:
					tool.name === "research_search_knowledge" && Array.isArray(result?.hits) && result.hits.length > 0,
			});
			if (tool.state !== "done" || !result) continue;
			if (tool.name === "research_read_knowledge") {
				const read = source(result);
				if (read && !result.missing && typeof result.text === "string" && result.text.trim())
					push({ type: "knowledge-read", id, seq: seq++, read });
			}
			if (tool.name === "research_loop") {
				const gate = object(result.evidence_gate) ?? object(object(result.metadata)?.evidence_gate);
				if (typeof gate?.stage === "string")
					push({ type: "research-stage", id, seq: seq++, stage: gate.stage });
			}
			if (
				tool.name === "research_deposit_knowledge" &&
				(result.vaultWritten === true || typeof result.path === "string")
			) {
				const args = json(tool.args);
				push({
					type: "deposit",
					id,
					seq: seq++,
					kind: String(args?.type ?? result.type ?? "source"),
					path: typeof result.path === "string" ? result.path : undefined,
				});
			}
			if (tool.name === "research_propose_wiki_update" || tool.name === "research_zotero_save") {
				if (typeof result.status === "string")
					push({
						type: tool.name === "research_zotero_save" ? "zotero" : "wiki",
						id,
						seq: seq++,
						status: result.status,
					});
			}
			if (tool.name === "research_check_answer" && typeof result.ok === "boolean") {
				const proof = object(result.proof) ?? object(result.verified) ?? result;
				const sources = Array.isArray(proof.sources)
					? proof.sources.flatMap((value) => {
							const read = source(value);
							return read ? [read] : [];
						})
					: [];
				push({
					type: "answer-check",
					id,
					seq: seq++,
					ok: result.ok,
					sources,
					warning: result.status === "warning",
					reason: typeof result.code === "string" ? result.code : undefined,
				});
			}
		}
		if (message.taskView) push({ type: "task-view", id: message.id, seq: seq++, view: message.taskView });
	}
	return events;
}
