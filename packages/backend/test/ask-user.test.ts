import { describe, expect, it } from "vitest";
import { AskGate } from "../src/session/ask-gate";
import { makeAskUserTool } from "../src/tools/ask-user";

const params = {
	title: "Research choice",
	questions: [{ id: "source", prompt: "Where should I search first?", type: "single" as const, options: [
		{ value: "zotero", label: "Zotero", recommended: true },
		{ value: "web", label: "Web" },
	] }],
};

describe("desktop ask_user", () => {
	it("maps a desktop answer to the pi-ask compatible result contract", async () => {
		const tool = makeAskUserTool({ ask: async () => ({ kind: "answer", answers: { source: { values: ["zotero"], customText: "local first" } } }) });
		const result = await tool.execute("tc-1", params, undefined, () => {}, {} as never);
		expect(result.details).toMatchObject({ cancelled: false, mode: "submit", answers: { source: { values: ["zotero", "local first"], labels: ["Zotero", "local first"], indices: [1], customText: "local first" } } });
	});

	it("gate correlates a pending request and response", async () => {
		let requestId = "";
		const gate = new AskGate((request) => { requestId = request.id; return true; });
		gate.bindSession("session-1");
		const pending = gate.ask({ toolCallId: "tc-2", questions: [{ id: "q", label: "Q1", prompt: "Pick", type: "multi", required: false, options: [{ value: "a", label: "A" }] }] });
		expect(requestId).not.toBe("");
		expect(gate.respond(requestId, { kind: "answer", answers: { q: { values: ["a"] } } })).toBe(true);
		await expect(pending).resolves.toMatchObject({ kind: "answer" });
	});

	it("cancels immediately when no desktop listener exists", async () => {
		const gate = new AskGate(() => false);
		gate.bindSession("session-2");
		await expect(gate.ask({ toolCallId: "tc-3", questions: [] })).resolves.toEqual({ kind: "cancel" });
	});
});
