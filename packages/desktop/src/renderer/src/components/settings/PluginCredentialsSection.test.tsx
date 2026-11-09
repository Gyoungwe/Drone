// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PluginCredentialsSection } from "./PluginCredentialsSection";

const pi = vi.hoisted(() => ({
	listPluginCredentials: vi.fn(),
	savePluginCredential: vi.fn(),
	clearPluginCredential: vi.fn(),
}));
vi.mock("../../api", () => ({ getPi: () => pi }));
vi.mock("../../i18n", () => ({ useT: () => (key: string) => key }));
vi.mock("../../hooks/use-language", () => ({ useLanguage: () => "en" }));
vi.stubGlobal("React", React);
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const entry = {
	pluginId: "@gyoungwe/pi-research",
	slot: "zotero-web",
	label: { zh: "Zotero 网页 API 密钥", en: "Zotero Web API key" },
	hosts: ["api.zotero.org"],
	fields: ["libraryType", "libraryId"],
	configured: false,
	values: {},
};

it("saves the secret with the slot's fields and reloads; the secret field starts empty", async () => {
	pi.listPluginCredentials
		.mockResolvedValueOnce([entry])
		.mockResolvedValueOnce([
			{ ...entry, configured: true, values: { libraryType: "users", libraryId: "42" } },
		]);
	pi.savePluginCredential.mockResolvedValue(undefined);
	render(<PluginCredentialsSection />);
	await screen.findByText("Zotero Web API key");
	fireEvent.change(screen.getByLabelText("libraryType"), { target: { value: "users" } });
	fireEvent.change(screen.getByLabelText("libraryId"), { target: { value: "42" } });
	fireEvent.change(screen.getByLabelText("settings.uiPlugins.credentialSecret"), {
		target: { value: "key-1" },
	});
	fireEvent.click(screen.getByText("common.save"));
	await screen.findByText("settings.uiPlugins.credentialConfigured");
	expect(pi.savePluginCredential).toHaveBeenCalledExactlyOnceWith({
		pluginId: entry.pluginId,
		slot: "zotero-web",
		secret: "key-1",
		fields: { libraryType: "users", libraryId: "42" },
	});
	expect((screen.getByLabelText("settings.uiPlugins.credentialSecret") as HTMLInputElement).value).toBe("");
	expect((screen.getByLabelText("libraryId") as HTMLInputElement).value).toBe("42");
});

it("shows a refused save inline and renders nothing when no plugin declares a slot", async () => {
	pi.listPluginCredentials.mockResolvedValueOnce([entry]);
	pi.savePluginCredential.mockRejectedValueOnce(new Error("Credential fields must be exactly: libraryType"));
	render(<PluginCredentialsSection />);
	fireEvent.change(await screen.findByLabelText("settings.uiPlugins.credentialSecret"), {
		target: { value: "key-1" },
	});
	fireEvent.click(screen.getByText("common.save"));
	await screen.findByText("Credential fields must be exactly: libraryType");
	cleanup();
	pi.listPluginCredentials.mockResolvedValueOnce([]);
	const { container } = render(<PluginCredentialsSection />);
	await waitFor(() => expect(pi.listPluginCredentials).toHaveBeenCalledTimes(2));
	expect(container.innerHTML).toBe("");
});
