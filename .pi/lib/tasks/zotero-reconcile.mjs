const normalizeDoi = (value) =>
	String(value || "")
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "")
		.replace(/^doi:\s*/, "");
const LOCAL_API = "http://127.0.0.1:23119/api/users/0";
async function lookupByDoi(get, expected, { libraryType, libraryId, verifier }) {
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
	if (matches.length !== 1) return { state: "ambiguous", doi, count: matches.length, safeToAutoRetry: false };
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
		verifier,
		attachmentContentsVerified: false,
		scientificallyVerified: false,
		safeToAutoRetry: false,
	};
}
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
		return lookupByDoi(get, expected, { libraryType, libraryId, verifier: "zotero-read-only-item-identity" });
	};
}
/**
 * Same read-only identity check against the Zotero desktop local API (no credentials, user library only).
 * A milestone that names a specific web library id is left to the Web API adapter.
 */
export function createLocalZoteroReconciler({ request, timeoutMs = 4000, userLibraryIds = [] } = {}) {
	const get =
		request ||
		(async (path) => {
			const response = await fetch(`${LOCAL_API}/${path}`, {
				headers: { Accept: "application/json" },
				signal: AbortSignal.timeout(timeoutMs),
				redirect: "error",
			});
			if (!response.ok)
				throw new Error(`Zotero local API lookup failed (${response.status}); no write/retry performed.`);
			const body = await response.text();
			if (body.length > 2 * 1024 * 1024)
				throw new Error("Zotero lookup response too large; outcome remains unknown.");
			return { data: JSON.parse(body), total: Number(response.headers.get("Total-Results")) };
		});
	return async (expected) => {
		if (expected.libraryId && expected.libraryId !== "0" && !userLibraryIds.includes(expected.libraryId))
			return { state: "unavailable", reason: "local-api-covers-only-the-user-library" };
		try {
			return await lookupByDoi(get, expected, {
				libraryType: "users",
				libraryId: expected.libraryId || "0",
				verifier: "zotero-local-api-item-identity",
			});
		} catch (error) {
			return {
				state: "unavailable",
				reason: error.name === "TimeoutError" ? "local-api-timeout" : "local-api-unreachable",
			};
		}
	};
}
const RANK = { found: 5, ambiguous: 4, "not-found": 3, unknown: 2, blocked: 1, unavailable: 0 };
/** Desktop local API first (no credentials), then the Web API; the more informative read-only answer wins. */
export function createCompositeZoteroReconciler({ local, web, env = process.env } = {}) {
	const userIds = [
		env.ZOTERO_USER_ID,
		env.ZOTERO_LIBRARY_TYPE === "groups" ? null : env.ZOTERO_LIBRARY_ID,
	].filter(Boolean);
	const first = local || createLocalZoteroReconciler({ userLibraryIds: userIds });
	const second = web || createZoteroReconciler();
	return async (expected) => {
		const a = await first(expected);
		if (a.state === "found" || a.state === "ambiguous") return a;
		const b = await second(expected);
		if (a.state === "unavailable" && b.state === "unavailable")
			return {
				state: "unavailable",
				reason:
					"Zotero desktop local API is unreachable and no Web API credentials are configured; no library was queried.",
			};
		return (RANK[b.state] ?? 0) >= (RANK[a.state] ?? 0) ? b : a;
	};
}
