import { defineDomain } from "@drone/shared";
import { Type } from "typebox";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
	return {
		listeners,
		ipcRenderer: {
			invoke: vi.fn(async (channel: string, ...args: unknown[]): Promise<unknown> => ({ channel, args })),
			on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
				const set = listeners.get(channel) ?? new Set();
				set.add(listener);
				listeners.set(channel, set);
			}),
			removeListener: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
				listeners.get(channel)?.delete(listener);
			}),
		},
		bridge: { exposeInMainWorld: vi.fn() },
	};
});

vi.mock("electron", () => ({
	ipcRenderer: mocks.ipcRenderer,
	contextBridge: mocks.bridge,
	ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));

import { exposeContract, isHostApiValidationEnvelope } from "./expose-contract";

const Contract = defineDomain("test", {
	methods: { echo: { args: Type.Tuple([Type.String()]), result: Type.String() } },
	events: { changed: Type.Number() },
});

describe("exposeContract", () => {
	beforeEach(() => {
		mocks.listeners.clear();
		vi.clearAllMocks();
	});

	it("generates invoke methods and event subscriptions with unsubscribe", async () => {
		const client = exposeContract(Contract);
		expect(await client.echo("value")).toEqual({ channel: "test:echo", args: ["value"] });

		const received: number[] = [];
		const unsubscribe = client.onChanged((value) => received.push(value));
		const listener = [...mocks.listeners.get("test:changed")!][0];
		if (!listener) throw new Error("event listener was not registered");
		listener({}, 3);
		expect(received).toEqual([3]);
		unsubscribe();
		expect(mocks.ipcRenderer.removeListener).toHaveBeenCalledWith("test:changed", listener);
		expect(mocks.listeners.get("test:changed")?.size).toBe(0);
	});

	it("can expose the generated client to an explicit bridge", () => {
		const client = exposeContract(Contract, { bridge: mocks.bridge, globalName: "host" });
		expect(mocks.bridge.exposeInMainWorld).toHaveBeenCalledWith("host", client);
	});

	it("rejects the host's validation envelope instead of resolving it as a result", async () => {
		const envelope = {
			code: "invalid_arguments",
			severity: "error",
			source: "app",
			titleKey: "error.title.invalidArguments",
			detail: "Invalid arguments for host method test:echo",
			actions: ["copyDetail"],
			timestamp: 1,
		};
		mocks.ipcRenderer.invoke.mockResolvedValueOnce(envelope);
		const client = exposeContract(Contract);
		await expect(client.echo("x".repeat(5))).rejects.toThrow("Invalid arguments for host method test:echo");
		expect(isHostApiValidationEnvelope(envelope)).toBe(true);
		// ordinary results that merely carry a "code" field are passed through
		expect(isHostApiValidationEnvelope({ code: "invalid_arguments", detail: "x" })).toBe(false);
		mocks.ipcRenderer.invoke.mockResolvedValueOnce({ code: "ok" });
		expect(await client.echo("y")).toEqual({ code: "ok" });
	});
});
