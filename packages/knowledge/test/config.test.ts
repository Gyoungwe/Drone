import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	knowledgeDirectory,
	projectIdentity,
	readKnowledgeBinding,
	saveKnowledgeBinding,
	withKnowledgeBinding,
} from "../src/config";

let root: string;
let vault: string;

beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-knowledge-config-")));
	vault = join(root, "Vault");
	await mkdir(vault);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(root, "app"));
});

afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});

describe("knowledge binding", () => {
	it("derives stable identities and rejects an unconfigured relative directory", () => {
		expect(projectIdentity(join(root, "My project"))).toMatch(/^my-project-[a-f0-9]{10}$/);
		expect(projectIdentity(join(root, "My project"))).toBe(projectIdentity(join(root, "My project")));
		expect(projectIdentity(join(root, "ignored"), "project-a")).toBe("project-a");
		vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
		expect(knowledgeDirectory()).toBeNull();
		vi.stubEnv("DRONE_KNOWLEDGE_DIR", "relative");
		expect(() => knowledgeDirectory()).toThrow("must be absolute");
	});

	it("persists a binding atomically and scopes reads to its revision", async () => {
		expect(await readKnowledgeBinding()).toBeNull();
		const binding = await saveKnowledgeBinding({
			vault,
			profile: "hybrid",
			depositMode: "verified",
			subagentPolicy: "read-local",
		});
		expect(binding).toMatchObject({ version: 1, revision: 1, vault: await realpath(vault) });
		expect((await stat(join(root, "app"))).mode & 0o777).toBe(0o700);
		expect((await stat(join(root, "app", "binding.json"))).mode & 0o777).toBe(0o600);
		expect(JSON.parse(await readFile(join(root, "app", "binding.json"), "utf8"))).toMatchObject(binding);
		expect(await readKnowledgeBinding()).toEqual(binding);
		await expect(saveKnowledgeBinding({ ...binding, vault }, 0)).rejects.toThrow("changed");
		await expect(withKnowledgeBinding({ ...binding, revision: 2 }, () => "unreachable")).rejects.toThrow(
			"changed",
		);
		expect(await withKnowledgeBinding(binding, () => readKnowledgeBinding())).toEqual(binding);
	});

	it("rejects malformed bindings rather than falling back to project state", async () => {
		const path = join(root, "app", "binding.json");
		await mkdir(join(root, "app"), { recursive: true });
		await writeFile(path, JSON.stringify({ version: 1, vault: vault }));
		await expect(readKnowledgeBinding()).rejects.toThrow("Invalid application knowledge binding");
	});
});
