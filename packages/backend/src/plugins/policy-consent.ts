import { createHash } from "node:crypto";
import { type HostCustodyKind, hostCustodyEntry } from "./credential-custody";
import type { HostEventTopic } from "./host-event-topics";
import type { PluginNetworkPolicy } from "./network-policy";
import type { PluginCredentialSlot } from "./plugin-credentials";
import type { PluginRuntimeSource } from "./plugin-source";

/**
 * The user's approval of one package's credential and network policy.
 *
 * Approval is granted by the host at install time and travels with the runtime
 * source, so the backend can check it at the moment it would hand a secret to a
 * package.  Without a matching approval the host keeps its secret to itself.
 *
 * The approval names a **policy shape**, never a secret and never a value: the
 * user agrees to "the host fills this slot with a secret it keeps" and to "this
 * package may use an address you set", not to any particular key or URL.
 */
export interface PluginPolicyConsent {
	/** The package the approval was given to. */
	readonly pluginId: string;
	/** The package's content hash the approval was given for. */
	readonly contentHash: string;
	/** The fingerprint of the approved policy shape; this is what is checked. */
	readonly fingerprint: string;
	/** The slots the host fills from its own custody, for the record. */
	readonly custodySlots: readonly string[];
	/** Whether the approval covers a runtime endpoint, for the record. */
	readonly runtimeEndpoint: boolean;
}

/** A declared slot the host keeps a secret for, with the kind of that secret. */
export interface CustodyGrant {
	readonly slot: string;
	readonly kind: HostCustodyKind;
}

/**
 * The slots that ask the host to fill them, and that the host can fill.
 *
 * A slot that declares host custody with a shape the host does not keep gets
 * nothing from the host, so there is nothing to approve for it.
 */
export function custodyGrants(
	credentials: readonly PluginCredentialSlot[] | undefined,
): readonly CustodyGrant[] {
	return (credentials ?? []).flatMap((slot) => {
		const entry = hostCustodyEntry(slot);
		return entry ? [{ slot: slot.slot, kind: entry.custody }] : [];
	});
}

/** Whether a source declares a host-kept secret, runtime endpoint, or host event read. */
export function needsPolicyApproval(
	source: Pick<PluginRuntimeSource, "credentials" | "networkPolicy" | "hostEvents">,
): boolean {
	return (
		custodyGrants(source.credentials).length > 0 ||
		source.networkPolicy?.runtimeEndpoint !== undefined ||
		(source.hostEvents?.length ?? 0) > 0
	);
}

/**
 * The fingerprint of a package's credential, network and host event policy.
 *
 * Every field that changes where a secret may go is hashed: each slot's name,
 * hosts, header, fields, authentication and custody, the kind of secret the host
 * would fill it with, and the runtime endpoint policy.  The label is deliberately
 * **not** hashed — rewording a label must not make the user approve the same
 * grant twice.  Lists are sorted, so reordering a declaration is not a change.
 *
 * The custody kind comes from the host's own table, so a host that starts
 * keeping a secret for a shape it did not keep before changes the fingerprint,
 * and the user is asked before the new secret is handed over.
 * A nonempty host event declaration is also hashed as the third policy element.
 */
export function policyFingerprint(
	credentials: readonly PluginCredentialSlot[] | undefined,
	networkPolicy: PluginNetworkPolicy | undefined,
	hostEvents?: readonly string[],
): string {
	const slots = (credentials ?? [])
		.map((slot) => {
			const kind = hostCustodyEntry(slot)?.custody;
			return {
				slot: slot.slot,
				hosts: [...slot.hosts].sort(),
				header: slot.header,
				fields: [...slot.fields].sort(),
				...(slot.authentication ? { authentication: slot.authentication } : {}),
				...(slot.custody ? { custody: slot.custody } : {}),
				...(kind ? { kind } : {}),
			};
		})
		.sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0));
	const endpoint = networkPolicy?.runtimeEndpoint;
	return createHash("sha256")
		.update(
			JSON.stringify({
				credentials: slots,
				...(endpoint ? { runtimeEndpoint: { allowed: true, credentialSlot: endpoint.credentialSlot } } : {}),
				...(hostEvents?.length ? { hostSessionEventsRead: [...hostEvents].sort() } : {}),
			}),
		)
		.digest("hex");
}

/** The consent the user gives by approving this source's policy: bound to its package and its content. */
export function consentForSource(
	source: Pick<PluginRuntimeSource, "pluginId" | "credentials" | "networkPolicy" | "hostEvents"> & {
		readonly contentHash: string;
	},
): PluginPolicyConsent {
	return {
		pluginId: source.pluginId,
		contentHash: source.contentHash,
		fingerprint: policyFingerprint(source.credentials, source.networkPolicy, source.hostEvents),
		custodySlots: custodyGrants(source.credentials).map((grant) => grant.slot),
		runtimeEndpoint: source.networkPolicy?.runtimeEndpoint !== undefined,
	};
}

/**
 * Whether a consent covers what a source now declares.
 *
 * An approval is given to one package, for one content of it, for one policy
 * shape.  A package that changes its content must be asked again, a package that
 * adds a custody slot or a runtime endpoint changes its fingerprint, and an
 * approval never travels to another package.
 */
export function consentCovers(
	consent: Pick<PluginPolicyConsent, "pluginId" | "contentHash" | "fingerprint"> | undefined,
	source: Pick<
		PluginRuntimeSource,
		"pluginId" | "contentHash" | "credentials" | "networkPolicy" | "hostEvents"
	>,
): boolean {
	return (
		consent !== undefined &&
		source.contentHash !== undefined &&
		consent.pluginId === source.pluginId &&
		consent.contentHash === source.contentHash &&
		consent.fingerprint === policyFingerprint(source.credentials, source.networkPolicy, source.hostEvents)
	);
}

/**
 * Whether the user approved the policy this source declares.
 *
 * This is the one gate both grants pass through: the host-kept credential and the
 * runtime endpoint.  Without it the host keeps its secrets and its endpoints to
 * itself, so a package cannot obtain either by declaring the right shape.
 */
export function sourcePolicyApproved(source: PluginRuntimeSource): boolean {
	return consentCovers(source.policyConsent, source);
}

/** Narrows to a declared nonempty event list covered by the source's policy consent. */
export function hostEventsApproved(
	source: PluginRuntimeSource,
): source is PluginRuntimeSource & { readonly hostEvents: readonly [HostEventTopic, ...HostEventTopic[]] } {
	return (source.hostEvents?.length ?? 0) > 0 && sourcePolicyApproved(source);
}
