// packages/research/src/zotero-write-runtime.ts
import { createHash, randomUUID } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

// packages/research/src/literature-receipt.ts
function normalizeDoi(value) {
  const doi = String(value || "").trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "").toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : null;
}
function exactDoiItems(items, doi) {
  const wanted = normalizeDoi(doi);
  return wanted ? items.filter((item) => normalizeDoi(item.data?.DOI || item.doi || item.DOI) === wanted) : [];
}

// packages/research/src/zotero-write.ts
var ZOTERO_ITEM_SPECS = Object.freeze({
  journalArticle: { container: "publicationTitle", doi: true, fields: ["volume", "issue", "pages"] },
  conferencePaper: { container: "proceedingsTitle", doi: true, fields: ["volume", "pages"] },
  preprint: { container: "repository", doi: true, fields: [] },
  dataset: { container: "repository", doi: true, fields: [] },
  book: { container: null, doi: false, fields: ["volume"] },
  bookSection: { container: "bookTitle", doi: false, fields: ["volume", "pages"] },
  thesis: { container: "university", doi: false, fields: [] },
  report: { container: "institution", doi: false, fields: ["pages"] },
  webpage: { container: "websiteTitle", doi: false, fields: [] }
});
var ZOTERO_ITEM_TYPES = Object.freeze(Object.keys(ZOTERO_ITEM_SPECS));
var ZOTERO_WRITE_LIMITS = Object.freeze({
  title: 1e3,
  field: 500,
  abstract: 5e3,
  creators: 200,
  tags: 32,
  tag: 200
});
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function textField(value, max, name) {
  if (value === void 0 || value === null) return "";
  if (typeof value !== "string" && typeof value !== "number") throw new Error(`${name} must be a string`);
  const text = String(value).replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();
  if (text.length > max) throw new Error(`${name} exceeds ${max} characters`);
  return text;
}
function normalizeCreators(input) {
  if (input === void 0 || input === null) return [];
  if (!Array.isArray(input)) throw new Error("creators must be an array");
  if (input.length > ZOTERO_WRITE_LIMITS.creators)
    throw new Error(`creators exceeds ${ZOTERO_WRITE_LIMITS.creators} entries`);
  return input.map((raw, index) => {
    const creator = typeof raw === "string" ? { name: raw } : isRecord(raw) ? raw : null;
    if (!creator) throw new Error(`creators[${index}] must be an object or a string`);
    const creatorType = textField(creator.creator_type || creator.creatorType, 40, "creator_type") || "author";
    if (!/^[a-z][A-Za-z]{2,30}$/.test(creatorType))
      throw new Error(`creators[${index}] has an invalid creator_type`);
    const lastName = textField(creator.last_name ?? creator.lastName, ZOTERO_WRITE_LIMITS.field, "last_name");
    const firstName = textField(
      creator.first_name ?? creator.firstName,
      ZOTERO_WRITE_LIMITS.field,
      "first_name"
    );
    const name = textField(creator.name, ZOTERO_WRITE_LIMITS.field, "name");
    if (lastName) return { creatorType, lastName, firstName };
    if (name) return { creatorType, name };
    throw new Error(`creators[${index}] needs last_name or name`);
  });
}
function normalizeTags(input) {
  if (input === void 0 || input === null) return [];
  if (!Array.isArray(input)) throw new Error("tags must be an array of strings");
  const tags = [
    ...new Set(
      input.map((tag, index) => textField(tag, ZOTERO_WRITE_LIMITS.tag, `tags[${index}]`)).filter(Boolean)
    )
  ];
  if (tags.length > ZOTERO_WRITE_LIMITS.tags)
    throw new Error(`tags exceeds ${ZOTERO_WRITE_LIMITS.tags} entries`);
  return tags;
}
function httpUrl(value, name) {
  const text = textField(value, 2048, name);
  if (!text) return "";
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL`);
  }
  if (![`http:`, `https:`].includes(url.protocol)) throw new Error(`${name} must use http or https`);
  return url.href;
}
function normalizeZoteroItem(input = {}) {
  const doi = normalizeDoi(input.doi);
  if (!doi) throw new Error("A valid DOI (10.xxxx/...) is required; Zotero writes are keyed by exact DOI.");
  const itemType = textField(input.item_type || input.itemType, 40, "item_type") || "journalArticle";
  const spec = ZOTERO_ITEM_SPECS[itemType];
  if (!spec)
    throw new Error(`Unsupported item_type "${itemType}"; use one of ${ZOTERO_ITEM_TYPES.join(", ")}`);
  const title = textField(input.title, ZOTERO_WRITE_LIMITS.title, "title");
  if (!title) throw new Error("title is required");
  const fields = {};
  for (const name of spec.fields) {
    const value = textField(input[name], ZOTERO_WRITE_LIMITS.field, name);
    if (value) fields[name] = value;
  }
  const container = textField(
    input.publication ?? input.container_title,
    ZOTERO_WRITE_LIMITS.field,
    "publication"
  );
  if (container && spec.container) fields[spec.container] = container;
  const extra = [];
  if (container && !spec.container) extra.push(`Published in: ${container}`);
  if (!spec.doi) extra.push(`DOI: ${doi}`);
  return {
    doi,
    itemType,
    title,
    creators: normalizeCreators(input.creators),
    date: textField(input.date, 64, "date"),
    url: httpUrl(input.url, "url") || `https://doi.org/${doi}`,
    abstractNote: textField(input.abstract ?? input.abstractNote, ZOTERO_WRITE_LIMITS.abstract, "abstract"),
    fields,
    extra: extra.join("\n"),
    tags: normalizeTags(input.tags),
    doiField: spec.doi
  };
}
function normalizeZoteroAttachment(input = {}) {
  const url = httpUrl(input.attachment_url ?? input.attachmentUrl, "attachment_url");
  if (!url) return null;
  return {
    url,
    title: textField(input.attachment_title, ZOTERO_WRITE_LIMITS.field, "attachment_title") || "Full Text PDF"
  };
}
function toConnectorItem(item, attachment = null) {
  const payload = {
    itemType: item.itemType,
    title: item.title,
    creators: item.creators.map(
      (creator) => creator.name ? { creatorType: creator.creatorType, lastName: creator.name, fieldMode: 1 } : { ...creator }
    ),
    date: item.date,
    url: item.url,
    abstractNote: item.abstractNote,
    ...item.fields,
    tags: item.tags.map((tag) => ({ tag })),
    attachments: attachment ? [{ title: attachment.title, url: attachment.url, mimeType: "application/pdf" }] : []
  };
  if (item.doiField) payload.DOI = item.doi;
  if (item.extra) payload.extra = item.extra;
  return payload;
}
function toWebApiItem(item, { collectionKey = null } = {}) {
  const payload = {
    itemType: item.itemType,
    title: item.title,
    creators: item.creators.map((creator) => ({ ...creator })),
    date: item.date,
    url: item.url,
    abstractNote: item.abstractNote,
    ...item.fields,
    tags: item.tags.map((tag) => ({ tag })),
    collections: collectionKey ? [collectionKey] : []
  };
  if (item.doiField) payload.DOI = item.doi;
  if (item.extra) payload.extra = item.extra;
  return payload;
}
function connectorTargetId(value) {
  const text = textField(value, 32, "target");
  if (!text) return null;
  if (!/^[LC]\d{1,12}$/.test(text))
    throw new Error('target must look like "L1" (library) or "C123" (collection)');
  return text;
}

