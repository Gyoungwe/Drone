/**
 * Zotero library type spellings.
 *
 * The Zotero Web API path segment is plural (`/users/<id>`, `/groups/<id>`), while pyzotero — and so
 * zotero-mcp / zotero-cli — read `ZOTERO_LIBRARY_TYPE` as singular (`user` / `group`) and append the
 * "s" themselves (`users` there becomes `/userss/<id>` → 404). Drone injects the singular form into
 * the process environment (inherited by MCP children) and every Drone consumer accepts both.
 */

export type ZoteroLibraryPath = "users" | "groups";
export type ZoteroLibraryEnvValue = "user" | "group";

/**
 * Normalize `ZOTERO_LIBRARY_TYPE` (singular or plural, any case) to the Web API path segment.
 * Unset/empty means the personal library; an unknown value returns null (treat as not configured).
 */
export function zoteroLibraryPath(value: unknown): ZoteroLibraryPath | null {
	if (value === undefined || value === null) return "users";
	const text = String(value).trim().toLowerCase();
	if (text === "" || text === "user" || text === "users") return "users";
	if (text === "group" || text === "groups") return "groups";
	return null;
}

/** The `ZOTERO_LIBRARY_TYPE` value pyzotero/zotero-mcp expect for a library path segment. */
export function zoteroLibraryEnvValue(
	path: ZoteroLibraryPath | string | null | undefined,
): ZoteroLibraryEnvValue {
	return zoteroLibraryPath(path) === "groups" ? "group" : "user";
}
