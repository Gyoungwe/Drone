import { mkdir, mkdtemp, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTopicMemory, topicRunHash } from "../../../.pi/lib/knowledge/topic-memory.mjs";

const binding = { vaultId: "0123456789abcdef01234567" };
const source = (path, fill = "a") => ({ path, hash: fill.repeat(64).slice(0, 64) });

describe("bounded topic memory", () => {
	it("persists by vault and project, deduplicates identical runs, and reopens", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-topic-memory-"));
		const store = createTopicMemory({ binding, project: "project-a", directory: root });
		const first = await store.record({
			topicId: "autotomy",
			title: "Autotomy",
			summary: "A bounded summary",
			sources: [source("Library/Papers/a.md")],
			runHash: topicRunHash("A", [source("Library/Papers/a.md")]),
		});
		expect(first.classification).toBe("new");
		const duplicate = await store.record({
			topicId: "autotomy",
			title: "Autotomy",
			summary: "A bounded summary",
			sources: [source("Library/Papers/a.md")],
			runHash: first.topic.lastRunHash,
		});
		expect(duplicate.classification).toBe("duplicate");
		const reopened = createTopicMemory({ binding, project: "project-a", directory: root });
		expect((await reopened.list()).topics[0].id).toBe("autotomy");
		const other = createTopicMemory({ binding, project: "project-b", directory: root });
		expect((await other.list()).topics).toEqual([]);
	});
	it("rejects stale revisions, corrupt/future documents and path escapes", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-topic-memory-"));
		const store = createTopicMemory({ binding, project: "project-a", directory: root });
		const created = await store.update({ id: "topic", title: "Topic" }, 0);
		await expect(store.update({ id: "topic", title: "Changed" }, 0)).rejects.toThrow("revision changed");
		const path = join(root, binding.vaultId, "topic-memory", "project-a.json");
		await writeFile(
			path,
			JSON.stringify({
				version: 99,
				vaultId: binding.vaultId,
				project: "project-a",
				revision: created.revision,
				topics: [],
			}),
		);
		await expect(store.list()).rejects.toThrow("schema version");
		await expect(
			store.record({ topicId: "x", title: "X", sources: [source("../secret.md")] }),
		).rejects.toThrow("schema version");
		const persisted = JSON.parse(await readFile(path, "utf8"));
		expect(persisted.version).toBe(99);
	});
	it("marks changed source stale and never follows a symlinked memory directory", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-topic-memory-"));
		const store = createTopicMemory({ binding, project: "project-a", directory: root });
		const hashA = source("Library/Papers/a.md", "a");
		await store.record({
			topicId: "topic",
			title: "Topic",
			summary: "same",
			sources: [hashA],
			runHash: "1".repeat(64),
		});
		const stale = await store.record({
			topicId: "topic",
			title: "Topic",
			summary: "same",
			sources: [source("Library/Papers/a.md", "b")],
			runHash: "2".repeat(64),
		});
		expect(stale.classification).toBe("stale");
		const root2 = await mkdtemp(join(tmpdir(), "drone-topic-memory-"));
		const outside = await mkdtemp(join(tmpdir(), "drone-topic-outside-"));
		await symlink(outside, join(root2, binding.vaultId));
		const linked = createTopicMemory({ binding, project: "project-b", directory: root2 });
		await expect(linked.list()).rejects.toThrow();
	});
	it("bounds compact context, rejects unsafe sources, and requires metadata CAS", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-topic-memory-"));
		const store = createTopicMemory({ binding, project: "project-a", directory: root });
		await expect(
			store.record({ topicId: "topic", title: "Topic", sources: [source("Projects/other/evidence.md")] }),
		).rejects.toThrow("out-of-scope");
		await expect(
			store.record({ topicId: "topic", title: "Topic", sources: [source("Runs/run.md")] }),
		).rejects.toThrow("out-of-scope");
		const created = await store.record({
			topicId: "topic",
			title: "Topic",
			summary: "x".repeat(4000),
			entities: ["Entity"],
			runHash: "1".repeat(64),
		});
		expect((await store.context(created.topic)).length).toBeLessThanOrEqual(2400);
		await expect(store.update({ id: "topic", source: "fake" }, created.revision)).rejects.toThrow(
			"Unsupported topic metadata field",
		);
		await expect(store.update({ id: "topic", title: "next" })).rejects.toThrow(
			"expectedRevision is required",
		);
	});
	it("serializes concurrent records and deduplicates an older run fingerprint", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-topic-memory-"));
		const a = createTopicMemory({ binding, project: "project-a", directory: root });
		await a.record({
			topicId: "topic",
			title: "Topic",
			summary: "one",
			runHash: "1".repeat(64),
		});
		await Promise.all([
			a.record({ topicId: "topic", title: "Topic", summary: "two", runHash: "2".repeat(64) }),
			a.record({ topicId: "topic", title: "Topic", summary: "three", runHash: "3".repeat(64) }),
		]);
		const duplicate = await a.record({
			topicId: "topic",
			title: "Topic",
			summary: "one",
			runHash: "1".repeat(64),
		});
		expect(duplicate.classification).toBe("duplicate");
		expect((await a.read()).revision).toBe(3);
	});
	it("refreshes source hashes without creating evidence receipts", async () => {
		const vault = await mkdtemp(join(tmpdir(), "drone-topic-vault-"));
		await mkdir(join(vault, "Library"));
		await writeFile(join(vault, "Library", "a.md"), "old");
		const root = await mkdtemp(join(tmpdir(), "drone-topic-memory-"));
		const hash = (await import("node:crypto")).createHash("sha256").update("old").digest("hex");
		const store = createTopicMemory({
			binding: { ...binding, vault },
			project: "project-a",
			directory: root,
		});
		await store.record({
			topicId: "topic",
			title: "Topic",
			sources: [{ path: "Library/a.md", hash }],
			runHash: "1".repeat(64),
		});
		await writeFile(join(vault, "Library", "a.md"), "new");
		expect((await store.refreshSourceCheck("topic")).status).toBe("stale");
		await unlink(join(vault, "Library", "a.md"));
		expect((await store.refreshSourceCheck("topic")).stale[0].reason).toMatch(/missing/);
	});
	it("retains bounded history and rejects a leaf memory symlink after ten turns", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-topic-memory-"));
		const store = createTopicMemory({ binding, project: "project-a", directory: root });
		for (let i = 0; i < 10; i++)
			await store.record({
				topicId: "topic",
				title: "Topic",
				summary: `finding ${i}`,
				keyFindings: [`finding-${i}`],
				artifacts: [`artifact-${i}`],
				runHash: `${String(i + 10)
					.repeat(64)
					.slice(0, 64)}`,
			});
		const topic = (await store.get("topic")).matches[0];
		expect(topic.history.length).toBeLessThanOrEqual(8);
		expect(topic.keyFindings.length).toBe(10);
		const path = join(root, binding.vaultId, "topic-memory", "project-a.json");
		const outside = await mkdtemp(join(tmpdir(), "drone-topic-outside-"));
		await unlink(path);
		await symlink(join(outside, "memory.json"), path);
		await expect(store.list()).rejects.toThrow(/symlink|regular file/);
	});
	it("stores both claims and a pending conflict record without replacing the old claim", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-topic-memory-"));
		const store = createTopicMemory({ binding, project: "project-a", directory: root });
		const oldClaim = {
			claim: "Wg activates wing-margin growth",
			subject: "Wg",
			predicate: "activates",
			value: "wing-margin growth",
			organism: "Drosophila melanogaster",
			tissue: "wing disc",
			stage: "third instar",
			method: "RNAi",
			sourcePath: "Library/Papers/a.md",
			sourceHash: "a".repeat(64),
			relation: "observation",
		};
		await store.record({ topicId: "wing", title: "Wing", summary: "wing", claims: [oldClaim] });
		const next = await store.record({
			topicId: "wing",
			title: "Wing",
			summary: "wing",
			claims: [
				{
					...oldClaim,
					claim: "Wg does not activate wing-margin growth",
					value: "does not activate wing-margin growth",
					sourcePath: "Library/Papers/b.md",
					sourceHash: "b".repeat(64),
				},
			],
		});
		expect(next.classification).toBe("conflict-candidate");
		expect(next.conflicts[0]).toMatchObject({ relation: "contradicts", blocking: true });
		const topic = (await store.get("wing")).matches[0];
		expect(topic.claims).toHaveLength(2);
		expect(topic.conflicts[0].relation).toBe("contradicts");
	});
});
