import { normalizeDoi } from "./literature-receipt";

export const ZOTERO_ITEM_SPECS = Object.freeze({
	journalArticle: { container: "publicationTitle", doi: true, fields: ["volume", "issue", "pages"] },
	conferencePaper: { container: "proceedingsTitle", doi: true, fields: ["volume", "pages"] },
	preprint: { container: "repository", doi: true, fields: [] },
	dataset: { container: "repository", doi: true, fields: [] },
	book: { container: null, doi: false, fields: ["volume"] },
	bookSection: { container: "bookTitle", doi: false, fields: ["volume", "pages"] },
	thesis: { container: "university", doi: false, fields: [] },
	report: { container: "institution", doi: false, fields: ["pages"] },
	webpage: { container: "websiteTitle", doi: false, fields: [] },
} as const);

export const ZOTERO_ITEM_TYPES = Object.freeze(Object.keys(ZOTERO_ITEM_SPECS));
export const ZOTERO_WRITE_LIMITS = Object.freeze({
	title: 1000,
	field: 500,
	abstract: 5000,
	creators: 200,
	tags: 32,
	tag: 200,
});

export interface ZoteroWriteInput {
	[key: string]: unknown;
}

export interface ZoteroCreator {
	creatorType: string;
	lastName?: string;
	firstName?: string;
	name?: string;
}

export interface NormalizedZoteroItem {
	doi: string;
	itemType: string;
	title: string;
	creators: ZoteroCreator[];
	date: string;
	url: string;
	abstractNote: string;
	fields: Record<string, string>;
	extra: string;
	tags: string[];
	doiField: boolean;
}

export interface NormalizedZoteroAttachment {
	url: string;
	title: string;
}

export interface ConnectorZoteroItem {
	itemType: string;
	title: string;
	creators: Array<{
		creatorType: string;
		lastName?: string;
		firstName?: string;
		fieldMode?: 1;
	}>;
	date: string;
	url: string;
	abstractNote: string;
	tags: Array<{ tag: string }>;
	attachments: Array<{ title: string; url: string; mimeType: "application/pdf" }>;
	[key: string]: unknown;
}

