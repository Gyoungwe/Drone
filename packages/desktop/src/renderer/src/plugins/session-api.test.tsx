// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTranscriptStore } from "../stores/transcript";
import { sessionUiPort, useSessionMessages } from "./session-api";

const { prompt, command } = vi.hoisted(() => ({ prompt: vi.fn(), command: vi.fn() }));
vi.mock("../api", () => ({ getPi: () => ({ prompt, command }) }));
beforeEach(() => {
	prompt.mockReset();
	useTranscriptStore.setState({ bySession: {} });
});
afterEach(cleanup);

it("uses the existing prompt transport, preserves its receipt and propagates authorization errors", async () => {
	const receipt = { kind: "command" as const, clientMessageId: "sent" };
	prompt.mockResolvedValueOnce(receipt);
	expect(await sessionUiPort.prompt("session-a", "/some-plugin-command")).toBe(receipt);
	expect(prompt).toHaveBeenCalledExactlyOnceWith("session-a", "/some-plugin-command");
	prompt.mockRejectedValueOnce(new Error("Session is read-only"));
	await expect(sessionUiPort.prompt("session-b", "continue")).rejects.toThrow("Session is read-only");
});

it("keeps empty and selected-session message references stable and switches subscriptions with the session", () => {
	const messages = [{ kind: "system" as const, id: "a", text: "safe renderer projection", timestamp: 1 }];
	useTranscriptStore.getState().loadHistory("session-a", messages);
	const selected = useTranscriptStore.getState().bySession["session-a"]!.messages;
	const { result, rerender } = renderHook(
		({ sessionId }: { sessionId: string | null }) => useSessionMessages(sessionId),
		{ initialProps: { sessionId: null as string | null } },
	);
	const empty = result.current;
	rerender({ sessionId: null });
	expect(result.current).toBe(empty);
	rerender({ sessionId: "missing" });
	expect(result.current).toBe(empty);
	rerender({ sessionId: "session-a" });
	expect(result.current).toEqual(messages);
	expect(result.current).toBe(selected);
	act(() => useTranscriptStore.getState().loadHistory("session-b", []));
	expect(result.current).toBe(selected);
	rerender({ sessionId: "session-b" });
	expect(result.current).toBe(useTranscriptStore.getState().bySession["session-b"]!.messages);
	rerender({ sessionId: null });
	expect(result.current).toBe(empty);
});

it("uses explicit command transport and preserves unavailability errors without prompting", async () => {
	command.mockRejectedValueOnce(new Error("Extension command unavailable: removed"));
	await expect(sessionUiPort.command("session-b", "removed", "input")).rejects.toThrow(
		"Extension command unavailable",
	);
	expect(command).toHaveBeenCalledExactlyOnceWith("session-b", "removed", "input");
	expect(prompt).not.toHaveBeenCalled();
});
