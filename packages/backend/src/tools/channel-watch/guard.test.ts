import { describe, expect, it } from "vitest";
import { LoopGuard } from "./guard";

describe("LoopGuard path matching", () => {
	it("suppresses self writes when watcher changes path separators", () => {
		const guard = new LoopGuard({ now: () => 1000 });
		guard.markSelfWrite("C:\\project\\.local\\agent-work\\channel\\topic\\MESSAGES.md");
		expect(
			guard.shouldDeliver(
				"topic",
				"MESSAGES.md",
				"hash",
				"C:/project/.local/agent-work/channel/topic/MESSAGES.md",
			),
		).toMatchObject({ deliver: false, reason: "self-write" });
	});
});
