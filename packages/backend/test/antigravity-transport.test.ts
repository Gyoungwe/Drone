import { normalizeContext } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { staticAntigravityModels } from "../src/session-engine/antigravity/catalog";
import {
	buildEnvelope,
	buildGeminiRequest,
	resolveWireModelId,
	streamAntigravity,
} from "../src/session-engine/antigravity/transport";
import { antigravityPlatform } from "../src/session-engine/antigravity/types";

const context = normalizeContext({ messages: [{ role: "user", content: "hello", timestamp: Date.now() }] });

describe("Antigravity transport", () => {
	it("builds a Cloud Code Assist envelope with stable protocol markers", () => {
		const model = staticAntigravityModels()[0]!;
		const request = buildGeminiRequest(context, model, { reasoning: "high" });
		const envelope = buildEnvelope(request, model, "project-1", { thinking: "high" });
		expect(envelope.project).toBe("project-1");
		expect(envelope.userAgent).toBe("antigravity");
		expect(envelope.requestType).toBe("agent");
		expect(envelope.requestId).toMatch(/^agent\//);
		expect(envelope.request.sessionId).toMatch(/^-/);
		expect(resolveWireModelId("gemini-3.1-pro", "high")).toBe("gemini-pro-agent");
		expect(request.generationConfig?.thinkingConfig).toEqual({
			includeThoughts: true,
			thinkingBudget: 10_001,
		});
		const explicit = buildEnvelope(request, model, "project-1", {
			sessionId: "ui-session",
			thinking: "high",
		});
		expect(explicit.request.sessionId).toMatch(/^-/);
	});

	it("maps SSE text and usage into Pi events", async () => {
		const model = staticAntigravityModels()[0]!;
		const body = [
			'data: {"response":{"candidates":[{"content":{"parts":[{"text":"hello"}]}}]}}',
			'data: {"response":{"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2,"totalTokenCount":5}}}',
			"",
		].join("\n");
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200 }));
		const stream = streamAntigravity(model, context, {
			apiKey: "access",
			headers: { "x-drone-antigravity-project": "project-1" },
			fetch: fetcher,
		});
		const events = [];
		for await (const event of stream) events.push(event);
		const result = await stream.result();
		expect(events.some((event) => event.type === "text_delta" && event.delta === "hello")).toBe(true);
		expect(result.stopReason).toBe("stop");
		expect(result.usage.input).toBe(3);
		expect(fetcher).toHaveBeenCalledTimes(1);
		const sentHeaders = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
		expect(sentHeaders.get("User-Agent")).toBe("antigravity/hub/2.19.1 (aidev_client)");
		expect(JSON.parse(sentHeaders.get("Client-Metadata") ?? "null")).toEqual({
			ideType: 9,
			platform: antigravityPlatform(process.platform, process.arch),
			pluginType: 2,
		});
		const sent = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
		expect(sent.project).toBe("project-1");
		expect(JSON.stringify(sent)).not.toContain("access");
	});

	it("keeps thought signatures and merges parallel tool results through the Google converter", () => {
		const model = staticAntigravityModels()[0]!;
		const request = buildGeminiRequest(
			normalizeContext({
				systemPrompt: "system",
				tools: [{ name: "lookup", description: "look up", parameters: { type: "object", properties: {} } }],
				messages: [
					{ role: "user", content: "call lookup", timestamp: 1 },
					{
						role: "assistant",
						content: [
							{ type: "toolCall", id: "call_1", name: "lookup", arguments: {}, thoughtSignature: "c2ln" },
						],
						api: model.api,
						provider: model.provider,
						model: model.id,
						usage: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 0,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						},
						stopReason: "toolUse",
						timestamp: 2,
					},
					{
						role: "toolResult",
						toolCallId: "call_1",
						toolName: "lookup",
						content: [{ type: "text", text: "one" }],
						isError: false,
						timestamp: 3,
					},
					{
						role: "toolResult",
						toolCallId: "call_2",
						toolName: "lookup",
						content: [{ type: "text", text: "two" }],
						isError: false,
						timestamp: 4,
					},
				],
			}),
			model,
		);
		const modelContent = request.contents.find((content) => content.role === "model") as
			| { parts?: Array<Record<string, unknown>> }
			| undefined;
		const responseContent = request.contents.filter((content) => content.role === "user").at(-1) as {
			parts?: Array<Record<string, unknown>>;
		};
		expect(modelContent?.parts?.[0]?.functionCall).toMatchObject({ id: "call_1" });
		expect(modelContent?.parts?.[0]?.thoughtSignature).toBe("c2ln");
		expect(responseContent.parts).toHaveLength(2);
	});

	it("fails closed when an SSE stream ends without a finish reason", async () => {
		const model = staticAntigravityModels()[0]!;
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
			new Response('data: {"response":{"candidates":[{"content":{"parts":[{"text":"partial"}]}}]}}\n', {
				status: 200,
			}),
		);
		const result = await streamAntigravity(model, context, {
			apiKey: "access",
			headers: { "x-drone-antigravity-project": "project-1" },
			fetch: fetcher,
		}).result();
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("finish reason");
	});

	it("returns a safe reauthentication error on an expired bearer token", async () => {
		const model = staticAntigravityModels()[0]!;
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("expired", { status: 401 }));
		const stream = streamAntigravity(model, context, {
			apiKey: "stale-access",
			headers: {
				"x-drone-antigravity-project": "project-1",
			},
			fetch: fetcher,
		});
		const result = await stream.result();
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("sign in again");
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(fetcher.mock.calls[0]?.[1])).not.toContain("refresh-token");
	});

	it("falls back to the sandbox endpoint only for transient failures", async () => {
		const model = staticAntigravityModels()[0]!;
		const body =
			'data: {"response":{"candidates":[{"content":{"parts":[{"text":"sandbox"}]},"finishReason":"STOP"}]}}\n';
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response("busy", { status: 503 }))
			.mockResolvedValueOnce(new Response(body, { status: 200 }));
		const stream = streamAntigravity(model, context, {
			apiKey: "access",
			endpoints: ["https://primary.example", "https://sandbox.example"],
			headers: { "x-drone-antigravity-project": "project-1" },
			fetch: fetcher,
		});
		const result = await stream.result();
		expect(result.stopReason).toBe("stop");
		expect(result.content).toEqual([{ type: "text", text: "sandbox" }]);
		expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
			"https://primary.example/v1internal:streamGenerateContent?alt=sse",
			"https://sandbox.example/v1internal:streamGenerateContent?alt=sse",
		]);
	});
});
