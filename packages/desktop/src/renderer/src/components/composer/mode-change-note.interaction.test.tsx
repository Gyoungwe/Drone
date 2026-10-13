// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useAgentModeStore } from "../../stores/agent-mode";
import { useSessionsStore } from "../../stores/sessions";
import { RunConfigPicker } from "./RunConfigPicker";

vi.mock("../../i18n", () => ({
	useT: () => (key: string) => key,
}));
vi.stubGlobal("React", React);
afterEach(cleanup);

it("keeps the mode-switch notice visible with the menu closed until dismissed", () => {
	act(() => {
		useSessionsStore.setState({ activeSessionId: "s1" } as never);
		useAgentModeStore.setState({
			lastChange: { sessionId: "s1", mode: "single", added: [], removed: ["subagent"] },
		} as never);
	});
	render(<RunConfigPicker />);
	const note = screen.getByTestId("mode-change-note");
	expect(note.getAttribute("title")).toContain("−subagent");
	fireEvent.click(note.querySelector("button") as HTMLButtonElement);
	expect(screen.queryByTestId("mode-change-note")).toBeNull();
});
