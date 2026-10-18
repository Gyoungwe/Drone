/**
 * Local-first collaboration contracts.
 *
 * The package deliberately stores revision metadata and content hashes only.
 * Document bodies stay in the caller's project/Vault and can never enter the
 * collaboration ledger by accident. Cloud transport is a later adapter; the
 * domain remains usable by desktop, CLI and tests without a network.
 */

export const COLLABORATION_SCHEMA_VERSION = 1 as const;

export type CollaborationRole = "owner" | "editor" | "reviewer" | "viewer";
export type CollaborationMemberStatus = "active" | "invited" | "revoked";
export type CollaborationAction = "read" | "propose" | "write" | "review" | "manage-members" | "export";
export type CollaborationAuditAction =
	| "workspace-created"
	| "member-invited"
	| "member-accepted"
	| "member-revoked"
	| "revision-appended"
	| "revision-conflict"
	| "conflict-resolved";
export type CollaborationConflictStatus = "open" | "resolved";
export type CollaborationResolution = "local" | "remote" | "manual";

export interface CollaborationMember {
	readonly memberId: string;
	readonly displayName: string;
	readonly role: CollaborationRole;
	readonly status: CollaborationMemberStatus;
	readonly invitedAt: string;
	readonly joinedAt?: string;
	readonly revokedAt?: string;
}

export interface DocumentRevision {
	readonly revisionId: string;
	readonly documentId: string;
	readonly parentRevisionId: string | null;
	readonly contentHash: string;
	readonly authorId: string;
	readonly createdAt: string;
}

export interface CollaborationDocument {
	readonly documentId: string;
	readonly currentRevisionId: string | null;
	readonly revisionIds: readonly string[];
}

export interface CollaborationConflict {
	readonly conflictId: string;
	readonly documentId: string;
	readonly baseRevisionId: string | null;
	readonly localRevisionId: string;
	readonly remoteRevisionId: string;
	readonly status: CollaborationConflictStatus;
	readonly resolution?: CollaborationResolution;
	readonly createdAt: string;
	readonly resolvedAt?: string;
	readonly resolvedBy?: string;
}

export interface CollaborationAuditEvent {
	readonly eventId: string;
	readonly action: CollaborationAuditAction;
	readonly actorId: string;
	readonly at: string;
	readonly subjectId: string;
	readonly detail?: string;
}

export interface CollaborationWorkspace {
	readonly schemaVersion: typeof COLLABORATION_SCHEMA_VERSION;
	readonly workspaceId: string;
	readonly name: string;
	readonly revision: number;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly members: readonly CollaborationMember[];
	readonly documents: readonly CollaborationDocument[];
	readonly revisions: readonly DocumentRevision[];
	readonly conflicts: readonly CollaborationConflict[];
	readonly audit: readonly CollaborationAuditEvent[];
}

export interface CollaborationClock {
	readonly now: () => string;
	readonly id: (kind: string) => string;
}

export const defaultCollaborationClock: CollaborationClock = {
	now: () => new Date().toISOString(),
	id: (kind) => `${kind}-${cryptoRandomId()}`,
};

