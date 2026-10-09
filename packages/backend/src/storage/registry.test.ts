import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createDefaultStorageRegistry, StorageRegistry } from "./registry";

describe("StorageRegistry", () => {
	it("covers every production JsonStore construction with a registered storage id", async () => {
		const backendSrc = resolve(dirname(fileURLToPath(import.meta.url)), "..");
		const roots = [backendSrc, resolve(backendSrc, "../../desktop/src/main")];
		const files: string[] = [];
		const visit = async (root: string): Promise<void> => {
			for (const entry of await readdir(root, { withFileTypes: true })) {
				const path = join(root, entry.name);
				if (entry.isDirectory()) await visit(path);
				else if (entry.isFile() && path.endsWith(".ts") && !path.endsWith(".test.ts")) files.push(path);
			}
		};
		for (const root of roots) await visit(root);
		const registryIds = new Set(
			createDefaultStorageRegistry({
				agentDir: "/tmp/drone-agent",
				userDataDir: "/tmp/drone-user-data",
				knowledgeDir: "/tmp/drone-knowledge",
			})
				.list()
				.map((entry) => entry.id),
		);
		const sites: string[] = [];
		for (const file of files) {
			const lines = (await readFile(file, "utf8")).split(/\r?\n/);
			for (let index = 0; index < lines.length; index += 1) {
				if (!/\bnew JsonStore(?:<|\s*\()/.test(lines[index] ?? "")) continue;
				const block = lines.slice(Math.max(0, index - 2), index + 32).join("\n");
				expect(block, `${file}:${index + 1} must declare storageId`).toMatch(/storageId\s*:/);
				const ids = [...block.matchAll(/"((?:agent|desktop)-[^"]+)"/g)]
					.map((match) => match[1])
					.filter((id): id is string => Boolean(id));
				expect(ids.length, `${file}:${index + 1} must reference a registry id`).toBeGreaterThan(0);
				for (const id of ids)
					expect(registryIds.has(id), `${file}:${index + 1} uses unregistered storage id ${id}`).toBe(true);
				sites.push(file);
			}
		}
		expect(sites).toHaveLength(26);
	});

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
		expect(entries.get("agent-mcp")).toMatchObject({
			path: "/tmp/drone-agent/mcp.json",
			owner: "mcp/service",
		});
	});

	it("registers the inquiry SQLite root and ledger when configured", () => {
		const registry = createDefaultStorageRegistry({
			agentDir: "/tmp/drone-agent",
			inquiryDir: "/tmp/drone-project/.drone",
		});
		expect(registry.get("inquiry-root")).toMatchObject({
			path: "/tmp/drone-project/.drone",
			owner: "inquiry",
		});
		expect(registry.get("inquiry-ledger")).toMatchObject({
			path: "/tmp/drone-project/.drone/ledger.sqlite",
			owner: "inquiry/ledger",
		});
	});

	it("registers discovered project roots idempotently", () => {
		const registry = new StorageRegistry();
		const first = registry.registerDiscoveredRoot(
			"project-work",
			"/tmp/project/.local/agent-work",
			"tools/channel-watch",
			"private",
		);
		const second = registry.registerDiscoveredRoot(
			"project-work",
			"/tmp/project/.local/agent-work",
			"tools/channel-watch",
			"private",
		);
		expect(second).toBe(first);
		expect(registry.list()).toHaveLength(1);
	});

	it("registers non-JsonStore roots with deterministic ids", () => {
		const options = {
			agentDir: "/tmp/drone-agent",
			userDataDir: "/tmp/drone-user-data",
			knowledgeDir: "/tmp/drone-knowledge",
			logDir: "/tmp/drone-logs",
			projectWorkRoots: ["/tmp/project/.local/agent-work"],
			knowledgeVaultRoots: ["/tmp/vault"],
			researchResultsRoots: ["/tmp/project/results"],
		} as const;
		const first = createDefaultStorageRegistry(options);
		const second = createDefaultStorageRegistry(options);
		for (const [prefix, path, owner] of [
			["agent-logs", "/tmp/drone-logs", "backend/logging"],
			["project-work-", "/tmp/project/.local/agent-work", "tools/channel-watch"],
			["knowledge-vault-", "/tmp/vault", "knowledge/wiki-review"],
			["research-results-", "/tmp/project/results", "research/provenance"],
		] as const) {
			const entry = first
				.list()
				.find((candidate) =>
					prefix.endsWith("-")
						? candidate.id.startsWith(prefix) && candidate.path === path
						: candidate.id === prefix,
				);
			expect(entry, `missing storage entry for ${path}`).toMatchObject({
				path,
				owner,
				sensitivity: "private",
			});
			expect(entry && second.get(entry.id)).toEqual(entry);
		}
		expect(first.get("agent-session-traces")).toMatchObject({
			path: "/tmp/drone-agent/sessions",
			owner: "session/traces",
		});
		expect(first.get("agent-subagent-sessions")).toMatchObject({
			path: "/tmp/drone-agent/sessions-subagents",
			owner: "subagents/session-engine",
		});
	});
});
