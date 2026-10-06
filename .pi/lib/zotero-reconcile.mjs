// packages/research/src/literature-receipt.ts
function normalizeDoi(value) {
  const doi = String(value || "").trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "").toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : null;
}

// packages/research/src/zotero-identity.ts
var ZOTERO_KEY_PATTERN = /^[A-Z0-9]{8}$/;
function normalizeZoteroDoi(value) {
  return normalizeDoi(value);
}
function isValidZoteroDoi(value) {
  const doi = normalizeZoteroDoi(value);
  return Boolean(doi && /^10\.\d{4,9}\/\S+$/.test(doi));
}
function isZoteroItemKey(value) {
  return typeof value === "string" && ZOTERO_KEY_PATTERN.test(value);
}
function zoteroItemDoi(item) {
  return normalizeZoteroDoi(item?.data?.DOI);
}
function findZoteroItemsByIdentity(items, query) {
  const doi = normalizeZoteroDoi(query.doi);
  if (!doi) return [];
  const collection = query.collection == null ? "" : String(query.collection);
  return items.filter((item) => {
    if (zoteroItemDoi(item) !== doi) return false;
    if (!collection) return true;
    return Array.isArray(item.data?.collections) && item.data.collections.includes(collection);
  });
}
function summarizeZoteroAttachments(children, parentKey) {
  if (!isZoteroItemKey(parentKey)) return [];
  return children.filter(
    (child) => child.data?.itemType === "attachment" && child.data.parentItem === parentKey && isZoteroItemKey(child.key)
  ).map((child) => ({
    key: child.key,
    contentType: typeof child.data?.contentType === "string" ? child.data.contentType : null,
    metadataOnly: true
  }));
}

// packages/research/src/zotero-reconcile.ts
async function lookupZoteroByDoi(get, expected, context = {}) {
  const doi = normalizeZoteroDoi(expected.doi);
  if (!doi || !isValidZoteroDoi(doi)) return { state: "blocked", reason: "exact-doi-required" };
  const result = await get(`items?format=json&limit=100&q=${encodeURIComponent(doi)}&qmode=everything`);
  if (!Array.isArray(result.data) || result.data.length > 100 || result.total !== void 0 && result.total > 100) {
    return { state: "unknown", reason: "lookup-incomplete" };
  }
  const observedAt = context.observedAt || (/* @__PURE__ */ new Date()).toISOString();
  let matches = findZoteroItemsByIdentity(result.data, expected);
  const named = expected.collection == null ? "" : String(expected.collection).trim();
  if (!matches.length && named && !isZoteroItemKey(named)) {
    const collection = await resolveCollection(get, named);
    if (collection.state !== "ok")
      return { state: collection.state, doi, reason: collection.reason, observedAt, safeToAutoRetry: false };
    matches = findZoteroItemsByIdentity(result.data, {
      ...expected,
      collection: collection.key
    });
  }
  if (!matches.length) return { state: "not-found", doi, observedAt, safeToAutoRetry: false };
  if (matches.length !== 1) return { state: "ambiguous", doi, count: matches.length, safeToAutoRetry: false };
  const item = matches[0];
  if (!item) return { state: "unknown", reason: "lookup-incomplete" };
  if (!isZoteroItemKey(item.key)) return { state: "unknown", reason: "invalid-resource-id" };
  const children = await get(`items/${item.key}/children?format=json&limit=100`);
  if (!Array.isArray(children.data) || children.total !== void 0 && children.total > 100) {
    return { state: "unknown", reason: "attachment-lookup-incomplete" };
  }
  return {
    state: "found",
    ...context.libraryType ? { libraryType: context.libraryType } : {},
    ...context.libraryId ? { libraryId: context.libraryId } : {},
    itemId: item.key,
    doi,
    attachments: summarizeZoteroAttachments(children.data, item.key),
    observedAt,
    ...context.verifier ? { verifier: context.verifier } : {},
    attachmentContentsVerified: false,
    scientificallyVerified: false,
    safeToAutoRetry: false
  };
}
async function resolveCollection(get, raw) {
  const wanted = raw == null ? "" : String(raw).trim();
  if (!wanted) return { state: "ok", key: null };
  if (isZoteroItemKey(wanted)) return { state: "ok", key: wanted };
  const keys = [];
  for (let start = 0; start < 1e3; start += 100) {
    const page = await get(`collections?format=json&limit=100&start=${start}`);
    if (!Array.isArray(page.data)) return { state: "unknown", reason: "collection-lookup-incomplete" };
    for (const entry of page.data)
      if (isZoteroItemKey(entry?.key) && String(entry.data?.name ?? "").trim().toLowerCase() === wanted.toLowerCase())
        keys.push(String(entry.key));
    if (page.data.length < 100 || !((page.total ?? 0) > start + 100)) break;
  }
  if (keys.length === 1) return { state: "ok", key: keys[0] };
  return keys.length ? { state: "ambiguous", reason: `several collections are named "${wanted}"` } : { state: "not-found", reason: `collection "${wanted}" not found` };
}

