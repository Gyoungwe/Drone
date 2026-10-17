import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readNoteFile } from "@drone/knowledge/files";
import { createTopicMemory, topicRunHash } from "@drone/knowledge/topic-memory";
import { describe, expect, it } from "vitest";

const MARKER = "DRONE-MEM-001";
const bindingId = "0123456789abcdef01234567";

describe("MEM-01 isolated cross-session acceptance", () => {
	it("restores the marker from a new memory instance and blocks stale source context", async () => {
		const vault = await mkdtemp(join(tmpdir(), "drone-mem-gate-vault-"));
		const vaultRoot = await realpath(vault);
		const directory = await mkdtemp(join(tmpdir(), "drone-mem-gate-memory-"));
		const sourcePath = "Library/memory-note.md";
		const sourceText = `# Memory acceptance\n\nUnique marker: ${MARKER}\n\nThe source is intentionally local and disposable.\n`;
		await mkdir(join(vault, "Library"), { recursive: true });
		await writeFile(join(vault, sourcePath), sourceText, { mode: 0o600 });
		const source = await readNoteFile(vaultRoot, sourcePath);
		const summary = `Recovered topic contains ${MARKER} and the memory-note source.`;
		const sourceRef = { path: sourcePath, hash: source.hash };
		const runHash = topicRunHash(summary, [sourceRef]);
		const memoryOptions = {
			binding: { vaultId: bindingId, vault: vaultRoot },
			project: "mem-gate",
			directory,
		};

		// Session A writes the bounded topic and then goes out of scope.
		const sessionA = createTopicMemory(memoryOptions);
		const recorded = await sessionA.record({
			topicId: "drone-mem-001",
			title: "Memory acceptance",
			summary,
			unresolvedQuestions: ["Does the marker survive a fresh process?"],
			sources: [sourceRef],
			lastRunId: "mem-session-a",
			runHash,
		});
		expect(recorded.classification).toBe("new");

		// Session B is a fresh service instance reading the persisted JSON document.
		const sessionB = createTopicMemory(memoryOptions);
		const restored = await sessionB.get("drone-mem-001");
		const topic = restored.matches[0];
		expect(topic).toMatchObject({
			title: "Memory acceptance",
			lastRunId: "mem-session-a",
			sources: [sourceRef],
		});
		const context = await sessionB.context("drone-mem-001");
		expect(context).toContain(MARKER);
		expect(topic.unresolvedQuestions).toContain("Does the marker survive a fresh process?");
		expect(await readFile(join(vaultRoot, sourcePath), "utf8")).toContain(MARKER);

		// A changed source must invalidate the restored context before reuse.
		const changedText = `${sourceText}\nChanged after session A.\n`;
		await writeFile(join(vaultRoot, sourcePath), changedText, { mode: 0o600 });
		const freshness = await sessionB.refreshSourceCheck("drone-mem-001");
		expect(freshness.status).toBe("stale");
		expect(freshness.stale).toEqual([{ path: sourcePath, reason: "changed" }]);
		expect((await sessionB.get("drone-mem-001")).matches[0].status).toBe("stale");

		const evidence = {
			gate: "MEM-01",
			marker: MARKER,
			mode: "isolated-cross-session",
			memoryRevision: recorded.revision,
			restored: {
				topicId: topic.id,
				title: topic.title,
				contextContainsMarker: context.includes(MARKER),
				sourcePath,
				sourceHash: source.hash,
			},
			stale: freshness.stale,
			status: freshness.status,
		};
		await writeFile("/private/tmp/drone-mem-001-evidence.json", `${JSON.stringify(evidence, null, 2)}\n`, {
			mode: 0o600,
		});
		expect(evidence.restored.contextContainsMarker).toBe(true);
	});
});
