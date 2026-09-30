import { describe, expect, it } from "vitest";
import { createBackend } from "./create-backend";

describe("createBackend", () => {
	it("assembles the compatibility façade and domain service groups", () => {
		const services = createBackend({ projectTrust: false, permissionGates: false });
		expect(services.sessions).toBeDefined();
		expect(services.knowledge).toBe(services.sessions.knowledge);
		expect(services.settings).toBe(services.sessions.settings);
		services.dispose();
	});
});
