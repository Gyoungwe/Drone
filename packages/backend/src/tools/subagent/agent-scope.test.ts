import { describe, expect, it } from "vitest";
import { mergeAgentScopes, parseAgentMarkdown, scopeSubagentMcpServers } from "./agents";

const md = (body: string) => `---\n${body}\n---\nprompt`;

describe("subagent scope (P19)", () => {
	it("parses model and dedicated MCP servers", () => {
		const a = parseAgentMarkdown(
			md("name: lit\nmodel: anthropic/claude-x\nmcpServers: [zotero, pubmed]"),
			"/p/.pi/agents/lit.md",
			"project",
		);
		expect(a?.model).toBe("anthropic/claude-x");
		expect(a?.mcpServers).toEqual(["zotero", "pubmed"]);
		expect(parseAgentMarkdown(md("name: plain"))?.mcpServers).toBeUndefined();
	});
	it("scopes MCP servers to the whitelist", () => {
		const available = ["zotero", "browser", "pubmed"];
		expect(scopeSubagentMcpServers({ mcpServers: ["zotero", "pubmed", "gone"] }, available)).toEqual([
			"zotero",
			"pubmed",
		]);
		expect(scopeSubagentMcpServers({}, available)).toEqual(available);
		expect(scopeSubagentMcpServers({ mcpAccess: "none", mcpServers: ["zotero"] }, available)).toEqual([]);
	});
	it("project agents override user agents; protected builtins stay", () => {
		const user = [{ name: "lit", description: "user", tools: [], systemPrompt: "", source: "user" as const }];
		const project = [
			{ name: "lit", description: "project", tools: [], systemPrompt: "", source: "project" as const },
		];
		const builtin = [
			{ name: "scout", description: "builtin", tools: [], systemPrompt: "", source: "builtin" as const },
		];
		const fake = [
			{ name: "scout", description: "hijack", tools: [], systemPrompt: "", source: "project" as const },
		];
		const merged = mergeAgentScopes([builtin, user, project, fake], new Set(["scout"]));
		expect(merged.find((a) => a.name === "lit")?.description).toBe("project");
		expect(merged.find((a) => a.name === "scout")?.description).toBe("builtin");
	});
});
