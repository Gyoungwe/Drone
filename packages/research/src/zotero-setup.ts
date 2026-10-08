/**
 * Host-independent Zotero setup policy.
 *
 * This module deliberately contains no filesystem, process, network or
 * credential access.  The CLI/desktop adapter owns those effects and calls
 * these functions only to validate and shape configuration values.
 */

import { zoteroLibraryEnvValue, zoteroLibraryPath } from "./zotero-library";

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

/**
 * Tools hidden by default in the registered MCP server (Pi `toolExposure: "hidden"`, translated by
 * pi-mcp-adapter into `excludeTools`): deletes stay a manual Zotero action.
 */
export const ZOTERO_MCP_HIDDEN_TOOLS = Object.freeze([
	"zotero_delete_item",
	"zotero_delete_collection",
	"zotero_delete_annotation",
]);

/**
 * Entry written to Pi's user-level `mcp.json`. Only fields pi-mcp-adapter 5.x translates for that
 * file are used (`command`/`args`/`env`/`description`/`timeout`/`toolExposure`/`enabled`); `disabled`
 * is not a Pi field and would be ignored (the server would start anyway).
 * - `ZOTERO_LIBRARY_TYPE` is explicit and singular (`user`/`group`): pyzotero appends the "s" itself,
 *   so an inherited plural value from older Drone builds produced `/userss/<id>` URLs.
 * - `ZOTERO_MCP_TOOLSETS=none` keeps the core tools only (search/read/add/collections/attach).
 * - Web API credentials are not written here; the child inherits `ZOTERO_API_KEY`/`ZOTERO_LIBRARY_ID`
 *   (or the Zotero 10 local key) from the host environment set up in Drone Settings → Zotero.
 */
export function zoteroMcpSpec(
	command: string,
	{ enabled = false, libraryType = "user" }: { enabled?: boolean; libraryType?: "user" | "group" } = {},
) {
	if (typeof command !== "string" || !command.trim()) throw new Error("zotero-mcp command is required");
	return {
		command: command.trim(),
		args: ["serve"],
		env: {
			ZOTERO_LOCAL: "true",
			ZOTERO_LIBRARY_TYPE: libraryType === "group" ? "group" : "user",
			ZOTERO_MCP_TOOLSETS: "none",
		},
		description:
			"Zotero library: search/read items and full text, add items by DOI/URL/file, file into collections, attach PDFs",
		timeout: 120,
		toolExposure: Object.fromEntries(ZOTERO_MCP_HIDDEN_TOOLS.map((tool) => [tool, "hidden"])) as Record<
			string,
			"hidden"
		>,
		...(enabled ? {} : { enabled: false as const }),
	};
}

/** Read one Zotero MCP registration from an already parsed (Pi-format) config object. */
export function readZoteroMcpConfig(value: unknown): ZoteroMcpServerEntry {
	if (!isRecord(value)) return { registered: false, disabled: true, command: null };
	const servers = value.mcpServers ?? value["mcp-servers"];
	if (!isRecord(servers)) return { registered: false, disabled: true, command: null };
	const raw = servers[ZOTERO_SETUP_BINDING.mcpServer];
	if (!isRecord(raw)) return { registered: false, disabled: true, command: null };
	return {
		registered: true,
		// `enabled: false` is the Pi field; legacy `disabled: true` (older builds) is read as intent.
		disabled: raw.enabled === false || raw.disabled === true,
		command: typeof raw.command === "string" ? raw.command : null,
	};
}

/** Absolute command path on Windows (`C:\…`, `\\server\…`) or POSIX (`/…`). */
function isAbsoluteCommand(command: string): boolean {
	return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(command);
}

/** A bare `zotero-mcp` / `zotero-mcp.exe` that relies on PATH (Electron launched from the Start menu may not have it). */
function isBareZoteroMcp(command: string): boolean {
	return /^zotero-mcp(?:\.exe)?$/i.test(command.trim());
}

/** pyzotero spelling of a library type value written by any Drone build or by hand. */
function singularLibraryType(value: unknown): "user" | "group" | null {
	if (typeof value !== "string" || !value.trim()) return null;
	const path = zoteroLibraryPath(value);
	return path ? zoteroLibraryEnvValue(path) : null;
}

/**
 * Merge a registration into a parsed Pi-format MCP config. User-set fields and env values are kept;
 * missing defaults are filled in; a bare PATH command is upgraded to the resolved absolute path; a
 * plural `ZOTERO_LIBRARY_TYPE` is rewritten singular; legacy `disabled` is replaced by `enabled`.
 * The enabled-state of an existing entry is preserved unless `enable` is set. The host adapter is
 * responsible for atomic persistence and must never log this return value.
 */
export function mergeZoteroMcpConfig(
	value: unknown,
	command: string,
	{ enable = false, libraryType = "user" }: { enable?: boolean; libraryType?: "user" | "group" } = {},
): JsonRecord {
	if (!isRecord(value)) throw new Error("mcp config must contain an object");
	const key =
		value["mcp-servers"] !== undefined && value.mcpServers === undefined ? "mcp-servers" : "mcpServers";
	const source = value[key];
	const servers: JsonRecord = isRecord(source) ? { ...source } : {};
	const previousValue = servers[ZOTERO_SETUP_BINDING.mcpServer];
	const previous: JsonRecord = isRecord(previousValue) ? previousValue : {};
	const existed = Object.keys(previous).length > 0;
	const previousEnv = isRecord(previous.env) ? previous.env : {};
	const previousCommand =
		typeof previous.command === "string" && previous.command.trim() ? previous.command : null;
	const wasDisabled = previous.enabled === false || previous.disabled === true;
	const spec = zoteroMcpSpec(command, { enabled: true, libraryType });
	const keepCommand =
		previousCommand !== null && !(isBareZoteroMcp(previousCommand) && isAbsoluteCommand(spec.command));
	const nextCommand = keepCommand ? (previousCommand as string) : spec.command;
	const env: JsonRecord = { ...spec.env, ...previousEnv };
	env.ZOTERO_LOCAL = previousEnv.ZOTERO_LOCAL || spec.env.ZOTERO_LOCAL;
	env.ZOTERO_LIBRARY_TYPE =
		singularLibraryType(previousEnv.ZOTERO_LIBRARY_TYPE) ?? spec.env.ZOTERO_LIBRARY_TYPE;
	const { disabled: _legacy, enabled: _enabled, ...rest } = previous;
	const next: JsonRecord = {
		...rest,
		command: nextCommand,
		// `serve` only for the zotero-mcp binary itself; a custom launcher (uvx …) keeps its own args.
		...(previous.args === undefined && /zotero-mcp(?:\.exe)?$/i.test(nextCommand) ? { args: spec.args } : {}),
		env,
		description: typeof previous.description === "string" ? previous.description : spec.description,
		timeout: typeof previous.timeout === "number" ? previous.timeout : spec.timeout,
		toolExposure: { ...spec.toolExposure, ...(isRecord(previous.toolExposure) ? previous.toolExposure : {}) },
	};
	const enabled = enable || (existed && !wasDisabled);
	if (!enabled) next.enabled = false;
	servers[ZOTERO_SETUP_BINDING.mcpServer] = next;
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
