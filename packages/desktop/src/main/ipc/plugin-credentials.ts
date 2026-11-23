import {
	type PluginCredentialSlot,
	PluginCredentialStore,
	type PluginEndpointPolicy,
	type PluginRuntimeSource,
	resolvePluginEndpointPolicy,
} from "@drone/backend";
import { type PluginCredentialEntry, PluginCredentialsContract } from "@drone/shared";
import type { UiPluginManager } from "../ui-plugins/manager";
import { bindContract } from "./bind-contract";

type CredentialManager = Pick<UiPluginManager, "runtimeSources">;
type DeclaredCredentials = { source: PluginRuntimeSource; slots: readonly PluginCredentialSlot[] };

/** Declared sources by plugin id; an enabled package wins over a stale or unavailable copy. */
function declaredCredentials(manager: CredentialManager): Map<string, DeclaredCredentials> {
	const declarations = new Map<string, DeclaredCredentials>();
	for (const { source, state } of manager.runtimeSources())
		if (source.credentials && (state === "enabled" || !declarations.has(source.pluginId)))
			declarations.set(source.pluginId, { source, slots: source.credentials });
	return declarations;
}

function endpointStatus({ configuration }: PluginEndpointPolicy): PluginCredentialEntry["endpoint"] {
	if (!configuration) return undefined;
	if (configuration.state === "invalid") return { state: "invalid", reason: "invalid_endpoint" };
	return { state: "ready", url: configuration.endpoint, source: configuration.source };
}

async function credentialEntries(
	declarations: Iterable<DeclaredCredentials>,
	store: PluginCredentialStore,
): Promise<PluginCredentialEntry[]> {
	const entries: PluginCredentialEntry[] = [];
	for (const { source, slots } of declarations) {
		const policy = resolvePluginEndpointPolicy(source, process.env.DRONE_WEBDAV_ENDPOINT);
		for (const definition of slots) {
			const { pluginId } = source;
			if (PluginCredentialStore.isHostKept(definition, source)) continue;
			const { credential, savedConfigured } = await store.resolve(pluginId, definition, process.env, source);
			// The endpoint rides on the slot the policy named, not on a hard-coded name.
			const endpoint = policy.configuration?.slot === definition.slot ? endpointStatus(policy) : undefined;
			// The resolver builds this map from the same declared slots.
			const hosts = policy.credentialHosts[definition.slot] as readonly string[];
			entries.push({
				pluginId,
				slot: definition.slot,
				label: { ...definition.label },
				hosts: [...hosts],
				fields: [...definition.fields],
				configured: Boolean(credential),
				...(definition.authentication ? { authentication: definition.authentication } : {}),
				source: credential?.source ?? null,
				savedConfigured,
				values: { ...credential?.fields },
				...(endpoint ? { endpoint } : {}),
			});
		}
	}
	return entries;
}

/**
 * Settings page access to managed plugin credentials. Slots come only from the manifests of
 * discovered packages; the secret goes into the host store and is never sent back.
 */
export function registerPluginCredentialsIpc(
	manager: CredentialManager,
	store = new PluginCredentialStore(),
): void {
	const slotOf = (pluginId: string, name: string): PluginCredentialSlot => {
		const declared = declaredCredentials(manager).get(pluginId);
		const slot = declared?.slots.find((entry) => entry.slot === name);
		if (!declared || !slot) throw new Error(`Plugin ${pluginId} declares no credential slot ${name}`);
		if (PluginCredentialStore.isHostKept(slot, declared.source))
			throw new Error(`Credential ${name} is managed in Zotero settings`);
		return slot;
	};
	bindContract(PluginCredentialsContract, {
		listPluginCredentials: () => credentialEntries(declaredCredentials(manager).values(), store),
		savePluginCredential: async ({ pluginId, slot, secret, fields }) => {
			const definition = slotOf(pluginId, slot);
			await store.save(pluginId, definition, secret, fields);
			const saved = await store.get(pluginId, definition);
			if (
				!saved ||
				saved.secret !== secret ||
				Object.keys(saved.fields).length !== Object.keys(fields).length ||
				Object.entries(fields).some(([name, value]) => saved.fields[name] !== value)
			)
				throw new Error("Credential was not saved");
		},
		clearPluginCredential: async ({ pluginId, slot }) => {
			const definition = slotOf(pluginId, slot);
			await store.clear(pluginId, definition);
			if (await store.get(pluginId, definition)) throw new Error("Credential was not cleared");
		},
	});
}
