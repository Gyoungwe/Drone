// @vitest-environment jsdom
import type { PluginCredentialEntry } from "@drone/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useI18nStore } from "../../i18n";
import { PluginCredentialsSection } from "./PluginCredentialsSection";

const pi = vi.hoisted(() => ({
	listPluginCredentials: vi.fn(),
	savePluginCredential: vi.fn(),
	clearPluginCredential: vi.fn(),
}));
vi.mock("../../api", () => ({ getPi: () => pi }));
vi.stubGlobal("React", React);
beforeEach(() => {
	vi.clearAllMocks();
	useI18nStore.setState({ language: "en" });
});
afterEach(cleanup);

const entry: PluginCredentialEntry = {
	pluginId: "@gyoungwe/pi-research",
	slot: "zotero-web",
	label: { zh: "Zotero 网页 API 密钥", en: "Zotero Web API key" },
	hosts: ["api.zotero.org"],
	fields: ["libraryType", "libraryId"],
	configured: false,
	source: null,
	savedConfigured: false,
	values: {},
};

it("saves the secret with the slot's fields and reloads; the secret field starts empty", async () => {
	pi.listPluginCredentials.mockResolvedValueOnce([entry]).mockResolvedValueOnce([
		{
			...entry,
			configured: true,
			source: "saved",
			savedConfigured: true,
			values: { libraryType: "users", libraryId: "42" },
		},
	]);
	pi.savePluginCredential.mockResolvedValue(undefined);
	render(<PluginCredentialsSection />);
	await screen.findByText("Zotero Web API key");
	fireEvent.change(screen.getByLabelText("libraryType"), { target: { value: "users" } });
	fireEvent.change(screen.getByLabelText("libraryId"), { target: { value: "42" } });
	fireEvent.change(screen.getByLabelText("Secret"), {
		target: { value: "key-1" },
	});
	fireEvent.click(screen.getByText("Save"));
	await screen.findByText("Configured — saved on this computer");
	expect(pi.savePluginCredential).toHaveBeenCalledExactlyOnceWith({
		pluginId: entry.pluginId,
		slot: "zotero-web",
		secret: "key-1",
		fields: { libraryType: "users", libraryId: "42" },
	});
	expect((screen.getByLabelText("Secret") as HTMLInputElement).value).toBe("");
	expect((screen.getByLabelText("libraryId") as HTMLInputElement).value).toBe("42");
});

it("shows a refused save inline and renders nothing when no plugin declares a slot", async () => {
	pi.listPluginCredentials.mockResolvedValueOnce([entry]);
	pi.savePluginCredential.mockRejectedValueOnce(new Error("Credential fields must be exactly: libraryType"));
	render(<PluginCredentialsSection />);
	fireEvent.change(await screen.findByLabelText("Secret"), {
		target: { value: "key-1" },
	});
	fireEvent.click(screen.getByText("Save"));
	await screen.findByText("Credential fields must be exactly: libraryType");
	cleanup();
	pi.listPluginCredentials.mockResolvedValueOnce([]);
	const { container } = render(<PluginCredentialsSection />);
	await waitFor(() => expect(pi.listPluginCredentials).toHaveBeenCalledTimes(2));
	expect(container.innerHTML).toBe("");
});

const webdav: PluginCredentialEntry = {
	...entry,
	pluginId: "@gyoungwe/pi-knowledge",
	slot: "webdav",
	label: { zh: "WebDAV 密码", en: "WebDAV password" },
	hosts: ["10.126.126.1:8080"],
	fields: [],
	authentication: "http-basic-digest",
};
const states = [
	{
		configured: false,
		source: null,
		savedConfigured: false,
		zh: "未配置",
		en: "Not configured",
	},
	{
		configured: true,
		source: "saved",
		savedConfigured: true,
		zh: "已配置 — 保存在本机",
		en: "Configured — saved on this computer",
	},
	{
		configured: true,
		source: "env",
		savedConfigured: false,
		zh: "正在使用 DRONE_WEBDAV_PASSWORD",
		en: "Using DRONE_WEBDAV_PASSWORD",
	},
	{
		configured: true,
		source: "env",
		savedConfigured: true,
		zh: "DRONE_WEBDAV_PASSWORD 优先于已保存的密码",
		en: "DRONE_WEBDAV_PASSWORD overrides the saved password",
	},
] as const;

it.each(["zh", "en"] as const)("renders all four credential states in %s", async (language) => {
	useI18nStore.setState({ language });
	for (const state of states) {
		pi.listPluginCredentials.mockResolvedValueOnce([
			{
				...webdav,
				configured: state.configured,
				source: state.source,
				savedConfigured: state.savedConfigured,
			},
		]);
		render(<PluginCredentialsSection />);
		await screen.findByText(state[language]);
		cleanup();
	}
});

it.each([false, true])(
	"keeps save/clear available under env with saved state %s",
	async (savedConfigured) => {
		const active = { ...webdav, configured: true, source: "env", savedConfigured };
		pi.listPluginCredentials
			.mockResolvedValueOnce([active])
			.mockResolvedValueOnce([{ ...active, savedConfigured: true }])
			.mockResolvedValueOnce([{ ...active, savedConfigured: false }]);
		pi.savePluginCredential.mockResolvedValueOnce(undefined);
		pi.clearPluginCredential.mockResolvedValueOnce(undefined);
		render(<PluginCredentialsSection />);
		const input = await screen.findByLabelText("Secret");
		expect((screen.getByText("Clear") as HTMLButtonElement).disabled).toBe(false);
		fireEvent.change(input, { target: { value: "TEST_ONLY_UI_SAVED_MARKER" } });
		fireEvent.click(screen.getByText("Save"));
		await waitFor(() => expect(pi.listPluginCredentials).toHaveBeenCalledTimes(2));
		await screen.findByText("DRONE_WEBDAV_PASSWORD overrides the saved password");
		expect((screen.getByLabelText("Secret") as HTMLInputElement).value).toBe("");
		expect(document.body.innerHTML).not.toContain("TEST_ONLY_UI_SAVED_MARKER");
		fireEvent.click(screen.getByText("Clear"));
		await screen.findByText("Using DRONE_WEBDAV_PASSWORD");
		expect(pi.clearPluginCredential).toHaveBeenCalledExactlyOnceWith({
			pluginId: webdav.pluginId,
			slot: "webdav",
		});
		expect(pi.listPluginCredentials).toHaveBeenCalledTimes(3);
	},
);
