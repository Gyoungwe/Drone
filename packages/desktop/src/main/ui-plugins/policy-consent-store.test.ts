import type { PluginCredentialSlot } from "@drone/backend";
import type { UiPluginsConfig } from "@drone/shared";
import { describe, expect, it } from "vitest";
import type { InstalledUiRuntimeSource } from "./installed-package-sources";
import {
	applyPolicyDecision,
	awaitsPolicyApproval,
	consentToRecord,
	pendingPolicyApprovals,
	policyApprovalKey,
	policyConsentFor,
	sourceWithConsent,
} from "./policy-consent-store";

const zoteroLocal: PluginCredentialSlot = {
	slot: "zotero-local",
	label: { zh: "Zotero 本机写入", en: "Zotero local writes" },
	hosts: ["127.0.0.1:23119"],
	header: "Zotero-API-Key",
	fields: ["serverId"],
	custody: "host-environment",
};

function source(overrides: Partial<InstalledUiRuntimeSource> = {}): InstalledUiRuntimeSource {
	return {
		pluginId: "@fixture/research",
		packageRoot: "/fixture/research",
		installationPath: "/fixture/research",
		entrypoint: "/fixture/research/runtime.mjs",
		contentHash: "content-hash-1",
		credentials: [zoteroLocal],
		...overrides,
	};
}

const consentsFor = (current: InstalledUiRuntimeSource) => ({ [current.pluginId]: consentToRecord(current) });

describe("the recorded approval", () => {
	it("covers only the package, content and policy it was given for", () => {
		const approved = source();
		const consents = consentsFor(approved);
		expect(policyConsentFor(consents, approved)).toEqual(consents[approved.pluginId]);
		expect(policyConsentFor(consents, source({ contentHash: "content-hash-2" }))).toBeUndefined();
		expect(
			policyConsentFor(consents, source({ credentials: [{ ...zoteroLocal, hosts: ["x:1"] }] })),
		).toBeUndefined();
		// Another package with the same declaration does not inherit it.
		expect(
			policyConsentFor(
				{ "@fixture/other": consentToRecord(approved) },
				source({ pluginId: "@fixture/other" }),
			),
		).toBeUndefined();
	});

	it("is needed only by a package that asks for a host-kept secret or a runtime endpoint", () => {
		expect(awaitsPolicyApproval(undefined, source())).toBe(true);
		expect(awaitsPolicyApproval(consentsFor(source()), source())).toBe(false);
		expect(
			awaitsPolicyApproval(undefined, source({ credentials: [{ ...zoteroLocal, custody: undefined }] })),
		).toBe(false);
		// A custody shape the host does not keep gives the package nothing to approve.
		expect(
			awaitsPolicyApproval(undefined, source({ credentials: [{ ...zoteroLocal, header: "X-Key" }] })),
		).toBe(false);
		const endpoint = source({
			credentials: [{ ...zoteroLocal, custody: undefined }],
			networkPolicy: { runtimeEndpoint: { allowed: true, credentialSlot: "zotero-local" } },
		});
		expect(awaitsPolicyApproval(undefined, endpoint)).toBe(true);
	});

	it("rides on the source as one stable object while it covers the source", () => {
		const current = source();
		const consents = consentsFor(current);
		const first = sourceWithConsent(consents, current);
		expect(first).toEqual({ ...current, policyConsent: consents[current.pluginId] });
		// The code loader compares sources by identity: no change must look like no change.
		expect(sourceWithConsent(consentsFor(current), current)).toBe(first);
		expect(sourceWithConsent(undefined, current)).toBe(current);
	});
});

describe("asking the user", () => {
	it("asks once per package that would run, skipping refusals and switched-off packages", () => {
		const research = source();
		const copy = source({ packageRoot: "/fixture/research-copy" });
		const off = source({ pluginId: "@fixture/off", packageRoot: "/fixture/off" });
		const refused = source({ pluginId: "@fixture/refused", packageRoot: "/fixture/refused" });
		const approved = source({ pluginId: "@fixture/approved", packageRoot: "/fixture/approved" });
		const pending = pendingPolicyApprovals(
			[research, copy, undefined, off, refused, approved],
			consentsFor(approved),
			new Set([policyApprovalKey(refused)]),
			(root) => root === "/fixture/off",
		);
		expect(pending).toEqual([research]);
	});

	it("records an approval for this content, or switches the package's UI plugins off on a refusal", () => {
		const current = source();
		const config: UiPluginsConfig = {
			enabled: true,
			plugins: { "research-ui": { enabled: true, trusted: true }, other: { enabled: true, trusted: true } },
			assignments: {},
		};
		const declined = new Set<string>();
		expect(applyPolicyDecision(config, current, false, ["research-ui"], declined)).toEqual({
			plugins: { "research-ui": { enabled: false, trusted: true }, other: { enabled: true, trusted: true } },
		});
		expect(declined.has(policyApprovalKey(current))).toBe(true);
		expect(applyPolicyDecision(config, current, true, ["research-ui"], declined)).toEqual({
			policyConsents: consentsFor(current),
		});
		expect(declined.size).toBe(0);
	});
});
