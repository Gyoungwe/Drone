import { describe, expect, it } from "vitest";
import { composerRunActive } from "./composer-run";

describe("composerRunActive", () => {
	it("idle with empty composer is not running", () => {
		expect(composerRunActive({ sending: false, agentActive: false, phase: "idle" })).toBe(false);
	});

	it("optimistic send, agentActive, or streaming phase each count as running", () => {
		expect(composerRunActive({ sending: true, agentActive: false, phase: "idle" })).toBe(true);
		expect(composerRunActive({ sending: false, agentActive: true, phase: "idle" })).toBe(true);
		expect(composerRunActive({ sending: false, agentActive: false, phase: "streaming" })).toBe(true);
	});
});
