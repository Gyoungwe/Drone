import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	type PackageManager,
	type PackageManagerProgressEvent,
	PackageService,
} from "../src/services/packages";
import { SessionRegistry } from "../src/session/registry";

function harness(options: { manager: PackageManager; streaming?: boolean }) {
	const registry = new SessionRegistry();
	const reload = vi.fn(async () => {});
	registry.add({
		session: { sessionId: "session-1", isStreaming: options.streaming === true, reload } as never,
		cwd: "/tmp/drone-package-lifecycle",
		unsubscribe: vi.fn(),
	});
	const service = new PackageService({
		registry,
		packageManagerFactory: () => options.manager,
	});
	return { service, reload };
}

function managerFixture(configured: Array<{ source: string; scope: "user" | "project" }> = []) {
	let progress: ((event: PackageManagerProgressEvent) => void) | undefined;
	return {
		configured,
		installed: [] as string[],
		installAndPersist: vi.fn(async (source: string) => {
			progress?.({ type: "start", action: "install", source, message: "staging" });
			progress?.({ type: "complete", action: "install", source, message: "verified" });
		}),
		update: vi.fn(async (source: string) => {
			progress?.({ type: "start", action: "update", source });
			progress?.({ type: "complete", action: "update", source });
		}),
		removeAndPersist: vi.fn(async (source: string) => {
			progress?.({ type: "start", action: "remove", source });
			progress?.({ type: "complete", action: "remove", source });
			return true;
		}),
		listConfiguredPackages: vi.fn(() => configured),
		setProgressCallback: vi.fn((callback: ((event: PackageManagerProgressEvent) => void) | undefined) => {
			progress = callback;
		}),
	} satisfies PackageManager & { configured: typeof configured; installed: string[] };
}

