import { describe, expect, it, vi } from "vitest";
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
		const resolved: string[] = [];
		service.onResolved((result) => resolved.push(result.requestId));
		const gate = service.createGate();
		gate.bindSession("session-2");
		service.register("session-2", gate);
		const first = gate.confirm("first", "one");
		const second = gate.confirm("second", "two");
		const requestIds = service.listPending().map((request) => request.id);
		const requestId = requestIds[0];

		expect(service.respond(requestId, "allowRun")).toBe("session-2");
		expect(await first).toBe(true);
		expect(await second).toBe(true);
		expect(resolved).toEqual(requestIds);
		service.remove("session-2");
		expect(service.listPending()).toEqual([]);
	});
});

it("cancels only its signaled approval, clears the real UI receipt, and never upgrades a canceled decision", async () => {
	const decisions = vi.fn();
	const service = new ApprovalService({ onDecision: decisions });
	const gate = service.createGate();
	gate.bindSession("cancel-session");
	service.register("cancel-session", gate);
	const resolved = [];
	service.onResolved((result) => resolved.push(result));
	const one = new AbortController(),
		two = new AbortController();
	const cleanupOne = vi.spyOn(one.signal, "removeEventListener"),
		cleanupTwo = vi.spyOn(two.signal, "removeEventListener");
	const first = gate.confirm("First", "Cancel this", undefined, one.signal);
	const second = gate.confirm("Second", "Keep this", undefined, two.signal);
	const [a, b] = service.listPending();
	one.abort();
	expect(await first).toBe(false);
	expect(service.listPending()).toEqual([b]);
	expect(resolved).toEqual([{ sessionId: "cancel-session", requestId: a.id, answered: false }]);
	expect(cleanupOne).toHaveBeenCalledOnce();
	expect(service.respond(a.id, "allowAlways")).toBeUndefined();
	expect(decisions).not.toHaveBeenCalled();
	service.respond(b.id, "allow");
	expect(await second).toBe(true);
	expect(cleanupTwo).toHaveBeenCalledOnce();
	two.abort();
	expect(resolved).toHaveLength(2);
	const alreadyAborted = new AbortController();
	alreadyAborted.abort();
	expect(await gate.confirm("No dialog", "Already aborted", undefined, alreadyAborted.signal)).toBe(false);
	expect(service.listPending()).toEqual([]);
	const pendingSignal = new AbortController();
	const cleanupPending = vi.spyOn(pendingSignal.signal, "removeEventListener");
	const pending = gate.confirm("Dispose", "Cleanup", undefined, pendingSignal.signal);
	service.dispose();
	expect(await pending).toBe(false);
	expect(cleanupPending).toHaveBeenCalledOnce();
});

it("reports sanitized observer failures once and still publishes later request/resolution observers", async () => {
	const output: string[] = [];
	const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
		output.push(String(chunk));
		return true;
	});
	const service = new ApprovalService();
	try {
		service.onRequest(() => {
			throw new Error("Bearer synthetic-request-secret https://example.invalid/?token=request-secret");
		});
		service.onResolved(() => {
			throw new Error("Bearer synthetic-resolution-secret https://example.invalid/?token=resolution-secret");
		});
		const requestObserver = vi.fn(),
			resolvedObserver = vi.fn();
		service.onRequest(requestObserver);
		service.onResolved(resolvedObserver);
		const gate = service.createGate();
		gate.bindSession("observer-session");
		service.register("observer-session", gate);
		const signal = new AbortController();
		const pending = gate.confirm("Synthetic approval", "Message", undefined, signal.signal);
		expect(requestObserver).toHaveBeenCalledOnce();
		signal.abort();
		expect(await pending).toBe(false);
		expect(resolvedObserver).toHaveBeenCalledOnce();
		expect(output).toHaveLength(2);
		expect(output[0]).toContain("permission request observer failed");
		expect(output[1]).toContain("permission resolution observer failed");
		expect(output.join("")).not.toMatch(/synthetic-request-secret|synthetic-resolution-secret|token=/);
	} finally {
		service.dispose();
		stdout.mockRestore();
	}
});
