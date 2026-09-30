import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultStorageRegistry, StorageRegistry } from "./registry";

describe("StorageRegistry", () => {
	it("rejects duplicate entries and inventories file state", async () => {
		const dir = await mkdtemp(join(tmpdir(), "drone-storage-"));
		const path = join(dir, "settings.json");
		await writeFile(path, "{}", "utf8");
		const registry = new StorageRegistry().register({
			id: "settings",
			path,
			owner: "settings",
			schema: 1,
			sensitivity: "config",
		});
		expect(() => registry.register({ ...registry.assertRegistered("settings") })).toThrow(
			/already registered/,
		);
		expect((await registry.inspect())[0]).toMatchObject({ id: "settings", status: "ok", bytes: 2 });
	});

	it("distinguishes missing storage from unreadable metadata", async () => {
		const registry = new StorageRegistry().register({
			id: "missing",
			path: join(tmpdir(), "drone-no-such-storage"),
			owner: "test",
			schema: 1,
			sensitivity: "private",
		});
		expect((await registry.inspect())[0]?.status).toBe("missing");
	});

	it("registers desktop durable state alongside agent state", () => {
		const entries = createDefaultStorageRegistry({
			agentDir: "/tmp/drone-agent",
			userDataDir: "/tmp/drone-user-data",
			knowledgeDir: "/tmp/drone-knowledge",
		});
		expect(entries.get("desktop-ui-plugins-config")).toMatchObject({
			path: "/tmp/drone-user-data/ui-plugins.json",
			owner: "desktop/ui-plugins",
		});
		expect(entries.get("desktop-ui-plugins")).toMatchObject({
			path: "/tmp/drone-user-data/ui-plugins",
			owner: "desktop/ui-plugins",
		});
	});
});
