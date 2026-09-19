import { expect, it } from "vitest";
import { literatureRecoverySummary } from "./literature-recovery";

it("presents independent destination status and does not imply scientific validation", () => {
	const out = JSON.stringify({
		operation_id: "op",
		destinations: {
			zotero: { action: "reuse-existing-item" },
			obsidian: { action: "deposit-missing-note-with-authorization" },
		},
	});
	expect(literatureRecoverySummary(out).join(" ")).toContain("仅缺笔记");
	expect(literatureRecoverySummary(out, "en").join(" ")).toContain("not reading or scientific validation");
});
it("ignores malformed or unrelated tool output", () => {
	expect(literatureRecoverySummary("partial JSON")).toEqual([]);
	expect(literatureRecoverySummary('{"operation_id":"op","destinations":{}}')).toEqual([]);
});
