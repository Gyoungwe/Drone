// @vitest-environment node

import { emptyTranscript } from "@drone/shared";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = {
	transcripts: { s1: emptyTranscript() },
	views: {},
	truncated: {},
	pendingPerms: {},
	streamHealing: {},
	seeded: true,
	loadTranscript: vi.fn(),
};

vi.mock("../store", () => ({
	useLanStore: (selector: (value: typeof state) => unknown) => selector(state),
}));

import { ChatView } from "./ChatView";

(globalThis as { React?: typeof React }).React = React;

describe("LAN observer DOM", () => {
	it("has no textarea, send button, or other write controls", () => {
		const html = renderToStaticMarkup(<ChatView sessionId="s1" isDark={false} />);
		expect(html).not.toContain("<textarea");
		expect(html).not.toMatch(/type=["']submit["']/i);
		expect(html).not.toContain("发送");
		expect(html).not.toContain("Send");
	});
});
