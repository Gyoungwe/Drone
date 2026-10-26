import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { configureObsidian } from "@drone/extensions/internal/obsidian-workbench";
import {
	closeKnowledgeServices,
	configureKnowledgeWorker,
	getKnowledgeService,
} from "@gyoungwe/pi-knowledge/host";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	configureBackendKnowledgeWorker,
	getKnowledgeWorkerLifecycle,
	resolveBackendKnowledgeWorkerResource,
} from "../src/knowledge/ui";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let root;
let project;
let vault;
let app;
let packagedRoot;
let binding;
const repoRoot = resolve(__dirname, "../../..");

beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-knowledge-worker-lifecycle-")));
	vault = join(root, "Vault");
	project = join(root, "project");
	app = join(root, "app");
	packagedRoot = join(root, "research-workbench");
	await mkdir(join(vault, "Library/Papers"), { recursive: true });
	await mkdir(project, { recursive: true });
	await mkdir(join(packagedRoot, "extensions"), { recursive: true });
	await cp(
		join(repoRoot, ".pi/extensions/knowledge-worker.mjs"),
		join(packagedRoot, "extensions/knowledge-worker.mjs"),
	);
	await cp(
		join(repoRoot, ".pi/extensions/.knowledge-worker-manifest.json"),
		join(packagedRoot, "extensions/.knowledge-worker-manifest.json"),
	);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", app);
	vi.stubEnv("DRONE_RESEARCH_WORKBENCH_ROOT", packagedRoot);
	vi.stubEnv("PI_RESEARCH_DESKTOP_CONFIG", undefined);
	await configureObsidian({ cwd: project, vault, project: "worker-lifecycle" });
	await closeKnowledgeServices();
	// The backend host is the composition root for packaged Desktop resources;
	// explicitly re-install it after the extension source module has loaded.
	configureBackendKnowledgeWorker();
	// Vitest loads the bundled extension and the direct host entry as separate
	// module graphs. Configure the direct host entry with the same verified
	// resource so this regression observes the production worker contract.
	configureKnowledgeWorker(
		(_url, options) =>
			new Worker(pathToFileURL(resolveBackendKnowledgeWorkerResource().path), {
				...options,
				workerData: {
					...(options?.workerData ?? {}),
					workerResource: resolveBackendKnowledgeWorkerResource().metadata,
				},
			}),
		() => resolveBackendKnowledgeWorkerResource().metadata,
	);
	binding = await (await import("@gyoungwe/pi-knowledge/host")).readKnowledgeBinding();
});

afterEach(async () => {
	await closeKnowledgeServices();
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});

describe("knowledge worker packaged lifecycle", () => {
	it("loads the shipped worker, drains it, and records bounded lifecycle events", async () => {
		const resource = resolveBackendKnowledgeWorkerResource(packagedRoot);
		expect(resource.metadata.integrity).toBe(
			createHash("sha256")
				.update(await readFile(resource.path))
				.digest("hex"),
		);
		await writeFile(join(vault, "Library/Papers/fixture.md"), "# Worker fixture\npackaged worker evidence\n");
		const service = await getKnowledgeService(binding);
		const status = await service.request("status");
		expect(status.coverage).toMatch(/uninitialized|indexing|ready/);
		expect(service.workerVersion).toBe(resource.metadata.version);
		await service.close();
		const lifecycle = getKnowledgeWorkerLifecycle();
		expect(lifecycle.events.map((event) => event.stage)).toEqual(
			expect.arrayContaining(["staged", "verified", "enabled", "disabled", "drained"]),
		);
		expect(lifecycle.currentVersion).toBe(resource.metadata.version);
	});

	it("keeps the verified worker when a replacement resource fails closed", async () => {
		const service = await getKnowledgeService(binding);
		const before = await service.request("status");
		const badRoot = join(root, "missing-workbench");
		vi.stubEnv("DRONE_RESEARCH_WORKBENCH_ROOT", badRoot);
		await expect(getKnowledgeService({ ...binding, revision: binding.revision + 1 })).rejects.toThrow(
			/Knowledge worker resource is missing/,
		);
		expect(service.closed).toBe(false);
		expect(await service.request("status")).toMatchObject({ revision: before.revision });
		const lifecycle = getKnowledgeWorkerLifecycle();
		expect(lifecycle.state).toBe("rolled_back");
		expect(lifecycle.currentVersion).toBe(service.workerVersion);
		expect(lifecycle.lastError).toMatch(/missing/);
	});

	it("rejects a packaged worker whose bytes do not match its build manifest", async () => {
		await writeFile(join(packagedRoot, "extensions/knowledge-worker.mjs"), "// tampered\n");
		expect(() => resolveBackendKnowledgeWorkerResource(packagedRoot)).toThrow(/hash mismatch/);
	});
});
