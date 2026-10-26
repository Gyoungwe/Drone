// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
	pluginRuntimeSelectSession: vi.fn(async (_sessionId: string | null) => "selection-token"),
	pluginRuntimeInvoke: vi.fn(async () => "receipt"),
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
	api.pluginRuntimeInvoke.mockClear();
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
