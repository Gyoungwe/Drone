/**
 * 知识入库标准的 frontmatter 规范（schema `drone-note/1`）：解析受限 YAML、校验与规范化、确定性序列化。
 * 只覆盖 Obsidian frontmatter 常见写法（映射、列表、行内列表、引号字符串、注释），不执行任何 YAML 标签或锚点。
 * 纯函数，不读写文件。
 */
import { contentHash, type KnowledgeIdentity, identifyReference, normalizeIdentity } from "./ingest-identity";

export const NOTE_SCHEMA = "drone-note/1";

/** 知识类（K）笔记类型。 */
export const KNOWLEDGE_TYPES = [
	"paper",
	"method",
	"software",
	"dataset",
	"concept",
	"entity",
	"idea",
	"claim",
	"evidence",
	"decision",
	"question",
	"wiki",
] as const;
/** 运行结果类（R）笔记类型：运行中心笔记、产物指针、展示层讲解。 */
export const RUN_RESULT_TYPES = ["run", "artifact", "explainer"] as const;
export const NOTE_TYPES = [...KNOWLEDGE_TYPES, ...RUN_RESULT_TYPES] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];
export type RunResultType = (typeof RUN_RESULT_TYPES)[number];
export type NoteType = (typeof NOTE_TYPES)[number];

/** 分类：知识 / 运行结果 / 临时内容。临时内容不写入 Vault，因此不是合法的 frontmatter `class`。 */
export type IngestClass = "knowledge" | "run-result" | "ephemeral";
export type NoteClass = Exclude<IngestClass, "ephemeral">;
export const NOTE_STATUSES = ["candidate", "verified", "stale", "superseded", "archived"] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];
export const NOTE_CONFIDENCE = ["high", "medium", "low"] as const;
export type NoteConfidence = (typeof NOTE_CONFIDENCE)[number];

/** 旧笔记里出现过的状态值 → 新状态。 */
const LEGACY_STATUS: Readonly<Record<string, NoteStatus>> = {
	draft: "candidate",
	pending: "candidate",
	generated: "candidate",
	proposed: "candidate",
	applied: "verified",
	confirmed: "verified",
	reviewed: "verified",
	succeeded: "verified",
	outdated: "stale",
	deprecated: "superseded",
	retracted: "superseded",
};

export interface NoteSource {
	doi?: string;
	pmid?: string;
	pmcid?: string;
	arxiv?: string;
	isbn?: string;
	zotero_key?: string;
	url?: string;
	/** Vault 相对路径（`Library/Papers/x.md`）。 */
	vault?: string;
	/** 运行目录内的相对路径（`results/...`）。 */
	file?: string;
	sha256?: string;
	/** 页码、章节、行号等定位。 */
	locator?: string;
}

export interface CreatedFrom {
	session?: string;
	run?: string;
	task?: string;
	tool?: string;
	turn?: number;
}

export interface NoteFrontmatter {
	schema: typeof NOTE_SCHEMA;
	id?: string;
	type: NoteType;
	class: NoteClass;
	/** `shared` 或规范项目 slug。 */
	project: string;
	status: NoteStatus;
	confidence?: NoteConfidence;
	tags: string[];
	aliases: string[];
	identity: KnowledgeIdentity;
	sources: NoteSource[];
	created_from?: CreatedFrom;
	derived_from: string[];
	content_sha256?: string;
	created?: string;
	updated?: string;
}

export const FRONTMATTER_KEY_ORDER = [
	"schema",
	"id",
	"type",
	"class",
	"project",
	"status",
	"confidence",
	"tags",
	"aliases",
	"identity",
	"sources",
	"created_from",
	"derived_from",
	"content_sha256",
	"created",
	"updated",
] as const;

export const PROJECT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_FRONTMATTER_CHARS = 64 * 1024;
const MAX_DEPTH = 6;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function isKnowledgeType(value: unknown): value is KnowledgeType {
	return (KNOWLEDGE_TYPES as readonly string[]).includes(String(value));
}
export function isNoteType(value: unknown): value is NoteType {
	return (NOTE_TYPES as readonly string[]).includes(String(value));
}
/** 类型对应的默认分类。 */
export function classForType(type: NoteType): NoteClass {
	return isKnowledgeType(type) ? "knowledge" : "run-result";
}

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

