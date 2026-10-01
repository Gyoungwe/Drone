// packages/knowledge/src/flow-cards.ts
var OK = /* @__PURE__ */ new Set([
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
  "\u5DF2\u4FDD\u5B58",
  "archived",
  "found",
  "ready"
]);
var ERROR = /* @__PURE__ */ new Set([
  "failed",
  "identity-mismatch",
  "missing",
  "blocked",
  "cancelled",
  "not-found",
  "error"
]);
var MUTED = /* @__PURE__ */ new Set(["unknown", "unavailable", "pending"]);
var clip = (value, max) => typeof value === "string" && value ? value.slice(0, max) : null;
var record = (value) => value && typeof value === "object" ? value : {};
function statusTone(status) {
  const value = String(status || "");
  if (OK.has(value)) return "ok";
  if (ERROR.has(value)) return "error";
  if (MUTED.has(value)) return "muted";
  return "warn";
}
function cardField(label, value, extra = {}) {
  const text = clip(String(value ?? ""), 200) || "unknown";
  return {
    label: clip(label, 60) || "",
    ...extra.i18n ? { i18n: extra.i18n } : {},
    value: text,
    ...extra.status === false ? {} : { status: true },
    ...extra.code !== void 0 ? { code: clip(extra.code, 4096) } : {},
    ...extra.note !== void 0 ? { note: clip(extra.note, 200) } : {},
    tone: extra.tone || (extra.status === false ? "muted" : statusTone(text))
  };
}
function cardLink(kind, target, label, i18n) {
  if (!["external", "resource", "note", "path"].includes(kind) || typeof target !== "string" || !target)
    return null;
  return {
    label: clip(label, 60) || kind,
    ...i18n ? { i18n } : {},
    kind,
    target: target.slice(0, 4096)
  };
}
function flowCard(input) {
  const { key, kind, title, subtitle, status, tone, detail, path, fields, links, source, provisionalTitle } = input;
  const state = clip(String(status ?? ""), 32) || "unknown";
  const safeKind = clip(kind, 40) || "artifact";
  return {
    key: clip(String(key ?? ""), 512) || `${kind}:${title}`,
    kind: safeKind,
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
    at: Date.now()
  };
}
function failureCard(event) {
  const text = (event.result?.content || []).filter((block) => block?.type === "text").map((block) => block.text).join(" ");
  return flowCard({
    key: event.toolCallId,
    kind: "failure",
    title: event.toolName,
    status: "failed",
    detail: text,
    source: event.toolName
  });
}
var ZOTERO_KEY = /^[A-Z0-9]{8}$/;
var CHANNEL_LABEL = { connector: "\u8FDE\u63A5\u5668", web: "Web API" };
function literatureCard(event, { write = false } = {}) {
  const details = record(event.result?.details);
  const receipt = write ? {} : record(details.receipt);
  const receiptData = write || !details.receipt || typeof details.receipt !== "object" ? details : receipt;
  const doi = clip(write ? details.doi : receiptData.doi, 300);
  if (!doi) return null;
  const zoteroKey = clip(write ? details.zoteroKey : receiptData.zoteroKey, 8);
  const zoteroStatus = write ? details.status === "saved" || details.status === "reused" ? "verified" : clip(details.status, 32) || "unavailable" : clip(record(receiptData.zotero).status, 32) || "unavailable";
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
        note: [channel ? CHANNEL_LABEL[channel] || channel : null, library].filter(Boolean).join(" \xB7 ") || null
      }),
      cardField("Vault \u7B14\u8BB0", obsidianStatus, { i18n: "flow.field.vaultNote", code: notePath }),
      cardField("\u5168\u6587", fulltext || "unknown", { i18n: "flow.field.fulltext" })
    ],
    links: [
      zoteroKey && ZOTERO_KEY.test(zoteroKey) ? cardLink(
        "resource",
        `zotero://select/library/items/${zoteroKey}`,
        "\u5728 Zotero \u4E2D\u6253\u5F00",
        "flow.link.openInZotero"
      ) : null,
      notePath ? cardLink("note", notePath, "\u6253\u5F00\u7B14\u8BB0", "flow.link.openNote") : null,
      cardLink("external", `https://doi.org/${encodeURI(doi)}`, "\u6253\u5F00 DOI", "flow.link.openDoi")
    ],
    source: event.toolName
  });
}

export {
  statusTone,
  cardField,
  cardLink,
  flowCard,
  failureCard,
  literatureCard
};
