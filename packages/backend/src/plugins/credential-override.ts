import { type HostCustodyEntry, hostCustodyEntry } from "./credential-custody";
import type { PluginCredentialSlot, PluginCredentialStore } from "./plugin-credentials";
import type { PluginRuntimeSource } from "./plugin-source";
import { sourcePolicyApproved } from "./policy-consent";

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

/**
 * The host custody this slot was granted, if any.
 *
 * Two things must hold: the slot declares a shape the host keeps a secret for,
 * and the user approved the package's policy.  The shape alone grants nothing,
 * so a package cannot reach a host secret by copying another package's slot.
 */
function grantedCustody(
	slot: PluginCredentialSlot,
	source?: PluginRuntimeSource,
): HostCustodyEntry | undefined {
	if (!source || !sourcePolicyApproved(source)) return undefined;
	return hostCustodyEntry(slot);
}

/**
 * Whether the host is the only source of this slot's secret, so the user has
 * nothing to save for it.  Without the user's approval the slot is an ordinary
 * one: the package may use a secret the user saved for it, never the host's.
 */
export function isHostKeptCredential(slot: PluginCredentialSlot, source?: PluginRuntimeSource): boolean {
	return grantedCustody(slot, source)?.saved === "never";
}

/**
 * Resolve afresh for each call: the host's secret when the slot was granted
 * custody, then the slot's saved secret.
 *
 * A host-kept secret is only handed over when the user approved this package's
 * policy.  The approval covers the whole declared policy by fingerprint, so a
 * package that adds a custody slot after the approval loses the grant rather
 * than gaining it silently.
 */
export async function resolvePluginCredential(
	store: Pick<PluginCredentialStore, "get">,
	pluginId: string,
	slot: PluginCredentialSlot,
	env: NodeJS.ProcessEnv = process.env,
	source?: PluginRuntimeSource,
): Promise<CredentialResolution> {
	const custody = grantedCustody(slot, source);
	if (custody?.saved === "never") {
		const credential = custody.read(env);
		return {
			...(credential ? { credential: { ...credential, source: "env" as const } } : {}),
			savedConfigured: false,
		};
	}
	const saved = await store.get(pluginId, slot);
	const override = custody?.read(env);
	if (override) return { credential: { ...override, source: "env" }, savedConfigured: Boolean(saved) };
	return {
		...(saved
			? { credential: { secret: saved.secret, fields: saved.fields, source: "saved" as const } }
			: {}),
		savedConfigured: Boolean(saved),
	};
}
