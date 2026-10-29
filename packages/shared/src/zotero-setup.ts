/**
 * Host-neutral Zotero setup contract used by Desktop status adapters.
 *
 * The research plugin owns setup and write behavior; this small contract only
 * describes the stable MCP binding and reads an already-parsed Pi config.
 */

export const ZOTERO_SETUP_BINDING = Object.freeze({
	command: "zotero-setup",
	skill: "zotero-literature",
	mcpServer: "zotero",
	package: "zotero-mcp-server",
	docs: "https://github.com/54yyyu/zotero-mcp",
	download: "https://www.zotero.org/download",
	localApi: "http://127.0.0.1:23119/api",
	uvScript: "https://astral.sh/uv/install.sh",
});

export interface ZoteroMcpServerEntry {
	command: string | null;
	disabled: boolean;
	registered: boolean;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read the Zotero MCP registration from an already parsed Pi config object. */
export function readZoteroMcpConfig(value: unknown): ZoteroMcpServerEntry {
	if (!isRecord(value)) return { registered: false, disabled: true, command: null };
	const servers = value.mcpServers ?? value["mcp-servers"];
	if (!isRecord(servers)) return { registered: false, disabled: true, command: null };
	const raw = servers[ZOTERO_SETUP_BINDING.mcpServer];
	if (!isRecord(raw)) return { registered: false, disabled: true, command: null };
	return {
		registered: true,
		// `enabled: false` is the Pi field; legacy `disabled: true` is read as intent.
		disabled: raw.enabled === false || raw.disabled === true,
		command: typeof raw.command === "string" ? raw.command : null,
	};
}
