import type { SessionEvent } from "@percho/shared";
import type { RawMessage } from "./messages";

interface PublicationBridge {
	projectEvent?: (event: SessionEvent) => SessionEvent | null;
	projectSnapshot?: (messages: RawMessage[], persisted: RawMessage[]) => RawMessage[];
}
const key = Symbol.for("percho.knowledge.publication.v1");
function bridge(): PublicationBridge | undefined {
	return (globalThis as unknown as Record<symbol, PublicationBridge>)[key];
}
const notice = "【知识库检查未通过】发布检查未加载或发生错误，回答没有发布。请重新加载知识库扩展。";
function safe(message: RawMessage): RawMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: notice }],
		timestamp: message.timestamp,
		stopReason: message.stopReason,
		...(message.stopReason === "error" ? { errorMessage: notice } : {}),
	};
}
/** Shared delivery boundary: desktop, LAN and trace consumers all receive the same projected event. */
export function projectKnowledgeEvent(event: SessionEvent): SessionEvent | null {
	if (!process.env.PERCHO_KNOWLEDGE_DIR) return event;
	try {
		const fn = bridge()?.projectEvent;
		if (fn) return fn(event);
	} catch {
		/* Fail closed, never leak the draft. */
	}
	if (event.type === "message_update") return null;
	if (
		(event.type === "message_start" || event.type === "message_end" || event.type === "turn_end") &&
		event.message.role === "assistant"
	) {
		const replacement = safe(event.message as unknown as RawMessage);
		if (event.type === "message_start") replacement.content = [];
		if (event.type === "message_end") {
			const original = event.message as unknown as Record<string, unknown>;
			for (const name of Object.keys(original)) delete original[name];
			Object.assign(original, replacement); // Before SessionManager persists the final message.
		}
		return { ...event, message: replacement } as unknown as SessionEvent;
	}
	if (event.type === "agent_end")
		return {
			...event,
			messages: event.messages.map((m) => (m.role === "assistant" ? safe(m as unknown as RawMessage) : m)),
		} as unknown as SessionEvent;
	return event;
}
/** Live polling cannot reveal the assistant object while async validation is still pending. */
export function projectKnowledgeSnapshot(messages: RawMessage[], persisted: RawMessage[]): RawMessage[] {
	if (!process.env.PERCHO_KNOWLEDGE_DIR) return messages;
	try {
		const fn = bridge()?.projectSnapshot;
		if (fn) return fn(messages, persisted);
	} catch {
		/* fail closed */
	}
	return messages.map((m) => (m.role === "assistant" ? safe(m) : m));
}
