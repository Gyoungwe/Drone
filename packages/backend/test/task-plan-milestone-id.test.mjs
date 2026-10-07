import { createTaskWorkbench } from "@drone/tasks/workbench";
import { expect, it } from "vitest";

// 会话 01a1172e：单个里程碑 id "dhx16_plot" 曾被报成 "Milestone IDs must be unique."，模型连续重试 4 次。
const ms = (...ids) =>
	ids.map((id) => ({
		id,
		title: id,
		acceptance: { kind: "file", path: `${id}.png`, rootKind: "workspace" },
	}));
function plan(milestones) {
	const j = createTaskWorkbench();
	j.attach("scope-milestone-id");
	j.begin("DHX16 联配图");
	return () => j.plan({ goal: "DHX16 联配图", summary: "摘要", milestones });
}
it("accepts underscores in milestone ids", () => {
	expect(plan(ms("dhx16_plot", "m1_retrieve_sequences"))).not.toThrow();
});
it("reports a format error, not a duplicate error, for invalid ids", () => {
	expect(plan(ms("bad id!"))).toThrow(/invalid: use 1–40 letters, digits, "-" or "_"/);
	expect(plan(ms("bad id!"))).not.toThrow(/unique/);
});
it("still rejects real duplicates", () => {
	expect(plan(ms("a_1", "a_1"))).toThrow("Milestone IDs must be unique.");
});
