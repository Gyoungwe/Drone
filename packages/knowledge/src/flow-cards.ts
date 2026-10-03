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

const clip = (value: unknown, max: number): string | null =>
	typeof value === "string" && value ? value.slice(0, max) : null;

export type FlowTone = "ok" | "error" | "muted" | "warn" | string;

export interface FlowCardField {
	label: string;
	i18n?: unknown;
	value: string;
	status?: boolean;
	code?: string | null;
	note?: string | null;
	tone: FlowTone;
}

export interface FlowCardLink {
	kind: "external" | "resource" | "note" | "path";
	target: string;
	label: string;
	i18n?: unknown;
}

export interface FlowCard {
	key: string;
	kind: string;
	title: string;
	provisionalTitle: boolean;
	subtitle: string | null;
	status: string;
	tone: FlowTone;
	detail: string | null;
	path: string | null;
	fields: FlowCardField[];
	links: FlowCardLink[];
	source: string | null;
	at: number;
}

export interface CardFieldOptions {
	i18n?: unknown;
	status?: boolean;
	code?: unknown;
	note?: unknown;
	tone?: FlowTone;
}

export interface FlowCardInput {
	key?: unknown;
	kind?: unknown;
	title?: unknown;
	subtitle?: unknown;
	status?: unknown;
	tone?: FlowTone;
	detail?: unknown;
	path?: unknown;
	fields?: readonly (FlowCardField | null | undefined)[];
	links?: readonly (FlowCardLink | null | undefined)[];
	source?: unknown;
	provisionalTitle?: unknown;
}

export interface FlowEventContent {
	type?: unknown;
	text?: unknown;
}

export interface FlowEvent {
	toolCallId?: unknown;
	toolName?: unknown;
	result?: {
		content?: readonly FlowEventContent[];
		details?: unknown;
	};
}

type RecordData = Record<string, unknown>;

const record = (value: unknown): RecordData =>
	value && typeof value === "object" ? (value as RecordData) : {};

/** Status marker to tone mapping; display classification never changes the marker. */
export function statusTone(status: unknown): FlowTone {
	const value = String(status || "");
	if (OK.has(value)) return "ok";
	if (ERROR.has(value)) return "error";
	if (MUTED.has(value)) return "muted";
	return "warn";
}

export function cardField(label: unknown, value: unknown, extra: CardFieldOptions = {}): FlowCardField {
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

export function cardLink(
	kind: FlowCardLink["kind"] | string,
	target: unknown,
	label: unknown,
	i18n?: unknown,
): FlowCardLink | null {
	if (
		!(["external", "resource", "note", "path"] as string[]).includes(kind) ||
		typeof target !== "string" ||
		!target
	)
		return null;
	return {
		label: clip(label, 60) || kind,
		...(i18n ? { i18n } : {}),
		kind: kind as FlowCardLink["kind"],
		target: target.slice(0, 4096),
	};
}

/** Construct one generic receipt card; empty fields and null links are omitted. */
export function flowCard(input: FlowCardInput): FlowCard {
	const { key, kind, title, subtitle, status, tone, detail, path, fields, links, source, provisionalTitle } =
		input;
	const state = clip(String(status ?? ""), 32) || "unknown";
	const safeKind = clip(kind, 40) || "artifact";
	return {
		key: clip(String(key ?? ""), 512) || `${kind}:${title}`,
		kind: safeKind,
		title: clip(String(title ?? ""), 200) || (kind as string) || "artifact",
		provisionalTitle: provisionalTitle === true,
		subtitle: clip(subtitle, 300),
		status: state,
		tone: tone || statusTone(state),
		detail: clip(detail, 400),
		path: clip(path, 4096),
		fields: (fields || []).filter(Boolean).slice(0, 12) as FlowCardField[],
		links: (links || []).filter(Boolean).slice(0, 6) as FlowCardLink[],
		source: clip(source, 80),
		at: Date.now(),
	};
}

/** Failure card generated when a flow-enabled tool reports an error. */
export function failureCard(event: FlowEvent): FlowCard {
	const text = (event.result?.content || [])
		.filter((block) => block?.type === "text")
		.map((block) => block.text)
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
const CHANNEL_LABEL: Record<string, string> = { connector: "连接器", web: "Web API" };

/** Literature receipt card merged by DOI across Zotero and Vault observations. */
export function literatureCard(
	event: FlowEvent,
	{ write = false }: { write?: boolean } = {},
): FlowCard | null {
	const details = record(event.result?.details);
	const receipt = write ? {} : record(details.receipt);
	const receiptData = write || !details.receipt || typeof details.receipt !== "object" ? details : receipt;
	const doi = clip(write ? details.doi : receiptData.doi, 300);
	if (!doi) return null;
	const zoteroKey = clip(write ? details.zoteroKey : receiptData.zoteroKey, 8);
	const zoteroStatus = write
		? details.status === "saved" || details.status === "reused"
			? "verified"
			: clip(details.status, 32) || "unavailable"
		: clip(record(receiptData.zotero).status, 32) || "unavailable";
	const obsidianStatus = write ? "unknown" : clip(record(receiptData.obsidian).status, 32) || "unavailable";
	const notePath = write ? null : clip(record(receiptData.obsidian).path, 4096);
	const fulltext = clip(write ? details.fulltextStatus : record(receiptData.zotero).fulltextStatus, 64);
	const channel = write ? clip(details.channel, 16) : null;
	const library = write ? clip(record(details.library).name, 120) : null;
	const title = clip(write ? details.title : record(receiptData.zotero).title, 200);
	const status = write ? clip(details.status, 32) || "unknown" : clip(receiptData.status, 32) || zoteroStatus;
	return flowCard({
		key: `doi:${doi}`,
		kind: "literature",
		title: title || doi,
		provisionalTitle: !title,
		subtitle: `DOI ${doi}`,
		status,
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