describe("PackageService lifecycle receipts", () => {
	it("records staging, verification and current-session reload for install", async () => {
		const manager = managerFixture();
		const { service, reload } = harness({ manager });

		const receipt = await service.installPackage("example-extension");

		expect(receipt).toMatchObject({
			operation: "install",
			packageName: "example-extension",
			source: "npm:example-extension",
			status: "succeeded",
			effect: "current-session",
		});
		expect(receipt.events.map((event) => event.type)).toEqual(["staged", "verified", "enabled", "reloaded"]);
		expect(reload).toHaveBeenCalledOnce();
	});

	it("reports a streaming session as next-session instead of claiming a reload", async () => {
		const manager = managerFixture();
		const { service, reload } = harness({ manager, streaming: true });

		const receipt = await service.installPackage("example-extension");

		expect(receipt.effect).toBe("next-session");
		expect(receipt.deferredSessionIds).toEqual(["session-1"]);
		expect(receipt.events.at(-1)?.type).toBe("reload_deferred");
		expect(reload).not.toHaveBeenCalled();
	});

	it("returns an npm-not-found error receipt without throwing", async () => {
		const manager = managerFixture();
		manager.installAndPersist.mockRejectedValue(new Error("spawn npm ENOENT"));
		const { service } = harness({ manager });

		const receipt = await service.installPackage("example-extension");

		expect(receipt.status).toBe("failed");
		expect(receipt.error).toMatchObject({ code: "unavailable", retryable: true });
		expect(receipt.error?.message).toContain("DRONE_NPM_NOT_FOUND");
		expect(receipt.events.at(-1)?.type).toBe("failed");
	});

	it("protects built-in Drone packages from update and removal", async () => {
		const manager = managerFixture([{ source: "npm:@gyoungwe/pi-core", scope: "user" }]);
		const { service } = harness({ manager });

		const update = await service.updatePackage("@gyoungwe/pi-core");
		const remove = await service.removePackage("npm:@gyoungwe/pi-core", "user");

		expect(update.error?.code).toBe("builtin");
		expect(remove.error?.code).toBe("builtin");
		expect(manager.update).not.toHaveBeenCalled();
		expect(manager.removeAndPersist).not.toHaveBeenCalled();
	});

	it("does not claim a package was disabled when removal returns no change", async () => {
		const manager = managerFixture([{ source: "npm:fixture-extension", scope: "user" }]);
		manager.removeAndPersist.mockResolvedValue(false);
		const { service, reload } = harness({ manager });

		const receipt = await service.removePackage("npm:fixture-extension", "user");

		expect(receipt).toMatchObject({
			operation: "remove",
			status: "failed",
			effect: "current-session",
			error: { code: "not-installed" },
		});
		expect(receipt.events.map((event) => event.type)).toEqual(["failed"]);
		expect(reload).not.toHaveBeenCalled();
	});

	it("keeps failed updates from reporting a new version or reload", async () => {
		const manager = managerFixture([{ source: "npm:fixture-extension@1.0.0", scope: "user" }]);
		manager.update.mockRejectedValue(new Error("registry unavailable"));
		const { service, reload } = harness({ manager });

		const receipt = await service.updatePackage("fixture-extension");

		expect(receipt).toMatchObject({
			operation: "update",
			status: "failed",
			error: { code: "unavailable", retryable: true },
		});
		expect(receipt.version).toBeUndefined();
		expect(reload).not.toHaveBeenCalled();
	});

	it("updates project-scoped packages and returns the selected scope", async () => {
		const manager = managerFixture([{ source: "npm:fixture-extension", scope: "project" }]);
		const { service } = harness({ manager });

		const receipt = await service.updatePackage("fixture-extension");

		expect(receipt.scope).toBe("project");
		expect(manager.update).toHaveBeenCalledWith("npm:fixture-extension");
	});

	it("reinstalls the unpinned source when an exact Pi version pin does not change", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-package-update-"));
		const installed = join(root, "node_modules", "fixture-extension");
		await mkdir(installed, { recursive: true });
		await writeFile(join(installed, "package.json"), JSON.stringify({ version: "1.0.0" }));
		const manager = managerFixture([{ source: "npm:fixture-extension@1.0.0", scope: "user" }]) as ReturnType<
			typeof managerFixture
		> & { getInstalledPath: ReturnType<typeof vi.fn> };
		manager.getInstalledPath = vi.fn(() => installed);
		manager.installAndPersist.mockImplementation(async () => {
			await writeFile(join(installed, "package.json"), JSON.stringify({ version: "1.1.0" }));
		});
		const { service } = harness({ manager });

		const receipt = await service.updatePackage("fixture-extension");

		expect(receipt.previousVersion).toBe("1.0.0");
		expect(receipt.version).toBe("1.1.0");
		expect(manager.installAndPersist).toHaveBeenCalledWith("npm:fixture-extension");
		await rm(root, { recursive: true, force: true });
	});

	it("rolls back an installed package to an explicit exact version", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-package-rollback-"));
		const installed = join(root, "node_modules", "fixture-extension");
		await mkdir(installed, { recursive: true });
		await writeFile(join(installed, "package.json"), JSON.stringify({ version: "1.1.0" }));
		const manager = managerFixture([{ source: "npm:fixture-extension", scope: "user" }]) as ReturnType<
			typeof managerFixture
		> & { getInstalledPath: ReturnType<typeof vi.fn> };
		manager.getInstalledPath = vi.fn(() => installed);
		manager.installAndPersist.mockImplementation(async (source: string) => {
			await writeFile(join(installed, "package.json"), JSON.stringify({ version: source.split("@").at(-1) }));
		});
		const { service } = harness({ manager });

		const receipt = await service.rollbackPackage("fixture-extension", "1.0.0");

		expect(receipt).toMatchObject({
			operation: "rollback",
			packageName: "fixture-extension",
			source: "npm:fixture-extension@1.0.0",
			previousVersion: "1.1.0",
			version: "1.0.0",
			status: "succeeded",
		});
		expect(receipt.events.map((event) => event.type)).toContain("rolled_back");
		expect(manager.installAndPersist).toHaveBeenCalledWith("npm:fixture-extension@1.0.0");
		await rm(root, { recursive: true, force: true });
	});
});
