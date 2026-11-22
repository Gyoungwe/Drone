/**
 * A host-authored review the user is shown before a write is allowed.
 *
 * The copy is the desktop's, not the plugin's: the backend produces the
 * *facts* of what is about to happen and the desktop renders them with the
 * approved bilingual copy. The kind selects the copy table row, so the
 * backend never carries a user-visible string of its own.
 *
 * This travels beside `approvalDetail` rather than replacing it: every
 * existing producer keeps its string detail, and only the lanes that have an
 * approved review table supply one.
 *
 * The shape is the byte lane's, because the byte lane is the only one with a
 * handler today. A lane with a different review adds its own facts here and
 * its own row in the desktop's copy table.
 */
export type P5ApprovalReviewKind = "byte-write";

export interface P5ApprovalReview {
	readonly kind: P5ApprovalReviewKind;
	/** The plugin requesting the write; shown so the user knows who is asking. */
	readonly pluginId: string;
	/** The destination root the host granted. */
	readonly root: string;
	/** The one file this write touches, with the size and hash of the staged bytes. */
	readonly file: { readonly path: string; readonly bytes: number; readonly sha256: string };
}
