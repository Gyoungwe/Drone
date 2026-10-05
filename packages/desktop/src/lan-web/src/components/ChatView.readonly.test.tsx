// @vitest-environment node

import { emptyTranscript } from "@drone/shared";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = {
	remoteControl: false,
	transcripts: { s1: emptyTranscript() },
	views: { s1: { agentActive: false, pendingPermission: undefined } },
	list: [{ sessionId: "s1", name: "Session", readOnly: false }],
	truncated: {},
	pendingPerms: {
		s1: [{ id: "p1", sessionId: "s1", title: "Run command", message: "bash", kind: "command" as const }],
	},
	streamHealing: {},
	seeded: true,
	loadTranscript: vi.fn(),
	respondPermission: vi.fn(async () => null),
	sendPrompt: vi.fn(async () => null),
	abortSession: vi.fn(async () => null),
};

vi.mock("../store", () => ({
	useLanStore: (selector: (value: typeof state) => unknown) => selector(state),
}));

import { ChatView } from "./ChatView";
import { Composer } from "./Composer";

(globalThis as { React?: typeof React }).React = React;

describe("LAN observer DOM", () => {
	it("remote control off is read-only", () => {
		state.remoteControl = false;
		const html = renderToStaticMarkup(<ChatView sessionId="s1" isDark={false} />);
		expect(html).not.toContain("<textarea");
		expect(html).not.toMatch(/type=["']submit["']/i);
		expect(html).not.toContain("发送");
		expect(html).not.toContain("Send");
		expect(html).not.toContain("perm-btns");
	});

	it("remote control on restores composer and permission approval controls", () => {
		state.remoteControl = true;
		const html = renderToStaticMarkup(
			<ChatView sessionId="s1" isDark={false} onRespond={async () => true} />,
		);
		const composer = renderToStaticMarkup(<Composer sessionId="s1" />);
		expect(html).toContain("perm-btns");
		expect(html).toContain("Allow once");
		expect(composer).toContain("<textarea");
		expect(composer).toContain('aria-label="Send"');
	});
});
