// @vitest-environment jsdom
import type { SessionEventEnvelope, UiPluginsEventPayload } from "@drone/shared";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Toaster } from "../components/Toaster";
import { useI18nStore } from "../i18n";
import { useCatalogStore } from "../stores/catalog";
import { useSessionsStore } from "../stores/sessions";
import { useToastsStore } from "../stores/toasts";
import { useTranscriptStore } from "../stores/transcript";
import { useSessionEventBridge } from "./use-session-event-bridge";

const onTrustRequest = () => {};
function App() {
	useSessionEventBridge({ onTrustRequest });
	return createElement(Toaster);
}
beforeEach(() => {
	vi.stubGlobal("React", React);
	vi.useFakeTimers();
	useToastsStore.setState({ toasts: [] });
	useTranscriptStore.setState({ bySession: {} });
	useI18nStore.setState({ language: "en" });
});
afterEach(() => {
	cleanup();
	vi.runOnlyPendingTimers();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	useSessionsStore.setState({ activeSessionId: null });
	useCatalogStore.setState({ lifecycleReceipts: {}, configuredPackages: null });
});

it("rereads active resources for old config events and stores the scoped package outcome", async () => {
	const listeners = new Set<(event: UiPluginsEventPayload) => void>();
	const getLoadedResources = vi.fn(async () => ({
		skills: [],
		skillDiagnostics: [],
		extensions: [],
		extensionErrors: [],
	}));
	const receipt = {
		operation: "update",
		source: "npm:fixture",
		packageName: "fixture",
		scope: "project",
		status: "failed",
		effect: "current-session",
		events: [{ at: 1, type: "rolled_back" }],
	} as const;
	Object.defineProperty(window, "pi", {
		configurable: true,
		value: {
			onEvent: () => vi.fn(),
			onPermissionRequest: () => vi.fn(),
			onPermissionResolved: () => vi.fn(),
			onTrustRequest: () => vi.fn(),
			onUiPluginsEvent: (listener: (event: UiPluginsEventPayload) => void) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			getLoadedResources,
			listConfiguredPackages: vi.fn(async () => [{ source: "npm:fixture@1.0.0", scope: "project" }]),
		},
	});
	useSessionsStore.setState({ activeSessionId: "active" });
	const view = render(createElement(App));
	await act(async () => {
		for (const listener of listeners) listener({ kind: "config" });
		for (const listener of listeners)
			listener({ kind: "config", receipt: { ...receipt, events: [...receipt.events] } });
	});
	expect(getLoadedResources.mock.calls).toEqual([["active"], ["active"]]);
	expect(useCatalogStore.getState().lifecycleReceipts["project:fixture"]).toEqual(receipt);
	expect(useCatalogStore.getState().configuredPackages).toEqual([
		{ source: "npm:fixture@1.0.0", scope: "project" },
	]);
	view.unmount();
	expect(listeners.size).toBe(0);
});
it("renders generic session notifications as localized severity toasts and removes its IPC subscription", () => {
	const listeners = new Set<(event: SessionEventEnvelope) => void>();
	const offEvent = vi.fn();
	Object.defineProperty(window, "pi", {
		configurable: true,
		value: {
			onEvent: (listener: (event: SessionEventEnvelope) => void) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
					offEvent();
				};
			},
			onPermissionRequest: () => () => {},
			onPermissionResolved: () => () => {},
			onTrustRequest: () => () => {},
		},
	});
	const view = render(createElement(App));
	act(() => {
		for (const listener of listeners) listener({ sessionId: "parent", event: { type: "agent_start" } });
	});
	const parentTranscript = useTranscriptStore.getState().bySession;
	act(() => {
		for (const severity of ["info", "warning", "error"] as const)
			for (const listener of listeners)
				listener({
					sessionId: "child",
					event: { type: "extension_notification", severity, message: `Extension ${severity}` },
				});
	});
	expect(screen.getAllByText("Extension notification")).toHaveLength(3);
	expect(screen.getByRole("alert").textContent).toContain("Extension error");
	expect(useToastsStore.getState().toasts.map((toast) => toast.severity)).toEqual([
		"info",
		"warning",
		"error",
	]);
	expect(useTranscriptStore.getState().bySession).toBe(parentTranscript);
	expect(useTranscriptStore.getState().bySession.child).toBeUndefined();
	act(() => useI18nStore.setState({ language: "zh" }));
	expect(screen.getAllByText("扩展通知")).toHaveLength(3);
	view.unmount();
	expect(offEvent).toHaveBeenCalledOnce();
	expect(listeners.size).toBe(0);
	act(() => vi.advanceTimersByTime(4500));
	expect(useToastsStore.getState().toasts).toEqual([]);
});
