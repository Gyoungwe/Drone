import { describe, expect, it } from "vitest";
import { createUnavailableComputeService } from "./compute-adapter";

describe("default compute adapter", () => {
	it("keeps host management local while refusing remote side effects", async () => {
		const service = createUnavailableComputeService();
		const host = await service.saveHost({ alias: "cluster-a", displayName: "Cluster A", kind: "ssh" });
		expect((await service.listHosts()).map((item) => item.id)).toEqual([host.id]);
		expect(await service.getHost(host.id)).toMatchObject({ alias: "cluster-a", authState: "not_configured" });
		await expect(service.openTerminal({ hostId: host.id })).rejects.toThrow("unavailable");
		await service.removeHost(host.id);
		expect(await service.getHost(host.id)).toBeNull();
	});

	it("reports onboarding and health without claiming an unprobed host is online", async () => {
		const service = createUnavailableComputeService();
		const host = await service.saveHost({ alias: "cluster-b", displayName: "Cluster B", kind: "ssh" });
		const health = await service.getHealthSnapshot();
		expect(health.hosts[0]).toMatchObject({ id: host.id, status: "unknown" });
		expect((await service.getOnboardingStatus()).find((item) => item.step === "remote-host")).toMatchObject({
			state: "needs_action",
		});
	});
});
