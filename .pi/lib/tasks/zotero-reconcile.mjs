const normalizeDoi = (value) =>
	String(value || "")
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "")
		.replace(/^doi:\s*/, "");
/** A read-only adapter: credentials come from local environment, never tool arguments/ledger. */
export function createZoteroReconciler({
	libraryType = process.env.ZOTERO_LIBRARY_TYPE || "users",
	libraryId = process.env.ZOTERO_LIBRARY_ID || process.env.ZOTERO_USER_ID,
	apiKey = process.env.ZOTERO_API_KEY,
	request,
} = {}) {
	const get =
		request ||
		(async (path) => {
			const response = await fetch(`https://api.zotero.org/${libraryType}/${libraryId}/${path}`, {
				headers: { "Zotero-API-Version": "3", "Zotero-API-Key": apiKey },
				signal: AbortSignal.timeout(15000),
				redirect: "error",
			});
			if (!response.ok)
				throw new Error(`Zotero read-only lookup failed (${response.status}); no write/retry performed.`);
			const body = await response.text();
			if (body.length > 2 * 1024 * 1024)
				throw new Error("Zotero lookup response too large; outcome remains unknown.");
			return { data: JSON.parse(body), total: Number(response.headers.get("Total-Results")) };
		});
	return async (expected) => {
		if (!["users", "groups"].includes(libraryType) || !/^\d+$/.test(libraryId || "") || (!request && !apiKey))
			return {
				state: "unavailable",
				reason:
					"Configure the existing local Zotero API environment securely; never paste keys in chat. No library was queried.",
			};
		if (expected.libraryId && expected.libraryId !== libraryId)
			return { state: "blocked", reason: "library-scope-mismatch" };
		const doi = normalizeDoi(expected.doi);
		if (!/^10\.\d{4,9}\/\S+$/.test(doi)) return { state: "blocked", reason: "exact-doi-required" };
		const result = await get(`items?format=json&limit=100&q=${encodeURIComponent(doi)}&qmode=everything`);
		if (!Array.isArray(result.data) || result.data.length > 100 || result.total > 100)
			return { state: "unknown", reason: "lookup-incomplete" };
		const matches = result.data.filter(
			(item) =>
				item?.data &&
				normalizeDoi(item.data.DOI) === doi &&
				(!expected.collection || item.data.collections?.includes(expected.collection)),
		);
		if (!matches.length)
			return { state: "not-found", doi, observedAt: new Date().toISOString(), safeToAutoRetry: false };
		if (matches.length !== 1)
			return { state: "ambiguous", doi, count: matches.length, safeToAutoRetry: false };
		const item = matches[0];
		if (!/^[A-Z0-9]{8}$/.test(item.key || "")) return { state: "unknown", reason: "invalid-resource-id" };
		const children = await get(`items/${item.key}/children?format=json&limit=100`);
		if (!Array.isArray(children.data) || children.total > 100)
			return { state: "unknown", reason: "attachment-lookup-incomplete" };
		const attachments = children.data
			.filter((child) => child?.data?.itemType === "attachment" && child.data.parentItem === item.key)
			.map((child) => ({ key: child.key, contentType: child.data.contentType, metadataOnly: true }));
		return {
			state: "found",
			libraryType,
			libraryId,
			itemId: item.key,
			doi,
			attachments,
			observedAt: new Date().toISOString(),
			verifier: "zotero-read-only-item-identity",
			attachmentContentsVerified: false,
			scientificallyVerified: false,
			safeToAutoRetry: false,
		};
	};
}
