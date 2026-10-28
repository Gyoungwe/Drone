import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { UIMessage } from "../../stores/transcript";
import { MessageItem } from "./MessageItem";

vi.mock("../../i18n", () => ({ useT: () => (key: string) => key }));
vi.mock("../session/session-status", () => ({ useAgentActive: () => false }));
vi.mock("../../plugins/Slot", () => ({
	Slot: ({ props, fallback: Fallback }: any) => <Fallback {...props} />,
}));
vi.mock("../../plugins/slots", () => ({ UI_SLOTS: {} }));
vi.mock("./AssistantMessage", () => ({ AssistantMessage: () => <div data-testid="assistant-message" /> }));
vi.mock("./ErrorNote", () => ({ ErrorNote: () => null }));
vi.mock("./ImagePreview", () => ({ ImagePreviewOverlay: () => null, imageSrc: () => "" }));
vi.mock("./message-actions", () => ({ CopyButton: () => null, ForkButton: () => null }));
vi.mock("./SubagentRunCard", () => ({ SubagentRunCard: () => null }));
vi.mock("./SystemMessage", () => ({ SystemMessage: () => null }));
vi.mock("./UserMessage", () => ({ UserMessage: () => null }));
vi.stubGlobal("React", React);

it("keeps route metadata out of chat when the turn has no user-facing text", () => {
	const message = {
		kind: "assistant",
		id: "route-only",
		text: "",
		thinking: "",
		tools: [],
		route: { utterance: "检查当前任务", intake: "status" },
	} as unknown as UIMessage;
	expect(renderToStaticMarkup(createElement(MessageItem, { message }))).toBe("");
});

it("does not leave an empty host-status placeholder without a UI contribution", () => {
	const message: UIMessage = {
		kind: "assistant",
		id: "host",
		timestamp: 1,
		text: "",
		thinking: "",
		tools: [],
		hostStatus: true,
	};
	expect(renderToStaticMarkup(createElement(MessageItem, { message }))).toBe("");
	expect(
		renderToStaticMarkup(
			createElement(MessageItem, { message: { ...message, text: "Ordinary status body" } }),
		),
	).toContain('data-testid="assistant-message"');
});
