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
		expect(services.compute.listHosts).toBeTypeOf("function");
		services.dispose();
	});

	it("keeps an injected compute adapter on the backend boundary", () => {
		const compute = {
			listHosts: async () => [],
			getHost: async () => null,
			saveHost: async () => {
				throw new Error("unused");
			},
			removeHost: async () => {},
			probeHost: async () => {
				throw new Error("unused");
			},
			getHealthSnapshot: async () => ({ checkedAt: new Date().toISOString(), hosts: [] }),
			listJobs: async () => [],
			getJob: async () => null,
			getLogs: async (id: string) => ({
				jobId: id,
				cursor: "",
				text: "",
				truncated: false,
				at: new Date().toISOString(),
			}),
			cancelJob: async () => {},
			openTerminal: async () => {
				throw new Error("unused");
			},
			getTerminal: async () => null,
			writeTerminal: async () => {},
			closeTerminal: async () => {},
			getOnboardingStatus: async () => [],
			checkOnboardingStep: async (step: any) => ({ step, state: "not_configured", summary: "unused" }),
			authorizeRemoteOperation: async () => {},
			onHealthChanged: () => () => {},
			onJobUpdated: () => () => {},
			onLogChunk: () => () => {},
			onTerminalOutput: () => () => {},
			onTerminalClosed: () => () => {},
		};
		const services = createBackend({ compute: compute as any, projectTrust: false, permissionGates: false });
		expect(services.compute).toBe(compute);
		expect(services.runtime.compute?.service).toBe(compute);
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
