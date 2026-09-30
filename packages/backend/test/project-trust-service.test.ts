import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTrustOptions } from "../src/project/trust";
import { ProjectTrustService } from "../src/services/project-trust";

describe("ProjectTrustService", () => {
	it("owns one trust store and gate without constructing PiBackend", async () => {
		const requests: { id: string; cwd: string }[] = [];
		const service = new ProjectTrustService({
			agentDir: mkdtempSync(join(tmpdir(), "drone-project-trust-service-")),
			onRequest: (request) => requests.push({ id: request.id, cwd: request.cwd }),
		});

		const cwd = "/tmp/project-trust-service";
		const decision = service.ask(cwd, buildTrustOptions(cwd));
		expect(requests).toHaveLength(1);
		expect(requests[0].cwd).toBe(cwd);
		service.respond(requests[0].id, 0);

		await expect(decision).resolves.toBe(0);
		service.store.set(cwd, true);
		expect(service.store.get(cwd)).toBe(true);
		service.dispose();
	});

	it("disposes unresolved prompts as cancelled", async () => {
		const requests: { id: string }[] = [];
		const service = new ProjectTrustService({
			agentDir: mkdtempSync(join(tmpdir(), "drone-project-trust-service-")),
			onRequest: (request) => requests.push({ id: request.id }),
		});
		const decision = service.ask(
			"/tmp/project-trust-service",
			buildTrustOptions("/tmp/project-trust-service"),
		);
		service.dispose();

		await expect(decision).resolves.toBeUndefined();
		expect(requests).toHaveLength(1);
	});
});
