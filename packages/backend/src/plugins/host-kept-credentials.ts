import type { PluginCredentialSlot } from "./plugin-credentials";

/** Only this package and exact declaration may use the key managed in Zotero settings. */
export function isHostKeptCredential(pluginId: string, slot: PluginCredentialSlot): boolean {
	return (
		pluginId === "@gyoungwe/pi-research" &&
		slot.slot === "zotero-local" &&
		slot.hosts.length === 1 &&
		slot.hosts[0] === "127.0.0.1:23119" &&
		slot.header === "Zotero-API-Key" &&
		slot.fields.length === 1 &&
		slot.fields[0] === "serverId"
	);
}

/** Read on every call so authorization, clearing and user-provided environment values take effect. */
export function readHostKeptCredential():
	| { readonly secret: string; readonly fields: Readonly<Record<string, string>> }
	| undefined {
	const secret = process.env.ZOTERO_LOCAL_API_KEY;
	if (!secret) return undefined;
	const serverId = process.env.ZOTERO_LOCAL_SERVER_ID;
	return { secret, fields: serverId === undefined ? {} : { serverId } };
}
