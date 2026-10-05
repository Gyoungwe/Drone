import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import { DecisionsContract } from "../decisions";

describe("DecisionsContract", () => {
	it("keeps list/revoke/confirm desktop-only and validates the decision shape", () => {
		expect(DecisionsContract.methods.list.access).toBe("desktop");
		expect(DecisionsContract.methods.revoke.access).toBe("desktop");
		expect(DecisionsContract.methods.confirm.access).toBe("desktop");
		expect(Check(DecisionsContract.methods.list.args, ["project-1"])).toBe(true);
		expect(Check(DecisionsContract.methods.revoke.args, ["decision-1", "review requested"])).toBe(true);
		expect(Check(DecisionsContract.methods.confirm.args, ["decision-1", "confirmed by user"])).toBe(true);
		expect(Check(DecisionsContract.methods.confirm.args, ["decision-1", ""])).toBe(false);
		expect(
			Check(DecisionsContract.methods.revoke.result, {
				id: "decision-1",
				schemaVersion: 2,
				projectId: "project-1",
				kind: "workflow-repair",
				summary: "Adjusted input",
				basis: ["repair-1"],
				affectedArtifactIds: [],
				status: "revoked",
				revokedAt: "2026-01-01T00:00:00.000Z",
				revokeReason: "review requested",
				createdAt: "2026-01-01T00:00:00.000Z",
			}),
		).toBe(true);
	});
});
