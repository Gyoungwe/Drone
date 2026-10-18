import { describe, expect, it } from "vitest";
import {
	acceptInvitation,
	appendRevision,
	createWorkspace,
	inviteMember,
	resolveConflict,
	roleAllows,
} from "../src/index";

const clock = (() => {
	let tick = 0;
	return { now: () => `2026-10-18T00:00:0${tick++}Z`, id: (kind: string) => `${kind}-${tick++}` };
})();

describe("local-first collaboration", () => {
	it("enforces role boundaries and records invitation lifecycle", () => {
		expect(roleAllows("viewer", "write")).toBe(false);
		expect(roleAllows("editor", "write")).toBe(true);
		let workspace = createWorkspace({
			workspaceId: "ws-1",
			name: "Study",
			ownerId: "owner",
			ownerName: "Owner",
			clock,
		});
		const denied = inviteMember(
			workspace,
			"unknown",
			{ memberId: "editor", displayName: "Editor", role: "editor" },
			clock,
		);
		expect(denied.ok).toBe(false);
		const invited = inviteMember(
			workspace,
			"owner",
			{ memberId: "editor", displayName: "Editor", role: "editor" },
			clock,
		);
		expect(invited.ok).toBe(true);
		if (!invited.ok) return;
		workspace = invited.value;
		const accepted = acceptInvitation(workspace, "editor", clock);
		expect(accepted.ok).toBe(true);
		expect(accepted.ok && accepted.value.members.find((item) => item.memberId === "editor")?.status).toBe(
			"active",
		);
	});

	it("preserves both revisions on a stale CAS write and allows reviewer resolution", () => {
		let workspace = createWorkspace({
			workspaceId: "ws-2",
			name: "Study",
			ownerId: "owner",
			ownerName: "Owner",
			clock,
		});
		const invited = inviteMember(
			workspace,
			"owner",
			{ memberId: "editor", displayName: "Editor", role: "editor" },
			clock,
		);
		expect(invited.ok).toBe(true);
		if (!invited.ok) return;
		workspace = invited.value;
		const accepted = acceptInvitation(workspace, "editor", clock);
		expect(accepted.ok).toBe(true);
		if (!accepted.ok) return;
		workspace = accepted.value;
		const first = appendRevision(
			workspace,
			{ actorId: "editor", documentId: "note", parentRevisionId: null, contentHash: "sha256-a" },
			clock,
		);
		expect(first.ok && first.value.status).toBe("applied");
		if (!first.ok) return;
		workspace = first.value.workspace;
		const second = appendRevision(
			workspace,
			{
				actorId: "editor",
				documentId: "note",
				parentRevisionId: first.value.revisionId,
				contentHash: "sha256-b",
			},
			clock,
		);
		expect(second.ok && second.value.status).toBe("applied");
		if (!second.ok) return;
		workspace = second.value.workspace;
		const stale = appendRevision(
			workspace,
			{
				actorId: "editor",
				documentId: "note",
				parentRevisionId: first.value.revisionId,
				contentHash: "sha256-stale",
			},
			clock,
		);
		expect(stale.ok && stale.value.status).toBe("conflict");
		if (!stale.ok || !stale.value.conflictId) return;
		workspace = stale.value.workspace;
		expect(workspace.revisions).toHaveLength(3);
		expect(workspace.documents[0]?.revisionIds).toHaveLength(3);
		const resolved = resolveConflict(workspace, "owner", stale.value.conflictId, "remote", clock);
		expect(resolved.ok).toBe(true);
		expect(resolved.ok && resolved.value.conflicts[0]?.status).toBe("resolved");
		expect(resolved.ok && resolved.value.audit.some((event) => event.action === "revision-conflict")).toBe(
			true,
		);
	});
});
