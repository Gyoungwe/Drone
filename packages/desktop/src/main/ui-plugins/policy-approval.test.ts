import type { PluginCredentialSlot } from "@drone/backend";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({ showMessageBox: vi.fn() }));
vi.mock("electron", () => ({ dialog: { showMessageBox: electron.showMessageBox } }));

import { policyApprovalMessage, policySentences, requestPolicyApproval } from "./policy-approval";

const zoteroLocal: PluginCredentialSlot = {
	slot: "zotero-local",
	label: { zh: "Zotero 本机写入", en: "Zotero local writes" },
	hosts: ["127.0.0.1:23119"],
	header: "Zotero-API-Key",
	fields: ["serverId"],
	custody: "host-environment",
};
const webdav: PluginCredentialSlot = {
	slot: "webdav",
	label: { zh: "WebDAV 密码", en: "WebDAV password" },
	hosts: ["10.126.126.1:8080"],
	header: "Authorization",
	fields: [],
	authentication: "http-basic-digest",
	custody: "host-environment",
};
const runtimeEndpoint = { runtimeEndpoint: { allowed: true as const, credentialSlot: "webdav" } };

beforeEach(() => electron.showMessageBox.mockReset());

describe("the policy lines", () => {
	it("shows one line per host-kept secret and one for the runtime endpoint", () => {
		const knowledge = policySentences({ credentials: [webdav], networkPolicy: runtimeEndpoint });
		const research = policySentences({ credentials: [zoteroLocal] });
		expect(knowledge).toHaveLength(2);
		expect(research).toHaveLength(1);
		// Each kind of secret has its own sentence: a Zotero key is not described as a WebDAV password.
		expect(research[0]).not.toBe(knowledge[0]);
	});

	it("shows nothing for a slot the host keeps no secret for", () => {
		expect(policySentences({ credentials: [{ ...zoteroLocal, header: "X-Key" }] })).toEqual([]);
		expect(policySentences({ credentials: [{ ...webdav, custody: "user" }] })).toEqual([]);
	});

	it("has a sentence in both languages for every kind of secret and for the runtime endpoint", () => {
		const sentences = policySentences({ credentials: [zoteroLocal, webdav], networkPolicy: runtimeEndpoint });
		expect(sentences).toHaveLength(3);
		for (const sentence of sentences) {
			expect(sentence.zh.trim()).not.toBe("");
			expect(sentence.en.trim()).not.toBe("");
		}
	});

	it("names the package and says the approval lasts for this version only", () => {
		const message = policyApprovalMessage({ pluginId: "@fixture/research", credentials: [zoteroLocal] });
		expect(
			message.zh.startsWith("@fixture/research 申请以下策略。仅对本版本生效；插件更新后会重新询问。"),
		).toBe(true);
		expect(
			message.en.startsWith(
				"@fixture/research requests the following policy. It applies to this version only; you are asked again after an update.",
			),
		).toBe(true);
	});
});

describe("the dialog", () => {
	it("defaults to Deny, treats dismissing as Deny, and approves only on Allow", async () => {
		electron.showMessageBox.mockResolvedValue({ response: 1 });
		expect(await requestPolicyApproval({ pluginId: "@fixture/research", credentials: [zoteroLocal] })).toBe(
			false,
		);
		const options = electron.showMessageBox.mock.calls[0]?.[0];
		expect(options).toMatchObject({ type: "question", defaultId: 1, cancelId: 1 });
		expect(options.buttons).toHaveLength(2);
		electron.showMessageBox.mockResolvedValue({ response: 0 });
		expect(await requestPolicyApproval({ pluginId: "@fixture/research", credentials: [zoteroLocal] })).toBe(
			true,
		);
	});

	it("attaches to the window it is given", async () => {
		const parent = { id: 7 } as never;
		electron.showMessageBox.mockResolvedValue({ response: 1 });
		await requestPolicyApproval({ pluginId: "@fixture/research", credentials: [zoteroLocal] }, parent);
		expect(electron.showMessageBox.mock.calls[0]?.[0]).toBe(parent);
	});
});
