import { describe, expect, it, vi } from "vitest";

vi.mock("../../i18n", () => ({ useT: () => (k: string) => k }));

describe("formatStepDuration", async () => {
	const { formatStepDuration } = await import("./ToolCallCard");
	it("formats short and long steps", () => {
		expect(formatStepDuration(120)).toBe("0.1s");
		expect(formatStepDuration(5300)).toBe("5.3s");
		expect(formatStepDuration(42_000)).toBe("42s");
		expect(formatStepDuration(125_000)).toBe("2m 5s");
	});
});
