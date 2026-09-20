import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const pi = vi.hoisted(() => ({ prompt: vi.fn(), dispatchSubagents: vi.fn() }));
vi.mock("../../api", () => ({ getPi: () => pi }));
vi.mock("../../i18n", () => ({
	useT: () => (key: string, params?: Record<string, unknown>) =>
		params ? `${key}:${JSON.stringify(params)}` : key,
}));

import { useSessionsStore } from "../../stores/sessions";
import { useSubagentsStore } from "../../stores/subagents";
import { useTranscriptStore } from "../../stores/transcript";
import { useComposerSend } from "./use-composer-send";

const setters = {
	setText: vi.fn(),
	setImages: vi.fn(),
	setAttachments: vi.fn(),
	setQuotes: vi.fn(),
	setSlashCommand: vi.fn(),
	setSubagent: vi.fn(),
};

function composer(text = "hello", overrides: Partial<Parameters<typeof useComposerSend>[0]> = {}) {
	let send: ReturnType<typeof useComposerSend> | undefined;
	function Probe() {
		send = useComposerSend({
			activeSessionId: "s",
			text,
			images: [],
			attachments: [],
			quotes: [],
			slashCommand: null,
			subagent: null,
			followUpQueue: [],
			compacting: false,
			imagesSupported: true,
			...setters,
			...overrides,
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
	useSubagentsStore.setState({ runsBySession: {} });
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

// ---- @ 子智能体胶囊：Enter 走直接派发，不经主模型 ----
it("a subagent chip routes Enter to dispatchSubagents instead of prompt (single task, followUp on)", async () => {
	pi.dispatchSubagents.mockResolvedValue({ dispatchId: "d1", runs: [] });
	await composer(" 列出权限规则字段 ", {
		subagent: "scout",
		attachments: ["docs/a.md"],
		quotes: ["上文"],
	}).handleSend();
	expect(pi.prompt).not.toHaveBeenCalled();
	expect(pi.dispatchSubagents).toHaveBeenCalledWith("s", {
		tasks: [{ agent: "scout", task: "> 上文\n\n@docs/a.md\n列出权限规则字段" }],
		followUp: true,
	});
	// 草稿整份清空（胶囊 / 引用 / 文件 / 正文）
	expect(setters.setSubagent).toHaveBeenCalledWith(null);
	expect(setters.setText).toHaveBeenCalledWith("");
	expect(setters.setAttachments).toHaveBeenCalledWith([]);
	expect(setters.setQuotes).toHaveBeenCalledWith([]);
});
it("a subagent chip without a task neither dispatches nor prompts", async () => {
	await composer("   ", { subagent: "scout" }).handleSend();
	expect(pi.dispatchSubagents).not.toHaveBeenCalled();
	expect(pi.prompt).not.toHaveBeenCalled();
	expect(setters.setSubagent).not.toHaveBeenCalled();
});
it("images cannot ride along with a subagent dispatch", async () => {
	await composer("任务", { subagent: "scout", images: [{ data: "x", mimeType: "image/png" }] }).handleSend();
	expect(pi.dispatchSubagents).not.toHaveBeenCalled();
	expect(pi.prompt).not.toHaveBeenCalled();
});
it("a rejected dispatch restores the chip and the draft", async () => {
	pi.dispatchSubagents.mockRejectedValue(new Error("bash is denied"));
	await composer("任务", { subagent: "scout", attachments: ["a.md"], quotes: ["q"] }).handleSend();
	expect(setters.setSubagent).toHaveBeenLastCalledWith("scout");
	expect(setters.setText).toHaveBeenLastCalledWith("任务");
	expect(setters.setAttachments).toHaveBeenLastCalledWith(["a.md"]);
	expect(setters.setQuotes).toHaveBeenLastCalledWith(["q"]);
	expect(pi.prompt).not.toHaveBeenCalled();
});
it("a subagent chip on a draft session does not dispatch", async () => {
	await composer("任务", { subagent: "scout", activeSessionId: "draft:1" }).handleSend();
	expect(pi.dispatchSubagents).not.toHaveBeenCalled();
	expect(pi.prompt).not.toHaveBeenCalled();
});
