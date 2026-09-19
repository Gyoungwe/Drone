import { randomUUID } from "node:crypto";
import { exactDoiItems, normalizeDoi } from "./literature-receipt.mjs";

/**
 * Host-controlled Zotero writes. Two channels, one contract:
 *  - connector: the Zotero desktop connector endpoint (http://127.0.0.1:23119/connector/*), read back through the local API.
 *  - web: the Zotero Web API v3 with a write-scoped ZOTERO_API_KEY from the environment, read back through the same API.
 * Every write is dedup-checked by exact DOI first, written at most once, then read back by DOI. Nothing here retries,
 * merges, moves or deletes items; an uncertain outcome stays "unverified" for a human or a later reconcile.
 */
export const ZOTERO_ENDPOINTS = Object.freeze({
	connector: "http://127.0.0.1:23119",
	localApi: "http://127.0.0.1:23119/api",
	webApi: "https://api.zotero.org",
});

const ITEM_TYPES = Object.freeze({
	journalArticle: { container: "publicationTitle", doi: true, fields: ["volume", "issue", "pages"] },
	conferencePaper: { container: "proceedingsTitle", doi: true, fields: ["volume", "pages"] },
	preprint: { container: "repository", doi: true, fields: [] },
	dataset: { container: "repository", doi: true, fields: [] },
	book: { container: null, doi: false, fields: ["volume"] },
	bookSection: { container: "bookTitle", doi: false, fields: ["volume", "pages"] },
	thesis: { container: "university", doi: false, fields: [] },
	report: { container: "institution", doi: false, fields: ["pages"] },
	webpage: { container: "websiteTitle", doi: false, fields: [] },
});
export const ZOTERO_ITEM_TYPES = Object.freeze(Object.keys(ITEM_TYPES));
const LIMITS = Object.freeze({ title: 1000, field: 500, abstract: 5000, creators: 200, tags: 32, tag: 200 });
const KEY = /^[A-Z0-9]{8}$/;

