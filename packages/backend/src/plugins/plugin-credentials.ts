import { createHash } from "node:crypto";
import { join } from "node:path";
import { type Static, Type } from "typebox";
import { JsonStore } from "../json-store";
import { getAgentDir } from "../session-engine/sdk";
import { resolvePluginCredential } from "./credential-override";
import {
	assertEndpointAvailable,
	type PluginEndpointPolicy,
	runtimeEndpointMatches,
} from "./endpoint-policy";
import { isHostKeptCredential } from "./host-kept-credentials";
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
	/** The host handles HTTP challenges instead of attaching a literal secret header. */
	readonly authentication?: "http-basic-digest";
}

interface SavedCredential {
	readonly secret: string;
	readonly fields: Readonly<Record<string, string>>;
	readonly savedAt: string;
}

/** A credential belongs to the plugin and the slot definition; a version bump alone keeps it. */
function credentialKey(
	pluginId: string,
	{ slot, hosts, header, fields, authentication }: PluginCredentialSlot,
): string {
	const definition = createHash("sha256")
		.update(JSON.stringify({ slot, hosts, header, fields, ...(authentication ? { authentication } : {}) }))
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

	resolve(pluginId: string, slot: PluginCredentialSlot, env: NodeJS.ProcessEnv = process.env) {
		return resolvePluginCredential(this, pluginId, slot, env);
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

/** Resolve a declared slot and validate its destination before accessing any secret. */
export function credentialSlot(
	source: PluginRuntimeSource,
	name: string,
	url: URL,
	policy?: PluginEndpointPolicy,
	httpAuth = false,
): PluginCredentialSlot {
	const slot = source.credentials?.find((entry) => entry.slot === name);
	if (!slot) throw new Error(`Credential slot is not declared in this package's manifest: ${name}`);
	assertEndpointAvailable(policy, name);
	if (
		!slot.hosts.some((host) => host.toLowerCase() === url.host) &&
		!runtimeEndpointMatches(policy, url, name, httpAuth, policy?.credentialHosts[name])
	)
		throw new Error(`Credential ${name} may not be sent to ${url.host}`);
	return slot;
}

/** The header a `network.*` request naming `credential` carries, checked against the slot's hosts. */
export async function credentialHeader(
	store: PluginCredentialStore,
	source: PluginRuntimeSource,
	name: string,
	url: URL,
	policy?: PluginEndpointPolicy,
): Promise<Record<string, string>> {
	const slot = credentialSlot(source, name, url, policy);
	if (slot.authentication) throw new Error(`Credential ${name} requires host HTTP authentication`);
	const { credential } = await store.resolve(source.pluginId, slot);
	if (!credential) throw new Error(`Credential ${name} is not configured; add it in Drone settings`);
	return { [slot.header]: credential.secret };
}

const slotStatusResult = Type.Object(
	{
		configured: Type.Boolean(),
		fields: Type.Record(Type.String(), Type.String()),
		authentication: Type.Optional(Type.Literal("http-basic-digest")),
		source: Type.Union([Type.Literal("env"), Type.Literal("saved"), Type.Null()]),
		savedConfigured: Type.Boolean(),
	},
	{ additionalProperties: false },
);
const statusResult = Type.Object(
	{
		slots: Type.Record(Type.String(), slotStatusResult),
	},
	{ additionalProperties: false },
);

/** `credentials.status`: effective source, saved presence and non-secret fields; never the secret. */
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
				const slots: Record<string, Static<typeof slotStatusResult>> = {};
				for (const slot of source.credentials ?? []) {
					const { credential, savedConfigured } = await store.resolve(source.pluginId, slot);
					slots[slot.slot] = {
						configured: Boolean(credential),
						fields: { ...credential?.fields },
						...(slot.authentication ? { authentication: slot.authentication } : {}),
						source: credential?.source ?? null,
						savedConfigured,
					};
				}
				return { slots };
			},
		},
	};
}
