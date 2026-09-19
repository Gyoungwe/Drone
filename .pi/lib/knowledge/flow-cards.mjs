/**
 * KnowledgeFlow 通用回执卡构造器（挂钩 3）。
 *
 * 卡片只描述宿主观察到的事实（路径 / 状态记号 / 可打开的链接），不代表科学结论已核验。
 * 扩展在工具元数据里声明 `drone.flowCards(event) => card | card[] | null`，或直接在
 * 工具结果 `details.cards[]` 里返回卡片；`noteKnowledgeOperation` 统一合并进 `flow.cards`。
 */
const clip = (value, max) => (typeof value === "string" && value ? value.slice(0, max) : null);

const OK = new Set([
	"verified",
	"saved",
	"reused",
	"both-verified",
	"attachment-indexed-not-read",
	"applied",
	"written",
	"note-written",
	"summary-written",
	"explainer-archived",
	"setup-complete",
	"已保存",
	"archived",
	"found",
	"ready",
]);
const ERROR = new Set([
	"failed",
	"identity-mismatch",
	"missing",
	"blocked",
	"cancelled",
	"not-found",
	"error",
]);
const MUTED = new Set(["unknown", "unavailable", "pending"]);

/** 状态记号 → 色调：只做展示分类，不改变状态本身。 */
export function statusTone(status) {
	const value = String(status || "");
	if (OK.has(value)) return "ok";
	if (ERROR.has(value)) return "error";
	if (MUTED.has(value)) return "muted";
	return "warn";
}

export function cardField(label, value, extra = {}) {
	const text = clip(String(value ?? ""), 200) || "unknown";
	return {
		label: clip(label, 60) || "",
		...(extra.i18n ? { i18n: extra.i18n } : {}),
		value: text,
		...(extra.status === false ? {} : { status: true }),
		...(extra.code !== undefined ? { code: clip(extra.code, 4096) } : {}),
		...(extra.note !== undefined ? { note: clip(extra.note, 200) } : {}),
		tone: extra.tone || (extra.status === false ? "muted" : statusTone(text)),
	};
}

export function cardLink(kind, target, label, i18n) {
	if (!["external", "resource", "note", "path"].includes(kind) || typeof target !== "string" || !target)
		return null;
	return { label: clip(label, 60) || kind, ...(i18n ? { i18n } : {}), kind, target: target.slice(0, 4096) };
}

/** 构造一张通用回执卡；空字段自动省略，链接 / 字段里的 null 自动过滤。 */
export function flowCard({
	key,
	kind,
	title,
	subtitle,
	status,
	tone,
	detail,
	path,
	fields,
	links,
	source,
	provisionalTitle,
}) {
	const state = clip(String(status ?? ""), 32) || "unknown";
	return {
		key: clip(String(key ?? ""), 512) || `${kind}:${title}`,
		kind: clip(kind, 40) || "artifact",
		title: clip(String(title ?? ""), 200) || kind || "artifact",
		provisionalTitle: provisionalTitle === true,
		subtitle: clip(subtitle, 300),
		status: state,
		tone: tone || statusTone(state),
		detail: clip(detail, 400),
		path: clip(path, 4096),
		fields: (fields || []).filter(Boolean).slice(0, 12),
		links: (links || []).filter(Boolean).slice(0, 6),
		source: clip(source, 80),
		at: Date.now(),
	};
}

/** 失败卡：工具报错时由 noteKnowledgeOperation 为声明了 flow 的工具自动生成。 */
export function failureCard(event) {
	const text = (event.result?.content || [])
		.filter((b) => b?.type === "text")
		.map((b) => b.text)
		.join(" ");
	return flowCard({
		key: event.toolCallId,
		kind: "failure",
		title: event.toolName,
		status: "failed",
		detail: text,
		source: event.toolName,
	});
}

const ZOTERO_KEY = /^[A-Z0-9]{8}$/;
const CHANNEL_LABEL = { connector: "连接器", web: "Web API" };

/**
 * 文献回执卡（按 DOI 合并）：Zotero 写入 / 读回与 Vault 笔记身份。
 * 写入类工具（saved/reused）的主状态取写入状态；核对类工具取 Zotero 读回状态。
 */
export function literatureCard(event, { write = false } = {}) {
	const d = event.result?.details || {};
	const receipt = write ? null : d.receipt && typeof d.receipt === "object" ? d.receipt : d;
	const doi = clip(write ? d.doi : receipt?.doi, 300);
	if (!doi) return null;
	const zoteroKey = clip(write ? d.zoteroKey : receipt?.zoteroKey, 8);
	const zoteroStatus = write
		? d.status === "saved" || d.status === "reused"
			? "verified"
			: clip(d.status, 32) || "unavailable"
		: clip(receipt?.zotero?.status, 32) || "unavailable";
	const obsidianStatus = write ? "unknown" : clip(receipt?.obsidian?.status, 32) || "unavailable";
	const notePath = write ? null : clip(receipt?.obsidian?.path, 4096);
	const fulltext = clip(write ? d.fulltextStatus : receipt?.zotero?.fulltextStatus, 64);
	const channel = write ? clip(d.channel, 16) : null;
	const library = write ? clip(d.library?.name, 120) : null;
	const title = clip(write ? d.title : receipt?.zotero?.title, 200);
	// 主状态：写入类取写入结果；核对类取整体回执状态（both-verified / partial…），缺省回退 Zotero 读回状态
	const status = write ? clip(d.status, 32) || "unknown" : clip(receipt?.status, 32) || zoteroStatus;
	return flowCard({
		key: `doi:${doi}`,
		kind: "literature",
		title: title || doi,
		provisionalTitle: !title,
		subtitle: `DOI ${doi}`,
		status,
		detail: null,
		path: notePath,
		fields: [
			cardField("Zotero", zoteroStatus, {
				code: zoteroKey && ZOTERO_KEY.test(zoteroKey) ? zoteroKey : null,
				note:
					[channel ? CHANNEL_LABEL[channel] || channel : null, library].filter(Boolean).join(" · ") || null,
			}),
			cardField("Vault 笔记", obsidianStatus, { i18n: "flow.field.vaultNote", code: notePath }),
			cardField("全文", fulltext || "unknown", { i18n: "flow.field.fulltext" }),
		],
		links: [
			zoteroKey && ZOTERO_KEY.test(zoteroKey)
				? cardLink(
						"resource",
						`zotero://select/library/items/${zoteroKey}`,
						"在 Zotero 中打开",
						"flow.link.openInZotero",
					)
				: null,
			notePath ? cardLink("note", notePath, "打开笔记", "flow.link.openNote") : null,
			cardLink("external", `https://doi.org/${encodeURI(doi)}`, "打开 DOI", "flow.link.openDoi"),
		],
		source: event.toolName,
	});
}
