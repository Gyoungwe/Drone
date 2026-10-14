import { createCausalEnvelope } from "@drone/shared";
import { describe, expect, it } from "vitest";
import { projectCausality } from "./causality-projection";

describe("causality projection", () => {
	it("groups only explicit lineage and keeps the projection redacted", () => {
		const root = createCausalEnvelope({ eventId: "event:binding", runAttemptId: "run:one" });
		const child = createCausalEnvelope({
			eventId: "event:submit",
			causationId: root.eventId,
			runAttemptId: "run:one",
		});
		const projection = projectCausality({
			analysisBindings: {
				analysis: { jobId: "job-1", lineage: root } as never,
			},
			submissions: [{ jobId: "job-1", idempotencyKey: "job-1", submittedAt: "2026-10-14", lineage: child }],
			intents: [
				{
					v: 1,
					kind: "start",
					toolCallId: "call-1",
					toolName: "secret-tool",
					argsHash: "hash",
					replay: "unsafe",
					ts: 1,
					args: { secret: "must not project" },
					lineage: createCausalEnvelope({ eventId: "event:legacy", runAttemptId: "run:old" }),
				},
			],
		});
		expect(projection.records.map((row) => row.eventId)).toEqual([
			"event:binding",
			"event:legacy",
			"event:submit",
		]);
		expect(projection.byRunAttempt.get("run:one")).toHaveLength(2);
		expect(projection.byEventId.get("event:legacy")).not.toHaveProperty("args");
	});

	it("does not invent links for legacy rows without lineage", () => {
		const projection = projectCausality({
			jobs: [
				{
					jobId: "legacy",
					status: "unknown",
					updatedAt: 1,
					spec: { jobId: "legacy", hostAlias: "h", workflow: { name: "w", version: "1" } },
				} as never,
			],
		});
		expect(projection.records).toEqual([]);
	});
});
