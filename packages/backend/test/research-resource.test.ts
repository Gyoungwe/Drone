import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkKnowledgeSnapshotReuse } from "@drone/knowledge/host";
import { type ResearchConnector, ResearchConnectorRegistry } from "@drone/research";
import { describe, expect, it } from "vitest";
import { JsonStore } from "../src/json-store";
import {
	type CaptureLedger,
	emptyCaptureLedger,
	ResearchResourceService,
} from "../src/services/research-resource";

async function service(): Promise<ResearchResourceService> {
	const state = await mkdtemp(join(tmpdir(), "drone-research-state-"));
	return new ResearchResourceService({
		store: new JsonStore<CaptureLedger>({
			path: join(state, "captures.json"),
			storageId: "test-research-captures",
			defaultValue: emptyCaptureLedger,
		}),
	});
}

describe("ResearchResourceService", () => {
	it("captures safely, is idempotent, and keeps the snapshot pending", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-research-project-"));
		await writeFile(join(root, "notes.md"), "A small research note\n", "utf8");
		const research = await service();
		const first = await research.capture({ cwd: root, relativePath: "notes.md" });
		const duplicate = await research.capture({ cwd: root, relativePath: "notes.md" });
		expect(first.idempotent).toBe(false);
		expect(duplicate.idempotent).toBe(true);
		expect(first.record.approval).toBe("pending");
		expect(
			checkKnowledgeSnapshotReuse(first.record.snapshot, {
				context: {
					projectId: first.record.snapshot.projectId!,
					workspaceId: first.record.snapshot.workspaceId!,
				},
			}).status,
		).toBe("pending-approval");
		const approved = await research.approve(first.record.id);
		expect(approved.approval).toBe("approved");
		expect(approved.revision).toBe(1);
		expect(
			checkKnowledgeSnapshotReuse(approved.snapshot, {
				context: { projectId: approved.snapshot.projectId!, workspaceId: approved.snapshot.workspaceId! },
			}).reusable,
		).toBe(true);
	});

	it("covers empty projects, Unicode and long paths, compressed scientific formats, and unknown binaries", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-research-project-"));
		const research = await service();
		expect(await research.list(root)).toEqual([]);

		const longSegment = "x".repeat(180);
		const directory = join(root, "中文研究", longSegment);
		await mkdir(directory, { recursive: true });
		const fixtures = [
			["reads.fastq.gz", Buffer.from("@read1\\nACGT\\n+\\nIIII\\n")],
			["variants.vcf.gz", Buffer.from("##fileformat=VCFv4.3\\n")],
			["aligned.bam", Buffer.from([0x42, 0x41, 0x4d, 0x01])],
			["mystery", Buffer.from([0x00, 0x01, 0x02, 0x03])],
		] as const;
		const captures = [];
		for (const [name, bytes] of fixtures) {
			await writeFile(join(directory, name), bytes);
			captures.push(await research.capture({ cwd: root, relativePath: join("中文研究", longSegment, name) }));
		}
		expect(captures.map(({ record }) => record.format)).toEqual(["fastq", "vcf", "bam", "binary"]);
		expect(captures.every(({ idempotent }) => !idempotent)).toBe(true);
	});

	it("creates a new revision when file bytes change and rejects root escape", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-research-project-"));
		await writeFile(join(root, "notes.txt"), "first", "utf8");
		const research = await service();
		const first = await research.capture({ cwd: root, relativePath: "notes.txt" });
		await writeFile(join(root, "notes.txt"), "second", "utf8");
		const changed = await research.capture({ cwd: root, relativePath: "notes.txt" });
		expect(changed.idempotent).toBe(false);
		expect(changed.record.revision).toBe(1);
		await expect(research.capture({ cwd: root, relativePath: "../outside.txt" })).rejects.toThrow(
			/escapes project root/,
		);
		const outside = await mkdtemp(join(tmpdir(), "drone-research-outside-"));
		await writeFile(join(outside, "secret.txt"), "secret", "utf8");
		await symlink(join(outside, "secret.txt"), join(root, "link.txt"));
		await expect(research.capture({ cwd: root, relativePath: "link.txt" })).rejects.toThrow(
			/escapes project root/,
		);
		expect(first.record.sourceReceipt.contentHash).not.toBe(changed.record.sourceReceipt.contentHash);
	});

	it("lists captures through a symlinked project root", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-research-project-"));
		const aliasParent = await mkdtemp(join(tmpdir(), "drone-research-alias-"));
		const alias = join(aliasParent, "project");
		await writeFile(join(root, "notes.md"), "A note", "utf8");
		await symlink(root, alias);
		const research = await service();
		const captured = await research.capture({ cwd: root, relativePath: "notes.md" });
		expect((await research.list(alias)).map((item) => item.id)).toEqual([captured.record.id]);
	});

	it("keeps project and workspace captures distinct", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-research-project-"));
		await writeFile(join(root, "notes.md"), "A note", "utf8");
		const research = await service();
		const project = await research.capture({ cwd: root, relativePath: "notes.md", scope: "project" });
		const workspace = await research.capture({ cwd: root, relativePath: "notes.md", scope: "workspace" });
		expect(workspace.idempotent).toBe(false);
		expect(workspace.record.id).not.toBe(project.record.id);
		expect(workspace.record.scope).toBe("workspace");
	});

	it("blocks an approved capture after its source freshness expires", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-research-project-"));
		await writeFile(join(root, "notes.md"), "A time-bounded note", "utf8");
		const research = await service();
		const captured = await research.capture({
			cwd: root,
			relativePath: "notes.md",
			expiresAt: "2026-10-15T23:59:59.000Z",
		});
		const approved = await research.approve(captured.record.id);
		const expired = checkKnowledgeSnapshotReuse(approved.snapshot, {
			context: { projectId: approved.snapshot.projectId!, workspaceId: approved.snapshot.workspaceId! },
			now: "2026-10-16T00:00:00.000Z",
		});
		expect(expired.reusable).toBe(false);
		expect(expired.status).toBe("stale");
		expect(expired.reasons).toContain("one or more source receipts are stale");

		const revoked = await research.revoke(approved.id);
		const revokedDecision = checkKnowledgeSnapshotReuse(revoked.snapshot, {
			context: { projectId: revoked.snapshot.projectId!, workspaceId: revoked.snapshot.workspaceId! },
			now: "2026-10-16T00:00:00.000Z",
		});
		expect(revokedDecision.reusable).toBe(false);
		expect(revokedDecision.status).toBe("revoked");
	});

	it("refreshes an unchanged file after its receipt expires", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-research-project-"));
		await writeFile(join(root, "notes.md"), "A time-bounded note", "utf8");
		const research = await service();
		const first = await research.capture({
			cwd: root,
			relativePath: "notes.md",
			expiresAt: "2026-10-15T23:59:59.000Z",
		});
		const duplicate = await research.capture({
			cwd: root,
			relativePath: "notes.md",
			expiresAt: "2026-10-17T23:59:59.000Z",
		});
		expect(duplicate.idempotent).toBe(false);
		expect(duplicate.record.id).toBe(first.record.id);
		expect(duplicate.record.revision).toBe(first.record.revision + 1);
		expect(duplicate.record.approval).toBe("pending");
		expect(duplicate.record.sourceReceipt.freshness?.expiresAt).toBe("2026-10-17T23:59:59.000Z");
		expect((await research.list()).map((item) => item.id)).toEqual([first.record.id]);
	});

	it("persists connector toggles and blocks disabled searches", async () => {
		const state = await mkdtemp(join(tmpdir(), "drone-research-connectors-"));
		let calls = 0;
		const connector: ResearchConnector = {
			id: "fixture",
			kind: "dataset",
			label: "Fixture dataset",
			search: async () => {
				calls += 1;
				return [];
			},
		};
		const registry = new ResearchConnectorRegistry([connector]);
		const settings = new JsonStore({
			path: join(state, "connectors.json"),
			storageId: "test-research-connectors",
			defaultValue: () => ({ version: 1 as const, disabled: [] }),
		});
		const first = new ResearchResourceService({
			store: new JsonStore({
				path: join(state, "captures-a.json"),
				storageId: "test-research-captures-a",
				defaultValue: emptyCaptureLedger,
			}),
			connectors: registry,
			connectorSettings: settings,
		});
		expect((await first.listConnectors())[0]).toMatchObject({ id: "fixture", enabled: true });
		expect(await first.setConnectorEnabled("fixture", false)).toMatchObject({ enabled: false });

		const second = new ResearchResourceService({
			store: new JsonStore({
				path: join(state, "captures-b.json"),
				storageId: "test-research-captures-b",
				defaultValue: emptyCaptureLedger,
			}),
			connectors: registry,
			connectorSettings: settings,
		});
		expect((await second.listConnectors())[0]).toMatchObject({ id: "fixture", enabled: false });
		const result = await second.search({ query: "dataset", connectorIds: ["fixture"] });
		expect(result.complete).toBe(false);
		expect(result.failures).toEqual([
			expect.objectContaining({ connectorId: "fixture", message: "Research connector is disabled" }),
		]);
		expect(calls).toBe(0);
	});
});
