import type { P5StagingOwner } from "./p5-byte-staging";

export interface P5StagingAttachment {
	readonly identity: object;
	readonly sessionIdentity: object;
	readonly workspaceId: string;
	readonly sessionId: string;
	readonly callerSourceHash: string;
	readonly providerSourceHash: string;
	readonly signals: readonly AbortSignal[];
}

interface AttachmentOwners {
	readonly sessionIdentity: object;
	readonly actions: Map<string, P5StagingOwner>;
}

export function createP5StagingOwners(newId: () => string): {
	ownerFor(attachment: P5StagingAttachment, action: string): P5StagingOwner | undefined;
	release(owner: P5StagingOwner): void;
} {
	const attachments = new WeakMap<object, AttachmentOwners>();
	const transfers = new WeakMap<P5StagingOwner, AbortController>();

	function release(owner: P5StagingOwner): void {
		const transfer = transfers.get(owner);
		if (transfer) transfer.abort();
		else if (!owner.signal.aborted) throw new Error("Unknown P5 staging owner");
	}

	function ownerFor(attachment: P5StagingAttachment, action: string): P5StagingOwner | undefined {
		const { identity, sessionIdentity, signals } = attachment;
		const previous = attachments.get(identity);
		const current =
			previous?.sessionIdentity === sessionIdentity
				? previous
				: { sessionIdentity, actions: new Map<string, P5StagingOwner>() };
		if (current !== previous) {
			attachments.set(identity, current);
			if (previous) {
				for (const owner of previous.actions.values()) release(owner);
			}
		}
		if (attachments.get(identity) !== current) return undefined;
		if (signals.some((signal) => signal.aborted)) {
			if (current.actions.size === 0) attachments.delete(identity);
			return undefined;
		}
		const existing = current.actions.get(action);
		if (existing) return existing;

		const transfer = new AbortController();
		const { workspaceId, sessionId, callerSourceHash, providerSourceHash } = attachment;
		const signal = AbortSignal.any([...signals, transfer.signal]);
		const owner = Object.freeze({
			callerId: newId(),
			action,
			workspaceId,
			sessionId,
			callerSourceHash,
			providerSourceHash,
			signal,
		});
		current.actions.set(action, owner);
		transfers.set(owner, transfer);
		signal.addEventListener(
			"abort",
			() => {
				transfers.delete(owner);
				current.actions.delete(action);
				if (current.actions.size === 0 && attachments.get(identity) === current) attachments.delete(identity);
			},
			{ once: true },
		);
		return owner;
	}

	return { ownerFor, release };
}
