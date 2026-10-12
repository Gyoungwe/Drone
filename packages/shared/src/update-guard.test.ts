import { describe, expect, it } from "vitest";
import { restartNeedsConfirm, runningTurnCount } from "./update-guard";

describe("update guard", () => {
	it("counts active and compacting sessions", () => {
		expect(runningTurnCount([{ agentActive: true }, { compacting: true }, {}, undefined])).toBe(2);
	});
	it("only confirms when something is running", () => {
		expect(restartNeedsConfirm(0)).toBe(false);
		expect(restartNeedsConfirm(1)).toBe(true);
	});
});
