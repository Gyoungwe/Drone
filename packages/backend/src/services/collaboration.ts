import { join } from "node:path";
import {
	type AppendRevisionInput,
	acceptInvitation,
	appendRevision,
	type CollaborationClock,
	type CollaborationConflict,
	type CollaborationMember,
	type CollaborationResolution,
	type CollaborationWorkspace,
	createWorkspace,
	defaultCollaborationClock,
	inviteMember,
	type MemberInvitation,
	resolveConflict,
	revokeMember,
} from "@drone/collaboration";
import { JsonStore } from "../json-store";

export interface CollaborationServicePort {
	readonly transport: "local-only";
	getWorkspace(): Promise<CollaborationWorkspace>;
	listMembers(): Promise<readonly CollaborationMember[]>;
	listConflicts(): Promise<readonly CollaborationConflict[]>;
	listAudit(): Promise<CollaborationWorkspace["audit"]>;
	inviteMember(actorId: string, invitation: MemberInvitation): Promise<CollaborationWorkspace>;
	acceptInvitation(actorId: string): Promise<CollaborationWorkspace>;
	revokeMember(actorId: string, memberId: string): Promise<CollaborationWorkspace>;
	appendRevision(input: AppendRevisionInput): Promise<{
		status: "applied" | "conflict";
		revisionId: string;
		conflictId?: string;
	}>;
	resolveConflict(
		actorId: string,
		conflictId: string,
		resolution: CollaborationResolution,
	): Promise<CollaborationWorkspace>;
	dispose(): void;
}

export interface CollaborationServiceOptions {
	agentDir: string;
	workspaceId?: string;
	workspaceName?: string;
	ownerId?: string;
	ownerName?: string;
	clock?: CollaborationClock;
}

function unwrap<T>(
	result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string },
): T {
	if (!result.ok) throw new Error(result.detail);
	return result.value;
}

export class CollaborationService implements CollaborationServicePort {
	readonly transport = "local-only" as const;
	private readonly store: JsonStore<CollaborationWorkspace>;
	private readonly workspaceId: string;
	private readonly workspaceName: string;
	private readonly ownerId: string;
	private readonly ownerName: string;
	private readonly clock: CollaborationClock;

	constructor(options: CollaborationServiceOptions) {
		this.workspaceId = options.workspaceId ?? "drone-local-workspace";
		this.workspaceName = options.workspaceName ?? "Drone research workspace";
		this.ownerId = options.ownerId ?? "local-user";
		this.ownerName = options.ownerName ?? "Local user";
		this.clock = options.clock ?? defaultCollaborationClock;
		this.store = new JsonStore({
			path: join(options.agentDir, "collaboration", "workspace.json"),
			storageId: "agent-collaboration-workspace",
			defaultValue: () =>
				createWorkspace({
					workspaceId: this.workspaceId,
					name: this.workspaceName,
					ownerId: this.ownerId,
					ownerName: this.ownerName,
					clock: this.clock,
				}),
		});
	}

	async getWorkspace(): Promise<CollaborationWorkspace> {
		return this.store.read();
	}

	async listMembers(): Promise<readonly CollaborationMember[]> {
		return (await this.getWorkspace()).members;
	}

	async listConflicts(): Promise<readonly CollaborationConflict[]> {
		return (await this.getWorkspace()).conflicts;
	}

	async listAudit(): Promise<CollaborationWorkspace["audit"]> {
		return (await this.getWorkspace()).audit;
	}

	private async update(
		mutator: (workspace: CollaborationWorkspace) => CollaborationWorkspace,
	): Promise<CollaborationWorkspace> {
		return this.store.update((workspace) => mutator(workspace));
	}

	async inviteMember(actorId: string, invitation: MemberInvitation): Promise<CollaborationWorkspace> {
		return this.update((workspace) => unwrap(inviteMember(workspace, actorId, invitation, this.clock)));
	}

	async acceptInvitation(actorId: string): Promise<CollaborationWorkspace> {
		return this.update((workspace) => unwrap(acceptInvitation(workspace, actorId, this.clock)));
	}

	async revokeMember(actorId: string, memberId: string): Promise<CollaborationWorkspace> {
		return this.update((workspace) => unwrap(revokeMember(workspace, actorId, memberId, this.clock)));
	}

	async appendRevision(input: AppendRevisionInput): Promise<{
		status: "applied" | "conflict";
		revisionId: string;
		conflictId?: string;
	}> {
		let value: { status: "applied" | "conflict"; revisionId: string; conflictId?: string } | undefined;
		await this.update((workspace) => {
			const result = appendRevision(workspace, input, this.clock);
			const next = unwrap(result);
			value = {
				status: next.status,
				revisionId: next.revisionId,
				...(next.conflictId ? { conflictId: next.conflictId } : {}),
			};
			return next.workspace;
		});
		if (!value) throw new Error("Collaboration revision did not produce a result");
		return value;
	}

	async resolveConflict(
		actorId: string,
		conflictId: string,
		resolution: CollaborationResolution,
	): Promise<CollaborationWorkspace> {
		return this.update((workspace) =>
			unwrap(resolveConflict(workspace, actorId, conflictId, resolution, this.clock)),
		);
	}

	dispose(): void {
		this.store.dispose();
	}
}