export interface FrontmatterSplit {
	/** 没有 frontmatter 时为 null。 */
	raw: string | null;
	body: string;
}

/** 拆出开头的 frontmatter 块。第一行必须是 `---`，以 `---` 或 `...` 结束。 */
export function splitFrontmatter(text: string): FrontmatterSplit {
	const source = String(text ?? "").replace(/^\uFEFF/, "");
	const open = source.match(/^---[ \t]*\r?\n/);
	if (!open) return { raw: null, body: source };
	const start = open[0].length;
	const rest = source.slice(start);
	const close = rest.match(/^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m);
	if (!close || close.index === undefined) return { raw: null, body: source };
	return { raw: rest.slice(0, close.index), body: rest.slice(close.index + close[0].length) };
}

interface Line {
	indent: number;
	text: string;
	number: number;
}

export interface ParsedFrontmatter {
	data: Record<string, unknown> | null;
	body: string;
	errors: string[];
}

function stripComment(text: string): string {
	let quote: string | null = null;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (quote) {
			if (char === "\\" && quote === '"') i++;
			else if (char === quote) quote = null;
		} else if (char === '"' || char === "'") quote = char;
		else if (char === "#" && (i === 0 || /\s/.test(text[i - 1] ?? ""))) return text.slice(0, i).trimEnd();
	}
	return text;
}

