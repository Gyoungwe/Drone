import { describe, expect, it } from "vitest";
import { DomainCapabilityRegistry } from "../src/plugins/domain-capabilities";

describe("DomainCapabilityRegistry", () => {
	it("exposes a stable read-only snapshot and availability check", () => {
		const registry = new DomainCapabilityRegistry();
		registry.register({ id: "knowledge", status: "available", provider: "pi-knowledge" });
		registry.register({
			id: "analysis",
			status: "unavailable",
			provider: "optional-plugin",
			reason: "plugin is not installed",
		});

		const listed = registry.list();
		expect(listed).toEqual([
			{ id: "knowledge", status: "available", provider: "pi-knowledge" },
			{
				id: "analysis",
				status: "unavailable",
				provider: "optional-plugin",
				reason: "plugin is not installed",
			},
		]);
		expect(registry.isAvailable("knowledge")).toBe(true);
		expect(registry.isAvailable("analysis")).toBe(false);
		expect(registry.isAvailable("missing")).toBe(false);

		(listed[0] as { status: string }).status = "unavailable";
		expect(registry.get("knowledge")).toMatchObject({ status: "available" });
	});

	it("replaces a provider without leaving stale metadata", () => {
		const registry = new DomainCapabilityRegistry();
		registry.register({ id: "research", status: "available", provider: "host-compat" });
		registry.register({
			id: "research",
			status: "degraded",
			provider: "pi-research",
			reason: "connector credentials are not configured",
		});

		expect(registry.list()).toEqual([
			{
				id: "research",
				status: "degraded",
				provider: "pi-research",
				reason: "connector credentials are not configured",
			},
		]);
	});
});
