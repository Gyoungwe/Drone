/**
 * Host-independent Zotero setup policy.
 *
 * This module deliberately contains no filesystem, process, network or
 * credential access.  The CLI/desktop adapter owns those effects and calls
 * these functions only to validate and shape configuration values.
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

/** Read one Zotero MCP registration from an already parsed config object. */
export function readZoteroMcpConfig(value: unknown): ZoteroMcpServerEntry {
	if (!isRecord(value)) return { registered: false, disabled: true, command: null };
	const servers = value.mcpServers ?? value["mcp-servers"];
	if (!isRecord(servers)) return { registered: false, disabled: true, command: null };
	const raw = servers[ZOTERO_SETUP_BINDING.mcpServer];
	if (!isRecord(raw)) return { registered: false, disabled: true, command: null };
	return {
		registered: true,
		disabled: raw.disabled === true,
		command: typeof raw.command === "string" ? raw.command : null,
	};
}

/** Build the optional MCP registration without reading or creating credentials. */
export function zoteroMcpSpec(command: string, { disabled = true }: { disabled?: boolean } = {}) {
	if (typeof command !== "string" || !command.trim()) throw new Error("zotero-mcp command is required");
	return { command: command.trim(), env: { ZOTERO_LOCAL: "true" }, disabled };
}

/**
 * Merge a registration into a parsed MCP config.  Existing fields and env
 * values are retained byte-for-byte at the object level; the host adapter is
 * responsible for atomic persistence and must never log this return value.
 */
export function mergeZoteroMcpConfig(
	value: unknown,
	command: string,
	{ enable = false }: { enable?: boolean } = {},
): JsonRecord {
	if (!isRecord(value)) throw new Error("mcp config must contain an object");
	const key =
		value["mcp-servers"] !== undefined && value.mcpServers === undefined ? "mcp-servers" : "mcpServers";
	const source = value[key];
	const servers: JsonRecord = isRecord(source) ? { ...source } : {};
	const previousValue = servers[ZOTERO_SETUP_BINDING.mcpServer];
	const previous: JsonRecord = isRecord(previousValue) ? previousValue : {};
	const previousEnv = isRecord(previous.env) ? previous.env : {};
	const previousCommand = typeof previous.command === "string" ? previous.command : null;
	const spec = zoteroMcpSpec(command, { disabled: !enable });
	servers[ZOTERO_SETUP_BINDING.mcpServer] = {
		...previous,
		command: previousCommand || spec.command,
		env: { ...spec.env, ...previousEnv, ZOTERO_LOCAL: previousEnv.ZOTERO_LOCAL || spec.env.ZOTERO_LOCAL },
		disabled: !(enable || (Object.keys(previous).length > 0 && previous.disabled !== true)),
	};
	return { ...value, [key]: servers };
}

export interface ZoteroSetupStatus {
	commands: { zoteroCli?: string | null; zoteroMcp?: string | null };
	localApi: { reachable: boolean };
	desktop?: boolean;
}

/** Compute user-visible setup work from observed state; no probing or writes. */
export function remainingZoteroSetupSteps(status: ZoteroSetupStatus) {
	const steps: Array<{ id: string; text: string }> = [];
	if (status.desktop === false) {
		steps.push({
			id: "install-zotero-desktop",
			text: `Install Zotero 7+ from ${ZOTERO_SETUP_BINDING.download} and start it.`,
		});
	}
	if (!status.localApi.reachable) {
		steps.push({
			id: "enable-local-api",
			text: "Start Zotero and enable Settings → Advanced → Allow other applications on this computer to communicate with Zotero.",
		});
	}
	if (!status.commands.zoteroCli && !status.commands.zoteroMcp) {
		steps.push({
			id: "install-cli",
			text: "Confirm the in-app installer for zotero-mcp-server (uv preferred).",
		});
	}
	return steps;
}