// packages/research/src/zotero-write-runtime.ts
var ZOTERO_ENDPOINTS = Object.freeze({
  connector: "http://127.0.0.1:23119",
  localApi: "http://127.0.0.1:23119/api",
  webApi: "https://api.zotero.org"
});
var KEY = /^[A-Z0-9]{8}$/;
function timeoutSignal(ms, signal) {
  const timer = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timer]) : timer;
}
async function readJson(response, limit = 2 * 1024 * 1024) {
  const body = await response.text();
  if (body.length > limit) throw new Error("Zotero response too large; outcome remains unknown.");
  if (!body.trim()) return null;
  try {
    return JSON.parse(body);
  } catch {
    return { text: body.slice(0, 2e3) };
  }
}
async function connectorPost(fetchImpl, path, body, { timeoutMs = 2e4, signal } = {}) {
  const response = await fetchImpl(`${ZOTERO_ENDPOINTS.connector}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: timeoutSignal(timeoutMs, signal),
    redirect: "error"
  });
  return {
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    json: await readJson(response)
  };
}
async function probeZoteroConnector({
  fetchImpl = fetch,
  signal,
  timeoutMs = 3e3
} = {}) {
  try {
    const response = await connectorPost(fetchImpl, "/connector/ping", {}, { timeoutMs, signal });
    return {
      reachable: response.ok,
      status: response.status,
      version: response.headers?.get?.("X-Zotero-Version") || null
    };
  } catch (error) {
    return { reachable: false, error: error.name === "TimeoutError" ? "timeout" : "unreachable" };
  }
}
async function connectorSaveTarget({ fetchImpl = fetch, signal } = {}) {
  const response = await connectorPost(fetchImpl, "/connector/getSelectedCollection", {}, { signal });
  if (!response.ok || !response.json || typeof response.json !== "object")
    throw new Error(`Zotero desktop did not report a save target (HTTP ${response.status}).`);
  const t = response.json;
  return {
    libraryId: t.libraryID === void 0 || t.libraryID === null ? null : String(t.libraryID),
    libraryName: typeof t.libraryName === "string" ? t.libraryName.slice(0, 200) : "My Library",
    editable: t.libraryEditable !== false && t.editable !== false,
    collectionId: t.id ? String(t.id) : null,
    collectionName: t.id && typeof t.name === "string" ? t.name.slice(0, 200) : null
  };
}
async function localApiGet(fetchImpl, path, { signal, timeoutMs = 1e4 } = {}) {
  const response = await fetchImpl(`${ZOTERO_ENDPOINTS.localApi}/users/0/${path}`, {
    headers: { Accept: "application/json" },
    signal: timeoutSignal(timeoutMs, signal),
    redirect: "error"
  });
  if (!response.ok) throw new Error(`Zotero local API HTTP ${response.status}`);
  return { data: await readJson(response), total: Number(response.headers.get("Total-Results")) };
}
function summarizeMatches(items, doi) {
  return exactDoiItems(items, doi).filter((item) => KEY.test(item.key || "")).map((item) => ({
    key: item.key,
    title: String(item.data?.title || "").slice(0, 200),
    itemType: item.data?.itemType || null,
    collections: Array.isArray(item.data?.collections) ? item.data.collections.slice(0, 20) : []
  }));
}
async function localApiSearchByDoi({ fetchImpl = fetch, doi, signal } = {}) {
  const wanted = normalizeDoi(doi);
  if (!wanted) throw new Error("Valid DOI required");
  const result = await localApiGet(
    fetchImpl,
    `items?format=json&limit=100&q=${encodeURIComponent(wanted)}&qmode=everything`,
    { signal }
  );
  const complete = Array.isArray(result.data) && result.data.length <= 100 && !(result.total > 100);
  return { complete, items: complete ? summarizeMatches(result.data, wanted) : [] };
}
async function localApiChildren({ fetchImpl = fetch, key, signal } = {}) {
  if (!KEY.test(key || "")) throw new Error("Valid Zotero key required");
  const result = await localApiGet(fetchImpl, `items/${key}/children?format=json&limit=100`, { signal });
  return Array.isArray(result.data) ? result.data : [];
}
function zoteroWebApiConfig(env = process.env) {
  const libraryType = env.ZOTERO_LIBRARY_TYPE || "users";
  const libraryId = env.ZOTERO_LIBRARY_ID || env.ZOTERO_USER_ID || "";
  const apiKey = env.ZOTERO_API_KEY || "";
  const configured = ["users", "groups"].includes(libraryType) && /^\d+$/.test(libraryId) && apiKey.length > 0;
  return { libraryType, libraryId, apiKey, configured };
}
async function webRequest(fetchImpl, config, path, { method = "GET", body, signal, timeoutMs = 2e4, write = false } = {}) {
  const headers = {
    "Zotero-API-Version": "3",
    "Zotero-API-Key": config.apiKey,
    Accept: "application/json"
  };
  if (write) {
    headers["Content-Type"] = "application/json";
    headers["Zotero-Write-Token"] = randomUUID().replace(/-/g, "");
  }
  const response = await fetchImpl(`${ZOTERO_ENDPOINTS.webApi}${path}`, {
    method,
    headers,
    body: body === void 0 ? void 0 : JSON.stringify(body),
    signal: timeoutSignal(timeoutMs, signal),
    redirect: "error"
  });
  return {
    status: response.status,
    ok: response.ok,
    json: await readJson(response),
    total: Number(response.headers.get("Total-Results"))
  };
}
async function webKeyAccess({ fetchImpl = fetch, config, signal } = {}) {
  const response = await webRequest(fetchImpl, config, "/keys/current", { signal });
  if (!response.ok)
    throw new Error(`Zotero Web API rejected the key (HTTP ${response.status}); no write performed.`);
  const access = response.json?.access || {};
  const scope = config.libraryType === "groups" ? access.groups?.[config.libraryId] || access.groups?.all || {} : String(response.json?.userID ?? "") === config.libraryId ? access.user || {} : {};
  return {
    userID: response.json?.userID ?? null,
    username: typeof response.json?.username === "string" ? response.json.username.slice(0, 100) : null,
    library: scope.library === true,
    write: scope.write === true
  };
}
async function webSearchByDoi({ fetchImpl = fetch, config, doi, signal } = {}) {
  const wanted = normalizeDoi(doi);
  if (!wanted) throw new Error("Valid DOI required");
  const response = await webRequest(
    fetchImpl,
    config,
    `/${config.libraryType}/${config.libraryId}/items?format=json&limit=100&q=${encodeURIComponent(wanted)}&qmode=everything`,
    { signal }
  );
  if (!response.ok)
    throw new Error(`Zotero Web API lookup failed (HTTP ${response.status}); no write performed.`);
  const complete = Array.isArray(response.json) && response.json.length <= 100 && !(response.total > 100);
  return { complete, items: complete ? summarizeMatches(response.json, wanted) : [] };
}
async function webCreateItems({ fetchImpl = fetch, config, items, signal } = {}) {
  const response = await webRequest(fetchImpl, config, `/${config.libraryType}/${config.libraryId}/items`, {
    method: "POST",
    body: items,
    write: true,
    signal,
    timeoutMs: 3e4
  });
  const successful = Object.entries(response.json?.successful || {}).map(([index, entry]) => ({
    index: Number(index),
    key: entry?.key || entry?.data?.key || null,
    version: entry?.version ?? null
  }));
  const failed = Object.entries(response.json?.failed || {}).map(([index, entry]) => ({
    index: Number(index),
    code: entry?.code ?? null,
    message: String(entry?.message || "").slice(0, 300)
  }));
  return { status: response.status, ok: response.ok, successful, failed };
}
async function webChildren({ fetchImpl = fetch, config, key, signal } = {}) {
  if (!KEY.test(key || "")) throw new Error("Valid Zotero key required");
  const response = await webRequest(
    fetchImpl,
    config,
    `/${config.libraryType}/${config.libraryId}/items/${key}/children?format=json&limit=100`,
    { signal }
  );
  if (!response.ok) throw new Error(`Zotero Web API children lookup failed (HTTP ${response.status})`);
  return Array.isArray(response.json) ? response.json : [];
}
function publicWebConfig(config) {
  return { configured: config.configured, libraryType: config.libraryType, libraryId: config.libraryId };
}
async function prepareZoteroSave(input = {}, { fetchImpl = fetch, env = process.env, signal } = {}) {
  const item = normalizeZoteroItem(input);
  const attachment = normalizeZoteroAttachment(input);
  const requested = textField(input.channel, 16, "channel") || "auto";
  if (!["auto", "connector", "web"].includes(requested))
    throw new Error("channel must be auto, connector or web");
  const collectionKey = textField(input.collection_key ?? input.collectionKey, 8, "collection_key") || null;
  if (collectionKey && !KEY.test(collectionKey))
    throw new Error("collection_key must be an 8-character Zotero key");
  const target = connectorTargetId(input.target);
  const webConfig = zoteroWebApiConfig(env);
  const connector = requested === "web" ? { reachable: false, skipped: true } : await probeZoteroConnector({ fetchImpl, signal });
  const channel = requested !== "web" && connector.reachable ? "connector" : requested !== "connector" && webConfig.configured ? "web" : null;
  if (!channel)
    throw new Error(
      requested === "web" ? "Zotero Web API is not configured: set ZOTERO_API_KEY (write scope) and ZOTERO_LIBRARY_ID / ZOTERO_USER_ID in the host environment, never in chat." : requested === "connector" ? "Zotero desktop is not reachable on 127.0.0.1:23119. Start Zotero 7 and enable Settings \u2192 Advanced \u2192 Allow other applications on this computer to communicate with Zotero." : "No Zotero write channel: start Zotero desktop (connector) or configure a write-scoped ZOTERO_API_KEY with ZOTERO_LIBRARY_ID in the environment. No library was queried."
    );
  const plan = {
    doi: item.doi,
    item,
    attachment,
    channel,
    connector,
    web: publicWebConfig(webConfig),
    target: null,
    existing: [],
    dedupComplete: false,
    action: "blocked",
    reason: null,
    readBackVia: channel === "connector" ? "local-api" : "web-api"
  };
  if (channel === "connector") {
    const selected = await connectorSaveTarget({ fetchImpl, signal });
    if (!selected.editable)
      throw new Error(
        `Zotero desktop's current target "${selected.libraryName}" is read-only; select an editable library or collection in Zotero first.`
      );
    plan.target = { kind: "connector", ...selected, requestedTarget: target, local: true };
    const found = await localApiSearchByDoi({ fetchImpl, doi: item.doi, signal });
    plan.existing = found.items;
    plan.dedupComplete = found.complete;
  } else {
    const access = await webKeyAccess({ fetchImpl, config: webConfig, signal });
    if (!access.write)
      throw new Error(
        `ZOTERO_API_KEY has no write permission for ${webConfig.libraryType}/${webConfig.libraryId}; create a write-scoped key in the Zotero account settings. No write performed.`
      );
    plan.target = {
      kind: "web",
      libraryType: webConfig.libraryType,
      libraryId: webConfig.libraryId,
      libraryName: webConfig.libraryType === "groups" ? `group ${webConfig.libraryId}` : access.username || "My Library",
      collectionKey,
      local: false
    };
    const found = await webSearchByDoi({ fetchImpl, config: webConfig, doi: item.doi, signal });
    plan.existing = found.items;
    plan.dedupComplete = found.complete;
  }
  if (!plan.dedupComplete) plan.reason = "dedup-incomplete";
  else if (plan.existing.length === 1) plan.action = "reuse";
  else if (plan.existing.length > 1) {
    plan.action = "ambiguous";
    plan.reason = "multiple-items-share-doi";
  } else plan.action = "create";
  return plan;
}
function selectLink(key) {
  return KEY.test(String(key || "")) ? `zotero://select/library/items/${key}` : null;
}
function fulltextFromChildren(children) {
  const pdfs = children.filter((child) => child?.data?.contentType === "application/pdf");
  return {
    pdfAttachmentKeys: pdfs.map((child) => child.key),
    status: pdfs.length ? "attachment-indexed-not-read" : "metadata-only"
  };
}
async function readBackByDoi(plan, { fetchImpl, env, signal, attempts, delayMs, sleep }) {
  const config = zoteroWebApiConfig(env);
  let last = { state: "unavailable", count: 0, attempts: 0 };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const found = plan.channel === "connector" ? await localApiSearchByDoi({ fetchImpl, doi: plan.doi, signal }) : await webSearchByDoi({ fetchImpl, config, doi: plan.doi, signal });
      last = {
        state: !found.complete ? "unknown" : found.items.length === 1 ? "found" : found.items.length ? "ambiguous" : "not-found",
        count: found.items.length,
        items: found.items,
        attempts: attempt
      };
      if (last.state === "found" || last.state === "ambiguous") break;
    } catch (error) {
      last = {
        state: "unavailable",
        count: 0,
        attempts: attempt,
        error: String(error.message || error).slice(0, 200)
      };
    }
    if (attempt < attempts) await sleep(delayMs);
  }
  if (last.state === "found") {
    try {
      const children = plan.channel === "connector" ? await localApiChildren({ fetchImpl, key: last.items[0].key, signal }) : await webChildren({ fetchImpl, config, key: last.items[0].key, signal });
      last.fulltext = fulltextFromChildren(children);
    } catch {
      last.fulltext = { pdfAttachmentKeys: [], status: "unavailable" };
    }
  }
  return last;
}
function baseReceipt(plan, at) {
  return {
    doi: plan.doi,
    title: plan.item.title,
    itemType: plan.item.itemType,
    channel: plan.channel,
    library: {
      type: plan.target?.libraryType || "users",
      id: plan.target?.libraryId ?? null,
      name: plan.target?.libraryName || null,
      local: plan.target?.local === true
    },
    collection: plan.target?.collectionKey ? { key: plan.target.collectionKey, name: null } : plan.target?.collectionId ? { id: plan.target.collectionId, name: plan.target.collectionName } : null,
    attachment: {
      requested: Boolean(plan.attachment),
      url: plan.attachment?.url || null,
      mode: plan.attachment ? plan.channel === "connector" ? "zotero-downloads-url" : "linked_url" : null,
      key: null
    },
    dedup: { existing: plan.existing, complete: plan.dedupComplete },
    zoteroKey: null,
    zoteroSelect: null,
    fulltextStatus: "unavailable",
    readBack: null,
    write: { performed: false, at },
    writesToLibraries: 0,
    autoRetry: false,
    attachmentContentsVerified: false,
    scientificallyVerified: false
  };
}
function receiptWithoutWrite(plan, { now = () => /* @__PURE__ */ new Date() } = {}) {
  const receipt = baseReceipt(plan, now().toISOString());
  if (plan.action === "reuse") {
    receipt.status = "reused";
    receipt.zoteroKey = plan.existing[0].key;
    receipt.zoteroSelect = selectLink(receipt.zoteroKey);
    receipt.reason = "existing-item-with-same-doi";
  } else {
    receipt.status = ["ambiguous", "cancelled"].includes(plan.action) ? plan.action : "blocked";
    receipt.reason = plan.reason || plan.action;
  }
  return receipt;
}
async function executeZoteroSave(plan, {
  fetchImpl = fetch,
  env = process.env,
  signal,
  now = () => /* @__PURE__ */ new Date(),
  sleep = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms)),
  readBackAttempts = 4,
  readBackDelayMs = 750
} = {}) {
  if (plan.action !== "create") throw new Error(`Refusing to write: plan action is ${plan.action}`);
  const at = now().toISOString();
  const receipt = baseReceipt(plan, at);
  receipt.write = { performed: true, at, httpStatus: null, error: null };
  receipt.writesToLibraries = 1;
  let writtenKey = null;
  try {
    if (plan.channel === "connector") {
      const payload = {
        sessionID: randomUUID().replace(/-/g, "").slice(0, 8),
        uri: plan.item.url,
        items: [toConnectorItem(plan.item, plan.attachment)]
      };
      if (plan.target?.requestedTarget) payload.target = plan.target.requestedTarget;
      const response = await connectorPost(fetchImpl, "/connector/saveItems", payload, {
        timeoutMs: 3e4,
        signal
      });
      receipt.write.httpStatus = response.status;
      if (!response.ok)
        receipt.write.error = `connector HTTP ${response.status}${response.json?.text ? `: ${response.json.text.slice(0, 200)}` : ""}`;
    } else {
      const config = zoteroWebApiConfig(env);
      const created = await webCreateItems({
        fetchImpl,
        config,
        items: [toWebApiItem(plan.item, { collectionKey: plan.target?.collectionKey || null })],
        signal
      });
      receipt.write.httpStatus = created.status;
      writtenKey = created.successful[0]?.key || null;
      if (!created.ok || !writtenKey)
        receipt.write.error = created.failed[0]?.message || `web api HTTP ${created.status}`;
      else if (plan.attachment) {
        const linked = await webCreateItems({
          fetchImpl,
          config,
          items: [
            {
              itemType: "attachment",
              linkMode: "linked_url",
              parentItem: writtenKey,
              title: plan.attachment.title,
              url: plan.attachment.url,
              contentType: "application/pdf",
              tags: []
            }
          ],
          signal
        });
        receipt.attachment.key = linked.successful[0]?.key || null;
        if (!receipt.attachment.key)
          receipt.attachment.error = linked.failed[0]?.message || `web api HTTP ${linked.status}`;
      }
    }
  } catch (error) {
    receipt.write.error = String(error.message || error).slice(0, 300);
  }
  const { items: observedItems = [], ...readBack } = await readBackByDoi(plan, {
    fetchImpl,
    env,
    signal,
    attempts: readBackAttempts,
    delayMs: readBackDelayMs,
    sleep
  });
  receipt.readBack = readBack;
  if (readBack.state === "found") {
    const observed = observedItems[0];
    receipt.zoteroKey = observed.key;
    receipt.zoteroSelect = selectLink(observed.key);
    receipt.fulltextStatus = receipt.readBack.fulltext?.status || "unavailable";
    receipt.status = writtenKey && writtenKey !== observed.key ? "unverified" : "saved";
    if (receipt.status === "unverified") receipt.reason = "read-back-key-differs";
  } else if (receipt.readBack.state === "ambiguous") {
    receipt.status = "ambiguous";
    receipt.reason = "multiple-items-share-doi-after-write";
  } else if (receipt.write.error) {
    receipt.status = "failed";
    receipt.reason = receipt.write.error;
  } else {
    receipt.status = "unverified";
    receipt.reason = receipt.readBack.state === "not-found" ? "written-but-not-read-back" : "read-back-unavailable";
  }
  return receipt;
}
function describeZoteroSavePlan(plan) {
  const authors = plan.item.creators.map(
    (c) => c.name || [c.firstName, c.lastName].filter(Boolean).join(" ")
  );
  const authorLine = authors.length ? `${authors.slice(0, 3).join("\u3001")}${authors.length > 3 ? ` \u7B49 ${authors.length} \u4EBA` : ""}` : "\uFF08\u672A\u63D0\u4F9B\u4F5C\u8005\uFF09";
  const where = plan.channel === "connector" ? `Zotero \u684C\u9762\uFF08\u5F53\u524D\u9009\u4E2D\uFF1A${plan.target.libraryName}${plan.target.collectionName ? ` / ${plan.target.collectionName}` : ""}${plan.target.requestedTarget ? `\uFF0C\u76EE\u6807 ${plan.target.requestedTarget}` : ""}\uFF09` : `Zotero \u7F51\u9875\u5E93 ${plan.target.libraryType}/${plan.target.libraryId}${plan.target.collectionKey ? `\uFF08\u5206\u7C7B ${plan.target.collectionKey}\uFF09` : ""}`;
  const attachment = !plan.attachment ? "\u4EC5\u5143\u6570\u636E\uFF0C\u4E0D\u5E26\u9644\u4EF6" : plan.channel === "connector" ? `\u7531 Zotero \u81EA\u884C\u4E0B\u8F7D ${plan.attachment.url}` : `\u4EE5\u94FE\u63A5\u5F62\u5F0F\u8BB0\u5F55 ${plan.attachment.url}\uFF08\u4E0D\u4E0A\u4F20\u6587\u4EF6\uFF09`;
  return [
    `\u8981\u5199\u5165\u7684\u6587\u732E\uFF1A
- \u6807\u9898\uFF1A${plan.item.title}
- \u4F5C\u8005\uFF1A${authorLine}
- DOI\uFF1A${plan.doi}
- \u7C7B\u578B\uFF1A${plan.item.itemType}${plan.item.date ? ` \xB7 ${plan.item.date}` : ""}`,
    `\u5199\u5165\u4F4D\u7F6E\uFF1A${where}`,
    `\u9644\u4EF6\uFF1A${attachment}`,
    `\u67E5\u91CD\uFF1A\u6309 DOI \u68C0\u7D22${plan.dedupComplete ? "\u672A\u53D1\u73B0\u5DF2\u6709\u6761\u76EE\uFF0C\u5C06\u65B0\u5EFA 1 \u6761" : "\u672A\u5B8C\u6210\uFF0C\u4E0D\u4F1A\u5199\u5165"}\u3002`,
    "\u5199\u5165\u540E\u4F1A\u6309 DOI \u8BFB\u56DE\u6838\u5BF9\uFF1B\u4E0D\u4F1A\u81EA\u52A8\u91CD\u8BD5\uFF0C\u4E5F\u4E0D\u4F1A\u5220\u9664\u3001\u5408\u5E76\u6216\u79FB\u52A8\u4EFB\u4F55\u6761\u76EE\u3002",
    "\u4E0D\u60F3\u5199\u5165\u5C31\u9009\u201C\u6682\u4E0D\u5199\u5165\u201D\u6216\u76F4\u63A5\u5173\u6389\uFF0CZotero \u4E0D\u4F1A\u6709\u4EFB\u4F55\u53D8\u5316\u3002"
  ].join("\n\n");
}
var MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
async function webJson(fetchImpl, config, path, signal) {
  const response = await webRequest(fetchImpl, config, path, { signal });
  if (!response.ok) throw new Error(`Zotero Web API HTTP ${response.status} for ${path.split("?")[0]}`);
  return response;
}
async function webGetItem({ fetchImpl = fetch, config, key, signal } = {}) {
  if (!KEY.test(key || "")) throw new Error("Valid Zotero key required");
  const response = await webJson(
    fetchImpl,
    config,
    `/${config.libraryType}/${config.libraryId}/items/${key}?format=json`,
    signal
  );
  const item = response.json || {};
  return {
    key: item.key,
    version: Number(item.version ?? item.data?.version ?? 0),
    title: String(item.data?.title || "").slice(0, 300),
    doi: normalizeDoi(item.data?.DOI || ""),
    itemType: item.data?.itemType || null,
    parentItem: item.data?.parentItem || null,
    collections: Array.isArray(item.data?.collections) ? item.data.collections : []
  };
}
async function webListCollections({ fetchImpl = fetch, config, signal } = {}) {
  const collections = [];
  for (let start = 0; start < 1e3; start += 100) {
    const response = await webJson(
      fetchImpl,
      config,
      `/${config.libraryType}/${config.libraryId}/collections?format=json&limit=100&start=${start}`,
      signal
    );
    const page = Array.isArray(response.json) ? response.json : [];
    for (const entry of page)
      if (KEY.test(entry?.key || ""))
        collections.push({
          key: entry.key,
          name: String(entry.data?.name || "").slice(0, 200),
          parent: entry.data?.parentCollection || null
        });
    if (page.length < 100 || !(response.total > start + 100)) break;
  }
  return collections;
}
async function webWrite(fetchImpl, config, path, { method, headers = {}, body, signal, timeoutMs = 3e4 }) {
  const response = await fetchImpl(`${ZOTERO_ENDPOINTS.webApi}${path}`, {
    method,
    headers: { "Zotero-API-Version": "3", "Zotero-API-Key": config.apiKey, ...headers },
    body,
    signal: timeoutSignal(timeoutMs, signal),
    redirect: "error"
  });
  return { status: response.status, ok: response.ok, json: await readJson(response) };
}
async function inspectLocalPdf(cwd, rawPath) {
  const path = textField(rawPath, 1e3, "local_file");
  if (!path) return null;
  const root = await realpath(cwd);
  const full = await realpath(isAbsolute(path) ? path : resolve(root, path));
  const rel = relative(root, full);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error("local_file must be inside the current project");
  const info = await stat(full);
  if (!info.isFile()) throw new Error("local_file is not a file");
  if (info.size > MAX_UPLOAD_BYTES) throw new Error("local_file is larger than 100 MB");
  const handle = await open(full, "r");
  const hash = createHash("md5");
  const head = Buffer.alloc(5);
  try {
    await handle.read(head, 0, 5, 0);
    const stream = handle.createReadStream({ autoClose: false, start: 0 });
    for await (const chunk of stream) hash.update(chunk);
  } finally {
    await handle.close();
  }
  if (head.toString("latin1") !== "%PDF-") throw new Error("local_file is not a PDF");
  return {
    path: full,
    relativePath: rel.split(sep).join("/"),
    filename: basename(full),
    size: info.size,
    mtime: Math.round(info.mtimeMs),
    md5: hash.digest("hex")
  };
}
async function prepareZoteroUpdate(input = {}, { fetchImpl = fetch, env = process.env, cwd = process.cwd(), signal } = {}) {
  const config = zoteroWebApiConfig(env);
  const plan = {
    kind: "update",
    channel: "web",
    web: publicWebConfig(config),
    action: "blocked",
    reason: null,
    item: null,
    doi: null,
    changes: { addCollection: null, attachUrl: null, uploadFile: null },
    skipped: []
  };
  if (!config.configured) {
    plan.reason = "Changing an existing Zotero item needs the Zotero Web API: Zotero desktop's local API is read-only. Ask the user to add a write-enabled API key in Drone Settings \u2192 Zotero \u2192 Web API (or set ZOTERO_API_KEY and ZOTERO_LIBRARY_ID). No change made.";
    return plan;
  }
  const access = await webKeyAccess({ fetchImpl, config, signal });
  if (!access.write) {
    plan.reason = `The Zotero API key has no write permission for ${config.libraryType}/${config.libraryId}; create a key with library write access. No change made.`;
    return plan;
  }
  plan.target = {
    kind: "web",
    libraryType: config.libraryType,
    libraryId: config.libraryId,
    libraryName: config.libraryType === "groups" ? `group ${config.libraryId}` : access.username || "My Library",
    local: false
  };
  let key = textField(input.zotero_key ?? input.key, 8, "zotero_key") || null;
  const doi = normalizeDoi(input.doi || "");
  if (!key) {
    if (!doi) throw new Error("zotero_key or doi is required");
    const found = await webSearchByDoi({ fetchImpl, config, doi, signal });
    if (!found.complete) {
      plan.reason = "dedup-incomplete";
      return plan;
    }
    if (found.items.length !== 1) {
      plan.reason = found.items.length ? "multiple-items-share-doi: pass zotero_key to choose one" : "no item with this DOI in the library; create it with research_zotero_save first";
      plan.candidates = found.items;
      return plan;
    }
    key = found.items[0]?.key ?? null;
  }
  const item = await webGetItem({ fetchImpl, config, key, signal });
  if (item.parentItem) throw new Error("zotero_key points to a child attachment/note, not a top-level item");
  plan.item = item;
  plan.doi = item.doi || doi || null;
  const collectionKey = textField(input.collection_key, 8, "collection_key") || null;
  const collectionName = textField(input.collection_name, 200, "collection_name") || null;
  if (collectionKey || collectionName) {
    const collections = await webListCollections({ fetchImpl, config, signal });
    const match = collectionKey ? collections.filter((entry) => entry.key === collectionKey) : collections.filter(
      (entry) => entry.name.trim().toLowerCase() === collectionName?.trim().toLowerCase()
    );
    if (match.length !== 1) {
      plan.reason = match.length ? `several collections are named "${collectionName}"; pass collection_key` : `collection ${collectionKey || `"${collectionName}"`} not found in this library`;
      plan.collections = collections.slice(0, 50).map(({ key: key2, name }) => ({ key: key2, name }));
      return plan;
    }
    const target = match[0];
    if (item.collections.includes(target.key)) plan.skipped.push(`already in collection "${target.name}"`);
    else plan.changes.addCollection = { key: target.key, name: target.name };
  }
  const attachmentUrl = textField(input.attachment_url, 2e3, "attachment_url") || null;
  const localFile = await inspectLocalPdf(cwd, input.local_file);
  if (attachmentUrl || localFile) {
    const children = await webChildren({ fetchImpl, config, key, signal });
    const existing = children.map((child) => child?.data || {});
    if (attachmentUrl) {
      if (!/^https?:\/\//i.test(attachmentUrl)) throw new Error("attachment_url must be http(s)");
      if (existing.some((child) => child.url === attachmentUrl))
        plan.skipped.push("link already attached");
      else
        plan.changes.attachUrl = {
          url: attachmentUrl,
          title: textField(input.attachment_title, 200, "attachment_title") || "Full Text (link)"
        };
    }
    if (localFile) {
      if (existing.some((child) => child.md5 === localFile.md5))
        plan.skipped.push("same PDF already attached");
      else plan.changes.uploadFile = localFile;
    }
  }
  plan.action = Object.values(plan.changes).some(Boolean) ? "update" : "unchanged";
  if (plan.action === "unchanged") plan.reason = plan.skipped.join("; ") || "nothing to change";
  return plan;
}
async function uploadAttachment(fetchImpl, config, parentKey, file, signal) {
  const lib = `/${config.libraryType}/${config.libraryId}`;
  const created = await webCreateItems({
    fetchImpl,
    config,
    items: [
      {
        itemType: "attachment",
        linkMode: "imported_file",
        parentItem: parentKey,
        title: file.filename,
        contentType: "application/pdf",
        filename: file.filename,
        tags: []
      }
    ],
    signal
  });
  const key = created.successful[0]?.key;
  if (!key) return { key: null, error: created.failed[0]?.message || `web api HTTP ${created.status}` };
  const form = { "Content-Type": "application/x-www-form-urlencoded", "If-None-Match": "*" };
  const auth = await webWrite(fetchImpl, config, `${lib}/items/${key}/file`, {
    method: "POST",
    headers: form,
    body: new URLSearchParams({
      md5: file.md5,
      filename: file.filename,
      filesize: String(file.size),
      mtime: String(file.mtime)
    }).toString(),
    signal
  });
  if (!auth.ok)
    return {
      key,
      error: `upload authorization HTTP ${auth.status}${auth.json?.text ? `: ${auth.json.text.slice(0, 200)}` : ""}`
    };
  if (auth.json?.exists === 1) return { key, error: null, deduplicated: true };
  const handle = await open(file.path, "r");
  let bytes;
  try {
    bytes = await handle.readFile();
  } finally {
    await handle.close();
  }
  const body = Buffer.concat([
    Buffer.from(auth.json.prefix || "", "utf8"),
    bytes,
    Buffer.from(auth.json.suffix || "", "utf8")
  ]);
  const uploadUrl = String(auth.json.url || "");
  if (!/^https:\/\//.test(uploadUrl)) return { key, error: "upload authorization returned no https URL" };
  const uploaded = await fetchImpl(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": String(auth.json.contentType || "application/octet-stream") },
    body,
    signal: timeoutSignal(12e4, signal),
    redirect: "error"
  });
  if (uploaded.status !== 201 && uploaded.status !== 204)
    return { key, error: `file upload HTTP ${uploaded.status}` };
  const registered = await webWrite(fetchImpl, config, `${lib}/items/${key}/file`, {
    method: "POST",
    headers: form,
    body: new URLSearchParams({ upload: String(auth.json.uploadKey || "") }).toString(),
    signal
  });
  return { key, error: registered.status === 204 ? null : `upload registration HTTP ${registered.status}` };
}
async function executeZoteroUpdate(plan, { fetchImpl = fetch, env = process.env, signal, now = () => /* @__PURE__ */ new Date() } = {}) {
  if (plan.action !== "update") throw new Error(`Refusing to write: plan action is ${plan.action}`);
  const config = zoteroWebApiConfig(env);
  const lib = `/${config.libraryType}/${config.libraryId}`;
  const at = now().toISOString();
  const results = {};
  if (plan.changes.addCollection) {
    const patched = await webWrite(fetchImpl, config, `${lib}/items/${plan.item.key}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "If-Unmodified-Since-Version": String(plan.item.version)
      },
      body: JSON.stringify({ collections: [...plan.item.collections, plan.changes.addCollection.key] }),
      signal
    });
    results.addCollection = {
      ...plan.changes.addCollection,
      httpStatus: patched.status,
      error: patched.status === 204 ? null : patched.status === 412 ? "the item changed in Zotero after it was read; nothing was overwritten, run the update again" : `HTTP ${patched.status}`
    };
  }
  if (plan.changes.attachUrl) {
    const linked = await webCreateItems({
      fetchImpl,
      config,
      items: [
        {
          itemType: "attachment",
          linkMode: "linked_url",
          parentItem: plan.item.key,
          title: plan.changes.attachUrl.title,
          url: plan.changes.attachUrl.url,
          contentType: "application/pdf",
          tags: []
        }
      ],
      signal
    });
    results.attachUrl = {
      url: plan.changes.attachUrl.url,
      key: linked.successful[0]?.key || null,
      error: linked.successful[0]?.key ? null : linked.failed[0]?.message || `HTTP ${linked.status}`
    };
  }
  if (plan.changes.uploadFile) {
    try {
      results.uploadFile = {
        file: plan.changes.uploadFile.relativePath,
        size: plan.changes.uploadFile.size,
        ...await uploadAttachment(fetchImpl, config, plan.item.key, plan.changes.uploadFile, signal)
      };
    } catch (error) {
      results.uploadFile = {
        file: plan.changes.uploadFile.relativePath,
        key: null,
        error: String(error.message || error).slice(0, 300)
      };
    }
  }
  const readBack = {};
  try {
    const item = await webGetItem({ fetchImpl, config, key: plan.item.key, signal });
    readBack.collections = item.collections;
    if (results.addCollection)
      results.addCollection.verified = item.collections.includes(results.addCollection.key);
    const children = await webChildren({ fetchImpl, config, key: plan.item.key, signal });
    const childKeys = new Set(children.map((child) => child?.key));
    if (results.attachUrl?.key) results.attachUrl.verified = childKeys.has(results.attachUrl.key);
    if (results.uploadFile?.key) {
      const child = children.find((entry) => entry?.key === results.uploadFile.key);
      results.uploadFile.verified = Boolean(child) && (results.uploadFile.deduplicated || child?.data?.md5 === plan.changes.uploadFile.md5);
    }
  } catch (error) {
    readBack.error = String(error.message || error).slice(0, 200);
  }
  const outcomes = Object.values(results);
  const failed = outcomes.filter((entry) => entry.error);
  const verified = outcomes.filter((entry) => entry.verified);
  return {
    kind: "update",
    channel: "web",
    doi: plan.doi,
    title: plan.item.title,
    zoteroKey: plan.item.key,
    zoteroSelect: selectLink(plan.item.key),
    library: {
      type: config.libraryType,
      id: config.libraryId,
      name: plan.target?.libraryName || null,
      local: false
    },
    changes: results,
    skipped: plan.skipped,
    readBack,
    write: { performed: true, at },
    status: failed.length === outcomes.length ? "failed" : failed.length ? "partial" : verified.length === outcomes.length ? "updated" : "unverified",
    autoRetry: false,
    attachmentContentsVerified: false
  };
}
function receiptWithoutUpdate(plan) {
  return {
    kind: "update",
    channel: "web",
    doi: plan.doi,
    title: plan.item?.title || null,
    zoteroKey: plan.item?.key || null,
    zoteroSelect: selectLink(plan.item?.key),
    status: plan.action === "unchanged" ? "unchanged" : plan.action === "cancelled" ? "cancelled" : "blocked",
    reason: plan.reason,
    skipped: plan.skipped,
    ...plan.candidates ? { candidates: plan.candidates } : {},
    ...plan.collections ? { collections: plan.collections } : {},
    write: { performed: false }
  };
}
function describeZoteroUpdatePlan(plan) {
  const lines = [
    `\u8981\u4FEE\u6539\u7684\u5DF2\u6709\u6761\u76EE\uFF1A
- \u6807\u9898\uFF1A${plan.item.title}
- DOI\uFF1A${plan.doi || "\uFF08\u65E0\uFF09"}
- Zotero \u952E\uFF1A${plan.item.key}`
  ];
  const changes = [];
  if (plan.changes.addCollection)
    changes.push(`\u52A0\u5165\u5206\u7C7B\u300C${plan.changes.addCollection.name}\u300D\uFF08\u4FDD\u7559\u539F\u6709\u5206\u7C7B\uFF09`);
  if (plan.changes.attachUrl) changes.push(`\u6DFB\u52A0\u94FE\u63A5\u9644\u4EF6 ${plan.changes.attachUrl.url}`);
  if (plan.changes.uploadFile)
    changes.push(
      `\u4E0A\u4F20\u672C\u5730 PDF ${plan.changes.uploadFile.relativePath}\uFF08${(plan.changes.uploadFile.size / 1024 / 1024).toFixed(1)} MB\uFF0C\u5360\u7528 Zotero \u4E91\u5B58\u50A8\u914D\u989D\uFF09`
    );
  lines.push(`\u4FEE\u6539\u5185\u5BB9\uFF1A
${changes.map((line) => `- ${line}`).join("\n")}`);
  if (plan.skipped.length) lines.push(`\u8DF3\u8FC7\uFF1A${plan.skipped.join("\uFF1B")}`);
  lines.push(
    `\u901A\u8FC7 Zotero \u7F51\u9875 API \u5199\u5165 ${plan.target.libraryType}/${plan.target.libraryId}\uFF1B\u53EA\u6DFB\u52A0\uFF0C\u4E0D\u5220\u9664\u3001\u4E0D\u79FB\u51FA\u4EFB\u4F55\u5206\u7C7B\uFF1B\u5199\u540E\u8BFB\u56DE\u6838\u5BF9\uFF0C\u4E0D\u81EA\u52A8\u91CD\u8BD5\u3002`
  );
  return lines.join("\n\n");
}
export {
  ZOTERO_ENDPOINTS,
  ZOTERO_ITEM_TYPES,
  connectorSaveTarget,
  connectorTargetId,
  describeZoteroSavePlan,
  describeZoteroUpdatePlan,
  executeZoteroSave,
  executeZoteroUpdate,
  localApiChildren,
  localApiSearchByDoi,
  normalizeZoteroAttachment,
  normalizeZoteroItem,
  prepareZoteroSave,
  prepareZoteroUpdate,
  probeZoteroConnector,
  receiptWithoutUpdate,
  receiptWithoutWrite,
  toConnectorItem,
  toWebApiItem,
  webChildren,
  webCreateItems,
  webGetItem,
  webKeyAccess,
  webListCollections,
  webRequest,
  webSearchByDoi,
  zoteroWebApiConfig
};
