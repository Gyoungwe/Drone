import type { ResearchSkillUpdateState } from "@drone/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const piMock = vi.hoisted(() => ({
	checkResearchSkills: vi.fn(() => Promise.resolve()),
	onResearchSkillUpdateEvent: vi.fn(),
}));
vi.mock("../api", () => ({ getPi: () => piMock }));

import { initResearchSkillUpdateStore, useResearchSkillUpdateStore } from "./research-skill-update";

let emit: ((state: ResearchSkillUpdateState) => void) | undefined;

beforeEach(() => {
	vi.clearAllMocks();
	useResearchSkillUpdateStore.setState({ state: null });
	piMock.onResearchSkillUpdateEvent.mockImplementation(
		(callback: (state: ResearchSkillUpdateState) => void) => {
			emit = callback;
			return () => undefined;
		},
	);
	initResearchSkillUpdateStore();
});

describe("research skill update store", () => {
	it("keeps update state event-driven until an explicit check", async () => {
		expect(useResearchSkillUpdateStore.getState().state).toBeNull();
		expect(piMock.checkResearchSkills).not.toHaveBeenCalled();

		emit?.({
			phase: "available",
			packs: [{ id: "nature", repository: "Yuan1z0825/nature-skills" }],
			checkedAt: "2026-10-20T00:00:00.000Z",
		});
		expect(useResearchSkillUpdateStore.getState().state).toMatchObject({ phase: "available" });

		await useResearchSkillUpdateStore.getState().check();
		expect(piMock.checkResearchSkills).toHaveBeenCalledOnce();
	});
});
