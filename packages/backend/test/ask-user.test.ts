import { describe, expect, it } from "vitest";
import { AskGate } from "../src/session/ask-gate";
import { PiBackend } from "../src/pi-backend";
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


	it("accepts a custom-only single answer without an option selection", async () => {
		const tool = makeAskUserTool({ ask: async () => ({ kind: "answer", answers: { source: { values: [], customText: "/Users/me/Research Vault" } } }) });
		const result = await tool.execute("tc-custom", params, undefined, () => {}, {} as never);
		expect(result.details).toMatchObject({
			cancelled: false,
			answers: { source: { values: ["/Users/me/Research Vault"], labels: ["/Users/me/Research Vault"], indices: [], customText: "/Users/me/Research Vault" } },
		});
	});

	it("fails closed as a cancellation when the ask UI returns no response", async () => {
		const tool = makeAskUserTool({ ask: async () => undefined });
		const result = await tool.execute("tc-missing", params, undefined, () => {}, {} as never);
		expect(result.details).toMatchObject({ cancelled: true, answers: {} });
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


	it("routes responses across multiple live ask gates for the same session", async () => {
		let firstId = "";
		let secondId = "";
		const first = new AskGate((request) => { firstId = request.id; return true; });
		const second = new AskGate((request) => { secondId = request.id; return true; });
		first.bindSession("same-session");
		second.bindSession("same-session");
		const firstPending = first.ask({ toolCallId: "tc-a", questions: [] });
		const secondPending = second.ask({ toolCallId: "tc-b", questions: [] });
		const backend = new PiBackend({ projectTrust: false, permissionGates: false });
		const gates = (backend as unknown as { askGates: Map<string, Set<AskGate>> }).askGates;
		gates.set("same-session", new Set([first, second]));
		expect(backend.respondAsk(firstId, { kind: "answer", answers: {} })).toBe(true);
		expect(backend.respondAsk(secondId, { kind: "cancel" })).toBe(true);
		expect(backend.respondAsk("stale-request", { kind: "cancel" })).toBe(false);
		await expect(firstPending).resolves.toMatchObject({ kind: "answer" });
		await expect(secondPending).resolves.toMatchObject({ kind: "cancel" });
	});

	it("cancels immediately when no desktop listener exists", async () => {
		const gate = new AskGate(() => false);
		gate.bindSession("session-2");
		await expect(gate.ask({ toolCallId: "tc-3", questions: [] })).resolves.toEqual({ kind: "cancel" });
	});
});
