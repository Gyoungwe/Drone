// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
	pluginRuntimeSelectSession: vi.fn(async (_sessionId: string | null) => "selection-token"),
	pluginRuntimeInvoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => "receipt"),
	pluginRuntimeCancel: vi.fn(async () => true),
	onPluginRuntimeEvent: vi.fn(
		(
			_listener: (event: {
				binding: string;
				selectionToken: string;
				type: "changed";
				revision: number;
			}) => void,
		) => vi.fn(),
	),
}));
vi.mock("../api", () => ({ getPi: () => api }));

import { useSessionsStore } from "../stores/sessions";
import { invokePluginRuntime, subscribePluginRuntime, syncPluginCaller } from "./caller";

beforeEach(() => {
	api.pluginRuntimeSelectSession.mockReset().mockResolvedValue("selection-token");
	api.pluginRuntimeInvoke.mockReset().mockResolvedValue("receipt");
	api.pluginRuntimeCancel.mockReset().mockResolvedValue(true);
	useSessionsStore.setState({ activeSessionId: null });
});
it("uses explicit application selection for drafts and sends no caller assertions to invoke", async () => {
	useSessionsStore.setState({ activeSessionId: "draft:example" });
	await syncPluginCaller("draft:example");
	expect(await invokePluginRuntime("bound-token", "read", null)).toBe("receipt");
	expect(api.pluginRuntimeSelectSession).toHaveBeenLastCalledWith(null);
	expect(api.pluginRuntimeInvoke).toHaveBeenCalledWith("bound-token", "read", null, "selection-token");
});
it("does not dispatch an invocation after the selected session changes during synchronization", async () => {
	useSessionsStore.setState({ activeSessionId: "real-first" });
	let finish!: (token: string) => void;
	api.pluginRuntimeSelectSession.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const call = invokePluginRuntime("token", "write", { value: "old selection" });
	useSessionsStore.setState({ activeSessionId: "real-second" });
	finish("old-selection-token");
	await expect(call).rejects.toThrow("selection changed");
	expect(api.pluginRuntimeInvoke).not.toHaveBeenCalled();
});

it("filters runtime invalidations by binding and current main-issued selection lease", async () => {
	useSessionsStore.setState({ activeSessionId: "session-a" });
	api.pluginRuntimeSelectSession.mockResolvedValueOnce("lease-a");
	await syncPluginCaller("session-a");
	const listener = vi.fn();
	const unsubscribe = subscribePluginRuntime("binding-a", listener);
	const receive = api.onPluginRuntimeEvent.mock.calls.at(-1)![0];
	receive({ binding: "binding-b", selectionToken: "lease-a", type: "changed", revision: 1 });
	receive({ binding: "binding-a", selectionToken: "other-lease", type: "changed", revision: 2 });
	receive({ binding: "binding-a", selectionToken: "lease-a", type: "changed", revision: 3 });
	expect(listener).toHaveBeenCalledExactlyOnceWith({ type: "changed", revision: 3 });
	useSessionsStore.setState({ activeSessionId: "session-b" });
	receive({ binding: "binding-a", selectionToken: "lease-a", type: "changed", revision: 4 });
	expect(listener).toHaveBeenCalledTimes(1);
	unsubscribe();
	expect(api.onPluginRuntimeEvent.mock.results.at(-1)!.value).toHaveBeenCalledOnce();
});

it("does not restore an old selection lease after A to B to A or a late synchronization response", async () => {
	useSessionsStore.setState({ activeSessionId: "session-a" });
	let finish!: (token: string) => void;
	api.pluginRuntimeSelectSession.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const previous = syncPluginCaller("session-a");
	useSessionsStore.setState({ activeSessionId: "session-b" });
	api.pluginRuntimeSelectSession.mockResolvedValueOnce("lease-b");
	await syncPluginCaller("session-b");
	useSessionsStore.setState({ activeSessionId: "session-a" });
	api.pluginRuntimeSelectSession.mockResolvedValueOnce("lease-a-new");
	await syncPluginCaller("session-a");
	finish("lease-a-old");
	await previous;
	const listener = vi.fn();
	subscribePluginRuntime("binding", listener);
	const receive = api.onPluginRuntimeEvent.mock.calls.at(-1)![0];
	receive({ binding: "binding", selectionToken: "lease-a-old", type: "changed", revision: 1 });
	receive({ binding: "binding", selectionToken: "lease-b", type: "changed", revision: 2 });
	receive({ binding: "binding", selectionToken: "lease-a-new", type: "changed", revision: 3 });
	expect(listener).toHaveBeenCalledExactlyOnceWith({ type: "changed", revision: 3 });
});

it("does not synchronize or dispatch an already-aborted invocation", async () => {
	const controller = new AbortController();
	controller.abort(new Error("pre-canceled"));
	await expect(invokePluginRuntime("binding", "write", null, controller.signal)).rejects.toThrow(
		"pre-canceled",
	);
	expect(api.pluginRuntimeSelectSession).not.toHaveBeenCalled();
	expect(api.pluginRuntimeInvoke).not.toHaveBeenCalled();
	expect(api.pluginRuntimeCancel).not.toHaveBeenCalled();
});

it("passes only an exact request ID through IPC and waits for cancellation cleanup", async () => {
	const controller = new AbortController();
	let reject!: (error: Error) => void;
	let clean!: (value: boolean) => void;
	api.pluginRuntimeInvoke.mockImplementation(
		() =>
			new Promise((_resolve, fail) => {
				reject = fail;
			}),
	);
	api.pluginRuntimeCancel.mockImplementation(
		() =>
			new Promise((resolve) => {
				clean = resolve;
			}),
	);
	const pending = invokePluginRuntime("binding", "write", null, controller.signal);
	let completed = false;
	const failed = expect(pending)
		.rejects.toThrow("canceled")
		.then(() => {
			completed = true;
		});
	await vi.waitFor(() => expect(api.pluginRuntimeInvoke).toHaveBeenCalledOnce());
	const [, , , selection, requestId] = api.pluginRuntimeInvoke.mock.calls[0]!;
	expect(typeof requestId).toBe("string");
	controller.abort();
	expect(api.pluginRuntimeCancel).toHaveBeenCalledExactlyOnceWith("binding", selection, requestId);
	reject(new Error("model canceled"));
	await Promise.resolve();
	expect(completed).toBe(false);
	clean(true);
	await failed;
	expect(api.pluginRuntimeInvoke.mock.calls[0]).not.toContain(controller.signal);
});