function textField(value, max, name) {
	if (value === undefined || value === null) return "";
	if (typeof value !== "string" && typeof value !== "number") throw new Error(`${name} must be a string`);
	const text = String(value)
		.replace(/\p{Cc}/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (text.length > max) throw new Error(`${name} exceeds ${max} characters`);
	return text;
}
function normalizeCreators(input) {
	if (input === undefined || input === null) return [];
	if (!Array.isArray(input)) throw new Error("creators must be an array");
	if (input.length > LIMITS.creators) throw new Error(`creators exceeds ${LIMITS.creators} entries`);
	return input.map((raw, index) => {
		const creator = typeof raw === "string" ? { name: raw } : raw && typeof raw === "object" ? raw : null;
		if (!creator) throw new Error(`creators[${index}] must be an object or a string`);
		const creatorType =
			textField(creator.creator_type || creator.creatorType, 40, "creator_type") || "author";
		if (!/^[a-z][A-Za-z]{2,30}$/.test(creatorType))
			throw new Error(`creators[${index}] has an invalid creator_type`);
		const lastName = textField(creator.last_name ?? creator.lastName, LIMITS.field, "last_name");
		const firstName = textField(creator.first_name ?? creator.firstName, LIMITS.field, "first_name");
		const name = textField(creator.name, LIMITS.field, "name");
		if (lastName) return { creatorType, lastName, firstName };
		if (name) return { creatorType, name };
		throw new Error(`creators[${index}] needs last_name or name`);
	});
}
function normalizeTags(input) {
	if (input === undefined || input === null) return [];
	if (!Array.isArray(input)) throw new Error("tags must be an array of strings");
	const tags = [
		...new Set(input.map((tag, index) => textField(tag, LIMITS.tag, `tags[${index}]`)).filter(Boolean)),
	];
	if (tags.length > LIMITS.tags) throw new Error(`tags exceeds ${LIMITS.tags} entries`);
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
	if (!["http:", "https:"].includes(url.protocol)) throw new Error(`${name} must use http or https`);
	return url.href;
}

/** Whitelisted, size-bounded item metadata. Unknown fields never reach Zotero. */
export function normalizeZoteroItem(input = {}) {
	const doi = normalizeDoi(input.doi);
	if (!doi) throw new Error("A valid DOI (10.xxxx/...) is required; Zotero writes are keyed by exact DOI.");
	const itemType = textField(input.item_type || input.itemType, 40, "item_type") || "journalArticle";
	const spec = ITEM_TYPES[itemType];
	if (!spec)
		throw new Error(`Unsupported item_type "${itemType}"; use one of ${ZOTERO_ITEM_TYPES.join(", ")}`);
	const title = textField(input.title, LIMITS.title, "title");
	if (!title) throw new Error("title is required");
	const fields = {};
	for (const name of spec.fields) {
		const value = textField(input[name], LIMITS.field, name);
		if (value) fields[name] = value;
	}
	const container = textField(input.publication ?? input.container_title, LIMITS.field, "publication");
	if (container && spec.container) fields[spec.container] = container;
	const extra = [];
	if (container && !spec.container) extra.push(`Published in: ${container}`);
	if (!spec.doi) extra.push(`DOI: ${doi}`);
	const abstractNote = textField(input.abstract ?? input.abstractNote, LIMITS.abstract, "abstract");
	return {
		doi,
		itemType,
		title,
		creators: normalizeCreators(input.creators),
		date: textField(input.date, 64, "date"),
		url: httpUrl(input.url, "url") || `https://doi.org/${doi}`,
		abstractNote,
		fields,
		extra: extra.join("\n"),
		tags: normalizeTags(input.tags),
		doiField: spec.doi,
	};
}
export function normalizeZoteroAttachment(input = {}) {
	const url = httpUrl(input.attachment_url ?? input.attachmentUrl, "attachment_url");
	if (!url) return null;
	return {
		url,
		title: textField(input.attachment_title, LIMITS.field, "attachment_title") || "Full Text PDF",
	};
}

export function toConnectorItem(item, attachment = null) {
	const payload = {
		itemType: item.itemType,
		title: item.title,
		creators: item.creators.map((c) =>
			c.name ? { creatorType: c.creatorType, lastName: c.name, fieldMode: 1 } : { ...c },
		),
		date: item.date,
		url: item.url,
		abstractNote: item.abstractNote,
		...item.fields,
		tags: item.tags.map((tag) => ({ tag })),
		attachments: attachment
			? [{ title: attachment.title, url: attachment.url, mimeType: "application/pdf" }]
			: [],
	};
	if (item.doiField) payload.DOI = item.doi;
	if (item.extra) payload.extra = item.extra;
	return payload;
}
export function toWebApiItem(item, { collectionKey = null } = {}) {
	const payload = {
		itemType: item.itemType,
		title: item.title,
		creators: item.creators.map((c) => ({ ...c })),
		date: item.date,
		url: item.url,
		abstractNote: item.abstractNote,
		...item.fields,
		tags: item.tags.map((tag) => ({ tag })),
		collections: collectionKey ? [collectionKey] : [],
	};
	if (item.doiField) payload.DOI = item.doi;
	if (item.extra) payload.extra = item.extra;
	return payload;
}

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
		return { text: body.slice(0, 2000) };
	}
}

