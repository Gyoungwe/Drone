import { describe, expect, it, vi } from "vitest";
import { createDiscoveryIpcImplementation } from "./discovery";

const native = {
	getCapabilities: vi.fn(async () => ({
		kind: "fixture" as const,
		languages: ["python" as const],
		networkDisabled: true,
		writesOnlyToRunDirectory: true,
	})),
	listKernelSessions: vi.fn(async () => []),
	getKernelSession: vi.fn(async () => null),
	closeKernelSession: vi.fn(async () => undefined),
	listCriticReviews: vi.fn(async () => [{ id: "native-critic" }]),
	listMultipathAssessments: vi.fn(async () => [{ id: "native-multipath" }]),
	listExplorationPlans: vi.fn(async () => [{ id: "native-plan" }]),
	listEvaluations: vi.fn(async () => [{ id: "native-evaluation" }]),
};

describe("discovery IPC implementation", () => {
	it("prefers installed host read operations when declared", async () => {
		const host = {
			listCriticReviews: vi.fn(async (input: unknown) => {
				expect(input).toEqual({});
				return [{ id: "plugin-critic" }];
			}),
			listMultipathAssessments: vi.fn(async () => [{ id: "plugin-multipath" }]),
			listExplorationPlans: vi.fn(async () => [{ id: "plugin-plan" }]),
			listEvaluations: vi.fn(async () => [{ id: "plugin-evaluation" }]),
		};
		const implementation = createDiscoveryIpcImplementation({
			discovery: native,
			discoveryHost: { contractVersion: 1, ...host },
		} as never);

		expect(await implementation.listCriticReviews()).toEqual([{ id: "plugin-critic" }]);
		expect(await implementation.listMultipathAssessments()).toEqual([{ id: "plugin-multipath" }]);
		expect(await implementation.listExplorationPlans()).toEqual([{ id: "plugin-plan" }]);
		expect(await implementation.listEvaluations()).toEqual([{ id: "plugin-evaluation" }]);
		expect(native.listCriticReviews).not.toHaveBeenCalled();
	});

	it("keeps the native implementation when no host is installed", async () => {
		const implementation = createDiscoveryIpcImplementation(native as never);
		expect(await implementation.listCriticReviews()).toEqual([{ id: "native-critic" }]);
		expect(await implementation.listMultipathAssessments()).toEqual([{ id: "native-multipath" }]);
		expect(native.listCriticReviews).toHaveBeenCalledTimes(1);
	});
});
