import { describe, expect, it } from "vitest";
import { DESKTOP_SYSTEM_PROMPT, MCP_HONESTY_PROMPT } from "./system-prompt";

describe("desktop system prompt", () => {
	it("tells the model to be honest when MCP tools are unavailable and that mcp.json edits are not completion", () => {
		const text = MCP_HONESTY_PROMPT.join("\n");
		expect(text).toMatch(/如实告诉用户/);
		expect(text).toMatch(/mcp\.json/);
		expect(text).toMatch(/不能据此宣称任务完成/);
		for (const line of MCP_HONESTY_PROMPT) expect(DESKTOP_SYSTEM_PROMPT).toContain(line);
	});
});
