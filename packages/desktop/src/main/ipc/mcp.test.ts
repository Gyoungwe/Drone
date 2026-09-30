import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	removeHandler: vi.fn((channel: string) => mocks.handlers.delete(channel)),
	openPath: vi.fn(async () => ""),
}));

vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
			mocks.handlers.set(channel, handler),
		removeHandler: mocks.removeHandler,
	},
	shell: { openPath: mocks.openPath },
}));

import { IpcChannels } from "@drone/shared";
import { registerMcpIpc } from "./mcp";

const status = {
	version: 1 as const,
	servers: [],
	totalTools: 0,
	totalResources: 0,
	connectedCount: 0,
	disabledCount: 0,
};
const config = { path: "/tmp/.mcp.json", cwd: null, servers: [] };

describe("registerMcpIpc", () => {
	beforeEach(() => {
		mocks.handlers.clear();
		mocks.removeHandler.mockClear();
		mocks.openPath.mockClear();
	});

	it("routes status and config through the MCP contract", async () => {
		const mcp = {
			getStatus: vi.fn(async () => status),
			getConfig: vi.fn(async () => config),
		};
		const backend = {
			mcp,
			setMcpServerEnabled: vi.fn(async () => config),
		} as any;
		registerMcpIpc(backend);

		expect(await mocks.handlers.get(IpcChannels.McpGetStatus)!({}, undefined)).toEqual(status);
		expect(await mocks.handlers.get(IpcChannels.McpGetConfig)!({}, undefined)).toEqual(config);
		expect(mcp.getStatus).toHaveBeenCalledWith(undefined);
		expect(mcp.getConfig).toHaveBeenCalledWith(undefined);
	});

	it("validates toggle arguments before invoking the backend", async () => {
		const backend = {
			mcp: { getStatus: vi.fn(async () => status), getConfig: vi.fn(async () => config) },
			setMcpServerEnabled: vi.fn(async () => config),
		} as any;
		registerMcpIpc(backend);

		const invalid = await mocks.handlers.get(IpcChannels.McpSetServerEnabled)!({}, "docs", "true");
		expect(invalid).toMatchObject({ code: "invalid_arguments", severity: "error" });
		expect(backend.setMcpServerEnabled).not.toHaveBeenCalled();
	});

	it("opens only the resolved configuration path", async () => {
		const backend = {
			mcp: { getStatus: vi.fn(async () => status), getConfig: vi.fn(async () => config) },
			setMcpServerEnabled: vi.fn(async () => config),
		} as any;
		registerMcpIpc(backend);
		await mocks.handlers.get(IpcChannels.McpOpenConfig)!({}, undefined);
		expect(mocks.openPath).toHaveBeenCalledWith(config.path);
	});
});
