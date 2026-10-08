import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveKnowledgeBinding } from "@drone/knowledge/config";
import type { KnowledgeCloudNote } from "@drone/shared";
import { afterEach, describe, expect, it } from "vitest";
import { syncCloudNotes } from "./webdav-sync";
import { KnowledgeWebDavError } from "./webdav-transport";

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
	delete process.env.DRONE_KNOWLEDGE_DIR;
});

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "drone-webdav-sync-"));
	roots.push(root);
	const vault = join(root, "Vault");
	await mkdir(vault, { recursive: true });
	process.env.DRONE_KNOWLEDGE_DIR = join(root, "state");
	const binding = await saveKnowledgeBinding({
		vault,
		profile: "hybrid",
		depositMode: "verified",
		subagentPolicy: "none",
	});
	return { vault, binding };
}

describe("syncCloudNotes", () => {
	it("pushes only a missing note and reports the explicit boundary", async () => {
		const { vault, binding } = await fixture();
		await writeFile(join(vault, "Home.md"), "# local\n");
		const cloud = {
			read: async () => {
				throw new KnowledgeWebDavError("not_found", "missing");
			},
			write: async (input: { path: string; text: string }) => ({
				path: input.path,
				status: "created" as const,
				version: '"v1"',
				hash: "hash",
				message: null,
			}),
		};
		const result = await syncCloudNotes(cloud, {
			mode: "push",
			bindingRevision: binding.revision,
			paths: ["Home.md"],
		});
		expect(result.completed).toBe(true);
		expect(result.items[0]?.status).toBe("pushed");
		expect(result.warnings[0]).toContain("不代表整个知识库已同步");
	});

	it("keeps a divergent remote copy as a conflict", async () => {
		const { vault, binding } = await fixture();
		await writeFile(join(vault, "Home.md"), "# local\n");
		const remote: KnowledgeCloudNote = {
			path: "Home.md",
			text: "# remote\n",
			hash: "remote-hash",
			version: '"v2"',
			bytes: 9,
			lastModified: null,
		};
		const cloud = {
			read: async () => remote,
			write: async () => {
				throw new Error("must not write");
			},
		};
		const result = await syncCloudNotes(cloud, {
			mode: "push",
			bindingRevision: binding.revision,
			paths: ["Home.md"],
		});
		expect(result.completed).toBe(false);
		expect(result.items[0]?.status).toBe("conflict");
	});
});