export interface WebApiZoteroItem {
	itemType: string;
	title: string;
	creators: ZoteroCreator[];
	date: string;
	url: string;
	abstractNote: string;
	tags: Array<{ tag: string }>;
	collections: string[];
	[key: string]: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export function textField(value: unknown, max: number, name: string): string {
	if (value === undefined || value === null) return "";
	if (typeof value !== "string" && typeof value !== "number") throw new Error(`${name} must be a string`);
	const text = String(value)
		.replace(/\p{Cc}/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (text.length > max) throw new Error(`${name} exceeds ${max} characters`);
	return text;
}

function normalizeCreators(input: unknown): ZoteroCreator[] {
	if (input === undefined || input === null) return [];
	if (!Array.isArray(input)) throw new Error("creators must be an array");
	if (input.length > ZOTERO_WRITE_LIMITS.creators)
		throw new Error(`creators exceeds ${ZOTERO_WRITE_LIMITS.creators} entries`);
	return input.map((raw, index) => {
		const creator = typeof raw === "string" ? { name: raw } : isRecord(raw) ? raw : null;
		if (!creator) throw new Error(`creators[${index}] must be an object or a string`);
		const creatorType =
			textField(creator.creator_type || creator.creatorType, 40, "creator_type") || "author";
		if (!/^[a-z][A-Za-z]{2,30}$/.test(creatorType))
			throw new Error(`creators[${index}] has an invalid creator_type`);
		const lastName = textField(creator.last_name ?? creator.lastName, ZOTERO_WRITE_LIMITS.field, "last_name");
		const firstName = textField(
			creator.first_name ?? creator.firstName,
			ZOTERO_WRITE_LIMITS.field,
			"first_name",
		);
		const name = textField(creator.name, ZOTERO_WRITE_LIMITS.field, "name");
		if (lastName) return { creatorType, lastName, firstName };
		if (name) return { creatorType, name };
		throw new Error(`creators[${index}] needs last_name or name`);
	});
}

function normalizeTags(input: unknown): string[] {
	if (input === undefined || input === null) return [];
	if (!Array.isArray(input)) throw new Error("tags must be an array of strings");
	const tags = [
		...new Set(
			input.map((tag, index) => textField(tag, ZOTERO_WRITE_LIMITS.tag, `tags[${index}]`)).filter(Boolean),
		),
	];
	if (tags.length > ZOTERO_WRITE_LIMITS.tags)
		throw new Error(`tags exceeds ${ZOTERO_WRITE_LIMITS.tags} entries`);
	return tags;
}

function httpUrl(value: unknown, name: string): string {
	const text = textField(value, 2048, name);
	if (!text) return "";
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		throw new Error(`${name} must be an absolute http(s) URL`);
	}
	if (![`http:`, `https:`].includes(url.protocol)) throw new Error(`${name} must use http or https`);
	return url.href;
}

/** Whitelisted, size-bounded Zotero item metadata. Unknown fields are dropped. */
export function normalizeZoteroItem(input: ZoteroWriteInput = {}): NormalizedZoteroItem {
	const doi = normalizeDoi(input.doi);
	if (!doi) throw new Error("A valid DOI (10.xxxx/...) is required; Zotero writes are keyed by exact DOI.");
	const itemType = textField(input.item_type || input.itemType, 40, "item_type") || "journalArticle";
	const spec = ZOTERO_ITEM_SPECS[itemType as keyof typeof ZOTERO_ITEM_SPECS];
	if (!spec)
		throw new Error(`Unsupported item_type "${itemType}"; use one of ${ZOTERO_ITEM_TYPES.join(", ")}`);
	const title = textField(input.title, ZOTERO_WRITE_LIMITS.title, "title");
	if (!title) throw new Error("title is required");
	const fields: Record<string, string> = {};
	for (const name of spec.fields) {
		const value = textField(input[name], ZOTERO_WRITE_LIMITS.field, name);
		if (value) fields[name] = value;
	}
	const container = textField(
		input.publication ?? input.container_title,
		ZOTERO_WRITE_LIMITS.field,
		"publication",
	);
	if (container && spec.container) fields[spec.container] = container;
	const extra: string[] = [];
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
		doiField: spec.doi,
	};
}

export function normalizeZoteroAttachment(input: ZoteroWriteInput = {}): NormalizedZoteroAttachment | null {
	const url = httpUrl(input.attachment_url ?? input.attachmentUrl, "attachment_url");
	if (!url) return null;
	return {
		url,
		title:
			textField(input.attachment_title, ZOTERO_WRITE_LIMITS.field, "attachment_title") || "Full Text PDF",
	};
}

export function toConnectorItem(
	item: NormalizedZoteroItem,
	attachment: NormalizedZoteroAttachment | null = null,
): ConnectorZoteroItem {
	const payload: ConnectorZoteroItem = {
		itemType: item.itemType,
		title: item.title,
		creators: item.creators.map((creator) =>
			creator.name
				? { creatorType: creator.creatorType, lastName: creator.name, fieldMode: 1 }
				: { ...creator },
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

export function toWebApiItem(
	item: NormalizedZoteroItem,
	{ collectionKey = null }: { collectionKey?: string | null } = {},
) {
	const payload: WebApiZoteroItem = {
		itemType: item.itemType,
		title: item.title,
		creators: item.creators.map((creator) => ({ ...creator })),
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

export function connectorTargetId(value: unknown): string | null {
	const text = textField(value, 32, "target");
	if (!text) return null;
	if (!/^[LC]\d{1,12}$/.test(text))
		throw new Error('target must look like "L1" (library) or "C123" (collection)');
	return text;
}
