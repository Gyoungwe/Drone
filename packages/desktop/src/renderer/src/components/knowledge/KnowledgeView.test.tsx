// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiPluginRegistry } from "../../plugins/registry";
import { useKnowledgeStore } from "../../stores/knowledge";
import { useSessionsStore } from "../../stores/sessions";
import { useSettingsStore } from "../../stores/settings";
import { useUiPluginsStore } from "../../stores/ui-plugins";
import { KnowledgeSurface } from "./KnowledgeSurface";
import { KnowledgeUiRoot } from "./KnowledgeUiRoot";
import { KnowledgeView } from "./KnowledgeView";

const api = vi.hoisted(() => ({
	getKnowledgeOverview: vi.fn(),
	openKnowledgeTarget: vi.fn().mockResolvedValue(undefined),
	uiPluginsSetPluginEnabled: vi.fn().mockResolvedValue(undefined),
	onKnowledgeEvent: vi.fn(),
}));
vi.mock("../../api", () => ({ getPi: () => api }));
vi.mock("../../i18n", () => ({ useT: () => (key: string) => key }));
vi.stubGlobal("React", React);
const manifest = {
	name: "knowledge-test",
	droneUi: 1,
	main: "index.tsx",
	contributions: [
		{ id: "page", region: "knowledge.page", export: "Page" },
		{ id: "surface", region: "knowledge.surface", export: "Surface" },
	],
};
function enable(Page = () => <p>plugin knowledge workspace</p>) {
	useUiPluginRegistry
		.getState()
		.applyPlugin(manifest, { Page, Surface: ({ path }: { path: string }) => <p>{path}</p> }, []);
}
beforeEach(() => {
	vi.clearAllMocks();
	useUiPluginRegistry.setState({
		overrides: {},
		contributions: {},
		crashCounts: {},
		loadNonces: {},
		cleanups: {},
	});
	useUiPluginsStore.setState({
		config: { enabled: true, plugins: {}, assignments: {} },
		plugins: [],
		loadErrors: {},
	});
	useKnowledgeStore.setState({ dialog: null, review: null, reviewQueue: [], notice: null, revision: 0 });
	useSessionsStore.setState({ cwd: "/project-one", activeSessionId: null });
	api.getKnowledgeOverview.mockResolvedValue({ binding: { vault: "/vault-one", revision: 1 } });
});
afterEach(cleanup);

describe("knowledge UI ownership boundary", () => {
	it("keeps only binding and navigation when no optional plugin is loaded", async () => {
		const openSettings = vi.spyOn(useSettingsStore.getState(), "openWith").mockImplementation(() => {});
		render(<KnowledgeView />);
		expect(await screen.findByText("/vault-one")).toBeTruthy();
		fireEvent.click(screen.getByText("knowledgeFallback.openFolder"));
		expect(api.openKnowledgeTarget).toHaveBeenCalledWith({ cwd: "/project-one", revision: 1 });
		fireEvent.click(screen.getByText("knowledgeFallback.managePlugins"));
		expect(openSettings).toHaveBeenCalledWith("uiPlugins");
		expect(screen.queryByRole("tablist")).toBeNull();
		openSettings.mockRestore();
	});
	it("unmounts the full page on disable and restores it when enabled", async () => {
		enable();
		render(<KnowledgeView />);
		expect(screen.getByText("plugin knowledge workspace")).toBeTruthy();
		act(() => useUiPluginRegistry.getState().removePlugin(manifest.name));
		expect(await screen.findByText("/vault-one")).toBeTruthy();
		act(() => enable());
		expect(screen.getByText("plugin knowledge workspace")).toBeTruthy();
		expect(screen.queryByTestId("knowledge-default-fallback")).toBeNull();
	});
	it("falls back after render failure and recovers after reload", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		enable(() => {
			throw new Error("plugin render failure");
		});
		render(<KnowledgeView />);
		expect(await screen.findByText("/vault-one")).toBeTruthy();
		act(() => {
			useUiPluginRegistry.getState().removePlugin(manifest.name);
			enable();
		});
		expect(screen.getByText("plugin knowledge workspace")).toBeTruthy();
		error.mockRestore();
	});
	it("does not show a previous workspace binding after a slow read resolves", async () => {
		let finish!: (value: unknown) => void;
		api.getKnowledgeOverview.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		render(<KnowledgeView />);
		api.getKnowledgeOverview.mockResolvedValue({ binding: { vault: "/vault-two", revision: 2 } });
		act(() => useSessionsStore.setState({ cwd: "/project-two" }));
		expect(await screen.findByText("/vault-two")).toBeTruthy();
		await act(async () => finish({ binding: { vault: "/vault-one", revision: 1 } }));
		expect(screen.queryByText("/vault-one")).toBeNull();
	});
	it("passes embedded note context and removes the reader on disable", async () => {
		enable();
		render(
			<KnowledgeSurface
				kind="note"
				cwd="/project-one"
				revision={7}
				path="notes/method.md"
				onClose={() => {}}
			/>,
		);
		expect(screen.getByText("notes/method.md")).toBeTruthy();
		act(() => useUiPluginRegistry.getState().removePlugin(manifest.name));
		await waitFor(() => expect(screen.queryByText("notes/method.md")).toBeNull());
		expect(await screen.findByText("/vault-one")).toBeTruthy();
	});
	it("keeps event subscription independent of plugin UI and cleans up", () => {
		const unsubscribe = vi.fn();
		api.onKnowledgeEvent.mockReturnValue(unsubscribe);
		const view = render(<KnowledgeUiRoot />);
		const receive = api.onKnowledgeEvent.mock.calls[0]![0];
		act(() =>
			receive({ kind: "notice", id: "n", sessionId: null, severity: "info", text: "A completed read" }),
		);
		expect(useKnowledgeStore.getState().notice?.text).toBe("A completed read");
		view.unmount();
		expect(unsubscribe).toHaveBeenCalledOnce();
	});
});
