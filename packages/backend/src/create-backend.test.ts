import { describe, expect, it } from "vitest";
import { createBackend } from "./create-backend";
import { createDroneRuntime } from "./runtime";

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
		expect(services.permissions).toBe(services.sessions.permissions);
		expect(services.permissions.getConfig).toBeTypeOf("function");
		expect(services.approvals).toBe(services.sessions.approvals);
		expect(services.approvals.listPending).toBeTypeOf("function");
		expect(services.zotero).toBe(services.sessions.zotero);
		expect(services.zotero.getStatus).toBeTypeOf("function");
		expect(services.projectTrust).toBe(services.sessions.projectTrust);
		services.dispose();
	});

	it("preserves an explicitly injected host runtime", () => {
		const runtime = createDroneRuntime();
		const services = createBackend({ runtime, projectTrust: false, permissionGates: false });
		expect(services.runtime).toBe(runtime);
		expect(services.sessions.runtime).toBe(runtime);
		services.dispose();
	});
});
