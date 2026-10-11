import type { UIMessage } from "../../stores/transcript";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { MessageItem } from "./MessageItem";

vi.mock("../../i18n", () => ({ useT: () => (key: string) => key }));
vi.mock("../session/session-status", () => ({ useAgentActive: () => false }));
vi.mock("../../plugins/Slot", () => ({ Slot: () => null }));
vi.mock("../../plugins/slots", () => ({ UI_SLOTS: {} }));
vi.mock("./AssistantMessage", () => ({ AssistantMessage: () => <div data-testid="assistant-message" /> }));
vi.mock("./ErrorNote", () => ({ ErrorNote: () => null }));
vi.mock("./ImagePreview", () => ({ ImagePreviewOverlay: () => null, imageSrc: () => "" }));
vi.mock("./message-actions", () => ({ CopyButton: () => null, ForkButton: () => null }));
vi.mock("./SubagentRunCard", () => ({ SubagentRunCard: () => null }));
vi.mock("./SystemMessage", () => ({ SystemMessage: () => null }));
vi.mock("./TaskDecisionCard", () => ({ TaskDecisionCard: () => null }));
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
