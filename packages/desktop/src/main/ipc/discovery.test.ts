import type { DiscoveryServicePort } from "@drone/backend";
import { describe, expect, it, vi } from "vitest";
import { createDiscoveryIpcImplementation } from "./discovery";

vi.mock("electron", () => ({ BrowserWindow: { fromWebContents: vi.fn() } }));

describe("discovery IPC", () => {
	it("delegates all reads and kernel lifecycle to the single backend capability", async () => {
		const discovery = {
			getCapabilities: vi.fn(async () => ({
				kind: "unavailable",
				languages: [],
				networkDisabled: false,
				writesOnlyToRunDirectory: false,
			})),
			listKernelSessions: vi.fn(async () => []),
			getKernelSession: vi.fn(async () => null),
			closeKernelSession: vi.fn(async () => {}),
			listCriticReviews: vi.fn(async () => []),
			listMultipathAssessments: vi.fn(async () => []),
			listExplorationPlans: vi.fn(async () => []),
			listEvaluations: vi.fn(async () => []),
		};
		const api = createDiscoveryIpcImplementation(discovery as unknown as DiscoveryServicePort);
		await api.getCapabilities("python");
		await api.listKernelSessions();
		await api.getKernelSession("a");
		await api.closeKernelSession("a");
		await api.listCriticReviews();
		await api.listMultipathAssessments();
		await api.listExplorationPlans();
		await api.listEvaluations();
		for (const method of Object.values(discovery)) expect(method).toHaveBeenCalledOnce();
	});
	it("propagates unavailable instead of presenting an empty successful list", async () => {
		const unavailable = {
			listCriticReviews: async () => {
				throw new Error("discovery unavailable");
			},
		};
		const api = createDiscoveryIpcImplementation(unavailable as unknown as DiscoveryServicePort);
		await expect(api.listCriticReviews()).rejects.toThrow("discovery unavailable");
	});
});
