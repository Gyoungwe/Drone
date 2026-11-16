import { isHostKeptCredential, readHostKeptCredential } from "./host-kept-credentials";
import type { PluginCredentialSlot, PluginCredentialStore } from "./plugin-credentials";

/** Host-only credential material; callers project presence/source/fields, never the secret. */
export interface CredentialResolution {
	readonly credential?: {
		readonly secret: string;
		readonly fields: Readonly<Record<string, string>>;
		readonly source: "env" | "saved";
	};
	/** Presence in the generic slot store, independent of the effective credential. */
	readonly savedConfigured: boolean;
}

/** Resolve afresh for each call: Zotero host custody, WebDAV env override, then saved slot. */
export async function resolvePluginCredential(
	store: Pick<PluginCredentialStore, "get">,
	pluginId: string,
	slot: PluginCredentialSlot,
	env: NodeJS.ProcessEnv = process.env,
): Promise<CredentialResolution> {
	if (isHostKeptCredential(pluginId, slot)) {
		const credential = readHostKeptCredential(env);
		return {
			...(credential ? { credential: { ...credential, source: "env" as const } } : {}),
			savedConfigured: false,
		};
	}
	const saved = await store.get(pluginId, slot);
	if (
		pluginId === "@gyoungwe/pi-knowledge" &&
		slot.slot === "webdav" &&
		slot.authentication === "http-basic-digest" &&
		env.DRONE_WEBDAV_PASSWORD
	) {
		return {
			credential: { secret: env.DRONE_WEBDAV_PASSWORD, fields: {}, source: "env" },
			savedConfigured: Boolean(saved),
		};
	}
	return {
		...(saved
			? { credential: { secret: saved.secret, fields: saved.fields, source: "saved" as const } }
			: {}),
		savedConfigured: Boolean(saved),
	};
}