// --- Connector channel (Zotero desktop) -------------------------------------------------------
async function connectorPost(fetchImpl, path, body, { timeoutMs = 20000, signal } = {}) {
	const response = await fetchImpl(`${ZOTERO_ENDPOINTS.connector}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify(body),
		signal: timeoutSignal(timeoutMs, signal),
		redirect: "error",
	});
	return {
		status: response.status,
		ok: response.ok,
		headers: response.headers,
		json: await readJson(response),
	};
}
export async function probeZoteroConnector({ fetchImpl = fetch, signal, timeoutMs = 3000 } = {}) {
	try {
		const response = await connectorPost(fetchImpl, "/connector/ping", {}, { timeoutMs, signal });
		return {
			reachable: response.ok,
			status: response.status,
			version: response.headers?.get?.("X-Zotero-Version") || null,
		};
	} catch (error) {
		return { reachable: false, error: error.name === "TimeoutError" ? "timeout" : "unreachable" };
	}
}
/** The library/collection Zotero desktop currently has selected; the connector saves there unless a target is given. */
export async function connectorSaveTarget({ fetchImpl = fetch, signal } = {}) {
	const response = await connectorPost(fetchImpl, "/connector/getSelectedCollection", {}, { signal });
	if (!response.ok || !response.json || typeof response.json !== "object")
		throw new Error(`Zotero desktop did not report a save target (HTTP ${response.status}).`);
	const t = response.json;
	return {
		libraryId: t.libraryID === undefined || t.libraryID === null ? null : String(t.libraryID),
		libraryName: typeof t.libraryName === "string" ? t.libraryName.slice(0, 200) : "My Library",
		editable: t.libraryEditable !== false && t.editable !== false,
		collectionId: t.id ? String(t.id) : null,
		collectionName: t.id && typeof t.name === "string" ? t.name.slice(0, 200) : null,
	};
}
async function localApiGet(fetchImpl, path, { signal, timeoutMs = 10000 } = {}) {
	const response = await fetchImpl(`${ZOTERO_ENDPOINTS.localApi}/users/0/${path}`, {
		headers: { Accept: "application/json" },
		signal: timeoutSignal(timeoutMs, signal),
		redirect: "error",
	});
	if (!response.ok) throw new Error(`Zotero local API HTTP ${response.status}`);
	return { data: await readJson(response), total: Number(response.headers.get("Total-Results")) };
}
function summarizeMatches(items, doi) {
	return exactDoiItems(items, doi)
		.filter((item) => KEY.test(item.key || ""))
		.map((item) => ({
			key: item.key,
			title: String(item.data?.title || "").slice(0, 200),
			itemType: item.data?.itemType || null,
			collections: Array.isArray(item.data?.collections) ? item.data.collections.slice(0, 20) : [],
		}));
}
export async function localApiSearchByDoi({ fetchImpl = fetch, doi, signal } = {}) {
	const wanted = normalizeDoi(doi);
	if (!wanted) throw new Error("Valid DOI required");
	const result = await localApiGet(
		fetchImpl,
		`items?format=json&limit=100&q=${encodeURIComponent(wanted)}&qmode=everything`,
		{ signal },
	);
	const complete = Array.isArray(result.data) && result.data.length <= 100 && !(result.total > 100);
	return { complete, items: complete ? summarizeMatches(result.data, wanted) : [] };
}
export async function localApiChildren({ fetchImpl = fetch, key, signal } = {}) {
	if (!KEY.test(key || "")) throw new Error("Valid Zotero key required");
	const result = await localApiGet(fetchImpl, `items/${key}/children?format=json&limit=100`, { signal });
	return Array.isArray(result.data) ? result.data : [];
}

// --- Web API channel ----------------------------------------------------------------------------
export function zoteroWebApiConfig(env = process.env) {
	const libraryType = env.ZOTERO_LIBRARY_TYPE || "users";
	const libraryId = env.ZOTERO_LIBRARY_ID || env.ZOTERO_USER_ID || "";
	const apiKey = env.ZOTERO_API_KEY || "";
	const configured =
		["users", "groups"].includes(libraryType) && /^\d+$/.test(libraryId) && apiKey.length > 0;
	return { libraryType, libraryId, apiKey, configured };
}
async function webRequest(
	fetchImpl,
	config,
	path,
	{ method = "GET", body, signal, timeoutMs = 20000, write = false } = {},
) {
	const headers = { "Zotero-API-Version": "3", "Zotero-API-Key": config.apiKey, Accept: "application/json" };
	if (write) {
		headers["Content-Type"] = "application/json";
		headers["Zotero-Write-Token"] = randomUUID().replace(/-/g, "");
	}
	const response = await fetchImpl(`${ZOTERO_ENDPOINTS.webApi}${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: timeoutSignal(timeoutMs, signal),
		redirect: "error",
	});
	return {
		status: response.status,
		ok: response.ok,
		json: await readJson(response),
		total: Number(response.headers.get("Total-Results")),
	};
}
export async function webKeyAccess({ fetchImpl = fetch, config, signal } = {}) {
	const response = await webRequest(fetchImpl, config, "/keys/current", { signal });
	if (!response.ok)
		throw new Error(`Zotero Web API rejected the key (HTTP ${response.status}); no write performed.`);
	const access = response.json?.access || {};
	const scope =
		config.libraryType === "groups"
			? access.groups?.[config.libraryId] || access.groups?.all || {}
			: String(response.json?.userID ?? "") === config.libraryId
				? access.user || {}
				: {};
	return {
		userID: response.json?.userID ?? null,
		username: typeof response.json?.username === "string" ? response.json.username.slice(0, 100) : null,
		library: scope.library === true,
		write: scope.write === true,
	};
}
export async function webSearchByDoi({ fetchImpl = fetch, config, doi, signal } = {}) {
	const wanted = normalizeDoi(doi);
	if (!wanted) throw new Error("Valid DOI required");
	const response = await webRequest(
		fetchImpl,
		config,
		`/${config.libraryType}/${config.libraryId}/items?format=json&limit=100&q=${encodeURIComponent(wanted)}&qmode=everything`,
		{ signal },
	);
	if (!response.ok)
		throw new Error(`Zotero Web API lookup failed (HTTP ${response.status}); no write performed.`);
	const complete = Array.isArray(response.json) && response.json.length <= 100 && !(response.total > 100);
	return { complete, items: complete ? summarizeMatches(response.json, wanted) : [] };
}
export async function webCreateItems({ fetchImpl = fetch, config, items, signal } = {}) {
	const response = await webRequest(fetchImpl, config, `/${config.libraryType}/${config.libraryId}/items`, {
		method: "POST",
		body: items,
		write: true,
		signal,
		timeoutMs: 30000,
	});
	const successful = Object.entries(response.json?.successful || {}).map(([index, entry]) => ({
		index: Number(index),
		key: entry?.key || entry?.data?.key || null,
		version: entry?.version ?? null,
	}));
	const failed = Object.entries(response.json?.failed || {}).map(([index, entry]) => ({
		index: Number(index),
		code: entry?.code ?? null,
		message: String(entry?.message || "").slice(0, 300),
	}));
	return { status: response.status, ok: response.ok, successful, failed };
}
export async function webChildren({ fetchImpl = fetch, config, key, signal } = {}) {
	if (!KEY.test(key || "")) throw new Error("Valid Zotero key required");
	const response = await webRequest(
		fetchImpl,
		config,
		`/${config.libraryType}/${config.libraryId}/items/${key}/children?format=json&limit=100`,
		{ signal },
	);
	if (!response.ok) throw new Error(`Zotero Web API children lookup failed (HTTP ${response.status})`);
	return Array.isArray(response.json) ? response.json : [];
}

