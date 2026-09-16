import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import type { CapabilityRuntime } from "./runtime";

function messageText(message: unknown): string {
	if (!message || typeof message !== "object") return "";
	const candidate = message as { role?: unknown; content?: unknown };
	if (candidate.role !== "user" || !Array.isArray(candidate.content)) return "";
	return candidate.content
		.filter(
			(part): part is { type: "text"; text: string } =>
				!!part &&
				typeof part === "object" &&
				(part as { type?: unknown }).type === "text" &&
				typeof (part as { text?: unknown }).text === "string",
		)
		.map((part) => part.text)
		.join("\n");
}

/**
 * Session-local capability selector.
 *
 * `input` fires before /skill expansion, so an explicitly selected skill can become model-visible
 * before AgentSession reads it. `message_start` covers direct SDK steer/followUp calls that bypass
 * the input event; those are additive because they occur inside an already-running agent loop.
 */
export function makeCapabilityExtension(runtime: CapabilityRuntime): InlineExtension {
	return (pi) => {
		pi.on("input", (event) => {
			runtime.prepareForPrompt(event.text, event.streamingBehavior !== undefined);
			return { action: "continue" };
		});
		pi.on("message_start", (event) => {
			const text = messageText(event.message);
			if (text) runtime.prepareForPrompt(text, false);
		});
		pi.on("tool_call", (event) => {
			runtime.noteToolInvocation(event.toolName);
		});
	};
}
