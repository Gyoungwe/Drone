import { describe, expect, it } from "vitest";
import {
	checkpointFingerprint,
	HARNESS_CONTRACT,
	renderHarnessCheckpoint,
	renderHarnessPosture,
	renderHarnessSpecialistLayer,
	resolveHarnessModelFamily,
} from "./harness";

const checkpoint = {
	version: 1 as const,
	epoch: 2,
	objective: "Analyze the repository",
	deliverables: ["architecture report"],
	findings: ["Task is running"],
	workState: "running",
	nextMove: "Read the session engine",
	relevantFiles: ["packages/backend/src/session-engine/extensions.ts"],
};

describe("harness context contract", () => {
	it("renders stable guidance without requesting private reasoning", () => {
		expect(HARNESS_CONTRACT).toContain("Inspect before assuming");
		expect(HARNESS_CONTRACT).toContain("Report evidence and limitations");
		expect(HARNESS_CONTRACT.toLowerCase()).not.toContain("chain-of-thought");
	});

	it("renders a deterministic bounded checkpoint", () => {
		const first = renderHarnessCheckpoint(checkpoint);
		const second = renderHarnessCheckpoint({ ...checkpoint });
		expect(first).toContain("Objective");
		expect(first).toContain("Read the session engine");
		expect(first.length).toBeLessThanOrEqual(8000);
		expect(first).toBe(second);
		expect(checkpointFingerprint(checkpoint)).toHaveLength(64);
		expect(checkpointFingerprint(checkpoint)).toBe(checkpointFingerprint({ ...checkpoint }));
	});

	it("renders the current posture as an operational reminder", () => {
		const posture = renderHarnessPosture({
			effort: "ultra",
			delegation: "light",
			autonomy: "balanced",
			mode: "execute",
		});
		expect(posture).toContain("ULTRA");
		expect(posture).toContain("light");
		expect(posture).toContain("balanced");
		expect(posture).toContain("permission mode");
	});

	it("selects model-family guidance and keeps specialist prompts compact", () => {
		expect(resolveHarnessModelFamily("openai", "gpt-6-astra")).toBe("gpt-astra");
		expect(resolveHarnessModelFamily("anthropic", "claude-sonnet")).toBe("anthropic");
		const specialist = renderHarnessSpecialistLayer(
			"gpt",
			{ effort: "normal", delegation: "off", autonomy: "autonomous", mode: "execute" },
			"evidence",
		);
		expect(specialist).toContain("Scientific contract:");
		expect(specialist).toContain("Response contract:");
		expect(specialist).not.toContain("Drone harness contract:");
	});

	it("bounds hostile or oversized user-derived fields", () => {
		const rendered = renderHarnessCheckpoint({
			...checkpoint,
			objective: '<script>alert("x")</script>',
			findings: Array.from({ length: 12 }, (_, index) => `${index} ${"x".repeat(2000)}`),
		});
		expect(rendered).not.toContain("<script>");
		expect(rendered).toContain("&lt;script&gt;");
		expect(rendered.length).toBeLessThanOrEqual(8000);
	});
});
