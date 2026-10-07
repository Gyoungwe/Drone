import { describe, expect, it } from "vitest";
import {
	DESKTOP_SYSTEM_PROMPT,
	desktopSystemPrompt,
	MCP_HONESTY_PROMPT,
	WINDOWS_SHELL_PROMPT,
} from "./system-prompt";

describe("desktop system prompt", () => {
	it("tells the model to be honest when MCP tools are unavailable and that mcp.json edits are not completion", () => {
		const text = MCP_HONESTY_PROMPT.join("\n");
		expect(text).toMatch(/如实告诉用户/);
		expect(text).toMatch(/mcp\.json/);
		expect(text).toMatch(/不能据此宣称任务完成/);
		for (const line of MCP_HONESTY_PROMPT) expect(DESKTOP_SYSTEM_PROMPT).toContain(line);
	});

	it("prefers the powershell tool on Windows only", () => {
		expect(desktopSystemPrompt("win32")).toEqual(expect.arrayContaining([...WINDOWS_SHELL_PROMPT]));
		expect(desktopSystemPrompt("win32").join("\n")).toMatch(/powershell/);
		expect(desktopSystemPrompt("linux").join("\n")).not.toMatch(/powershell/);
		expect(desktopSystemPrompt("darwin")).not.toEqual(expect.arrayContaining([...WINDOWS_SHELL_PROMPT]));
	});
});
