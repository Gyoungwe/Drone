import { defineDomain } from "@drone/shared";
import { Type } from "typebox";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	removeHandler: vi.fn((channel: string) => mocks.handlers.delete(channel)),
}));

vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
			mocks.handlers.set(channel, handler),
		removeHandler: mocks.removeHandler,
	},
	ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
	contextBridge: { exposeInMainWorld: vi.fn() },
}));

import { bindContract } from "./bind-contract";

const Contract = defineDomain("test", {
	methods: {
		echo: { args: Type.Tuple([Type.String({ minLength: 1 })]), result: Type.String() },
		bad: { args: Type.Tuple([]), result: Type.String() },
	},
	events: { changed: Type.Number() },
});

describe("bindContract", () => {
	beforeEach(() => {
		mocks.handlers.clear();
		mocks.removeHandler.mockClear();
	});

	it("validates arguments before invoking the implementation", async () => {
		const echo = vi.fn((value: string) => value.toUpperCase());
		const unbind = bindContract(Contract, { echo, bad: () => "ok" });
		const handler = mocks.handlers.get("test:echo")!;

		expect(await handler({}, "hello")).toBe("HELLO");
		echo.mockClear();
		const invalid = await handler({}, "");
		expect(invalid).toMatchObject({ code: "invalid_arguments", severity: "error" });
		expect(echo).not.toHaveBeenCalled();
		expect(JSON.stringify(invalid)).not.toContain('""');

		unbind();
		expect(mocks.removeHandler).toHaveBeenCalledWith("test:echo");
		expect(mocks.removeHandler).toHaveBeenCalledWith("test:bad");
	});

	it("checks result schemas in development mode", async () => {
		bindContract(
			Contract,
			{ echo: () => "ok", bad: (() => 42) as unknown as () => string },
			{ validateResult: true },
		);
		const invalid = await mocks.handlers.get("test:bad")!({});
		expect(invalid).toMatchObject({ code: "invalid_result", severity: "error" });
	});
});
