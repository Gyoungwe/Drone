import { consentCovers, consentForSource, needsPolicyApproval, policyFingerprint } from "@drone/backend";
import type { UiPluginPolicyConsent, UiPluginsConfig } from "@drone/shared";
import type { InstalledUiRuntimeSource } from "./installed-package-sources";

/** The approvals the host recorded, by package. */
export type PolicyConsents = Readonly<Record<string, UiPluginPolicyConsent>> | undefined;

/** The recorded approval that covers this source's current content and declared policy, if any. */
export function policyConsentFor(
	consents: PolicyConsents,
	source: InstalledUiRuntimeSource,
): UiPluginPolicyConsent | undefined {
	const consent = consents?.[source.pluginId];
	return consentCovers(consent, source) ? consent : undefined;
}

/**
 * Whether the package may not run until the user approves its policy.
 *
 * Approval is a precondition of enabling (D-CRED-2): a package that asks the host
 * for a secret it keeps, or for a runtime endpoint, does not run half-granted —
 * it does not run.
 */
export function awaitsPolicyApproval(consents: PolicyConsents, source: InstalledUiRuntimeSource): boolean {
	return needsPolicyApproval(source) && policyConsentFor(consents, source) === undefined;
}

/** One package content and policy, so a refusal is not asked again in the same run. */
export function policyApprovalKey(source: InstalledUiRuntimeSource): string {
	return [
		source.pluginId,
		source.contentHash,
		policyFingerprint(source.credentials, source.networkPolicy, source.hostEvents),
	].join("\t");
}

/** The approval to record when the user allows this source's policy. */
export function consentToRecord(source: InstalledUiRuntimeSource): UiPluginPolicyConsent {
	const consent = consentForSource(source);
	return { ...consent, custodySlots: [...consent.custodySlots] };
}

/**
 * The packages to ask about: each would run, waits for approval, was not refused
 * in this run, and was not switched off by the user — a switched-off package is
 * asked when the user switches it on.  One source per package.
 */
export function pendingPolicyApprovals(
	running: Iterable<InstalledUiRuntimeSource | undefined>,
	consents: PolicyConsents,
	declined: ReadonlySet<string>,
	switchedOff: (packageRoot: string) => boolean,
): InstalledUiRuntimeSource[] {
	const pending = new Map<string, InstalledUiRuntimeSource>();
	for (const source of running) {
		if (!source || pending.has(source.pluginId) || switchedOff(source.packageRoot)) continue;
		if (awaitsPolicyApproval(consents, source) && !declined.has(policyApprovalKey(source)))
			pending.set(source.pluginId, source);
	}
	return [...pending.values()];
}

/**
 * Apply the user's answer: remember a refusal in `declined` for this run, and
 * return the configuration change the answer makes.
 *
 * Allowing records the approval for this content.  Refusing switches the
 * package's UI plugins off — the package is not enabled (D-CRED-2) — so the user
 * is not asked again before they switch it back on.
 */
export function applyPolicyDecision(
	config: UiPluginsConfig,
	source: InstalledUiRuntimeSource,
	approved: boolean,
	uiNames: readonly string[],
	declined: Set<string>,
): Partial<UiPluginsConfig> {
	if (approved) {
		declined.delete(policyApprovalKey(source));
		return { policyConsents: { ...config.policyConsents, [source.pluginId]: consentToRecord(source) } };
	}
	declined.add(policyApprovalKey(source));
	const plugins = { ...config.plugins };
	for (const name of uiNames)
		plugins[name] = { enabled: false, trusted: config.plugins[name]?.trusted ?? false };
	return { plugins };
}

const consented = new WeakMap<InstalledUiRuntimeSource, InstalledUiRuntimeSource>();

/**
 * The source the backend runs, carrying the user's approval of its policy.
 *
 * A covering approval always says the same thing about the same source, so the
 * same object comes back for as long as one exists.  A caller that compares
 * sources by identity — the code loader checking that nothing changed while it
 * read — sees no change where there was none.
 */
export function sourceWithConsent(
	consents: PolicyConsents,
	source: InstalledUiRuntimeSource,
): InstalledUiRuntimeSource {
	const consent = policyConsentFor(consents, source);
	if (!consent) return source;
	let withConsent = consented.get(source);
	if (!withConsent) {
		withConsent = { ...source, policyConsent: consent };
		consented.set(source, withConsent);
	}
	return withConsent;
}
