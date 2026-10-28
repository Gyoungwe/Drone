import { sanitizeProviderError } from "@drone/shared";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { RawMessage } from "../session/messages";

const metadata = [
	"api",
	"provider",
	"model",
	"responseModel",
	"responseId",
	"providerThinkingLevel",
	"thinkingLevel",
	"usage",
	"stopReason",
	"deferred",
	"rawStopReason",
	"endTurn",
	"timestamp",
	"durationMs",
] as const satisfies readonly (keyof AssistantMessage)[];

/** Public transport projection only; raw signed protocol remains in the actual SDK/owner context. */
export function neutralDeliveryMessage(message: RawMessage, starting = false): RawMessage {
	if (message.role !== "assistant") return message;
	const envelope = Object.fromEntries(
		metadata.filter((key) => Object.hasOwn(message, key)).map((key) => [key, Reflect.get(message, key)]),
	);
	const calls = Array.isArray(message.content)
		? message.content.filter((block) => block.type === "toolCall")
		: [];
	return {
		...envelope,
		role: "assistant",
		content: starting
			? []
			: calls.length
				? calls
				: [
						{
							type: "text",
							text: "This response could not be verified for delivery. Open the session again to restore its verified history.",
						},
					],
		...(message.stopReason === "error"
			? { errorMessage: sanitizeProviderError(message.errorMessage || "Model request failed") }
			: {}),
	};
}

export function projectDeliveryEvent<T extends { type: string }>(
	event: T,
	message: (value: RawMessage, starting: boolean) => RawMessage,
): T | null {
	if (event.type === "message_update") return null;
	const payload = event as T & { message?: RawMessage; messages?: RawMessage[] };
	if (payload.message?.role === "assistant")
		return { ...event, message: message(payload.message, event.type === "message_start") };
	if (payload.messages) return { ...event, messages: payload.messages.map((value) => message(value, false)) };
	return event;
}
