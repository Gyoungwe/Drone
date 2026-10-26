// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
	pluginRuntimeSelectSession: vi.fn(async (_sessionId: string | null) => "selection-token"),
	pluginRuntimeInvoke: vi.fn(async () => "receipt"),
}));
vi.mock("../api", () => ({ getPi: () => api }));

import { useSessionsStore } from "../stores/sessions";
import { invokePluginRuntime, syncPluginCaller } from "./caller";

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
