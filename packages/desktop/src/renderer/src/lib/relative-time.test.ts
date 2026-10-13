import { describe, expect, it } from "vitest";
import { dirName, relativeTime } from "./relative-time";

describe("relativeTime", () => {
	const now = Date.UTC(2026, 9, 13, 10);
	it("formats recent times", () => {
		expect(relativeTime(now - 10_000, "zh", now)).toBe("刚刚");
		expect(relativeTime(now - 10 * 60_000, "zh", now)).toBe("10分钟前");
		expect(relativeTime(now - 3 * 3_600_000, "en", now)).toBe("3 hours ago");
		expect(relativeTime(now - 86_400_000, "en", now)).toBe("yesterday");
	});
	it("takes the last path segment", () => {
		expect(dirName("C:\\Users\\a\\rnaseq-2026")).toBe("rnaseq-2026");
		expect(dirName("/home/u/proj/")).toBe("proj");
	});
});
