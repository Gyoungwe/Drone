// @vitest-environment jsdom
import type { ChatMessageProps } from "@gyoungwe/plugin-api/ui";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useUiPluginRegistry } from "../../plugins/registry";
import { UI_SLOTS } from "../../plugins/slots";
import { useSessionsStore } from "../../stores/sessions";
import { useTranscriptStore } from "../../stores/transcript";
import { useUiPluginsStore } from "../../stores/ui-plugins";
import { MessageItem } from "./MessageItem";

vi.stubGlobal("React", React);
vi.mock("./AssistantMessage", () => ({ AssistantMessage: ({ text }: { text: string }) => <p>{text}</p> }));
vi.mock("./message-actions", () => ({ CopyButton: () => null, ForkButton: () => null }));
const message = {
	kind: "assistant" as const,
	id: "row",
	text: "Default safe body",
	thinking: "",
	tools: [],
	timestamp: 1,
};
const manifest = {
	name: "generic-row",
	droneUi: 1 as const,
	main: "index.tsx",
	slots: { [UI_SLOTS.Message]: "Row" },
};
beforeEach(() => {
	useUiPluginRegistry.setState({
		overrides: {},
		contributions: {},
		loadNonces: {},
		cleanups: {},
		crashCounts: {},
	});
	useUiPluginsStore.setState({ config: { enabled: true, plugins: {}, assignments: {} } });
	useSessionsStore.setState({
		activeSessionId: "other",
		sessions: [
			{ sessionId: "shown", cwd: "/shown", readOnly: true, active: true, messageCount: 1, createdAt: 1 },
			{ sessionId: "other", cwd: "/other", active: true, messageCount: 1, createdAt: 1 },
		],
	});
	useTranscriptStore.setState({ bySession: {} });
	useTranscriptStore.getState().loadHistory("shown", [message]);
	useTranscriptStore.getState().markAgentActive("shown", true);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

it("renders the host message without a plugin and restores it on plugin removal or disable", () => {
	const view = render(<MessageItem message={message} sessionId="shown" />);
	expect(screen.getByText(message.text)).toBeTruthy();
	const seen: ChatMessageProps[] = [];
	function Row(props: ChatMessageProps) {
		seen.push(props);
		return <section>Plugin row{props.renderDefault()}</section>;
	}
	act(() => {
		useUiPluginRegistry.getState().applyPlugin(manifest, { Row }, [UI_SLOTS.Message]);
	});
	expect(screen.getByText("Plugin row")).toBeTruthy();
	expect(screen.getAllByText(message.text)).toHaveLength(1);
	expect(seen.at(-1)).toMatchObject({ sessionId: "shown", readOnly: true, agentActive: true, message });
	expect(Object.hasOwn(seen.at(-1)!, "showTaskCard")).toBe(false);
	act(() => {
		useUiPluginRegistry.getState().removePlugin("generic-row");
	});
	expect(screen.queryByText("Plugin row")).toBeNull();
	expect(screen.getByText(message.text)).toBeTruthy();
	act(() => {
		useUiPluginRegistry.getState().applyPlugin(manifest, { Row }, [UI_SLOTS.Message]);
	});
	act(() => {
		useUiPluginsStore.setState({ config: { enabled: false, plugins: {}, assignments: {} } });
	});
	expect(screen.queryByText("Plugin row")).toBeNull();
	expect(screen.getByText(message.text)).toBeTruthy();
	view.unmount();
});

it("falls back to the host message when a plugin throws", () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	function Row(): never {
		throw new Error("Rendering failed");
	}
	useUiPluginRegistry.getState().applyPlugin(manifest, { Row }, [UI_SLOTS.Message]);
	render(<MessageItem message={message} sessionId="shown" />);
	expect(screen.getByText(message.text)).toBeTruthy();
	expect(useUiPluginRegistry.getState().crashCounts["generic-row"]).toBe(1);
});
