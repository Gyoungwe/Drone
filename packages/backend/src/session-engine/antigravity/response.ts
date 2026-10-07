import { randomUUID } from "node:crypto";
import type {
	AssistantMessage,
	AssistantMessageEventStream,
	JsonObject,
	ToolCall,
} from "@earendil-works/pi-ai";
import { AntigravityError } from "./types";

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
function count(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** One live Pi accumulator; terminal settlement waits for EOF (usage can arrive after STOP). */
export class AntigravityResponse {
	private activeIndex: number | undefined;
	private finished = false;
	constructor(
		readonly message: AssistantMessage,
		private readonly stream: AssistantMessageEventStream,
	) {}

	consume(outer: unknown): void {
		const envelope = record(outer);
		if (!envelope)
			throw new AntigravityError("Cloud Code Assist returned malformed stream data", { kind: "protocol" });
		const chunk = record(envelope.response) ?? envelope;
		if (envelope.error || chunk.error)
			throw new AntigravityError("Cloud Code Assist returned a stream error", { kind: "protocol" });
		const candidate = Array.isArray(chunk.candidates) ? record(chunk.candidates[0]) : undefined;
		const content = record(candidate?.content);
		if (Array.isArray(content?.parts)) {
			for (const rawPart of content.parts) {
				const part = record(rawPart);
				if (!part)
					throw new AntigravityError("Cloud Code Assist returned an invalid response part", {
						kind: "protocol",
					});
				const signature = typeof part.thoughtSignature === "string" ? part.thoughtSignature : undefined;
				if (typeof part.text === "string") this.text(part.text, part.thought === true, signature);
				const call = record(part.functionCall);
				if (call) this.tool(call, signature);
			}
		}
		if (typeof chunk.responseId === "string") this.message.responseId ??= chunk.responseId;
		const usage = record(chunk.usageMetadata);
		if (usage) {
			const prompt = count(usage.promptTokenCount);
			const cached = Math.min(prompt, count(usage.cachedContentTokenCount));
			const reasoning = count(usage.thoughtsTokenCount);
			const output = count(usage.candidatesTokenCount) + reasoning;
			Object.assign(this.message.usage, {
				input: prompt - cached,
				output,
				cacheRead: cached,
				reasoning,
				totalTokens:
					typeof usage.totalTokenCount === "number" ? count(usage.totalTokenCount) : prompt + output,
			});
		}
		if (typeof candidate?.finishReason === "string") {
			this.finished = true;
			this.message.rawStopReason = candidate.finishReason;
			if (candidate.finishReason === "MAX_TOKENS") this.message.stopReason = "length";
			else if (candidate.finishReason === "STOP") {
				this.message.stopReason = this.message.content.some((item) => item.type === "toolCall")
					? "toolUse"
					: "stop";
			} else
				throw new AntigravityError("Cloud Code Assist stopped generation without completing the response", {
					kind: "protocol",
				});
		}
		if (record(chunk.promptFeedback)?.blockReason)
			throw new AntigravityError("Cloud Code Assist blocked this request", { kind: "protocol" });
	}

	finish(): void {
		this.closeBlock();
		if (!this.finished)
			throw new AntigravityError("Cloud Code Assist stream ended before a finish reason", {
				kind: "protocol",
			});
		const reason = this.message.stopReason;
		if (reason !== "stop" && reason !== "length" && reason !== "toolUse")
			throw new AntigravityError("Cloud Code Assist returned an invalid finish reason", { kind: "protocol" });
		this.stream.push({ type: "done", reason, message: this.message });
	}

	private closeBlock(): void {
		if (this.activeIndex === undefined) return;
		const contentIndex = this.activeIndex;
		const block = this.message.content[contentIndex];
		if (block?.type === "text")
			this.stream.push({ type: "text_end", contentIndex, content: block.text, partial: this.message });
		else if (block?.type === "thinking")
			this.stream.push({
				type: "thinking_end",
				contentIndex,
				content: block.thinking,
				partial: this.message,
			});
		this.activeIndex = undefined;
	}

	private text(delta: string, thinking: boolean, signature?: string): void {
		let block = this.activeIndex === undefined ? undefined : this.message.content[this.activeIndex];
		if (!block || block.type !== (thinking ? "thinking" : "text")) {
			this.closeBlock();
			this.activeIndex = this.message.content.length;
			block = thinking ? { type: "thinking", thinking: "" } : { type: "text", text: "" };
			this.message.content.push(block);
			this.stream.push(
				thinking
					? { type: "thinking_start", contentIndex: this.activeIndex, partial: this.message }
					: { type: "text_start", contentIndex: this.activeIndex, partial: this.message },
			);
		}
		const contentIndex = this.activeIndex;
		if (contentIndex === undefined) return;
		if (block.type === "thinking") {
			block.thinking += delta;
			if (signature) block.thinkingSignature = signature;
			this.stream.push({ type: "thinking_delta", contentIndex, delta, partial: this.message });
		} else if (block.type === "text") {
			block.text += delta;
			if (signature) block.textSignature = signature;
			this.stream.push({ type: "text_delta", contentIndex, delta, partial: this.message });
		}
	}

	private tool(call: Record<string, unknown>, signature?: string): void {
		if (typeof call.name !== "string" || !call.name)
			throw new AntigravityError("Cloud Code Assist returned an unnamed tool call", { kind: "protocol" });
		this.closeBlock();
		const providedId = typeof call.id === "string" ? call.id : undefined;
		const id =
			providedId && !this.message.content.some((item) => item.type === "toolCall" && item.id === providedId)
				? providedId
				: `call-${randomUUID()}`;
		const toolCall: ToolCall = {
			type: "toolCall",
			id,
			name: call.name,
			arguments: (record(call.args) ?? {}) as JsonObject,
			...(signature ? { thoughtSignature: signature } : {}),
		};
		const contentIndex = this.message.content.length;
		this.message.content.push(toolCall);
		this.stream.push({ type: "toolcall_start", contentIndex, partial: this.message });
		this.stream.push({
			type: "toolcall_delta",
			contentIndex,
			delta: JSON.stringify(toolCall.arguments),
			partial: this.message,
		});
		this.stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: this.message });
	}
}
