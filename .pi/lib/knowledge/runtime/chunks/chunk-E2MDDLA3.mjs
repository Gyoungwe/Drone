// @ts-nocheck
import {
  contentHash,
  identifyReference,
  normalizeIdentity
} from "./chunk-4LFII7Y4.mjs";

// packages/knowledge/src/ingest-frontmatter.ts
var NOTE_SCHEMA = "drone-note/1";
var KNOWLEDGE_TYPES = [
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
  "wiki"
];
var RUN_RESULT_TYPES = ["run", "artifact", "explainer"];
var NOTE_TYPES = [...KNOWLEDGE_TYPES, ...RUN_RESULT_TYPES];
var NOTE_STATUSES = ["candidate", "verified", "stale", "superseded", "archived"];
var NOTE_CONFIDENCE = ["high", "medium", "low"];
var LEGACY_STATUS = {
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
  retracted: "superseded"
};
var FRONTMATTER_KEY_ORDER = [
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
  "updated"
];
var PROJECT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var MAX_FRONTMATTER_CHARS = 64 * 1024;
var MAX_DEPTH = 6;
var UNSAFE_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
function isKnowledgeType(value) {
  return KNOWLEDGE_TYPES.includes(String(value));
}
function isNoteType(value) {
  return NOTE_TYPES.includes(String(value));
}
function classForType(type) {
  return isKnowledgeType(type) ? "knowledge" : "run-result";
}
function splitFrontmatter(text) {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const open = source.match(/^---[ \t]*\r?\n/);
  if (!open) return { raw: null, body: source };
  const start = open[0].length;
  const rest = source.slice(start);
  const close = rest.match(/^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m);
  if (!close || close.index === void 0) return { raw: null, body: source };
  return { raw: rest.slice(0, close.index), body: rest.slice(close.index + close[0].length) };
}
function stripComment(text) {
  let quote2 = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote2) {
      if (char === "\\" && quote2 === '"') i++;
      else if (char === quote2) quote2 = null;
    } else if (char === '"' || char === "'") quote2 = char;
    else if (char === "#" && (i === 0 || /\s/.test(text[i - 1] ?? ""))) return text.slice(0, i).trimEnd();
  }
  return text;
}
function splitFlow(inner) {
  const items = [];
  let current = "";
  let quote2 = null;
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i] ?? "";
    if (quote2) {
      current += char;
      if (char === "\\" && quote2 === '"') current += inner[++i] ?? "";
      else if (char === quote2) quote2 = null;
      continue;
    }
    if (char === '"' || char === "'") quote2 = char;
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
function parseScalar(raw) {
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
    const out = {};
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
var KEY_LINE = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"'#\-[{][^:#]*?|-[^\s:#][^:#]*?)\s*:(?:\s+(.*)|\s*)$/;
function isListItem(line) {
  return line.text === "-" || line.text.startsWith("- ");
}
var Parser = class {
  constructor(lines) {
    this.lines = lines;
  }
  index = 0;
  parseDocument() {
    if (!this.lines.length) return {};
    const first = this.lines[0];
    if (first.indent !== 0) throw new Error(`Line ${first.number}: top-level key must not be indented`);
    if (isListItem(first)) throw new Error(`Line ${first.number}: frontmatter must be a mapping`);
    const value = this.parseMap(0, 0);
    if (this.index < this.lines.length) {
      const line = this.lines[this.index];
      throw new Error(`Line ${line.number}: unexpected indentation`);
    }
    return value;
  }
  peek() {
    return this.lines[this.index];
  }
  parseBlock(indent, depth) {
    if (depth > MAX_DEPTH) throw new Error("Frontmatter nesting is too deep");
    const line = this.peek();
    if (!line) return null;
    return isListItem(line) ? this.parseList(line.indent, depth) : this.parseMap(indent, depth);
  }
  valueAfterKey(indent, depth, rest) {
    if (rest !== void 0 && rest.trim() !== "") {
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
  parseBlockScalar(indent, style) {
    const collected = [];
    let blockIndent = null;
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      if (line.indent <= indent) break;
      blockIndent ??= line.indent;
      collected.push(`${" ".repeat(Math.max(0, line.indent - blockIndent))}${line.text}`);
      this.index++;
    }
    const joined = style.startsWith("|") ? collected.join("\n") : collected.join(" ");
    return style.endsWith("-") ? joined : `${joined}
`;
  }
  parseMap(indent, depth) {
    const out = {};
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
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
  parseList(indent, depth) {
    const out = [];
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
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
        this.lines[this.index] = { indent: indent + offset, text: content, number: line.number };
        out.push(this.parseMap(indent + offset, depth + 1));
        continue;
      }
      this.index++;
      out.push(parseScalar(stripComment(content)));
    }
    return out;
  }
};
function toLines(raw) {
  const lines = [];
  const source = raw.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < source.length; i++) {
    const text = source[i] ?? "";
    if (!text.trim() || /^\s*#/.test(text)) continue;
    const leading = text.match(/^[ \t]*/)?.[0] ?? "";
    if (leading.includes("	")) throw new Error(`Line ${i + 2}: tabs are not allowed for indentation`);
    lines.push({ indent: leading.length, text: text.slice(leading.length).trimEnd(), number: i + 2 });
  }
  return lines;
}
function parseFrontmatter(text) {
  const { raw, body } = splitFrontmatter(text);
  if (raw === null) return { data: null, body, errors: [] };
  if (raw.length > MAX_FRONTMATTER_CHARS) return { data: null, body, errors: ["Frontmatter exceeds 64 KiB"] };
  try {
    return { data: new Parser(toLines(raw)).parseDocument(), body, errors: [] };
  } catch (error) {
    return { data: null, body, errors: [error instanceof Error ? error.message : String(error)] };
  }
}
function asString(value, max = 400) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const text = value.normalize("NFKC").trim();
  if (!text || text.length > max || [...text].some((char) => char.charCodeAt(0) < 32)) return null;
  return text;
}
function asList(value) {
  if (value === null || value === void 0) return [];
  return Array.isArray(value) ? value : [value];
}
function normalizeTag(input) {
  const text = asString(input, 120);
  if (!text) return null;
  const tag = text.replace(/^#+/, "").replace(/\s+/g, "-").toLowerCase().replace(/\/{2,}/g, "/").replace(/^\/|\/$/g, "");
  if (!tag || !/^[\p{L}\p{N}_\-/]+$/u.test(tag) || /^\d+$/.test(tag)) return null;
  return tag;
}
var ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
function normalizeWikilink(value) {
  if (Array.isArray(value) && value.length === 1) {
    const inner2 = Array.isArray(value[0]) && value[0].length === 1 ? value[0][0] : value[0];
    return typeof inner2 === "string" ? normalizeWikilink(`[[${inner2}]]`) : null;
  }
  const text = asString(value, 600);
  if (!text) return null;
  const inner = text.match(/^\[\[([^[\]]+)\]\]$/)?.[1] ?? text;
  const target = inner.split("|")[0]?.split("#")[0]?.trim().replace(/\.md$/i, "") ?? "";
  if (!target || target.includes("..") || target.startsWith("/") || /[\\\r\n]/.test(target)) return null;
  return `[[${inner.trim()}]]`;
}
function normalizeSource(input, errors, index) {
  if (typeof input === "string" || typeof input === "number") {
    const text = String(input).trim();
    if (/^(?:Library|Projects|Wiki|Inbox)\/.+\.md$/.test(text)) return { vault: text };
    const found = identifyReference(text);
    if (found) return { [found.field]: found.value };
    errors.push(`sources[${index}]: unrecognized reference`);
    return null;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    errors.push(`sources[${index}]: expected a string or mapping`);
    return null;
  }
  const raw = input;
  const out = { ...normalizeIdentity(raw) };
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
    (key) => key in out
  );
  if (!locators.length) {
    errors.push(`sources[${index}]: needs one of doi/pmid/pmcid/arxiv/isbn/zotero_key/url/vault/file`);
    return null;
  }
  return out;
}
function normalizeCreatedFrom(input, errors) {
  if (input === null || input === void 0) return void 0;
  if (typeof input !== "object" || Array.isArray(input)) {
    errors.push("created_from: expected a mapping");
    return void 0;
  }
  const raw = input;
  const out = {};
  for (const key of ["session", "run", "task", "tool"]) {
    const value = asString(raw[key], 200);
    if (value) out[key] = value;
    else if (raw[key] !== void 0 && raw[key] !== null) errors.push(`created_from.${key}: invalid value`);
  }
  if (raw.turn !== void 0 && raw.turn !== null) {
    const turn = Number(raw.turn);
    if (Number.isSafeInteger(turn) && turn >= 0) out.turn = turn;
    else errors.push("created_from.turn: expected a non-negative integer");
  }
  return Object.keys(out).length ? out : void 0;
}
function validateFrontmatter(input, options = {}) {
  const errors = [];
  const warnings = [];
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { value: null, errors: ["frontmatter must be a mapping"], warnings };
  const raw = input;
  if (raw.schema !== void 0 && raw.schema !== NOTE_SCHEMA)
    warnings.push(`schema: unknown value ${JSON.stringify(raw.schema)}; treated as ${NOTE_SCHEMA}`);
  const type = String(raw.type ?? "").toLowerCase();
  if (!isNoteType(type)) errors.push(`type: expected one of ${NOTE_TYPES.join("|")}`);
  let noteClass = null;
  if (raw.class === void 0 || raw.class === null) {
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
  let status = "candidate";
  if (raw.status !== void 0 && raw.status !== null) {
    const value2 = String(raw.status).toLowerCase();
    if (NOTE_STATUSES.includes(value2)) status = value2;
    else if (LEGACY_STATUS[value2]) {
      status = LEGACY_STATUS[value2];
      warnings.push(`status: legacy value ${value2} mapped to ${status}`);
    } else errors.push(`status: expected one of ${NOTE_STATUSES.join("|")}`);
  } else warnings.push("status: missing; defaulted to candidate");
  let confidence;
  if (raw.confidence !== void 0 && raw.confidence !== null) {
    const value2 = String(raw.confidence).toLowerCase();
    if (NOTE_CONFIDENCE.includes(value2)) confidence = value2;
    else errors.push(`confidence: expected one of ${NOTE_CONFIDENCE.join("|")}`);
  }
  const tags = [];
  for (const item of asList(raw.tags)) {
    const tag = normalizeTag(item);
    if (tag) {
      if (!tags.includes(tag)) tags.push(tag);
    } else warnings.push(`tags: dropped invalid tag ${JSON.stringify(item)}`);
  }
  const aliases = [];
  for (const item of asList(raw.aliases)) {
    const alias = asString(item, 200);
    if (alias && !aliases.includes(alias)) aliases.push(alias);
  }
  const sources = [];
  asList(raw.sources).forEach((item, index) => {
    const source = normalizeSource(item, errors, index);
    if (source) sources.push(source);
  });
  if (raw.identity !== void 0 && raw.identity !== null && (typeof raw.identity !== "object" || Array.isArray(raw.identity)))
    errors.push("identity: expected a mapping");
  const identity = normalizeIdentity(raw.identity);
  if (raw.identity && typeof raw.identity === "object") {
    for (const [key, value2] of Object.entries(raw.identity)) {
      const normalizedKey = key === "zoteroKey" ? "zotero_key" : key;
      if (value2 !== null && value2 !== void 0 && !(normalizedKey in identity))
        errors.push(`identity.${key}: invalid or unsupported identifier`);
    }
  }
  for (const source of sources)
    for (const key of ["doi", "pmid", "pmcid", "arxiv", "isbn", "zotero_key"])
      if (source[key] && !identity[key] && type === "paper") identity[key] = source[key];
  const createdFrom = normalizeCreatedFrom(raw.created_from, errors);
  const derivedFrom = [];
  for (const item of asList(raw.derived_from)) {
    const link = normalizeWikilink(item);
    if (link) derivedFrom.push(link);
    else errors.push(`derived_from: invalid link ${JSON.stringify(item)}`);
  }
  let hash;
  if (raw.content_sha256 !== void 0 && raw.content_sha256 !== null) {
    const value2 = String(raw.content_sha256).toLowerCase();
    if (/^[a-f0-9]{64}$/.test(value2)) hash = value2;
    else errors.push("content_sha256: expected 64 hex characters");
  }
  if (options.body !== void 0) {
    const actual = contentHash(options.body);
    if (hash && hash !== actual) warnings.push("content_sha256: body changed since the hash was recorded");
  }
  const id = raw.id === void 0 || raw.id === null ? void 0 : asString(raw.id, 120);
  if (raw.id !== void 0 && raw.id !== null && (!id || !/^pi-[A-Za-z0-9-]{4,100}$/.test(id)))
    errors.push("id: expected pi-<id>");
  const dates = {};
  for (const key of ["created", "updated"]) {
    if (raw[key] === void 0 || raw[key] === null || raw[key] === "") continue;
    const value2 = asString(raw[key], 64);
    if (value2 && ISO_DATE.test(value2) && !Number.isNaN(Date.parse(value2.replace(" ", "T")))) dates[key] = value2;
    else errors.push(`${key}: expected an ISO 8601 date`);
  }
  if (noteClass === "knowledge" && ["paper", "method", "dataset", "software", "claim", "evidence"].includes(type)) {
    const hasIdentity = Object.keys(identity).length > 0;
    if (!sources.length && !hasIdentity) warnings.push(`sources: a ${type} note should cite at least one source`);
  }
  if (errors.length || !isNoteType(type) || !noteClass || !project) return { value: null, errors, warnings };
  const value = {
    schema: NOTE_SCHEMA,
    ...id ? { id } : {},
    type,
    class: noteClass,
    project,
    status,
    ...confidence ? { confidence } : {},
    tags,
    aliases,
    identity,
    sources,
    ...createdFrom ? { created_from: createdFrom } : {},
    derived_from: derivedFrom,
    ...hash ? { content_sha256: hash } : {},
    ...dates
  };
  return { value, errors, warnings };
}
function buildFrontmatter(input) {
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
    content_sha256: input.body === void 0 ? void 0 : contentHash(input.body),
    created: input.created,
    updated: input.updated
  });
  if (!result.value) throw new Error(`Invalid note frontmatter: ${result.errors.join("; ")}`);
  return result.value;
}
function quote(value) {
  return JSON.stringify(value);
}
function scalar(value) {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === void 0) return "null";
  return quote(String(value));
}
function serializeValue(key, value, indent) {
  if (Array.isArray(value)) {
    if (!value.length) return [`${indent}${key}: []`];
    const lines = [`${indent}${key}:`];
    for (const item of value) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const entries = Object.entries(item).filter(([, v]) => v !== void 0);
        entries.forEach(([k, v], index) => {
          lines.push(`${indent}  ${index === 0 ? "- " : "  "}${k}: ${scalar(v)}`);
        });
      } else lines.push(`${indent}  - ${scalar(item)}`);
    }
    return lines;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== void 0);
    if (!entries.length) return [`${indent}${key}: {}`];
    return [`${indent}${key}:`, ...entries.map(([k, v]) => `${indent}  ${k}: ${scalar(v)}`)];
  }
  return [`${indent}${key}: ${scalar(value)}`];
}
function serializeFrontmatter(frontmatter) {
  const lines = ["---"];
  const record = frontmatter;
  for (const key of FRONTMATTER_KEY_ORDER) {
    const value = record[key];
    if (value === void 0) continue;
    lines.push(...serializeValue(key, value, ""));
  }
  lines.push("---");
  return `${lines.join("\n")}
`;
}
function renderNote(frontmatter, body) {
  return `${serializeFrontmatter(frontmatter)}
${String(body ?? "").replace(/^\n+/, "")}`;
}

export {
  NOTE_SCHEMA,
  KNOWLEDGE_TYPES,
  RUN_RESULT_TYPES,
  NOTE_TYPES,
  NOTE_STATUSES,
  NOTE_CONFIDENCE,
  FRONTMATTER_KEY_ORDER,
  PROJECT_SLUG,
  isKnowledgeType,
  isNoteType,
  classForType,
  splitFrontmatter,
  parseFrontmatter,
  normalizeTag,
  validateFrontmatter,
  buildFrontmatter,
  serializeFrontmatter,
  renderNote
};
