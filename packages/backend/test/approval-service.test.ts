import { describe, expect, it } from "vitest";
import { ApprovalService } from "../src/services/approvals";

describe("ApprovalService", () => {
	it("owns a session gate and preserves request/resolution callbacks", async () => {
		const requests: Array<{ id: string; title: string }> = [];
		const resolved: string[] = [];
		const decisions: string[] = [];
		const service = new ApprovalService({
			onDecision: (decision) => decisions.push(`${decision.answer}:${decision.title}`),
		});
		service.onRequest((request) => requests.push({ id: request.id, title: request.title }));
		service.onResolved((result) => resolved.push(`${result.sessionId}:${result.requestId}`));

		const gate = service.createGate();
		gate.bindSession("session-1");
		service.register("session-1", gate);
		const answer = gate.confirm("Write outside project", "Needs approval", {
			kind: "path",
			suggestDir: "/tmp/project",
		});

		expect(requests).toHaveLength(1);
		expect(service.listPending()).toHaveLength(1);
		service.respond(requests[0].id, "allowAlways");

		expect(await answer).toBe(true);
		expect(service.listPending()).toEqual([]);
		expect(resolved).toEqual([`session-1:${requests[0].id}`]);
		expect(decisions).toEqual(["allowAlways:Write outside project"]);
		service.dispose();
	});

	it("allowRun resolves queued requests and removes the session on dispose", async () => {
		const service = new ApprovalService();
		const gate = service.createGate();
		gate.bindSession("session-2");
		service.register("session-2", gate);
		const first = gate.confirm("first", "one");
		const second = gate.confirm("second", "two");
		const requestId = service.listPending()[0].id;

		expect(service.respond(requestId, "allowRun")).toBe("session-2");
		expect(await first).toBe(true);
		expect(await second).toBe(true);
		service.remove("session-2");
		expect(service.listPending()).toEqual([]);
	});
});
