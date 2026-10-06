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
	const observedAt = context.observedAt || new Date().toISOString();
	let matches = findZoteroItemsByIdentity(result.data as ZoteroIdentityItem[], expected);
	const named = expected.collection == null ? "" : String(expected.collection).trim();
	// Milestones may name the collection ("test") instead of giving its key; items only carry keys, so a value
	// that matched no key is resolved read-only as an exact collection name.
	if (!matches.length && named && !isZoteroItemKey(named)) {
		const collection = await resolveCollection(get, named);
		if (collection.state !== "ok")
			return { state: collection.state, doi, reason: collection.reason, observedAt, safeToAutoRetry: false };
		matches = findZoteroItemsByIdentity(result.data as ZoteroIdentityItem[], {
			...expected,
			collection: collection.key,
		});
	}
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

/** A collection key passes through; an exact (case-insensitive) collection name is resolved read-only to its key. */
async function resolveCollection(
	get: ZoteroReadRequest,
	raw: unknown,
): Promise<
	{ state: "ok"; key: string | null } | { state: "not-found" | "ambiguous" | "unknown"; reason: string }
> {
	const wanted = raw == null ? "" : String(raw).trim();
	if (!wanted) return { state: "ok", key: null };
	if (isZoteroItemKey(wanted)) return { state: "ok", key: wanted };
	const keys: string[] = [];
	for (let start = 0; start < 1000; start += 100) {
		const page = await get(`collections?format=json&limit=100&start=${start}`);
		if (!Array.isArray(page.data)) return { state: "unknown", reason: "collection-lookup-incomplete" };
		for (const entry of page.data as { key?: unknown; data?: { name?: unknown } }[])
			if (
				isZoteroItemKey(entry?.key) &&
				String(entry.data?.name ?? "")
					.trim()
					.toLowerCase() === wanted.toLowerCase()
			)
				keys.push(String(entry.key));
		if (page.data.length < 100 || !((page.total ?? 0) > start + 100)) break;
	}
	if (keys.length === 1) return { state: "ok", key: keys[0] as string };
	return keys.length
		? { state: "ambiguous", reason: `several collections are named "${wanted}"` }
		: { state: "not-found", reason: `collection "${wanted}" not found` };
}
