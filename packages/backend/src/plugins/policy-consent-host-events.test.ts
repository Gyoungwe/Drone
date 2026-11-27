import { describe, expect, it } from "vitest";
import type { HostEventTopic } from "./host-event-topics";
import type { PluginCredentialSlot } from "./plugin-credentials";
import type { PluginRuntimeSource } from "./plugin-source";
import {
	consentCovers,
	consentForSource,
	hostEventsApproved,
	needsPolicyApproval,
	policyFingerprint,
} from "./policy-consent";

const legacyCustody = "host" as never;
const webdav: PluginCredentialSlot = {
	slot: "webdav",
	label: { zh: "WebDAV", en: "WebDAV" },
	hosts: ["dav.example.com", "a.example.com"],
	header: "Authorization",
	fields: ["password", "user"],
	custody: legacyCustody,
};
const endpoint = { runtimeEndpoint: { allowed: true, credentialSlot: "webdav" } } as const;

function source(
	hostEvents?: readonly HostEventTopic[],
): PluginRuntimeSource & { readonly contentHash: string } {
	return {
		pluginId: "@fixture/events",
		packageRoot: "/fixture/events",
		entrypoint: "/fixture/events/runtime.mjs",
		contentHash: "content-hash-1",
		...(hostEvents === undefined ? {} : { hostEvents }),
	};
}

describe("host event policy consent", () => {
	it("preserves the three base policy fingerprints with absent or empty event declarations", () => {
		const cases = [
			{
				credentials: undefined,
				policy: undefined,
				fingerprint: "cfdb9cbaacd00844d89857c9edfadd34624fcb513c4e230e63249ecd9a6fe76c",
			},
			{
				credentials: [webdav],
				policy: undefined,
				fingerprint: "362e90883bd74427baf65007475aba063f937129ba1e85019278245f83ad96ce",
			},
			{
				credentials: undefined,
				policy: endpoint,
				fingerprint: "a22216876fdf3470515878391849e51784fa129f7c91ed6f257bf139df975a9d",
			},
		];
		for (const { credentials, policy, fingerprint } of cases) {
			expect(policyFingerprint(credentials, policy)).toBe(fingerprint);
			expect(policyFingerprint(credentials, policy, undefined)).toBe(fingerprint);
			expect(policyFingerprint(credentials, policy, [])).toBe(fingerprint);
		}
	});

	it("hashes nonempty event declarations without depending on their order", () => {
		const base = policyFingerprint(undefined, undefined);
		const compute = policyFingerprint(undefined, undefined, ["inquiry.compute"]);
		expect(compute).not.toBe(base);
		expect(policyFingerprint(undefined, undefined, ["inquiry.decision", "inquiry.compute"])).toBe(
			policyFingerprint(undefined, undefined, ["inquiry.compute", "inquiry.decision"]),
		);
		expect(policyFingerprint(undefined, undefined, ["inquiry.compute", "inquiry.task-terminal"])).not.toBe(
			compute,
		);
	});

	it("requires approval only when at least one policy is declared", () => {
		expect(needsPolicyApproval({})).toBe(false);
		expect(needsPolicyApproval({ hostEvents: ["inquiry.decision"] })).toBe(true);
	});

	it("invalidates consent when a source adds an event topic", () => {
		const declared = source(["inquiry.compute"]);
		const consent = consentForSource(declared);
		expect(consentCovers(consent, declared)).toBe(true);
		expect(
			consentCovers(consent, {
				...declared,
				hostEvents: ["inquiry.compute", "inquiry.decision"],
			}),
		).toBe(false);
	});

	it("approves only nonempty declarations covered by matching consent", () => {
		const declared = source(["inquiry.compute"]);
		const consent = consentForSource(declared);
		expect(hostEventsApproved(declared)).toBe(false);
		expect(hostEventsApproved({ ...declared, policyConsent: consent })).toBe(true);
		for (const hostEvents of [undefined, []]) {
			const empty = source(hostEvents);
			const emptyConsent = consentForSource(empty);
			expect(hostEventsApproved({ ...empty, policyConsent: emptyConsent })).toBe(false);
		}
	});
});