// --- Plan → consent → execute --------------------------------------------------------------------
function publicWebConfig(config) {
	return { configured: config.configured, libraryType: config.libraryType, libraryId: config.libraryId };
}
export function connectorTargetId(value) {
	const text = textField(value, 32, "target");
	if (!text) return null;
	if (!/^[LC]\d{1,12}$/.test(text))
		throw new Error('target must look like "L1" (library) or "C123" (collection)');
	return text;
}
/**
 * Read-only preparation: pick a channel, confirm the target is writable, and dedup by exact DOI.
 * action: create | reuse | ambiguous | blocked. Only "create" leads to a write, and only after consent.
 */
export async function prepareZoteroSave(input = {}, { fetchImpl = fetch, env = process.env, signal } = {}) {
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
	const connector =
		requested === "web"
			? { reachable: false, skipped: true }
			: await probeZoteroConnector({ fetchImpl, signal });
	const channel =
		requested !== "web" && connector.reachable
			? "connector"
			: requested !== "connector" && webConfig.configured
				? "web"
				: null;
	if (!channel)
		throw new Error(
			requested === "web"
				? "Zotero Web API is not configured: set ZOTERO_API_KEY (write scope) and ZOTERO_LIBRARY_ID / ZOTERO_USER_ID in the host environment, never in chat."
				: requested === "connector"
					? "Zotero desktop is not reachable on 127.0.0.1:23119. Start Zotero 7 and enable Settings → Advanced → Allow other applications on this computer to communicate with Zotero."
					: "No Zotero write channel: start Zotero desktop (connector) or configure a write-scoped ZOTERO_API_KEY with ZOTERO_LIBRARY_ID in the environment. No library was queried.",
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
		readBackVia: channel === "connector" ? "local-api" : "web-api",
	};
	if (channel === "connector") {
		const selected = await connectorSaveTarget({ fetchImpl, signal });
		if (!selected.editable)
			throw new Error(
				`Zotero desktop's current target "${selected.libraryName}" is read-only; select an editable library or collection in Zotero first.`,
			);
		plan.target = { kind: "connector", ...selected, requestedTarget: target, local: true };
		const found = await localApiSearchByDoi({ fetchImpl, doi: item.doi, signal });
		plan.existing = found.items;
		plan.dedupComplete = found.complete;
	} else {
		const access = await webKeyAccess({ fetchImpl, config: webConfig, signal });
		if (!access.write)
			throw new Error(
				`ZOTERO_API_KEY has no write permission for ${webConfig.libraryType}/${webConfig.libraryId}; create a write-scoped key in the Zotero account settings. No write performed.`,
			);
		plan.target = {
			kind: "web",
			libraryType: webConfig.libraryType,
			libraryId: webConfig.libraryId,
			libraryName:
				webConfig.libraryType === "groups" ? `group ${webConfig.libraryId}` : access.username || "My Library",
			collectionKey,
			local: false,
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
	return KEY.test(key || "") ? `zotero://select/library/items/${key}` : null;
}
function fulltextFromChildren(children) {
	const pdfs = children.filter((child) => child?.data?.contentType === "application/pdf");
	return {
		pdfAttachmentKeys: pdfs.map((child) => child.key),
		status: pdfs.length ? "attachment-indexed-not-read" : "metadata-only",
	};
}
async function readBackByDoi(plan, { fetchImpl, env, signal, attempts, delayMs, sleep }) {
	const config = zoteroWebApiConfig(env);
	let last = { state: "unavailable", count: 0, attempts: 0 };
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			const found =
				plan.channel === "connector"
					? await localApiSearchByDoi({ fetchImpl, doi: plan.doi, signal })
					: await webSearchByDoi({ fetchImpl, config, doi: plan.doi, signal });
			last = {
				state: !found.complete
					? "unknown"
					: found.items.length === 1
						? "found"
						: found.items.length
							? "ambiguous"
							: "not-found",
				count: found.items.length,
				items: found.items,
				attempts: attempt,
			};
			if (last.state === "found" || last.state === "ambiguous") break;
		} catch (error) {
			last = {
				state: "unavailable",
				count: 0,
				attempts: attempt,
				error: String(error.message || error).slice(0, 200),
			};
		}
		if (attempt < attempts) await sleep(delayMs);
	}
	if (last.state === "found") {
		try {
			const children =
				plan.channel === "connector"
					? await localApiChildren({ fetchImpl, key: last.items[0].key, signal })
					: await webChildren({ fetchImpl, config, key: last.items[0].key, signal });
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
			local: plan.target?.local === true,
		},
		collection: plan.target?.collectionKey
			? { key: plan.target.collectionKey, name: null }
			: plan.target?.collectionId
				? { id: plan.target.collectionId, name: plan.target.collectionName }
				: null,
		attachment: {
			requested: Boolean(plan.attachment),
			url: plan.attachment?.url || null,
			mode: plan.attachment ? (plan.channel === "connector" ? "zotero-downloads-url" : "linked_url") : null,
			key: null,
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
		scientificallyVerified: false,
	};
}
/** A receipt for plans that must not write (reuse / ambiguous / blocked). */
export function receiptWithoutWrite(plan, { now = () => new Date() } = {}) {
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
/** Performs exactly one write for a "create" plan, then reads back by DOI. Never retries. */
export async function executeZoteroSave(
	plan,
	{
		fetchImpl = fetch,
		env = process.env,
		signal,
		now = () => new Date(),
		sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		readBackAttempts = 4,
		readBackDelayMs = 750,
	} = {},
) {
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
				items: [toConnectorItem(plan.item, plan.attachment)],
			};
			if (plan.target?.requestedTarget) payload.target = plan.target.requestedTarget;
			const response = await connectorPost(fetchImpl, "/connector/saveItems", payload, {
				timeoutMs: 30000,
				signal,
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
				signal,
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
							tags: [],
						},
					],
					signal,
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
		sleep,
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
		receipt.reason =
			receipt.readBack.state === "not-found" ? "written-but-not-read-back" : "read-back-unavailable";
	}
	return receipt;
}

