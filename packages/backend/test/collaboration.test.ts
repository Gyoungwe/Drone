import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CollaborationService } from "../src/services/collaboration";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("CollaborationService", () => {
	it("persists a local-only workspace and records a CAS conflict without network access", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-collaboration-"));
		roots.push(root);
		const service = new CollaborationService({ agentDir: root, workspaceId: "ws", ownerId: "owner" });
		expect(service.transport).toBe("local-only");
		await service.inviteMember("owner", { memberId: "editor", displayName: "Editor", role: "editor" });
		await service.acceptInvitation("editor");
		const first = await service.appendRevision({
			actorId: "editor",
			documentId: "note",
			parentRevisionId: null,
			contentHash: "sha256-first",
		});
		expect(first.status).toBe("applied");
		const second = await service.appendRevision({
			actorId: "editor",
			documentId: "note",
			parentRevisionId: first.revisionId,
			contentHash: "sha256-second",
		});
		expect(second.status).toBe("applied");
		const stale = await service.appendRevision({
			actorId: "editor",
			documentId: "note",
			parentRevisionId: first.revisionId,
			contentHash: "sha256-stale",
		});
		expect(stale.status).toBe("conflict");
		expect(stale.conflictId).toBeTruthy();
		expect((await service.getWorkspace()).revisions).toHaveLength(3);
		await service.resolveConflict("owner", stale.conflictId as string, "remote");
		expect((await service.listConflicts())[0]?.status).toBe("resolved");
		expect((await service.listAudit()).map((event) => event.action)).toEqual(
			expect.arrayContaining([
				"workspace-created",
				"member-invited",
				"revision-conflict",
				"conflict-resolved",
			]),
		);
		service.dispose();
	});
});
