// @vitest-environment jsdom
import type { SessionEventEnvelope } from "@drone/shared";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Toaster } from "../components/Toaster";
import { useI18nStore } from "../i18n";
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
		for (const severity of ["info", "warning", "error"] as const)
			for (const listener of listeners)
				listener({
					sessionId: "a",
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
	expect(useTranscriptStore.getState().bySession).toEqual({});
	act(() => useI18nStore.setState({ language: "zh" }));
	expect(screen.getAllByText("扩展通知")).toHaveLength(3);
	view.unmount();
	expect(offEvent).toHaveBeenCalledOnce();
	expect(listeners.size).toBe(0);
	act(() => vi.advanceTimersByTime(4500));
	expect(useToastsStore.getState().toasts).toEqual([]);
});
