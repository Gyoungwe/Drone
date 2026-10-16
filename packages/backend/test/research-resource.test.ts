import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkKnowledgeSnapshotReuse } from "@drone/knowledge";
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
});
