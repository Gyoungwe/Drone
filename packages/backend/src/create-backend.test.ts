import { describe, expect, it } from "vitest";
import { createBackend } from "./create-backend";
import { createDroneRuntime } from "./runtime";

describe("createBackend", () => {
	it("assembles domain service groups outside the session port", () => {
		const services = createBackend({ projectTrust: false, permissionGates: false });
		expect(services.sessions).toBeDefined();
		expect(services.diagnostics).toBeDefined();
		expect(services.diagnostics.getDiagnostics).toBeTypeOf("function");
		expect(services.sessionEngine).toBeDefined();
		expect(services.knowledge).toBeDefined();
		expect(services.knowledge.overview).toBeTypeOf("function");
		expect(services.knowledgeSession).toBeDefined();
		expect(services.knowledgeSession.reviewWithModel).toBeTypeOf("function");
		expect(services.packages).toBeDefined();
		expect(services.settings).toBeDefined();
		expect(services.settings.listProviders).toBeTypeOf("function");
		expect(services.models).toBeDefined();
		expect(services.models.getPrefs).toBeTypeOf("function");
		expect(services.login).toBeDefined();
		expect(services.login.startLogin).toBeTypeOf("function");
		expect(services.mcp).toBeDefined();
		expect(services.permissions).toBeDefined();
		expect(services.permissions.getConfig).toBeTypeOf("function");
		expect(services.approvals).toBeDefined();
		expect(services.approvals.listPending).toBeTypeOf("function");
		expect(services.zotero).toBeDefined();
		expect(services.zotero.getStatus).toBeTypeOf("function");
		expect(services.institutional).toBeDefined();
		expect(services.institutional.testAccess).toBeTypeOf("function");
		expect(services.projectTrust).toBeDefined();
		expect(services.subagents).toBeDefined();
		expect(services.subagents.listAvailable).toBeTypeOf("function");
		services.dispose();
	});

	it("forwards host diagnostics through the explicit service port", async () => {
		const services = createBackend({ projectTrust: false, permissionGates: false });
		const snapshot = await services.diagnostics.getDiagnostics({ version: "test" });
		expect(snapshot.version).toBe("test");
		expect(snapshot.stores).toBeInstanceOf(Array);
		services.dispose();
	});

	it("preserves an explicitly injected host runtime", () => {
		const runtime = createDroneRuntime();
		const services = createBackend({ runtime, projectTrust: false, permissionGates: false });
		expect(services.runtime).toBe(runtime);
		services.dispose();
	});
});
