import type { SessionEvent } from "@drone/shared";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PiBackend } from "../src/pi-backend";
import type { SessionRegistry } from "../src/session/registry";

const backends: PiBackend[] = [];
function harness() {
	const backend = new PiBackend({ defaultCwd: "/tmp", projectTrust: false, permissionGates: false });
	backends.push(backend);
	const abort = vi.fn(async () => {});
	const internal = backend as unknown as {
		registry: SessionRegistry;
		emitEvent: (sid: string, event: SessionEvent) => void;
	};
	internal.registry.add({
		session: { sessionId: "s1", dispose: () => {}, abort } as unknown as AgentSession,
		unsubscribe: () => {},
		cwd: "/tmp",
	});
	const received: Array<{ type: string; status?: string }> = [];
	backend.onEvent((_sid, event) => received.push(event));
	return {
		backend,
		abort,
		received,
		emit: (event: unknown) => internal.emitEvent("s1", event as SessionEvent),
	};
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	for (const backend of backends.splice(0)) backend.dispose();
	vi.useRealTimers();
	vi.unstubAllEnvs();
});
describe("model response silence at the backend delivery boundary", () => {
	it("warns after 60 seconds without provider events and aborts once after five minutes", async () => {
		const h = harness();
		h.emit({ type: "turn_start" });
		h.emit({ type: "message_start", message: { role: "user", content: "research" } });
		h.emit({ type: "message_end", message: { role: "user", content: "research" } });
		await vi.advanceTimersByTimeAsync(60_000);
		expect(h.received).toContainEqual(expect.objectContaining({ type: "model_wait", status: "waiting" }));
		await vi.advanceTimersByTimeAsync(240_000);
		expect(h.received).toContainEqual(expect.objectContaining({ type: "model_wait", status: "timed-out" }));
		expect(h.abort).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(600_000);
		expect(h.abort).toHaveBeenCalledOnce();
	});
	it("does not claim stopped before abort resolves", async () => {
		const h = harness();
		let finish!: () => void;
		h.abort.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		h.emit({ type: "turn_start" });
		await vi.advanceTimersByTimeAsync(300_000);
		expect(h.received.at(-1)).toMatchObject({ type: "model_wait", status: "stopping" });
		expect(h.received.some((e) => e.status === "timed-out")).toBe(false);
		finish();
		await vi.advanceTimersByTimeAsync(0);
		expect(h.received.at(-1)).toMatchObject({ status: "timed-out" });
	});
	it("reports a sanitized stop failure instead of claiming termination", async () => {
		const h = harness();
		h.abort.mockRejectedValue(new Error("abort failed token=private-value"));
		h.emit({ type: "turn_start" });
		await vi.advanceTimersByTimeAsync(300_000);
		expect(h.received.at(-1)).toMatchObject({
			status: "stop-failed",
			errorMessage: "abort failed token=[redacted]",
		});
		expect(h.received.some((e) => e.status === "timed-out")).toBe(false);
	});
	it("counts hidden provider deltas as activity and clears the warning on recovery", async () => {
		vi.stubEnv("DRONE_KNOWLEDGE_DIR", "/fixture/vault");
		const h = harness();
		h.emit({ type: "turn_start" });
		await vi.advanceTimersByTimeAsync(60_000);
		for (let i = 0; i < 12; i++) {
			h.emit({
				type: "message_update",
				assistantMessageEvent: { type: "thinking_delta", delta: "thinking", contentIndex: 0 },
			});
			await vi.advanceTimersByTimeAsync(30_000);
		}
		expect(h.received).toContainEqual(expect.objectContaining({ type: "model_wait", status: "resumed" }));
		expect(h.received.some((e) => e.type === "message_update")).toBe(false);
		expect(h.abort).not.toHaveBeenCalled();
	});
	it.each(["tool_execution_start", "compaction_start", "auto_retry_start", "agent_end", "agent_settled"])(
		"does not time out %s",
		async (type) => {
			const h = harness();
			h.emit({ type: "turn_start" });
			h.emit({ type });
			await vi.advanceTimersByTimeAsync(600_000);
			expect(h.abort).not.toHaveBeenCalled();
			expect(h.received.some((e) => e.type === "model_wait")).toBe(false);
		},
	);
	it("cleans up waiting when a session is closed", async () => {
		const h = harness();
		h.emit({ type: "turn_start" });
		await h.backend.closeSession("s1");
		await vi.advanceTimersByTimeAsync(600_000);
		expect(h.abort).not.toHaveBeenCalled();
	});
	it("excludes tool approval time and starts a new deadline for the next model turn", async () => {
		const h = harness();
		h.emit({ type: "turn_start" });
		h.emit({ type: "message_end", message: { role: "assistant", stopReason: "toolUse" } });
		h.emit({ type: "tool_execution_start", toolName: "task_plan" });
		await vi.advanceTimersByTimeAsync(600_000);
		expect(h.abort).not.toHaveBeenCalled();
		h.emit({ type: "tool_execution_end", toolName: "task_plan" });
		h.emit({ type: "turn_start" });
		await vi.advanceTimersByTimeAsync(300_000);
		expect(h.abort).toHaveBeenCalledOnce();
	});
	it("a user stop clears the warning and prevents a later automatic abort", async () => {
		const h = harness();
		h.emit({ type: "turn_start" });
		await vi.advanceTimersByTimeAsync(60_000);
		await h.backend.abort("s1");
		expect(h.received.at(-1)).toMatchObject({ type: "model_wait", status: "resumed" });
		await vi.advanceTimersByTimeAsync(600_000);
		expect(h.abort).toHaveBeenCalledOnce();
	});
	it("disposing the backend releases all response deadlines", async () => {
		const h = harness();
		h.emit({ type: "turn_start" });
		h.backend.dispose();
		await vi.advanceTimersByTimeAsync(600_000);
		expect(h.abort).not.toHaveBeenCalled();
		expect(h.received.some((e) => e.type === "model_wait")).toBe(false);
	});
});