/** A user-facing consent card body (same tone as the task authorization card). */
export function describeZoteroSavePlan(plan) {
	const authors = plan.item.creators.map(
		(c) => c.name || [c.firstName, c.lastName].filter(Boolean).join(" "),
	);
	const authorLine = authors.length
		? `${authors.slice(0, 3).join("、")}${authors.length > 3 ? ` 等 ${authors.length} 人` : ""}`
		: "（未提供作者）";
	const where =
		plan.channel === "connector"
			? `Zotero 桌面（当前选中：${plan.target.libraryName}${plan.target.collectionName ? ` / ${plan.target.collectionName}` : ""}${plan.target.requestedTarget ? `，目标 ${plan.target.requestedTarget}` : ""}）`
			: `Zotero 网页库 ${plan.target.libraryType}/${plan.target.libraryId}${plan.target.collectionKey ? `（分类 ${plan.target.collectionKey}）` : ""}`;
	const attachment = !plan.attachment
		? "仅元数据，不带附件"
		: plan.channel === "connector"
			? `由 Zotero 自行下载 ${plan.attachment.url}`
			: `以链接形式记录 ${plan.attachment.url}（不上传文件）`;
	return [
		`要写入的文献：\n- 标题：${plan.item.title}\n- 作者：${authorLine}\n- DOI：${plan.doi}\n- 类型：${plan.item.itemType}${plan.item.date ? ` · ${plan.item.date}` : ""}`,
		`写入位置：${where}`,
		`附件：${attachment}`,
		`查重：按 DOI 检索${plan.dedupComplete ? "未发现已有条目，将新建 1 条" : "未完成，不会写入"}。`,
		"写入后会按 DOI 读回核对；不会自动重试，也不会删除、合并或移动任何条目。",
		"不想写入就选“暂不写入”或直接关掉，Zotero 不会有任何变化。",
	].join("\n\n");
}
