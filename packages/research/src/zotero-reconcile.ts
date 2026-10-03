import {
	findZoteroItemsByIdentity,
	isValidZoteroDoi,
	isZoteroItemKey,
	normalizeZoteroDoi,
	summarizeZoteroAttachments,
	type ZoteroIdentityItem,
} from "./zotero-identity";

export interface ZoteroListResponse {
	data?: unknown;
	total?: number;
}

export type ZoteroReadRequest = (path: string) => Promise<ZoteroListResponse>;

export interface ZoteroReconcileExpectation {
	doi: unknown;
	collection?: unknown;
}

export interface ZoteroReconcileContext {
	libraryType?: string;
	libraryId?: string;
	verifier?: string;
	observedAt?: string;
}

/**
 * Perform the network-free part of a read-only Zotero identity reconciliation.
 * The caller owns credentials, transport, response size limits and retries.
 * This helper never writes, retries, downloads attachments or returns bodies.
 */
export async function lookupZoteroByDoi(
	get: ZoteroReadRequest,
	expected: ZoteroReconcileExpectation,
	context: ZoteroReconcileContext = {},
): Promise<Record<string, unknown>> {
	const doi = normalizeZoteroDoi(expected.doi);
	if (!doi || !isValidZoteroDoi(doi)) return { state: "blocked", reason: "exact-doi-required" };
	const result = await get(`items?format=json&limit=100&q=${encodeURIComponent(doi)}&qmode=everything`);
	if (
		!Array.isArray(result.data) ||
		result.data.length > 100 ||
		(result.total !== undefined && result.total > 100)
	) {
		return { state: "unknown", reason: "lookup-incomplete" };
	}
	const matches = findZoteroItemsByIdentity(result.data as ZoteroIdentityItem[], expected);
	const observedAt = context.observedAt || new Date().toISOString();
	if (!matches.length) return { state: "not-found", doi, observedAt, safeToAutoRetry: false };
	if (matches.length !== 1) return { state: "ambiguous", doi, count: matches.length, safeToAutoRetry: false };
	const item = matches[0];
	if (!item) return { state: "unknown", reason: "lookup-incomplete" };
	if (!isZoteroItemKey(item.key)) return { state: "unknown", reason: "invalid-resource-id" };
	const children = await get(`items/${item.key}/children?format=json&limit=100`);
	if (!Array.isArray(children.data) || (children.total !== undefined && children.total > 100)) {
		return { state: "unknown", reason: "attachment-lookup-incomplete" };
	}
	return {
		state: "found",
		...(context.libraryType ? { libraryType: context.libraryType } : {}),
		...(context.libraryId ? { libraryId: context.libraryId } : {}),
		itemId: item.key,
		doi,
		attachments: summarizeZoteroAttachments(children.data as ZoteroIdentityItem[], item.key),
		observedAt,
		...(context.verifier ? { verifier: context.verifier } : {}),
		attachmentContentsVerified: false,
		scientificallyVerified: false,
		safeToAutoRetry: false,
	};
}
