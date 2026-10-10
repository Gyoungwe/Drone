import { createHash, randomUUID } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { externalEffectKey } from "@drone/compute/jobs/idempotency";
import { exactDoiItems, normalizeDoi } from "./literature-receipt";
import { zoteroLibraryPath } from "./zotero-library";
import {
	connectorTargetId,
	normalizeZoteroAttachment,
	normalizeZoteroItem,
	textField,
	toConnectorItem,
	toWebApiItem,
} from "./zotero-write";

export {
	connectorTargetId,
	normalizeZoteroAttachment,
	normalizeZoteroItem,
	toConnectorItem,
	toWebApiItem,
	ZOTERO_ITEM_TYPES,
} from "./zotero-write";

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

const KEY = /^[A-Z0-9]{8}$/;

function timeoutSignal(ms: number, signal?: AbortSignal) {
	const timer = AbortSignal.timeout(ms);
	return signal ? AbortSignal.any([signal, timer]) : timer;
}
async function readJson(response: Response, limit = 2 * 1024 * 1024): Promise<any> {
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
async function connectorPost(
	fetchImpl: typeof fetch,
	path: string,
	body: unknown,
	{ timeoutMs = 20000, signal }: Record<string, any> = {},
) {
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
export async function probeZoteroConnector({
	fetchImpl = fetch,
	signal,
	timeoutMs = 3000,
}: Record<string, any> = {}) {
	try {
		const response = await connectorPost(fetchImpl, "/connector/ping", {}, { timeoutMs, signal });
		return {
			reachable: response.ok,
			status: response.status,
			version: response.headers?.get?.("X-Zotero-Version") || null,
		};
	} catch (error: any) {
		return { reachable: false, error: error.name === "TimeoutError" ? "timeout" : "unreachable" };
	}
}
/** The library/collection Zotero desktop currently has selected; the connector saves there unless a target is given. */
export async function connectorSaveTarget({ fetchImpl = fetch, signal }: Record<string, any> = {}) {
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
async function localApiGet(
	fetchImpl: typeof fetch,
	path: string,
	{ signal, timeoutMs = 10000 }: Record<string, any> = {},
) {
	const response = await fetchImpl(`${ZOTERO_ENDPOINTS.localApi}/users/0/${path}`, {
		headers: { Accept: "application/json" },
		signal: timeoutSignal(timeoutMs, signal),
		redirect: "error",
	});
	if (!response.ok) throw new Error(`Zotero local API HTTP ${response.status}`);
	return { data: await readJson(response), total: Number(response.headers.get("Total-Results")) };
}
function summarizeMatches(items: any[], doi: unknown) {
	return exactDoiItems(items, doi)
		.filter((item: any) => KEY.test(item.key || ""))
		.map((item: any) => ({
			key: item.key,
			title: String(item.data?.title || "").slice(0, 200),
			itemType: item.data?.itemType || null,
			collections: Array.isArray(item.data?.collections) ? item.data.collections.slice(0, 20) : [],
		}));
}
export async function localApiSearchByDoi({ fetchImpl = fetch, doi, signal }: Record<string, any> = {}) {
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
export async function localApiChildren({ fetchImpl = fetch, key, signal }: Record<string, any> = {}) {
	if (!KEY.test(key || "")) throw new Error("Valid Zotero key required");
	const result = await localApiGet(fetchImpl, `items/${key}/children?format=json&limit=100`, { signal });
	return Array.isArray(result.data) ? result.data : [];
}

// --- Web API channel ----------------------------------------------------------------------------
export function zoteroWebApiConfig(env: Record<string, string | undefined> = process.env) {
	// Accept both `user`/`group` (pyzotero / zotero-mcp, what Drone injects) and `users`/`groups`.
	const path = zoteroLibraryPath(env.ZOTERO_LIBRARY_TYPE);
	const libraryType: string = path ?? String(env.ZOTERO_LIBRARY_TYPE);
	const libraryId = env.ZOTERO_LIBRARY_ID || env.ZOTERO_USER_ID || "";
	const apiKey = env.ZOTERO_API_KEY || "";
	const configured = path !== null && /^\d+$/.test(libraryId) && apiKey.length > 0;
	return { libraryType, libraryId, apiKey, configured };
}
/**
 * Zotero 10+ local write channel: same v3 routes as the Web API on the desktop's local API (personal
 * library = users/0), authenticated by a local key that Zotero grants through its own dialog plus the
 * Zotero-Server-ID of the database the key belongs to.
 */
export function zoteroLocalWriteConfig(env: Record<string, string | undefined> = process.env) {
	const apiKey = env.ZOTERO_LOCAL_API_KEY || "";
	const serverId = env.ZOTERO_LOCAL_SERVER_ID || "";
	return {
		libraryType: "users",
		libraryId: "0",
		apiKey,
		serverId,
		base: ZOTERO_ENDPOINTS.localApi,
		local: true,
		configured: apiKey.length > 0 && /^[A-Za-z0-9]{1,64}$/.test(serverId),
	};
}
/** The Zotero-Server-ID the running desktop reports (null when unreachable or older than Zotero 10). */
export async function localServerId({ fetchImpl = fetch, signal }: Record<string, any> = {}) {
	try {
		const response = await fetchImpl(`${ZOTERO_ENDPOINTS.localApi}/`, {
			headers: { "Zotero-API-Version": "3" },
			signal: timeoutSignal(3000, signal),
			redirect: "error",
		});
		return response.headers.get("zotero-server-id") || null;
	} catch {
		return null;
	}
}
function authHeaders(config: Record<string, any>): Record<string, string> {
	return config.local
		? { "Zotero-API-Key": config.apiKey, "Zotero-Server-ID": config.serverId }
		: { "Zotero-API-Key": config.apiKey };
}
export async function webRequest(
	fetchImpl: typeof fetch,
	config: Record<string, any>,
	path: string,
	{ method = "GET", body, signal, timeoutMs = 20000, write = false }: Record<string, any> = {},
) {
	const headers: Record<string, string> = {
		"Zotero-API-Version": "3",
		...authHeaders(config),
		Accept: "application/json",
	};
	if (write) {
		headers["Content-Type"] = "application/json";
		headers["Zotero-Write-Token"] = randomUUID().replace(/-/g, "");
	}
	const response = await fetchImpl(`${config.base || ZOTERO_ENDPOINTS.webApi}${path}`, {
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
export async function webKeyAccess({ fetchImpl = fetch, config, signal }: Record<string, any> = {}) {
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
export async function webSearchByDoi({ fetchImpl = fetch, config, doi, signal }: Record<string, any> = {}) {
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
export async function webCreateItems({ fetchImpl = fetch, config, items, signal }: Record<string, any> = {}) {
	const response = await webRequest(fetchImpl, config, `/${config.libraryType}/${config.libraryId}/items`, {
		method: "POST",
		body: items,
		write: true,
		signal,
		timeoutMs: 30000,
	});
	const successful = Object.entries(response.json?.successful || {}).map(([index, entry]: [string, any]) => ({
		index: Number(index),
		key: entry?.key || entry?.data?.key || null,
		version: entry?.version ?? null,
	}));
	const failed = Object.entries(response.json?.failed || {}).map(([index, entry]: [string, any]) => ({
		index: Number(index),
		code: entry?.code ?? null,
		message: String(entry?.message || "").slice(0, 300),
	}));
	return { status: response.status, ok: response.ok, successful, failed };
}
export async function webChildren({ fetchImpl = fetch, config, key, signal }: Record<string, any> = {}) {
	if (!KEY.test(key || "")) throw new Error("Valid Zotero key required");
	const response = await webRequest(
		fetchImpl,
		config,
		`/${config.libraryType}/${config.libraryId}/items/${key}/children?format=json&limit=100`,
		{ signal },
	);
	if (!response.ok)
		throw new Error(
			`Zotero ${config.local ? "local" : "Web"} API children lookup failed (HTTP ${response.status})`,
		);
	return Array.isArray(response.json) ? response.json : [];
}

// --- Plan → consent → execute --------------------------------------------------------------------
function publicWebConfig(config: Record<string, any>) {
	return { configured: config.configured, libraryType: config.libraryType, libraryId: config.libraryId };
}
/**
 * Read-only preparation: pick a channel, confirm the target is writable, and dedup by exact DOI.
 * action: create | reuse | ambiguous | blocked. Only "create" leads to a write, and only after consent.
 */
export async function prepareZoteroSave(
	input: Record<string, any> = {},
	{ fetchImpl = fetch, env = process.env, signal }: Record<string, any> = {},
) {
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
	const plan: Record<string, any> = {
		doi: item.doi,
		idempotencyKey: externalEffectKey("zotero.create", {
			doi: item.doi,
			collectionKey,
		}),
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

function selectLink(key: unknown) {
	return KEY.test(String(key || "")) ? `zotero://select/library/items/${key}` : null;
}
function fulltextFromChildren(children: any[]) {
	const pdfs = children.filter((child) => child?.data?.contentType === "application/pdf");
	return {
		pdfAttachmentKeys: pdfs.map((child) => child.key),
		status: pdfs.length ? "attachment-indexed-not-read" : "metadata-only",
	};
}
async function readBackByDoi(
	plan: Record<string, any>,
	{ fetchImpl, env, signal, attempts, delayMs, sleep }: Record<string, any>,
) {
	const config = zoteroWebApiConfig(env);
	let last: Record<string, any> = { state: "unavailable", count: 0, attempts: 0 };
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
		} catch (error: any) {
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
function baseReceipt(plan: Record<string, any>, at: string): Record<string, any> {
	return {
		doi: plan.doi,
		idempotencyKey: plan.idempotencyKey,
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
export function receiptWithoutWrite(
	plan: Record<string, any>,
	{ now = () => new Date() }: Record<string, any> = {},
) {
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
	plan: Record<string, any>,
	{
		fetchImpl = fetch,
		env = process.env,
		signal,
		now = () => new Date(),
		sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
		readBackAttempts = 4,
		readBackDelayMs = 750,
	}: Record<string, any> = {},
) {
	if (plan.action !== "create") throw new Error(`Refusing to write: plan action is ${plan.action}`);
	const at = now().toISOString();
	const receipt = baseReceipt(plan, at);
	receipt.write = { performed: true, at, httpStatus: null, error: null };
	receipt.writesToLibraries = 1;
	let writtenKey = null;
	try {
		if (plan.channel === "connector") {
			const payload: Record<string, any> = {
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
	} catch (error: any) {
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
export function describeZoteroSavePlan(plan: Record<string, any>) {
	const authors = plan.item.creators.map(
		(c: any) => c.name || [c.firstName, c.lastName].filter(Boolean).join(" "),
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

// --- Updating an existing item (Zotero 10 local write or Web API) -------------------------------
// Zotero 7's local API is read-only (PATCH → 501) and the connector only creates items. Zotero 10 adds
// local write endpoints (Zotero-Server-ID + a dialog-granted local key); otherwise the Web API is used.

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

async function webJson(
	fetchImpl: typeof fetch,
	config: Record<string, any>,
	path: string,
	signal?: AbortSignal,
) {
	const response = await webRequest(fetchImpl, config, path, { signal });
	if (!response.ok)
		throw new Error(
			config.local && response.status === 401
				? "Zotero rejected the local write key (revoked or expired); authorize local writes again in Drone Settings → Zotero"
				: `Zotero ${config.local ? "local" : "Web"} API HTTP ${response.status} for ${path.split("?")[0]}`,
		);
	return response;
}
export async function webGetItem({ fetchImpl = fetch, config, key, signal }: Record<string, any> = {}) {
	if (!KEY.test(key || "")) throw new Error("Valid Zotero key required");
	const response = await webJson(
		fetchImpl,
		config,
		`/${config.libraryType}/${config.libraryId}/items/${key}?format=json`,
		signal,
	);
	const item = response.json || {};
	return {
		key: item.key,
		version: Number(item.version ?? item.data?.version ?? 0),
		title: String(item.data?.title || "").slice(0, 300),
		doi: normalizeDoi(item.data?.DOI || ""),
		itemType: item.data?.itemType || null,
		parentItem: item.data?.parentItem || null,
		collections: Array.isArray(item.data?.collections) ? item.data.collections : [],
	};
}
/** All collections of the library (paged, capped at 1000) as {key, name, parent}. */
export async function webListCollections({ fetchImpl = fetch, config, signal }: Record<string, any> = {}) {
	const collections: { key: string; name: string; parent: string | null }[] = [];
	for (let start = 0; start < 1000; start += 100) {
		const response = await webJson(
			fetchImpl,
			config,
			`/${config.libraryType}/${config.libraryId}/collections?format=json&limit=100&start=${start}`,
			signal,
		);
		const page = Array.isArray(response.json) ? response.json : [];
		for (const entry of page)
			if (KEY.test(entry?.key || ""))
				collections.push({
					key: entry.key,
					name: String(entry.data?.name || "").slice(0, 200),
					parent: entry.data?.parentCollection || null,
				});
		if (page.length < 100 || !(response.total > start + 100)) break;
	}
	return collections;
}
async function webWrite(
	fetchImpl: typeof fetch,
	config: Record<string, any>,
	path: string,
	{ method, headers = {}, body, signal, timeoutMs = 30000 }: Record<string, any>,
) {
	const response = await fetchImpl(`${config.base || ZOTERO_ENDPOINTS.webApi}${path}`, {
		method,
		headers: { "Zotero-API-Version": "3", ...authHeaders(config), ...headers },
		body,
		signal: timeoutSignal(timeoutMs, signal),
		redirect: "error",
	});
	return { status: response.status, ok: response.ok, json: await readJson(response) };
}

/** Local PDF to upload: must live inside the project, be a real PDF and at most 100 MB. */
async function inspectLocalPdf(cwd: string, rawPath: unknown) {
	const path = textField(rawPath, 1000, "local_file");
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
		for await (const chunk of stream) hash.update(chunk as Buffer);
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
		md5: hash.digest("hex"),
	};
}

/**
 * Read-only preparation of an update to ONE existing item: add it to a collection and/or attach a PDF
 * (linked URL or uploaded local file). action: update | unchanged | blocked. Nothing is removed or moved.
 */
export async function prepareZoteroUpdate(
	input: Record<string, any> = {},
	{ fetchImpl = fetch, env = process.env, cwd = process.cwd(), signal }: Record<string, any> = {},
) {
	const web = zoteroWebApiConfig(env);
	const localConfig = zoteroLocalWriteConfig(env);
	const plan: Record<string, any> = {
		kind: "update",
		channel: "web",
		web: publicWebConfig(web),
		action: "blocked",
		reason: null,
		item: null,
		doi: null,
		changes: { addCollection: null, attachUrl: null, uploadFile: null },
		skipped: [],
	};
	// A group library configured for the Web API is an explicit choice; the local channel writes the personal library.
	let config: Record<string, any> = web;
	let staleLocalKey = false;
	if (localConfig.configured && !(web.configured && web.libraryType === "groups")) {
		const serverId = await localServerId({ fetchImpl, signal });
		if (serverId === localConfig.serverId) config = localConfig;
		else staleLocalKey = Boolean(serverId);
	}
	if (config.local) {
		plan.channel = "local";
		plan.target = {
			kind: "local",
			libraryType: "users",
			libraryId: "0",
			libraryName: "My Library",
			local: true,
		};
	} else {
		if (!web.configured) {
			plan.reason = staleLocalKey
				? "The saved Zotero local write key belongs to a different Zotero database; authorize local writes again in Drone Settings → Zotero. No change made."
				: "Changing an existing Zotero item needs write access: on Zotero 10+ ask the user to authorize local writes in Drone Settings → Zotero (Zotero shows a dialog; choose “Always Allow”), or to add a write-enabled API key under Settings → Zotero → Web API (or set ZOTERO_API_KEY and ZOTERO_LIBRARY_ID). No change made.";
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
			libraryName:
				config.libraryType === "groups" ? `group ${config.libraryId}` : access.username || "My Library",
			local: false,
		};
	}
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
			plan.reason = found.items.length
				? "multiple-items-share-doi: pass zotero_key to choose one"
				: "no item with this DOI in the library; create it with research_zotero_save first";
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
		const match = collectionKey
			? collections.filter((entry) => entry.key === collectionKey)
			: collections.filter(
					(entry) => entry.name.trim().toLowerCase() === collectionName?.trim().toLowerCase(),
				);
		if (match.length !== 1) {
			plan.reason = match.length
				? `several collections are named "${collectionName}"; pass collection_key`
				: `collection ${collectionKey || `"${collectionName}"`} not found in this library`;
			plan.collections = collections.slice(0, 50).map(({ key, name }) => ({ key, name }));
			return plan;
		}
		const target = match[0] as { key: string; name: string };
		if (item.collections.includes(target.key)) plan.skipped.push(`already in collection "${target.name}"`);
		else plan.changes.addCollection = { key: target.key, name: target.name };
	}

	const attachmentUrl = textField(input.attachment_url, 2000, "attachment_url") || null;
	const localFile = await inspectLocalPdf(cwd, input.local_file);
	if (attachmentUrl || localFile) {
		const children = await webChildren({ fetchImpl, config, key, signal });
		const existing = children.map((child: any) => child?.data || {});
		if (attachmentUrl) {
			if (!/^https?:\/\//i.test(attachmentUrl)) throw new Error("attachment_url must be http(s)");
			if (existing.some((child: any) => child.url === attachmentUrl))
				plan.skipped.push("link already attached");
			else
				plan.changes.attachUrl = {
					url: attachmentUrl,
					title: textField(input.attachment_title, 200, "attachment_title") || "Full Text (link)",
				};
		}
		if (localFile) {
			if (existing.some((child: any) => child.md5 === localFile.md5))
				plan.skipped.push("same PDF already attached");
			else plan.changes.uploadFile = localFile;
		}
	}
	plan.action = Object.values(plan.changes).some(Boolean) ? "update" : "unchanged";
	if (plan.action === "unchanged") plan.reason = plan.skipped.join("; ") || "nothing to change";
	return plan;
}

async function uploadAttachment(
	fetchImpl: typeof fetch,
	config: Record<string, any>,
	parentKey: string,
	file: Record<string, any>,
	signal?: AbortSignal,
) {
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
				tags: [],
			},
		],
		signal,
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
			mtime: String(file.mtime),
		}).toString(),
		signal,
	});
	if (!auth.ok)
		return {
			key,
			error: `upload authorization HTTP ${auth.status}${auth.json?.text ? `: ${auth.json.text.slice(0, 200)}` : ""}`,
		};
	if (auth.json?.exists === 1) return { key, error: null, deduplicated: true };
	const handle = await open(file.path, "r");
	let bytes: Buffer;
	try {
		bytes = await handle.readFile();
	} finally {
		await handle.close();
	}
	const body = Buffer.concat([
		Buffer.from(auth.json.prefix || "", "utf8"),
		bytes,
		Buffer.from(auth.json.suffix || "", "utf8"),
	]);
	const uploadUrl = String(auth.json.url || "");
	// The Web API hands out an https storage URL; Zotero 10's local API hands out its own loopback receiver.
	const allowed = config.local
		? uploadUrl.startsWith(`${new URL(ZOTERO_ENDPOINTS.localApi).origin}/`)
		: /^https:\/\//.test(uploadUrl);
	if (!allowed) return { key, error: "upload authorization returned an unexpected upload URL" };
	const uploaded = await fetchImpl(uploadUrl, {
		method: "POST",
		headers: {
			"Content-Type": String(auth.json.contentType || "application/octet-stream"),
			// The local receiver rejects an upload without the database id; it does not take the key.
			...(config.local ? { "Zotero-Server-ID": config.serverId } : {}),
		},
		body,
		signal: timeoutSignal(120000, signal),
		redirect: "error",
	});
	if (uploaded.status !== 201 && uploaded.status !== 204)
		return { key, error: `file upload HTTP ${uploaded.status}` };
	const registered = await webWrite(fetchImpl, config, `${lib}/items/${key}/file`, {
		method: "POST",
		headers: form,
		body: new URLSearchParams({ upload: String(auth.json.uploadKey || "") }).toString(),
		signal,
	});
	return { key, error: registered.status === 204 ? null : `upload registration HTTP ${registered.status}` };
}

/** Applies an "update" plan once (no retries), then reads the item and its children back. */
export async function executeZoteroUpdate(
	plan: Record<string, any>,
	{ fetchImpl = fetch, env = process.env, signal, now = () => new Date() }: Record<string, any> = {},
) {
	if (plan.action !== "update") throw new Error(`Refusing to write: plan action is ${plan.action}`);
	const config: Record<string, any> =
		plan.channel === "local" ? zoteroLocalWriteConfig(env) : zoteroWebApiConfig(env);
	const lib = `/${config.libraryType}/${config.libraryId}`;
	const at = now().toISOString();
	const results: Record<string, any> = {};
	if (plan.changes.addCollection) {
		const patched = await webWrite(fetchImpl, config, `${lib}/items/${plan.item.key}`, {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				"If-Unmodified-Since-Version": String(plan.item.version),
			},
			body: JSON.stringify({ collections: [...plan.item.collections, plan.changes.addCollection.key] }),
			signal,
		});
		results.addCollection = {
			...plan.changes.addCollection,
			httpStatus: patched.status,
			error:
				patched.status === 204
					? null
					: patched.status === 412
						? "the item changed in Zotero after it was read; nothing was overwritten, run the update again"
						: `HTTP ${patched.status}`,
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
					tags: [],
				},
			],
			signal,
		});
		results.attachUrl = {
			url: plan.changes.attachUrl.url,
			key: linked.successful[0]?.key || null,
			error: linked.successful[0]?.key ? null : linked.failed[0]?.message || `HTTP ${linked.status}`,
		};
	}
	if (plan.changes.uploadFile) {
		try {
			results.uploadFile = {
				file: plan.changes.uploadFile.relativePath,
				size: plan.changes.uploadFile.size,
				...(await uploadAttachment(fetchImpl, config, plan.item.key, plan.changes.uploadFile, signal)),
			};
		} catch (error: any) {
			results.uploadFile = {
				file: plan.changes.uploadFile.relativePath,
				key: null,
				error: String(error.message || error).slice(0, 300),
			};
		}
	}
	const readBack: Record<string, any> = {};
	try {
		const item = await webGetItem({ fetchImpl, config, key: plan.item.key, signal });
		readBack.collections = item.collections;
		if (results.addCollection)
			results.addCollection.verified = item.collections.includes(results.addCollection.key);
		const children = await webChildren({ fetchImpl, config, key: plan.item.key, signal });
		const childKeys = new Set(children.map((child: any) => child?.key));
		if (results.attachUrl?.key) results.attachUrl.verified = childKeys.has(results.attachUrl.key);
		if (results.uploadFile?.key) {
			const child = children.find((entry: any) => entry?.key === results.uploadFile.key);
			results.uploadFile.verified =
				Boolean(child) &&
				(results.uploadFile.deduplicated || child?.data?.md5 === plan.changes.uploadFile.md5);
		}
	} catch (error: any) {
		readBack.error = String(error.message || error).slice(0, 200);
	}
	const outcomes = Object.values(results);
	const failed = outcomes.filter((entry: any) => entry.error);
	const verified = outcomes.filter((entry: any) => entry.verified);
	return {
		kind: "update",
		channel: plan.channel,
		doi: plan.doi,
		title: plan.item.title,
		zoteroKey: plan.item.key,
		zoteroSelect: selectLink(plan.item.key),
		library: {
			type: config.libraryType,
			id: config.libraryId,
			name: plan.target?.libraryName || null,
			local: Boolean(config.local),
		},
		changes: results,
		skipped: plan.skipped,
		readBack,
		write: { performed: true, at },
		status:
			failed.length === outcomes.length
				? "failed"
				: failed.length
					? "partial"
					: verified.length === outcomes.length
						? "updated"
						: "unverified",
		autoRetry: false,
		attachmentContentsVerified: false,
	};
}

export function receiptWithoutUpdate(plan: Record<string, any>) {
	return {
		kind: "update",
		channel: plan.channel,
		doi: plan.doi,
		title: plan.item?.title || null,
		zoteroKey: plan.item?.key || null,
		zoteroSelect: selectLink(plan.item?.key),
		status: plan.action === "unchanged" ? "unchanged" : plan.action === "cancelled" ? "cancelled" : "blocked",
		reason: plan.reason,
		skipped: plan.skipped,
		...(plan.candidates ? { candidates: plan.candidates } : {}),
		...(plan.collections ? { collections: plan.collections } : {}),
		write: { performed: false },
	};
}

export function describeZoteroUpdatePlan(plan: Record<string, any>) {
	const lines = [
		`要修改的已有条目：\n- 标题：${plan.item.title}\n- DOI：${plan.doi || "（无）"}\n- Zotero 键：${plan.item.key}`,
	];
	const changes: string[] = [];
	if (plan.changes.addCollection)
		changes.push(`加入分类「${plan.changes.addCollection.name}」（保留原有分类）`);
	if (plan.changes.attachUrl) changes.push(`添加链接附件 ${plan.changes.attachUrl.url}`);
	if (plan.changes.uploadFile)
		changes.push(
			`上传本地 PDF ${plan.changes.uploadFile.relativePath}（${(plan.changes.uploadFile.size / 1024 / 1024).toFixed(1)} MB，${plan.channel === "local" ? "存入本机 Zotero，不占云存储配额" : "占用 Zotero 云存储配额"}）`,
		);
	lines.push(`修改内容：\n${changes.map((line) => `- ${line}`).join("\n")}`);
	if (plan.skipped.length) lines.push(`跳过：${plan.skipped.join("；")}`);
	lines.push(
		`通过 Zotero 网页 API 写入 ${plan.target.libraryType}/${plan.target.libraryId}；只添加，不删除、不移出任何分类；写后读回核对，不自动重试。`,
	);
	return lines.join("\n\n");
}
