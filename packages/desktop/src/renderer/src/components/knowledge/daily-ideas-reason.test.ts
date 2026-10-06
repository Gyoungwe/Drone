import { describe, expect, it, vi } from "vitest";

vi.mock("../../api", () => ({ getPi: () => ({}) }));
vi.mock("../../stores/knowledge", () => ({ useKnowledgeStore: () => 0 }));
vi.mock("../../i18n", () => ({ useI18nStore: () => "zh", useT: () => (key: string) => key }));

import { emptyReason, lastRunNote } from "./DailyIdeas";

const t = (key: string) =>
	({
		dailyEmpty: "EMPTY",
		dailyNoNewNotes: "NO-NEW since {since}",
		dailyRanNoIdeas: "READ {notes}",
		dailyNotBound: "NOT-BOUND",
	})[key] ?? key;

describe("daily ideas empty state", () => {
	it("explains why there are no ideas", () => {
		expect(emptyReason({ lastOutcome: { kind: "not-bound", at: 1 } }, t)).toBe("NOT-BOUND");
		expect(emptyReason({ lastOutcome: { kind: "no-new-notes", at: 2, since: 0 } }, t)).toMatch(
			/^NO-NEW since /,
		);
		expect(emptyReason({ lastOutcome: { kind: "ran", at: 3, notes: 4, added: 0 } }, t)).toBe("READ 4");
		expect(emptyReason({ lastOutcome: null }, t)).toBe("EMPTY");
		// a failed run shows its own error line; the empty state stays neutral
		expect(
			emptyReason({ lastOutcome: { kind: "ran", at: 3, notes: 4, added: 0 }, lastError: "401" }, t),
		).toBe("EMPTY");
	});

	it("explains a run that added nothing even when older ideas are listed", () => {
		expect(lastRunNote({ lastOutcome: { kind: "no-new-notes", at: 2, since: 0 } }, t)).toMatch(
			/^NO-NEW since /,
		);
		expect(lastRunNote({ lastOutcome: { kind: "ran", at: 3, notes: 4, added: 0 } }, t)).toBe("READ 4");
		expect(lastRunNote({ lastOutcome: { kind: "ran", at: 3, notes: 4, added: 2 } }, t)).toBeNull();
		expect(lastRunNote({ lastOutcome: null }, t)).toBeNull();
		expect(
			lastRunNote({ lastOutcome: { kind: "ran", at: 3, notes: 4, added: 0 }, lastError: "401" }, t),
		).toBeNull();
	});
});
