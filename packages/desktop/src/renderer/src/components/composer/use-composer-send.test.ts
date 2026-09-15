import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const pi = vi.hoisted(() => ({ prompt: vi.fn() }));
vi.mock("../../api", () => ({ getPi: () => pi }));
vi.mock("../../i18n", () => ({ useT: () => (key: string) => key }));

import { useSessionsStore } from "../../stores/sessions";
import { useTranscriptStore } from "../../stores/transcript";
import { useComposerSend } from "./use-composer-send";

function composer(text = "hello") {
	let send: ReturnType<typeof useComposerSend> | undefined;
	function Probe() {
		send = useComposerSend({
			activeSessionId: "s",
			text,
			images: [],
			attachments: [],
			quotes: [],
			slashCommand: null,
			followUpQueue: [],
			compacting: false,
			imagesSupported: true,
			setText: vi.fn(),
			setImages: vi.fn(),
			setAttachments: vi.fn(),
			setQuotes: vi.fn(),
			setSlashCommand: vi.fn(),
		});
		return null;
	}
	renderToString(createElement(Probe));
	if (!send) throw new Error("Composer not rendered");
	return send;
}
beforeEach(() => {
	vi.clearAllMocks();
	useTranscriptStore.setState({ bySession: {} });
	useTranscriptStore.getState().resetSession("s");
	useSessionsStore.setState({ activeSessionId: "s" });
});
it("a fast SDK run cannot be restarted by a late prompt acknowledgement", async () => {
	pi.prompt.mockImplementation(async () => {
		useTranscriptStore.getState().applyEvent("s", { type: "agent_start" });
		useTranscriptStore.getState().applyEvent("s", { type: "agent_settled" });
		return { kind: "agent" };
	});
	await composer().handleSend();
	expect(useTranscriptStore.getState().bySession.s?.agentActive).toBe(false);
});
it("a queued-send failure cannot resurrect an already settled run", async () => {
	pi.prompt.mockImplementation(async () => {
		useTranscriptStore.getState().applyEvent("s", { type: "agent_settled" });
		throw new Error("queue rejected");
	});
	await composer().handleSend();
	expect(useTranscriptStore.getState().bySession.s?.agentActive).toBe(false);
});
it("repeated UI-only commands never synthesize an agent run", async () => {
	pi.prompt.mockResolvedValue({ kind: "command" });
	for (let i = 0; i < 3; i++) await composer("/obsidian-review").handleSend();
	expect(pi.prompt).toHaveBeenCalledTimes(3);
	expect(useTranscriptStore.getState().bySession.s?.agentActive).toBe(false);
});
it("a setup command receipt does not clear its subsequent SDK handoff", async () => {
	pi.prompt.mockImplementation(async () => {
		useTranscriptStore.getState().applyEvent("s", { type: "agent_start" });
		return { kind: "command" };
	});
	await composer("/obsidian-setup").handleSend();
	expect(useTranscriptStore.getState().bySession.s?.agentActive).toBe(true);
});
