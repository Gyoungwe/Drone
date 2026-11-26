// @ts-nocheck
// packages/extensions/src/institutional-access.ts
import { createRequire } from "node:module";

// node_modules/@gyoungwe/pi-research/dist/host.mjs
import { mkdir as Zi, readFile as Wo, writeFile as qi } from "node:fs/promises";
import { homedir as Fi } from "node:os";
import { dirname as Mi, join as Vo } from "node:path";
import { createHash as Yi, randomUUID as Xi } from "node:crypto";
import { createHash as Ui } from "node:crypto";
import { readFile as Hi, realpath as Go, stat as Bi } from "node:fs/promises";
import { isAbsolute as Wi, relative as Vi, resolve as Ji, sep as Ki } from "node:path";
import { realpath as oc } from "node:fs/promises";
import { resolve as ra } from "node:path";
import { createHash as uc, randomUUID as dc } from "node:crypto";
import { lstat as pc, readFile as da, rename as fc, rm as mc, writeFile as hc } from "node:fs/promises";
import { basename as sc, isAbsolute as ic, relative as ca, resolve as Qt, sep as Rn } from "node:path";
import { createHash as gc } from "node:crypto";
import { randomUUID as Zn } from "node:crypto";
import { mkdir as Wa, readFile as Ga, realpath as ur } from "node:fs/promises";
import { join as ze, relative as Va, resolve as qn } from "node:path";
import { createHash as wc, randomUUID as bc } from "node:crypto";
import { randomUUID as xc } from "node:crypto";
import { readFile as $a, realpath as St } from "node:fs/promises";
import { join as Oa, relative as La, resolve as Da } from "node:path";
import { createHash as zc } from "node:crypto";
import { readdir as ns, readFile as os } from "node:fs/promises";
import { basename as jc, isAbsolute as Zc, join as ce, relative as hr, resolve as je, sep as yr } from "node:path";
import { createHash as fs, randomUUID as ms } from "node:crypto";
import { createReadStream as Vc } from "node:fs";
import { lstat as Jc, readFile as kr, realpath as At, rename as hs, stat as us, writeFile as ys } from "node:fs/promises";
import { isAbsolute as Kc, join as Se, relative as _r, resolve as Hn, sep as gs } from "node:path";
import { createHash as Pr, randomUUID as Ce } from "node:crypto";
import { access as Or, mkdir as Kn, readFile as Ze, realpath as Ee, rename as Gn, writeFile as Yn } from "node:fs/promises";
import { basename as Jn, dirname as Is, extname as Yc, isAbsolute as Xc, join as Ae, relative as Qc, resolve as Tt, sep as el } from "node:path";
import { createHash as Gc } from "node:crypto";
import { execFile as pl } from "node:child_process";
import { existsSync as Mr } from "node:fs";
import { chmod as fl, mkdir as ml, readFile as Ms, rename as hl, writeFile as yl } from "node:fs/promises";
import { homedir as Us } from "node:os";
import { dirname as gl, join as me } from "node:path";
import { promisify as wl } from "node:util";
import { createHash as Sl, randomUUID as ei } from "node:crypto";
import { open as ti, realpath as Ys, stat as Cl } from "node:fs/promises";
import { basename as El, isAbsolute as Xs, relative as Al, resolve as Il, sep as Qs } from "node:path";
import { createHash as Gl } from "node:crypto";
var jo = Object.defineProperty;
var s = (e, t) => jo(e, "name", { value: t, configurable: true });
var Z = (e, t) => {
  for (var r in t) jo(e, r, { get: t[r], enumerable: true });
};
var Ft = "drone-connector-receipt/v1";
function $i(e, t) {
  return t === "write" ? e.write : t === "delete" ? e.delete : e.read;
}
s($i, "operationAllowed");
function yu(e, t, r) {
  return $i(e.permissions.access, t) ? e.permissions.authorization.requiredFor.includes(t) && !r ? { connectorId: e.id, operation: t, status: "requires-authorization", reason: e.permissions.authorization.reason ?? "A host authorization reference is required" } : { connectorId: e.id, operation: t, status: "allowed" } : { connectorId: e.id, operation: t, status: "unsupported", reason: `${e.id} does not declare ${t} access` };
}
s(yu, "planConnectorOperation");
function gu(e) {
  let t = { schemaVersion: e.schemaVersion ?? 1, contract: e.contract ?? Ft, receiptId: e.receiptId, connectorId: e.connectorId, host: e.host, operation: e.operation, phase: e.phase, status: e.status, observedAt: e.observedAt, readOnly: e.readOnly, externalSideEffects: [...e.externalSideEffects], ...e.sourceRef ? { sourceRef: e.sourceRef } : {}, ...e.locator ? { locator: e.locator } : {}, ...e.externalId ? { externalId: e.externalId } : {}, ...e.contentHash ? { contentHash: e.contentHash } : {}, ...e.authorizationRef ? { authorizationRef: e.authorizationRef } : {}, ...e.credentialRef ? { credentialRef: e.credentialRef } : {}, ...e.parentReceiptId ? { parentReceiptId: e.parentReceiptId } : {}, ...e.message ? { message: e.message } : {} };
  return Zo(t), Object.freeze(t.externalSideEffects), Object.freeze(t);
}
s(gu, "createConnectorReceipt");
function Zo(e) {
  if (e.schemaVersion !== 1) throw new Error(`Unsupported connector receipt schema: ${e.schemaVersion}`);
  if (e.contract !== Ft) throw new Error(`Unsupported connector receipt contract: ${e.contract}`);
  if (!e.receiptId.trim() || !e.connectorId.trim() || !e.observedAt.trim()) throw new Error("Connector receipt id, connector id and observedAt are required");
  if (e.operation === "write" || e.operation === "delete") {
    if (e.readOnly) throw new Error(`${e.operation} receipts cannot be readOnly`);
  } else if (!e.readOnly) throw new Error(`${e.operation} receipts must be readOnly in the default contract`);
  if (e.externalSideEffects.includes("remote-write") && e.readOnly) throw new Error("A readOnly receipt cannot declare a remote-write side effect");
  if (e.externalSideEffects.includes("remote-delete") && e.readOnly) throw new Error("A readOnly receipt cannot declare a remote-delete side effect");
}
s(Zo, "validateConnectorReceipt");
function wu(e) {
  if (e.operation !== "write" && e.operation !== "delete") throw new Error("Receipt chains must describe a write or delete operation");
  for (let r of e.receipts) if (Zo(r), r.connectorId !== e.connectorId) throw new Error("All receipts in a chain must use the same connector");
  let t = { schemaVersion: e.schemaVersion ?? 1, contract: e.contract ?? Ft, chainId: e.chainId, connectorId: e.connectorId, operation: e.operation, startedAt: e.startedAt, ...e.finishedAt ? { finishedAt: e.finishedAt } : {}, status: e.status, receipts: [...e.receipts] };
  if (t.schemaVersion !== 1 || t.contract !== Ft) throw new Error("Unsupported connector receipt chain contract");
  return Object.freeze(t.receipts), Object.freeze(t);
}
s(wu, "createConnectorReceiptChain");
var gt = Object.freeze({ requiredFor: [] });
var Mt = [{ id: "zotero", version: "1", kind: "citation", label: "Zotero", description: "Read Zotero library metadata and citation records through a host-owned API adapter.", permissions: { capabilities: ["search", "read", "resolve"], hosts: ["native-pi", "drone-desktop"], network: { mode: "public", allowedHosts: ["api.zotero.org"], hostAllowlistRequired: true }, credentials: { required: false, sources: ["host-secret-store", "environment"], references: ["zotero-api-key"] }, access: { read: true, write: false, delete: false }, readOnly: true, authorization: gt, externalSideEffects: [] }, enabledByDefault: false }, { id: "webdav", version: "1", kind: "storage", label: "WebDAV", description: "Read files and directory metadata from a configured WebDAV endpoint.", permissions: { capabilities: ["list", "read", "resolve"], hosts: ["native-pi", "drone-desktop"], network: { mode: "configured", allowedHosts: ["configured-webdav-host"], hostAllowlistRequired: true }, credentials: { required: true, sources: ["host-secret-store", "environment"], references: ["webdav-credential-ref"] }, access: { read: true, write: false, delete: false }, readOnly: true, authorization: gt, externalSideEffects: [] }, enabledByDefault: false }, { id: "generic-mcp", version: "1", kind: "mcp", label: "Generic MCP", description: "Discover and invoke host-selected read-only MCP tools; server writes require a separate host contract.", permissions: { capabilities: ["discover", "read", "invoke"], hosts: ["native-pi", "drone-desktop"], network: { mode: "configured", allowedHosts: ["host-configured-mcp-endpoint"], hostAllowlistRequired: true }, credentials: { required: false, sources: ["mcp-config", "host-secret-store"], references: ["mcp-server-config"] }, access: { read: true, write: false, delete: false }, readOnly: true, authorization: { requiredFor: ["invoke"], reason: "The host must approve each selected MCP tool surface." }, externalSideEffects: [] }, enabledByDefault: false }, { id: "institutional", version: "1", kind: "institutional", label: "Institutional access", description: "Resolve and read institutionally accessible sources through a host-managed session or browser handoff.", permissions: { capabilities: ["search", "read", "resolve", "browser-handoff"], hosts: ["native-pi", "drone-desktop"], network: { mode: "institutional", allowedHosts: ["configured-institutional-host"], hostAllowlistRequired: true }, credentials: { required: true, sources: ["browser-session", "oauth"], references: ["institutional-session-ref"] }, access: { read: true, write: false, delete: false }, readOnly: true, authorization: { requiredFor: ["browser-handoff"], reason: "A human-approved browser handoff is required for login or challenge pages." }, externalSideEffects: ["browser-navigation"] }, enabledByDefault: false }, { id: "search", version: "1", kind: "search", label: "External search", description: "Search declared public providers and return provider-neutral source leads with receipts.", permissions: { capabilities: ["search", "read", "resolve"], hosts: ["native-pi", "drone-desktop"], network: { mode: "public", allowedHosts: ["declared-search-provider"], hostAllowlistRequired: true }, credentials: { required: false, sources: ["none"] }, access: { read: true, write: false, delete: false }, readOnly: true, authorization: gt, externalSideEffects: [] }, enabledByDefault: false }, { id: "arxiv", version: "1", kind: "search", label: "arXiv", description: "Read public arXiv metadata and source links through a host-owned search adapter.", permissions: { capabilities: ["search", "read", "resolve"], hosts: ["native-pi", "drone-desktop"], network: { mode: "public", allowedHosts: ["export.arxiv.org", "arxiv.org"], hostAllowlistRequired: true }, credentials: { required: false, sources: ["none"] }, access: { read: true, write: false, delete: false }, readOnly: true, authorization: gt, externalSideEffects: [] }, enabledByDefault: true }, { id: "semantic-scholar", version: "1", kind: "search", label: "Semantic Scholar", description: "Read public Semantic Scholar paper metadata and citation links through a host-owned adapter.", permissions: { capabilities: ["search", "read", "resolve"], hosts: ["native-pi", "drone-desktop"], network: { mode: "public", allowedHosts: ["api.semanticscholar.org"], hostAllowlistRequired: true }, credentials: { required: false, sources: ["none"] }, access: { read: true, write: false, delete: false }, readOnly: true, authorization: gt, externalSideEffects: [] }, enabledByDefault: true }, { id: "browser", version: "1", kind: "browser", label: "Browser source reader", description: "Read an explicitly approved browser target and return a bounded source receipt.", permissions: { capabilities: ["search", "read", "browser-handoff"], hosts: ["native-pi", "drone-desktop"], network: { mode: "public", allowedHosts: ["host-approved-navigation-target"], hostAllowlistRequired: true }, credentials: { required: false, sources: ["browser-session"] }, access: { read: true, write: false, delete: false }, readOnly: true, authorization: { requiredFor: ["browser-handoff"], reason: "Navigation must be explicitly approved by the host/user." }, externalSideEffects: ["browser-navigation"] }, enabledByDefault: false }];
function sn(e) {
  let t = Object.freeze({ ...e.permissions.network, allowedHosts: Object.freeze([...e.permissions.network.allowedHosts]) }), r = Object.freeze({ ...e.permissions.credentials, sources: Object.freeze([...e.permissions.credentials.sources]), ...e.permissions.credentials.references ? { references: Object.freeze([...e.permissions.credentials.references]) } : {} }), n = Object.freeze({ ...e.permissions.authorization, requiredFor: Object.freeze([...e.permissions.authorization.requiredFor]) }), o = Object.freeze({ ...e.permissions, capabilities: Object.freeze([...e.permissions.capabilities]), hosts: Object.freeze([...e.permissions.hosts]), network: t, credentials: r, access: Object.freeze({ ...e.permissions.access }), authorization: n, externalSideEffects: Object.freeze([...e.permissions.externalSideEffects]) });
  return Object.freeze({ ...e, permissions: o });
}
s(sn, "freezeConnectorDescriptor");
function Di() {
  return Mt.map(sn);
}
s(Di, "defaultConnectorDescriptors");
var Ni = /^[a-z0-9][a-z0-9-]{1,63}$/u;
function cn(e, t) {
  if (!e.trim()) throw new Error(`${t} must be a non-empty string`);
}
s(cn, "nonEmpty");
function We(e, t) {
  if (new Set(e).size !== e.length) throw new Error(`${t} contains duplicate values`);
}
s(We, "unique");
function zi(e, t) {
  if (!t.capabilities.length) throw new Error(`Connector ${e} must declare capabilities`);
  if (!t.hosts.length) throw new Error(`Connector ${e} must declare at least one host`);
  if (We(t.capabilities, `${e} capabilities`), We(t.hosts, `${e} hosts`), We(t.network.allowedHosts, `${e} network.allowedHosts`), We(t.credentials.sources, `${e} credential sources`), We(t.authorization.requiredFor, `${e} authorization.requiredFor`), We(t.externalSideEffects, `${e} externalSideEffects`), !t.access.read && !t.access.write && !t.access.delete) throw new Error(`Connector ${e} must declare at least one access mode`);
  let r = !t.access.write && !t.access.delete;
  if (t.readOnly !== r) throw new Error(`Connector ${e} readOnly must match write/delete access`);
  if (t.network.mode === "none") {
    if (t.network.allowedHosts.length || t.network.hostAllowlistRequired) throw new Error(`Connector ${e} network=none cannot declare hosts or an allowlist`);
  } else {
    if (!t.network.allowedHosts.length) throw new Error(`Connector ${e} network access requires an explicit host label`);
    if (!t.network.hostAllowlistRequired) throw new Error(`Connector ${e} network access must require a host allowlist`);
  }
  if (!t.credentials.required && t.credentials.sources.includes("none")) {
    if (t.credentials.sources.length !== 1) throw new Error(`Connector ${e} cannot mix none and credential sources`);
  } else if (t.credentials.required && t.credentials.sources.includes("none")) throw new Error(`Connector ${e} cannot require credentials from source none`);
  for (let n of t.hosts) if (n !== "native-pi" && n !== "drone-desktop") throw new Error(`Connector ${e} declares an unknown host: ${n}`);
}
s(zi, "validatePermissions");
function un(e) {
  if (!Ni.test(e.id)) throw new Error(`Invalid connector id: ${e.id}`);
  cn(e.version, `${e.id} version`), cn(e.label, `${e.id} label`), cn(e.description, `${e.id} description`), zi(e.id, e.permissions);
}
s(un, "validateConnectorDescriptor");
var ln = class {
  static {
    s(this, "ConnectorRegistry");
  }
  descriptors = /* @__PURE__ */ new Map();
  constructor(t = Mt) {
    for (let r of t) this.register(r);
  }
  register(t) {
    un(t);
    let r = sn(t);
    if (this.descriptors.has(r.id)) throw new Error(`Connector already registered: ${r.id}`);
    this.descriptors.set(r.id, r);
  }
  get(t) {
    return this.descriptors.get(t);
  }
  require(t) {
    let r = this.get(t);
    if (!r) throw new Error(`Unknown connector: ${t}`);
    return r;
  }
  list() {
    return [...this.descriptors.values()].sort((t, r) => t.id.localeCompare(r.id));
  }
  findByKind(t) {
    return this.list().filter((r) => r.kind === t);
  }
  forHost(t) {
    return this.list().filter((r) => r.permissions.hosts.includes(t));
  }
  permissionAudit() {
    return this.list().map((t) => ({ id: t.id, kind: t.kind, hosts: t.permissions.hosts, capabilities: t.permissions.capabilities, network: t.permissions.network, credentials: t.permissions.credentials, access: t.permissions.access, readOnly: t.permissions.readOnly, externalSideEffects: t.permissions.externalSideEffects, enabledByDefault: t.enabledByDefault }));
  }
};
function qo(e) {
  return new ln(e);
}
s(qo, "createConnectorRegistry");
function Fo(e) {
  return { content: [{ type: "text", text: JSON.stringify(e, null, 2) }], details: e };
}
s(Fo, "result");
function ji(e) {
  let t = String(e ?? "").normalize("NFKC").trim();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/u.test(t)) throw new Error("connector id must be a non-empty bounded identifier");
  return t;
}
s(ji, "boundedId");
function Mo(e) {
  return { id: e.id, version: e.version, kind: e.kind, label: e.label, description: e.description, enabledByDefault: e.enabledByDefault, permissions: e.permissions };
}
s(Mo, "descriptorView");
function Iu(e, t = {}) {
  let r = t.registry ?? qo();
  return e.registerTool({ name: "connector_list", label: "Connectors \xB7 list", description: "List host-neutral connector declarations, including capabilities, hosts, network scope, credentials and side effects. This performs no network or filesystem I/O.", drone: { readOnly: true, recoverySafe: true, capabilities: ["connectors", "research"] }, parameters: { type: "object", properties: {} }, async execute() {
    return Fo({ contractVersion: 1, connectors: r.list().map(Mo) });
  } }), e.registerTool({ name: "connector_get", label: "Connectors \xB7 inspect", description: "Inspect one connector declaration. Execution, credentials, browser navigation and writes remain host responsibilities.", drone: { readOnly: true, recoverySafe: true, capabilities: ["connectors", "research"] }, parameters: { type: "object", properties: { id: { type: "string", minLength: 2, maxLength: 64 } }, required: ["id"] }, async execute(n, o) {
    let a = r.require(ji(o?.id));
    return Fo({ contractVersion: 1, connector: Mo(a) });
  } }), { tools: ["connector_list", "connector_get"], registry: r };
}
s(Iu, "registerPiConnectors");
function Tu(e) {
  return un(e), e;
}
s(Tu, "assertConnectorDescriptor");
var Ho = {};
Z(Ho, { CLAIM_BINDING_SCHEMA: () => Ut, claimBindingRefs: () => Le, validateClaimBindings: () => Je });
var Uo = ["direct", "indirect", "hypothesis", "unsupported"];
function Ve(e, t, r = 4e3) {
  if (typeof e != "string" || !e.trim() || e.length > r) throw new Error(`Invalid ${t}`);
  return e.trim();
}
s(Ve, "text");
function Je(e, t, r) {
  if (!Array.isArray(e) || e.length < 1 || e.length > 64) throw new Error("Provide 1-64 structured claim_bindings");
  let n = /* @__PURE__ */ new Set();
  return e.map((o, a) => {
    if (!o || typeof o != "object" || Array.isArray(o)) throw new Error("Invalid claim binding");
    let c = o, l = Ve(c.claim, "claim"), i = Ve(c.limitations, "limitations");
    if (n.has(l)) throw new Error("Duplicate claim binding");
    n.add(l);
    let u = c.relationship;
    if (!Uo.includes(u)) throw new Error("Invalid support relationship");
    if (!Array.isArray(c.sources) || c.sources.length > 12) throw new Error("Invalid claim sources");
    if (["direct", "indirect"].includes(String(u)) && c.sources.length === 0) throw new Error("Supported claims require observed source excerpts");
    let d = c.sources.map((p) => {
      if (!p || typeof p != "object" || Array.isArray(p)) throw new Error("Invalid claim source");
      let f = p, m = typeof f.path == "string" ? f.path : "", h = t.find((g) => g.path === m), y = r.get(m), b = Array.isArray(y) ? y : y ? [y] : [];
      if (!h || !b.some((g) => g.hash === h.hash)) throw new Error("Claim source was not read and identity-verified in this scope");
      let R = f.start_line, C = f.end_line, v = b.find((g) => g.hash === h.hash && Number.isInteger(R) && Number.isInteger(C) && R >= g.startLine && C >= R && C <= g.endLine);
      if (!v) throw new Error("Claim source range is outside the observed read; unread gaps cannot be cited");
      let x = Ve(f.quote, "source quote", 6e3);
      if (!v.text.split(/\r?\n/).slice(R - v.startLine, C - v.startLine + 1).join(`
`).includes(x)) throw new Error("Claim quote does not match the observed note range");
      return { path: h.path, doi: h.doi, zotero_key: h.zotero_key, hash: h.hash, start_line: R, end_line: C, quote: x, ...f.original_location ? { original_location: Ve(f.original_location, "historical original location", 600) } : {}, reading_basis: "current-scope-observed-excerpt", ...v.receiptId ? { read_receipt_id: v.receiptId } : {}, originalFulltextReadThisTurn: false };
    });
    return { id: `claim-${a + 1}`, claim: l, relationship: u, limitations: i, ...c.organism ? { organism: Ve(c.organism, "organism", 600) } : {}, ...c.method ? { method: Ve(c.method, "method", 1e3) } : {}, sources: d, supportAssessment: "model-asserted-unreviewed", provenanceChecked: true, scientificallyVerified: false };
  });
}
s(Je, "validateClaimBindings");
function Le(e) {
  return e.map((t) => `${t.claim} [${t.relationship}] -> ${t.sources.map((r) => `${r.path}:${r.start_line}-${r.end_line}`).join(", ") || "no supporting source"}; limitation: ${t.limitations}`);
}
s(Le, "claimBindingRefs");
var Ut = { type: "array", minItems: 1, maxItems: 64, items: { type: "object", properties: { claim: { type: "string" }, relationship: { type: "string", enum: [...Uo] }, organism: { type: "string" }, method: { type: "string" }, limitations: { type: "string" }, sources: { type: "array", maxItems: 12, items: { type: "object", properties: { path: { type: "string" }, start_line: { type: "integer", minimum: 1 }, end_line: { type: "integer", minimum: 1 }, quote: { type: "string" }, original_location: { type: "string" } }, required: ["path", "start_line", "end_line", "quote"] } } }, required: ["claim", "relationship", "limitations", "sources"] } };
var Ko = {};
Z(Ko, { INSTITUTIONAL_AGENT_DIR: () => fn, INSTITUTIONAL_CONFIG_NAME: () => pn, INSTITUTIONAL_CONFIG_PATH: () => wt, buildProxiedUrl: () => Ht, detectAndSaveTemplateFromUrl: () => Jo, emptyInstitutionalConfig: () => Bt, inferEzproxyTemplateFromUrl: () => Ke, loadInstitutionalConfig: () => mn, normalizeInstitutionalConfig: () => Wt, saveInstitutionalConfig: () => hn });
var Bo = {};
Z(Bo, { buildProxiedUrl: () => Ht, inferEzproxyTemplateFromUrl: () => Ke });
function Ht(e, t) {
  if (!t) return null;
  let r = t.trim();
  if (!r) return null;
  try {
    if (r.includes("%s")) return r.replaceAll("%s", encodeURIComponent(e));
    let n = new URL(e);
    if (r.includes(n.host)) return null;
    if (/[?&=]$/.test(r) || r.endsWith("url=") || r.endsWith("url")) {
      let o = r.includes("?") ? r.endsWith("?") || r.endsWith("&") || r.endsWith("=") ? "" : "&" : "?";
      return r.endsWith("=") ? `${r}${encodeURIComponent(e)}` : `${r}${o}url=${encodeURIComponent(e)}`;
    }
    return r.includes("ezproxy") || r.includes("login") ? r.includes("?") ? r.endsWith("?") || r.endsWith("&") ? `${r}${encodeURIComponent(e)}` : r.includes("url=") ? /url=$/.test(r) ? `${r}${encodeURIComponent(e)}` : `${r}&url=${encodeURIComponent(e)}` : `${r}&url=${encodeURIComponent(e)}` : `${r}?url=${encodeURIComponent(e)}` : `${r}${encodeURIComponent(e)}`;
  } catch {
    return null;
  }
}
s(Ht, "buildProxiedUrl");
function Ke(e) {
  try {
    let t = new URL(e), r = t.href;
    if (t.hostname.includes("ezproxy") && t.search) {
      let n = new URLSearchParams(t.search).get("url");
      if (n && /^https?:\/\//i.test(n)) {
        let o = `${r.split("url=")[0]}url=`;
        if (/^https?:\/\//i.test(o)) return `${o}%s`;
      }
      if (r.includes("url=") && /url=https?%3A/i.test(r) || r.includes("url=https://")) {
        let o = r.indexOf("url=");
        if (o > 0) {
          let a = r.slice(0, o + 4);
          if (/^https?:\/\//i.test(a)) return `${a}%s`;
        }
      }
    }
    if ((r.includes("?url=") || r.includes("&url=")) && /url=https?/i.test(r)) {
      let n = r.match(/^(https?:\/\/[^?]+\?[^=]*url=)/i);
      if (n) {
        let o = n[1];
        if (o && !o.includes("nature.com") && !o.includes("sciencedirect.com") && !o.includes("springer.com") && !o.includes("wiley.com") && o.length < 200) return `${o}%s`;
        if (o && o.length < 300) return `${o}%s`;
      }
    }
    return null;
  } catch {
    return null;
  }
}
s(Ke, "inferEzproxyTemplateFromUrl");
var pn = "institutional.json";
var fn = Vo(Fi(), ".pi", "agent");
var wt = Vo(fn, pn);
function Bt() {
  return { version: 1, autoDownloadEnabled: true, perTaskLimit: 20 };
}
s(Bt, "emptyInstitutionalConfig");
function dn(e) {
  if (e == null) return;
  let t = String(e).trim();
  if (!(!t || t.length > 2048 || !/^https?:\/\//i.test(t))) return t;
}
s(dn, "normalizeUrl");
function Wt(e) {
  let t = Bt();
  if (!e || typeof e != "object" || Array.isArray(e)) return t;
  let r = e, n = dn(r.ezproxyTemplate), o = dn(r.openUrlResolver), a = typeof r.institutionName == "string" && r.institutionName.trim().slice(0, 120) || void 0, c = typeof r.autoDownloadEnabled == "boolean" ? r.autoDownloadEnabled : t.autoDownloadEnabled, l = typeof r.perTaskLimit == "number" && Number.isInteger(r.perTaskLimit) ? Math.min(100, Math.max(1, r.perTaskLimit)) : t.perTaskLimit, i = typeof r.lastLoginAt == "string" ? r.lastLoginAt : void 0, u = dn(r.lastLoginUrl);
  return { version: 1, ezproxyTemplate: n, institutionName: a, openUrlResolver: o, autoDownloadEnabled: c, perTaskLimit: l, lastLoginAt: i, lastLoginUrl: u, configured: !!(n || o || a || i) };
}
s(Wt, "normalizeInstitutionalConfig");
async function mn(e = wt, t = { readFile: s((r) => Wo(r, "utf8"), "readFile") }) {
  try {
    return Wt(JSON.parse(await t.readFile(e)));
  } catch {
    return Bt();
  }
}
s(mn, "loadInstitutionalConfig");
async function hn(e, t = wt, r = { readFile: s((n) => Wo(n, "utf8"), "readFile"), writeFile: s(async (n, o) => {
  await qi(n, o, "utf8");
}, "writeFile"), mkdir: s(async (n) => {
  await Zi(n, { recursive: true });
}, "mkdir") }) {
  let n = Wt(e);
  return await r.mkdir(Mi(t)), await r.writeFile(t, `${JSON.stringify(n, null, 2)}
`), n;
}
s(hn, "saveInstitutionalConfig");
async function Jo(e, { path: t = wt, io: r } = {}) {
  let n = Ke(e);
  if (!n) return null;
  let o = await mn(t, r);
  return o.ezproxyTemplate === n ? o : hn({ ...o, ezproxyTemplate: n }, t, r);
}
s(Jo, "detectAndSaveTemplateFromUrl");
var ea = {};
Z(ea, { createLiteratureOperations: () => Qo, destinationRecovery: () => yn, literatureOperationId: () => gn });
var Xo = {};
Z(Xo, { exactDoiItems: () => bt, normalizeDoi: () => L, verifyLiteratureReceipt: () => Yo });
function L(e) {
  let t = String(e || "").trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "").toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(t) ? t : null;
}
s(L, "normalizeDoi");
function bt(e, t) {
  let r = L(t);
  return r ? e.filter((n) => L(n.data?.DOI || n.doi || n.DOI) === r) : [];
}
s(bt, "exactDoiItems");
function Gi(e) {
  return e instanceof Error ? e.name : "Error";
}
s(Gi, "errorName");
async function Yo({ doi: e, zotero_key: t, note_path: r, vault: n, signal: o, fetcher: a = s((c, l) => fetch(c, l), "fetcher") }) {
  let c = L(e), l = String(t || "");
  if (!c || !/^[A-Z0-9]{8}$/.test(l)) throw new Error("Valid DOI and Zotero key required");
  let i = { doi: c, zoteroKey: l, zotero: { status: "unavailable" }, obsidian: { status: "unavailable" }, scientificallyVerified: false }, u = s(async (p) => {
    let f = await a(`http://127.0.0.1:23119/api/users/0/${p}`, { signal: o ? AbortSignal.any([o, AbortSignal.timeout(1e4)]) : AbortSignal.timeout(1e4), redirect: "error" });
    if (!f.ok) throw new Error(`Zotero HTTP ${f.status}`);
    return f.json();
  }, "get");
  try {
    let p = await u(`items/${l}`), f = p?.data || {};
    if (i.zotero = { status: bt([p], c).length ? "verified" : "identity-mismatch", title: f.title, collections: f.collections || [] }, i.zotero.status === "verified") try {
      let m = await u(`items/${l}/children`);
      i.zotero.pdfAttachmentKeys = m.filter((h) => h.data?.contentType === "application/pdf").map((h) => String(h.data?.key || "")).filter(Boolean), i.zotero.fulltextStatus = i.zotero.pdfAttachmentKeys.length ? "attachment-indexed-not-read" : "metadata-only";
    } catch {
      i.zotero.fulltextStatus = "unavailable";
    }
  } catch (p) {
    i.zotero.error = Gi(p) === "TimeoutError" ? "timeout" : "local-api-unavailable";
  }
  let d = false;
  try {
    let p = String(r || "");
    if (!n || !/^(?:Library)\/Papers\/.+\.md$/.test(p) || p.split("/").includes("..") || p.includes("\\")) throw new Error("invalid-note-path");
    let f = await Go(String(n));
    d = true;
    let m = await Go(Ji(f, p)), h = Vi(f, m);
    if (Wi(h) || h === ".." || h.startsWith(`..${Ki}`)) throw new Error("outside-vault");
    if ((await Bi(m)).size > 1024 * 1024) throw new Error("note-too-large");
    let y = await Hi(m, "utf8"), b = y.includes(`zotero:${l}`) || new RegExp(`zotero://select/library/items/${l}(?=[)\\s<>]|$)`).test(y) || new RegExp(`^zotero_key: *["']?${l}["']? *$`, "m").test(y), R = y.match(/10\.\d{4,9}\/[^\s<>"'\])]+/gi) || [];
    i.obsidian = { status: b && R.some((C) => L(C.replace(/[.,;]+$/, "")) === c) ? "verified" : "identity-mismatch", path: p, vault: f, hash: Ui("sha256").update(y).digest("hex") };
  } catch (p) {
    d && p instanceof Error && "code" in p && p.code === "ENOENT" ? (i.obsidian.status = "missing", i.obsidian.error = "note-missing") : i.obsidian.error = "note-unavailable-or-invalid";
  }
  return i.status = i.zotero.status === "verified" && i.obsidian.status === "verified" ? "both-verified" : "partial", i;
}
s(Yo, "verifyLiteratureReceipt");
function yn(e = {}) {
  let t = e.zotero?.status || "unavailable", r = e.obsidian?.status || "unavailable";
  return { zotero: { status: t, action: t === "verified" ? "reuse-existing-item" : t === "identity-mismatch" ? "resolve-identity-conflict" : "read-back-before-any-import", autoWrite: false }, obsidian: { status: r, action: r === "verified" ? "preserve-existing-note" : r === "missing" ? "deposit-missing-note-with-authorization" : r === "identity-mismatch" ? "review-note-conflict-preserve-human-content" : "wait-and-recheck-vault", autoWrite: false }, completed: t === "verified" && r === "verified", scientificallyVerified: false };
}
s(yn, "destinationRecovery");
function gn(e, t, r) {
  let n = L(r);
  if (!n) throw new Error("Valid DOI required");
  return Yi("sha256").update(JSON.stringify([e, t, n])).digest("hex");
}
s(gn, "literatureOperationId");
function Qo(e) {
  let t = e.now || (() => (/* @__PURE__ */ new Date()).toISOString()), r = e.createId || Xi;
  return { async reconcileLiteratureOperation({ cwd: n = process.cwd(), runDir: o, doi: a, zoteroKey: c, notePath: l }, { verify: i = e.verify } = {}) {
    let u = L(a);
    if (!u) throw new Error("Valid DOI required");
    let { file: d, vault: p, revision: f } = await e.resolveRunJournal(n, o);
    if (!p) throw new Error("No bound Vault");
    let m = gn(p, f, u);
    return e.exclusive(d, async () => {
      let h = await e.readJournal(d), y = h.operations[m];
      if (y && (y.zoteroKey !== c || y.notePath !== l)) throw new Error("Operation identity changed; resolve the existing DOI/key/path mapping before retry");
      let b = await i({ doi: u, zotero_key: c, note_path: l, vault: p }), R = yn(b), C = t(), v = { id: m, doi: u, zoteroKey: c, notePath: l, vault: p, revision: f, status: R.completed ? "both-identities-verified" : "partial-or-unavailable", attempts: (y?.attempts || 0) + 1, createdAt: y?.createdAt || C, checkedAt: C, destinations: R, receipt: b, history: [...y?.history || [], { at: C, zotero: b.zotero?.status, obsidian: b.obsidian?.status }].slice(-32) };
      return h.operations[m] = v, await e.writeJournal(d, h), { operation_id: m, log_path: d, status: v.status, destinations: R, receipt: b, attempts: v.attempts, writesToLibraries: 0 };
    });
  }, async recordZoteroWrite({ cwd: n = process.cwd(), runDir: o, receipt: a }) {
    let c = L(a?.doi);
    if (!c) throw new Error("Valid DOI required");
    let { file: l } = await e.resolveRunJournal(n, o);
    return e.exclusive(l, async () => {
      let i = await e.readJournal(l), u = { id: r(), doi: c, status: String(a.status || "unknown"), reason: a.reason || null, channel: a.channel || null, zoteroKey: a.zoteroKey || null, library: a.library || null, collection: a.collection || null, attachment: a.attachment || null, fulltextStatus: a.fulltextStatus || null, readBack: a.readBack || null, consent: a.consent || null, writesToLibraries: a.writesToLibraries || 0, at: a.write?.at || t() };
      return i.writes = [...Array.isArray(i.writes) ? i.writes : [], u].slice(-64), await e.writeJournal(l, i), { write_id: u.id, log_path: l, writes: i.writes.length, autoRetry: false };
    });
  } };
}
s(Qo, "createLiteratureOperations");
var ta = {};
Z(ta, { OA_DEFAULT_TIMEOUT_MS: () => wn, OA_MAX_CANDIDATES: () => $e, OA_SOURCES: () => Vt, PMC_CLOUD_BASE: () => Rt, contactEmail: () => Jt, default: () => nc, normalizePmcid: () => ie, normalizePmid: () => ye, pmcCloudHttps: () => Kt, resolveOpenAccess: () => vt });
var Vt = Object.freeze(["europepmc", "pmc-cloud", "unpaywall", "openalex", "semanticscholar", "crossref"]);
var Rt = "https://pmc-oa-opendata.s3.amazonaws.com";
var Qi = 3;
var wn = 12e3;
var $e = 8;
var ec = ["DRONE_CONTACT_EMAIL", "UNPAYWALL_EMAIL"];
function ie(e) {
  let r = String(e || "").trim().toUpperCase().match(/^(?:PMC)?(\d{1,9})$/);
  return r ? `PMC${r[1]}` : null;
}
s(ie, "normalizePmcid");
function ye(e) {
  let t = String(e || "").trim();
  return /^\d{1,9}$/.test(t) ? t : null;
}
s(ye, "normalizePmid");
function Jt(e, t = process.env) {
  let r = [e, ...ec.map((n) => t[n])];
  for (let n of r) {
    let o = String(n || "").trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o)) return o;
  }
  return null;
}
s(Jt, "contactEmail");
var tc = s((e) => {
  let t = String(e || "").trim();
  if (!/^https?:\/\//i.test(t)) return null;
  try {
    let r = new URL(t);
    return r.protocol === "ftp:" ? null : r.href;
  } catch {
    return null;
  }
}, "httpsUrl");
var Kt = s((e) => {
  let t = String(e || "").trim();
  return /^s3:\/\/pmc-oa-opendata\//i.test(t) ? `${Rt}/${t.replace(/^s3:\/\/pmc-oa-opendata\//i, "")}` : t.startsWith(`${Rt}/`) ? t : null;
}, "pmcCloudHttps");
async function Ge(e, t, { timeoutMs: r, signal: n, accept: o = "application/json" }) {
  let a = new AbortController(), c = setTimeout(() => a.abort(), r), l = s(() => a.abort(), "onAbort");
  n?.addEventListener("abort", l, { once: true });
  try {
    let i = await e(t, { signal: a.signal, headers: { accept: o }, redirect: "follow" }), u = await i.text();
    if (!i.ok) return { ok: false, status: i.status, detail: `HTTP ${i.status}` };
    if (o === "application/json") try {
      return { ok: true, status: i.status, body: JSON.parse(u) };
    } catch {
      return { ok: false, status: i.status, detail: "invalid JSON" };
    }
    return { ok: true, status: i.status, body: u };
  } catch (i) {
    let u = i instanceof Error ? i.message : "fetch failed";
    return { ok: false, status: 0, detail: i instanceof Error && i.name === "AbortError" ? "timeout" : u };
  } finally {
    clearTimeout(c), n?.removeEventListener("abort", l);
  }
}
s(Ge, "fetchJson");
function rc(e) {
  let t = /* @__PURE__ */ new Set(), r = [];
  return { candidates: r, add(n) {
    let o = tc(n?.url);
    return !o || t.has(o) || r.length >= e ? false : (t.add(o), r.push({ url: o, source: n.source || "unknown", kind: n.kind || "pdf", license: n.license || null, version: n.version || null, hostType: n.hostType || null, note: n.note || null }), true);
  } };
}
s(rc, "makeCollector");
async function vt({ doi: e, pmcid: t, pmid: r, email: n, fetchImpl: o = globalThis.fetch, timeoutMs: a = wn, signal: c, sources: l = Vt, maxCandidates: i = $e, env: u = process.env } = {}) {
  if (typeof o != "function") throw new Error("fetch is unavailable");
  let d = { doi: L(e), pmcid: ie(t), pmid: ye(r) };
  if (!d.doi && !d.pmcid && !d.pmid) throw new Error("open-access resolution needs a DOI, PMCID or PMID");
  let p = new Set(l), f = Jt(n, u), m = rc(i), h = [], y = { oaStatus: null, license: null, title: null }, b = s(($, g, S) => h.push({ source: $, status: g, detail: S || null }), "note"), R = { timeoutMs: a, signal: c }, C = null;
  if (p.has("europepmc")) {
    let $ = d.doi ? `DOI:"${d.doi}"` : d.pmcid ? `PMCID:${d.pmcid}` : `EXT_ID:${d.pmid} AND SRC:MED`, g = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent($)}&format=json&resultType=lite&pageSize=5`, S = await Ge(o, g, R);
    if (!S.ok) b("europepmc", "error", S.detail);
    else {
      let I = Array.isArray(S.body?.resultList?.result) ? S.body.resultList.result : [], E = I.find((O) => d.doi && L(O.doi) === d.doi) || I.find((O) => d.pmcid && ie(O.pmcid) === d.pmcid) || I.find((O) => d.pmid && ye(O.pmid) === d.pmid) || null;
      E ? (d.pmcid = d.pmcid || ie(E.pmcid), d.pmid = d.pmid || ye(E.pmid), d.doi = d.doi || L(E.doi), y.title = E.title || null, C = { isOa: E.isOpenAccess === "Y", inEpmc: E.inEPMC === "Y" }, b("europepmc", "ok", `${d.pmcid || "no PMCID"}; isOpenAccess=${E.isOpenAccess || "?"}; inEPMC=${E.inEPMC || "?"}; hasPDF=${E.hasPDF || "?"}`)) : b("europepmc", "ok", "no record");
    }
  }
  let v = null, x = s(async () => {
    if (!p.has("pmc-cloud") || !d.pmcid || v === d.pmcid) return;
    v = d.pmcid;
    let $ = [], g = 0;
    for (let I = 1; I <= Qi; I += 1) {
      let E = `${Rt}/metadata/${d.pmcid}.${I}.json`, O = await Ge(o, E, R);
      if (!O.ok) {
        O.status !== 404 && O.status !== 403 && (g += 1);
        continue;
      }
      let F = O.body || {};
      $.push({ version: I, manuscript: F.is_manuscript === true, openAccess: F.is_pmc_openaccess === true, license: F.license_code || null, pdf: Kt(F.pdf_url), doi: L(F.doi) });
    }
    if (!$.length) {
      b("pmc-cloud", g ? "error" : "ok", g ? `${g} metadata request(s) failed` : "not in PMC article datasets");
      return;
    }
    $.sort((I, E) => Number(I.manuscript) - Number(E.manuscript) || I.version - E.version);
    let S = 0;
    for (let I of $) d.doi && I.doi && I.doi !== d.doi || (I.pdf && m.add({ url: I.pdf, source: "pmc-cloud", kind: "pdf", license: I.license, version: I.manuscript ? "acceptedVersion" : "publishedVersion", hostType: "repository", note: `PMC article datasets v${I.version}` }) && (S += 1), y.license = y.license || I.license);
    b("pmc-cloud", "ok", `${$.length} version(s); ${S} pdf link(s)`);
  }, "pmcCloud");
  if (await x(), p.has("europepmc") && d.pmcid && C && (C.isOa || C.inEpmc) && (m.add({ url: `https://europepmc.org/articles/${d.pmcid}?pdf=render`, source: "europepmc", kind: "pdf", license: C.isOa ? "open-access" : null, note: "Europe PMC rendered PDF" }), m.add({ url: `https://europepmc.org/backend/ptpmcrender.fcgi?accid=${d.pmcid}&blobtype=pdf`, source: "europepmc", kind: "pdf", license: C.isOa ? "open-access" : null, note: "Europe PMC render backend" })), p.has("unpaywall") && d.doi) if (!f) b("unpaywall", "skipped", "no contact email (set DRONE_CONTACT_EMAIL)");
  else {
    let $ = `https://api.unpaywall.org/v2/${encodeURIComponent(d.doi)}?email=${encodeURIComponent(f)}`, g = await Ge(o, $, R);
    if (!g.ok) b("unpaywall", g.status === 404 ? "ok" : "error", g.detail);
    else {
      let S = g.body || {};
      y.oaStatus = S.oa_status || y.oaStatus;
      let I = [S.best_oa_location, ...Array.isArray(S.oa_locations) ? S.oa_locations : []].filter(Boolean), E = 0;
      for (let O of I) m.add({ url: O.url_for_pdf, source: "unpaywall", kind: "pdf", license: O.license || null, version: O.version || null, hostType: O.host_type || null }) && (E += 1), y.license = y.license || O.license || null;
      b("unpaywall", "ok", `is_oa=${S.is_oa === true}; oa_status=${S.oa_status || "?"}; ${E} pdf link(s)`);
    }
  }
  if (p.has("openalex") && d.doi) {
    let $ = `https://api.openalex.org/works/doi:${encodeURIComponent(d.doi)}${f ? `?mailto=${encodeURIComponent(f)}` : ""}`, g = await Ge(o, $, R);
    if (!g.ok) b("openalex", g.status === 404 ? "ok" : "error", g.detail);
    else {
      let S = g.body || {};
      y.oaStatus = y.oaStatus || S.open_access?.oa_status || null;
      let I = [S.best_oa_location, ...Array.isArray(S.locations) ? S.locations : []].filter((O) => O && O.is_oa !== false), E = 0;
      for (let O of I) m.add({ url: O.pdf_url, source: "openalex", kind: "pdf", license: O.license || null, version: O.version || null, hostType: O.source?.type || null }) && (E += 1);
      d.pmcid == null && S.ids?.pmcid && (d.pmcid = ie(String(S.ids.pmcid).split("/").pop())), b("openalex", "ok", `is_oa=${S.open_access?.is_oa === true}; ${E} pdf link(s)`);
    }
  }
  if (p.has("semanticscholar") && d.doi) {
    let $ = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(d.doi)}?fields=openAccessPdf,externalIds,isOpenAccess`, g = await Ge(o, $, R);
    if (!g.ok) b("semanticscholar", g.status === 404 ? "ok" : "error", g.detail);
    else {
      let S = g.body || {}, I = m.add({ url: S.openAccessPdf?.url, source: "semanticscholar", kind: "pdf", license: S.openAccessPdf?.license || null, note: S.openAccessPdf?.status || null });
      !d.pmcid && S.externalIds?.PubMedCentral && (d.pmcid = ie(S.externalIds.PubMedCentral));
      let E = S.externalIds?.ArXiv;
      E && /^[0-9]{4}\.[0-9]{4,5}(v\d+)?$/.test(String(E)) && m.add({ url: `https://arxiv.org/pdf/${E}`, source: "semanticscholar", kind: "pdf", note: "arXiv" }), b("semanticscholar", "ok", `isOpenAccess=${S.isOpenAccess === true}; ${I ? 1 : 0} pdf link(s)`);
    }
  }
  if (p.has("crossref") && d.doi) {
    let $ = `https://api.crossref.org/works/${encodeURIComponent(d.doi)}${f ? `?mailto=${encodeURIComponent(f)}` : ""}`, g = await Ge(o, $, R);
    if (!g.ok) b("crossref", g.status === 404 ? "ok" : "error", g.detail);
    else {
      let S = g.body?.message || {}, I = 0;
      for (let E of Array.isArray(S.link) ? S.link : []) String(E["content-type"] || "").toLowerCase() === "application/pdf" && m.add({ url: E.URL, source: "crossref", kind: "pdf", license: Array.isArray(S.license) && S.license[0]?.URL || null, note: E["intended-application"] || null }) && (I += 1);
      b("crossref", "ok", `${I} publisher pdf link(s)`);
    }
  }
  return await x(), { ...d, title: y.title, oaStatus: y.oaStatus, license: y.license, candidates: m.candidates, queried: h };
}
s(vt, "resolveOpenAccess");
var nc = { resolveOpenAccess: vt, contactEmail: Jt, normalizePmcid: ie, normalizePmid: ye, pmcCloudHttps: Kt, OA_SOURCES: Vt };
var ia = {};
Z(ia, { createResearchReceiptJournal: () => Xt });
var na = {};
Z(na, { CORE_RESEARCH_RECEIPT_TOOLS: () => bn, ReceiptJournalBuffer: () => Ye, receiptBelongsToRun: () => Yt, shouldRecordResearchReceipt: () => Gt });
var bn = ["bash", "powershell", "webfetch", "fetch_content", "web_search", "research_read_knowledge", "research_search_knowledge", "research_verify_literature", "research_reconcile_literature", "research_archive_source", "read"];
function Gt(e, t = () => false) {
  let r = typeof e.toolName == "string" ? e.toolName : "";
  return e.isError && r !== "bash" && r !== "powershell" ? false : bn.includes(r) || t(r);
}
s(Gt, "shouldRecordResearchReceipt");
var Ye = class {
  static {
    s(this, "ReceiptJournalBuffer");
  }
  capacity;
  entries = [];
  seen = /* @__PURE__ */ new Set();
  evictedCount = 0;
  constructor({ capacity: t = 256 } = {}) {
    if (!Number.isInteger(t) || t < 1) throw new Error("Receipt journal capacity must be a positive integer");
    this.capacity = t;
  }
  add(t) {
    let r = typeof t.toolCallId == "string" ? t.toolCallId : null;
    return r && this.seen.has(r) ? false : (r && this.seen.add(r), this.entries.length >= this.capacity && (this.entries.shift(), this.evictedCount += 1), this.entries.push(t), true);
  }
  values() {
    return this.entries.slice();
  }
  get evicted() {
    return this.evictedCount;
  }
  snapshot() {
    return { scope: "current-session-current-turn", buffered: this.entries.length, evicted: this.evictedCount };
  }
  clear() {
    this.entries.length = 0, this.seen.clear(), this.evictedCount = 0;
  }
};
function Yt(e, t, r) {
  let n = e.args?.run_dir || e.details?.run_dir;
  return !n || ra(t, String(n)) === ra(t, r);
}
s(Yt, "receiptBelongsToRun");
function aa(e, t) {
  let r = e.tail.then(t);
  return e.tail = r.then(() => {
  }, () => {
  }), r;
}
s(aa, "serial");
async function sa(e, t, r) {
  if (t.boundRun && t.boundRun !== r) return null;
  let { cwd: n, sessionId: o, ports: a } = e, c = { ...t, cwd: n, runDir: r, sessionId: o };
  return Yt(t, n, r) ? (await a.observeExecution(c), a.observeResearch(c)) : t.boundRun ? a.observeResearch({ ...c, isError: true, details: {} }) : null;
}
s(sa, "forward");
async function oa(e, t) {
  let { cwd: r, ports: n, owners: o, owner: a, runs: c, buffer: l } = e, { run_dir: i } = await n.status(r, t);
  if (o.has(i) && o.get(i) !== a) throw new Error("Research run is owned by another active session/turn; create a separate run");
  if (!c.has(i)) {
    o.set(i, a), await n.flush(r, i), n.reset(r, i), c.add(i);
    for (let u of l.values()) await sa(e, u, i);
  }
  e.currentRun = i;
}
s(oa, "attach");
function ac(e, t) {
  let { cwd: r, ports: n } = e;
  if (!e.active || !t.countedStep && !Gt(t, n.isJournalTool)) return Promise.resolve(null);
  let o = t.toolName === "research_read_knowledge" ? n.workspace(r).then(async (c) => ({ vault: c.obsidianVault ? await oc(c.obsidianVault) : null, revision: c.knowledgeBindingRevision || 0 })).catch(() => ({ vault: null, revision: -1 })) : void 0, a = { ...structuredClone(t), sessionId: e.sessionId, observedAt: (/* @__PURE__ */ new Date()).toISOString(), boundRun: t.countedStep ? e.currentRun : void 0 };
  return aa(e, async () => !e.active || !e.buffer.add(a) ? null : (a.readBinding = await o, e.currentRun ? sa(e, a, e.currentRun) : null));
}
s(ac, "record");
function Xt(e, { sessionId: t = null, ports: r }) {
  let n = { cwd: e, sessionId: t, ports: r, owners: r.owners ?? /* @__PURE__ */ new Map(), owner: Symbol("research-turn"), buffer: new Ye(), runs: /* @__PURE__ */ new Set(), active: true, tail: Promise.resolve() };
  return { currentRun: s(() => n.currentRun, "currentRun"), record: s((o) => ac(n, o), "record"), execute(o, a) {
    return aa(n, async () => {
      if (!n.active) throw new Error("Research turn has ended");
      o && await oa(n, o);
      let c = await a();
      typeof c.run_dir == "string" && await oa(n, c.run_dir);
      let l = typeof c.run_dir == "string" ? await r.status(e, c.run_dir) : c;
      return { ...c, ...l, receipt_journal: n.buffer.snapshot() };
    });
  }, async close() {
    n.active = false, await n.tail;
    for (let o of n.runs) await r.flush(e, o), n.owners.get(o) === n.owner && (r.reset(e, o), n.owners.delete(o));
    n.runs.clear(), n.buffer.clear();
  } };
}
s(Xt, "createResearchReceiptJournal");
var ua = {};
Z(ua, { DEFAULT_MAX_BYTES: () => Xe, DEFAULT_TIMEOUT_MS: () => Qe, SOURCE_CATEGORIES: () => ge, cloudflareAskCopy: () => la, hasMagic: () => vn, isWithin: () => ee, looksLikeChallenge: () => er, looksLikeCloudflare: () => Re, normalizeMetadata: () => rr, safeFilename: () => be, validateContent: () => tr, validateRunDir: () => we });
var ge = ["papers", "supplementary", "software", "manuals"];
var Xe = 50 * 1024 * 1024;
var Qe = 3e4;
function ee(e, t) {
  let r = ca(Qt(e), Qt(t));
  return r === "" || !ic(r) && !r.startsWith(`..${Rn}`) && r !== ".." && !r.includes(`..${Rn}`);
}
s(ee, "isWithin");
function we(e, t) {
  let r = Qt(t), n = ca(Qt(e), r), o = n.split(Rn);
  if (!n || !ee(e, r) || o.length !== 2 || !o[1]?.startsWith("run-")) throw new Error("run_dir must point to a run directory directly inside the configured results root");
  return r;
}
s(we, "validateRunDir");
function be(e, t) {
  let r = String(e || "").trim(), n = [...sc(r)].map((o) => o.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(o) ? "-" : o).join("").replace(/\s+/g, " ").trim();
  return !n || n === "." || n === ".." ? t : n.slice(0, 180);
}
s(be, "safeFilename");
function er(e, t, r) {
  return [401, 403, 407, 429].includes(e) ? true : t.toLowerCase().includes("text/html") ? /cf-chl|cloudflare|captcha|verify you are human|access denied|sign in|log in|login required/i.test(r) : false;
}
s(er, "looksLikeChallenge");
var cc = /cf-chl|challenge-platform|just a moment|checking your browser/i;
function Re(e, t) {
  return lc(e, "cf-mitigated") ? true : cc.test(t ?? "");
}
s(Re, "looksLikeCloudflare");
function lc(e, t) {
  if (!e || typeof e != "object") return "";
  let r = e;
  if (typeof r.get == "function") return String(r.get(t) ?? "").trim();
  for (let [n, o] of Object.entries(e)) if (n.toLowerCase() === t.toLowerCase()) return String(o ?? "").trim();
  return "";
}
s(lc, "headerValue");
function la() {
  return String(process.env.DRONE_REPLY_LANGUAGE || "").toLowerCase().startsWith("zh") ? { title: "\u9700\u8981\u4F60\u5B8C\u6210\u6D4F\u89C8\u5668\u9A8C\u8BC1", body: "\u8FD9\u662F Cloudflare \u4EBA\u673A\u9A8C\u8BC1\u3002\u8BF7\u5728\u5DF2\u7ECF\u6253\u5F00\u7684\u7A97\u53E3\u91CC\u5B8C\u6210\uFF0C\u7A0B\u5E8F\u4E0D\u4F1A\u7ED5\u8FC7\u3002", continueLabel: "\u6211\u5DF2\u5B8C\u6210\uFF0C\u7EE7\u7EED", skipLabel: "\u8DF3\u8FC7\u8FD9\u4E2A\u6765\u6E90", retryNote: "\u8BF7\u91CD\u65B0\u8BFB\u53D6\u540C\u4E00\u9875\u9762\uFF0C\u4E0D\u8981\u7ED5\u8FC7\uFF0C\u521A\u624D\u7684\u6311\u6218\u9875\u4E0D\u662F\u8BC1\u636E", skipNote: "\u5DF2\u8DF3\u8FC7\u8FD9\u4E2A\u6765\u6E90\u3002\u6311\u6218\u9875\u4E0D\u662F\u8BC1\u636E\uFF0C\u4E0D\u8981\u91CD\u8BD5\uFF0C\u4E5F\u4E0D\u8981\u7ED5\u8FC7\u3002" } : { title: "Browser verification needed", body: "This is a Cloudflare human check. Finish it in the browser window that is already open. The program will not bypass it.", continueLabel: "I've finished, continue", skipLabel: "Skip this source", retryNote: "Re-read the same page. Do not bypass it. The challenge page you just saw is not evidence.", skipNote: "This source was skipped. The challenge page is not evidence. Do not retry and do not bypass it." };
}
s(la, "cloudflareAskCopy");
function vn(e) {
  return e.length >= 5 && new TextDecoder().decode(e.subarray(0, 5)) === "%PDF-" || e.length >= 4 && e[0] === 80 && e[1] === 75 && (e[2] === 3 || e[2] === 5 || e[2] === 7) ? true : e.length >= 2 && e[0] === 31 && e[1] === 139;
}
s(vn, "hasMagic");
function tr(e, t, r, n) {
  let o = t.toLowerCase().split(";", 1)[0]?.trim() ?? "", a = new TextDecoder().decode(n.subarray(0, 16));
  return /\.(?:exe|dll|msi|com|bat|cmd|ps1|sh)$/i.test(r) || /application\/(?:x-msdownload|x-dosexec)/.test(o) ? { ok: false, reason: "executable content is not archived" } : e === "papers" && !a.startsWith("%PDF-") ? { ok: false, reason: "papers must be PDF content" } : e === "supplementary" && !(o.includes("pdf") || o.includes("zip") || o.includes("gzip") || vn(n)) ? { ok: false, reason: "unsupported supplementary MIME or file signature" } : e === "software" && o === "text/html" ? { ok: false, reason: "HTML is not a software archive" } : e === "manuals" && !o && !n.length ? { ok: false, reason: "empty manual content" } : { ok: true, mime: o };
}
s(tr, "validateContent");
function rr(e = {}) {
  return Object.fromEntries(["doi", "pmid", "pmcid", "commit", "version", "license", "title", "authors", "repository", "open_access"].filter((r) => e[r] != null && String(e[r]).trim() !== "").map((r) => [r, e[r]]));
}
s(rr, "normalizeMetadata");
var tt = Object.freeze(["created", "local_query_recorded", "external_search_recorded", "sources_inspected", "sources_archived", "sources_reused", "claims_bound", "answerable"]);
var et = "drone.research.run";
function H(e) {
  return tt.indexOf(e);
}
s(H, "stageIndex");
function ve(e, t, r) {
  if (H(e.stage) < H(t)) throw new Error(`research loop must reach ${t} before ${r}`);
}
s(ve, "requireStage");
function nr(e, t) {
  let r = String(e ?? "").trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(r)) throw new Error(`${t} must be lowercase kebab-case`);
  return r;
}
s(nr, "safeSlug");
function kn(e) {
  let t = nr(e || "research-question", "result_slug");
  return t.replace(/-20\d{6}(?:\d{6})?$/, "").replace(/-run-\d+$/, "") || t;
}
s(kn, "topicIdFromResultSlug");
function kt(e) {
  return uc("sha256").update(e).digest("hex");
}
s(kt, "fileHash");
function A(e) {
  return e && typeof e == "object" && !Array.isArray(e) ? e : {};
}
s(A, "recordOf");
function ke(e) {
  let t = e.evidence_gate, r = Array.isArray(t?.claim_refs) ? t.claim_refs : [], n = Array.isArray(t?.claim_bindings) ? t.claim_bindings : [];
  return { stage: t?.stage && tt.includes(t.stage) ? t.stage : "created", status: t?.status === "failed" ? "failed" : "ok", answerable: t?.answerable === true, events: Array.isArray(t?.events) ? t.events : [], claim_refs: r, claim_bindings: n, warnings: r.length && !n.length ? ["legacy-unstructured-claims: support not assessed"] : [], source_refs: Array.isArray(t?.source_refs) ? t.source_refs : [], archive_count: Number(t?.archive_count) || 0, reuse_count: Number(t?.reuse_count) || 0, reused_sources: Array.isArray(t?.reused_sources) ? t.reused_sources : [], scientificallyVerified: false };
}
s(ke, "gateOf");
function _n(e) {
  let t = H(e.stage);
  return tt.map((r, n) => ({ id: r, state: e.answerable || n < t ? "completed" : n === t ? "current" : "pending", observed: e.events.some((o) => o?.type === r && !o.skipped) }));
}
s(_n, "researchNodes");
function xn(e, t) {
  return { status: e.answerable ? "host-verified" : "pending", source_refs: [...e.source_refs], claim_bindings: structuredClone(e.claim_bindings), updated_at: t };
}
s(xn, "provenanceFor");
function B(e, t, r, n = {}) {
  let o = H(t) < H(e.stage);
  return { ...e, stage: o ? e.stage : t, events: [...e.events, { type: t, at: r, ...o ? { repeated: true } : {}, ...n }] };
}
s(B, "advance");
async function Sn(e) {
  if (!(await pc(e)).isFile()) throw new Error("Expected a regular research metadata file");
  let t = JSON.parse(await da(e, "utf8"));
  if (!t || typeof t != "object" || Array.isArray(t)) throw new Error(`Invalid JSON object: ${e}`);
  let r = t;
  if (!r.kind) return { ...r, kind: et, version: 1 };
  if (r.kind !== et || r.version !== 1) throw new Error(`Unsupported research metadata document: ${e}`);
  return r;
}
s(Sn, "readResearchMetadata");
async function Cn(e, t) {
  let r = `${JSON.stringify(t, null, 2)}
`, n = `${e}.${dc()}.tmp`;
  try {
    await hc(n, r, { flag: "wx" }), await fc(n, e);
  } finally {
    await mc(n, { force: true });
  }
  if (await da(e, "utf8") !== r) throw new Error("Research metadata readback differed");
}
s(Cn, "writeResearchMetadata");
function _t(e) {
  return typeof e.revision == "number" && Number.isSafeInteger(e.revision) ? e.revision : 0;
}
s(_t, "revisionOf");
var nt = Object.freeze({ maxSteps: 20, maxStalledSteps: 3, maxRepeats: 2, maxSpecialists: 4, maxEvidenceSources: 12, requireConfirmedQuota: true });
function An(e = 0) {
  return { measured: { steps: 0, stalledSteps: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, billedTokens: 0, cost: 0, usageReported: false, unknownUsageSteps: 0 }, repeats: {}, observedStage: e, specialistRuns: 0, contextPressure: { evictionCount: 0, evictedToolCallIds: 0, lastEvictedAt: null } };
}
s(An, "newSlowPath");
function rt(e) {
  return typeof e == "number" && Number.isSafeInteger(e) && e >= 0 ? e : void 0;
}
s(rt, "tokens");
function pa(e) {
  return typeof e == "number" && Number.isFinite(e) && e >= 0 ? e : void 0;
}
s(pa, "costValue");
function or(e = {}) {
  return { ...nt, maxBilledTokens: rt(e.maxBilledTokens) || null, maxCost: pa(e.maxCost) || null };
}
s(or, "breakerLimits");
var En = { reason: "quota-unconfirmable", limitKind: "unknown-quota" };
function In(e) {
  let t = or(e);
  return t.maxBilledTokens === null || e?.maxCost !== void 0 && t.maxCost === null ? En : void 0;
}
s(In, "quotaTrip");
function Tn(e, t, r) {
  let n = or(t), { steps: o, billedTokens: a, cost: c } = e.measured;
  if (n.maxBilledTokens !== null && a >= n.maxBilledTokens) return { reason: "budget-exceeded", limitKind: "tokens" };
  if (n.maxCost !== null && c >= n.maxCost) return { reason: "budget-exceeded", limitKind: "cost" };
  if (o >= n.maxSteps) return { reason: "budget-exceeded", limitKind: "steps" };
  if (e.specialistRuns >= n.maxSpecialists) return { reason: "budget-exceeded", limitKind: "specialists" };
  if (r >= n.maxEvidenceSources) return { reason: "budget-exceeded", limitKind: "evidence" };
}
s(Tn, "budgetTrip");
function fa(e, t, r) {
  let n = rt(r.inputTokens), o = rt(r.outputTokens), a = rt(r.cacheWriteTokens), c = pa(r.cost);
  if (r.reported !== true || n === void 0 || o === void 0 || a === void 0) return { state: { ...e, measured: { ...e.measured, usageReported: false, unknownUsageSteps: e.measured.unknownUsageSteps + 1 } }, trip: En };
  let l = e.measured, i = { ...l, inputTokens: l.inputTokens + n, outputTokens: l.outputTokens + o, cacheReadTokens: l.cacheReadTokens + (rt(r.cacheReadTokens) ?? 0), cacheWriteTokens: l.cacheWriteTokens + a, billedTokens: l.billedTokens + n + o + a, cost: l.cost + (c ?? 0), usageReported: true, unknownUsageSteps: l.unknownUsageSteps + +(t?.maxCost !== void 0 && c === void 0) }, u = { ...e, measured: i, specialistRuns: e.specialistRuns + (rt(r.specialistRuns) ?? 0) }, d = t?.maxCost !== void 0 && c === void 0 ? En : In(t);
  return { state: u, trip: d };
}
s(fa, "observeUsage");
function yc({ toolName: e, args: t = {} }) {
  let r = ["action", "path", "note_path", "url", "query", "doi", "zotero_key", "command", "source_id"].flatMap((n) => {
    let o = t[n];
    if (typeof o != "string") return [];
    let a = o.normalize("NFKC").trim();
    return [n, n === "query" || n === "doi" ? a.toLowerCase().replace(/\s+/g, " ") : a];
  });
  return kt(JSON.stringify([e, r]));
}
s(yc, "targetKey");
function ma(e, t, r) {
  let n = yc(t), o = (e.repeats[n] ?? 0) + 1, a = r ? 0 : e.measured.stalledSteps + 1, c = { ...e, measured: { ...e.measured, steps: e.measured.steps + 1, stalledSteps: a }, repeats: { ...e.repeats, [n]: o } };
  return o > nt.maxRepeats ? { state: c, trip: { reason: "repeated-tool-loop", limitKind: "repeats" } } : a >= nt.maxStalledSteps ? { state: c, trip: { reason: "stalled", limitKind: "stall" } } : { state: c };
}
s(ma, "observeSlowPathStep");
function ha(e, t) {
  let r = new Set(t.toolCallIds.filter((n) => typeof n == "string" && n).slice(0, 64)).size;
  return r ? { ...e, contextPressure: { evictionCount: e.contextPressure.evictionCount + 1, evictedToolCallIds: e.contextPressure.evictedToolCallIds + r, lastEvictedAt: t.observedAt } } : e;
}
s(ha, "observeContextEviction");
function ya(e, t, r, n, o) {
  let a = or(r), c = e.reason !== "quota-unconfirmable";
  return { ...e, ...n, version: 1, kind: "drone.research.breaker-receipt", mode: "deep_research", limits: a, measured: { ...t.measured, remainingTokens: c && a.maxBilledTokens !== null ? Math.max(0, a.maxBilledTokens - t.measured.billedTokens) : null, remainingCost: c && a.maxCost !== null ? Math.max(0, a.maxCost - t.measured.cost) : null }, contextPressure: { ...t.contextPressure }, preservedProgress: o, nextAction: "Stop research tools and review the preserved evidence and budget before starting another run.", scientificallyVerified: false };
}
s(ya, "breakerReceipt");
var oe = s((e) => gc("sha256").update(e).digest("hex"), "summaryHash");
var ga = s((e) => `${e.trim()}
`, "summaryBody");
function wa(e, t) {
  if (e === void 0) return [];
  if (!Array.isArray(e) || e.length > 24) throw new Error("Provide at most 24 summary memory claims");
  let r = /* @__PURE__ */ new Set();
  return e.map((n) => {
    if (!n || typeof n != "object") throw new Error("Invalid summary memory claim");
    let o = t.claims.find((l) => n.bindingId ? l.id === n.bindingId : l.claim === n.claim);
    if (!o) throw new Error("Summary memory claim is not bound to this research run");
    if (r.has(o.id)) throw new Error("Provide one memory claim per bindingId");
    r.add(o.id);
    let a = o.sources.find((l) => l.path === n.sourcePath && l.hash === n.sourceHash);
    if (!a) throw new Error("Summary memory claim source/hash differs from the bound evidence");
    for (let l of ["subject", "predicate"]) if (typeof n[l] != "string" || !n[l].trim() || n[l].length > 180) throw new Error(`Invalid memory claim ${l}`);
    if (!["observation", "interpretation", "hypothesis"].includes(n.relation)) throw new Error("Invalid memory claim relation");
    let c = { bindingId: o.id, claim: o.claim, subject: n.subject, predicate: n.predicate, sourcePath: a.path, sourceHash: a.hash, startLine: a.start_line, endLine: a.end_line, location: `${a.start_line}-${a.end_line}`, limitations: o.limitations, relation: o.relationship === "hypothesis" || o.relationship === "unsupported" ? "hypothesis" : n.relation, deliveryBodySha256: t.bodySha256 };
    for (let l of ["value", "organism", "tissue", "stage", "method", "direction", "endpoint", "unit"]) if (n[l] !== void 0) {
      if (typeof n[l] != "string" || n[l].length > 600) throw new Error(`Invalid memory claim ${l}`);
      c[l] = n[l];
    }
    if (n.effect !== void 0) {
      if (!Number.isFinite(n.effect)) throw new Error("Invalid memory claim effect");
      c.effect = n.effect;
    }
    return c;
  });
}
s(wa, "deliveryMemoryClaims");
function ba(e, t) {
  let r = [...e.body.matchAll(/\S[\s\S]*?(?=\n\s*\n|$)/g)].map((a, c) => ({ blockId: `block-${c + 1}`, text: a[0], start: a.index, end: a.index + a[0].length, proposedClaimIds: e.claims.map((l) => l.id) })), n = { version: 1, body: e.body, bodySha256: e.bodySha256, gateSha256: e.gateSha256, claimsSha256: e.claimsSha256, evidenceRevision: e.evidenceRevision, blocks: r, claims: e.claims, readReceipts: e.readReceipts, memoryClaims: t.map((a) => ({ ...a, memoryClaimSha256: oe(JSON.stringify(a)) })) }, o = JSON.stringify(n);
  if (Buffer.byteLength(o) > 512 * 1024) throw new Error("Summary evidence packet exceeds 512 KiB; narrow the delivery before review");
  return { ...n, packetSha256: oe(o) };
}
s(ba, "summaryReviewPacket");
function Ra(e, t) {
  if (!e || typeof e != "object") throw new Error("Missing summary semantic assessment");
  let r = e;
  if (r.packetSha256 !== t.packetSha256 || r.bodySha256 !== t.bodySha256) throw new Error("Summary semantic assessment belongs to different body/evidence bytes");
  if (typeof r.provider != "string" || !r.provider.trim() || typeof r.model != "string" || !r.model.trim() || !Array.isArray(r.blocks) || r.blocks.length !== t.blocks.length) throw new Error("Incomplete summary semantic assessment");
  let n = s((i) => {
    let u = t.readReceipts.find((d) => d.receiptId === i.readReceiptId && d.path === i.path && d.sha256 === i.sha256);
    if (!u || !Number.isInteger(i.startLine) || !Number.isInteger(i.endLine) || i.startLine < u.startLine || i.endLine < i.startLine || i.endLine > u.endLine) throw new Error("Summary assessment cites evidence that was not read in this scope");
  }, "validateRead"), o = /* @__PURE__ */ new Set();
  for (let i of r.blocks) {
    if (!i || !t.blocks.some((d) => d.blockId === i.blockId) || o.has(i.blockId) || !["claim", "limitation", "navigation"].includes(i.role) || !["supported", "contradicted", "out-of-scope", "unknown"].includes(i.assessment) || typeof i.reason != "string" || !i.reason.trim() || !Array.isArray(i.claimIds) || !Array.isArray(i.evidence)) throw new Error("Invalid summary block assessment");
    o.add(i.blockId);
    let u = i.claimIds.map((d) => {
      let p = t.claims.find((f) => f.id === d);
      if (!p) throw new Error("Summary block references an unknown claim");
      return p;
    });
    if (!u.length) throw new Error("Every summary block requires a valid claim mapping");
    for (let d of i.evidence) n(d);
    if (i.assessment === "supported") for (let d of u) {
      if (d.relationship !== "direct" && d.relationship !== "indirect") continue;
      let p = false;
      for (let f of i.evidence) d.sources.some((m) => m.path === f.path && m.hash === f.sha256 && f.startLine >= m.start_line && f.endLine <= m.end_line) && (p = true);
      if (!p) throw new Error(`Summary factual block lacks evidence from its mapped claim: ${d.id}`);
    }
  }
  if (!Array.isArray(r.memoryClaims) || r.memoryClaims.length !== t.memoryClaims.length) throw new Error("Incomplete summary memory claim assessment");
  let a = /* @__PURE__ */ new Set();
  for (let i of r.memoryClaims) {
    let u = t.memoryClaims.find((d) => d.bindingId === i.bindingId);
    if (!u || a.has(i.bindingId) || i.memoryClaimSha256 !== u.memoryClaimSha256 || !["supported", "contradicted", "out-of-scope", "unknown"].includes(i.assessment) || typeof i.reason != "string" || !i.reason.trim() || !Array.isArray(i.evidence)) throw new Error("Invalid summary memory claim assessment or object hash");
    a.add(i.bindingId);
    for (let d of i.evidence) n(d);
    if (i.assessment === "supported") {
      let d = i.evidence.filter((f) => f.path === u.sourcePath && f.sha256 === u.sourceHash && f.startLine >= u.startLine && f.endLine <= u.endLine).sort((f, m) => f.startLine - m.startLine), p = u.startLine;
      for (let f of d) {
        if (f.startLine > p) break;
        p = Math.max(p, f.endLine + 1);
      }
      if (p <= u.endLine) throw new Error(`Summary memory claim lacks complete evidence from its bound source: ${u.bindingId}`);
    }
  }
  let c = r.blocks.filter((i) => i.assessment !== "supported");
  if (c.length) throw new Error(`Summary semantic review is unresolved: ${c.map((i) => `${i.blockId} ${i.assessment}: ${i.reason}`).join("; ")}`);
  let l = r.memoryClaims.filter((i) => i.assessment !== "supported");
  if (l.length) throw new Error(`Summary memory claim review is unresolved: ${l.map((i) => `${i.bindingId} ${i.assessment}: ${i.reason}`).join("; ")}`);
  return { status: "model-assessed", packetSha256: t.packetSha256, bodySha256: t.bodySha256, provider: r.provider, model: r.model, blocks: r.blocks, memoryClaims: r.memoryClaims, ...r.usage === void 0 ? {} : { usage: r.usage } };
}
s(Ra, "validateSummaryAssessment");
var _e = Object.freeze({ targetMinSteps: 3, maxSteps: 5, maxLocalSearches: 2, maxReads: 3, maxVerifications: 2 });
var ar = ["no_local_hits", "source_stale_or_changed", "conflict_detected", "original_fulltext_missing", "write_or_archive_required", "step_cap_reached", "explicit_deep_request"];
var va = Object.freeze(["research_search_knowledge", "research_read_knowledge", "research_verify_literature", "research_reconcile_literature", "research_loop"]);
var ka = Object.freeze(["research_archive_source", "research_zotero_save", "research_deposit_knowledge", "research_deposit_research_note", "webfetch", "web_search", "fetch_content", "write", "edit"]);
function _a() {
  return { stepsUsed: 0, localSearches: 0, reads: 0, verifications: 0, escalation_required: false };
}
s(_a, "newFastPath");
function xa(e) {
  switch (e) {
    case "research_search_knowledge":
      return ["localSearches", _e.maxLocalSearches];
    case "research_read_knowledge":
      return ["reads", _e.maxReads];
    case "research_verify_literature":
    case "research_reconcile_literature":
      return ["verifications", _e.maxVerifications];
    default:
      return null;
  }
}
s(xa, "limitFor");
function xt({ toolName: e, args: t }) {
  return ka.includes(e) || !va.includes(e) ? false : e !== "research_loop" || !["record_external", "verify_archive"].includes(String(t?.action));
}
s(xt, "fastPathAllows");
function sr(e, t) {
  let r = xa(t);
  return e.stepsUsed >= _e.maxSteps || r !== null && e[r[0]] >= r[1];
}
s(sr, "fastPathAtLimit");
function Pn(e, t) {
  let r = xa(t);
  return { ...e, stepsUsed: e.stepsUsed + 1, ...r ? { [r[0]]: e[r[0]] + 1 } : {} };
}
s(Pn, "countFastPathStep");
function On(e, t) {
  return e.escalation_required ? e : { ...e, escalation_required: true, reason: t };
}
s(On, "requireEscalation");
function ir(e) {
  return `Fast path escalation required (${e}). Call research_loop(action="escalate", reason="${e}").`;
}
s(ir, "escalationGuidance");
function Sa(e) {
  let t = ar.find((r) => r === e);
  if (!t) throw new Error("A valid fast path escalation reason is required");
  return t;
}
s(Sa, "parseEscalationReason");
function Ca(e, t) {
  if (e === "research_search_knowledge" && t.complete !== false && Array.isArray(t.hits) && t.hits.length === 0) return "no_local_hits";
  if (e === "research_read_knowledge" && t.missing === true) return "source_stale_or_changed";
  if (e === "research_verify_literature" || e === "research_reconcile_literature") {
    let r = e === "research_reconcile_literature" ? A(t.receipt) : t, n = A(r.obsidian).status;
    if (n === "missing") return "source_stale_or_changed";
    if (n === "identity-mismatch" || A(r.zotero).status === "identity-mismatch") return "conflict_detected";
  }
}
s(Ca, "fastPathReceiptReason");
function Ea(e, t, r, n, o, a) {
  if (t.stepsUsed >= _e.maxSteps) throw new Error(ir("step_cap_reached"));
  if (!r.length) throw new Error("Fast path needs a current-turn identity-verified local source");
  let c = Je(n, r, o), l = Le(c), i = r.map((f) => f.path), u = B({ ...e, source_refs: i }, "sources_inspected", a, { source_refs: i }), d = B({ ...u, reuse_count: r.length, reused_sources: [...r] }, "sources_reused", a), p = B({ ...d, claim_bindings: c, claim_refs: l, warnings: [] }, "claims_bound", a);
  return B({ ...p, status: "ok", answerable: true }, "answerable", a);
}
s(Ea, "completeFastPath");
var rs = {};
Z(rs, { RESEARCH_DOCUMENT_KIND: () => et, RESEARCH_STAGES: () => tt, createResearchLoop: () => fr });
var Rc = { "no-available-source": "No current verified source was available.", "archive-verify-failed": "An archived source failed verification.", "reused-source-changed": "A reused source changed or lost its current-turn read receipt.", "missing-provenance-manifest": "The run requires a valid reproducibility manifest." };
var vc = { stalled: "Research stopped after several steps without new evidence progress.", "budget-exceeded": "Research stopped after reaching its configured limit.", "quota-unconfirmable": "Research stopped because the remaining quota could not be confirmed.", "repeated-tool-loop": "Research stopped after repeatedly using the same tool and target." };
var Ln = Symbol("research-loop failure code");
var kc = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function Aa(e) {
  return kc.test(e) ? e : wc("sha256").update(e).digest("hex");
}
s(Aa, "opaqueReceiptId");
function Ia(e) {
  return /^run-\d{14}-[a-f0-9]{8}$/i.test(e) ? { runId: e } : {};
}
s(Ia, "runReference");
function Ta(e) {
  let t = Aa(e.id);
  return { failureCode: `breaker:${e.reason}`, subject: "Research limits", scopeKind: "project", summary: vc[e.reason], provenance: { sourcePlugin: "drone-pi-research", producer: "research-loop", ...Ia(e.runId), receiptId: t, breakerReceiptId: t } };
}
s(Ta, "breakerFailureCandidate");
function _c(e, t, r) {
  return { failureCode: e, subject: "Research evidence gate", scopeKind: "project", summary: Rc[e], provenance: { sourcePlugin: "drone-pi-research", producer: "research-loop", ...Ia(t), receiptId: Aa(r) } };
}
s(_c, "researchFailureCandidate");
async function $n(e, t) {
  try {
    await e.record(t);
  } catch {
    return;
  }
}
s($n, "recordFailureCandidate");
function De(e, t) {
  return Object.assign(new Error(t), { [Ln]: e });
}
s(De, "researchFailure");
async function Pa(e, t, r) {
  if (!e || t.mode === "fast_readonly" || !(r instanceof Error) || !(Ln in r)) return;
  let { [Ln]: n } = r;
  await $n(e, _c(n, t.run_id, bc()));
}
s(Pa, "recordResearchFailure");
function Na(e, t) {
  let r = e.get(t);
  if (r) return r;
  let n = e.keys().next();
  e.size >= 128 && !n.done && e.delete(n.value);
  let o = { reads: /* @__PURE__ */ new Map(), verified: /* @__PURE__ */ new Map(), readCount: 0 };
  return e.set(t, o), o;
}
s(Na, "ledgerFor");
async function Ne(e) {
  let { config: t, ledger: r } = e;
  if (!t.obsidianVault || !r.verified.size) return [];
  let n = await St(t.obsidianVault), o = [];
  for (let [a, c] of r.verified) {
    let l = r.reads.get(a) || [], i = l.at(-1);
    if (!i || i.hash !== c.hash || i.vault !== n || c.vault !== n || i.revision !== (t.knowledgeBindingRevision || 0)) continue;
    let u = await e.ports.verifyLiteratureReceipt({ doi: c.doi, zotero_key: c.zoteroKey, note_path: a, vault: n });
    if (u.status !== "both-verified" || u.obsidian.hash !== i.hash || u.obsidian.vault !== n) continue;
    let { startLine: d, endLine: p } = i, f = u.zotero.fulltextStatus;
    o.push({ path: a, hash: i.hash, doi: u.doi, zotero_key: u.zoteroKey, startLine: d, endLine: p, basis: "current-turn-literature-note-read-and-identity-check", fulltext_status: f, originalFulltextReadThisTurn: false, evidence_profile: { identity: "both-verified", acquisition: f, reading: { kind: "literature-note", scope: "current-turn", startLine: d, endLine: p }, read_receipts: l.map(({ receiptId: m, startLine: h, endLine: y }) => ({ id: m, startLine: h, endLine: y })), claimSupport: "not-assessed" } });
  }
  return o;
}
s(Ne, "reusableSources");
async function za(e, t = false) {
  return await e.ports.sourceStatus({ cwd: e.cwd, run_dir: e.path, ...t && { verify: t } });
}
s(za, "archives");
async function ot(e, t, r) {
  ve(t, "sources_inspected", "verify_archive");
  let { verification: n, manifest: o } = await za(e, true);
  if (n && n.ok !== true) {
    let l = n.items?.filter((i) => i.ok !== true) || [];
    throw De("archive-verify-failed", `Archived source verification failed: ${l.map((i) => i.reason || i.path).join(", ") || "unknown"}`);
  }
  let a = (o?.items || []).filter((l) => l.status === "downloaded"), c = r ?? await Ne(e);
  if (!a.length && !c.length) throw De("no-available-source", "No available source: read an existing Library/Papers note this turn and verify its DOI/key with research_verify_literature, or archive an authorized new source. Do not repeat imports to clear this gate.");
  return B({ ...t, archive_count: a.length, reuse_count: c.length, reused_sources: c }, a.length ? "sources_archived" : "sources_reused", (/* @__PURE__ */ new Date()).toISOString(), { archived: a.map(({ id: l, sha256: i, path: u }) => ({ id: l, sha256: i, path: u })), reused_sources: c, scientificallyVerified: false });
}
s(ot, "verifyArchive");
function ja(e, t, r) {
  return /* @__PURE__ */ new Set([t, r, La(e.cwd, r), La(e.path, r)]);
}
s(ja, "aliases");
async function Za(e, t) {
  let r = Oa(e.path, "sources");
  if (!ee(r, t)) return null;
  try {
    let n = await St(r), o = await St(t);
    return n === Oa(await St(e.path), "sources") && ee(n, o) ? o : null;
  } catch (n) {
    if (A(n).code === "ENOENT") return null;
    throw n;
  }
}
s(Za, "verifiedArchivePath");
async function qa(e) {
  let t = [];
  for (let r of (await za(e)).manifest?.items || []) {
    if (r.status !== "downloaded" || !r.path || !r.sha256) continue;
    let n = Da(e.cwd, r.path), o = await Za(e, n);
    if (!(!o || kt(await $a(o)) !== r.sha256)) for (let a of ja(e, r.path, n)) t.push({ path: a, hash: r.sha256, doi: r.metadata?.doi || r.doi, zotero_key: r.metadata?.zotero_key || r.zotero_key });
  }
  return t;
}
s(qa, "archivedSourceRecords");
function Fa(e, t, r) {
  let { reads: n } = e.ledger, o = [...t], l = [...(o.map((i) => n.get(i)).find(Boolean) || []).filter((i) => i.hash === r.hash && i.vault === r.vault && i.revision === r.revision), { ...r, receiptId: xc() }].slice(-16);
  for (let i of o) n.set(i, l);
  e.ledger.readCount += 1;
}
s(Fa, "rememberRead");
async function Ma(e, t, r, n, o) {
  let a = Da(e.cwd, t), c = await Za(e, a);
  if (!c) return false;
  let l = A(n.truncation);
  if (l.firstLineExceedsLimit) return false;
  let i = Array.isArray(o) ? o.find((R) => A(R).type === "text") : void 0, u = l.content ?? A(i).text;
  if (typeof u != "string" || !u.trim()) return false;
  let d = await $a(c), p = d.toString("utf8");
  if (p.includes("\0") || p.startsWith("%PDF-")) return false;
  let f = typeof r.offset == "number" && Number.isInteger(r.offset) && r.offset > 0 ? r.offset : 1, m = p.split(`
`).slice(f - 1, typeof r.limit == "number" && r.limit ? f - 1 + r.limit : void 0), h = [], y = 0;
  for (let [R, C] of u.split(`
`, 2e3).entries()) {
    if (m[R] !== C || y + C.length > 9e4) break;
    h.push(C), y += C.length + 1;
  }
  let b = h.join(`
`);
  return b.trim() ? (Fa(e, ja(e, t, a), { hash: kt(d), text: b, startLine: f, endLine: f + h.length - 1 }), true) : false;
}
s(Ma, "archivedRead");
function Dn(e, t) {
  if (e.reuse_count && (e.reused_sources.length !== e.reuse_count || e.reused_sources.some((r) => !t.some((n) => n.path === r.path && n.hash === r.hash && n.doi === r.doi && n.zotero_key === r.zotero_key)))) throw De("reused-source-changed", "Reused source changed or current-turn receipt is missing; re-read and verify the existing note, do not re-import it");
}
s(Dn, "validateReusedSourceSet");
async function Ua(e, t, r, n) {
  let { hash: o, text: a, startLine: c, endLine: l } = r, { obsidianVault: i, knowledgeBindingRevision: u } = e.config;
  if (!i || !/^Library\/Papers\/.+\.md$/.test(t) || typeof o != "string" || !/^[a-f0-9]{64}$/i.test(o) || typeof a != "string" || !a.trim() || typeof c != "number" || !Number.isInteger(c) || typeof l != "number" || l < c) return;
  let d = A(n), p = n ? typeof d.vault == "string" ? d.vault : null : await St(i), f = n ? typeof d.revision == "number" ? d.revision : -1 : u || 0;
  Fa(e, [t], { hash: o, text: a, vault: p, revision: f, startLine: c, endLine: l });
}
s(Ua, "observeNote");
function Ha(e, t) {
  let r = A(t.obsidian), n = A(t.zotero), { path: o, hash: a, vault: c } = r, { doi: l, zoteroKey: i } = t;
  return t.status !== "both-verified" || r.status !== "verified" || n.status !== "verified" || typeof o != "string" || !/^Library\/Papers\/.+\.md$/.test(o) || typeof a != "string" || typeof c != "string" || typeof l != "string" || typeof i != "string" ? false : (e.ledger.verified.set(o, { doi: l, zoteroKey: i, hash: a, vault: c }), true);
}
s(Ha, "rememberIdentity");
function Ba(e, t) {
  let r = /* @__PURE__ */ new Map();
  for (let n of t) for (let o of n.sources) {
    let a = e.ledger.reads.get(o.path)?.find((c) => c.receiptId === o.read_receipt_id);
    if (!a) throw new Error("Current read receipt for summary delivery is missing");
    r.set(JSON.stringify([o.path, a.receiptId]), { receiptId: a.receiptId, path: o.path, sha256: a.hash, startLine: a.startLine, endLine: a.endLine, text: a.text });
  }
  return [...r.values()];
}
s(Ba, "deliveryReads");
function K() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
s(K, "now");
function zn(e = process.cwd(), t = "") {
  return qn(e, t);
}
s(zn, "runKey");
async function Sc(e, t, r) {
  if (!r) throw new Error("run_dir is required for this action");
  let n = await e.ports.workspace(t), o = we(n.resultsRoot, qn(t, r)), a = await ur(n.resultsRoot), c = we(a, await ur(o));
  if (Va(a, c) !== Va(n.resultsRoot, o)) throw new Error("Research run path changed");
  let l = ze(c, "metadata.json");
  return { ports: e.ports, cwd: t, path: o, config: n, metadataPath: l, metadata: await Sn(l), ledger: Na(e.ledgers, o) };
}
s(Sc, "openRun");
function xe(e, { cwd: t = process.cwd(), runDir: r }, n) {
  let o = zn(t, r), a = s(async () => {
    let i = await Sc(e, t, r);
    try {
      return await n(i);
    } catch (u) {
      throw await Pa(e.ports.failureCandidateSink, i.metadata, u), u;
    }
  }, "operation"), c = (e.queues.get(o) ?? Promise.resolve()).then(() => e.ports.exclusive ? e.ports.exclusive(o, a) : a()), l = c.then(() => {
  }, () => {
  });
  return e.queues.set(o, l), l.then(() => {
    e.queues.get(o) === l && e.queues.delete(o);
  }), c;
}
s(xe, "withRun");
function Ya(e) {
  return { run_dir: e.path, metadata: e.metadata, evidence_gate: ke(e.metadata), revision: _t(e.metadata), ...e.metadata.mode === "fast_readonly" ? { escalationRequired: e.metadata.fast_path?.escalation_required === true } : {} };
}
s(Ya, "statusOf");
async function te(e, t, r) {
  let n = K(), o = { ...e.metadata, ...r && { evidence_gate: r, research_nodes: _n(r), provenance: xn(r, n), revision: _t(e.metadata) + 1, updated_at: n, ...r.answerable && { status: "completed", finalized_at: e.metadata.finalized_at || n } }, ...t };
  return await Cn(e.metadataPath, o), e.metadata = o, Ya(e);
}
s(te, "save");
async function Cc(e, t) {
  let { cwd: r = process.cwd(), query: n, mode: o = "deep_research", requiresProvenance: a = false } = t;
  if (o !== "fast_readonly" && o !== "deep_research") throw new Error("Unknown research execution mode");
  if (o === "fast_readonly" && a) throw new Error("Provenance requires deep_research");
  if (typeof n != "string" || !n.trim()) throw new Error("query is required");
  let c = nr(t.project || await e.resolveProject(r), "project"), l = nr(t.resultSlug || "research-question", "result_slug"), { resultsRoot: i } = await e.workspace(r), u = K(), d = `run-${u.replace(/[-:.TZ]/g, "").slice(0, 14)}-${Zn().slice(0, 8)}`, p = ze(i, l);
  await Wa(p, { recursive: true });
  let f = await ur(i);
  if (await ur(p) !== ze(f, l)) throw new Error("Result slug must stay inside the results root");
  let m = ze(p, d);
  await Wa(ze(f, l, d));
  let h = { kind: et, version: 1, run_id: d, project: c, result_slug: l, topic_id: kn(l), query: n.trim(), status: "running", revision: 0, mode: o, requires_provenance: a === true, started_at: u, ...o === "fast_readonly" ? { fast_path: _a() } : { slow_path: An() }, evidence_gate: { events: [{ type: "created", at: u }] } }, y = ke(h);
  return h.evidence_gate = y, h.research_nodes = _n(y), h.provenance = xn(y, u), await Cn(ze(f, l, d, "metadata.json"), h), { run_dir: m, metadata: h, evidence_gate: y, revision: 0, escalationRequired: o === "fast_readonly" ? false : void 0 };
}
s(Cc, "startResearchRun");
async function Fn(e, t, r, n) {
  let o = n ?? await Ne(e);
  Dn(t, o);
  let a = e.metadata.mode === "fast_readonly" ? [] : await qa(e);
  return { archived: a, claims: Je(r, [...o, ...a], e.ledger.reads) };
}
s(Fn, "recheckClaims");
async function Xa(e, t) {
  if (typeof t != "string" || !t.trim() || Buffer.byteLength(t) > 128 * 1024) throw new Error("Summary must contain 1-131072 UTF-8 bytes");
  let r = ke(e.metadata);
  if (r.stage !== "answerable" || r.status !== "ok" || !r.answerable) throw new Error("Evidence gate is closed; complete the research loop before summarizing");
  let n = e.metadata.revision;
  if (typeof n != "number" || !Number.isSafeInteger(n)) throw new Error("Legacy research run needs fresh completion before delivery");
  let o = await Ne(e), { archived: a, claims: c } = await Fn(e, r, r.claim_bindings, o);
  if (oe(JSON.stringify(c)) !== oe(JSON.stringify(r.claim_bindings))) throw new Error("Claim evidence changed; complete the research loop again before delivery");
  if (!o.length && !a.length) throw De("no-available-source", "No current verified source is available for this delivery");
  let l = ga(t);
  return { runId: e.metadata.run_id, evidenceRevision: n, gateSha256: oe(JSON.stringify(r)), claimsSha256: oe(JSON.stringify(c)), bodySha256: oe(l), body: l, claims: c, readReceipts: Ba(e, c) };
}
s(Xa, "prepareDelivery");
async function Ec(e, { prepared: t, copies: r, assessment: n, memoryClaims: o = [] }) {
  let a = await Xa(e, t.body);
  if (a.evidenceRevision !== t.evidenceRevision || a.gateSha256 !== t.gateSha256 || a.claimsSha256 !== t.claimsSha256) throw new Error("Research evidence changed during delivery; no delivery receipt was committed");
  let c = [];
  for (let i of r) {
    let u = await Ga(i.path), d = i.bodyRegion ? u.subarray(i.bodyRegion.start, i.bodyRegion.end) : u, p = oe(d);
    if (p !== t.bodySha256) throw new Error(`Summary readback differs from the prepared body: ${i.path}`);
    c.push({ role: i.role, path: i.path, artifactSha256: oe(u), bodySha256: p });
  }
  if (!c.some((i) => i.role === "run")) throw new Error("Delivery requires a run SUMMARY readback");
  if ((await Sn(e.metadataPath)).revision !== t.evidenceRevision) throw new Error("Research revision changed during readback");
  let l = { version: 1, receiptScope: "current-session-current-turn", id: Zn(), runId: t.runId, evidenceRevision: t.evidenceRevision, committedRevision: t.evidenceRevision + 1, gateSha256: t.gateSha256, claimsSha256: t.claimsSha256, bodySha256: t.bodySha256, copies: c, semanticAssessment: n || { status: "not-reviewed" }, scientificallyVerified: false, memoryClaimsSha256: oe(JSON.stringify(o)), sources: t.readReceipts.map((i) => ({ path: i.path, sha256: i.sha256, readReceiptIds: [i.receiptId] })) };
  return await te(e, { revision: l.committedRevision, summary_status: "written", summary_updated_at: K(), delivery_receipt: l }), l;
}
s(Ec, "commitDelivery");
function lr(e, t, r = {}) {
  if (!t.length) throw new Error("source_refs must list inspected original sources");
  return B({ ...e, source_refs: [.../* @__PURE__ */ new Set([...e.source_refs, ...t])] }, "sources_inspected", K(), { ...r, source_refs: t });
}
s(lr, "inspectSources");
function dr(e) {
  return e !== void 0 && (!Array.isArray(e) || e.length > 0);
}
s(dr, "hasBindings");
async function Qa(e, t, r) {
  t.stage === "sources_inspected" && (t = (await te(e, {}, await ot(e, t))).evidence_gate), ve(t, "sources_archived", "bind_claims");
  let n = dr(r.claimBindings) ? r.claimBindings : t.claim_bindings;
  if (!dr(n)) throw r.claimRefs?.length ? new Error("Structured claim_bindings are required; legacy claim_refs cannot make a run answerable") : new Error("Structured claim_bindings must contain at least one validated claim");
  let { claims: o } = await Fn(e, t, n), a = Le(o);
  return B({ ...t, claim_bindings: o, claim_refs: [...new Set(a)], warnings: [] }, "claims_bound", K(), { claim_refs: a });
}
s(Qa, "bindClaims");
async function Ac(e) {
  try {
    let t = JSON.parse(await Ga(ze(e, "reproducibility-manifest.json"), "utf8"));
    if (A(t).version === 1) return;
  } catch (t) {
    if (A(t).code !== "ENOENT") throw t;
  }
  throw De("missing-provenance-manifest", 'This run requires a reproducibility manifest before it can become answerable. Next action: call research_record_run_manifest with this run_dir and files listing actual source paths with role="input", then complete the research loop again.');
}
s(Ac, "requireManifest");
async function es(e, t, r = {}) {
  if (ve(t, "claims_bound", "finalize"), !t.claim_bindings.length) throw new Error("Structured claim_bindings are required before answerable");
  let { claims: n } = await Fn(e, t, t.claim_bindings), o = Le(n);
  if (t.archive_count + t.reuse_count < 1 || !o.length) throw new Error("archive verification and structured claim bindings are required before answerable");
  return e.metadata.requires_provenance === true && await Ac(e.path), B({ ...t, claim_bindings: n, claim_refs: o, warnings: [], status: "ok", answerable: true }, "answerable", K(), r);
}
s(es, "finalize");
async function Ic(e, t, r) {
  if (t.reuse_count && Dn(t, await Ne(e)), ve(t, "sources_inspected", "complete"), H(t.stage) < H("sources_archived") && (t = (await te(e, {}, await ot(e, t))).evidence_gate), !dr(r.claimBindings) && !t.claim_bindings.length) throw new Error("Provide structured claim_bindings; legacy claim_refs cannot make a research run answerable");
  return (dr(r.claimBindings) || H(t.stage) < H("claims_bound")) && (t = (await te(e, {}, await Qa(e, t, r))).evidence_gate), es(e, t);
}
s(Ic, "completeDeep");
async function Tc(e, t, r) {
  let { action: n, query: o, notes: a, outcome: c, sourceRefs: l = [] } = r, i = { ...o && { query: o.trim() }, ...c && { outcome: c }, ...a && { notes: a } };
  switch (n) {
    case "record_local":
      if (!o?.trim()) throw new Error("query is required");
      return B(t, "local_query_recorded", K(), i);
    case "record_external":
      if (ve(t, "local_query_recorded", n), !o?.trim() && !a?.trim()) throw new Error("record the external query or why external search was skipped");
      return B(t, "external_search_recorded", K(), i);
    case "inspect_sources":
      return ve(t, "external_search_recorded", n), lr(t, Array.isArray(l) ? l.map(String) : [], i);
    case "verify_archive":
      return ot(e, t);
    case "bind_claims":
      return Qa(e, t, r);
    case "finalize":
      return es(e, t, i);
    case "complete":
      return Ic(e, t, r);
    default:
      throw new Error(`unknown research_loop action: ${n}`);
  }
}
s(Tc, "changeDeepGate");
function pr(e) {
  if (!e.metadata.fast_path) throw new Error("Missing fast path progress");
  return e.metadata.fast_path;
}
s(pr, "fastProgress");
async function Ct(e, t) {
  let r = pr(e), n = On(r, t);
  return n !== r && await te(e, { fast_path: n }), ir(n.reason ?? t);
}
s(Ct, "markEscalation");
async function Pc(e, t, r) {
  let n = pr(e);
  if (r.action === "escalate") {
    let c = Sa(r.reason), l = { ...t, answerable: false, stage: t.answerable ? "claims_bound" : t.stage, events: [...t.events, { type: "escalation", at: K(), reason: c, ...n.reason && { trigger: n.reason } }] };
    return te(e, { mode: "deep_research", slow_path: An(H(l.stage)), status: "running", finalized_at: void 0 }, l);
  }
  if (!xt({ toolName: "research_loop", args: { action: r.action } })) throw new Error(await Ct(e, "write_or_archive_required"));
  if (n.escalation_required) throw new Error(ir(n.reason ?? "step_cap_reached"));
  if (r.action !== "complete") throw new Error('Use research_loop(action="complete") for fast path claim bindings');
  let o = await Ne(e);
  if (!o.length) throw new Error(await Ct(e, "source_stale_or_changed"));
  let a = H(t.stage) < H("local_query_recorded") ? B(t, "local_query_recorded", K()) : t;
  return te(e, {}, Ea(a, n, o, r.claimBindings, e.ledger.reads, K()));
}
s(Pc, "changeFastGate");
function jn(e) {
  let t = e.breaker_receipt;
  return t ? `Research stopped (${t.reason}). ${t.nextAction}` : "Research run stopped by breaker.";
}
s(jn, "breakerGuidance");
async function Ja(e, t) {
  let r = _t(e.metadata);
  if (t.expectedRevision != null && Number(t.expectedRevision) !== r) throw new Error(`research run changed; expected revision ${t.expectedRevision}, found ${r}`);
  if (t.action === "status") return Ya(e);
  if (e.metadata.status === "stopped_by_breaker") throw new Error(jn(e.metadata));
  let n = ke(e.metadata);
  return e.metadata.mode === "fast_readonly" ? Pc(e, n, t) : te(e, {}, await Tc(e, n, t));
}
s(Ja, "updateRun");
async function Mn(e, t, r, n) {
  let o = r ?? ke(e.metadata), a = o.archive_count + o.reuse_count, c = n ?? Tn(t, e.ports.breakerBudget, a);
  if (!c) return te(e, { slow_path: t }, r);
  let l = ya(c, t, e.ports.breakerBudget, { id: Zn(), runId: e.metadata.run_id, trippedAt: K() }, { stage: o.stage, inspectedSources: o.source_refs.length, verifiedSources: a, boundClaims: o.claim_bindings.length, revision: _t(e.metadata) + 1 }), i = await te(e, { slow_path: t, status: "stopped_by_breaker", breaker_receipt: l }, { ...o, status: "failed", answerable: false });
  return e.ports.failureCandidateSink && await $n(e.ports.failureCandidateSink, Ta(l)), i;
}
s(Mn, "saveSlowPath");
async function Oc(e, t, r) {
  let n = t.toolName === "research_loop" ? t.args?.action : void 0, o = t.args?.run_dir;
  if (typeof o == "string" && qn(e.cwd, o) !== e.path) return { block: true, reason: "Use the current turn's attached research run." };
  if (n === "status") return;
  if (e.metadata.status === "stopped_by_breaker") return { block: true, reason: jn(e.metadata), terminate: true };
  if (n === "start" && (e.metadata.status === "running" || e.metadata.mode === "fast_readonly")) return { block: true, reason: "Finish the active research run before starting another." };
  if (e.metadata.mode === "fast_readonly") {
    if (n === "escalate") return;
    if (!xt(t)) return { block: true, reason: await Ct(e, "write_or_archive_required") };
    let c = pr(e);
    if (c.escalation_required || sr(c, t.toolName)) return { block: true, reason: await Ct(e, "step_cap_reached") };
    let l = r.reduce((i, u) => Pn(i, u.toolName), c);
    if (sr(l, t.toolName)) return { block: true, reason: "Wait for active fast path tool receipts before taking another step." };
  }
  let a = e.metadata.slow_path;
  if (a) {
    let c = ke(e.metadata), l = In(e.ports.breakerBudget) ?? Tn(a, e.ports.breakerBudget, c.archive_count + c.reuse_count);
    if (l) return { block: true, reason: jn((await Mn(e, a, void 0, l)).metadata), terminate: true };
    if (a.measured.steps + r.length >= nt.maxSteps) return { block: true, reason: "Wait for active research tool receipts before taking another step." };
  }
}
s(Oc, "checkTool");
function cr(e, t) {
  return H(e.stage) >= H("local_query_recorded") ? e : B(e, "local_query_recorded", K(), { query: t });
}
s(cr, "ensureLocal");
function Nn(e, t, r) {
  return H(e.stage) >= H("external_search_recorded") ? e : B(e, "external_search_recorded", K(), { notes: t, ...r && { query: r } });
}
s(Nn, "ensureExternal");
async function Ka(e, t) {
  let r = await Ne(e);
  return r.length ? ot(e, t, r) : t;
}
s(Ka, "verifyAvailable");
async function ts(e, t, r) {
  let { toolName: n, args: o = {}, details: a = {}, readBinding: c, content: l } = r, i = e.metadata.mode === "fast_readonly", u = String(o.query || a.query || "").trim(), d = String(o.path || a.path || ""), p = String(o.url || a.url || u).trim();
  switch (n) {
    case "research_search_knowledge":
      return u && a.complete !== false ? B(t, "local_query_recorded", K(), { query: u }) : t;
    case "webfetch":
    case "fetch_content":
    case "web_search":
      return p ? B(cr(t, p), "external_search_recorded", K(), { query: p, notes: String(a.title || "") }) : t;
    case "research_read_knowledge": {
      if (!d || /(?:^|[\\/])Wiki[\\/]/i.test(d) || a.missing === true) return t;
      await Ua(e, d, a, c);
      let f = cr(t, d), m = lr(i ? f : Nn(f, "Host: no extra web search before inspecting current sources."), [d]);
      return i ? m : Ka(e, m);
    }
    case "read":
      return !d || a.missing === true || !await Ma(e, d, o, a, l) ? t : lr(Nn(cr(t, d), "Host recorded a read of the archived run source."), [d]);
    case "research_reconcile_literature":
    case "research_verify_literature": {
      let f = n === "research_reconcile_literature" ? A(a.receipt) : a, m = Ha(e, f);
      return !i && m ? Ka(e, t) : t;
    }
    case "research_archive_source": {
      let f = String(a.path || p);
      if (!f || a.status !== "downloaded") return t;
      let m = Nn(cr(t, f), "Host recorded the archived source URL as the external lookup.", p || f);
      return ot(e, lr(m, [f]));
    }
    default:
      return t;
  }
}
s(ts, "observedGate");
async function Lc(e, t, r, n) {
  let o = pr(e);
  if (!n.countedStep && o.escalation_required || !xt(r)) return null;
  let a = n.countedStep === true || !!(n.toolCallId && r.toolName !== "research_loop");
  if (a && sr(o, r.toolName)) return await Ct(e, "step_cap_reached"), null;
  let c = n.isError ? t : await ts(e, t, n), l = a ? Pn(o, r.toolName) : o, u = (n.isError ? void 0 : Ca(r.toolName, n.details ?? {})) ?? (l.stepsUsed >= _e.maxSteps && !c.answerable ? "step_cap_reached" : void 0);
  return !a && c === t && !u ? null : te(e, { fast_path: u ? On(l, u) : l }, c === t ? void 0 : c);
}
s(Lc, "observeFast");
async function $c(e, t) {
  if (!t.toolName || e.metadata.status === "stopped_by_breaker") return null;
  let r = ke(e.metadata), n = { toolName: t.toolName, args: t.args };
  if (e.metadata.mode === "fast_readonly") return Lc(e, r, n, t);
  let { readCount: o, verified: a } = e.ledger, c = a.size, l = t.isError ? r : await ts(e, r, t), i = l === r ? void 0 : l, u = e.metadata.slow_path;
  if (!u || !t.countedStep || !t.toolCallId) return i ? te(e, {}, i) : null;
  let d = H(l.stage), p = d > u.observedStage || e.ledger.readCount > o || a.size > c || l.archive_count + l.reuse_count > r.archive_count + r.reuse_count || !t.isError && n.toolName === "research_loop" && n.args?.action === "start", f = ma({ ...u, observedStage: d }, n, p);
  return Mn(e, f.state, i, f.trip);
}
s($c, "observeReceipt");
async function Dc(e, t) {
  let r = e.metadata.slow_path;
  if (!r || e.metadata.status === "stopped_by_breaker") return null;
  let n = fa(r, e.ports.breakerBudget, t);
  return Mn(e, n.state, void 0, n.trip);
}
s(Dc, "observeUsage");
async function Nc(e, t) {
  let r = e.metadata.slow_path;
  if (!r || e.metadata.status === "stopped_by_breaker") return null;
  let n = ha(r, t);
  return n === r ? null : te(e, { slow_path: n });
}
s(Nc, "observeContextEviction");
function fr(e) {
  let t = { ports: e, ledgers: /* @__PURE__ */ new Map(), queues: /* @__PURE__ */ new Map() };
  return { startResearchRun: s((r = {}) => Cc(e, r), "startResearchRun"), updateResearchLoop: s((r = {}) => xe(t, r, (n) => Ja(n, r)), "updateResearchLoop"), completeResearchGate: s((r = {}) => xe(t, r, (n) => Ja(n, { ...r, action: "complete" })), "completeResearchGate"), prepareResearchDelivery: s((r) => xe(t, r, (n) => Xa(n, r.markdown)), "prepareResearchDelivery"), commitResearchDelivery: s((r) => xe(t, r, (n) => Ec(n, r)), "commitResearchDelivery"), observeResearchReceipt: s(async (r = {}) => {
    if (!r.runDir) return null;
    try {
      return await xe(t, r, (n) => $c(n, r));
    } catch (n) {
      if (!r.countedStep && A(n).code === "ENOENT") return null;
      throw n;
    }
  }, "observeResearchReceipt"), checkTool: s((r, n, o, a = []) => xe(t, { cwd: r, runDir: n }, (c) => Oc(c, o, a)), "checkTool"), observeUsage: s((r, n, o) => xe(t, { cwd: r, runDir: n }, (a) => Dc(a, o)), "observeUsage"), observeContextEviction: s((r, n, o) => xe(t, { cwd: r, runDir: n }, (a) => Nc(a, o)), "observeContextEviction"), flushResearchReceipts: s(async ({ cwd: r, runDir: n } = {}) => {
    await t.queues.get(zn(r, n));
  }, "flushResearchReceipts"), resetResearchReceipts: s(({ cwd: r, runDir: n } = {}) => {
    n && t.ledgers.delete(zn(r, n));
  }, "resetResearchReceipts"), topicIdFromResultSlug: kn, dispose: s(() => t.ledgers.clear(), "dispose") };
}
s(fr, "createResearchLoop");
var ls = {};
Z(ls, { getResearchRun: () => cs, listResearchRuns: () => is });
var mr = ["created", "local_query_recorded", "external_search_recorded", "sources_inspected", "sources_archived", "sources_reused", "claims_bound", "answerable"];
var qc = { created: "\u51C6\u5907\u8FD0\u884C", local_query_recorded: "\u8BB0\u5F55\u672C\u5730\u68C0\u7D22", external_search_recorded: "\u8BB0\u5F55\u5916\u90E8\u68C0\u7D22", sources_inspected: "\u68C0\u67E5\u6765\u6E90", sources_archived: "\u5F52\u6863\u6765\u6E90", sources_reused: "\u590D\u7528\u6765\u6E90", claims_bound: "\u7ED1\u5B9A\u4E3B\u5F20", answerable: "\u53EF\u56DE\u7B54" };
function T(e, t = 480) {
  return String(e ?? "").normalize("NFKC").replace(new RegExp("\\p{Cc}", "gu"), " ").replace(/\s+/g, " ").trim().slice(0, t);
}
s(T, "text");
function gr(e) {
  return typeof e == "string" && /^[a-f0-9]{64}$/i.test(e) ? e.toLowerCase() : null;
}
s(gr, "validHash");
function Un(e, t) {
  let r = hr(je(e), je(t));
  return r === "" || !r.startsWith(`..${yr}`) && r !== ".." && !Zc(r);
}
s(Un, "within");
function Fc(e, t) {
  let r = je(e, t), n = hr(je(e), r).split(yr);
  if (!Un(e, r) || n.length !== 2 || !n[1]?.startsWith("run-")) throw new Error("research run is outside the configured results root");
  return r;
}
s(Fc, "safeRunDir");
async function br(e) {
  try {
    let t = JSON.parse(await os(e, "utf8"));
    return t && typeof t == "object" && !Array.isArray(t) ? t : null;
  } catch {
    return null;
  }
}
s(br, "readJson");
function Rr(e) {
  let t = e?.evidence_gate && typeof e.evidence_gate == "object" ? e.evidence_gate : {};
  return { stage: mr.includes(t.stage) ? t.stage : "created", status: t.status === "failed" ? "failed" : "ok", answerable: t.answerable === true, events: Array.isArray(t.events) ? t.events.filter((r) => r && typeof r == "object") : [], claimBindings: Array.isArray(t.claim_bindings) ? t.claim_bindings : [], claimRefs: Array.isArray(t.claim_refs) ? t.claim_refs : [], sourceRefs: Array.isArray(t.source_refs) ? t.source_refs : [], archiveCount: Number.isFinite(Number(t.archive_count)) ? Number(t.archive_count) : 0, reuseCount: Number.isFinite(Number(t.reuse_count)) ? Number(t.reuse_count) : 0, reusedSources: Array.isArray(t.reused_sources) ? t.reused_sources : [], warnings: Array.isArray(t.warnings) ? t.warnings.map((r) => T(r, 240)).filter(Boolean) : [] };
}
s(Rr, "gateOf");
function Mc(e) {
  let t = Rr(e), r = t.events.filter((c) => mr.includes(c.type)), n = r.at(-1)?.type || t.stage, o = mr.indexOf(n), a = /* @__PURE__ */ new Map();
  for (let c of r) c.failed === true || c.status === "failed" || c.outcome === "failed" || a.set(c.type, c);
  return mr.map((c, l) => {
    let i = a.get(c), u = t.events.filter((f) => f.type === c).length, d = t.events.some((f) => f.type === c && (f.failed === true || f.status === "failed" || f.outcome === "failed")), p = "pending";
    return d && l >= o ? p = "blocked" : i && (c === "answerable" || l < o || l === o && t.answerable) ? p = "complete" : c === n && t.status === "failed" ? p = "blocked" : c === n && (p = "active"), { key: c, label: qc[c] || c, state: p, at: typeof i?.at == "string" ? i.at : null, detail: T(i?.notes || i?.outcome || i?.reason, 240) || null, ...u > 1 ? { count: u } : {} };
  });
}
s(Mc, "route");
function Uc(e) {
  return Rr(e).events.slice(-128).map((r) => ({ type: T(r.type, 100) || "event", at: typeof r.at == "string" ? r.at : null, detail: T(r.notes || r.outcome || r.reason, 320) || null, status: r.failed === true || r.status === "failed" || r.outcome === "failed" ? "failed" : r.observed === true ? "observed" : "ok", refs: Array.isArray(r.source_refs) ? r.source_refs.map((n) => T(n, 240)).filter(Boolean).slice(0, 8) : void 0 }));
}
s(Uc, "timeline");
async function wr(e) {
  try {
    let t = await os(e);
    return { hash: zc("sha256").update(t).digest("hex"), size: t.byteLength };
  } catch {
    return { hash: null, size: null };
  }
}
s(wr, "hashFile");
async function Hc(e, t, r) {
  let n = await br(ce(e, "sources", "download-manifest.json")), o = Array.isArray(n?.items) ? n.items : [], a = /* @__PURE__ */ new Map(), c = 0, l = 0, i = 0, u = 0;
  for (let d of o) {
    let p = T(d?.path || d?.local_path || d?.file, 480).replaceAll("\\", "/");
    if (!p) continue;
    let f = gr(d?.sha256), m = null, h = Number.isFinite(Number(d?.size_bytes)) ? Number(d.size_bytes) : null, y = p.startsWith("/") ? p : ce(e, p);
    if (Un(e, y)) {
      let b = await wr(y);
      m = b.hash, h = b.size ?? h;
    } else if (r && Un(r, ce(r, p))) {
      let b = await wr(ce(r, p));
      m = b.hash, h = b.size ?? h;
    }
    f && (c++, m ? m === f ? l++ : i++ : u++), a.set(p, { path: p, status: T(d?.status, 80) || "unknown", hash: f, verified: !!(f && m && m === f), size: h, location: m ? y : null, metadata: d?.metadata && typeof d.metadata == "object" ? d.metadata : null });
  }
  for (let d of t.sourceRefs) {
    let p = T(d, 480).replaceAll("\\", "/");
    p && !a.has(p) && a.set(p, { path: p, status: "inspected", hash: null, verified: false, size: null, location: null, metadata: null });
  }
  for (let d of t.reusedSources) {
    let p = T(d?.path, 480).replaceAll("\\", "/");
    p && !a.has(p) && a.set(p, { path: p, status: "reused", hash: gr(d?.hash), verified: false, size: null, location: null, metadata: null });
  }
  return { items: [...a.values()].slice(0, 64), integrity: { checked: c, verified: l, changed: i, missing: u } };
}
s(Hc, "sourceManifest");
function Bc(e) {
  return e.claimBindings.slice(0, 64).map((t) => {
    let r = Array.isArray(t.sources) ? t.sources.slice(0, 12).map((n) => ({ path: T(n?.path, 480), startLine: Number.isInteger(n?.start_line) ? n.start_line : null, endLine: Number.isInteger(n?.end_line) ? n.end_line : null, quote: T(n?.quote, 700) || null, hash: gr(n?.hash) })).filter((n) => n.path) : [];
    return { id: T(t.id, 120) || null, claim: T(t.claim, 480), support: r.map((n) => n.path), status: t.scientificallyVerified === true ? "verified" : t.relationship || "bound", relationship: ["direct", "indirect", "hypothesis", "unsupported"].includes(t.relationship) ? t.relationship : null, limitations: T(t.limitations, 480) || null, organism: T(t.organism, 180) || null, method: T(t.method, 360) || null, evidence: r };
  }).filter((t) => t.claim);
}
s(Bc, "claims");
async function Wc(e) {
  let t = await br(ce(e, "reproducibility-manifest.json"));
  if (!t || !Array.isArray(t.files)) return { status: "not-recorded", files: [], limitations: ["\u5C1A\u672A\u8BB0\u5F55\u8FD0\u884C\u6E05\u5355"] };
  let r = [], n = false, o = false;
  for (let a of t.files.slice(0, 64)) {
    let c = T(a?.path, 480), l = gr(a?.sha256), i = c ? await wr(je(e, c)) : { hash: null, size: null }, u = !!(l && i.hash && l === i.hash);
    !l || !i.hash ? o = true : u || (n = true), r.push({ path: c, role: T(a?.role, 80) || "unknown", hash: l, currentHash: i.hash, matches: u });
  }
  return { status: n ? "changed" : o ? "incomplete" : "observed", files: r, limitations: Array.isArray(t.limitations) ? t.limitations.map((a) => T(a, 240)).filter(Boolean) : [] };
}
s(Wc, "provenance");
function as(e, t, r) {
  let n = Rr(e);
  return { runId: T(e.run_id || jc(t), 180), resultSlug: T(e.result_slug || hr(r, t).split(yr)[0], 180), project: T(e.project, 180), topicId: T(e.topic_id, 180) || null, query: T(e.query, 1e3), status: T(e.status, 80) || "unknown", stage: n.stage, answerable: n.answerable, scientificallyVerified: false, startedAt: T(e.started_at, 80) || null, updatedAt: T(e.updated_at || e.started_at, 80) || null, runDir: hr(r, t).replaceAll(yr, "/") };
}
s(as, "listItem");
async function ss(e, t) {
  let r = [];
  try {
    for (let n of await ns(e, { withFileTypes: true })) if (!(!n.isDirectory() || n.name.startsWith("."))) for (let o of await ns(ce(e, n.name), { withFileTypes: true })) {
      if (!o.isDirectory() || !o.name.startsWith("run-")) continue;
      let a = ce(e, n.name, o.name), c = await br(ce(a, "metadata.json"));
      c && (!t || T(c.project, 180) === T(t, 180)) && r.push({ metadata: c, runDir: a });
    }
  } catch {
  }
  return r.sort((n, o) => String(o.metadata.updated_at || o.metadata.started_at).localeCompare(String(n.metadata.updated_at || n.metadata.started_at)));
}
s(ss, "discover");
async function is(e) {
  let t = Math.max(1, Math.min(50, Number(e.limit) || 10)), r = je(e.resultsRoot), n = await ss(r, e.project);
  return { items: n.slice(0, t).map(({ metadata: o, runDir: a }) => as(o, a, r)), total: n.length };
}
s(is, "listResearchRuns");
async function cs(e) {
  let t = je(e.resultsRoot), r = e.runDir ? Fc(t, e.runDir) : null;
  if (!r && e.runId && (r = (await ss(t)).find(({ metadata: y }) => T(y.run_id, 180) === T(e.runId, 180))?.runDir || null), !r) throw new Error("research run not found");
  let n = await br(ce(r, "metadata.json"));
  if (!n) throw new Error("research run metadata is invalid");
  let o = Rr(n), a = await Hc(r, o, e.vaultRoot), c = Bc(o), l = await Wc(r), i = [], u = await wr(ce(r, "SUMMARY.md")), d = n.delivery_receipt, p = d?.version === 1 ? { status: u.hash === d.bodySha256 ? "body-matched" : u.hash ? "body-changed" : "body-missing", bodySha256: d.bodySha256, currentBodySha256: u.hash, semanticAssessment: d.semanticAssessment, evidenceFreshness: "requires-current-scope-recheck", scientificallyVerified: false } : { status: "historical-unreviewed", scientificallyVerified: false };
  d && p.status !== "body-matched" && i.push("\u603B\u7ED3\u6B63\u6587\u4E0E\u4EA4\u4ED8\u56DE\u6267\u4E0D\u4E00\u81F4");
  let f = /* @__PURE__ */ new Map();
  for (let h of a.items) h.hash && f.set(h.hash, [...f.get(h.hash) || [], h.path]);
  let m = { duplicateSources: [...f.values()].filter((h) => h.length > 1), staleSources: a.items.filter((h) => h.metadata?.stale === true || h.metadata?.retracted === true).map((h) => h.path), unavailableSources: a.items.filter((h) => ["failed", "missing", "unavailable"].includes(h.status) || h.hash && !h.verified).map((h) => h.path) };
  return m.duplicateSources.length && i.push("\u5B58\u5728\u91CD\u590D\u6765\u6E90"), m.staleSources.length && i.push("\u5B58\u5728\u9700\u8981\u590D\u6838\u7684\u8FC7\u671F\u6216\u64A4\u7A3F\u6765\u6E90"), c.length || i.push("\u6CA1\u6709\u7ED3\u6784\u5316\u4E3B\u5F20"), c.some((h) => h.relationship === "unsupported" || h.relationship === "hypothesis") && i.push("\u5B58\u5728\u672A\u76F4\u63A5\u652F\u6301\u7684\u4E3B\u5F20"), (a.integrity.changed || a.integrity.missing) && i.push("\u6765\u6E90\u6587\u4EF6\u9700\u8981\u91CD\u65B0\u6838\u9A8C"), l.status !== "observed" && i.push("\u590D\u73B0\u6E05\u5355\u4E0D\u5B8C\u6574\u6216\u5DF2\u53D8\u5316"), o.status === "failed" && i.push("\u5F53\u524D\u8DEF\u7531\u88AB\u963B\u585E"), { ...as(n, r, t), route: Mc(n), timeline: Uc(n), sources: a.items, claims: c, delivery: p, warnings: o.warnings, coverage: n.retrieval_coverage || n.metrics?.index?.semantic || null, archive: { count: o.archiveCount, reused: o.reuseCount, verified: a.integrity.checked > 0 && a.integrity.checked === a.integrity.verified }, integrity: a.integrity, provenance: l, gaps: i, governance: m };
}
s(cs, "getResearchRun");
var xs = {};
Z(xs, { observeExecutionReceipt: () => Cr, readMethodsFacts: () => ks, recordRunProvenance: () => vs, saveMethodsSection: () => _s });
var Et = /* @__PURE__ */ new Map();
var ds = s((e) => fs("sha256").update(e).digest("hex"), "digest");
var xr = s(async (e) => ({ resultsRoot: Hn(e, "results") }), "defaultWorkspaceConfig");
function ws(e, t) {
  let r = _r(e, t);
  return r !== ".." && !r.startsWith(`..${gs}`) && !Kc(r);
}
s(ws, "within");
async function Sr(e, t, r) {
  let n = await r(e), o = await At(n.resultsRoot), a = await At(Hn(e, t || "")), c = _r(o, a).split(gs);
  if (!ws(o, a) || c.length !== 2 || !c[1]?.startsWith("run-")) throw new Error("Expected existing run inside results root");
  return await kr(Se(a, "metadata.json"), "utf8"), a;
}
s(Sr, "runPath");
async function bs(e) {
  try {
    let t = await Jc(e);
    if (!t.isFile() || t.isSymbolicLink() || t.size > 2 * 1024 * 1024) throw new Error("Invalid observation file");
    let r = JSON.parse(await kr(e, "utf8"));
    if (r.version !== 1 || !Array.isArray(r.records) || r.records.length > 256 || r.records.some((n) => !n || typeof n.toolCallId != "string")) throw new Error("Invalid observation records");
    return r.records;
  } catch (t) {
    if (It(t, "ENOENT")) return [];
    throw t;
  }
}
s(bs, "readObservations");
async function Rs(e, t) {
  let r = `${e}.${ms()}.tmp`;
  await ys(r, JSON.stringify(t, null, 2)), await hs(r, e);
}
s(Rs, "atomic");
function It(e, t) {
  return !!(e && typeof e == "object" && "code" in e && e.code === t);
}
s(It, "isNodeError");
async function Cr({ cwd: e, runDir: t, toolCallId: r, toolName: n, sessionId: o = null, args: a = {}, details: c = {}, isError: l = false, observedAt: i, loadWorkspaceConfig: u = xr }) {
  if (!["bash", "powershell"].includes(n) || !r) return null;
  let d = await Sr(e, t, u), p = Se(d, "execution-observations.json"), f = (Et.get(p) || Promise.resolve()).catch(() => {
  }).then(async () => {
    let m = [];
    try {
      m = await bs(p);
    } catch (y) {
      if (!It(y, "ENOENT")) throw y;
    }
    if (m.some((y) => y.toolCallId === r)) return;
    let h = c.exitCode ?? c.exit_code;
    m.push({ toolCallId: r, toolName: n, sessionId: o, observedAt: i || (/* @__PURE__ */ new Date()).toISOString(), cwd: e, commandSha256: ds(String(a.command || a.cmd || "")), commandLocation: "original-session-tool-call", resultDetailsSha256: ds(JSON.stringify(c)), outcome: l ? "failed-or-blocked" : "tool-returned", exitCode: Number.isInteger(h) ? Number(h) : null, executionConfirmed: !l && Number.isInteger(h), qcVerified: false }), await Rs(p, { version: 1, records: m.slice(-256), scientificallyVerified: false });
  });
  return Et.set(p, f), f.finally(() => {
    Et.get(p) === f && Et.delete(p);
  }).catch(() => {
  }), f.then(() => {
  });
}
s(Cr, "observeExecutionReceipt");
async function vs({ cwd: e = process.cwd(), runDir: t, files: r = [], declarations: n = {}, loadWorkspaceConfig: o = xr }) {
  let a = await Sr(e, t, o), c = await At(e);
  if (!Array.isArray(r) || r.length > 64) throw new Error("At most 64 explicitly selected files");
  let l = [];
  for (let m of r) {
    if (!m || typeof m.path != "string" || !["input", "output", "script", "log"].includes(m.role)) throw new Error("Invalid file declaration");
    let h = await At(Hn(c, m.path));
    if (!ws(c, h) || /(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|auth\.json|credentials(?:\.json)?|\.ssh|\.git)(?:[\\/]|$)/i.test(h)) throw new Error("File outside permitted project snapshot scope");
    let y = await us(h);
    if (!y.isFile() || y.size > 128 * 1024 * 1024) throw new Error("Not a bounded regular file");
    let b = fs("sha256");
    for await (let C of Vc(h)) b.update(C);
    let R = await us(h);
    if (y.size !== R.size || y.mtimeMs !== R.mtimeMs) throw new Error("File changed while hashing");
    l.push({ path: _r(c, h), role: m.role, bytes: R.size, sha256: b.digest("hex"), snapshotAt: (/* @__PURE__ */ new Date()).toISOString(), basis: "current-file-snapshot-not-execution-time-proof" });
  }
  let i = [], u = Se(a, "execution-observations.json");
  await Et.get(u);
  try {
    i = await bs(u);
  } catch (m) {
    if (!It(m, "ENOENT")) throw m;
  }
  if (JSON.stringify(n).length > 16e3) throw new Error("Declarations too large");
  let p = { version: 1, createdAt: (/* @__PURE__ */ new Date()).toISOString(), runDir: a, hostRuntime: { node: process.version, platform: process.platform, arch: process.arch }, files: l, executionObservations: i, declarations: n, declaredSoftwareVersionsVerified: false, qcVerified: false, scientificallyVerified: false, executionStatus: i.length ? "tool-observations-present" : "no-execution-observed", limitations: ["Local observation files are not cryptographically attested; independently check the referenced session trace.", "Command text stays in the original session tool call; this manifest contains its digest, not credentials.", "File snapshots are post-hoc unless separately collected before execution.", "Software versions, parameters and seeds in declarations are not automatically verified; tool success is not QC."] }, f = Se(a, "reproducibility-manifest.json");
  return await Rs(f, p), { path: f, ...p };
}
s(vs, "recordRunProvenance");
async function ps(e) {
  try {
    let t = JSON.parse(await kr(e, "utf8"));
    return t && typeof t == "object" && !Array.isArray(t) ? t : null;
  } catch (t) {
    if (It(t, "ENOENT")) return null;
    throw t;
  }
}
s(ps, "readJson");
var vr = s((e) => typeof e == "string" && e ? e : null, "text");
async function ks({ cwd: e = process.cwd(), runDir: t, loadWorkspaceConfig: r = xr }) {
  let n = await Sr(e, t, r), o = await ps(Se(n, "metadata.json")) ?? {}, a = await ps(Se(n, "reproducibility-manifest.json")), c = Array.isArray(a?.files) ? a.files : [], l = s((f) => c.filter((m) => m.role === f).map((m) => ({ path: m.path, sha256: m.sha256 })), "pick"), i = Array.isArray(a?.executionObservations) ? a.executionObservations : [], u = a?.declarations && typeof a.declarations == "object" ? a.declarations : {}, d = null;
  try {
    d = await kr(Se(n, "METHODS.md"), "utf8");
  } catch (f) {
    if (!It(f, "ENOENT")) throw f;
  }
  let p = [];
  return a || p.push("No reproducibility manifest: call research_record_run_manifest with inputs, outputs, scripts and declarations first."), Object.keys(u).length || p.push("No declared software versions or parameters; ask the user or check with bio_environment before stating any."), l("input").length || p.push("No input files recorded."), i.length || p.push("No executed commands were observed for this run."), { runDir: _r(await At(e), n) || n, query: vr(o.query), status: vr(o.status), startedAt: vr(o.started_at), finalizedAt: vr(o.finalized_at), hostRuntime: a?.hostRuntime ?? null, inputs: l("input"), outputs: l("output"), scripts: l("script"), declarations: u, commandsObserved: i.length, commandsFailed: i.filter((f) => f.outcome === "failed-or-blocked").length, existingMethods: d, gaps: p };
}
s(ks, "readMethodsFacts");
async function _s({ cwd: e = process.cwd(), runDir: t, text: r, approvedAt: n = (/* @__PURE__ */ new Date()).toISOString(), loadWorkspaceConfig: o = xr }) {
  let a = String(r ?? "").trim();
  if (!a) throw new Error("Methods text is empty");
  if (a.length > 2e4) throw new Error("Methods text is longer than 20,000 characters");
  let c = await Sr(e, t, o), l = Se(c, "METHODS.md"), i = `<!-- drone:methods approved_at=${n} \u2014 reviewed by the user; software versions are as declared in reproducibility-manifest.json -->

${a}
`, u = `${l}.${ms()}.tmp`;
  return await ys(u, i, "utf8"), await hs(u, l), { path: l, bytes: Buffer.byteLength(i) };
}
s(_s, "saveMethodsSection");
var Os = {};
Z(Os, { DEFAULT_MAX_BYTES: () => Xe, DEFAULT_TIMEOUT_MS: () => Qe, SOURCE_CATEGORIES: () => ge, archiveSource: () => Xn, default: () => al, sourceStatus: () => Qn });
function Er(e, t) {
  if (!e.trim()) throw new Error("external effect namespace is required");
  let r = JSON.stringify(t, (n, o) => o && typeof o == "object" && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).sort(([a], [c]) => a.localeCompare(c))) : o);
  return `${e.trim()}:${Gc("sha256").update(r).digest("hex")}`;
}
s(Er, "externalEffectKey");
var Es = {};
Z(Es, { PAPER_EVIDENCE_GUIDANCE: () => Wn, RESEARCH_ANSWER_GUIDANCE: () => Bn, assessManualPage: () => Ir, deliveryContract: () => Cs, hasPaperCitation: () => Ss, requiresPaperEvidence: () => Ar });
function Ar(e) {
  return /文献|论文|比较基因组|研究设计|研究方案|literature|research (?:design|plan)|comparative genomics|paper/i.test(String(e || ""));
}
s(Ar, "requiresPaperEvidence");
function Ss(e) {
  return e.some((t) => /^Library\/Papers\/[^\r\n]+\.md$/.test(String(t.path || "")) && Array.isArray(t.paperDois) && t.paperDois.length > 0);
}
s(Ss, "hasPaperCitation");
function Ir(e, t, r) {
  if (!/html/i.test(String(t || ""))) return { status: "document-unassessed", complete: false, candidates: [], note: "Content completeness and version still need inspection." };
  let n = new TextDecoder().decode(e).slice(0, 25e4), o = n.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " "), a = [...new Set(o.match(/(?:^|\s)-{1,2}[a-zA-Z][a-zA-Z0-9_-]{2,}/g) || [])], c = [];
  for (let l of n.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) try {
    let i = l[1], u = l[2];
    if (!i || u === void 0) continue;
    let d = new URL(i.replace(/&amp;/g, "&"), r), p = new URL(r);
    d.hash = "";
    let f = u.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
    if (d.origin !== p.origin || !/^https?:$/.test(d.protocol) || d.username || d.password || !/manual|option|command|parameter|usage|align|install|reference/i.test(`${f} ${d.pathname}`) || d.href === p.href || c.some((m) => m.url === d.href)) continue;
    if (c.push({ url: d.href, title: f }), c.length >= 12) break;
  } catch {
  }
  return { status: a.length >= 5 ? "reference-page-only" : "landing-or-overview-page", complete: false, optionCount: a.length, candidates: c, note: "Heuristic page classification, not a completeness or scientific verification result." };
}
s(Ir, "assessManualPage");
var Bn = "Write the visible answer as a scientist-facing research memo, not an internal execution log. Start the visible answer with the scientific conclusion or best current interpretation in 3\u20135 lines, then state the evidence level and one default recommendation with the reason it is the best next move. Explicitly separate what the current evidence supports, what it cannot establish, and which primary evidence would most improve the decision. Ask the user only about choices that materially change the scientific design; when several follow-up actions are possible, choose and explain a recommended default instead of asking the user to pick an internal task. Do not expose internal workflow terms such as claims binding, evidence gate, Vault, host, archive, Wiki, deposition, receipts, or note paths anywhere in the visible answer. Translate source status into research language such as \u2018\u76EE\u524D\u7ED3\u8BBA\u4E3B\u8981\u6765\u81EA\u7EFC\u8FF0\u548C\u6574\u7406\u6750\u6599\u2019 or \u2018\u8BE5\u673A\u5236\u5C1A\u7F3A\u5C11\u539F\u59CB\u8BBA\u6587\u76F4\u63A5\u6838\u9A8C\u2019. Keep file writes, indexing, and knowledge-base maintenance invisible unless the user explicitly asks for them; if they must be mentioned, use one human-facing sentence after the scientific answer and never turn them into the main next step. Keep limitations decision-relevant and say what can proceed now, what should remain provisional, and what evidence should be added next.";
var Wn = "For research design, give a short provisional plan first, then a bounded evidence pass. Support each key scientific claim with a specific original paper: author/year, DOI, exact section/figure/page actually read, organism, method, result and limitations. Cite the corresponding source beside the claim; keep long storage paths out of the main prose when a short title/year citation is available. Wiki is orientation, not a substitute for original papers. Separate reported findings from your proposed design and cross-species hypotheses. Distinguish signaling ligands (Wg, Dpp, Hh), DNA-binding transcription factors and cofactors; do not scan ligand or cofactor motifs as if they were DNA-binding TFs. For motif analysis use supported downstream DNA-binding factors (e.g. Sd, Pan/TCF, Mad, Ci), verify the relevant motif model, and do not treat a motif hit as occupancy or causality. When dual-library deposition is authorized, reuse exact DOI matches, import metadata and only legally open fulltext to Zotero, and deposit an interpreted linked source note to the bound knowledge base. Verify both destinations with research_verify_literature; a run download or source manifest is NOT Zotero import. Report metadata-only, missing fulltext, unavailable, and partial destinations as evidence limitations, not as the main result. Do not retry a write after an uncertain response until reading back the DOI. Never call storage or bibliographic checks scientific verification.";
function Cs(e, { showMeAvailable: t = false, researchContinuation: r = false } = {}) {
  let n = String(e || ""), a = !/只读|read[- ]only/i.test(n) && /说明书|使用手册|介绍|讲解|解释|图解|show.?me|explainer|explain|summariz/i.test(n), c = /说明书|使用手册|命令|参数|manual|command.line|reference/i.test(n), l = r || Ar(n) || /文章|article|research/i.test(n), i = c || /软件|程序|software|package/i.test(n);
  return c || r || Ar(n) || /下载|沉淀|介绍|讲解|解释|download|explain|summariz/i.test(n) && (l || i) ? { kind: i && l ? "mixed" : i ? "software" : "research", showMeAvailable: t, guidance: [l ? Wn : "", l ? Bn : "", "Answer the scientific question first. If a record of sources or operational follow-up is relevant, keep it to one short human-facing note after the conclusion; operational delivery is not the scientific answer.", c ? "Manual means version-matched executable/CLI reference: purpose, installation prerequisites, input/output, minimal command example, important options/defaults/constraints, errors, and links to the actual reference chapters. A homepage or TOC is only a starting page. Follow relevant same-site links in a bounded way; do not mirror the entire site." : "", i ? "For software explain the principle and applicability, including supported DNA/RNA/protein data types. Do not treat a protein-only paper as direct DNA evidence. Separate author-reported benchmarks from local measurements; report not tested when no actual test was run. Only run authorized, bounded tests; record version, environment, dataset, command, elapsed time and limitations." : "", l ? "For each selected research paper explain its question, main claims, methods, evidence and limitations; do not substitute bibliographic metadata or a download manifest for reading." : "", a ? t ? "Use the loaded show-me skill (or the bundled research-show-me fallback) for a focused explainer after reading the sources. Resolve and read its actual SKILL.md from the available skill catalog; save one HTML/Markdown explainer under this task run and link it in the visible final answer. Prefer the authorized knowledge-explainer host worker in automatic mode after summary save; do not launch a recursive model/run or duplicate its output. If handling the explanation directly, after creating it, archive it with research_archive_explainer using the active research run metadata.topic_id when available (reuse it across rounds) and the actual evidence notes read this turn; this produces a searchable Library/Explainers pointer plus a versioned attachment, but it remains presentation-only." : "The show-me skill and its bundled research-show-me fallback are not loaded. Report this honestly; deliver the same explanation as Markdown rather than claiming the skill ran." : "No explainer artifact is requested in this scope. Deliver the evidence-grounded answer inline; do not load show-me, create files, deposit an explainer, or add a human-review milestone just to answer a read-only research question.", "Cite exact sources and versions. Do not invent defaults, performance, or full-manual coverage. Answer the user's question; do not explain Vault or evidence-gate policy."].filter(Boolean).join(`
`) } : null;
}
s(Cs, "deliveryContract");
function Vn(e, t, r) {
  let o = (e.headers.get("content-disposition") || "").match(/filename\*?=(?:UTF-8''|")?([^;"]+)/i), a = o ? decodeURIComponent(o[1].trim()) : "";
  if (!a) try {
    a = Jn(new URL(t).pathname);
  } catch {
  }
  let c = `${r}-${(/* @__PURE__ */ new Date()).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}.bin`;
  return be(a, c);
}
s(Vn, "filenameFromResponse");
async function Ts(e, t) {
  await Kn(Is(e), { recursive: true });
  let r = `${e}.${Ce()}.tmp`;
  await Yn(r, `${JSON.stringify(t, null, 2)}
`, "utf8"), await Gn(r, e);
}
s(Ts, "atomicJson");
async function Ps(e, t, r) {
  return e.exclusive(t, r);
}
s(Ps, "withRunLock");
async function Lr(e, t) {
  try {
    let r = JSON.parse(await Ze(e, "utf8"));
    if (!r || typeof r != "object" || !Array.isArray(r.items)) throw new Error("invalid manifest");
    return r;
  } catch (r) {
    if (r.code !== "ENOENT") throw r;
    return { version: 1, run_dir: t, updated_at: null, items: [] };
  }
}
s(Lr, "readManifest");
async function tl(e, t) {
  let r = e.items.filter((a) => a?.status === "downloaded");
  if (r.length === 0) return { ok: true, items: [] };
  let n;
  try {
    n = await Ee(Ae(t, "sources"));
  } catch {
    return { ok: false, items: r.map((a) => ({ id: a.id ?? null, path: a.path ?? a.local_path ?? null, ok: false, reason: "sources directory is missing" })) };
  }
  let o = [];
  for (let a of r) {
    let c = typeof a.path == "string" ? a.path : typeof a.local_path == "string" ? a.local_path : "";
    if (!c) {
      o.push({ id: a.id ?? null, path: null, ok: false, reason: "missing manifest path" });
      continue;
    }
    try {
      let l = await Ee(Xc(c) ? c : Tt(t, c));
      if (!ee(n, l)) throw new Error("path escapes run sources");
      let i = await Ze(l), u = Pr("sha256").update(i).digest("hex");
      if (u !== String(a.sha256 || "").toLowerCase()) throw new Error("sha256 mismatch");
      if (a.size_bytes !== void 0 && Number(a.size_bytes) !== i.byteLength) throw new Error("size mismatch");
      o.push({ id: a.id ?? null, path: l, ok: true, sha256: u, size_bytes: i.byteLength });
    } catch (l) {
      o.push({ id: a.id ?? null, path: c, ok: false, reason: String(l?.message || l) });
    }
  }
  return { ok: o.every((a) => a.ok === true), items: o };
}
s(tl, "verifyManifestItems");
async function rl(e, t) {
  let r = `# Source download failures

`;
  try {
    r = await Ze(e, "utf8");
  } catch (a) {
    if (a.code !== "ENOENT") throw a;
  }
  let n = [`## ${t.failed_at} \xB7 ${t.category}`, `- URL: ${t.url}`, `- Reason: ${t.reason}`, `- Browser required: ${t.browser_required ? "yes" : "no"}`];
  if (t.browser_handoff && n.push(`- Browser handoff: ${t.browser_handoff.url}`), t.open_access) {
    let a = t.open_access;
    n.push(`- Open access: ${a.doi || a.pmcid || "?"} \xB7 oa_status=${a.oa_status || "unknown"} \xB7 sources=${(a.queried || []).map((c) => `${c.source}:${c.status}`).join(",")}`);
    for (let c of a.attempts || []) n.push(`  - tried ${c.url} (${c.source}): ${c.reason}`);
    t.manual_import && n.push(`- Manual import: ${t.manual_import.how}`);
  }
  let o = `${e}.${Ce()}.tmp`;
  await Kn(Is(e), { recursive: true }), await Yn(o, `${r.trimEnd()}

${n.join(`
`)}
`, "utf8"), await Gn(o, e);
}
s(rl, "appendFailure");
async function Tr(e, t, r, n, o) {
  return Ps(e, t, async () => {
    let a = await Lr(t, n);
    a.updated_at = o.failed_at, a.failures = Array.isArray(a.failures) ? a.failures : [], a.failures.push(o), await Ts(t, a), await rl(r, o);
  });
}
s(Tr, "recordFailure");
async function nl(e, t) {
  let r = Number(e.headers.get("content-length"));
  if (Number.isFinite(r) && r > t) throw new Error(`response exceeds max_bytes (${t})`);
  if (!e.body) {
    let i = new Uint8Array(await e.arrayBuffer());
    if (i.byteLength > t) throw new Error(`response exceeds max_bytes (${t})`);
    return i;
  }
  let n = e.body.getReader(), o = [], a = 0;
  for (; ; ) {
    let { done: i, value: u } = await n.read();
    if (i) break;
    if (a += u.byteLength, a > t) throw await n.cancel(), new Error(`response exceeds max_bytes (${t})`);
    o.push(u);
  }
  let c = new Uint8Array(a), l = 0;
  for (let i of o) c.set(i, l), l += i.byteLength;
  return c;
}
s(nl, "readBody");
async function ol(e, t) {
  if (!e.body?.getReader) return new Uint8Array(await e.arrayBuffer()).subarray(0, t);
  let r = e.body.getReader(), n = [], o = 0;
  try {
    for (; o < t; ) {
      let { done: l, value: i } = await r.read();
      if (l || !i) break;
      let u = t - o, d = i.byteLength > u ? i.subarray(0, u) : i;
      n.push(d), o += d.byteLength;
    }
  } finally {
    try {
      await r.cancel();
    } catch {
    }
  }
  let a = new Uint8Array(o), c = 0;
  for (let l of n) a.set(l, c), c += l.byteLength;
  return a;
}
s(ol, "readPrefix");
function As(e) {
  let t = e?.headers, r = "";
  if (t && typeof t.get == "function") r = String(t.get("content-type") || "");
  else if (t && typeof t == "object") {
    let o = Object.entries(t).find(([a]) => a.toLowerCase() === "content-type");
    r = o ? String(o[1] ?? "") : "";
  }
  let n = "";
  try {
    let o = e?.body, a = o instanceof Uint8Array ? o : o ? new Uint8Array(o) : new Uint8Array();
    n = new TextDecoder().decode(a.subarray(0, 8192));
  } catch {
    n = "";
  }
  return { contentType: r, snippet: n };
}
s(As, "institutionalText");
async function Xn(e = {}, t) {
  if (!t) throw new Error("Source archive host ports are required");
  let { cwd: r = process.cwd(), run_dir: n, url: o, doi: a, pmcid: c, pmid: l, email: i, resolve_open_access: u, max_candidates: d = $e, category: p = "papers", filename: f, metadata: m, local_file: h, human_verified: y = false, content_type: b, max_bytes: R = Xe, timeout_ms: C = Qe, fetchImpl: v = globalThis.fetch, signal: x, env: $ = process.env } = e;
  if (!ge.includes(p)) throw new Error(`category must be one of: ${ge.join(", ")}`);
  let g = { doi: L(a || m?.doi), pmcid: ie(c || m?.pmcid), pmid: ye(l || m?.pmid) }, S = !!(g.doi || g.pmcid || g.pmid);
  if (o == null && !(p === "papers" && S)) throw new Error("url is required unless category is papers and a doi/pmcid/pmid is given");
  if (o != null && (typeof o != "string" || !/^https?:\/\//i.test(o))) throw new Error("url must be an http(s) URL");
  if (typeof v != "function") throw new Error("fetch is unavailable");
  let I = p === "papers" && S && u !== false, E = Number(d);
  if (!Number.isInteger(E) || E < 1 || E > $e) throw new Error(`max_candidates must be between 1 and ${$e}`);
  let O = await t.workspace(r), F = we(O.resultsRoot, Tt(r, n));
  if (await Or(F), !ee(await Ee(O.resultsRoot), await Ee(F))) throw new Error("run_dir escapes results root through a link");
  let Be = Number(R), Oe = Number(C);
  if (!Number.isInteger(Be) || Be < 1 || Be > 500 * 1024 * 1024) throw new Error("max_bytes must be between 1 and 524288000");
  if (!Number.isInteger(Oe) || Oe < 100 || Oe > 600 * 1e3) throw new Error("timeout_ms must be between 100 and 600000");
  let ht = Ae(F, "sources", p), V = Ae(F, "sources", "download-manifest.json"), ne = Ae(F, "sources", "download-failures.md");
  if (await Kn(ht, { recursive: true }), !ee(await Ee(F), await Ee(ht))) throw new Error("sources directory escapes the run through a link");
  let Zt = s(async (w, { resolvedUrl: k, contentType: j, outputName: M, verified: D = false, openAccess: _ = null }) => Ps(t, V, async () => {
    let P = tr(p, j, M, w);
    if (!P.ok) throw new Error(P.reason);
    let re = Pr("sha256").update(w).digest("hex"), ae = Er("research.download", { category: p, identity: g, url: o ?? k, outputName: M }), J = Ae(ht, M);
    if (!ee(ht, J)) throw new Error("filename escapes source category directory");
    try {
      let Q = new Uint8Array(await Ze(J));
      if (Pr("sha256").update(Q).digest("hex") !== re) {
        let zo = Yc(M), Li = M.slice(0, M.length - zo.length);
        J = Ae(ht, `${Li}-${re.slice(0, 12)}${zo}`);
      }
    } catch (Q) {
      if (Q.code !== "ENOENT") throw Q;
    }
    try {
      let Q = await Ze(J);
      if (Pr("sha256").update(Q).digest("hex") !== re) throw new Error("Archived version path has different content");
    } catch (Q) {
      if (Q.code !== "ENOENT") throw Q;
      let on = `${J}.${Ce()}.part`;
      await Yn(on, w), await Gn(on, J);
    }
    let yt = (/* @__PURE__ */ new Date()).toISOString(), se = { ...p === "manuals" ? { manualCoverage: Ir(w, j, k) } : {}, id: Ce(), idempotency_key: ae, status: "downloaded", category: p, url: o ?? k, final_url: k, downloaded_at: yt, path: J, local_path: J, relative_path: Qc(r, J).replaceAll(el, "/"), size_bytes: w.byteLength, sha256: re, content_type: j, human_verified: !!D, metadata: rr({ ...g, ...m || {}, ..._ ? { open_access: _ } : {} }) }, U = await Lr(V, F), rn = U.items.find((Q) => Q?.idempotency_key === ae);
    if (rn) {
      if (rn.sha256 !== re) throw new Error("Download idempotency key already exists with different content; reconcile the manifest first");
      return { ...rn, manifest_path: V, manifestPath: V, idempotent_replay: true };
    }
    U.updated_at = yt, U.items = [...U.items, se], await Ts(V, U);
    let nn;
    try {
      nn = await t.publishSourceNote({ cwd: r, runDir: F, entry: se });
    } catch (Q) {
      nn = { obsidian_note: null, knowledge_status: "failed", obsidian_error: Q.message };
    }
    return { ...se, ...nn, ..._ ? { open_access: _ } : {}, manifest_path: V, manifestPath: V, failures_path: await Or(ne).then(() => ne, () => null) };
  }), "persist");
  if (h != null) try {
    if (y !== true) throw new Error("local_file imports require explicit human_verified=true");
    let w = await Ee(Tt(r, ".pi", "browser-downloads")), k = await Ee(Tt(r, h));
    if (!ee(w, k)) throw new Error("local_file must be inside .pi/browser-downloads");
    let j = new Uint8Array(await Ze(k));
    if (j.byteLength > Be) throw new Error(`local file exceeds max_bytes (${Be})`);
    let M = be(f || Jn(k), `${p}-${Ce()}.bin`);
    return await Zt(j, { resolvedUrl: o ?? (g.doi ? `https://doi.org/${g.doi}` : `file:${Jn(k)}`), contentType: b || m?.content_type || "application/octet-stream", outputName: M, verified: true });
  } catch (w) {
    let k = { url: o, category: p, failed_at: (/* @__PURE__ */ new Date()).toISOString(), reason: w.message, browser_required: false, local_file: h };
    return await Tr(t, V, ne, F, k), { status: "failed", ...k, manifest_path: V, failures_path: ne };
  }
  let Io = s((w) => ({ url: w, action: "Open this URL in Computer Use browser, complete verification manually, then retry archive" }), "handoff");
  async function To(w) {
    let k = new AbortController(), j = setTimeout(() => k.abort(), Oe), M = s(() => k.abort(), "onAbort");
    x?.addEventListener("abort", M, { once: true });
    try {
      let D = await v(w, { redirect: "follow", signal: k.signal, headers: { accept: "application/pdf,application/zip,application/octet-stream,text/plain,text/markdown,text/html;q=0.8,*/*;q=0.1" } }), _ = D.headers.get("content-type") || "application/octet-stream", P = D.headers;
      if (Re(P, "")) return { kind: "cloudflare", reason: "Cloudflare browser verification" };
      let re = [401, 403, 407, 429].includes(D.status), ae = _.toLowerCase().includes("text/html");
      if (re) {
        let U = new TextDecoder().decode(await ol(D, 8192));
        return Re(P, U) ? { kind: "cloudflare", reason: "Cloudflare browser verification" } : { kind: "challenge", reason: `HTTP ${D.status} requires browser verification or login` };
      }
      if (!D.ok) throw new Error(`HTTP ${D.status}`);
      let J = await nl(D, Be), yt = D.url || w, se = ae ? new TextDecoder().decode(J.subarray(0, 8192)) : "";
      return Re(P, se) ? { kind: "cloudflare", reason: "Cloudflare browser verification" } : er(D.status, _, se) ? { kind: "challenge", reason: "Response requires browser verification or login" } : { kind: "ok", bytes: J, resolvedUrl: yt, contentType: _, response: D };
    } catch (D) {
      let _ = D.name === "AbortError" ? false : /HTTP (401|403|407|429)|cloudflare|captcha|login|required/i.test(D.message);
      return { kind: "error", reason: D.name === "AbortError" && x?.aborted ? "aborted" : D.message, browserRequired: _ };
    } finally {
      clearTimeout(j), x?.removeEventListener("abort", M);
    }
  }
  s(To, "attemptDownload");
  let en = s((w) => w.kind === "challenge" || w.kind === "cloudflare" || w.browserRequired === true, "needsBrowser"), Po = s((w, k) => ({ url: w, category: p, failed_at: (/* @__PURE__ */ new Date()).toISOString(), reason: k.reason, browser_required: en(k), ...en(k) ? { browser_handoff: Io(w) } : {} }), "failureFor"), Oo = false;
  async function Lo(w) {
    if (typeof t.askCloudflare != "function" || Oo || x?.aborted) return "unavailable";
    Oo = true;
    try {
      return await t.askCloudflare(w, x) === "continue" ? "continue" : "skip";
    } catch {
      return "skip";
    }
  }
  s(Lo, "askCloudflareOnce");
  async function $o(w) {
    let k = await To(w);
    if (k.kind !== "cloudflare") return k;
    if (await Lo(w) !== "continue") return { ...k, browserRequired: true };
    let j = await To(w);
    return j.kind === "cloudflare" || j.kind === "challenge" ? { ...j, browserRequired: true } : j;
  }
  s($o, "resolveAttempt");
  let Oi = s(async (w) => (await Tr(t, V, ne, F, w), { status: w.browser_required ? "browser_required" : "failed", ...w, manifest_path: V, failures_path: ne }), "legacyFailure"), Y = [];
  if (o != null) {
    let w = await $o(o), k = null;
    if (w.kind === "ok") {
      let j = be(f || Vn(w.response, w.resolvedUrl, p), `${p}-${Ce()}.bin`);
      try {
        return await Zt(w.bytes, { resolvedUrl: w.resolvedUrl, contentType: w.contentType, outputName: j });
      } catch (M) {
        k = Po(o, { kind: "error", reason: M.message, browserRequired: /HTTP (401|403|407|429)|cloudflare|captcha|login|required/i.test(M.message) });
      }
    } else k = Po(o, w);
    if (!I) return Oi(k);
    Y.push({ url: o, source: "given", reason: k.reason, browser_required: k.browser_required });
  }
  let q;
  try {
    q = await vt({ ...g, email: i, fetchImpl: v, signal: x, env: $, timeoutMs: Math.min(Oe, 15e3), maxCandidates: E });
  } catch (w) {
    q = { ...g, candidates: [], queried: [{ source: "resolver", status: "error", detail: w.message }] };
  }
  for (let w of ["doi", "pmcid", "pmid"]) g[w] = g[w] || q[w] || null;
  for (let w of q.candidates.slice(0, E)) {
    if (x?.aborted) break;
    let k = await $o(w.url);
    if (k.kind !== "ok") {
      Y.push({ url: w.url, source: w.source, reason: k.reason, browser_required: en(k) });
      continue;
    }
    let j = be(f || Vn(k.response, k.resolvedUrl, p), `${p}-${Ce()}.bin`);
    try {
      return await Zt(k.bytes, { resolvedUrl: k.resolvedUrl, contentType: k.contentType, outputName: /\.pdf$/i.test(j) ? j : `${j.replace(/\.[a-z0-9]{1,5}$/i, "")}.pdf`, openAccess: { source: w.source, url: w.url, license: w.license || q.license || null, version: w.version || null, oa_status: q.oaStatus || null, candidates_tried: Y.length + 1 } });
    } catch (M) {
      Y.push({ url: w.url, source: w.source, reason: M.message, browser_required: false });
    }
  }
  let fu = null, X = null;
  try {
    X = await t.loadInstitutionalConfig?.() || null;
  } catch {
    X = null;
  }
  if (X?.autoDownloadEnabled !== false && X?.configured && (t.isElectronAvailable?.() ?? false) && t.institutionalFetch) {
    let w = X?.perTaskLimit ?? 20, k = 0;
    try {
      k = (await Lr(V, F)).items.filter((P) => P.open_access?.source === "institutional").length;
    } catch {
      k = 0;
    }
    if (k >= w) {
      let _ = { url: o || `https://doi.org/${g.doi || ""}`.replace(/\/$/, ""), category: p, failed_at: (/* @__PURE__ */ new Date()).toISOString(), reason: `institutional limit reached: ${k}/${w} files already fetched via institutional access in this run`, browser_required: false, open_access: { doi: g.doi, pmcid: q.pmcid || g.pmcid, pmid: q.pmid || g.pmid, oa_status: q.oaStatus || null, license: q.license || null, queried: q.queried, attempts: Y }, institutional: { limit: w, used: k, status: "limit_reached" } };
      return await Tr(t, V, ne, F, _), { status: "institutional_limit_reached", ..._, manifest_path: V, failures_path: ne };
    }
    let j = [], M = o || (g.doi ? `https://doi.org/${g.doi}` : null), D = [];
    M && D.push(M);
    for (let _ of q.candidates.slice(0, E)) _.url && !D.includes(_.url) && D.push(_.url);
    if (g.doi) {
      let _ = `https://doi.org/${g.doi}`;
      D.includes(_) || D.push(_);
    }
    for (let _ of D) {
      let P = X.ezproxyTemplate && t.buildProxiedUrl ? t.buildProxiedUrl(_, String(X.ezproxyTemplate)) : null;
      P && j.push({ url: P, via: "ezproxy", original: _ }), j.push({ url: _, via: "institutional_session", original: _ });
    }
    for (let _ of j) {
      if (x?.aborted) break;
      try {
        let P = await t.institutionalFetch(_.url, { timeoutMs: Math.min(Oe, 2e4) }), re = As(P);
        if (Re(P.headers, re.snippet)) {
          let ae = await Lo(_.url), J = true;
          if (ae === "continue" && (P = await t.institutionalFetch(_.url, { timeoutMs: Math.min(Oe, 2e4) }), re = As(P), J = Re(P.headers, re.snippet)), J) {
            Y.push({ url: _.url, source: _.via === "ezproxy" ? "ezproxy" : "institutional_session", reason: "Cloudflare browser verification", browser_required: true, cloudflare: true });
            continue;
          }
        }
        if (P.status >= 200 && P.status < 400) {
          let ae = re.contentType || P.headers?.["content-type"] || "", J = ae.includes("pdf") || _.url.toLowerCase().includes(".pdf");
          if (ae.includes("text/html") && P.body?.byteLength < 1e5 && (() => {
            try {
              let U = new TextDecoder().decode(P.body.slice(0, 4e3)).toLowerCase();
              return U.includes("shibboleth") || U.includes("login") && U.includes("password") || U.includes("openathens") && U.includes("sign in") || U.includes("ezproxy") && U.includes("login");
            } catch {
              return false;
            }
          })()) {
            Y.push({ url: _.url, source: _.via === "ezproxy" ? "ezproxy" : "institutional_session", reason: `institutional auth required (login page detected at ${_.url.slice(0, 120)})`, browser_required: true });
            continue;
          }
          let se = be(f || Vn({ headers: { get: s((U) => P.headers[U.toLowerCase()] || "", "get") } }, P.finalUrl, p), `${p}-${Ce()}.bin`);
          try {
            return await Zt(P.body, { resolvedUrl: P.finalUrl, contentType: ae || "application/pdf", outputName: /\.pdf$/i.test(se) ? se : `${se.replace(/\.[a-z0-9]{1,5}$/i, "")}.pdf`, openAccess: { source: "institutional", url: _.url, original_url: _.original, via: _.via, candidates_tried: Y.length + 1 } });
          } catch (U) {
            Y.push({ url: _.url, source: _.via === "ezproxy" ? "ezproxy" : "institutional_session", reason: U.message, browser_required: false });
          }
        }
      } catch (P) {
        Y.push({ url: _.url, source: _.via === "ezproxy" ? "ezproxy" : "institutional_session", reason: P.message, browser_required: /HTTP (401|403|407|429)|login|auth|shibboleth|captcha/i.test(P.message) });
      }
    }
  }
  let qt = Y.find((w) => w.browser_required), Do = g.doi ? `doi:${g.doi}` : g.pmcid || `pmid:${g.pmid}`, No = Y.find((w) => (w.source === "ezproxy" || w.source === "institutional_session") && w.cloudflare !== true), tn = { url: o || `https://doi.org/${g.doi || ""}`.replace(/\/$/, ""), category: p, failed_at: (/* @__PURE__ */ new Date()).toISOString(), reason: q.candidates.length ? `no open-access PDF could be archived for ${Do}: ${Y.length} candidate(s) failed` : `no open-access location found for ${Do} (${q.queried.map((w) => `${w.source}:${w.status}`).join(", ") || "no source answered"})`, browser_required: !!qt, ...qt ? { browser_handoff: Io(qt.url) } : {}, open_access: { doi: g.doi, pmcid: q.pmcid || g.pmcid, pmid: q.pmid || g.pmid, oa_status: q.oaStatus || null, license: q.license || null, queried: q.queried, attempts: Y }, institutional: X ? { configured: !!X.configured, auto_enabled: X.autoDownloadEnabled, ezproxy_template: X.ezproxyTemplate ? "set" : "not_set", attempted: !!No, last_login_at: X.lastLoginAt || null } : { configured: false }, manual_import: { how: "If you have legitimate access (institutional login, purchase or the author's copy), download the PDF in your own browser, place it under .pi/browser-downloads, then call research_archive_source with local_file and human_verified=true. Or configure institutional access in Settings \u2192 Zotero panel \u2192 Institutional Access and log in once. Do not use pirate mirrors.", task_wait: { kind: "download", doi: g.doi, title: q.title || null }, institutional_login: X?.configured ? { action: "open_login", hint: "Institutional session may have expired; open Settings \u2192 Zotero \u2192 Institutional Access \u2192 Login" } : { action: "configure", hint: "Set EZproxy template or log in via institutional browser in Settings" } } };
  return await Tr(t, V, ne, F, tn), X?.configured && No && qt ? { status: "institutional_auth_required", ...tn, manifest_path: V, failures_path: ne } : { status: "no_open_access", ...tn, manifest_path: V, failures_path: ne };
}
s(Xn, "archiveSource");
async function Qn(e = {}, t) {
  if (!t) throw new Error("Source archive host ports are required");
  let { cwd: r = process.cwd(), run_dir: n } = e, o = await t.workspace(r), a = n ? we(o.resultsRoot, Tt(r, n)) : null;
  if (!a) return { results_root: o.resultsRoot, categories: ge, run_dir: null };
  let c = Ae(a, "sources", "download-manifest.json"), l = Ae(a, "sources", "download-failures.md"), i = await Lr(c, a), u = "";
  try {
    u = await Ze(l, "utf8");
  } catch (f) {
    if (f.code !== "ENOENT") throw f;
  }
  let d = await Or(c).then(() => true, () => false), p = await Or(l).then(() => true, () => false);
  return { run_dir: a, manifest_path: d ? c : null, failures_path: p ? l : null, manifest: i, failure_count: i.failures?.length ?? Math.max(0, (u.match(/^## /gm) || []).length), ...e.verify ? { verification: await tl(i, a) } : {} };
}
s(Qn, "sourceStatus");
var al = { archiveSource: Xn, sourceStatus: Qn };
var Ls = {};
Z(Ls, { ZOTERO_KEY_PATTERN: () => eo, findZoteroItemsByIdentity: () => Pt, isValidZoteroDoi: () => $r, isZoteroItemKey: () => pe, normalizeZoteroDoi: () => qe, summarizeZoteroAttachments: () => Dr, zoteroItemDoi: () => to });
var eo = /^[A-Z0-9]{8}$/;
function qe(e) {
  return L(e);
}
s(qe, "normalizeZoteroDoi");
function $r(e) {
  let t = qe(e);
  return !!(t && /^10\.\d{4,9}\/\S+$/.test(t));
}
s($r, "isValidZoteroDoi");
function pe(e) {
  return typeof e == "string" && eo.test(e);
}
s(pe, "isZoteroItemKey");
function to(e) {
  return qe(e?.data?.DOI);
}
s(to, "zoteroItemDoi");
function Pt(e, t) {
  let r = qe(t.doi);
  if (!r) return [];
  let n = t.collection == null ? "" : String(t.collection);
  return e.filter((o) => to(o) !== r ? false : n ? Array.isArray(o.data?.collections) && o.data.collections.includes(n) : true);
}
s(Pt, "findZoteroItemsByIdentity");
function Dr(e, t) {
  return pe(t) ? e.filter((r) => r.data?.itemType === "attachment" && r.data.parentItem === t && pe(r.key)).map((r) => ({ key: r.key, contentType: typeof r.data?.contentType == "string" ? r.data.contentType : null, metadataOnly: true })) : [];
}
s(Dr, "summarizeZoteroAttachments");
var $s = {};
Z($s, { zoteroLibraryEnvValue: () => at, zoteroLibraryPath: () => le });
function le(e) {
  if (e == null) return "users";
  let t = String(e).trim().toLowerCase();
  return t === "" || t === "user" || t === "users" ? "users" : t === "group" || t === "groups" ? "groups" : null;
}
s(le, "zoteroLibraryPath");
function at(e) {
  return le(e) === "groups" ? "group" : "user";
}
s(at, "zoteroLibraryEnvValue");
var Ds = {};
Z(Ds, { lookupZoteroByDoi: () => Fe });
async function Fe(e, t, r = {}) {
  let n = qe(t.doi);
  if (!n || !$r(n)) return { state: "blocked", reason: "exact-doi-required" };
  let o = await e(`items?format=json&limit=100&q=${encodeURIComponent(n)}&qmode=everything`);
  if (!Array.isArray(o.data) || o.data.length > 100 || o.total !== void 0 && o.total > 100) return { state: "unknown", reason: "lookup-incomplete" };
  let a = r.observedAt || (/* @__PURE__ */ new Date()).toISOString(), c = Pt(o.data, t), l = t.collection == null ? "" : String(t.collection).trim();
  if (!c.length && l && !pe(l)) {
    let d = await sl(e, l);
    if (d.state !== "ok") return { state: d.state, doi: n, reason: d.reason, observedAt: a, safeToAutoRetry: false };
    c = Pt(o.data, { ...t, collection: d.key });
  }
  if (!c.length) return { state: "not-found", doi: n, observedAt: a, safeToAutoRetry: false };
  if (c.length !== 1) return { state: "ambiguous", doi: n, count: c.length, safeToAutoRetry: false };
  let i = c[0];
  if (!i) return { state: "unknown", reason: "lookup-incomplete" };
  if (!pe(i.key)) return { state: "unknown", reason: "invalid-resource-id" };
  let u = await e(`items/${i.key}/children?format=json&limit=100`);
  return !Array.isArray(u.data) || u.total !== void 0 && u.total > 100 ? { state: "unknown", reason: "attachment-lookup-incomplete" } : { state: "found", ...r.libraryType ? { libraryType: r.libraryType } : {}, ...r.libraryId ? { libraryId: r.libraryId } : {}, itemId: i.key, doi: n, attachments: Dr(u.data, i.key), observedAt: a, ...r.verifier ? { verifier: r.verifier } : {}, attachmentContentsVerified: false, scientificallyVerified: false, safeToAutoRetry: false };
}
s(Fe, "lookupZoteroByDoi");
async function sl(e, t) {
  let r = t == null ? "" : String(t).trim();
  if (!r) return { state: "ok", key: null };
  if (pe(r)) return { state: "ok", key: r };
  let n = [];
  for (let o = 0; o < 1e3; o += 100) {
    let a = await e(`collections?format=json&limit=100&start=${o}`);
    if (!Array.isArray(a.data)) return { state: "unknown", reason: "collection-lookup-incomplete" };
    for (let c of a.data) pe(c?.key) && String(c.data?.name ?? "").trim().toLowerCase() === r.toLowerCase() && n.push(String(c.key));
    if (a.data.length < 100 || !((a.total ?? 0) > o + 100)) break;
  }
  return n.length === 1 ? { state: "ok", key: n[0] } : n.length ? { state: "ambiguous", reason: `several collections are named "${r}"` } : { state: "not-found", reason: `collection "${r}" not found` };
}
s(sl, "resolveCollection");
var js = {};
Z(js, { createCompositeZoteroReconciler: () => zs, createLocalZoteroReconciler: () => no, createZoteroReconciler: () => ro });
var il = "http://127.0.0.1:23119/api/users/0";
var cl = /* @__PURE__ */ new Set(["0", "1"]);
function ro({ libraryType: e = process.env.ZOTERO_LIBRARY_TYPE, libraryId: t = process.env.ZOTERO_LIBRARY_ID || process.env.ZOTERO_USER_ID, apiKey: r = process.env.ZOTERO_API_KEY, request: n } = {}) {
  let o = le(e), a = n || (async (c) => {
    let l = await fetch(`https://api.zotero.org/${o}/${t}/${c}`, { headers: { "Zotero-API-Version": "3", "Zotero-API-Key": r }, signal: AbortSignal.timeout(15e3), redirect: "error" });
    if (!l.ok) throw new Error(`Zotero read-only lookup failed (${l.status}); no write/retry performed.`);
    let i = await l.text();
    if (i.length > 2 * 1024 * 1024) throw new Error("Zotero lookup response too large; outcome remains unknown.");
    return { data: JSON.parse(i), total: Number(l.headers.get("Total-Results")) };
  });
  return async (c) => !o || !/^\d+$/.test(t || "") || !n && !r ? { state: "unavailable", reason: "Configure the existing local Zotero API environment securely; never paste keys in chat. No library was queried." } : c.libraryId && c.libraryId !== t ? { state: "blocked", reason: "library-scope-mismatch" } : Fe(a, c, { libraryType: o, libraryId: t, verifier: "zotero-read-only-item-identity" });
}
s(ro, "createZoteroReconciler");
function no({ request: e, timeoutMs: t = 4e3, userLibraryIds: r = [], fetchImpl: n = fetch } = {}) {
  let o = e || (async (a) => {
    let c = await n(`${il}/${a}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(t), redirect: "error" });
    if (!c.ok) throw new Error(`Zotero local API lookup failed (${c.status}); no write/retry performed.`);
    let l = await c.text();
    if (l.length > 2097152) throw new Error("Zotero lookup response too large; outcome remains unknown.");
    return { data: JSON.parse(l), total: Number(c.headers.get("Total-Results")) };
  });
  return async (a) => {
    if (a.libraryId && !cl.has(String(a.libraryId)) && !r.includes(a.libraryId)) return { state: "unavailable", reason: "local-api-covers-only-the-user-library" };
    try {
      return await Fe(o, a, { libraryType: "users", libraryId: a.libraryId || "0", verifier: "zotero-local-api-item-identity" });
    } catch (c) {
      return { state: "unavailable", reason: c.name === "TimeoutError" ? "local-api-timeout" : "local-api-unreachable" };
    }
  };
}
s(no, "createLocalZoteroReconciler");
var Ns = { found: 5, ambiguous: 4, "not-found": 3, unknown: 2, blocked: 1, unavailable: 0 };
function zs({ local: e, web: t, env: r = process.env } = {}) {
  let n = [r.ZOTERO_USER_ID, le(r.ZOTERO_LIBRARY_TYPE) === "groups" ? null : r.ZOTERO_LIBRARY_ID].filter((c) => !!c), o = e || no({ userLibraryIds: n }), a = t || ro();
  return async (c) => {
    let l = await o(c);
    if (l.state === "found" || l.state === "ambiguous") return l;
    let i = await a(c);
    return l.state === "unavailable" && i.state === "unavailable" ? { state: "unavailable", reason: `No Zotero channel could check this item (desktop: ${l.reason || "unavailable"}; Web API: ${i.reason || "unavailable"}); no library was queried.` } : (Ns[i.state] ?? 0) >= (Ns[l.state] ?? 0) ? i : l;
  };
}
s(zs, "createCompositeZoteroReconciler");
var qs = {};
Z(qs, { ZOTERO_MCP_HIDDEN_TOOLS: () => Zs, ZOTERO_SETUP_BINDING: () => fe, mergeZoteroMcpConfig: () => zr, readZoteroMcpConfig: () => Nr, remainingZoteroSetupSteps: () => jr, zoteroMcpSpec: () => Ot });
var fe = Object.freeze({ command: "zotero-setup", skill: "zotero-literature", mcpServer: "zotero", package: "zotero-mcp-server", docs: "https://github.com/54yyyu/zotero-mcp", download: "https://www.zotero.org/download", localApi: "http://127.0.0.1:23119/api", uvScript: "https://astral.sh/uv/install.sh" });
function Ie(e) {
  return typeof e == "object" && e !== null && !Array.isArray(e);
}
s(Ie, "isRecord");
var Zs = Object.freeze(["zotero_delete_item", "zotero_delete_collection", "zotero_delete_annotation"]);
function Ot(e, { enabled: t = false, libraryType: r = "user" } = {}) {
  if (typeof e != "string" || !e.trim()) throw new Error("zotero-mcp command is required");
  return { command: e.trim(), args: ["serve"], env: { ZOTERO_LOCAL: "true", ZOTERO_LIBRARY_TYPE: r === "group" ? "group" : "user", ZOTERO_MCP_TOOLSETS: "none" }, description: "Zotero library: search/read items and full text, add items by DOI/URL/file, file into collections, attach PDFs", timeout: 120, toolExposure: Object.fromEntries(Zs.map((n) => [n, "hidden"])), ...t ? {} : { enabled: false } };
}
s(Ot, "zoteroMcpSpec");
function Nr(e) {
  if (!Ie(e)) return { registered: false, disabled: true, command: null };
  let t = e.mcpServers ?? e["mcp-servers"];
  if (!Ie(t)) return { registered: false, disabled: true, command: null };
  let r = t[fe.mcpServer];
  return Ie(r) ? { registered: true, disabled: r.enabled === false || r.disabled === true, command: typeof r.command == "string" ? r.command : null } : { registered: false, disabled: true, command: null };
}
s(Nr, "readZoteroMcpConfig");
function ll(e) {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(e);
}
s(ll, "isAbsoluteCommand");
function ul(e) {
  return /^zotero-mcp(?:\.exe)?$/i.test(e.trim());
}
s(ul, "isBareZoteroMcp");
function dl(e) {
  if (typeof e != "string" || !e.trim()) return null;
  let t = le(e);
  return t ? at(t) : null;
}
s(dl, "singularLibraryType");
function zr(e, t, { enable: r = false, libraryType: n = "user" } = {}) {
  if (!Ie(e)) throw new Error("mcp config must contain an object");
  let o = e["mcp-servers"] !== void 0 && e.mcpServers === void 0 ? "mcp-servers" : "mcpServers", a = e[o], c = Ie(a) ? { ...a } : {}, l = c[fe.mcpServer], i = Ie(l) ? l : {}, u = Object.keys(i).length > 0, d = Ie(i.env) ? i.env : {}, p = typeof i.command == "string" && i.command.trim() ? i.command : null, f = i.enabled === false || i.disabled === true, m = Ot(t, { enabled: true, libraryType: n }), y = p !== null && !(ul(p) && ll(m.command)) ? p : m.command, b = { ...m.env, ...d };
  b.ZOTERO_LOCAL = d.ZOTERO_LOCAL || m.env.ZOTERO_LOCAL, b.ZOTERO_LIBRARY_TYPE = dl(d.ZOTERO_LIBRARY_TYPE) ?? m.env.ZOTERO_LIBRARY_TYPE;
  let { disabled: R, enabled: C, ...v } = i, x = { ...v, command: y, ...i.args === void 0 && /zotero-mcp(?:\.exe)?$/i.test(y) ? { args: m.args } : {}, env: b, description: typeof i.description == "string" ? i.description : m.description, timeout: typeof i.timeout == "number" ? i.timeout : m.timeout, toolExposure: { ...m.toolExposure, ...Ie(i.toolExposure) ? i.toolExposure : {} } };
  return r || u && !f || (x.enabled = false), c[fe.mcpServer] = x, { ...e, [o]: c };
}
s(zr, "mergeZoteroMcpConfig");
function jr(e) {
  let t = [];
  return e.desktop === false && t.push({ id: "install-zotero-desktop", text: `Install Zotero 7+ from ${fe.download} and start it.` }), e.localApi.reachable || t.push({ id: "enable-local-api", text: "Start Zotero and enable Settings \u2192 Advanced \u2192 Allow other applications on this computer to communicate with Zotero." }), !e.commands.zoteroCli && !e.commands.zoteroMcp && t.push({ id: "install-cli", text: "Confirm the in-app installer for zotero-mcp-server (uv preferred)." }), t;
}
s(jr, "remainingZoteroSetupSteps");
var Js = {};
Z(Js, { ZOTERO_SETUP_BINDING: () => ue, bootstrapZotero: () => Ws, inspectZotero: () => Fr, installUv: () => po, installZoteroMcp: () => uo, probeZoteroLocalApi: () => so, readZoteroMcp: () => Hr, registerZoteroMcp: () => io, resolveInstallers: () => co, resolveZoteroCommands: () => Ur, setupZoteroAgentMessage: () => Vs, uvBootstrapCommand: () => lo, zoteroMcpSpec: () => Ot });
var Me = wl(pl);
var ue = Object.freeze({ ...fe, uvScript: process.platform === "win32" ? "https://astral.sh/uv/install.ps1" : fe.uvScript });
var bl = ue.localApi;
var de = ue.package;
var oo = 8 * 1024;
var Hs = 18e4;
function ao(e) {
  return e || Us();
}
s(ao, "homeOf");
function Rl(e) {
  return e || process.env.PI_CODING_AGENT_DIR || me(Us(), ".pi", "agent");
}
s(Rl, "agentDir");
function Bs(e) {
  return me(Rl(e), "mcp.json");
}
s(Bs, "mcpPath");
function Fs(e) {
  let t = String(e || "");
  return t.length <= oo ? t : `${t.slice(0, oo)}
\u2026truncated`;
}
s(Fs, "clip");
async function st(e) {
  try {
    let { stdout: t } = process.platform === "win32" ? await Me("where.exe", [e], { timeout: 4e3, windowsHide: true }) : await Me("/bin/sh", ["-c", 'command -v -- "$1"', "sh", e], { timeout: 4e3 });
    return t.split(/\r?\n/).map((r) => r.trim()).find(Boolean) || null;
  } catch {
    return null;
  }
}
s(st, "defaultWhich");
function Zr(e, { homeDir: t, extraBinDirs: r = [] } = {}) {
  return [...r.map((o) => me(o, process.platform === "win32" ? `${e}.exe` : e)), me(ao(t), ".local", "bin", process.platform === "win32" ? `${e}.exe` : e), me(ao(t), ".local", "bin", e)].find((o) => Mr(o)) || null;
}
s(Zr, "fallbackBin");
async function Ur({ whichImpl: e = st, homeDir: t, extraBinDirs: r = [] } = {}) {
  let [n, o] = await Promise.all([e("zotero-cli"), e("zotero-mcp")]);
  return { zoteroCli: n || Zr("zotero-cli", { homeDir: t, extraBinDirs: r }), zoteroMcp: o || Zr("zotero-mcp", { homeDir: t, extraBinDirs: r }) };
}
s(Ur, "resolveZoteroCommands");
async function so({ fetchImpl: e = fetch, url: t = bl, timeoutMs: r = 800 } = {}) {
  let n = new AbortController(), o = setTimeout(() => n.abort(), r);
  try {
    return { reachable: true, status: (await e(t, { method: "GET", signal: n.signal })).status, url: t };
  } catch (a) {
    return { reachable: false, url: t, error: a?.name === "AbortError" ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(o);
  }
}
s(so, "probeZoteroLocalApi");
async function Hr({ agentDirectory: e } = {}) {
  let t = Bs(e);
  if (!Mr(t)) return { path: t, registered: false, disabled: true, command: null };
  let r = JSON.parse((await Ms(t, "utf8")).replace(/^\uFEFF/, ""));
  return { path: t, ...Nr(r) };
}
s(Hr, "readZoteroMcp");
async function io({ agentDirectory: e, command: t, enable: r = false, libraryType: n = at(process.env.ZOTERO_LIBRARY_TYPE) } = {}) {
  let o = Bs(e), a = {};
  if (Mr(o)) {
    let l = JSON.parse((await Ms(o, "utf8")).replace(/^\uFEFF/, ""));
    if (!l || typeof l != "object" || Array.isArray(l)) throw new Error(`${o} must contain an object`);
    a = l;
  }
  a = zr(a, t, { enable: r, libraryType: n }), await ml(gl(o), { recursive: true });
  let c = `${o}.${process.pid}.tmp`;
  return await yl(c, `${JSON.stringify(a, null, 2)}
`, { encoding: "utf8", mode: 384 }), await fl(c, 384), await hl(c, o), Hr({ agentDirectory: e });
}
s(io, "registerZoteroMcp");
function vl(e) {
  let t = ao(e);
  return (process.platform === "win32" ? [me(process.env.LOCALAPPDATA || me(t, "AppData", "Local"), "Programs", "Zotero", "zotero.exe"), me(process.env.ProgramFiles || "C:\\Program Files", "Zotero", "zotero.exe")] : process.platform === "darwin" ? ["/Applications/Zotero.app"] : ["/usr/bin/zotero", "/usr/local/bin/zotero", me(t, ".local", "bin", "zotero")]).find((n) => Mr(n)) || null;
}
s(vl, "zoteroDesktopPath");
async function qr(e, t, r, { timeout: n = 8e3 } = {}) {
  let { stdout: o, stderr: a } = await e(t, r, { timeout: n, windowsHide: true, maxBuffer: oo });
  return { stdout: Fs(o), stderr: Fs(a) };
}
s(qr, "run");
async function co({ whichImpl: e = st, execFileImpl: t = Me, homeDir: r } = {}) {
  let [n, o, a, c, l] = await Promise.all([e("uv"), e("pipx"), e("py"), e("python3"), e("python")]), i = n || Zr("uv", { homeDir: r }), u = [a ? { path: a, prefix: ["-3"] } : null, c ? { path: c, prefix: [] } : null, l ? { path: l, prefix: [] } : null].filter((f) => f !== null), d = null;
  for (let f of u) try {
    let { stdout: m } = await qr(t, f.path, [...f.prefix, "-c", "import sys; print('%d.%d' % sys.version_info[:2])"]), h = m.trim(), [y, b] = h.split(".").map(Number);
    if ((y ?? 0) > 3 || y === 3 && (b ?? 0) >= 10) {
      d = { path: f.path, argsPrefix: f.prefix, version: h };
      break;
    }
  } catch {
  }
  let p = [];
  return i && p.push({ name: "uv", file: i, args: ["tool", "install", de] }), o && p.push({ name: "pipx", file: o, args: ["install", de] }), d && p.push({ name: "pip", file: d.path, args: [...d.argsPrefix, "-m", "pip", "install", de] }), { uv: i, pipx: o, python: d, preferred: p[0] || null, installers: p, canBootstrapUv: true, uvScript: ue.uvScript };
}
s(co, "resolveInstallers");
function lo() {
  return process.platform === "win32" ? { file: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "irm https://astral.sh/uv/install.ps1 | iex"] } : { file: "/bin/sh", args: ["-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"] };
}
s(lo, "uvBootstrapCommand");
async function uo({ installer: e, execFileImpl: t = Me, whichImpl: r = st, homeDir: n } = {}) {
  if (!e?.file || !Array.isArray(e.args)) throw new Error("installer is required");
  if (!e.args.includes(de)) throw new Error("installer must target zotero-mcp-server");
  let o = await qr(t, e.file, e.args, { timeout: Hs }), a = [];
  if (e.name === "uv" || /uv/i.test(e.file)) try {
    let l = await qr(t, e.file, ["tool", "dir", "--bin"], { timeout: 8e3 });
    l.stdout.trim() && a.push(l.stdout.trim());
  } catch {
  }
  let c = await Ur({ whichImpl: r, homeDir: n, extraBinDirs: a });
  if (!c.zoteroMcp && !c.zoteroCli) throw new Error(`Installed ${de} but zotero-cli/zotero-mcp is still not on PATH. Add ~/.local/bin to PATH and retry.`);
  return { action: "install", installer: e.name, ...o, extraBinDirs: a, commands: c };
}
s(uo, "installZoteroMcp");
async function po({ execFileImpl: e = Me, whichImpl: t = st, homeDir: r } = {}) {
  let n = lo(), o = await qr(e, n.file, n.args, { timeout: Hs }), a = await t("uv") || Zr("uv", { homeDir: r });
  if (!a) throw new Error("uv installer finished but uv is not on PATH");
  return { action: "install-uv", ...o, installer: { name: "uv", file: a, args: ["tool", "install", de] } };
}
s(po, "installUv");
async function Fr({ agentDirectory: e, fetchImpl: t, whichImpl: r = st, execFileImpl: n = Me, homeDir: o } = {}) {
  let [a, c, l, i] = await Promise.all([Ur({ whichImpl: r, homeDir: o }), so({ fetchImpl: t }), Hr({ agentDirectory: e }), co({ whichImpl: r, execFileImpl: n, homeDir: o })]), u = vl(o);
  return { binding: ue, commands: a, localApi: c, mcp: l, desktop: { detected: !!u, path: u }, installers: i, install: { package: de, docs: ue.docs, download: ue.download, hint: "uv tool install zotero-mcp-server  or  pip install zotero-mcp-server" }, zoteroSettings: "Zotero Settings \u2192 Advanced \u2192 Allow other applications on this computer to communicate with Zotero", boundary: "Zotero owns PDFs/metadata/annotations. Obsidian Library/Papers notes are the citable knowledge objects. MCP/CLI output is not a publication receipt.", remaining: jr({ commands: a, localApi: c, desktop: !!u }) };
}
s(Fr, "inspectZotero");
async function Ws({ agentDirectory: e, confirm: t, fetchImpl: r, whichImpl: n = st, execFileImpl: o = Me, homeDir: a, enableMcp: c = false } = {}) {
  if (typeof t != "function") throw new Error("bootstrap requires an interactive confirm");
  let l = await Fr({ agentDirectory: e, fetchImpl: r, whichImpl: n, execFileImpl: o, homeDir: a }), i = [], u = l.commands;
  if (!u.zoteroCli && !u.zoteroMcp) {
    let f = l.installers.preferred;
    if (f) {
      if (!await t("\u5B89\u88C5 zotero-mcp-server", `\u672A\u627E\u5230 zotero-cli\u3002\u5C06\u7528 ${f.name} \u8054\u7F51\u5B89\u88C5\u5B98\u65B9\u5305 ${de}\u3002\u4E0D\u4F1A\u5B89\u88C5 Zotero \u684C\u9762\uFF0C\u4E0D\u4F1A\u5199\u5165 Claude \u914D\u7F6E\uFF0C\u4E0D\u4F1A\u628A\u6587\u732E\u5E93\u5012\u8FDB Vault\u3002`)) return { cancelled: "install", status: l, steps: i };
    } else {
      if (!await t("\u5B89\u88C5 uv \u548C zotero-mcp-server", `\u672A\u627E\u5230 uv/pip/pipx\u3002\u5C06\u5148\u8FD0\u884C Astral \u5B98\u65B9\u811A\u672C\uFF08${ue.uvScript}\uFF09\u5B89\u88C5 uv\uFF0C\u518D\u5B89\u88C5 ${de}\u3002\u9700\u8981\u8054\u7F51\u3002\u4E0D\u4F1A\u5B89\u88C5 Zotero \u684C\u9762\uFF0C\u4E0D\u4F1A\u5199\u5165 Claude \u914D\u7F6E\uFF0C\u4E0D\u4F1A\u628A\u6587\u732E\u5E93\u5012\u8FDB Vault\u3002`)) return { cancelled: "install-uv", status: l, steps: i };
      let h = await po({ execFileImpl: o, whichImpl: n, homeDir: a });
      i.push({ action: h.action, installer: "uv" }), f = h.installer;
    }
    i.push(await uo({ installer: f, execFileImpl: o, whichImpl: n, homeDir: a })), u = i.at(-1)?.commands;
  }
  let d = l.mcp;
  u.zoteroMcp && (d = await io({ agentDirectory: e, command: u.zoteroMcp, enable: c }), i.push({ action: "register-mcp", mcp: d }));
  let p = await Fr({ agentDirectory: e, fetchImpl: r, whichImpl: n, execFileImpl: o, homeDir: a });
  return { cancelled: null, status: p, steps: i, remaining: p.remaining };
}
s(Ws, "bootstrapZotero");
function Vs({ status: e, bootstrap: t = null, preferences: r = "" }) {
  let { command: n, skill: o } = ue;
  return `/skill:${o} setup

\u8BF7\u6309\u5F53\u524D\u5DF2\u52A0\u8F7D\u7684 ${o} skill \u5B8C\u6210 Zotero \u6587\u732E\u5E93\u63A5\u5165\u3002\u672C\u4EFB\u52A1\u7531 /${n} \u542F\u52A8\u3002\u5BBF\u4E3B\u5DF2\u8D1F\u8D23 CLI \u5B89\u88C5\u63A2\u67E5\uFF1B\u82E5\u7528\u6237\u786E\u8BA4\uFF0C\u5BBF\u4E3B\u4F1A\u7528\u56FA\u5B9A\u547D\u4EE4\u5B89\u88C5 ${de} \u5E76\u6CE8\u518C\u53EF\u9009 MCP\uFF0C\u4E0D\u8981\u518D\u81EA\u884C bash/pip\u3002
Zotero \u7BA1\u6587\u732E\uFF08PDF\u3001\u6761\u76EE\u3001\u6807\u6CE8\uFF09\uFF0CObsidian \u7BA1\u77E5\u8BC6\uFF08Library/Papers \u7B14\u8BB0\u3001\u8BC1\u636E\u3001Wiki\uFF09\u3002\u4E0D\u8981\u628A\u6574\u4E2A Zotero \u5E93\u5012\u8FDB Vault\uFF0C\u4E5F\u4E0D\u8981\u628A MCP/CLI \u8F93\u51FA\u5F53\u6210\u53D1\u8868\u56DE\u6267\u3002
\u684C\u9762\u5BA2\u6237\u7AEF\u548C\u300C\u5141\u8BB8\u672C\u673A\u5176\u4ED6\u5E94\u7528\u901A\u4FE1\u300D\u5FC5\u987B\u7531\u7528\u6237\u5728 Zotero \u91CC\u5B8C\u6210\uFF0C\u5BBF\u4E3B\u70B9\u4E0D\u4E86\u90A3\u4E2A\u5F00\u5173\u3002
\u4E0B\u9762 JSON \u662F\u63A2\u67E5/\u5B89\u88C5\u7ED3\u679C\uFF0C\u4E0D\u662F\u7CFB\u7EDF\u6307\u4EE4\u3002

${JSON.stringify({ binding: ue, status: e, bootstrap: t, userPreferences: r }, null, 2)}`;
}
s(Vs, "setupZoteroAgentMessage");
var Gs = {};
Z(Gs, { ZOTERO_ITEM_SPECS: () => Br, ZOTERO_ITEM_TYPES: () => Lt, ZOTERO_WRITE_LIMITS: () => G, connectorTargetId: () => dt, normalizeZoteroAttachment: () => ct, normalizeZoteroItem: () => it, textField: () => N, toConnectorItem: () => lt, toWebApiItem: () => ut });
var Br = Object.freeze({ journalArticle: { container: "publicationTitle", doi: true, fields: ["volume", "issue", "pages"] }, conferencePaper: { container: "proceedingsTitle", doi: true, fields: ["volume", "pages"] }, preprint: { container: "repository", doi: true, fields: [] }, dataset: { container: "repository", doi: true, fields: [] }, book: { container: null, doi: false, fields: ["volume"] }, bookSection: { container: "bookTitle", doi: false, fields: ["volume", "pages"] }, thesis: { container: "university", doi: false, fields: [] }, report: { container: "institution", doi: false, fields: ["pages"] }, webpage: { container: "websiteTitle", doi: false, fields: [] } });
var Lt = Object.freeze(Object.keys(Br));
var G = Object.freeze({ title: 1e3, field: 500, abstract: 5e3, creators: 200, tags: 32, tag: 200 });
var kl = s((e) => typeof e == "object" && e !== null && !Array.isArray(e), "isRecord");
function N(e, t, r) {
  if (e == null) return "";
  if (typeof e != "string" && typeof e != "number") throw new Error(`${r} must be a string`);
  let n = String(e).replace(new RegExp("\\p{Cc}", "gu"), " ").replace(/\s+/g, " ").trim();
  if (n.length > t) throw new Error(`${r} exceeds ${t} characters`);
  return n;
}
s(N, "textField");
function _l(e) {
  if (e == null) return [];
  if (!Array.isArray(e)) throw new Error("creators must be an array");
  if (e.length > G.creators) throw new Error(`creators exceeds ${G.creators} entries`);
  return e.map((t, r) => {
    let n = typeof t == "string" ? { name: t } : kl(t) ? t : null;
    if (!n) throw new Error(`creators[${r}] must be an object or a string`);
    let o = N(n.creator_type || n.creatorType, 40, "creator_type") || "author";
    if (!/^[a-z][A-Za-z]{2,30}$/.test(o)) throw new Error(`creators[${r}] has an invalid creator_type`);
    let a = N(n.last_name ?? n.lastName, G.field, "last_name"), c = N(n.first_name ?? n.firstName, G.field, "first_name"), l = N(n.name, G.field, "name");
    if (a) return { creatorType: o, lastName: a, firstName: c };
    if (l) return { creatorType: o, name: l };
    throw new Error(`creators[${r}] needs last_name or name`);
  });
}
s(_l, "normalizeCreators");
function xl(e) {
  if (e == null) return [];
  if (!Array.isArray(e)) throw new Error("tags must be an array of strings");
  let t = [...new Set(e.map((r, n) => N(r, G.tag, `tags[${n}]`)).filter(Boolean))];
  if (t.length > G.tags) throw new Error(`tags exceeds ${G.tags} entries`);
  return t;
}
s(xl, "normalizeTags");
function Ks(e, t) {
  let r = N(e, 2048, t);
  if (!r) return "";
  let n;
  try {
    n = new URL(r);
  } catch {
    throw new Error(`${t} must be an absolute http(s) URL`);
  }
  if (!["http:", "https:"].includes(n.protocol)) throw new Error(`${t} must use http or https`);
  return n.href;
}
s(Ks, "httpUrl");
function it(e = {}) {
  let t = L(e.doi);
  if (!t) throw new Error("A valid DOI (10.xxxx/...) is required; Zotero writes are keyed by exact DOI.");
  let r = N(e.item_type || e.itemType, 40, "item_type") || "journalArticle", n = Br[r];
  if (!n) throw new Error(`Unsupported item_type "${r}"; use one of ${Lt.join(", ")}`);
  let o = N(e.title, G.title, "title");
  if (!o) throw new Error("title is required");
  let a = {};
  for (let i of n.fields) {
    let u = N(e[i], G.field, i);
    u && (a[i] = u);
  }
  let c = N(e.publication ?? e.container_title, G.field, "publication");
  c && n.container && (a[n.container] = c);
  let l = [];
  return c && !n.container && l.push(`Published in: ${c}`), n.doi || l.push(`DOI: ${t}`), { doi: t, itemType: r, title: o, creators: _l(e.creators), date: N(e.date, 64, "date"), url: Ks(e.url, "url") || `https://doi.org/${t}`, abstractNote: N(e.abstract ?? e.abstractNote, G.abstract, "abstract"), fields: a, extra: l.join(`
`), tags: xl(e.tags), doiField: n.doi };
}
s(it, "normalizeZoteroItem");
function ct(e = {}) {
  let t = Ks(e.attachment_url ?? e.attachmentUrl, "attachment_url");
  return t ? { url: t, title: N(e.attachment_title, G.field, "attachment_title") || "Full Text PDF" } : null;
}
s(ct, "normalizeZoteroAttachment");
function lt(e, t = null) {
  let r = { itemType: e.itemType, title: e.title, creators: e.creators.map((n) => n.name ? { creatorType: n.creatorType, lastName: n.name, fieldMode: 1 } : { ...n }), date: e.date, url: e.url, abstractNote: e.abstractNote, ...e.fields, tags: e.tags.map((n) => ({ tag: n })), attachments: t ? [{ title: t.title, url: t.url, mimeType: "application/pdf" }] : [] };
  return e.doiField && (r.DOI = e.doi), e.extra && (r.extra = e.extra), r;
}
s(lt, "toConnectorItem");
function ut(e, { collectionKey: t = null } = {}) {
  let r = { itemType: e.itemType, title: e.title, creators: e.creators.map((n) => ({ ...n })), date: e.date, url: e.url, abstractNote: e.abstractNote, ...e.fields, tags: e.tags.map((n) => ({ tag: n })), collections: t ? [t] : [] };
  return e.doiField && (r.DOI = e.doi), e.extra && (r.extra = e.extra), r;
}
s(ut, "toWebApiItem");
function dt(e) {
  let t = N(e, 32, "target");
  if (!t) return null;
  if (!/^[LC]\d{1,12}$/.test(t)) throw new Error('target must look like "L1" (library) or "C123" (collection)');
  return t;
}
s(dt, "connectorTargetId");
var gi = {};
Z(gi, { ZOTERO_ENDPOINTS: () => Te, ZOTERO_ITEM_TYPES: () => Lt, connectorSaveTarget: () => yo, connectorTargetId: () => dt, describeZoteroSavePlan: () => ui, describeZoteroUpdatePlan: () => yi, executeZoteroSave: () => li, executeZoteroUpdate: () => mi, localApiChildren: () => go, localApiSearchByDoi: () => Vr, localServerId: () => wo, normalizeZoteroAttachment: () => ct, normalizeZoteroItem: () => it, prepareZoteroSave: () => si, prepareZoteroUpdate: () => fi, probeZoteroConnector: () => ho, receiptWithoutUpdate: () => hi, receiptWithoutWrite: () => ci, toConnectorItem: () => lt, toWebApiItem: () => ut, webChildren: () => Dt, webCreateItems: () => pt, webGetItem: () => bo, webKeyAccess: () => Kr, webListCollections: () => pi, webRequest: () => mt, webSearchByDoi: () => $t, zoteroLocalWriteConfig: () => Jr, zoteroWebApiConfig: () => He });
var Te = Object.freeze({ connector: "http://127.0.0.1:23119", localApi: "http://127.0.0.1:23119/api", webApi: "https://api.zotero.org" });
var Ue = /^[A-Z0-9]{8}$/;
function ft(e, t) {
  let r = AbortSignal.timeout(e);
  return t ? AbortSignal.any([t, r]) : r;
}
s(ft, "timeoutSignal");
async function Wr(e, t = 2 * 1024 * 1024) {
  let r = await e.text();
  if (r.length > t) throw new Error("Zotero response too large; outcome remains unknown.");
  if (!r.trim()) return null;
  try {
    return JSON.parse(r);
  } catch {
    return { text: r.slice(0, 2e3) };
  }
}
s(Wr, "readJson");
async function mo(e, t, r, { timeoutMs: n = 2e4, signal: o } = {}) {
  let a = await e(`${Te.connector}${t}`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(r), signal: ft(n, o), redirect: "error" });
  return { status: a.status, ok: a.ok, headers: a.headers, json: await Wr(a) };
}
s(mo, "connectorPost");
async function ho({ fetchImpl: e = fetch, signal: t, timeoutMs: r = 3e3 } = {}) {
  try {
    let n = await mo(e, "/connector/ping", {}, { timeoutMs: r, signal: t });
    return { reachable: n.ok, status: n.status, version: n.headers?.get?.("X-Zotero-Version") || null };
  } catch (n) {
    return { reachable: false, error: n.name === "TimeoutError" ? "timeout" : "unreachable" };
  }
}
s(ho, "probeZoteroConnector");
async function yo({ fetchImpl: e = fetch, signal: t } = {}) {
  let r = await mo(e, "/connector/getSelectedCollection", {}, { signal: t });
  if (!r.ok || !r.json || typeof r.json != "object") throw new Error(`Zotero desktop did not report a save target (HTTP ${r.status}).`);
  let n = r.json;
  return { libraryId: n.libraryID === void 0 || n.libraryID === null ? null : String(n.libraryID), libraryName: typeof n.libraryName == "string" ? n.libraryName.slice(0, 200) : "My Library", editable: n.libraryEditable !== false && n.editable !== false, collectionId: n.id ? String(n.id) : null, collectionName: n.id && typeof n.name == "string" ? n.name.slice(0, 200) : null };
}
s(yo, "connectorSaveTarget");
async function ri(e, t, { signal: r, timeoutMs: n = 1e4 } = {}) {
  let o = await e(`${Te.localApi}/users/0/${t}`, { headers: { Accept: "application/json" }, signal: ft(n, r), redirect: "error" });
  if (!o.ok) throw new Error(`Zotero local API HTTP ${o.status}`);
  return { data: await Wr(o), total: Number(o.headers.get("Total-Results")) };
}
s(ri, "localApiGet");
function ni(e, t) {
  return bt(e, t).filter((r) => Ue.test(r.key || "")).map((r) => ({ key: r.key, title: String(r.data?.title || "").slice(0, 200), itemType: r.data?.itemType || null, collections: Array.isArray(r.data?.collections) ? r.data.collections.slice(0, 20) : [] }));
}
s(ni, "summarizeMatches");
async function Vr({ fetchImpl: e = fetch, doi: t, signal: r } = {}) {
  let n = L(t);
  if (!n) throw new Error("Valid DOI required");
  let o = await ri(e, `items?format=json&limit=100&q=${encodeURIComponent(n)}&qmode=everything`, { signal: r }), a = Array.isArray(o.data) && o.data.length <= 100 && !(o.total > 100);
  return { complete: a, items: a ? ni(o.data, n) : [] };
}
s(Vr, "localApiSearchByDoi");
async function go({ fetchImpl: e = fetch, key: t, signal: r } = {}) {
  if (!Ue.test(t || "")) throw new Error("Valid Zotero key required");
  let n = await ri(e, `items/${t}/children?format=json&limit=100`, { signal: r });
  return Array.isArray(n.data) ? n.data : [];
}
s(go, "localApiChildren");
function He(e = process.env) {
  let t = le(e.ZOTERO_LIBRARY_TYPE), r = t ?? String(e.ZOTERO_LIBRARY_TYPE), n = e.ZOTERO_LIBRARY_ID || e.ZOTERO_USER_ID || "", o = e.ZOTERO_API_KEY || "", a = t !== null && /^\d+$/.test(n) && o.length > 0;
  return { libraryType: r, libraryId: n, apiKey: o, configured: a };
}
s(He, "zoteroWebApiConfig");
function Jr(e = process.env) {
  let t = e.ZOTERO_LOCAL_API_KEY || "", r = e.ZOTERO_LOCAL_SERVER_ID || "";
  return { libraryType: "users", libraryId: "0", apiKey: t, serverId: r, base: Te.localApi, local: true, configured: t.length > 0 && /^[A-Za-z0-9]{1,64}$/.test(r) };
}
s(Jr, "zoteroLocalWriteConfig");
async function wo({ fetchImpl: e = fetch, signal: t } = {}) {
  try {
    return (await e(`${Te.localApi}/`, { headers: { "Zotero-API-Version": "3" }, signal: ft(3e3, t), redirect: "error" })).headers.get("zotero-server-id") || null;
  } catch {
    return null;
  }
}
s(wo, "localServerId");
function oi(e) {
  return e.local ? { "Zotero-API-Key": e.apiKey, "Zotero-Server-ID": e.serverId } : { "Zotero-API-Key": e.apiKey };
}
s(oi, "authHeaders");
async function mt(e, t, r, { method: n = "GET", body: o, signal: a, timeoutMs: c = 2e4, write: l = false } = {}) {
  let i = { "Zotero-API-Version": "3", ...oi(t), Accept: "application/json" };
  l && (i["Content-Type"] = "application/json", i["Zotero-Write-Token"] = ei().replace(/-/g, ""));
  let u = await e(`${t.base || Te.webApi}${r}`, { method: n, headers: i, body: o === void 0 ? void 0 : JSON.stringify(o), signal: ft(c, a), redirect: "error" });
  return { status: u.status, ok: u.ok, json: await Wr(u), total: Number(u.headers.get("Total-Results")) };
}
s(mt, "webRequest");
async function Kr({ fetchImpl: e = fetch, config: t, signal: r } = {}) {
  let n = await mt(e, t, "/keys/current", { signal: r });
  if (!n.ok) throw new Error(`Zotero Web API rejected the key (HTTP ${n.status}); no write performed.`);
  let o = n.json?.access || {}, a = t.libraryType === "groups" ? o.groups?.[t.libraryId] || o.groups?.all || {} : String(n.json?.userID ?? "") === t.libraryId ? o.user || {} : {};
  return { userID: n.json?.userID ?? null, username: typeof n.json?.username == "string" ? n.json.username.slice(0, 100) : null, library: a.library === true, write: a.write === true };
}
s(Kr, "webKeyAccess");
async function $t({ fetchImpl: e = fetch, config: t, doi: r, signal: n } = {}) {
  let o = L(r);
  if (!o) throw new Error("Valid DOI required");
  let a = await mt(e, t, `/${t.libraryType}/${t.libraryId}/items?format=json&limit=100&q=${encodeURIComponent(o)}&qmode=everything`, { signal: n });
  if (!a.ok) throw new Error(`Zotero Web API lookup failed (HTTP ${a.status}); no write performed.`);
  let c = Array.isArray(a.json) && a.json.length <= 100 && !(a.total > 100);
  return { complete: c, items: c ? ni(a.json, o) : [] };
}
s($t, "webSearchByDoi");
async function pt({ fetchImpl: e = fetch, config: t, items: r, signal: n } = {}) {
  let o = await mt(e, t, `/${t.libraryType}/${t.libraryId}/items`, { method: "POST", body: r, write: true, signal: n, timeoutMs: 3e4 }), a = Object.entries(o.json?.successful || {}).map(([l, i]) => ({ index: Number(l), key: i?.key || i?.data?.key || null, version: i?.version ?? null })), c = Object.entries(o.json?.failed || {}).map(([l, i]) => ({ index: Number(l), code: i?.code ?? null, message: String(i?.message || "").slice(0, 300) }));
  return { status: o.status, ok: o.ok, successful: a, failed: c };
}
s(pt, "webCreateItems");
async function Dt({ fetchImpl: e = fetch, config: t, key: r, signal: n } = {}) {
  if (!Ue.test(r || "")) throw new Error("Valid Zotero key required");
  let o = await mt(e, t, `/${t.libraryType}/${t.libraryId}/items/${r}/children?format=json&limit=100`, { signal: n });
  if (!o.ok) throw new Error(`Zotero ${t.local ? "local" : "Web"} API children lookup failed (HTTP ${o.status})`);
  return Array.isArray(o.json) ? o.json : [];
}
s(Dt, "webChildren");
function ai(e) {
  return { configured: e.configured, libraryType: e.libraryType, libraryId: e.libraryId };
}
s(ai, "publicWebConfig");
async function si(e = {}, { fetchImpl: t = fetch, env: r = process.env, signal: n } = {}) {
  let o = it(e), a = ct(e), c = N(e.channel, 16, "channel") || "auto";
  if (!["auto", "connector", "web"].includes(c)) throw new Error("channel must be auto, connector or web");
  let l = N(e.collection_key ?? e.collectionKey, 8, "collection_key") || null;
  if (l && !Ue.test(l)) throw new Error("collection_key must be an 8-character Zotero key");
  let i = dt(e.target), u = He(r), d = c === "web" ? { reachable: false, skipped: true } : await ho({ fetchImpl: t, signal: n }), p = c !== "web" && d.reachable ? "connector" : c !== "connector" && u.configured ? "web" : null;
  if (!p) throw new Error(c === "web" ? "Zotero Web API is not configured: set ZOTERO_API_KEY (write scope) and ZOTERO_LIBRARY_ID / ZOTERO_USER_ID in the host environment, never in chat." : c === "connector" ? "Zotero desktop is not reachable on 127.0.0.1:23119. Start Zotero 7 and enable Settings \u2192 Advanced \u2192 Allow other applications on this computer to communicate with Zotero." : "No Zotero write channel: start Zotero desktop (connector) or configure a write-scoped ZOTERO_API_KEY with ZOTERO_LIBRARY_ID in the environment. No library was queried.");
  let f = { doi: o.doi, idempotencyKey: Er("zotero.create", { doi: o.doi, collectionKey: l }), item: o, attachment: a, channel: p, connector: d, web: ai(u), target: null, existing: [], dedupComplete: false, action: "blocked", reason: null, readBackVia: p === "connector" ? "local-api" : "web-api" };
  if (p === "connector") {
    let m = await yo({ fetchImpl: t, signal: n });
    if (!m.editable) throw new Error(`Zotero desktop's current target "${m.libraryName}" is read-only; select an editable library or collection in Zotero first.`);
    f.target = { kind: "connector", ...m, requestedTarget: i, local: true };
    let h = await Vr({ fetchImpl: t, doi: o.doi, signal: n });
    f.existing = h.items, f.dedupComplete = h.complete;
  } else {
    let m = await Kr({ fetchImpl: t, config: u, signal: n });
    if (!m.write) throw new Error(`ZOTERO_API_KEY has no write permission for ${u.libraryType}/${u.libraryId}; create a write-scoped key in the Zotero account settings. No write performed.`);
    f.target = { kind: "web", libraryType: u.libraryType, libraryId: u.libraryId, libraryName: u.libraryType === "groups" ? `group ${u.libraryId}` : m.username || "My Library", collectionKey: l, local: false };
    let h = await $t({ fetchImpl: t, config: u, doi: o.doi, signal: n });
    f.existing = h.items, f.dedupComplete = h.complete;
  }
  return f.dedupComplete ? f.existing.length === 1 ? f.action = "reuse" : f.existing.length > 1 ? (f.action = "ambiguous", f.reason = "multiple-items-share-doi") : f.action = "create" : f.reason = "dedup-incomplete", f;
}
s(si, "prepareZoteroSave");
function Gr(e) {
  return Ue.test(String(e || "")) ? `zotero://select/library/items/${e}` : null;
}
s(Gr, "selectLink");
function Tl(e) {
  let t = e.filter((r) => r?.data?.contentType === "application/pdf");
  return { pdfAttachmentKeys: t.map((r) => r.key), status: t.length ? "attachment-indexed-not-read" : "metadata-only" };
}
s(Tl, "fulltextFromChildren");
async function Pl(e, { fetchImpl: t, env: r, signal: n, attempts: o, delayMs: a, sleep: c }) {
  let l = He(r), i = { state: "unavailable", count: 0, attempts: 0 };
  for (let u = 1; u <= o; u++) {
    try {
      let d = e.channel === "connector" ? await Vr({ fetchImpl: t, doi: e.doi, signal: n }) : await $t({ fetchImpl: t, config: l, doi: e.doi, signal: n });
      if (i = { state: d.complete ? d.items.length === 1 ? "found" : d.items.length ? "ambiguous" : "not-found" : "unknown", count: d.items.length, items: d.items, attempts: u }, i.state === "found" || i.state === "ambiguous") break;
    } catch (d) {
      i = { state: "unavailable", count: 0, attempts: u, error: String(d.message || d).slice(0, 200) };
    }
    u < o && await c(a);
  }
  if (i.state === "found") try {
    let u = e.channel === "connector" ? await go({ fetchImpl: t, key: i.items[0].key, signal: n }) : await Dt({ fetchImpl: t, config: l, key: i.items[0].key, signal: n });
    i.fulltext = Tl(u);
  } catch {
    i.fulltext = { pdfAttachmentKeys: [], status: "unavailable" };
  }
  return i;
}
s(Pl, "readBackByDoi");
function ii(e, t) {
  return { doi: e.doi, idempotencyKey: e.idempotencyKey, title: e.item.title, itemType: e.item.itemType, channel: e.channel, library: { type: e.target?.libraryType || "users", id: e.target?.libraryId ?? null, name: e.target?.libraryName || null, local: e.target?.local === true }, collection: e.target?.collectionKey ? { key: e.target.collectionKey, name: null } : e.target?.collectionId ? { id: e.target.collectionId, name: e.target.collectionName } : null, attachment: { requested: !!e.attachment, url: e.attachment?.url || null, mode: e.attachment ? e.channel === "connector" ? "zotero-downloads-url" : "linked_url" : null, key: null }, dedup: { existing: e.existing, complete: e.dedupComplete }, zoteroKey: null, zoteroSelect: null, fulltextStatus: "unavailable", readBack: null, write: { performed: false, at: t }, writesToLibraries: 0, autoRetry: false, attachmentContentsVerified: false, scientificallyVerified: false };
}
s(ii, "baseReceipt");
function ci(e, { now: t = s(() => /* @__PURE__ */ new Date(), "now") } = {}) {
  let r = ii(e, t().toISOString());
  return e.action === "reuse" ? (r.status = "reused", r.zoteroKey = e.existing[0].key, r.zoteroSelect = Gr(r.zoteroKey), r.reason = "existing-item-with-same-doi") : (r.status = ["ambiguous", "cancelled"].includes(e.action) ? e.action : "blocked", r.reason = e.reason || e.action), r;
}
s(ci, "receiptWithoutWrite");
async function li(e, { fetchImpl: t = fetch, env: r = process.env, signal: n, now: o = s(() => /* @__PURE__ */ new Date(), "now"), sleep: a = s((i) => new Promise((u) => setTimeout(u, i)), "sleep"), readBackAttempts: c = 4, readBackDelayMs: l = 750 } = {}) {
  if (e.action !== "create") throw new Error(`Refusing to write: plan action is ${e.action}`);
  let i = o().toISOString(), u = ii(e, i);
  u.write = { performed: true, at: i, httpStatus: null, error: null }, u.writesToLibraries = 1;
  let d = null;
  try {
    if (e.channel === "connector") {
      let m = { sessionID: ei().replace(/-/g, "").slice(0, 8), uri: e.item.url, items: [lt(e.item, e.attachment)] };
      e.target?.requestedTarget && (m.target = e.target.requestedTarget);
      let h = await mo(t, "/connector/saveItems", m, { timeoutMs: 3e4, signal: n });
      u.write.httpStatus = h.status, h.ok || (u.write.error = `connector HTTP ${h.status}${h.json?.text ? `: ${h.json.text.slice(0, 200)}` : ""}`);
    } else {
      let m = He(r), h = await pt({ fetchImpl: t, config: m, items: [ut(e.item, { collectionKey: e.target?.collectionKey || null })], signal: n });
      if (u.write.httpStatus = h.status, d = h.successful[0]?.key || null, !h.ok || !d) u.write.error = h.failed[0]?.message || `web api HTTP ${h.status}`;
      else if (e.attachment) {
        let y = await pt({ fetchImpl: t, config: m, items: [{ itemType: "attachment", linkMode: "linked_url", parentItem: d, title: e.attachment.title, url: e.attachment.url, contentType: "application/pdf", tags: [] }], signal: n });
        u.attachment.key = y.successful[0]?.key || null, u.attachment.key || (u.attachment.error = y.failed[0]?.message || `web api HTTP ${y.status}`);
      }
    }
  } catch (m) {
    u.write.error = String(m.message || m).slice(0, 300);
  }
  let { items: p = [], ...f } = await Pl(e, { fetchImpl: t, env: r, signal: n, attempts: c, delayMs: l, sleep: a });
  if (u.readBack = f, f.state === "found") {
    let m = p[0];
    u.zoteroKey = m.key, u.zoteroSelect = Gr(m.key), u.fulltextStatus = u.readBack.fulltext?.status || "unavailable", u.status = d && d !== m.key ? "unverified" : "saved", u.status === "unverified" && (u.reason = "read-back-key-differs");
  } else u.readBack.state === "ambiguous" ? (u.status = "ambiguous", u.reason = "multiple-items-share-doi-after-write") : u.write.error ? (u.status = "failed", u.reason = u.write.error) : (u.status = "unverified", u.reason = u.readBack.state === "not-found" ? "written-but-not-read-back" : "read-back-unavailable");
  return u;
}
s(li, "executeZoteroSave");
function ui(e) {
  let t = e.item.creators.map((a) => a.name || [a.firstName, a.lastName].filter(Boolean).join(" ")), r = t.length ? `${t.slice(0, 3).join("\u3001")}${t.length > 3 ? ` \u7B49 ${t.length} \u4EBA` : ""}` : "\uFF08\u672A\u63D0\u4F9B\u4F5C\u8005\uFF09", n = e.channel === "connector" ? `Zotero \u684C\u9762\uFF08\u5F53\u524D\u9009\u4E2D\uFF1A${e.target.libraryName}${e.target.collectionName ? ` / ${e.target.collectionName}` : ""}${e.target.requestedTarget ? `\uFF0C\u76EE\u6807 ${e.target.requestedTarget}` : ""}\uFF09` : `Zotero \u7F51\u9875\u5E93 ${e.target.libraryType}/${e.target.libraryId}${e.target.collectionKey ? `\uFF08\u5206\u7C7B ${e.target.collectionKey}\uFF09` : ""}`, o = e.attachment ? e.channel === "connector" ? `\u7531 Zotero \u81EA\u884C\u4E0B\u8F7D ${e.attachment.url}` : `\u4EE5\u94FE\u63A5\u5F62\u5F0F\u8BB0\u5F55 ${e.attachment.url}\uFF08\u4E0D\u4E0A\u4F20\u6587\u4EF6\uFF09` : "\u4EC5\u5143\u6570\u636E\uFF0C\u4E0D\u5E26\u9644\u4EF6";
  return [`\u8981\u5199\u5165\u7684\u6587\u732E\uFF1A
- \u6807\u9898\uFF1A${e.item.title}
- \u4F5C\u8005\uFF1A${r}
- DOI\uFF1A${e.doi}
- \u7C7B\u578B\uFF1A${e.item.itemType}${e.item.date ? ` \xB7 ${e.item.date}` : ""}`, `\u5199\u5165\u4F4D\u7F6E\uFF1A${n}`, `\u9644\u4EF6\uFF1A${o}`, `\u67E5\u91CD\uFF1A\u6309 DOI \u68C0\u7D22${e.dedupComplete ? "\u672A\u53D1\u73B0\u5DF2\u6709\u6761\u76EE\uFF0C\u5C06\u65B0\u5EFA 1 \u6761" : "\u672A\u5B8C\u6210\uFF0C\u4E0D\u4F1A\u5199\u5165"}\u3002`, "\u5199\u5165\u540E\u4F1A\u6309 DOI \u8BFB\u56DE\u6838\u5BF9\uFF1B\u4E0D\u4F1A\u81EA\u52A8\u91CD\u8BD5\uFF0C\u4E5F\u4E0D\u4F1A\u5220\u9664\u3001\u5408\u5E76\u6216\u79FB\u52A8\u4EFB\u4F55\u6761\u76EE\u3002", "\u4E0D\u60F3\u5199\u5165\u5C31\u9009\u201C\u6682\u4E0D\u5199\u5165\u201D\u6216\u76F4\u63A5\u5173\u6389\uFF0CZotero \u4E0D\u4F1A\u6709\u4EFB\u4F55\u53D8\u5316\u3002"].join(`

`);
}
s(ui, "describeZoteroSavePlan");
var Ol = 100 * 1024 * 1024;
async function di(e, t, r, n) {
  let o = await mt(e, t, r, { signal: n });
  if (!o.ok) throw new Error(t.local && o.status === 401 ? "Zotero rejected the local write key (revoked or expired); authorize local writes again in Drone Settings \u2192 Zotero" : `Zotero ${t.local ? "local" : "Web"} API HTTP ${o.status} for ${r.split("?")[0]}`);
  return o;
}
s(di, "webJson");
async function bo({ fetchImpl: e = fetch, config: t, key: r, signal: n } = {}) {
  if (!Ue.test(r || "")) throw new Error("Valid Zotero key required");
  let a = (await di(e, t, `/${t.libraryType}/${t.libraryId}/items/${r}?format=json`, n)).json || {};
  return { key: a.key, version: Number(a.version ?? a.data?.version ?? 0), title: String(a.data?.title || "").slice(0, 300), doi: L(a.data?.DOI || ""), itemType: a.data?.itemType || null, parentItem: a.data?.parentItem || null, collections: Array.isArray(a.data?.collections) ? a.data.collections : [] };
}
s(bo, "webGetItem");
async function pi({ fetchImpl: e = fetch, config: t, signal: r } = {}) {
  let n = [];
  for (let o = 0; o < 1e3; o += 100) {
    let a = await di(e, t, `/${t.libraryType}/${t.libraryId}/collections?format=json&limit=100&start=${o}`, r), c = Array.isArray(a.json) ? a.json : [];
    for (let l of c) Ue.test(l?.key || "") && n.push({ key: l.key, name: String(l.data?.name || "").slice(0, 200), parent: l.data?.parentCollection || null });
    if (c.length < 100 || !(a.total > o + 100)) break;
  }
  return n;
}
s(pi, "webListCollections");
async function fo(e, t, r, { method: n, headers: o = {}, body: a, signal: c, timeoutMs: l = 3e4 }) {
  let i = await e(`${t.base || Te.webApi}${r}`, { method: n, headers: { "Zotero-API-Version": "3", ...oi(t), ...o }, body: a, signal: ft(l, c), redirect: "error" });
  return { status: i.status, ok: i.ok, json: await Wr(i) };
}
s(fo, "webWrite");
async function Ll(e, t) {
  let r = N(t, 1e3, "local_file");
  if (!r) return null;
  let n = await Ys(e), o = await Ys(Xs(r) ? r : Il(n, r)), a = Al(n, o);
  if (a === "" || a === ".." || a.startsWith(`..${Qs}`) || Xs(a)) throw new Error("local_file must be inside the current project");
  let c = await Cl(o);
  if (!c.isFile()) throw new Error("local_file is not a file");
  if (c.size > Ol) throw new Error("local_file is larger than 100 MB");
  let l = await ti(o, "r"), i = Sl("md5"), u = Buffer.alloc(5);
  try {
    await l.read(u, 0, 5, 0);
    let d = l.createReadStream({ autoClose: false, start: 0 });
    for await (let p of d) i.update(p);
  } finally {
    await l.close();
  }
  if (u.toString("latin1") !== "%PDF-") throw new Error("local_file is not a PDF");
  return { path: o, relativePath: a.split(Qs).join("/"), filename: El(o), size: c.size, mtime: Math.round(c.mtimeMs), md5: i.digest("hex") };
}
s(Ll, "inspectLocalPdf");
async function fi(e = {}, { fetchImpl: t = fetch, env: r = process.env, cwd: n = process.cwd(), signal: o } = {}) {
  let a = He(r), c = Jr(r), l = { kind: "update", channel: "web", web: ai(a), action: "blocked", reason: null, item: null, doi: null, changes: { addCollection: null, attachUrl: null, uploadFile: null }, skipped: [] }, i = a, u = false;
  if (c.configured && !(a.configured && a.libraryType === "groups")) {
    let R = await wo({ fetchImpl: t, signal: o });
    R === c.serverId ? i = c : u = !!R;
  }
  if (i.local) l.channel = "local", l.target = { kind: "local", libraryType: "users", libraryId: "0", libraryName: "My Library", local: true };
  else {
    if (!a.configured) return l.reason = u ? "The saved Zotero local write key belongs to a different Zotero database; authorize local writes again in Drone Settings \u2192 Zotero. No change made." : "Changing an existing Zotero item needs write access: on Zotero 10+ ask the user to authorize local writes in Drone Settings \u2192 Zotero (Zotero shows a dialog; choose \u201CAlways Allow\u201D), or to add a write-enabled API key under Settings \u2192 Zotero \u2192 Web API (or set ZOTERO_API_KEY and ZOTERO_LIBRARY_ID). No change made.", l;
    let R = await Kr({ fetchImpl: t, config: i, signal: o });
    if (!R.write) return l.reason = `The Zotero API key has no write permission for ${i.libraryType}/${i.libraryId}; create a key with library write access. No change made.`, l;
    l.target = { kind: "web", libraryType: i.libraryType, libraryId: i.libraryId, libraryName: i.libraryType === "groups" ? `group ${i.libraryId}` : R.username || "My Library", local: false };
  }
  let d = N(e.zotero_key ?? e.key, 8, "zotero_key") || null, p = L(e.doi || "");
  if (!d) {
    if (!p) throw new Error("zotero_key or doi is required");
    let R = await $t({ fetchImpl: t, config: i, doi: p, signal: o });
    if (!R.complete) return l.reason = "dedup-incomplete", l;
    if (R.items.length !== 1) return l.reason = R.items.length ? "multiple-items-share-doi: pass zotero_key to choose one" : "no item with this DOI in the library; create it with research_zotero_save first", l.candidates = R.items, l;
    d = R.items[0]?.key ?? null;
  }
  let f = await bo({ fetchImpl: t, config: i, key: d, signal: o });
  if (f.parentItem) throw new Error("zotero_key points to a child attachment/note, not a top-level item");
  l.item = f, l.doi = f.doi || p || null;
  let m = N(e.collection_key, 8, "collection_key") || null, h = N(e.collection_name, 200, "collection_name") || null;
  if (m || h) {
    let R = await pi({ fetchImpl: t, config: i, signal: o }), C = m ? R.filter((x) => x.key === m) : R.filter((x) => x.name.trim().toLowerCase() === h?.trim().toLowerCase());
    if (C.length !== 1) return l.reason = C.length ? `several collections are named "${h}"; pass collection_key` : `collection ${m || `"${h}"`} not found in this library`, l.collections = R.slice(0, 50).map(({ key: x, name: $ }) => ({ key: x, name: $ })), l;
    let v = C[0];
    f.collections.includes(v.key) ? l.skipped.push(`already in collection "${v.name}"`) : l.changes.addCollection = { key: v.key, name: v.name };
  }
  let y = N(e.attachment_url, 2e3, "attachment_url") || null, b = await Ll(n, e.local_file);
  if (y || b) {
    let C = (await Dt({ fetchImpl: t, config: i, key: d, signal: o })).map((v) => v?.data || {});
    if (y) {
      if (!/^https?:\/\//i.test(y)) throw new Error("attachment_url must be http(s)");
      C.some((v) => v.url === y) ? l.skipped.push("link already attached") : l.changes.attachUrl = { url: y, title: N(e.attachment_title, 200, "attachment_title") || "Full Text (link)" };
    }
    b && (C.some((v) => v.md5 === b.md5) ? l.skipped.push("same PDF already attached") : l.changes.uploadFile = b);
  }
  return l.action = Object.values(l.changes).some(Boolean) ? "update" : "unchanged", l.action === "unchanged" && (l.reason = l.skipped.join("; ") || "nothing to change"), l;
}
s(fi, "prepareZoteroUpdate");
async function $l(e, t, r, n, o) {
  let a = `/${t.libraryType}/${t.libraryId}`, c = await pt({ fetchImpl: e, config: t, items: [{ itemType: "attachment", linkMode: "imported_file", parentItem: r, title: n.filename, contentType: "application/pdf", filename: n.filename, tags: [] }], signal: o }), l = c.successful[0]?.key;
  if (!l) return { key: null, error: c.failed[0]?.message || `web api HTTP ${c.status}` };
  let i = { "Content-Type": "application/x-www-form-urlencoded", "If-None-Match": "*" }, u = await fo(e, t, `${a}/items/${l}/file`, { method: "POST", headers: i, body: new URLSearchParams({ md5: n.md5, filename: n.filename, filesize: String(n.size), mtime: String(n.mtime) }).toString(), signal: o });
  if (!u.ok) return { key: l, error: `upload authorization HTTP ${u.status}${u.json?.text ? `: ${u.json.text.slice(0, 200)}` : ""}` };
  if (u.json?.exists === 1) return { key: l, error: null, deduplicated: true };
  let d = await ti(n.path, "r"), p;
  try {
    p = await d.readFile();
  } finally {
    await d.close();
  }
  let f = Buffer.concat([Buffer.from(u.json.prefix || "", "utf8"), p, Buffer.from(u.json.suffix || "", "utf8")]), m = String(u.json.url || "");
  if (!(t.local ? m.startsWith(`${new URL(Te.localApi).origin}/`) : /^https:\/\//.test(m))) return { key: l, error: "upload authorization returned an unexpected upload URL" };
  let y = await e(m, { method: "POST", headers: { "Content-Type": String(u.json.contentType || "application/octet-stream"), ...t.local ? { "Zotero-Server-ID": t.serverId } : {} }, body: f, signal: ft(12e4, o), redirect: "error" });
  if (y.status !== 201 && y.status !== 204) return { key: l, error: `file upload HTTP ${y.status}` };
  let b = await fo(e, t, `${a}/items/${l}/file`, { method: "POST", headers: i, body: new URLSearchParams({ upload: String(u.json.uploadKey || "") }).toString(), signal: o });
  return { key: l, error: b.status === 204 ? null : `upload registration HTTP ${b.status}` };
}
s($l, "uploadAttachment");
async function mi(e, { fetchImpl: t = fetch, env: r = process.env, signal: n, now: o = s(() => /* @__PURE__ */ new Date(), "now") } = {}) {
  if (e.action !== "update") throw new Error(`Refusing to write: plan action is ${e.action}`);
  let a = e.channel === "local" ? Jr(r) : He(r), c = `/${a.libraryType}/${a.libraryId}`, l = o().toISOString(), i = {};
  if (e.changes.addCollection) {
    let m = await fo(t, a, `${c}/items/${e.item.key}`, { method: "PATCH", headers: { "Content-Type": "application/json", "If-Unmodified-Since-Version": String(e.item.version) }, body: JSON.stringify({ collections: [...e.item.collections, e.changes.addCollection.key] }), signal: n });
    i.addCollection = { ...e.changes.addCollection, httpStatus: m.status, error: m.status === 204 ? null : m.status === 412 ? "the item changed in Zotero after it was read; nothing was overwritten, run the update again" : `HTTP ${m.status}` };
  }
  if (e.changes.attachUrl) {
    let m = await pt({ fetchImpl: t, config: a, items: [{ itemType: "attachment", linkMode: "linked_url", parentItem: e.item.key, title: e.changes.attachUrl.title, url: e.changes.attachUrl.url, contentType: "application/pdf", tags: [] }], signal: n });
    i.attachUrl = { url: e.changes.attachUrl.url, key: m.successful[0]?.key || null, error: m.successful[0]?.key ? null : m.failed[0]?.message || `HTTP ${m.status}` };
  }
  if (e.changes.uploadFile) try {
    i.uploadFile = { file: e.changes.uploadFile.relativePath, size: e.changes.uploadFile.size, ...await $l(t, a, e.item.key, e.changes.uploadFile, n) };
  } catch (m) {
    i.uploadFile = { file: e.changes.uploadFile.relativePath, key: null, error: String(m.message || m).slice(0, 300) };
  }
  let u = {};
  try {
    let m = await bo({ fetchImpl: t, config: a, key: e.item.key, signal: n });
    u.collections = m.collections, i.addCollection && (i.addCollection.verified = m.collections.includes(i.addCollection.key));
    let h = await Dt({ fetchImpl: t, config: a, key: e.item.key, signal: n }), y = new Set(h.map((b) => b?.key));
    if (i.attachUrl?.key && (i.attachUrl.verified = y.has(i.attachUrl.key)), i.uploadFile?.key) {
      let b = h.find((R) => R?.key === i.uploadFile.key);
      i.uploadFile.verified = !!b && (i.uploadFile.deduplicated || b?.data?.md5 === e.changes.uploadFile.md5);
    }
  } catch (m) {
    u.error = String(m.message || m).slice(0, 200);
  }
  let d = Object.values(i), p = d.filter((m) => m.error), f = d.filter((m) => m.verified);
  return { kind: "update", channel: e.channel, doi: e.doi, title: e.item.title, zoteroKey: e.item.key, zoteroSelect: Gr(e.item.key), library: { type: a.libraryType, id: a.libraryId, name: e.target?.libraryName || null, local: !!a.local }, changes: i, skipped: e.skipped, readBack: u, write: { performed: true, at: l }, status: p.length === d.length ? "failed" : p.length ? "partial" : f.length === d.length ? "updated" : "unverified", autoRetry: false, attachmentContentsVerified: false };
}
s(mi, "executeZoteroUpdate");
function hi(e) {
  return { kind: "update", channel: e.channel, doi: e.doi, title: e.item?.title || null, zoteroKey: e.item?.key || null, zoteroSelect: Gr(e.item?.key), status: e.action === "unchanged" ? "unchanged" : e.action === "cancelled" ? "cancelled" : "blocked", reason: e.reason, skipped: e.skipped, ...e.candidates ? { candidates: e.candidates } : {}, ...e.collections ? { collections: e.collections } : {}, write: { performed: false } };
}
s(hi, "receiptWithoutUpdate");
function yi(e) {
  let t = [`\u8981\u4FEE\u6539\u7684\u5DF2\u6709\u6761\u76EE\uFF1A
- \u6807\u9898\uFF1A${e.item.title}
- DOI\uFF1A${e.doi || "\uFF08\u65E0\uFF09"}
- Zotero \u952E\uFF1A${e.item.key}`], r = [];
  return e.changes.addCollection && r.push(`\u52A0\u5165\u5206\u7C7B\u300C${e.changes.addCollection.name}\u300D\uFF08\u4FDD\u7559\u539F\u6709\u5206\u7C7B\uFF09`), e.changes.attachUrl && r.push(`\u6DFB\u52A0\u94FE\u63A5\u9644\u4EF6 ${e.changes.attachUrl.url}`), e.changes.uploadFile && r.push(`\u4E0A\u4F20\u672C\u5730 PDF ${e.changes.uploadFile.relativePath}\uFF08${(e.changes.uploadFile.size / 1024 / 1024).toFixed(1)} MB\uFF0C${e.channel === "local" ? "\u5B58\u5165\u672C\u673A Zotero\uFF0C\u4E0D\u5360\u4E91\u5B58\u50A8\u914D\u989D" : "\u5360\u7528 Zotero \u4E91\u5B58\u50A8\u914D\u989D"}\uFF09`), t.push(`\u4FEE\u6539\u5185\u5BB9\uFF1A
${r.map((n) => `- ${n}`).join(`
`)}`), e.skipped.length && t.push(`\u8DF3\u8FC7\uFF1A${e.skipped.join("\uFF1B")}`), t.push(`\u901A\u8FC7 Zotero \u7F51\u9875 API \u5199\u5165 ${e.target.libraryType}/${e.target.libraryId}\uFF1B\u53EA\u6DFB\u52A0\uFF0C\u4E0D\u5220\u9664\u3001\u4E0D\u79FB\u51FA\u4EFB\u4F55\u5206\u7C7B\uFF1B\u5199\u540E\u8BFB\u56DE\u6838\u5BF9\uFF0C\u4E0D\u81EA\u52A8\u91CD\u8BD5\u3002`), t.join(`

`);
}
s(yi, "describeZoteroUpdatePlan");
var wi = "knowledgeFailures";
async function Dl({ capabilities: e, signal: t }) {
  try {
    return (await e.call("provider.inspect", { alias: wi }, t))?.state === "available";
  } catch {
    return false;
  }
}
s(Dl, "available");
function Nl(e, t) {
  return { async record(r) {
    let n = s(() => e.scope.kind === "session" && !e.signal.aborted && t?.() === true, "canWrite");
    !n() || !await Dl(e) || !n() || await e.capabilities.call("provider.write", { alias: wi, operation: "recordFailureCandidate", input: r }, e.signal);
  } };
}
s(Nl, "createDesktopFailureCandidateSink");
var Ro = Object.freeze(["created", "local_query_recorded", "external_search_recorded", "sources_inspected", "sources_archived", "claims_bound", "answerable"]);
var zl = /* @__PURE__ */ new Set(["unavailable", "browser_required", "failed"]);
function Bp({ scope: e = "factual-answer" } = {}) {
  let t = [], r = "created", n = s((l, i = {}) => {
    t.push({ type: l, at: (/* @__PURE__ */ new Date()).toISOString(), ...i });
  }, "record"), o = s(() => ({ scope: e, stage: r, status: "ok", answerable: r === "answerable", events: [...t] }), "snapshot");
  return Object.freeze({ advance: s((l, i = {}) => {
    if (!Ro.includes(l)) throw new Error(`Unknown evidence stage: ${l}`);
    let u = Ro.indexOf(r);
    if (Ro.indexOf(l) < u) throw new Error(`Evidence stage cannot move backwards: ${r} -> ${l}`);
    return r = l, n(l, i), o();
  }, "advance"), fail: s((l, i = {}) => {
    if (!zl.has(l)) throw new Error(`Unknown evidence failure: ${l}`);
    return n(l, i), { ...o(), status: l, answerable: false };
  }, "fail"), snapshot: o });
}
s(Bp, "createEvidenceGate");
function Wp(e, { claimBindings: t = [] } = {}) {
  let r = e.snapshot();
  if (r.stage !== "answerable" || !Array.isArray(t) || t.length === 0 || t.some((n) => !n || typeof n != "object" || Array.isArray(n))) throw new Error("Evidence gate is closed: complete retrieval, inspection, archiving and structured claim binding first");
  return r;
}
s(Wp, "assertEvidenceAnswerable");
var jl = { type: "object", additionalProperties: false, properties: { action: { type: "string", enum: ["start", "record_local", "record_external", "inspect_sources", "verify_archive", "bind_claims", "finalize", "complete", "escalate", "status"] }, mode: { type: "string", enum: ["fast_readonly", "deep_research"], description: "Execution mode at start. Fast mode uses local evidence and needs explicit escalation before external tools or writes." }, reason: { type: "string", enum: [...ar] }, run_dir: { type: "string" }, project: { type: "string", description: "Optional. The host resolves the project from the workspace or session." }, result_slug: { type: "string" }, query: { type: "string" }, requires_provenance: { type: "boolean", description: 'Deep research only. Before completion, call research_record_run_manifest with actual source paths in files with role="input". This records file snapshots.' }, source_refs: { type: "array", items: { type: "string" } }, claim_refs: { type: "array", items: { type: "string" } }, claim_bindings: Ut, outcome: { type: "string" }, notes: { type: "string" } }, required: ["action"] };
function vo(e, t = e) {
  return { content: [{ type: "text", text: JSON.stringify(t, null, 2) }], details: e };
}
s(vo, "resultOf");
function bi(e, t, r) {
  return { name: "research_loop", label: "Research evidence loop", executionMode: "sequential", drone: { libraryMode: true, recoverySafe: true, capabilities: ["research"], activity: { text: "\u6B63\u5728\u68C0\u67E5\u7814\u7A76\u8BC1\u636E\u94FE\u2026", phase: "verification" } }, description: "Start, inspect or complete a tracked research run. Fast mode uses local search, read and identity verification followed by complete with structured claim_bindings. Escalate explicitly when needed. The host advances evidence from observed tools and supplies source hashes and read receipt IDs. result_slug determines the topic ID.", parameters: jl, execute: s((n, o, a, c, l) => e.run(() => Zl(e, t, r(l), o, l)), "execute") };
}
s(bi, "researchLoopTool");
async function Zl(e, t, r, n, o) {
  let { action: a } = n, c = a === "start" ? void 0 : n.run_dir || r.currentRun();
  if (a === "status" && !c) return vo({ run_dir: null, evidence_gate: { stage: "not-started", answerable: false }, next_action: "start", guidance: "Call research_loop(action=start,query=the research question)." });
  let l = a === "start" ? await e.resolveSessionProject(o, n.project) : void 0, i = await r.execute(c, () => a === "start" ? t.startResearchRun({ cwd: o.cwd, project: l?.project, resultSlug: n.result_slug, query: n.query, requiresProvenance: n.requires_provenance === true, mode: n.mode }) : t.updateResearchLoop({ cwd: o.cwd, runDir: c, action: a, query: n.query, sourceRefs: n.source_refs, claimRefs: n.claim_refs, claimBindings: n.claim_bindings, outcome: n.outcome, notes: n.notes, reason: n.reason }));
  return a === "status" ? vo(i) : vo(i, ql(i, l ? e.describeProject(l) : void 0));
}
s(Zl, "executeLoopTool");
function ql(e, t) {
  let r = e.evidence_gate;
  return { run_dir: e.run_dir, topic_id: e.metadata.topic_id, mode: e.metadata.mode, fast_path: e.metadata.fast_path, escalationRequired: e.escalationRequired, breaker_receipt: e.metadata.breaker_receipt, evidence_gate: { stage: r.stage, answerable: r.answerable, archive_count: r.archive_count, reuse_count: r.reuse_count, source_refs: r.source_refs, claim_count: r.claim_refs.length, structured_claim_count: r.claim_bindings.length, warnings: r.warnings, scientificallyVerified: false }, receipt_journal: e.receipt_journal, project: t };
}
s(ql, "visibleResult");
function Ri(e) {
  if (Array.isArray(e)) for (let t of e) {
    let r = A(t);
    if (r.type === "toolCall" && r.name === "research_loop" && A(r.arguments).action === "start" && typeof r.id == "string") return r.id;
  }
}
s(Ri, "startCallId");
var Fl = "Answer the current question. Use evidence for factual research claims. For simple questions with local literature tools, start a fast_readonly run and complete from verified local excerpts. If evidence is insufficient or a write is required, explicitly escalate before using deep research tools. For substantive tasks, do bounded read-only preparation and consolidate scope, permissions and deliverables into one task_plan for user approval. Carry out authorized steps within that scope and respect prior decisions. Request approval for new risks or scope. Link actual outputs, distinguish execution from validation, and keep internal counters out of the answer.";
function Pe(e) {
  return e.sessionManager?.getSessionId?.() || e.sessionId || e.cwd;
}
s(Pe, "sessionKey");
function vi(e) {
  return e.toolName === "research_loop" && (e.args?.action === "status" || e.args?.action === "escalate");
}
s(vi, "controlStep");
function ko(e) {
  let t = A(e);
  if (!(typeof t.toolCallId != "string" || typeof t.toolName != "string")) return { event: t, id: t.toolCallId, toolName: t.toolName };
}
s(ko, "toolEvent");
async function Ml(e, t, r) {
  let n = t.journal.currentRun(), o = { toolName: r.toolName, args: A(r.event.input) }, a = [...t.pending.values()].filter((l) => l.admission === "allowed" && l.activeRun === n && !vi(l)), c = n ? await e.checkTool(t.cwd, n, o, a) : void 0;
  return t.pending.set(r.id, { ...o, activeRun: n, admission: c ? "blocked" : "allowed" }), c;
}
s(Ml, "admitTool");
async function Ul(e, t, r) {
  let n = t.pending.get(r.id);
  if (t.pending.delete(r.id), !n || n.toolName !== r.toolName || n.admission === "blocked" || vi(n)) return;
  let o = t.journal.currentRun(), a = n.toolName === "research_loop" && n.args.action === "start";
  if (n.activeRun && n.activeRun !== o && !a) return;
  let c = A(r.event.result), l = r.event.isError === true, i = !l || typeof r.event.durationMs == "number";
  if (await t.journal.record({ toolCallId: r.id, toolName: r.toolName, args: n.args, details: A(c.details), isError: l, countedStep: i && n.admission === "allowed" && !!(n.activeRun || a), ...r.toolName === "read" && { content: c.content } }), t.startUsage?.callId === r.id) {
    let { sample: u } = t.startUsage;
    t.startUsage = void 0, a && !l && o && await e.observeUsage(t.cwd, o, u);
  }
}
s(Ul, "recordToolEnd");
function Hl(e, t, r, n, o) {
  e.on?.("tool_execution_start", (a, c) => t.run(() => {
    let l = ko(a);
    if (!l) return;
    let i = o(c).pending, u = i.keys().next();
    i.size >= 256 && !u.done && i.delete(u.value), i.set(l.id, { toolName: l.toolName, args: A(l.event.args) });
  })), e.on?.("tool_call", (a, c) => t.run(() => {
    let l = ko(a);
    return l && Ml(r, o(c), l);
  })), e.on?.("tool_execution_end", (a, c) => t.run(() => {
    let l = ko(a), i = n.get(Pe(c));
    return l && i ? Ul(r, i, l) : void 0;
  }));
}
s(Hl, "subscribeTools");
function Bl(e) {
  let t = A(e), { input: r, output: n, cacheRead: o, cacheWrite: a } = t, c = [r, n, o, a].some((l) => typeof l == "number" && Number.isSafeInteger(l) && l > 0);
  return { reported: t.reported === true || t.reported === void 0 && c, inputTokens: r, outputTokens: n, cacheReadTokens: o, cacheWriteTokens: a, cost: t.cost?.total || (t.reported === true ? t.cost?.total : void 0) };
}
s(Bl, "sdkUsageSample");
function Wl(e, t, r, n) {
  e.on?.("message_end", (a, c) => t.run(async () => {
    let l = A(A(a).message), i = n.get(Pe(c));
    if (!i || l.role !== "assistant") return;
    let u = Bl(l.usage), d = i.journal.currentRun(), p = Ri(l.content);
    i.startUsage = !d && p ? { callId: p, sample: u } : void 0, d && await r.observeUsage(c.cwd, d, u);
  }));
  let o = s((a) => t.run(async () => {
    let c = A(a);
    if (typeof c.sessionId != "string" || !Array.isArray(c.toolCallIds)) return;
    let l = n.get(c.sessionId), i = l?.journal.currentRun();
    l && i && await r.observeContextEviction(l.cwd, i, { toolCallIds: c.toolCallIds, observedAt: (/* @__PURE__ */ new Date()).toISOString() });
  }), "eviction");
  e.events?.on ? e.events.on("drone:context-evicted", o) : e.on?.("drone:context-evicted", (a, c) => A(a).sessionId === Pe(c) ? o(a) : void 0);
}
s(Wl, "subscribeTelemetry");
function Vl(e, t, r, n, o) {
  e.on?.("before_agent_start", (a, c) => t.run(async () => {
    let l = n.get(Pe(c));
    return o(c).awaitingUserStart = true, await l?.journal.close(), { systemPrompt: `${A(a).systemPrompt}

${Fl}` };
  })), e.on?.("message_start", (a, c) => {
    if (A(A(a).message).role === "user") return t.run(async () => {
      let l = Pe(c), i = n.get(l);
      i?.awaitingUserStart ? i.awaitingUserStart = false : (await i?.journal.close(), n.delete(l));
    });
  }), e.on?.("session_shutdown", (a, c) => t.run(async () => {
    let l = Pe(c);
    await n.get(l)?.journal.close(), n.delete(l), n.size || r.dispose();
  }));
}
s(Vl, "subscribeTurns");
function Jl(e, t, r) {
  return { deliver: s((n, o, a) => e.run(() => r(n).journal.execute(o.runDir, async () => {
    let c = await t.prepareResearchDelivery({ cwd: n.cwd, ...o }), l = wa(o.claims, c), i = ba(c, l);
    if (!e.reviewSummary) throw new Error("Summary semantic reviewer is unavailable; keep this summary as an unreviewed draft");
    let u = Ra(await e.reviewSummary(n, i), i), d = await t.prepareResearchDelivery({ cwd: n.cwd, ...o });
    if (d.evidenceRevision !== c.evidenceRevision || d.gateSha256 !== c.gateSha256 || d.claimsSha256 !== c.claimsSha256) throw new Error("Research evidence changed during semantic review; no summary was written");
    let p = await a(c);
    try {
      let f = await t.commitResearchDelivery({ cwd: n.cwd, runDir: o.runDir, prepared: c, copies: p.copies, assessment: u, memoryClaims: l });
      return { run_dir: o.runDir, value: p.value, receipt: f, claims: l };
    } catch (f) {
      throw await p.rollback(), f;
    }
  })), "deliver") };
}
s(Jl, "deliveryHandle");
function Kl(e, t) {
  if (process.env.PI_SUBAGENT_CHILD === "1") return;
  let r = fr({ ...t, breakerBudget: t.breakerBudget ?? { maxBilledTokens: 24e3 } }), n = /* @__PURE__ */ new Map(), o = { workspace: t.workspace, owners: /* @__PURE__ */ new Map(), observeExecution: s(async ({ toolCallId: l, toolName: i, ...u }) => l && i ? Cr({ ...u, toolCallId: l, toolName: i, loadWorkspaceConfig: t.workspace }) : null, "observeExecution"), status: s((l, i) => r.updateResearchLoop({ cwd: l, runDir: i, action: "status" }), "status"), flush: s((l, i) => r.flushResearchReceipts({ cwd: l, runDir: i }), "flush"), reset: s((l, i) => r.resetResearchReceipts({ cwd: l, runDir: i }), "reset"), observeResearch: r.observeResearchReceipt }, a = s((l) => {
    let i = Pe(l), u = Xt(l.cwd, { sessionId: i, ports: o }), d = { cwd: l.cwd, journal: u, pending: /* @__PURE__ */ new Map(), awaitingUserStart: false };
    return n.set(i, d), d;
  }, "fresh"), c = s((l) => n.get(Pe(l)) ?? a(l), "sessionFor");
  return t.registerTool(e, bi(t, r, (l) => c(l).journal)), Hl(e, t, r, n, c), Wl(e, t, r, n), Vl(e, t, r, n, a), Jl(t, r, c);
}
s(Kl, "registerResearchExtension");
var Si = 12e3;
function _o(e) {
  return Gl("sha256").update(JSON.stringify(e)).digest("hex");
}
s(_o, "hash");
function Nt() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
s(Nt, "isoNow");
function zt(e) {
  return Math.max(1, Math.min(50, Math.trunc(e ?? 10)));
}
s(zt, "clampLimit");
function W(e) {
  return typeof e == "string" ? e.replace(/\s+/gu, " ").trim() : "";
}
s(W, "text");
function he(e) {
  return e !== null && typeof e == "object" ? e : {};
}
s(he, "record");
function Ci(e) {
  return { sourceRef: e.sourceRef, locator: e.locator, sourceType: e.kind, title: e.title, accessedAt: Nt(), contentHash: _o(e.payload), readOnly: true };
}
s(Ci, "receipt");
function Yl(e) {
  let t = typeof e == "object" && e !== null && "status" in e ? Number(e.status) : 0;
  return t === 408 || t === 429 || t >= 500 || t === 0;
}
s(Yl, "retryable");
function ki(e, t) {
  return { connectorId: e, message: t instanceof Error ? t.message.slice(0, 500) : String(t).slice(0, 500), retryable: Yl(t), at: Nt() };
}
s(ki, "failure");
async function _i(e, t, r, n = {}) {
  let o = new AbortController(), a = setTimeout(() => o.abort(), Si), c = r.signal ? AbortSignal.any([r.signal, o.signal]) : o.signal;
  try {
    let l = await e(t, { headers: { accept: "application/json", "user-agent": "Drone-Research-Workbench/0.33", ...n }, signal: c });
    if (!l.ok) throw Object.assign(new Error(`HTTP ${l.status}`), { status: l.status });
    return await l.json();
  } finally {
    clearTimeout(a);
  }
}
s(_i, "fetchJson");
async function Xl(e, t, r) {
  let n = new AbortController(), o = setTimeout(() => n.abort(), Si), a = r.signal ? AbortSignal.any([r.signal, n.signal]) : n.signal;
  try {
    let c = await e(t, { headers: { accept: "application/atom+xml,application/xml,text/xml", "user-agent": "Drone-Research-Workbench/0.33" }, signal: a });
    if (!c.ok) throw Object.assign(new Error(`HTTP ${c.status}`), { status: c.status });
    return await c.text();
  } finally {
    clearTimeout(o);
  }
}
s(Xl, "fetchText");
function Ql(e) {
  return Array.isArray(e) ? e.flatMap((t) => {
    let r = W(he(t).name);
    return r ? [r] : [];
  }) : [];
}
s(Ql, "bibliographicAuthors");
function xi(e) {
  let t = he(e), r = W(t.paperId) || W(t.corpusId), n = W(t.title);
  if (!r || !n) return [];
  let o = he(t.externalIds), a = W(o.DOI) || void 0, c = a ? `https://doi.org/${a}` : W(t.url) || `https://www.semanticscholar.org/paper/${r}`;
  return [{ id: `semantic-scholar:${r}`, title: n, summary: W(t.abstract) || W(t.venue) || "Semantic Scholar record", locator: c, sourceType: "literature", authors: Ql(t.authors), year: typeof t.year == "number" ? t.year : void 0, doi: a, publishedAt: W(t.publicationDate) || void 0, sourceReceipt: Ci({ sourceRef: `semantic-scholar:${r}`, locator: c, kind: "literature", title: n, payload: e }) }];
}
s(xi, "semanticScholarHit");
function eu(e) {
  return { descriptor: { id: "semantic-scholar", kind: "literature", label: "Semantic Scholar", enabled: true }, async search(r, n) {
    let o = zt(n.limit), a = he(he(n.config).semanticScholar), c = (W(a.apiBase) || "https://api.semanticscholar.org").replace(/\/$/u, ""), l = {}, i = W(a.apiKey);
    i && (l["x-api-key"] = i);
    let d = he(await _i(e, `${c}/graph/v1/paper/search?query=${encodeURIComponent(r)}&limit=${o}&fields=title,abstract,authors,year,externalIds,url,venue,publicationDate`, n, l));
    return (Array.isArray(d.data) ? d.data : []).slice(0, o).flatMap(xi);
  }, recommend: s(async (r, n) => {
    let o = zt(n.limit), a = he(he(n.config).semanticScholar), c = (W(a.apiBase) || "https://api.semanticscholar.org").replace(/\/$/u, ""), l = {}, i = W(a.apiKey);
    i && (l["x-api-key"] = i);
    let d = he(await _i(e, `${c}/recommendations/v1/papers/for/${encodeURIComponent(r)}?limit=${o}&fields=title,abstract,authors,year,externalIds,url,venue,publicationDate`, n, l));
    return (Array.isArray(d.recommendedPapers) ? d.recommendedPapers : []).slice(0, o).flatMap(xi);
  }, "recommend") };
}
s(eu, "createSemanticScholarConnector");
function Yr(e, t) {
  let r = e.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "iu"));
  return W(r?.[1]).replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"');
}
s(Yr, "xmlTag");
function tu(e) {
  return { descriptor: { id: "arxiv", kind: "literature", label: "arXiv", enabled: true }, async search(t, r) {
    let n = zt(r.limit);
    return [...(await Xl(e, `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(t)}&start=0&max_results=${n}&sortBy=submittedDate&sortOrder=descending`, r)).matchAll(/<entry>([\s\S]*?)<\/entry>/giu)].slice(0, n).flatMap((a) => {
      let c = a[1] ?? "", i = Yr(c, "id").match(/arxiv\.org\/(?:abs|pdf)\/([^?#]+?)(?:\.pdf)?$/iu)?.[1], u = Yr(c, "title");
      if (!i || !u) return [];
      let d = `https://arxiv.org/abs/${i}`, p = [...c.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/giu)].map((m) => W(m[1]).replaceAll("&amp;", "&")), f = Yr(c, "published") || void 0;
      return [{ id: `arxiv:${i}`, title: u, summary: Yr(c, "summary") || "arXiv record", locator: d, sourceType: "literature", authors: p, publishedAt: f, arxivId: i, sourceReceipt: Ci({ sourceRef: `arxiv:${i}`, locator: d, kind: "literature", title: u, payload: c }) }];
    });
  } };
}
s(tu, "createArxivConnector");
function ru(e) {
  return { descriptor: { id: "project-storage", kind: "project-storage", label: "Project files", enabled: true }, async search(t, r) {
    if (!r.cwd) throw new Error("Project storage connector requires a project root");
    let n = zt(r.limit);
    return (await e.search({ cwd: r.cwd, query: t, limit: n, signal: r.signal })).slice(0, n).flatMap((a) => {
      let c = W(a.relativePath).replaceAll("\\", "/");
      if (!c || c.endsWith("/")) return [];
      let l = `project-storage:${_o({ cwd: r.cwd, relativePath: c })}`, i = W(a.title) || c;
      return [{ id: l, title: i, summary: W(a.summary) || [a.format, a.size == null ? "" : `${a.size} bytes`].filter(Boolean).join(" \xB7 "), locator: c, sourceType: "project-storage", sourceReceipt: { sourceRef: l, locator: c, sourceType: "project-storage", title: i, version: a.modifiedAt, accessedAt: Nt(), contentHash: a.contentHash || _o({ cwd: r.cwd, relativePath: c, size: a.size, modifiedAt: a.modifiedAt }), readOnly: true } }];
    });
  } };
}
s(ru, "createProjectStorageConnector");
function Xr(e) {
  let t = [...e.fetchImpl ? [eu(e.fetchImpl), tu(e.fetchImpl)] : [], ...e.projectStorage ? [ru(e.projectStorage)] : []];
  if (!t.length) return { contractVersion: 1, load: s(() => ({ contractVersion: 1, status: "unavailable", list: s(() => [], "list"), recommend: s(async () => {
    throw new Error("Research connector transport is unavailable; the host must inject an authorized connector registry");
  }, "recommend"), search: s(async () => {
    throw new Error("Research connector transport is unavailable; the host must inject an authorized connector registry");
  }, "search") }), "load") };
  let r = new Map(t.map((o) => [o.descriptor.id, o])), n = s(() => t.map((o) => o.descriptor), "list");
  return { contractVersion: 1, load() {
    return { contractVersion: 1, status: "ready", list: n, async recommend(o, a, c = {}, l = 10) {
      let i = r.get(a);
      if (!i) return { hits: [], failures: [{ connectorId: a, message: `Unknown research connector: ${a}`, retryable: false, at: Nt() }] };
      if (!i.recommend) return { hits: [], failures: [] };
      try {
        return { hits: await i.recommend(o, { ...c, limit: l }), failures: [] };
      } catch (u) {
        return { hits: [], failures: [ki(a, u)] };
      }
    }, async search(o, a = {}) {
      let c = o.query.normalize("NFKC").trim();
      if (!c || c.length > 512) throw new Error("Research search query is required");
      let l = o.connectorIds ? [...o.connectorIds] : t.map((h) => h.descriptor.id), i = l.map((h) => r.get(h)).filter((h) => !!h), u = zt(o.limit), d = l.filter((h) => !r.has(h)).map((h) => ({ connectorId: h, message: `Unknown research connector: ${h}`, retryable: false, at: Nt() })), p = await Promise.allSettled(i.map((h) => h.search(c, { ...a, cwd: o.cwd ?? a.cwd, signal: o.signal ?? a.signal, limit: u }))), f = [];
      p.forEach((h, y) => {
        let b = i[y];
        b && (h.status === "fulfilled" ? f.push(...h.value) : d.push(ki(b.descriptor.id, h.reason)));
      });
      let m = [...new Map(f.map((h) => [h.id, h])).values()].slice(0, u * Math.max(1, i.length));
      return { query: c, hits: m, failures: d, connectors: l, complete: d.length === 0 };
    } };
  } };
}
s(Xr, "createResearchConnectorHostLoader");
var nu = /* @__PURE__ */ new Set(["created", "local_query_recorded", "external_search_recorded", "sources_inspected", "sources_archived", "sources_reused", "claims_bound", "answerable"]);
function z(e, t = 1e3) {
  return String(e ?? "").normalize("NFKC").replace(new RegExp("\\p{Cc}", "gu"), " ").replace(/\s+/gu, " ").trim().slice(0, t);
}
s(z, "text");
function jt(e, t) {
  let r = e.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (!r || r.startsWith("/") || r.split("/").includes("..")) throw new Error(`${t} must stay inside the configured workspace`);
  return r;
}
s(jt, "relativePath");
function Ii(e, t) {
  if (!e || typeof e != "object" || Array.isArray(e)) throw new Error(`${t} must be an object`);
  return e;
}
s(Ii, "asObject");
function Ti(e, t) {
  return !!(e && typeof e == "object" && "code" in e && e.code === t);
}
s(Ti, "isErrno");
function ou(e) {
  let t = e.evidence_gate;
  if (!t || typeof t != "object" || Array.isArray(t)) return { stage: "created", answerable: false };
  let r = t, n = z(r.stage, 80);
  return { stage: nu.has(n) ? n : "created", answerable: r.answerable === true };
}
s(ou, "gate");
function Eo(e, t, r) {
  let n = ou(e), o = t.replaceAll("\\", "/"), a = r && o.startsWith(`${r}/`) ? o.slice(r.length + 1) : o;
  return { runId: z(e.run_id || o.split("/").at(-1), 180), resultSlug: z(e.result_slug || a.split("/")[0], 180), project: z(e.project, 180), topicId: z(e.topic_id, 180) || null, query: z(e.query), status: z(e.status, 80) || "unknown", stage: n.stage, answerable: n.answerable, startedAt: z(e.started_at, 80) || null, updatedAt: z(e.updated_at || e.started_at, 80) || null, runDir: a };
}
s(Eo, "summary");
function au(e, t, r) {
  let n = Eo(e, t, r), o = e.evidence_gate, a = o && typeof o == "object" && !Array.isArray(o) ? o : {}, c = Array.isArray(a.events) ? a.events : [], l = ["created", "local_query_recorded", "external_search_recorded", "sources_inspected", "sources_archived", "sources_reused", "claims_bound", "answerable"], i = l.includes(n.stage) ? n.stage : "created", u = l.indexOf(i), d = l.map((v, x) => ({ key: v, state: x < u || v === i && n.answerable ? "complete" : v === i ? "active" : "pending", at: null, detail: null })), p = c.slice(-128).map((v) => {
    let x = v && typeof v == "object" && !Array.isArray(v) ? v : {};
    return { type: z(x.type, 100) || "event", at: z(x.at, 80) || null, detail: z(x.notes || x.outcome || x.reason, 320) || null, status: x.failed === true || x.status === "failed" ? "failed" : x.observed === true ? "observed" : "ok" };
  }), m = (Array.isArray(a.source_refs) ? a.source_refs : []).map((v) => ({ path: z(v, 480), status: "inspected", hash: null, verified: false })), y = (Array.isArray(a.claim_bindings) ? a.claim_bindings : []).map((v) => {
    let x = v && typeof v == "object" && !Array.isArray(v) ? v : {}, $ = Array.isArray(x.sources) ? x.sources.map((g) => g && typeof g == "object" && !Array.isArray(g) ? z(g.path, 480) : z(g, 480)).filter(Boolean) : [];
    return { id: z(x.id, 120) || null, claim: z(x.claim, 480), support: $, status: z(x.status || x.relationship, 80) || "bound" };
  }).filter((v) => v.claim), b = Array.isArray(a.warnings) ? a.warnings.map((v) => z(v, 240)).filter(Boolean) : [], R = Number(a.archive_count), C = Number(a.reuse_count);
  return { ...n, route: d, timeline: p, sources: m, claims: y, warnings: b, coverage: e.retrieval_coverage && typeof e.retrieval_coverage == "object" && !Array.isArray(e.retrieval_coverage) ? e.retrieval_coverage : null, archive: { count: Number.isFinite(R) ? R : 0, reused: Number.isFinite(C) ? C : 0, verified: false } };
}
s(au, "detail");
async function xo(e, t) {
  let r = await e.resolveRoot(t);
  if (!r.handle) throw new Error("Host did not grant a workspace files root");
  let n = {};
  try {
    n = Ii(JSON.parse(await e.readText(r.handle, ".pi/research-workspace.json")), "research workspace configuration");
  } catch (a) {
    if (!Ti(a, "ENOENT")) throw a;
  }
  if (n.resultsRoot !== void 0 && typeof n.resultsRoot != "string") throw new Error("resultsRoot must be a path");
  if (!n.resultsRoot?.startsWith("/")) return { handle: r.handle, path: jt(n.resultsRoot || "results", "resultsRoot") };
  let o = await e.resolveRoot(n.resultsRoot);
  if (!o.handle) throw new Error("Host did not grant the configured results root");
  return { handle: o.handle, path: "" };
}
s(xo, "configuredResultsRoot");
async function Co(e, t, r) {
  let n = jt(r, "runDir"), o = n.split("/");
  if (o.length !== 2 || !o[1].startsWith("run-")) throw new Error("runDir must be a result slug followed by a run directory");
  let a = [t.path, n, "metadata.json"].filter(Boolean).join("/");
  return Ii(JSON.parse(await e.readText(t.handle, a)), "research run metadata");
}
s(Co, "readMetadata");
async function So(e, t, r) {
  let n;
  try {
    n = await e.listFiles(t.handle, t.path);
  } catch (a) {
    if (Ti(a, "ENOENT")) return [];
    throw a;
  }
  let o = [];
  for (let a of n.filter((c) => c.kind === "directory" && !c.name.startsWith("."))) {
    let c = [t.path, jt(a.name, "result slug")].filter(Boolean).join("/"), l = await e.listFiles(t.handle, c);
    for (let i of l.filter((u) => u.kind === "directory" && u.name.startsWith("run-"))) {
      let u = `${a.name}/${i.name}`, d = await Co(e, t, u);
      (!r || z(d.project, 180) === z(r, 180)) && o.push(Eo(d, u, t.path));
    }
  }
  return o.sort((a, c) => (c.updatedAt || "").localeCompare(a.updatedAt || ""));
}
s(So, "discover");
function Ei(e) {
  return Math.max(1, Math.min(50, Number(e) || 10));
}
s(Ei, "limitOf");
function Ao(e) {
  return { contractVersion: 1, operations: { status: s(async (o) => {
    let a = await xo(e, o.workspace);
    if (o.runDir !== void 0 && o.runDir !== null) {
      let l = jt(z(o.runDir, 240), "runDir"), i = await Co(e, a, l);
      return { item: Eo(i, l, a.path) };
    }
    let c = await So(e, a, o.project);
    return { items: c.slice(0, Ei(o.limit)), total: c.length };
  }, "status"), listRuns: s(async (o) => {
    let a = await xo(e, o.workspace), c = await So(e, a, o.project);
    return { items: c.slice(0, Ei(o.limit)), total: c.length };
  }, "listRuns"), detail: s(async (o) => {
    let a = await xo(e, o.workspace), c = o.runDir ? jt(z(o.runDir, 240), "runDir") : null;
    if (!c && o.runId && (c = (await So(e, a)).find((u) => u.runId === z(o.runId, 180))?.runDir ?? null), !c) throw new Error("Research run detail requires runDir or runId");
    let l = await Co(e, a, c);
    return au(l, c, a.path);
  }, "detailOperation") } };
}
s(Ao, "createResearchHost");
function su(e, t) {
  let r = Ao(t);
  return e.register("status", r.operations.status), e.register("listRuns", r.operations.listRuns), r.operations.detail && e.register("detail", r.operations.detail), r;
}
s(su, "registerResearchHost");
var cu = Xr({});
function Qr(e, t = {}) {
  return { contractVersion: 1, operations: { lookup: s((r) => Fe(e.read, r, t), "lookup") } };
}
s(Qr, "createZoteroHost");
function Pi(e, t = {}) {
  return Qr({ read: s((r) => e.execute({ connectorId: "zotero", operation: "read", input: { path: r } }), "read") }, t);
}
s(Pi, "createZoteroConnectorHost");
function uu(e, t, r) {
  let n = Qr(t, r);
  return e.register("lookup", n.operations.lookup), n;
}
s(uu, "registerZoteroHost");
function du(e, t, r) {
  let n = Pi(t, r);
  return e.register("lookup", n.operations.lookup), n;
}
s(du, "registerZoteroConnectorHost");

// packages/extensions/src/institutional-access.ts
var require2 = createRequire(import.meta.url);
var PARTITION = "persist:drone-institutional";
function electron() {
  try {
    return require2("electron");
  } catch {
    return null;
  }
}
function session() {
  const loaded = electron();
  try {
    return loaded?.session?.fromPartition(PARTITION) || null;
  } catch {
    return null;
  }
}
function isElectronAvailable() {
  return Boolean(electron());
}
function getInstitutionalSession() {
  return session();
}
async function institutionalFetch(url, options = {}) {
  const loaded = electron();
  if (!loaded) throw new Error("Electron session unavailable");
  const sess = session();
  const timeoutMs = options.timeoutMs ?? 3e4;
  const fetchFn = loaded.net?.fetch || globalThis.fetch;
  if (typeof fetchFn !== "function") throw new Error("fetch unavailable");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {
      method: "GET",
      headers: options.headers,
      signal: controller.signal,
      session: sess
    });
    const headers = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return {
      status: response.status,
      headers,
      body: new Uint8Array(await response.arrayBuffer()),
      finalUrl: response.url || url,
      response
    };
  } finally {
    clearTimeout(timer);
  }
}
function openWindow(url) {
  const loaded = electron();
  if (!loaded?.BrowserWindow) throw new Error("Electron unavailable");
  const win = new loaded.BrowserWindow({
    width: 1220,
    height: 860,
    title: "\u673A\u6784\u8BBF\u95EE\u767B\u5F55 - Drone",
    webPreferences: { partition: PARTITION, nodeIntegration: false, contextIsolation: true, sandbox: true },
    autoHideMenuBar: true
  });
  const recordNavigation = async (navigatedUrl) => {
    await Jo(navigatedUrl);
    const config = await mn();
    await hn({
      ...config,
      lastLoginAt: (/* @__PURE__ */ new Date()).toISOString(),
      lastLoginUrl: navigatedUrl.slice(0, 2048)
    });
  };
  win.webContents?.on?.("did-navigate", (_event, navigatedUrl) => {
    void recordNavigation(navigatedUrl).catch(() => {
    });
  });
  void win.loadURL(url);
  return { url };
}
function toolResponse(value, details) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], details: details ?? value };
}
function institutionalAccess(pi2) {
  if (process.env.PI_SUBAGENT_CHILD === "1") return;
  pi2.registerTool({
    name: "research_institutional_login",
    label: "Institutional login",
    description: "Open the persistent institutional browser window for EZproxy, Shibboleth, CARSI, OpenAthens, or WebVPN login.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Optional publisher or DOI URL." },
        reason: { type: "string", description: "Optional reason shown in the result." }
      }
    },
    drone: {
      capabilities: ["research"],
      journal: false,
      subagent: "exclude",
      activity: { text: "\u6B63\u5728\u6253\u5F00\u673A\u6784\u767B\u5F55\u7A97\u53E3\u2026", phase: "auth" }
    },
    async execute(_id, params) {
      const target = params?.url || "https://www.nature.com/";
      if (!electron())
        return toolResponse(
          {
            status: "electron_unavailable",
            message: "Institutional login requires Drone desktop (Electron)."
          },
          { status: "electron_unavailable" }
        );
      try {
        const config = await mn();
        const opened = openWindow(Ht(target, config.ezproxyTemplate) || target);
        const next = { ...config, lastLoginAt: (/* @__PURE__ */ new Date()).toISOString(), lastLoginUrl: opened.url };
        await hn(next);
        return toolResponse(
          {
            status: "login_window_opened",
            opened_url: opened.url,
            requested_url: params?.url || null,
            reason: params?.reason || null,
            partition: PARTITION
          },
          { status: "login_window_opened" }
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return toolResponse({ status: "failed", error: message }, { status: "failed", error: message });
      }
    }
  });
  pi2.registerTool({
    name: "research_institutional_status",
    label: "Institutional status",
    description: "Show institutional access configuration and session status.",
    parameters: { type: "object", properties: {} },
    drone: { readOnly: true, capabilities: ["research"] },
    async execute() {
      const config = await mn();
      const current = session();
      let cookiesCount = 0;
      try {
        cookiesCount = current ? (await current.cookies.get({})).length : 0;
      } catch {
        cookiesCount = 0;
      }
      const status = {
        config,
        session: {
          cookiesCount,
          hasSessionCookies: cookiesCount > 0,
          partition: PARTITION,
          lastAccessAt: config.lastLoginAt
        },
        loggedIn: cookiesCount > 0 || Boolean(config.lastLoginAt),
        electronAvailable: Boolean(electron())
      };
      return toolResponse(status, status);
    }
  });
}
export {
  Ht as buildProxiedUrl,
  institutionalAccess as default,
  Jo as detectAndSaveTemplateFromUrl,
  getInstitutionalSession,
  institutionalFetch,
  isElectronAvailable,
  mn as loadInstitutionalConfig,
  hn as saveInstitutionalConfig
};
