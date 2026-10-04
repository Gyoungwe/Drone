import { describe, expect, it } from "vitest";
import {
	deriveProcessEvents,
	deriveProcessLaneState,
	initialProcessLaneState,
	reduceProcessEvent,
} from "./process-lanes";
import { PROCESS_DEMO_STEPS, processDemoState } from "./process-lanes/demo";
import type { UIMessage } from "./transcript/types";

const user = (text: string): UIMessage => ({ kind: "user", id: text, text, timestamp: 1, images: [] });
const tool = (name: string, output: unknown, id = name, args = {}): UIMessage => ({
	kind: "assistant",
	id,
	text: "",
	thinking: "PRIVATE_DO_NOT_SHOW",
	timestamp: 2,
	tools: [{ key: id, id, name, args: JSON.stringify(args), output: JSON.stringify(output), state: "done" }],
});

describe("process lane projection", () => {
	it("replays the eight steps with approval and host stop in two beats", () => {
		expect(PROCESS_DEMO_STEPS).toHaveLength(8);
		const sixth = processDemoState(5);
		expect(sixth.nodes.find((n) => n.id === "taskGate")).toMatchObject({ state: "open", demo: true });
		expect(sixth.nodes.some((n) => n.id === "hostGate")).toBe(false);
		const seventh = processDemoState(6);
		expect(seventh.nodes.find((n) => n.id === "hostGate")).toMatchObject({
			state: "blocked",
			code: "reconcile-before-retry",
		});
		const eighth = processDemoState(7);
		expect(eighth.nodes.find((n) => n.id === "picked")?.route?.primary).toBe("pydeseq2");
		expect(eighth.edges).toEqual(seventh.edges);
		expect(
			eighth.lanes
				.filter((lane) => ["evidence", "deposit", "answer"].includes(lane.id))
				.every((lane) => !eighth.nodes.some((n) => n.lane === lane.id)),
		).toBe(true);
	});
	it("does not turn ordinary read, links or search hits into cited evidence", () => {
		const state = deriveProcessLaneState([
			user("test"),
			tool("read", "[[Library/Papers/a.md]]"),
			tool("research_search_knowledge", { hits: [{ path: "Library/Papers/a.md" }] }),
		]);
		expect(state.reads).toEqual([]);
		expect(state.nodes.some((n) => n.id === "cited")).toBe(false);
		expect(state.nodes.find((n) => n.id === "doing")?.receipts).toHaveLength(2);
		expect(JSON.stringify(state)).not.toContain("PRIVATE_DO_NOT_SHOW");
	});
	it("requires an observed read with a matching checked hash; deliveries are not evidence", () => {
		const read = tool("research_read_knowledge", {
			path: "Library/Papers/a.md",
			text: "content",
			hash: "h1",
			startLine: 1,
			endLine: 2,
		});
		const check = (hash: string) =>
			tool("research_check_answer", {
				ok: true,
				proof: { sources: [{ path: "Library/Papers/a.md", hash }], deliveries: [{ path: "report.md" }] },
			});
		expect(
			deriveProcessLaneState([user("question"), read, check("h1")]).nodes.find((n) => n.id === "cited")
				?.paths,
		).toEqual(["Library/Papers/a.md"]);
		expect(
			deriveProcessLaneState([user("question"), read, check("h2")]).nodes.some((n) => n.id === "cited"),
		).toBe(false);
		expect(
			deriveProcessLaneState([user("question"), read, user("status"), check("h1")]).nodes.some(
				(n) => n.id === "cited",
			),
		).toBe(false);
	});
	it("does not count a failed or empty knowledge read", () => {
		const messages = [user("q"), tool("research_read_knowledge", { path: "a.md", text: "", hash: "h" })];
		expect(deriveProcessLaneState(messages).reads).toEqual([]);
	});
	it("clears cards on a new topic and preserves historical snapshots", () => {
		expect(processDemoState(1).nodes.find((n) => n.id === "picked")?.route?.primary).toBe("research-vault");
		expect(processDemoState(2).nodes.find((n) => n.id === "picked")?.route?.primary).toBe("pydeseq2");
	});
	it("deduplicates final tool records and keeps their observable identity", () => {
		const m = tool("read", { text: "done" });
		expect(
			deriveProcessEvents([user("q"), m, { ...m, id: "copy" }]).filter((e) => e.type === "tool-receipt"),
		).toHaveLength(1);
	});
	it("is immutable and shows only observed loop stages, never all eight stages", () => {
		const state = initialProcessLaneState();
		const next = reduceProcessEvent(state, {
			type: "research-stage",
			id: "x",
			seq: 1,
			stage: "sources_archived",
		});
		expect(state.nodes).toEqual([]);
		expect(next.nodes.some((n) => n.id === "archived")).toBe(true);
		expect(next.nodes.some((n) => n.id === "read")).toBe(false);
		expect(next.nodes.some((n) => n.id === "bound")).toBe(false);
	});
});
