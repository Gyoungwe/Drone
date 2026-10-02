import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	listeners: {} as Record<string, (value: any) => void>,
	listHosts: vi.fn(async () => []),
	getHealthSnapshot: vi.fn(async () => ({ checkedAt: "now", hosts: [] })),
	listJobs: vi.fn(async () => []),
	getOnboardingStatus: vi.fn(async () => []),
}));

const subscribe = (name: string) => (handler: (value: any) => void) => {
	mocks.listeners[name] = handler;
	return () => {
		delete mocks.listeners[name];
	};
};

vi.mock("../api", () => ({
	getPi: () => ({
		listHosts: mocks.listHosts,
		getHealthSnapshot: mocks.getHealthSnapshot,
		listJobs: mocks.listJobs,
		getOnboardingStatus: mocks.getOnboardingStatus,
		onHealthChanged: subscribe("health"),
		onJobUpdated: subscribe("job"),
		onLogChunk: subscribe("log"),
		onTerminalOutput: subscribe("terminal"),
		onTerminalClosed: subscribe("closed"),
	}),
}));

import { useComputeStore } from "./compute";

describe("compute store", () => {
	beforeEach(() => {
		for (const key of Object.keys(mocks.listeners)) delete mocks.listeners[key];
		mocks.listHosts.mockReset().mockResolvedValue([]);
		mocks.getHealthSnapshot.mockReset().mockResolvedValue({ checkedAt: "now", hosts: [] });
		mocks.listJobs.mockReset().mockResolvedValue([]);
		mocks.getOnboardingStatus.mockReset().mockResolvedValue([]);
		useComputeStore.setState({
			hosts: [],
			health: null,
			jobs: [],
			logsByJob: {},
			terminals: {},
			onboarding: [],
			loading: false,
			error: null,
			initialized: false,
		});
	});

	it("subscribes once and folds health/job/log events into stable state", () => {
		const dispose = useComputeStore.getState().init();
		expect(useComputeStore.getState().initialized).toBe(true);
		mocks.listeners.job?.({
			id: "job-1",
			hostId: "host-1",
			state: "running",
			budget: { coreHours: 1, wallMinutes: 1, diskBytes: 0 },
			artifacts: [],
			updatedAt: "now",
		});
		mocks.listeners.log?.({ jobId: "job-1", cursor: "1", text: "one", truncated: false, at: "now" });
		mocks.listeners.log?.({ jobId: "job-1", cursor: "2", text: "two", truncated: false, at: "now" });
		expect(useComputeStore.getState().jobs).toHaveLength(1);
		expect(useComputeStore.getState().logsByJob["job-1"]?.text).toBe("onetwo");
		dispose();
		expect(useComputeStore.getState().initialized).toBe(false);
		expect(mocks.listeners.job).toBeUndefined();
	});

	it("keeps stale hosts when a refresh fails", async () => {
		useComputeStore.setState({ hosts: [{ id: "host-1" } as any] });
		mocks.listHosts.mockRejectedValueOnce(new Error("offline"));
		await useComputeStore.getState().refresh();
		expect(useComputeStore.getState().hosts).toEqual([{ id: "host-1" }]);
		expect(useComputeStore.getState().error).toBe("offline");
	});
});