function splitFlow(inner: string): string[] {
	const items: string[] = [];
	let current = "";
	let quote: string | null = null;
	let depth = 0;
	for (let i = 0; i < inner.length; i++) {
		const char = inner[i] ?? "";
		if (quote) {
			current += char;
			if (char === "\\" && quote === '"') current += inner[++i] ?? "";
			else if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'") quote = char;
		else if (char === "[" || char === "{") depth++;
		else if (char === "]" || char === "}") depth--;
		if (char === "," && depth === 0) {
			items.push(current.trim());
			current = "";
		} else current += char;
	}
	if (current.trim()) items.push(current.trim());
	return items;
}

function parseScalar(raw: string): unknown {
	const text = raw.trim();
	if (text === "" || text === "~" || text === "null" || text === "Null" || text === "NULL") return null;
	if (text === "true" || text === "True") return true;
	if (text === "false" || text === "False") return false;
	if (text.startsWith('"')) {
		if (text.endsWith('"') && text.length >= 2) {
			try {
				return JSON.parse(text);
			} catch {
				return text.slice(1, -1).replace(/\\"/g, '"');
			}
		}
		throw new Error("Unterminated double-quoted string");
	}
	if (text.startsWith("'")) {
		if (text.endsWith("'") && text.length >= 2) return text.slice(1, -1).replace(/''/g, "'");
		throw new Error("Unterminated single-quoted string");
	}
	if (text.startsWith("[")) {
		if (!text.endsWith("]")) throw new Error("Unterminated flow sequence");
		const inner = text.slice(1, -1).trim();
		return inner ? splitFlow(inner).map(parseScalar) : [];
	}
	if (text.startsWith("{")) {
		if (!text.endsWith("}")) throw new Error("Unterminated flow mapping");
		const inner = text.slice(1, -1).trim();
		const out: Record<string, unknown> = {};
		if (!inner) return out;
		for (const pair of splitFlow(inner)) {
			const match = pair.match(/^("[^"]*"|'[^']*'|[^:]+?)\s*:\s*(.*)$/);
			if (!match) throw new Error(`Invalid flow mapping entry: ${pair}`);
			const key = String(parseScalar(match[1] ?? ""));
			if (!UNSAFE_KEYS.has(key)) out[key] = parseScalar(match[2] ?? "");
		}
		return out;
	}
	if (/^[&*!|>]/.test(text)) throw new Error(`Unsupported YAML syntax: ${text.slice(0, 20)}`);
	if (/^-?\d+(?:\.\d+)?$/.test(text) && text.length <= 15) return Number(text);
	return text;
}

const KEY_LINE = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"'#\-[{][^:#]*?|-[^\s:#][^:#]*?)\s*:(?:\s+(.*)|\s*)$/;

function isListItem(line: Line): boolean {
	return line.text === "-" || line.text.startsWith("- ");
}

class Parser {
	private index = 0;
	constructor(private readonly lines: Line[]) {}

	parseDocument(): Record<string, unknown> {
		if (!this.lines.length) return {};
		const first = this.lines[0] as Line;
		if (first.indent !== 0) throw new Error(`Line ${first.number}: top-level key must not be indented`);
		if (isListItem(first)) throw new Error(`Line ${first.number}: frontmatter must be a mapping`);
		const value = this.parseMap(0, 0);
		if (this.index < this.lines.length) {
			const line = this.lines[this.index] as Line;
			throw new Error(`Line ${line.number}: unexpected indentation`);
		}
		return value;
	}

	private peek(): Line | undefined {
		return this.lines[this.index];
	}

	private parseBlock(indent: number, depth: number): unknown {
		if (depth > MAX_DEPTH) throw new Error("Frontmatter nesting is too deep");
		const line = this.peek();
		if (!line) return null;
		return isListItem(line) ? this.parseList(line.indent, depth) : this.parseMap(indent, depth);
	}

	private valueAfterKey(indent: number, depth: number, rest: string | undefined): unknown {
		if (rest !== undefined && rest.trim() !== "") {
			const value = stripComment(rest);
			if (/^[|>][+-]?$/.test(value.trim())) return this.parseBlockScalar(indent, value.trim());
			return parseScalar(value);
		}
		const next = this.peek();
		if (!next) return null;
		if (next.indent > indent) return this.parseBlock(next.indent, depth + 1);
		if (next.indent === indent && isListItem(next)) return this.parseList(indent, depth + 1);
		return null;
	}

	private parseBlockScalar(indent: number, style: string): string {
		const collected: string[] = [];
		let blockIndent: number | null = null;
		while (this.index < this.lines.length) {
			const line = this.lines[this.index] as Line;
			if (line.indent <= indent) break;
			blockIndent ??= line.indent;
			collected.push(`${" ".repeat(Math.max(0, line.indent - blockIndent))}${line.text}`);
			this.index++;
		}
		const joined = style.startsWith("|") ? collected.join("\n") : collected.join(" ");
		return style.endsWith("-") ? joined : `${joined}\n`;
	}

	private parseMap(indent: number, depth: number): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		while (this.index < this.lines.length) {
			const line = this.lines[this.index] as Line;
			if (line.indent < indent) break;
			if (line.indent > indent) throw new Error(`Line ${line.number}: unexpected indentation`);
			if (isListItem(line)) break;
			const match = line.text.match(KEY_LINE);
			if (!match) throw new Error(`Line ${line.number}: expected "key: value"`);
			const key = String(parseScalar(match[1] ?? "")).trim();
			this.index++;
			const value = this.valueAfterKey(indent, depth, match[2]);
			if (UNSAFE_KEYS.has(key)) continue;
			if (Object.hasOwn(out, key)) throw new Error(`Line ${line.number}: duplicate key "${key}"`);
			out[key] = value;
		}
		return out;
	}

	private parseList(indent: number, depth: number): unknown[] {
		const out: unknown[] = [];
		while (this.index < this.lines.length) {
			const line = this.lines[this.index] as Line;
			if (line.indent !== indent || !isListItem(line)) {
				if (line.indent > indent) throw new Error(`Line ${line.number}: unexpected indentation`);
				break;
			}
			const rest = line.text === "-" ? "" : line.text.slice(2);
			const offset = line.text === "-" ? 1 : 2 + (rest.length - rest.trimStart().length);
			const content = rest.trim();
			if (!content) {
				this.index++;
				const next = this.peek();
				out.push(next && next.indent > indent ? this.parseBlock(next.indent, depth + 1) : null);
				continue;
			}
			if (KEY_LINE.test(stripComment(content)) && !/^["'[{]/.test(content)) {
				// "- key: value" starts a mapping whose keys align with "key".
				this.lines[this.index] = { indent: indent + offset, text: content, number: line.number };
				out.push(this.parseMap(indent + offset, depth + 1));
				continue;
			}
			this.index++;
			out.push(parseScalar(stripComment(content)));
		}
		return out;
	}
}

function toLines(raw: string): Line[] {
	const lines: Line[] = [];
	const source = raw.replace(/\r\n?/g, "\n").split("\n");
	for (let i = 0; i < source.length; i++) {
		const text = source[i] ?? "";
		if (!text.trim() || /^\s*#/.test(text)) continue;
		const leading = text.match(/^[ \t]*/)?.[0] ?? "";
		if (leading.includes("\t")) throw new Error(`Line ${i + 2}: tabs are not allowed for indentation`);
		lines.push({ indent: leading.length, text: text.slice(leading.length).trimEnd(), number: i + 2 });
	}
	return lines;
}

/** 解析一篇笔记的 frontmatter。语法错误不抛异常，而是放进 `errors`，`data` 为 null。 */
export function parseFrontmatter(text: string): ParsedFrontmatter {
	const { raw, body } = splitFrontmatter(text);
	if (raw === null) return { data: null, body, errors: [] };
	if (raw.length > MAX_FRONTMATTER_CHARS) return { data: null, body, errors: ["Frontmatter exceeds 64 KiB"] };
	try {
		return { data: new Parser(toLines(raw)).parseDocument(), body, errors: [] };
	} catch (error) {
		return { data: null, body, errors: [error instanceof Error ? error.message : String(error)] };
	}
}

// ---------------------------------------------------------------------------
// 校验与规范化
// ---------------------------------------------------------------------------

export interface FrontmatterValidation {
	/** 有错误时为 null。 */
	value: NoteFrontmatter | null;
	errors: string[];
	warnings: string[];
}

function asString(value: unknown, max = 400): string | null {
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	if (typeof value !== "string") return null;
	const text = value.normalize("NFKC").trim();
	if (!text || text.length > max || [...text].some((char) => char.charCodeAt(0) < 32)) return null;
	return text;
}

function asList(value: unknown): unknown[] {
	if (value === null || value === undefined) return [];
	return Array.isArray(value) ? value : [value];
}

/** Obsidian 标签：去掉 `#`，空白换成 `-`，只允许字母数字、`_`、`-`、`/`，不能是纯数字；统一小写。 */
export function normalizeTag(input: unknown): string | null {
	const text = asString(input, 120);
	if (!text) return null;
	const tag = text
		.replace(/^#+/, "")
		.replace(/\s+/g, "-")
		.toLowerCase()
		.replace(/\/{2,}/g, "/")
		.replace(/^\/|\/$/g, "");
	if (!tag || !/^[\p{L}\p{N}_\-/]+$/u.test(tag) || /^\d+$/.test(tag)) return null;
	return tag;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function normalizeWikilink(value: unknown): string | null {
	// 未加引号的 `[[note]]` 在 YAML 里是嵌套列表 `[["note"]]`，按 wikilink 处理。
	if (Array.isArray(value) && value.length === 1) {
		const inner = Array.isArray(value[0]) && value[0].length === 1 ? value[0][0] : value[0];
		return typeof inner === "string" ? normalizeWikilink(`[[${inner}]]`) : null;
	}
	const text = asString(value, 600);
	if (!text) return null;
	const inner = text.match(/^\[\[([^[\]]+)\]\]$/)?.[1] ?? text;
	const target = inner.split("|")[0]?.split("#")[0]?.trim().replace(/\.md$/i, "") ?? "";
	if (!target || target.includes("..") || target.startsWith("/") || /[\\\r\n]/.test(target)) return null;
	return `[[${inner.trim()}]]`;
}

function normalizeSource(input: unknown, errors: string[], index: number): NoteSource | null {
	if (typeof input === "string" || typeof input === "number") {
		const text = String(input).trim();
		if (/^(?:Library|Projects|Wiki|Inbox)\/.+\.md$/.test(text)) return { vault: text };
		const found = identifyReference(text);
		if (found) return { [found.field]: found.value } as NoteSource;
		errors.push(`sources[${index}]: unrecognized reference`);
		return null;
	}
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		errors.push(`sources[${index}]: expected a string or mapping`);
		return null;
	}
	const raw = input as Record<string, unknown>;
	const out: NoteSource = { ...normalizeIdentity(raw) };
	const vault = asString(raw.vault, 600);
	if (vault) {
		if (vault.includes("..") || vault.startsWith("/") || vault.includes("\\") || !vault.endsWith(".md"))
			errors.push(`sources[${index}].vault: expected a Vault-relative .md path`);
		else out.vault = vault;
	}
	const file = asString(raw.file, 600);
	if (file) {
		if (file.split(/[\\/]/).includes("..") || /^(?:[a-z]:|\/)/i.test(file))
			errors.push(`sources[${index}].file: expected a workspace-relative path`);
		else out.file = file.replaceAll("\\", "/");
	}
	const sha = asString(raw.sha256, 80);
	if (sha) {
		if (/^[a-f0-9]{64}$/i.test(sha)) out.sha256 = sha.toLowerCase();
		else errors.push(`sources[${index}].sha256: expected 64 hex characters`);
	}
	const locator = asString(raw.locator, 200);
	if (locator) out.locator = locator;
	const locators = ["doi", "pmid", "pmcid", "arxiv", "isbn", "zotero_key", "url", "vault", "file"].filter(
		(key) => key in out,
	);
	if (!locators.length) {
		errors.push(`sources[${index}]: needs one of doi/pmid/pmcid/arxiv/isbn/zotero_key/url/vault/file`);
		return null;
	}
	return out;
}

function normalizeCreatedFrom(input: unknown, errors: string[]): CreatedFrom | undefined {
	if (input === null || input === undefined) return undefined;
	if (typeof input !== "object" || Array.isArray(input)) {
		errors.push("created_from: expected a mapping");
		return undefined;
	}
	const raw = input as Record<string, unknown>;
	const out: CreatedFrom = {};
	for (const key of ["session", "run", "task", "tool"] as const) {
		const value = asString(raw[key], 200);
		if (value) out[key] = value;
		else if (raw[key] !== undefined && raw[key] !== null) errors.push(`created_from.${key}: invalid value`);
	}
	if (raw.turn !== undefined && raw.turn !== null) {
		const turn = Number(raw.turn);
		if (Number.isSafeInteger(turn) && turn >= 0) out.turn = turn;
		else errors.push("created_from.turn: expected a non-negative integer");
	}
	return Object.keys(out).length ? out : undefined;
}

/**
 * 校验并规范化 frontmatter（通常是 {@link parseFrontmatter} 的 `data`）。
 * - 缺少 `class` 时按 `type` 推导；`class` 与 `type` 矛盾报错。
 * - 旧状态值（draft/generated…）映射到新状态并给出 warning。
 * - `identity` 与 `sources` 中的标识全部规范化；`identity` 缺失时从 `sources` 推导。
 */
export function validateFrontmatter(input: unknown, options: { body?: string } = {}): FrontmatterValidation {
	const errors: string[] = [];
	const warnings: string[] = [];
	if (!input || typeof input !== "object" || Array.isArray(input))
		return { value: null, errors: ["frontmatter must be a mapping"], warnings };
	const raw = input as Record<string, unknown>;

	if (raw.schema !== undefined && raw.schema !== NOTE_SCHEMA)
		warnings.push(`schema: unknown value ${JSON.stringify(raw.schema)}; treated as ${NOTE_SCHEMA}`);

	const type = String(raw.type ?? "").toLowerCase();
	if (!isNoteType(type)) errors.push(`type: expected one of ${NOTE_TYPES.join("|")}`);

	let noteClass: NoteClass | null = null;
	if (raw.class === undefined || raw.class === null) {
		if (isNoteType(type)) noteClass = classForType(type);
	} else if (raw.class === "knowledge" || raw.class === "run-result") {
		noteClass = raw.class;
		if (isNoteType(type) && classForType(type) !== noteClass)
			errors.push(`class: ${noteClass} conflicts with type ${type}`);
	} else errors.push("class: expected knowledge|run-result (ephemeral content is never stored)");

	const project = asString(raw.project, 96)?.toLowerCase() ?? null;
	if (!project) errors.push("project: required (shared or a kebab-case project slug)");
	else if (project !== "shared" && !PROJECT_SLUG.test(project))
		errors.push("project: expected shared or a kebab-case project slug");

	let status: NoteStatus = "candidate";
	if (raw.status !== undefined && raw.status !== null) {
		const value = String(raw.status).toLowerCase();
		if ((NOTE_STATUSES as readonly string[]).includes(value)) status = value as NoteStatus;
		else if (LEGACY_STATUS[value]) {
			status = LEGACY_STATUS[value] as NoteStatus;
			warnings.push(`status: legacy value ${value} mapped to ${status}`);
		} else errors.push(`status: expected one of ${NOTE_STATUSES.join("|")}`);
	} else warnings.push("status: missing; defaulted to candidate");

	let confidence: NoteConfidence | undefined;
	if (raw.confidence !== undefined && raw.confidence !== null) {
		const value = String(raw.confidence).toLowerCase();
		if ((NOTE_CONFIDENCE as readonly string[]).includes(value)) confidence = value as NoteConfidence;
		else errors.push(`confidence: expected one of ${NOTE_CONFIDENCE.join("|")}`);
	}

	const tags: string[] = [];
	for (const item of asList(raw.tags)) {
		const tag = normalizeTag(item);
		if (tag) {
			if (!tags.includes(tag)) tags.push(tag);
		} else warnings.push(`tags: dropped invalid tag ${JSON.stringify(item)}`);
	}
	const aliases: string[] = [];
	for (const item of asList(raw.aliases)) {
		const alias = asString(item, 200);
		if (alias && !aliases.includes(alias)) aliases.push(alias);
	}

	const sources: NoteSource[] = [];
	asList(raw.sources).forEach((item, index) => {
		const source = normalizeSource(item, errors, index);
		if (source) sources.push(source);
	});

	if (raw.identity !== undefined && raw.identity !== null && (typeof raw.identity !== "object" || Array.isArray(raw.identity)))
		errors.push("identity: expected a mapping");
	const identity = normalizeIdentity(raw.identity);
	if (raw.identity && typeof raw.identity === "object") {
		for (const [key, value] of Object.entries(raw.identity as Record<string, unknown>)) {
			const normalizedKey = key === "zoteroKey" ? "zotero_key" : key;
			if (value !== null && value !== undefined && !(normalizedKey in identity))
				errors.push(`identity.${key}: invalid or unsupported identifier`);
		}
	}
	for (const source of sources)
		for (const key of ["doi", "pmid", "pmcid", "arxiv", "isbn", "zotero_key"] as const)
			if (source[key] && !identity[key] && type === "paper") identity[key] = source[key];

	const createdFrom = normalizeCreatedFrom(raw.created_from, errors);

	const derivedFrom: string[] = [];
	for (const item of asList(raw.derived_from)) {
		const link = normalizeWikilink(item);
		if (link) derivedFrom.push(link);
		else errors.push(`derived_from: invalid link ${JSON.stringify(item)}`);
	}

	let hash: string | undefined;
	if (raw.content_sha256 !== undefined && raw.content_sha256 !== null) {
		const value = String(raw.content_sha256).toLowerCase();
		if (/^[a-f0-9]{64}$/.test(value)) hash = value;
		else errors.push("content_sha256: expected 64 hex characters");
	}
	if (options.body !== undefined) {
		const actual = contentHash(options.body);
		if (hash && hash !== actual) warnings.push("content_sha256: body changed since the hash was recorded");
	}

	const id = raw.id === undefined || raw.id === null ? undefined : asString(raw.id, 120);
	if (raw.id !== undefined && raw.id !== null && (!id || !/^pi-[A-Za-z0-9-]{4,100}$/.test(id)))
		errors.push("id: expected pi-<id>");

	const dates: Partial<Record<"created" | "updated", string>> = {};
	for (const key of ["created", "updated"] as const) {
		if (raw[key] === undefined || raw[key] === null || raw[key] === "") continue;
		const value = asString(raw[key], 64);
		if (value && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value.replace(" ", "T")))) dates[key] = value;
		else errors.push(`${key}: expected an ISO 8601 date`);
	}

	if (noteClass === "knowledge" && ["paper", "method", "dataset", "software", "claim", "evidence"].includes(type)) {
		const hasIdentity = Object.keys(identity).length > 0;
		if (!sources.length && !hasIdentity) warnings.push(`sources: a ${type} note should cite at least one source`);
	}

	if (errors.length || !isNoteType(type) || !noteClass || !project) return { value: null, errors, warnings };
	const value: NoteFrontmatter = {
		schema: NOTE_SCHEMA,
		...(id ? { id } : {}),
		type,
		class: noteClass,
		project,
		status,
		...(confidence ? { confidence } : {}),
		tags,
		aliases,
		identity,
		sources,
		...(createdFrom ? { created_from: createdFrom } : {}),
		derived_from: derivedFrom,
		...(hash ? { content_sha256: hash } : {}),
		...dates,
	};
	return { value, errors, warnings };
}

// ---------------------------------------------------------------------------
// 构建与序列化
// ---------------------------------------------------------------------------

export interface BuildFrontmatterInput {
	type: NoteType;
	project: string;
	id?: string;
	status?: NoteStatus;
	confidence?: NoteConfidence;
	tags?: readonly string[];
	aliases?: readonly string[];
	identity?: KnowledgeIdentity;
	sources?: readonly unknown[];
	createdFrom?: CreatedFrom;
	derivedFrom?: readonly string[];
	/** 提供正文时自动计算 `content_sha256`。 */
	body?: string;
	created?: string;
	updated?: string;
}

/** 由宿主写入方使用：构建一个已规范化的 frontmatter；不合法时抛出包含所有错误的异常。 */
export function buildFrontmatter(input: BuildFrontmatterInput): NoteFrontmatter {
	const result = validateFrontmatter({
		schema: NOTE_SCHEMA,
		id: input.id,
		type: input.type,
		project: input.project,
		status: input.status ?? "candidate",
		confidence: input.confidence,
		tags: input.tags ? [...input.tags] : [],
		aliases: input.aliases ? [...input.aliases] : [],
		identity: input.identity ?? {},
		sources: input.sources ? [...input.sources] : [],
		created_from: input.createdFrom,
		derived_from: input.derivedFrom ? [...input.derivedFrom] : [],
		content_sha256: input.body === undefined ? undefined : contentHash(input.body),
		created: input.created,
		updated: input.updated,
	});
	if (!result.value) throw new Error(`Invalid note frontmatter: ${result.errors.join("; ")}`);
	return result.value;
}

function quote(value: string): string {
	return JSON.stringify(value);
}

function scalar(value: unknown): string {
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (value === null || value === undefined) return "null";
	return quote(String(value));
}

function serializeValue(key: string, value: unknown, indent: string): string[] {
	if (Array.isArray(value)) {
		if (!value.length) return [`${indent}${key}: []`];
		const lines = [`${indent}${key}:`];
		for (const item of value) {
			if (item && typeof item === "object" && !Array.isArray(item)) {
				const entries = Object.entries(item).filter(([, v]) => v !== undefined);
				entries.forEach(([k, v], index) => {
					lines.push(`${indent}  ${index === 0 ? "- " : "  "}${k}: ${scalar(v)}`);
				});
			} else lines.push(`${indent}  - ${scalar(item)}`);
		}
		return lines;
	}
	if (value && typeof value === "object") {
		const entries = Object.entries(value).filter(([, v]) => v !== undefined);
		if (!entries.length) return [`${indent}${key}: {}`];
		return [`${indent}${key}:`, ...entries.map(([k, v]) => `${indent}  ${k}: ${scalar(v)}`)];
	}
	return [`${indent}${key}: ${scalar(value)}`];
}

/** 确定性序列化（固定键顺序、字符串一律 JSON 双引号），返回带 `---` 分隔线的块，末尾有换行。 */
export function serializeFrontmatter(frontmatter: NoteFrontmatter): string {
	const lines = ["---"];
	const record = frontmatter as unknown as Record<string, unknown>;
	for (const key of FRONTMATTER_KEY_ORDER) {
		const value = record[key];
		if (value === undefined) continue;
		lines.push(...serializeValue(key, value, ""));
	}
	lines.push("---");
	return `${lines.join("\n")}\n`;
}

/** frontmatter + 正文，组成一篇笔记的完整文本。 */
export function renderNote(frontmatter: NoteFrontmatter, body: string): string {
	return `${serializeFrontmatter(frontmatter)}\n${String(body ?? "").replace(/^\n+/, "")}`;
}
