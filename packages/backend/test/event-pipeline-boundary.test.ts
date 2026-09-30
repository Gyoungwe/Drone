import type { SessionEvent } from "@drone/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiBackend } from "../src/pi-backend";
import { createDroneRuntime } from "../src/runtime";
import { StreamGuard } from "../src/session/stream-guard";
import { createEventPipeline } from "../src/session-engine/event-pipeline";

const emit = (backend: PiBackend, event: unknown) =>
	(backend as unknown as { emitEvent: (sessionId: string, event: SessionEvent) => void }).emitEvent(
		"s1",
		event as SessionEvent,
	);

describe("PiBackend event pipeline boundaries", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("publication projection failure remains fail-closed before fanout", () => {
		vi.stubEnv("DRONE_KNOWLEDGE_DIR", "/fixture/app");
		const runtime = createDroneRuntime();
		runtime.knowledge.publication = {
			projectEvent: () => {
				throw new Error("projection failed");
			},
		};
		const backend = new PiBackend({ runtime });
		const received: SessionEvent[] = [];
		backend.onEvent((_sessionId, event) => received.push(event));

		const message = {
			role: "assistant",
			content: [{ type: "text", text: "UNPUBLISHED_DRAFT" }],
			timestamp: 1,
			stopReason: "stop",
		};
		emit(backend, { type: "message_end", message });

		expect(received).toHaveLength(1);
		expect(JSON.stringify(received[0])).not.toContain("UNPUBLISHED_DRAFT");
		expect(received[0]).toMatchObject({ type: "message_end", message: { role: "assistant" } });
		expect(JSON.stringify(received[0]?.message?.content)).toContain("知识库检查未通过");
		backend.dispose();
	});

	it("trace failure is open and fanout still receives the projected event", () => {
		const backend = new PiBackend();
		const traces = backend as unknown as { traces: { record: () => void } };
		traces.traces.record = () => {
			throw new Error("trace unavailable");
		};
		const received: SessionEvent[] = [];
		backend.onEvent((_sessionId, event) => received.push(event));

		const event = { type: "queue_update", followUp: [] } as unknown as SessionEvent;
		emit(backend, event);

		expect(received).toEqual([event]);
		backend.dispose();
	});
});

describe("stream guard pipeline stage", () => {
	it.each([
		{
			name: "whitespace",
			limits: { wsRunBytes: 3, totalBytes: 100 },
			delta: " \n\n\n",
			verdict: "trip_whitespace",
		},
		{
			name: "oversize",
			limits: { wsRunBytes: 100, totalBytes: 3 },
			delta: "abcd",
			verdict: "trip_oversize",
		},
	])("$name trip drops the event before fanout", ({ limits, delta, verdict }) => {
		const guard = new StreamGuard(limits);
		const forwarded: SessionEvent[] = [];
		let seenVerdict: string | undefined;
		const event = {
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", delta, contentIndex: 0 },
		} as unknown as SessionEvent;
		const result = createEventPipeline<SessionEvent, string>([
			{
				name: "stream-guard",
				failMode: "closed",
				run: (current, sessionId) => {
					seenVerdict = guard.inspect(sessionId, current);
					return seenVerdict === "pass" ? current : null;
				},
			},
			{
				name: "fanout",
				failMode: "open",
				run: (current) => {
					forwarded.push(current);
					return current;
				},
			},
		]).run(event, "s1");

		expect(seenVerdict).toBe(verdict);
		expect(guard.inspect("s1", event)).toBe("suppress");
		expect(result).toBeNull();
		expect(forwarded).toHaveLength(0);
	});
});
