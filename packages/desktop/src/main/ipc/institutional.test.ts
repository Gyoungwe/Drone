import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	fromWebContents: vi.fn(),
	institutional: {
		getStatus: vi.fn(),
		saveConfig: vi.fn(),
		openInstitutionalLogin: vi.fn(),
		openInstitutionalUrl: vi.fn(),
		clear: vi.fn(),
		testAccess: vi.fn(),
	},
}));

vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
			mocks.handlers.set(channel, handler),
		removeHandler: vi.fn(),
	},
	BrowserWindow: { fromWebContents: mocks.fromWebContents },
}));

vi.mock("../institutional-access", () => mocks.institutional);

import { InstitutionalContract, IpcChannels } from "@drone/shared";
import { registerInstitutionalIpc } from "./institutional";

const status = {
	config: { version: 1, autoDownloadEnabled: true, perTaskLimit: 20 },
	session: { cookiesCount: 0, hasSessionCookies: false, partition: "persist:drone-institutional" },
	loggedIn: false,
	electronAvailable: true,
};

describe("registerInstitutionalIpc", () => {
	beforeEach(() => {
		mocks.handlers.clear();
		vi.clearAllMocks();
		mocks.institutional.getStatus.mockResolvedValue(status);
		mocks.institutional.saveConfig.mockResolvedValue(status);
		mocks.institutional.openInstitutionalLogin.mockResolvedValue({ url: "https://login.example.edu" });
		mocks.institutional.openInstitutionalUrl.mockResolvedValue({ url: "https://example.edu" });
		mocks.institutional.clear.mockResolvedValue(status);
		mocks.institutional.testAccess.mockResolvedValue({
			url: "https://example.edu",
			status: 200,
			ok: true,
			via: "institutional_session",
		});
		mocks.fromWebContents.mockReturnValue({});
	});

	it("routes legacy channels through InstitutionalContract", async () => {
		registerInstitutionalIpc();
		const mainFrame = {};
		const event = { sender: { mainFrame }, senderFrame: mainFrame };

		expect(await mocks.handlers.get(IpcChannels.InstitutionalGetStatus)!({})).toEqual(status);
		expect(
			await mocks.handlers.get(IpcChannels.InstitutionalSaveConfig)!(event, { institutionName: "Example" }),
		).toEqual(status);
		expect(await mocks.handlers.get(IpcChannels.InstitutionalOpenLogin)!(event)).toEqual({
			url: "https://login.example.edu",
		});
		expect(
			await mocks.handlers.get(IpcChannels.InstitutionalTestAccess)!(event, "https://example.edu"),
		).toMatchObject({
			ok: true,
		});
		expect(mocks.institutional.saveConfig).toHaveBeenCalledWith({ institutionName: "Example" });
		expect(mocks.institutional.openInstitutionalLogin).toHaveBeenCalledWith(undefined);
	});

	it("rejects invalid arguments before invoking the implementation", async () => {
		registerInstitutionalIpc();
		const mainFrame = {};
		const event = { sender: { mainFrame }, senderFrame: mainFrame };
		const invalid = await mocks.handlers.get(IpcChannels.InstitutionalTestAccess)!(event, 42);
		expect(invalid).toMatchObject({ code: "invalid_arguments", severity: "error" });
		expect(mocks.institutional.testAccess).not.toHaveBeenCalled();
	});

	it("keeps main-frame protection for mutating and navigation methods", async () => {
		registerInstitutionalIpc();
		mocks.fromWebContents.mockReturnValue(null);
		await expect(
			mocks.handlers.get(IpcChannels.InstitutionalOpenUrl)!(
				{ sender: {}, senderFrame: null },
				"https://example.edu",
			),
		).rejects.toThrow("requires main frame");
		expect(mocks.institutional.openInstitutionalUrl).not.toHaveBeenCalled();
	});

	it("exposes the same contract channels", () => {
		registerInstitutionalIpc();
		for (const method of Object.keys(InstitutionalContract.methods)) {
			expect(mocks.handlers.has(`institutional:${method}`)).toBe(true);
		}
	});
});
