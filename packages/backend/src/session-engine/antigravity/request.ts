import { createHash, randomUUID } from "node:crypto";
import {
	collapseSystemMessages,
	getCurrentTools,
	getSystemMessageText,
	type Model,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { convertMessages, convertTools } from "@earendil-works/pi-ai/api/google-shared";
import { ANTIGRAVITY_MODEL_DEFINITIONS } from "./catalog";
import type { AntigravityEnvelope, AntigravityTransportOptions } from "./types";

export interface GeminiRequest {
	systemInstruction?: { role: "user"; parts: Array<{ text: string }> };
	contents: Array<Record<string, unknown>>;
	tools?: Array<Record<string, unknown>>;
	generationConfig?: Record<string, unknown>;
}

/** Convert Pi's transcript with the SDK's signature, image, and tool-result rules. */
export function buildGeminiRequest(
	context: TranscriptContext,
	model: Model<string>,
	options: AntigravityTransportOptions = {},
): GeminiRequest {
	// The converter only needs the Google wire shape. Keep the native API id so
	// same-model thought signatures survive transformMessages' replay check.
	const googleModel = model as Model<"google-generative-ai">;
	const contents = convertMessages(googleModel, context);
	const system = collapseSystemMessages(context).messages.find((message) => message.role === "system");
	const tools = convertTools(getCurrentTools(context.messages), model.id.startsWith("claude-"), true);
	return {
		...(system
			? { systemInstruction: { role: "user", parts: [{ text: getSystemMessageText(system) }] } }
			: {}),
		contents: contents as Array<Record<string, unknown>>,
		...(tools ? { tools: tools as Array<Record<string, unknown>> } : {}),
		generationConfig: {
			maxOutputTokens: options.maxTokens ?? model.maxTokens,
			...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
			...(model.reasoning ? { thinkingConfig: thinkingConfig(model, options.reasoning) } : {}),
		},
	};
}

export function buildEnvelope(
	request: GeminiRequest,
	model: Model<string>,
	project: string,
	options: { sessionId?: string; thinking?: string } = {},
): AntigravityEnvelope {
	const wireId = resolveWireModelId(model.id, options.thinking);
	const sessionId = deriveSessionId(request, options.sessionId);
	const trajectoryId = randomUUID();
	const stampedRequest: Record<string, unknown> = {
		...request,
		sessionId,
		labels: {
			last_step_index: "1",
			trajectory_id: trajectoryId,
			used_claude: String(wireId.toLowerCase().includes("claude")),
			used_claude_conservative: String(wireId.toLowerCase().includes("claude")),
		},
		...(wireId.toLowerCase().includes("claude") || request.tools
			? { toolConfig: { functionCallingConfig: { mode: "VALIDATED" } } }
			: {}),
	};
	return {
		project,
		requestId: `agent/${randomUUID()}/${Date.now()}/${trajectoryId}/2`,
		request: stampedRequest,
		model: wireId,
		userAgent: "antigravity",
		requestType: "agent",
	};
}

export function resolveWireModelId(modelId: string, thinking?: string): string {
	const definition = ANTIGRAVITY_MODEL_DEFINITIONS.find((entry) => entry.id === modelId);
	if (!definition) return modelId;
	const map = definition.wireThinkingLevelMap;
	if (thinking === "xhigh" || thinking === "max") thinking = "high";
	if (thinking && map && Object.hasOwn(map, thinking)) return map[thinking] ?? definition.wireId;
	return definition.wireId;
}

function thinkingConfig(model: Model<string>, level = "off"): Record<string, unknown> {
	const effectiveLevel = level === "xhigh" || level === "max" ? "high" : level;
	const budgets = model.samplingParams?.antigravityThinkingBudgets;
	if (budgets && typeof budgets === "object") {
		const budget = (budgets as Record<string, unknown>)[effectiveLevel];
		if (typeof budget === "number") return { includeThoughts: true, thinkingBudget: budget };
	}
	if (budgets) return { includeThoughts: false, thinkingBudget: 0 };
	const mapped =
		(model.thinkingLevelMap as Record<string, string | null> | undefined)?.[effectiveLevel] ?? effectiveLevel;
	return {
		includeThoughts: level !== "off",
		thinkingLevel: level === "off" ? "MINIMAL" : mapped.toUpperCase(),
	};
}

function deriveSessionId(request: GeminiRequest, sessionId?: string): string {
	const first = request.contents.find((item) => item.role === "user");
	const digest = createHash("sha256")
		.update(sessionId || JSON.stringify(first ?? request.contents[0] ?? ""))
		.digest();
	let value = 0n;
	for (const byte of digest.subarray(0, 8)) value = (value << 8n) | BigInt(byte);
	return `-${(value & 0x7fff_ffff_ffff_ffffn).toString()}`;
}
