import { afterEach, describe, expect, it, vi } from "vitest";
import { cloudflareToolResult, makeCloudflareAskExtension } from "../src/session-engine/cloudflare-ask";
import { buildSessionExtensionFactories } from "../src/session-engine/extensions";

const CHALLENGE = [{ type: "text" as const, text: "Just a moment... Checking your browser" }];
const previousLanguage = process.env.DRONE_REPLY_LANGUAGE;

afterEach(() => {
	if (previousLanguage === undefined) delete process.env.DRONE_REPLY_LANGUAGE;
	else process.env.DRONE_REPLY_LANGUAGE = previousLanguage;
});

describe("cloudflare tool results", () => {
	it("ignores tools that are not browser automation, including webfetch", async () => {
		const ask = vi.fn(async () => "continue" as const);
		expect(await cloudflareToolResult({ toolName: "webfetch", content: CHALLENGE }, ask)).toBeUndefined();
		expect(await cloudflareToolResult({ toolName: "bash", content: CHALLENGE }, ask)).toBeUndefined();
		expect(
			await cloudflareToolResult({ toolName: "web_search", content: "challenge-platform" }, ask),
		).toBeUndefined();
		expect(ask).not.toHaveBeenCalled();
	});

	it("leaves a browser result unchanged when it is not Cloudflare", async () => {
		const ask = vi.fn(async () => "continue" as const);
		expect(
			await cloudflareToolResult(
				{ toolName: "playwright_navigate", content: [{ type: "text", text: "Access denied" }] },
				ask,
			),
		).toBeUndefined();
		expect(
			await cloudflareToolResult(
				{ toolName: "browser_snapshot", content: [{ type: "text", text: "Please sign in" }] },
				ask,
			),
		).toBeUndefined();
		expect(ask).not.toHaveBeenCalled();
	});

	it("leaves the original result when there is no ask UI", async () => {
		expect(await cloudflareToolResult({ toolName: "browser_snapshot", content: CHALLENGE })).toBeUndefined();
	});

	it("tells the model to re-read the same page when the user continues", async () => {
		process.env.DRONE_REPLY_LANGUAGE = "zh";
		const result = await cloudflareToolResult(
			{ toolName: "mcp__playwright__browser_navigate", content: CHALLENGE },
			async () => "continue",
		);
		expect(result).toEqual({
			content: [{ type: "text", text: "请重新读取同一页面，不要绕过，刚才的挑战页不是证据" }],
		});
	});

	it("marks skip and a closed card as not evidence", async () => {
		process.env.DRONE_REPLY_LANGUAGE = "en";
		const skip = await cloudflareToolResult(
			{ toolName: "browser_snapshot", content: "challenge-platform" },
			async () => "skip",
		);
		expect(skip?.isError).toBe(true);
		expect(JSON.stringify(skip?.content)).toMatch(/not evidence/);
		expect(JSON.stringify(skip?.content)).toMatch(/Do not retry/);
		expect(JSON.stringify(skip?.content)).toMatch(/bypass/);
		const closed = await cloudflareToolResult(
			{ toolName: "browser_snapshot", content: "cf-chl-opt" },
			async () => undefined,
		);
		expect(closed?.isError).toBe(true);
		const thrown = await cloudflareToolResult({ toolName: "playwright", content: CHALLENGE }, async () => {
			throw new Error("dialog closed");
		});
		expect(thrown?.isError).toBe(true);
	});
});

describe("cloudflare ask extension", () => {
	it("is attached to a session and uses ctx.ui.select", async () => {
		const factories = buildSessionExtensionFactories(
			{
				runtime: {},
				traces: { recordCustom: () => undefined },
				webFetch: false,
				subagentPreferBuiltin: false,
				getModelRuntime: async () => ({}),
				getSubagentModel: async () => undefined,
				onEvent: () => undefined,
				setMcpStatus: () => undefined,
			} as never,
			"/tmp/drone",
			undefined,
		);
		const extension = factories.find((factory) => factory.name === "cloudflare-ask");
		expect(extension).toBeDefined();
		let handler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
		extension?.factory({
			on: (name: string, fn: (event: unknown, ctx: unknown) => Promise<unknown>) => {
				if (name === "tool_result") handler = fn;
			},
		} as never);
		process.env.DRONE_REPLY_LANGUAGE = "zh";
		const select = vi.fn(async () => "我已完成，继续");
		const replaced = await handler?.(
			{ toolName: "playwright", content: CHALLENGE },
			{ ui: { select }, signal: undefined },
		);
		expect(select).toHaveBeenCalledTimes(1);
		expect(String(select.mock.calls[0]?.[0]).startsWith("需要你完成浏览器验证\n\n")).toBe(true);
		expect(replaced).toEqual({
			content: [{ type: "text", text: "请重新读取同一页面，不要绕过，刚才的挑战页不是证据" }],
		});

		select.mockResolvedValueOnce(undefined);
		const skipped = await handler?.(
			{ toolName: "browser_snapshot", content: "Checking your browser" },
			{ ui: { select } },
		);
		expect(skipped).toMatchObject({ isError: true });
	});

	it("returns the original result when the session has no select UI", async () => {
		let handler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
		makeCloudflareAskExtension().factory({
			on: (name: string, fn: (event: unknown, ctx: unknown) => Promise<unknown>) => {
				if (name === "tool_result") handler = fn;
			},
		} as never);
		expect(await handler?.({ toolName: "playwright", content: CHALLENGE }, { ui: {} })).toBeUndefined();
	});
});
