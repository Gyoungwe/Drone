import { type PluginCredentialSlot, PluginCredentialStore } from "@drone/backend";
import { type PluginCredentialEntry, PluginCredentialsContract } from "@drone/shared";
import type { UiPluginManager } from "../ui-plugins/manager";
import { bindContract } from "./bind-contract";

/**
 * Settings page access to managed plugin credentials. Slots come only from the manifests of
 * discovered packages; the secret goes into the host store and is never sent back.
 */
export function registerPluginCredentialsIpc(
	manager: Pick<UiPluginManager, "runtimeSources">,
	store = new PluginCredentialStore(),
): void {
	/** Declared slots by plugin id; an enabled package wins over a stale or unavailable copy. */
	const declared = (): Map<string, readonly PluginCredentialSlot[]> => {
		const slots = new Map<string, readonly PluginCredentialSlot[]>();
		for (const { source, state } of manager.runtimeSources())
			if (source.credentials && (state === "enabled" || !slots.has(source.pluginId)))
				slots.set(source.pluginId, source.credentials);
		return slots;
	};
	const slotOf = (pluginId: string, name: string): PluginCredentialSlot => {
		const slot = declared()
			.get(pluginId)
			?.find((entry) => entry.slot === name);
		if (!slot) throw new Error(`Plugin ${pluginId} declares no credential slot ${name}`);
		if (PluginCredentialStore.isHostKept(pluginId, slot))
			throw new Error(`Credential ${name} is managed in Zotero settings`);
		return slot;
	};
	bindContract(PluginCredentialsContract, {
		listPluginCredentials: async () => {
			const entries: PluginCredentialEntry[] = [];
			for (const [pluginId, slots] of declared())
				for (const definition of slots) {
					if (PluginCredentialStore.isHostKept(pluginId, definition)) continue;
					const saved = await store.get(pluginId, definition);
					entries.push({
						pluginId,
						slot: definition.slot,
						label: { ...definition.label },
						hosts: [...definition.hosts],
						fields: [...definition.fields],
						configured: Boolean(saved),
						values: { ...saved?.fields },
					});
				}
			return entries;
		},
		savePluginCredential: ({ pluginId, slot, secret, fields }) =>
			store.save(pluginId, slotOf(pluginId, slot), secret, fields),
		clearPluginCredential: ({ pluginId, slot }) => store.clear(pluginId, slotOf(pluginId, slot)),
	});
}
