// @vitest-environment jsdom
import type { UiPluginManifest } from "@drone/shared";
import type { PluginUiActivationContext, PluginUiRuntimeClient } from "@gyoungwe/plugin-api/ui";
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import React, { type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiPluginRegistry } from "./registry";
import { bindPluginRuntime, createPluginRuntimeClient, usePluginRuntime } from "./runtime";
import { UI_REGIONS, UI_SLOTS } from "./slots";

vi.stubGlobal("React", React);

const manifest: UiPluginManifest = {
	name: "runtime-ui-fixture",
	droneUi: 1,
	main: "src/index.tsx",
	slots: { [UI_SLOTS.ToolCallCard]: "Panel" },
	contributions: [{ id: "results", region: UI_REGIONS.PanelTab, export: "Panel" }],
};

beforeEach(() => {
	useUiPluginRegistry.setState({
		overrides: {},
		contributions: {},
		crashCounts: {},
		loadNonces: {},
		cleanups: {},
	});
});
afterEach(cleanup);

describe("package-bound UI runtime", () => {
	it("passes the same frozen client to slots, contributions and headless activation", () => {
		const invoke = vi.fn(async () => ({ count: 1 }));
		const runtime = createPluginRuntimeClient(invoke);
		const activate = vi.fn((_context: PluginUiActivationContext) => dispose);
		const dispose = vi.fn();
		const seen: PluginUiRuntimeClient[] = [];
		function Panel({ label = "contribution" }: { label?: string }) {
			const client = usePluginRuntime();
			seen.push(client);
			return (
				<button type="button" onClick={() => client.invoke("results.refresh", { limit: 2 })}>
					{label}
				</button>
			);
		}
		useUiPluginRegistry
			.getState()
			.applyPlugin({ ...manifest, headless: true }, { Panel, activate }, [UI_SLOTS.ToolCallCard], runtime);
		const state = useUiPluginRegistry.getState();
		const Slot = state.overrides[UI_SLOTS.ToolCallCard]!.component as ComponentType<{ label: string }>;
		const Contribution = state.contributions[UI_REGIONS.PanelTab]![0]!.component;
		render(
			<>
				<Slot label="slot" />
				<Contribution />
			</>,
		);
		fireEvent.click(screen.getByText("slot"));
		fireEvent.click(screen.getByText("contribution"));
		expect(seen).toEqual([runtime, runtime]);
		expect(Object.isFrozen(runtime)).toBe(true);
		expect(Object.keys(runtime)).toEqual(["invoke"]);
		expect(invoke).toHaveBeenNthCalledWith(1, "results.refresh", { limit: 2 });
		expect(invoke).toHaveBeenNthCalledWith(2, "results.refresh", { limit: 2 });
		expect(activate).toHaveBeenCalledWith({ runtime });
		state.removePlugin(manifest.name);
		expect(dispose).toHaveBeenCalledOnce();
	});

	it("keeps distinct clients when one plugin renders another plugin's contribution", () => {
		const first = createPluginRuntimeClient(vi.fn(async () => "first"));
		const second = createPluginRuntimeClient(vi.fn(async () => "second"));
		const seen: PluginUiRuntimeClient[] = [];
		function Inner() {
			seen.push(usePluginRuntime());
			return null;
		}
		useUiPluginRegistry.getState().applyPlugin({ ...manifest, name: "inner" }, { Panel: Inner }, [], second);
		const InnerContribution =
			useUiPluginRegistry.getState().contributions[UI_REGIONS.PanelTab]![0]!.component;
		function Outer() {
			seen.push(usePluginRuntime());
			return <InnerContribution />;
		}
		useUiPluginRegistry.getState().applyPlugin({ ...manifest, name: "outer" }, { Panel: Outer }, [], first);
		const OuterContribution =
			useUiPluginRegistry.getState().contributions[UI_REGIONS.PanelTab]![1]!.component;
		render(<OuterContribution />);
		expect(seen).toEqual([first, second]);
	});

	it("reports unavailable runtime instead of inheriting an outer plugin's client", () => {
		const runtime = createPluginRuntimeClient(vi.fn(async () => undefined));
		const Inner = bindPluginRuntime(() => {
			usePluginRuntime();
			return null;
		}, undefined);
		const Outer = bindPluginRuntime(() => <Inner />, runtime);
		expect(() => render(<Outer />)).toThrow("Plugin runtime is unavailable for this UI module");
		expect(() => renderHook(usePluginRuntime)).toThrow("Plugin runtime is unavailable for this UI module");
	});

	it("preserves operation results and revocation errors from the main process", async () => {
		const invoke = vi
			.fn()
			.mockResolvedValueOnce({ id: "receipt-1" })
			.mockRejectedValueOnce(new Error("Runtime binding was revoked"));
		const runtime = createPluginRuntimeClient(invoke);
		await expect(runtime.invoke("results.read", { id: "receipt-1" })).resolves.toEqual({ id: "receipt-1" });
		await expect(runtime.invoke("results.read", { id: "receipt-1" })).rejects.toThrow(
			"Runtime binding was revoked",
		);
	});
});