function cryptoRandomId(): string {
	// Avoid a Node-only import so this package can be used in browser hosts.
	return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export interface CreateWorkspaceInput {
	readonly workspaceId: string;
	readonly name: string;
	readonly ownerId: string;
	readonly ownerName: string;
	readonly clock?: CollaborationClock;
}

function audit(
	_workspace: CollaborationWorkspace,
	action: CollaborationAuditAction,
	actorId: string,
	subjectId: string,
	detail: string | undefined,
	clock: CollaborationClock,
): CollaborationAuditEvent {
	return {
		eventId: clock.id("audit"),
		action,
		actorId,
		at: clock.now(),
		subjectId,
		...(detail ? { detail } : {}),
	};
}

export function createWorkspace(input: CreateWorkspaceInput): CollaborationWorkspace {
	const clock = input.clock ?? defaultCollaborationClock;
	const now = clock.now();
	const owner: CollaborationMember = {
		memberId: input.ownerId,
		displayName: input.ownerName,
		role: "owner",
		status: "active",
		invitedAt: now,
		joinedAt: now,
	};
	const workspace: CollaborationWorkspace = {
		schemaVersion: COLLABORATION_SCHEMA_VERSION,
		workspaceId: input.workspaceId,
		name: input.name,
		revision: 1,
		createdAt: now,
		updatedAt: now,
		members: [owner],
		documents: [],
		revisions: [],
		conflicts: [],
		audit: [],
	};
	return {
		...workspace,
		audit: [audit(workspace, "workspace-created", input.ownerId, input.workspaceId, undefined, clock)],
	};
}

export function roleAllows(role: CollaborationRole, action: CollaborationAction): boolean {
	if (role === "owner") return true;
	if (role === "reviewer")
		return action === "read" || action === "propose" || action === "review" || action === "export";
	if (role === "editor")
		return action === "read" || action === "propose" || action === "write" || action === "export";
	return action === "read";
}

function member(workspace: CollaborationWorkspace, memberId: string): CollaborationMember | undefined {
	return workspace.members.find((item) => item.memberId === memberId && item.status === "active");
}

function authorized(
	workspace: CollaborationWorkspace,
	actorId: string,
	action: CollaborationAction,
): boolean {
	const current = member(workspace, actorId);
	return current ? roleAllows(current.role, action) : false;
}

export type CollaborationResult<T> =
	| { readonly ok: true; readonly value: T }
	| {
			readonly ok: false;
			readonly error: "not-found" | "forbidden" | "invalid" | "conflict";
			readonly detail: string;
	  };

export interface MemberInvitation {
	readonly memberId: string;
	readonly displayName: string;
	readonly role: Exclude<CollaborationRole, "owner">;
}

export function inviteMember(
	workspace: CollaborationWorkspace,
	actorId: string,
	invitation: MemberInvitation,
	clock: CollaborationClock = defaultCollaborationClock,
): CollaborationResult<CollaborationWorkspace> {
	if (!authorized(workspace, actorId, "manage-members"))
		return { ok: false, error: "forbidden", detail: "Only the owner can manage members" };
	if (!invitation.memberId.trim() || workspace.members.some((item) => item.memberId === invitation.memberId))
		return { ok: false, error: "invalid", detail: "Member already exists or has an empty id" };
	const now = clock.now();
	const next = {
		...workspace,
		revision: workspace.revision + 1,
		updatedAt: now,
		members: [...workspace.members, { ...invitation, status: "invited" as const, invitedAt: now }],
	};
	return {
		ok: true,
		value: {
			...next,
			audit: [
				...workspace.audit,
				audit(next, "member-invited", actorId, invitation.memberId, invitation.role, clock),
			],
		},
	};
}

export function acceptInvitation(
	workspace: CollaborationWorkspace,
	actorId: string,
	clock: CollaborationClock = defaultCollaborationClock,
): CollaborationResult<CollaborationWorkspace> {
	const existing = workspace.members.find((item) => item.memberId === actorId);
	if (!existing) return { ok: false, error: "not-found", detail: "Invitation not found" };
	if (existing.status !== "invited")
		return { ok: false, error: "invalid", detail: "Invitation is not pending" };
	const now = clock.now();
	const next = {
		...workspace,
		revision: workspace.revision + 1,
		updatedAt: now,
		members: workspace.members.map((item) =>
			item.memberId === actorId ? { ...item, status: "active" as const, joinedAt: now } : item,
		),
	};
	return {
		ok: true,
		value: {
			...next,
			audit: [...workspace.audit, audit(next, "member-accepted", actorId, actorId, undefined, clock)],
		},
	};
}

export function revokeMember(
	workspace: CollaborationWorkspace,
	actorId: string,
	targetMemberId: string,
	clock: CollaborationClock = defaultCollaborationClock,
): CollaborationResult<CollaborationWorkspace> {
	if (!authorized(workspace, actorId, "manage-members"))
		return { ok: false, error: "forbidden", detail: "Only the owner can manage members" };
	if (targetMemberId === workspace.members.find((item) => item.role === "owner")?.memberId)
		return { ok: false, error: "invalid", detail: "The workspace owner cannot be revoked" };
	const existing = workspace.members.find((item) => item.memberId === targetMemberId);
	if (!existing) return { ok: false, error: "not-found", detail: "Member not found" };
	const now = clock.now();
	const next = {
		...workspace,
		revision: workspace.revision + 1,
		updatedAt: now,
		members: workspace.members.map((item) =>
			item.memberId === targetMemberId ? { ...item, status: "revoked" as const, revokedAt: now } : item,
		),
	};
	return {
		ok: true,
		value: {
			...next,
			audit: [...workspace.audit, audit(next, "member-revoked", actorId, targetMemberId, undefined, clock)],
		},
	};
}

export interface AppendRevisionInput {
	readonly actorId: string;
	readonly documentId: string;
	readonly parentRevisionId: string | null;
	readonly contentHash: string;
}

export interface AppendRevisionValue {
	readonly workspace: CollaborationWorkspace;
	readonly revisionId: string;
	readonly status: "applied" | "conflict";
	readonly conflictId?: string;
}

export function appendRevision(
	workspace: CollaborationWorkspace,
	input: AppendRevisionInput,
	clock: CollaborationClock = defaultCollaborationClock,
): CollaborationResult<AppendRevisionValue> {
	if (!authorized(workspace, input.actorId, "write"))
		return { ok: false, error: "forbidden", detail: "An active editor or owner is required" };
	if (!input.documentId.trim() || !input.contentHash.trim())
		return { ok: false, error: "invalid", detail: "Document id and content hash are required" };
	const current = workspace.documents.find((item) => item.documentId === input.documentId);
	const currentRevisionId = current?.currentRevisionId ?? null;
	if (input.parentRevisionId !== currentRevisionId && input.parentRevisionId !== null && !currentRevisionId)
		return { ok: false, error: "conflict", detail: "The parent revision is unknown" };
	const now = clock.now();
	const revisionId = clock.id("revision");
	const revision: DocumentRevision = {
		revisionId,
		documentId: input.documentId,
		parentRevisionId: input.parentRevisionId,
		contentHash: input.contentHash,
		authorId: input.actorId,
		createdAt: now,
	};
	const revisions = [...workspace.revisions, revision];
	const base = {
		...workspace,
		revision: workspace.revision + 1,
		updatedAt: now,
		revisions,
	};
	const conflict = input.parentRevisionId !== currentRevisionId;
	if (conflict) {
		const conflictId = clock.id("conflict");
		const record: CollaborationConflict = {
			conflictId,
			documentId: input.documentId,
			baseRevisionId: input.parentRevisionId,
			localRevisionId: currentRevisionId as string,
			remoteRevisionId: revisionId,
			status: "open",
			createdAt: now,
		};
		const next = {
			...base,
			documents: workspace.documents.map((item) =>
				item.documentId === input.documentId
					? { ...item, revisionIds: [...item.revisionIds, revisionId] }
					: item,
			),
			conflicts: [...workspace.conflicts, record],
			audit: [
				...workspace.audit,
				audit(base, "revision-conflict", input.actorId, input.documentId, conflictId, clock),
			],
		};
		return { ok: true, value: { workspace: next, revisionId, status: "conflict", conflictId } };
	}
	const document: CollaborationDocument = current
		? { ...current, currentRevisionId: revisionId, revisionIds: [...current.revisionIds, revisionId] }
		: { documentId: input.documentId, currentRevisionId: revisionId, revisionIds: [revisionId] };
	const next = {
		...base,
		documents: current
			? workspace.documents.map((item) => (item.documentId === input.documentId ? document : item))
			: [...workspace.documents, document],
		audit: [
			...workspace.audit,
			audit(base, "revision-appended", input.actorId, input.documentId, revisionId, clock),
		],
	};
	return { ok: true, value: { workspace: next, revisionId, status: "applied" } };
}

export function resolveConflict(
	workspace: CollaborationWorkspace,
	actorId: string,
	conflictId: string,
	resolution: CollaborationResolution,
	clock: CollaborationClock = defaultCollaborationClock,
): CollaborationResult<CollaborationWorkspace> {
	if (!authorized(workspace, actorId, "review"))
		return { ok: false, error: "forbidden", detail: "A reviewer or owner is required" };
	const conflict = workspace.conflicts.find((item) => item.conflictId === conflictId);
	if (!conflict) return { ok: false, error: "not-found", detail: "Conflict not found" };
	if (conflict.status !== "open")
		return { ok: false, error: "invalid", detail: "Conflict is already resolved" };
	if (resolution === "manual")
		return { ok: false, error: "invalid", detail: "Manual resolution must append a reviewed revision first" };
	const chosenRevisionId = resolution === "remote" ? conflict.remoteRevisionId : conflict.localRevisionId;
	const now = clock.now();
	const next = {
		...workspace,
		revision: workspace.revision + 1,
		updatedAt: now,
		documents: workspace.documents.map((item) =>
			item.documentId === conflict.documentId ? { ...item, currentRevisionId: chosenRevisionId } : item,
		),
		conflicts: workspace.conflicts.map((item) =>
			item.conflictId === conflictId
				? { ...item, status: "resolved" as const, resolution, resolvedAt: now, resolvedBy: actorId }
				: item,
		),
	};
	return {
		ok: true,
		value: {
			...next,
			audit: [...workspace.audit, audit(next, "conflict-resolved", actorId, conflictId, resolution, clock)],
		},
	};
}
