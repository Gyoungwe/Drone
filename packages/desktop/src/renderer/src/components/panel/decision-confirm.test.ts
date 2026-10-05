import { describe, expect, it } from "vitest";
import { isSimpleConfirm, orderedAskOptions } from "../session/ask-simple";
import { decisionConfirmationChoice, decisionConfirmationRequest } from "./decision-confirm";

const decision = {
	id: "decision-1",
	schemaVersion: 2,
	projectId: "project-1",
	kind: "workflow-repair",
	summary: "Adjusted workflow",
	basis: ["repair-1"],
	affectedArtifactIds: ["artifact-1"],
	status: "active",
	createdAt: "2026-01-01T00:00:00.000Z",
} as const;

describe("decision confirmation", () => {
	it("builds a compact application confirmation with cancel and confirm choices", () => {
		const request = decisionConfirmationRequest(decision, "revoke", {
			title: "Confirm decision action",
			message: "Revoke this decision",
			confirm: "Confirm",
			cancel: "Cancel",
		});
		expect(isSimpleConfirm(request)).toBe(true);
		expect(request.questions[0]?.options.map((option) => option.value)).toEqual(["cancel", "confirm"]);
		expect(orderedAskOptions(request).map((option) => option.value)).toEqual(["cancel", "confirm"]);
		expect(request.questions[0]?.prompt).toBe("Revoke this decision");
	});

	it("distinguishes confirm and cancel responses", () => {
		expect(
			decisionConfirmationChoice({
				kind: "answer",
				mode: "submit",
				answers: { "decision-action": { values: ["confirm"] } },
			}),
		).toBe("confirm");
		expect(
			decisionConfirmationChoice({
				kind: "answer",
				mode: "submit",
				answers: { "decision-action": { values: ["cancel"] } },
			}),
		).toBe("cancel");
		expect(decisionConfirmationChoice({ kind: "cancel" })).toBe("cancel");
	});
});
