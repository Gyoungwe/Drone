import { describe, expect, it } from "vitest";
import { AskGate } from "../src/session/ask-gate";

describe("AskGate", () => {
	it("respond returns before the ask promise resolves (IPC can reply first)", async () => {
		let requestId = "";
		const gate = new AskGate((request) => {
			requestId = request.id;
			return true;
		});
		gate.bindSession("session-deferred");
		let resolved = false;
		const pending = gate.ask({ toolCallId: "tc-deferred", questions: [] }).then((response) => {
			resolved = true;
			return response;
		});
		expect(gate.respond(requestId, { kind: "cancel" })).toBe(true);
		expect(resolved).toBe(false);
		await expect(pending).resolves.toEqual({ kind: "cancel" });
		expect(resolved).toBe(true);
	});
});
