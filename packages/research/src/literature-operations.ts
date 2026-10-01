/**
 * Pure recovery policy for literature destination writes.
 *
 * The host adapter owns the journal and all filesystem/network effects. This
 * package only decides what a receipt means after an observed Zotero/Obsidian
 * check, so an uncertain write can never be retried or overwritten implicitly.
 */
export interface LiteratureDestinationReceipt {
	zotero?: { status?: string | null } | null;
	obsidian?: { status?: string | null } | null;
}

export interface DestinationRecovery {
	zotero: { status: string; action: string; autoWrite: false };
	obsidian: { status: string; action: string; autoWrite: false };
	completed: boolean;
	scientificallyVerified: false;
}

export function destinationRecovery(receipt: LiteratureDestinationReceipt = {}): DestinationRecovery {
	const zotero = receipt.zotero?.status || "unavailable";
	const obsidian = receipt.obsidian?.status || "unavailable";
	return {
		zotero: {
			status: zotero,
			action:
				zotero === "verified"
					? "reuse-existing-item"
					: zotero === "identity-mismatch"
						? "resolve-identity-conflict"
						: "read-back-before-any-import",
			autoWrite: false,
		},
		obsidian: {
			status: obsidian,
			action:
				obsidian === "verified"
					? "preserve-existing-note"
					: obsidian === "missing"
						? "deposit-missing-note-with-authorization"
						: obsidian === "identity-mismatch"
							? "review-note-conflict-preserve-human-content"
							: "wait-and-recheck-vault",
			autoWrite: false,
		},
		completed: zotero === "verified" && obsidian === "verified",
		scientificallyVerified: false,
	};
}
