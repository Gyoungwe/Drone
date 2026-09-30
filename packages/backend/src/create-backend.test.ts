import { describe, expect, it } from "vitest";
import { createBackend } from "./create-backend";

describe("createBackend", () => {
	it("assembles the compatibility façade and domain service groups", () => {
		const services = createBackend({ projectTrust: false, permissionGates: false });
		expect(services.sessions).toBeDefined();
		expect(services.sessionEngine).toBe(services.sessions.sessionEngine);
		expect(services.knowledge).toBe(services.sessions.knowledge);
		expect(services.packages).toBe(services.sessions.packages);
		expect(services.settings).toBe(services.sessions.settings);
		expect(services.models).toBe(services.sessions.models);
		expect(services.login).toBe(services.sessions.login);
		expect(services.mcp).toBe(services.sessions.mcp);
		expect(services.zotero).toBe(services.sessions.zotero);
		expect(services.zotero.getStatus).toBeTypeOf("function");
		services.dispose();
	});
});
