import { describe, expect, it } from "vitest";
import { detectCapabilities } from "../src/capabilities/runtime";
import { preferBundledMcpRuntime } from "../src/project/trust-loader";
import { heuristicCapabilities } from "../src/tools/manifest";

describe("browser-control requests route to the external (MCP) capability", () => {
	it.each([
		"用谷歌浏览器打开 B 站首页",
		"帮我在浏览器里登录后台并截图",
		"控制我已经打开的 Chrome 标签页",
		"open the page in my browser and take a screenshot",
		"use playwright to click the login button",
		"drive Edge with puppeteer",
		"网页操作：把表单填好",
	])("%s → external", (text) => {
		expect(detectCapabilities(text)).toContain("external");
	});

	it.each(["update the knowledge base", "handle the edge cases in the parser", "整理知识库里的证据"])(
		"%s does not trigger external",
		(text) => {
			expect(detectCapabilities(text)).not.toContain("external");
		},
	);

	it("declares the MCP proxy tool and its direct tools as external", () => {
		expect(heuristicCapabilities("mcp")).toEqual(["external"]);
		expect(heuristicCapabilities("mcp__playwright__browser_navigate")).toEqual(["external"]);
	});
});

describe("bundled MCP runtime wins over duplicate pi-mcp-adapter installs", () => {
	const ext = (path: string) => ({ path }) as never;
	it("drops other pi-mcp-adapter copies and keeps everything else", () => {
		const bundled = "/app/resources/pi-packages/node_modules/pi-mcp-adapter/index.ts";
		const base = {
			extensions: [
				ext("<inline:1>"),
				ext("/home/me/.pi/agent/npm/node_modules/pi-mcp-adapter/index.ts"),
				ext(bundled),
				ext("/app/resources/research-workbench/extensions/research-loop.mjs"),
			],
			errors: [],
			runtime: {},
		} as never;
		const result = preferBundledMcpRuntime(bundled)(base) as unknown as { extensions: { path: string }[] };
		expect(result.extensions.map((extension) => extension.path)).toEqual([
			"<inline:1>",
			bundled,
			"/app/resources/research-workbench/extensions/research-loop.mjs",
		]);
	});
});
