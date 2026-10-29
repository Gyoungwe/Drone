import { describe, expect, it } from "vitest";
import { readZoteroMcpConfig, ZOTERO_SETUP_BINDING } from "./zotero-setup";

describe("shared Zotero setup contract", () => {
	it("recognizes Pi mcpServers and legacy mcp-servers shapes", () => {
		expect(
			readZoteroMcpConfig({ mcpServers: { [ZOTERO_SETUP_BINDING.mcpServer]: { command: "/bin/zotero" } } }),
		).toEqual({
			registered: true,
			disabled: false,
			command: "/bin/zotero",
		});
		expect(
			readZoteroMcpConfig({ "mcp-servers": { zotero: { command: "zotero-mcp", enabled: false } } }),
		).toEqual({
			registered: true,
			disabled: true,
			command: "zotero-mcp",
		});
	});

	it("fails closed for missing or malformed registrations", () => {
		expect(readZoteroMcpConfig(undefined)).toEqual({ registered: false, disabled: true, command: null });
		expect(readZoteroMcpConfig({ mcpServers: { zotero: [] } })).toEqual({
			registered: false,
			disabled: true,
			command: null,
		});
	});
});
