import { lookupZoteroByDoi } from "./zotero-reconcile";

type Options = Record<string, any>;
type Result = Record<string, any>;
type Reconciler = (expected: Options) => Promise<Result>;

const LOCAL_API = "http://127.0.0.1:23119/api/users/0";

/** Read-only Web API adapter. Credentials come from the host environment only. */
export function createZoteroReconciler({
	libraryType = process.env.ZOTERO_LIBRARY_TYPE || "users",
	libraryId = process.env.ZOTERO_LIBRARY_ID || process.env.ZOTERO_USER_ID,
	apiKey = process.env.ZOTERO_API_KEY,
	request,
}: Options = {}): Reconciler {
	const get =
		request ||
		(async (path: string) => {
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
	return async (expected: Options) => {
		if (!["users", "groups"].includes(libraryType) || !/^\d+$/.test(libraryId || "") || (!request && !apiKey))
			return {
				state: "unavailable",
				reason:
					"Configure the existing local Zotero API environment securely; never paste keys in chat. No library was queried.",
			};
		if (expected.libraryId && expected.libraryId !== libraryId)
			return { state: "blocked", reason: "library-scope-mismatch" };
		return lookupZoteroByDoi(get, expected as { doi: unknown; collection?: unknown }, {
			libraryType,
			libraryId,
			verifier: "zotero-read-only-item-identity",
		});
	};
}

/** Read-only local desktop API adapter, limited to the user library. */
export function createLocalZoteroReconciler({
	request,
	timeoutMs = 4000,
	userLibraryIds = [],
}: Options = {}): Reconciler {
	const get =
		request ||
		(async (path: string) => {
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
	return async (expected: Options) => {
		if (expected.libraryId && expected.libraryId !== "0" && !userLibraryIds.includes(expected.libraryId))
			return { state: "unavailable", reason: "local-api-covers-only-the-user-library" };
		try {
			return await lookupZoteroByDoi(get, expected as { doi: unknown; collection?: unknown }, {
				libraryType: "users",
				libraryId: expected.libraryId || "0",
				verifier: "zotero-local-api-item-identity",
			});
		} catch (error: any) {
			return {
				state: "unavailable",
				reason: error.name === "TimeoutError" ? "local-api-timeout" : "local-api-unreachable",
			};
		}
	};
}

const RANK: Record<string, number> = {
	found: 5,
	ambiguous: 4,
	"not-found": 3,
	unknown: 2,
	blocked: 1,
	unavailable: 0,
};

/** Local API first, then Web API; return the most informative read-only result. */
export function createCompositeZoteroReconciler({ local, web, env = process.env }: Options = {}): Reconciler {
	const userIds = [
		env.ZOTERO_USER_ID,
		env.ZOTERO_LIBRARY_TYPE === "groups" ? null : env.ZOTERO_LIBRARY_ID,
	].filter((value): value is string => Boolean(value));
	const first: Reconciler = local || createLocalZoteroReconciler({ userLibraryIds: userIds });
	const second: Reconciler = web || createZoteroReconciler();
	return async (expected: Options) => {
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
