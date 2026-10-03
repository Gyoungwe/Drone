import { normalizeDoi } from "./literature-receipt";

/** The fixed-width resource key used by Zotero item and attachment records. */
export const ZOTERO_KEY_PATTERN = /^[A-Z0-9]{8}$/;

export interface ZoteroIdentityItem {
	key?: unknown;
	data?: {
		DOI?: unknown;
		collections?: unknown;
		itemType?: unknown;
		parentItem?: unknown;
		contentType?: unknown;
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

export interface ZoteroIdentityQuery {
	doi: unknown;
	collection?: unknown;
}

export interface ZoteroAttachmentIdentity {
	key: string;
	contentType: string | null;
	metadataOnly: true;
}

/** Normalize DOI identity using the same canonical policy as research receipts. */
export function normalizeZoteroDoi(value: unknown): string | null {
	return normalizeDoi(value);
}

/** A DOI is eligible for exact Zotero lookup only when it has a valid DOI shape. */
export function isValidZoteroDoi(value: unknown): boolean {
	const doi = normalizeZoteroDoi(value);
	return Boolean(doi && /^10\.\d{4,9}\/\S+$/.test(doi));
}

export function isZoteroItemKey(value: unknown): value is string {
	return typeof value === "string" && ZOTERO_KEY_PATTERN.test(value);
}

/** Read the bibliographic DOI field without accepting a title or URL as identity. */
export function zoteroItemDoi(item: ZoteroIdentityItem | null | undefined): string | null {
	return normalizeZoteroDoi(item?.data?.DOI);
}

/**
 * Return only records whose DOI (and optional collection) exactly matches the
 * expected identity. This function performs no network, filesystem or write
 * operation and preserves the input record references.
 */
export function findZoteroItemsByIdentity(
	items: readonly ZoteroIdentityItem[],
	query: ZoteroIdentityQuery,
): ZoteroIdentityItem[] {
	const doi = normalizeZoteroDoi(query.doi);
	if (!doi) return [];
	const collection = query.collection == null ? "" : String(query.collection);
	return items.filter((item) => {
		if (zoteroItemDoi(item) !== doi) return false;
		if (!collection) return true;
		return Array.isArray(item.data?.collections) && item.data.collections.includes(collection);
	});
}

/** Project child records into safe attachment identity metadata only. */
export function summarizeZoteroAttachments(
	children: readonly ZoteroIdentityItem[],
	parentKey: unknown,
): ZoteroAttachmentIdentity[] {
	if (!isZoteroItemKey(parentKey)) return [];
	return children
		.filter(
			(child) =>
				child.data?.itemType === "attachment" &&
				child.data.parentItem === parentKey &&
				isZoteroItemKey(child.key),
		)
		.map((child) => ({
			key: child.key as string,
			contentType: typeof child.data?.contentType === "string" ? child.data.contentType : null,
			metadataOnly: true as const,
		}));
}
