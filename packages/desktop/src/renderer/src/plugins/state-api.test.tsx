// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { create } from "zustand";
import { PLUGIN_HOST_API_MANIFEST } from "./host-api.manifest";
import manifest from "./host-api.manifest.json";
import { createPluginStore } from "./state-api";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

it("uses the host's Zustand creator and keeps the public UI runtime free of Zustand", () => {
	expect(createPluginStore).toBe(create);
	const source = readFileSync("src/renderer/src/plugins/state-api.ts", "utf8");
	expect(source).toMatch(/import \{ create \} from "zustand"/);
	const runtime = readFileSync("../plugin-api/dist/ui.js", "utf8");
	expect(runtime).not.toContain("zustand");
});

it("registers the creator in the existing public stores namespace", () => {
	expect(manifest.namespaces.stores).toContainEqual({
		name: "createPluginStore",
		hostValue: "createPluginStore",
		envType: 'import("@gyoungwe/plugin-api/ui").PluginStoreCreator',
		pluginType: 'import("@gyoungwe/plugin-api/ui").PluginStoreCreator',
	});
	expect(PLUGIN_HOST_API_MANIFEST.namespaces.stores).toContain("createPluginStore");
});

it("keeps two plugin stores independent even when they start with the same state object", () => {
	const initialState = { count: 0 };
	const useFirst = createPluginStore(() => initialState);
	const useSecond = createPluginStore(() => initialState);
	function Counters() {
		const first = useFirst((state) => state.count);
		const second = useSecond((state) => state.count);
		return createElement("output", null, `${first}:${second}`);
	}
	render(createElement(Counters));
	expect(screen.getByRole("status").textContent).toBe("0:0");
	act(() => useFirst.setState((state) => ({ count: state.count + 1 })));
	expect(screen.getByRole("status").textContent).toBe("1:0");
	expect(useSecond.getState()).toBe(initialState);
	act(() => useSecond.setState({ count: 2 }));
	expect(screen.getByRole("status").textContent).toBe("1:2");
	expect(useFirst.getState().count).toBe(1);
});

it("preserves the selected object reference and skips renders for unrelated updates", () => {
	const slice = { label: "selected" };
	const useStore = createPluginStore(() => ({ slice, unrelated: 0 }));
	const selectSlice = (state: ReturnType<typeof useStore.getState>) => state.slice;
	expect(selectSlice(useStore.getState())).toBe(selectSlice(useStore.getState()));
	const renderSlice = vi.fn(() => useStore(selectSlice));
	const { result, rerender } = renderHook(renderSlice);
	expect(result.current).toBe(slice);
	rerender();
	expect(result.current).toBe(slice);
	const renders = renderSlice.mock.calls.length;
	act(() => useStore.setState({ unrelated: 1 }));
	expect(result.current).toBe(slice);
	expect(renderSlice).toHaveBeenCalledTimes(renders);
	const replacement = { label: "changed" };
	act(() => useStore.setState({ slice: replacement }));
	expect(result.current).toBe(replacement);
	expect(renderSlice).toHaveBeenCalledTimes(renders + 1);
});

it("removes the hook listener on unmount while preserving existing imperative listeners", () => {
	type CounterState = { count: number; increment(): void };
	const listeners = new Set<(state: CounterState, previousState: CounterState) => void>();
	const unsubscribeSpy = vi.fn();
	// Zustand's bound hook closes over the initializer API, so observe that API before binding.
	const useObservedStore = createPluginStore<CounterState>((set, get, api) => {
		const subscribe = api.subscribe;
		vi.spyOn(api, "subscribe").mockImplementation((listener) => {
			const unsubscribe = subscribe(listener);
			listeners.add(listener);
			return () => {
				unsubscribe();
				listeners.delete(listener);
				unsubscribeSpy();
			};
		});
		return { count: 0, increment: () => set({ count: get().count + 1 }) };
	});
	const existingListener = vi.fn();
	const unsubscribeExisting = useObservedStore.subscribe(existingListener);
	const priorCount = listeners.size;
	const selectCount = vi.fn((state: ReturnType<typeof useObservedStore.getState>) => state.count);
	const { result, unmount } = renderHook(() => useObservedStore(selectCount));
	expect(listeners.size).toBe(priorCount + 1);
	act(() => useObservedStore.getState().increment());
	expect(result.current).toBe(1);
	unmount();
	expect(listeners.size).toBe(priorCount);
	expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
	selectCount.mockClear();
	const warning = vi.spyOn(console, "error");
	act(() => useObservedStore.setState({ count: 2 }));
	expect(existingListener).toHaveBeenCalledTimes(2);
	expect(selectCount).not.toHaveBeenCalled();
	expect(warning).not.toHaveBeenCalled();
	unsubscribeExisting();
	expect(listeners.size).toBe(0);
});
