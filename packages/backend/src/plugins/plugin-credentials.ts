import { createHash } from "node:crypto";
import { join } from "node:path";
import { Type } from "typebox";
import { JsonStore } from "../json-store";
import { getAgentDir } from "../session-engine/sdk";
import { isHostKeptCredential, readHostKeptCredential } from "./host-kept-credentials";
import type { PluginRuntimeSource } from "./plugin-source";
import type { PluginCapabilityHandler } from "./runtime-capabilities";

/**
 * Secrets the host keeps for one installed plugin (docs/superpowers/specs/2026-11-06-plugin-credentials-design.md).
 * The plugin declares a slot in `drone.credentials`; the host adds the secret as a request header on
 * `network.*`, so plugin code never sees it.
 */
export interface PluginCredentialSlot {
	readonly slot: string;
	readonly label: { readonly zh: string; readonly en: string };
	/** Exact hosts, a subset of `permissions.network`, that may receive the secret. */
	readonly hosts: readonly string[];
	readonly header: string;
	/** Non-secret values saved with the secret that the plugin may read, such as a library id. */
	readonly fields: readonly string[];
}

interface SavedCredential {
	readonly secret: string;
	readonly fields: Readonly<Record<string, string>>;
	readonly savedAt: string;
}

/** A credential belongs to the plugin and the slot definition; a version bump alone keeps it. */
function credentialKey(pluginId: string, { slot, hosts, header, fields }: PluginCredentialSlot): string {
	const definition = createHash("sha256")
		.update(JSON.stringify({ slot, hosts, header, fields }))
		.digest("hex");
	return `${pluginId}\t${definition}`;
}

export class PluginCredentialStore {
	private readonly store: JsonStore<Record<string, SavedCredential>>;

	static isHostKept(pluginId: string, slot: PluginCredentialSlot): boolean {
		return isHostKeptCredential(pluginId, slot);
	}

	constructor(path = join(getAgentDir(), "plugin-credentials.json")) {
		this.store = new JsonStore({
			path,
			storageId: "agent-plugin-credentials",
			defaultValue: () => ({}),
			mode: 0o600,
		});
	}

	async get(pluginId: string, slot: PluginCredentialSlot): Promise<SavedCredential | undefined> {
		return (await this.store.read())[credentialKey(pluginId, slot)];
	}

	async save(
		pluginId: string,
		slot: PluginCredentialSlot,
		secret: string,
		fields: Readonly<Record<string, string>>,
	): Promise<void> {
		if (!secret.trim()) throw new Error("Credential secret is empty");
		const names = Object.keys(fields).sort();
		if (JSON.stringify(names) !== JSON.stringify([...slot.fields].sort()))
			throw new Error(`Credential fields must be exactly: ${slot.fields.join(", ")}`);
		await this.store.update((all) => {
			all[credentialKey(pluginId, slot)] = { secret, fields, savedAt: new Date().toISOString() };
		});
	}

	async clear(pluginId: string, slot: PluginCredentialSlot): Promise<void> {
		await this.store.update((all) => {
			delete all[credentialKey(pluginId, slot)];
		});
	}
}

/** Header names a source's slots reserve: plugin code may never set them itself. */
export function credentialHeaders(source: PluginRuntimeSource): readonly string[] {
	return (source.credentials ?? []).map((slot) => slot.header.toLowerCase());
}

/** The header a `network.*` request naming `credential` carries, checked against the slot's hosts. */
export async function credentialHeader(
	store: PluginCredentialStore,
	source: PluginRuntimeSource,
	name: string,
	url: URL,
): Promise<Record<string, string>> {
	const slot = source.credentials?.find((entry) => entry.slot === name);
	if (!slot) throw new Error(`Credential slot is not declared in this package's manifest: ${name}`);
	if (!slot.hosts.some((host) => host.toLowerCase() === url.host))
		throw new Error(`Credential ${name} may not be sent to ${url.host}`);
	const saved = isHostKeptCredential(source.pluginId, slot)
		? readHostKeptCredential()
		: await store.get(source.pluginId, slot);
	if (!saved) throw new Error(`Credential ${name} is not configured; add it in Drone settings`);
	return { [slot.header]: saved.secret };
}

const statusResult = Type.Object(
	{
		slots: Type.Record(
			Type.String(),
			Type.Object(
				{ configured: Type.Boolean(), fields: Type.Record(Type.String(), Type.String()) },
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);

/** `credentials.status`: which declared slots are saved, with their non-secret fields; never the secret. */
export function credentialCapabilityHandlers(
	store: PluginCredentialStore,
	source: PluginRuntimeSource,
): Record<"credentials.status", PluginCapabilityHandler> {
	return {
		"credentials.status": {
			effect: "read",
			inputSchema: Type.Null(),
			resultSchema: statusResult,
			execute: async () => {
				const slots: Record<string, { configured: boolean; fields: Record<string, string> }> = {};
				for (const slot of source.credentials ?? []) {
					const saved = isHostKeptCredential(source.pluginId, slot)
						? readHostKeptCredential()
						: await store.get(source.pluginId, slot);
					slots[slot.slot] = { configured: Boolean(saved), fields: { ...saved?.fields } };
				}
				return { slots };
			},
		},
	};
}
