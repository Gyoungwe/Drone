// @ts-nocheck
import {
  KNOWLEDGE_TYPES,
  classForType,
  isKnowledgeType,
  isNoteType,
  parseFrontmatter
} from "./chunks/chunk-E2MDDLA3.mjs";
import {
  extractIdentifiers
} from "./chunks/chunk-4LFII7Y4.mjs";

// packages/knowledge/src/ingest-policy.ts
var INGEST_RULES = {
  1: "ephemeral-path",
  2: "explicit-declaration",
  3: "tool-origin",
  4: "run-record-filename",
  5: "card-container",
  6: "data-or-figure",
  7: "cited-markdown-candidate",
  8: "confirmed-inquiry-record",
  9: "location-fallback"
};
var EPHEMERAL_DIRS = /* @__PURE__ */ new Set([
  "tmp",
  "temp",
  ".tmp",
  ".cache",
  "cache",
  "scratch",
  "__pycache__",
  "node_modules",
  ".ipynb_checkpoints",
  ".git",
  ".trash",
  "browser-downloads"
]);
var EPHEMERAL_FILE = /(?:\.(?:tmp|temp|swp|swo|bak|pyc|pyo|part|crdownload|lock)$|~$|^\.ds_store$|^thumbs\.db$|^desktop\.ini$|^\.~lock\.)/i;
var RUN_RECORD_FILES = [
  [/^search[-_]?log.*\.(?:md|txt|json)$/i, "log"],
  [/receipts?.*\.(?:md|json|jsonl)$/i, "log"],
  [/^literature-operations\.json$/i, "log"],
  [/^metadata\.json$/i, "log"],
  [/^manifest.*\.json$/i, "log"],
  [/^failures?.*\.(?:json|md)$/i, "log"],
  [/^provenance.*\.(?:json|md)$/i, "log"],
  [/^summary\.md$/i, "summary"],
  [/^report.*\.html?$/i, "presentation"]
];
var CARD_CONTAINERS = /^(?:evidence-cards|claims?)(?:[-_.].*)?\.md$|-cards\.md$/i;
var DATA_EXTENSIONS = /* @__PURE__ */ new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "tif",
  "tiff",
  "pdf",
  "eps",
  "csv",
  "tsv",
  "txt",
  "json",
  "jsonl",
  "xlsx",
  "xls",
  "parquet",
  "feather",
  "h5",
  "h5ad",
  "hdf5",
  "rds",
  "rdata",
  "npy",
  "npz",
  "pkl",
  "html",
  "nwk",
  "newick",
  "tre",
  "tree",
  "nex",
  "nexus",
  "fasta",
  "fa",
  "fna",
  "faa",
  "fastq",
  "fq",
  "aln",
  "phy",
  "sam",
  "bam",
  "cram",
  "vcf",
  "bcf",
  "bed",
  "gff",
  "gff3",
  "gtf",
  "mtx",
  "loom",
  "gz",
  "zip"
]);
var LIBRARY_FOLDERS = {
  Papers: "paper",
  Methods: "method",
  Software: "software",
  Datasets: "dataset",
  Concepts: "concept",
  Entities: "entity",
  Ideas: "idea",
  Explainers: "explainer"
};
var PROJECT_FOLDERS = {
  Questions: "question",
  Concepts: "concept",
  Entities: "entity",
  Papers: "paper",
  Sources: "paper",
  Evidence: "evidence",
  Claims: "claim",
  Decisions: "decision",
  Wiki: "wiki",
  Runs: "run",
  Artifacts: "artifact"
};
var VAULT_ROOTS = /* @__PURE__ */ new Set(["Library", "Projects", "Wiki", "Inbox"]);
var RUN_RESULT_TOOLS = {
  research_summarize_run: { type: "run", purpose: "summary" },
  research_archive_source: { type: null, purpose: "source" },
  research_loop: { type: null, purpose: "log" },
  research_archive_explainer: { type: "explainer", purpose: "presentation" },
  research_zotero_save: { type: null, purpose: "log" },
  research_zotero_update: { type: null, purpose: "log" }
};
var KNOWLEDGE_TOOLS = {
  research_deposit_knowledge: "from-type",
  research_propose_wiki_update: "wiki",
  /** 宿主动作：用户在「新想法」里点保存（ui-service `saveDiscoveryIdea`）。 */
  daily_discovery: "idea"
};
var METHOD_HEADING = /^#{1,4}\s*(?:methods?|protocols?|procedure|usage|installation|how to|workflow|方法|流程|步骤|用法|安装|使用方法|操作步骤)(?![\p{L}\p{N}])/imu;
var CONCLUSION_HEADING = /^#{1,4}\s*(?:conclusions?|findings?|key findings|results and discussion|summary of evidence|结论|发现|主要发现|要点)(?![\p{L}\p{N}])/imu;
var CANDIDATE_MIN_CHARS = 300;
function segments(path) {
  return path.replaceAll("\\", "/").split("/").filter((part) => part && part !== ".");
}
function decision(rule, value, reasons) {
  return {
    type: null,
    purpose: null,
    candidate: false,
    extractAtoms: false,
    ...value,
    rule,
    ruleId: INGEST_RULES[rule],
    reasons
  };
}
function inferLocation(parts) {
  return VAULT_ROOTS.has(parts[0] ?? "") ? "vault" : "workspace";
}
function looksLikeRunDir(parts) {
  return parts.some((part) => /^(?:results|runs)$/i.test(part) || /^run-/i.test(part));
}
function vaultFolderDecision(parts) {
  const [root, second, third] = parts;
  const file = parts.at(-1) ?? "";
  const navigationDepth = root === "Projects" ? 3 : 2;
  if (parts.length === 1 || parts.length === navigationDepth && /^(?:Index|Context|Home)\.md$/i.test(file))
    return decision(2, { class: "knowledge", purpose: "navigation" }, ["Vault navigation page"]);
  if (root === "Wiki") return decision(2, { class: "knowledge", type: "wiki" }, ["Vault folder Wiki/"]);
  if (root === "Inbox")
    return decision(2, { class: "knowledge", candidate: true }, ["Vault folder Inbox/ holds unreviewed input"]);
  if (root === "Library" && second && LIBRARY_FOLDERS[second]) {
    const type = LIBRARY_FOLDERS[second];
    return decision(
      2,
      { class: classForType(type), type, ...type === "explainer" ? { purpose: "presentation" } : {} },
      [`Vault folder Library/${second}/`]
    );
  }
  if (root === "Projects" && third && PROJECT_FOLDERS[third]) {
    const type = PROJECT_FOLDERS[third];
    return decision(2, { class: classForType(type), type }, [`Vault folder Projects/<project>/${third}/`]);
  }
  return null;
}
function frontmatterOf(input) {
  if (input.frontmatter && typeof input.frontmatter === "object") return input.frontmatter;
  if (typeof input.text !== "string") return null;
  return parseFrontmatter(input.text).data;
}
function bodyOf(text) {
  if (typeof text !== "string") return "";
  return parseFrontmatter(text).body;
}
function citesSources(body) {
  const ids = extractIdentifiers(body);
  if (ids.doi.length || ids.pmid.length || ids.pmcid.length || ids.arxiv.length || ids.url.length) return true;
  return /\[\[(?:Library|Projects|Wiki)\/[^\]]+\]\]/.test(body);
}
function candidateType(body) {
  if (METHOD_HEADING.test(body)) return "method";
  if (CONCLUSION_HEADING.test(body)) return "claim";
  return null;
}
function classifyIngest(input) {
  const parts = segments(String(input.path ?? ""));
  const file = parts.at(-1) ?? "";
  const extension = file.includes(".") ? (file.split(".").at(-1) ?? "").toLowerCase() : "";
  const location = input.location ?? inferLocation(parts);
  const inRunDir = input.inRunDir ?? looksLikeRunDir(parts);
  const ephemeralDir = parts.slice(0, -1).find((part) => EPHEMERAL_DIRS.has(part.toLowerCase()));
  if (ephemeralDir) return decision(1, { class: "ephemeral" }, [`inside ${ephemeralDir}/`]);
  if (file && EPHEMERAL_FILE.test(file)) return decision(1, { class: "ephemeral" }, [`temporary file ${file}`]);
  const frontmatter = frontmatterOf(input);
  if (frontmatter) {
    const declared = frontmatter.class;
    const type = String(frontmatter.type ?? "").toLowerCase();
    if (declared === "ephemeral") return decision(2, { class: "ephemeral" }, ["frontmatter class: ephemeral"]);
    if (declared === "knowledge" || declared === "run-result")
      return decision(
        2,
        { class: declared, type: isNoteType(type) ? type : null, candidate: frontmatter.status === "candidate" },
        [`frontmatter class: ${declared}`]
      );
    if (isNoteType(type))
      return decision(2, { class: classForType(type), type, candidate: frontmatter.status === "candidate" }, [
        `frontmatter type: ${type}`
      ]);
  }
  if (location === "vault" && /\.md$/i.test(file)) {
    const folder = vaultFolderDecision(parts);
    if (folder) return folder;
  }
  const tool = input.origin?.tool;
  if (tool && KNOWLEDGE_TOOLS[tool]) {
    const mapped = KNOWLEDGE_TOOLS[tool];
    const type = mapped === "from-type" ? String(input.origin?.type ?? "").toLowerCase() : mapped;
    if (isKnowledgeType(type)) return decision(3, { class: "knowledge", type }, [`written by ${tool} (${type})`]);
  }
  if (tool && RUN_RESULT_TOOLS[tool]) {
    const mapped = RUN_RESULT_TOOLS[tool];
    return decision(3, { class: "run-result", type: mapped.type, purpose: mapped.purpose }, [`written by ${tool}`]);
  }
  const inHistory = parts.slice(0, -1).some((part) => part.toLowerCase() === "summary-history");
  if (inHistory) return decision(4, { class: "run-result", purpose: "summary" }, ["summary-history/ snapshot"]);
  for (const [pattern, purpose] of RUN_RECORD_FILES)
    if (pattern.test(file)) return decision(4, { class: "run-result", purpose }, [`run record file ${file}`]);
  if (CARD_CONTAINERS.test(file))
    return decision(5, { class: "run-result", purpose: "cards", extractAtoms: true }, [
      `card container ${file}; each card may yield knowledge atoms`
    ]);
  if (extension && DATA_EXTENSIONS.has(extension)) {
    const purpose = input.acceptance ? "deliverable" : "intermediate";
    return decision(6, { class: "run-result", purpose }, [
      `data/figure file .${extension}`,
      input.acceptance ? "matches a milestone acceptance" : "not a milestone deliverable"
    ]);
  }
  if (/\.md$/i.test(file) && typeof input.text === "string") {
    const body = bodyOf(input.text);
    const length = [...body.trim()].length;
    const type = candidateType(body);
    if (length >= CANDIDATE_MIN_CHARS && type && citesSources(body))
      return decision(7, { class: "knowledge", type, candidate: true }, [
        `${length} chars with a ${type === "method" ? "method" : "conclusion"} heading and cited sources`
      ]);
  }
  const inquiry = input.origin?.inquiry;
  if (inquiry) {
    const status = String(inquiry.status || "").toLowerCase();
    if (inquiry.kind === "finding" && status === "reviewed")
      return decision(8, { class: "knowledge", type: "claim" }, ["finding reviewed by the user"]);
    if (inquiry.kind === "decision" && ["confirmed", "active", "accepted"].includes(status))
      return decision(8, { class: "knowledge", type: "decision" }, ["decision confirmed by the user"]);
  }
  if (inRunDir) return decision(9, { class: "run-result", purpose: "intermediate" }, ["inside a run directory"]);
  return decision(9, { class: "ephemeral" }, ["no knowledge or run-result signal"]);
}
var INGEST_KNOWLEDGE_TYPES = KNOWLEDGE_TYPES;
export {
  CANDIDATE_MIN_CHARS,
  INGEST_KNOWLEDGE_TYPES,
  INGEST_RULES,
  classifyIngest
};
