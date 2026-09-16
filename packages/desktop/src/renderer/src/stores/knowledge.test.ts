import type { KnowledgeFlow } from "@drone/shared";
import { beforeEach, expect, it } from "vitest";
import { useKnowledgeStore } from "./knowledge";

const flow = (id: string, updatedAt: number): KnowledgeFlow => ({
	sessionId: id,
	turnId: "turn",
	vaultId: "v",
	bindingRevision: 1,
	vault: "/fixture",
	project: "p",
	phase: "navigation",
	updatedAt,
	navigation: [],
	reads: [],
	search: null,
	publication: null,
});
beforeEach(() =>
	useKnowledgeStore.setState({
		flows: {},
		revision: 0,
		dialog: null,
		review: null,
		reviewQueue: [],
		notice: null,
	}),
);
it("retains independent per-session phases", () => {
	const s = useKnowledgeStore.getState();
	s.apply({ kind: "flow", flow: flow("A", 1) });
	s.apply({ kind: "flow", flow: flow("B", 2) });
	expect(Object.keys(useKnowledgeStore.getState().flows)).toEqual(["A", "B"]);
});
it("older snapshots cannot replace live progress", () => {
	const s = useKnowledgeStore.getState();
	s.apply({ kind: "flow", flow: flow("A", 10) });
	s.apply({ kind: "flow", flow: { ...flow("A", 1), phase: "blocked" } });
	expect(useKnowledgeStore.getState().flows.A?.phase).toBe("navigation");
});
it("caps retained sessions and does not update all transcripts", () => {
	for (let i = 0; i < 70; i++) useKnowledgeStore.getState().apply({ kind: "flow", flow: flow(String(i), i) });
	expect(Object.keys(useKnowledgeStore.getState().flows)).toHaveLength(64);
	expect(useKnowledgeStore.getState().flows["0"]).toBeUndefined();
});
it("dialog carries the originating project and proposal", () => {
	useKnowledgeStore.getState().open({ cwd: "/project-a", sessionId: "A", tab: "reviews", id: "proposal" });
	expect(useKnowledgeStore.getState().dialog?.cwd).toBe("/project-a");
	useKnowledgeStore.getState().close();
	expect(useKnowledgeStore.getState().dialog).toBeNull();
});
it("review popup queues extra candidates and later restores the next one", () => {
	const s = useKnowledgeStore.getState();
	s.openReview({ cwd: "/a", sessionId: "s1", id: "one" });
	s.openReview({ cwd: "/a", sessionId: "s1", id: "two" });
	s.openReview({ cwd: "/a", sessionId: "s1", id: "one" });
	expect(useKnowledgeStore.getState().review?.id).toBe("one");
	expect(useKnowledgeStore.getState().reviewQueue.map((item) => item.id)).toEqual(["two"]);
	s.deferReview();
	expect(useKnowledgeStore.getState().review?.id).toBe("two");
	expect(useKnowledgeStore.getState().reviewQueue).toEqual([]);
	s.deferReview();
	expect(useKnowledgeStore.getState().review).toBeNull();
});
it("later leaves the knowledge panel open and does not record a decision", () => {
	const s = useKnowledgeStore.getState();
	s.open({ cwd: "/a", sessionId: "s1", tab: "overview" });
	s.openReview({ cwd: "/a", sessionId: "s1", id: "one" });
	s.deferReview();
	expect(useKnowledgeStore.getState().dialog?.tab).toBe("overview");
	expect(useKnowledgeStore.getState().review).toBeNull();
	expect(useKnowledgeStore.getState().notice).toBeNull();
});
