// @vitest-environment jsdom
import type { SessionEventEnvelope } from "@drone/shared";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useSessionEventBridge } from "../../hooks/use-session-event-bridge";
import { useI18nStore } from "../../i18n";
import { useSessionsStore } from "../../stores/sessions";
import { useTranscriptStore } from "../../stores/transcript";
import { ComposerStatusBar } from "./ComposerStatusBar";

const onTrustRequest = () => {};
function App() {
	useSessionEventBridge({ onTrustRequest });
	return <ComposerStatusBar />;
}
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	useTranscriptStore.setState({ bySession: {} });
});
it("consumes transient keyed statuses for the selected session, replaces and clears them, and removes the transport listener", async () => {
	vi.stubGlobal("React", React);
	useI18nStore.setState({ language: "en" });
	useSessionsStore.setState({ cwd: "/project", activeSessionId: "parent" });
	useTranscriptStore.setState({ bySession: {} });
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
			memoryGetStatus: async () => ({ enabled: false, lastLoaded: 0 }),
		},
	});
	const send = (sessionId: string, key: string | null, text: string | null) =>
		act(() => {
			for (const listener of listeners)
				listener({ sessionId, event: { type: "extension_status", key, text } });
		});
	const view = render(<App />);
	await act(async () => {});
	send("child", "mcp", "Child connected");
	expect(screen.queryByText("Child connected")).toBeNull();
	send("parent", "mcp", "MCP connecting");
	expect(screen.getByRole("status", { name: "Extension status" }).textContent).toBe("MCP connecting");
	send("parent", "mcp", "MCP connected");
	expect(screen.queryByText("MCP connecting")).toBeNull();
	expect(screen.getByText("MCP connected")).toBeTruthy();
	send("parent", "research", "Research active");
	expect(screen.getAllByRole("status", { name: "Extension status" })).toHaveLength(2);
	act(() => useTranscriptStore.getState().loadHistory("parent", []));
	expect(screen.getByText("Research active")).toBeTruthy();
	send("parent", "mcp", null);
	expect(screen.queryByText("MCP connected")).toBeNull();
	act(() => useSessionsStore.setState({ activeSessionId: "child" }));
	expect(screen.getByText("Child connected")).toBeTruthy();
	expect(screen.queryByText("Research active")).toBeNull();
	send("child", null, null);
	expect(screen.queryByRole("status", { name: "Extension status" })).toBeNull();
	expect(useTranscriptStore.getState().bySession.child!.messages).toEqual([]);
	view.unmount();
	expect(offEvent).toHaveBeenCalledOnce();
	expect(listeners.size).toBe(0);
});