// packages/research/src/zotero-reconcile-runtime.ts
var LOCAL_API = "http://127.0.0.1:23119/api/users/0";
var LOCAL_USER_LIBRARY_IDS = /* @__PURE__ */ new Set(["0", "1"]);
function createZoteroReconciler({
  libraryType = process.env.ZOTERO_LIBRARY_TYPE || "users",
  libraryId = process.env.ZOTERO_LIBRARY_ID || process.env.ZOTERO_USER_ID,
  apiKey = process.env.ZOTERO_API_KEY,
  request
} = {}) {
  const get = request || (async (path) => {
    const response = await fetch(`https://api.zotero.org/${libraryType}/${libraryId}/${path}`, {
      headers: { "Zotero-API-Version": "3", "Zotero-API-Key": apiKey },
      signal: AbortSignal.timeout(15e3),
      redirect: "error"
    });
    if (!response.ok)
      throw new Error(`Zotero read-only lookup failed (${response.status}); no write/retry performed.`);
    const body = await response.text();
    if (body.length > 2 * 1024 * 1024)
      throw new Error("Zotero lookup response too large; outcome remains unknown.");
    return { data: JSON.parse(body), total: Number(response.headers.get("Total-Results")) };
  });
  return async (expected) => {
    if (!["users", "groups"].includes(libraryType) || !/^\d+$/.test(libraryId || "") || !request && !apiKey)
      return {
        state: "unavailable",
        reason: "Configure the existing local Zotero API environment securely; never paste keys in chat. No library was queried."
      };
    if (expected.libraryId && expected.libraryId !== libraryId)
      return { state: "blocked", reason: "library-scope-mismatch" };
    return lookupZoteroByDoi(get, expected, {
      libraryType,
      libraryId,
      verifier: "zotero-read-only-item-identity"
    });
  };
}
function createLocalZoteroReconciler({
  request,
  timeoutMs = 4e3,
  userLibraryIds = []
} = {}) {
  const get = request || (async (path) => {
    const response = await fetch(`${LOCAL_API}/${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error"
    });
    if (!response.ok)
      throw new Error(`Zotero local API lookup failed (${response.status}); no write/retry performed.`);
    const body = await response.text();
    if (body.length > 2 * 1024 * 1024)
      throw new Error("Zotero lookup response too large; outcome remains unknown.");
    return { data: JSON.parse(body), total: Number(response.headers.get("Total-Results")) };
  });
  return async (expected) => {
    if (expected.libraryId && !LOCAL_USER_LIBRARY_IDS.has(String(expected.libraryId)) && !userLibraryIds.includes(expected.libraryId))
      return { state: "unavailable", reason: "local-api-covers-only-the-user-library" };
    try {
      return await lookupZoteroByDoi(get, expected, {
        libraryType: "users",
        libraryId: expected.libraryId || "0",
        verifier: "zotero-local-api-item-identity"
      });
    } catch (error) {
      return {
        state: "unavailable",
        reason: error.name === "TimeoutError" ? "local-api-timeout" : "local-api-unreachable"
      };
    }
  };
}
var RANK = {
  found: 5,
  ambiguous: 4,
  "not-found": 3,
  unknown: 2,
  blocked: 1,
  unavailable: 0
};
function createCompositeZoteroReconciler({ local, web, env = process.env } = {}) {
  const userIds = [
    env.ZOTERO_USER_ID,
    env.ZOTERO_LIBRARY_TYPE === "groups" ? null : env.ZOTERO_LIBRARY_ID
  ].filter((value) => Boolean(value));
  const first = local || createLocalZoteroReconciler({ userLibraryIds: userIds });
  const second = web || createZoteroReconciler();
  return async (expected) => {
    const a = await first(expected);
    if (a.state === "found" || a.state === "ambiguous") return a;
    const b = await second(expected);
    if (a.state === "unavailable" && b.state === "unavailable")
      return {
        state: "unavailable",
        // Report what each channel actually said; "unreachable" was printed even when the desktop answered.
        reason: `No Zotero channel could check this item (desktop: ${a.reason || "unavailable"}; Web API: ${b.reason || "unavailable"}); no library was queried.`
      };
    return (RANK[b.state] ?? 0) >= (RANK[a.state] ?? 0) ? b : a;
  };
}
export {
  createCompositeZoteroReconciler,
  createLocalZoteroReconciler,
  createZoteroReconciler
};
