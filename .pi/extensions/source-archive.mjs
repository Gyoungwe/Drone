// @ts-nocheck
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// packages/knowledge/src/flow-cards.ts
function statusTone(status2) {
  const value = String(status2 || "");
  if (OK.has(value)) return "ok";
  if (ERROR.has(value)) return "error";
  if (MUTED.has(value)) return "muted";
  return "warn";
}
function cardField(label2, value, extra = {}) {
  const text3 = clip(String(value ?? ""), 200) || "unknown";
  return {
    label: clip(label2, 60) || "",
    ...extra.i18n ? { i18n: extra.i18n } : {},
    value: text3,
    ...extra.status === false ? {} : { status: true },
    ...extra.code !== void 0 ? { code: clip(extra.code, 4096) } : {},
    ...extra.note !== void 0 ? { note: clip(extra.note, 200) } : {},
    tone: extra.tone || (extra.status === false ? "muted" : statusTone(text3))
  };
}
function cardLink(kind, target, label2, i18n) {
  if (!["external", "resource", "note", "path"].includes(kind) || typeof target !== "string" || !target)
    return null;
  return {
    label: clip(label2, 60) || kind,
    ...i18n ? { i18n } : {},
    kind,
    target: target.slice(0, 4096)
  };
}
function flowCard(input) {
  const { key, kind, title, subtitle, status: status2, tone, detail, path, fields, links, source, provisionalTitle } = input;
  const state3 = clip(String(status2 ?? ""), 32) || "unknown";
  const safeKind = clip(kind, 40) || "artifact";
  return {
    key: clip(String(key ?? ""), 512) || `${kind}:${title}`,
    kind: safeKind,
    title: clip(String(title ?? ""), 200) || kind || "artifact",
    provisionalTitle: provisionalTitle === true,
    subtitle: clip(subtitle, 300),
    status: state3,
    tone: tone || statusTone(state3),
    detail: clip(detail, 400),
    path: clip(path, 4096),
    fields: (fields || []).filter(Boolean).slice(0, 12),
    links: (links || []).filter(Boolean).slice(0, 6),
    source: clip(source, 80),
    at: Date.now()
  };
}
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
  const status2 = write ? clip(details.status, 32) || "unknown" : clip(receiptData.status, 32) || zoteroStatus;
  return flowCard({
    key: `doi:${doi}`,
    kind: "literature",
    title: title || doi,
    provisionalTitle: !title,
    subtitle: `DOI ${doi}`,
    status: status2,
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
var OK, ERROR, MUTED, clip, record, ZOTERO_KEY, CHANNEL_LABEL;
var init_flow_cards = __esm({
  "packages/knowledge/src/flow-cards.ts"() {
    "use strict";
    OK = /* @__PURE__ */ new Set([
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
    ERROR = /* @__PURE__ */ new Set([
      "failed",
      "identity-mismatch",
      "missing",
      "blocked",
      "cancelled",
      "not-found",
      "error"
    ]);
    MUTED = /* @__PURE__ */ new Set(["unknown", "unavailable", "pending"]);
    clip = (value, max) => typeof value === "string" && value ? value.slice(0, max) : null;
    record = (value) => value && typeof value === "object" ? value : {};
    ZOTERO_KEY = /^[A-Z0-9]{8}$/;
    CHANNEL_LABEL = { connector: "\u8FDE\u63A5\u5668", web: "Web API" };
  }
});

// packages/knowledge/src/config.ts
import { AsyncLocalStorage as AsyncLocalStorage2 } from "node:async_hooks";
import { createHash as createHash7, randomUUID as randomUUID4 } from "node:crypto";
import { mkdir as mkdir2, readFile as readFile4, realpath as realpath4, rename as rename3, writeFile as writeFile3 } from "node:fs/promises";
import { basename as basename3, isAbsolute as isAbsolute5, join as join3, resolve as resolve5 } from "node:path";
function createKnowledgeConfigState() {
  return { local: new AsyncLocalStorage2(), queues: /* @__PURE__ */ new Map() };
}
function errorCode(error) {
  return error && typeof error === "object" && "code" in error ? error.code : void 0;
}
function knowledgeDirectory() {
  const value = process.env.DRONE_KNOWLEDGE_DIR;
  if (!value) return null;
  if (!isAbsolute5(value)) throw new Error("DRONE_KNOWLEDGE_DIR must be absolute");
  return resolve5(value);
}
function projectIdentity(cwd, configured2) {
  if (typeof configured2 === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(configured2)) return configured2;
  const path = resolve5(cwd);
  const stem = basename3(path).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";
  return `${stem}-${createHash7("sha256").update(path).digest("hex").slice(0, 10)}`;
}
function validateBinding(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1 || !isAbsolute5(String(value.vault || "")) || !/^[a-f0-9]{24}$/.test(String(value.vaultId || "")) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || !["project", "literature", "hybrid"].includes(String(value.profile)) || !["run-only", "verified", "rich"].includes(String(value.depositMode)) || !["none", "read-local"].includes(String(value.subagentPolicy)) || typeof value.updatedAt !== "string")
    throw new Error("Invalid application knowledge binding; no project fallback was used");
}
async function readKnowledgeBindingWithState(state3, { fresh = false } = {}) {
  if (!fresh && state3.local.getStore()) return state3.local.getStore() ?? null;
  const directory = knowledgeDirectory();
  if (!directory) return null;
  let value;
  try {
    value = JSON.parse((await readFile4(join3(directory, "binding.json"), "utf8")).replace(/^\uFEFF/, ""));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw new Error(
      `Knowledge binding cannot be read: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  validateBinding(value);
  return value;
}
async function readKnowledgeBinding(options = {}) {
  return readKnowledgeBindingWithState(defaultState, options);
}
async function withKnowledgeBindingWithState(state3, binding, operation) {
  const current = await readKnowledgeBindingWithState(state3, { fresh: true });
  if (!binding || current?.vaultId !== binding.vaultId || current?.revision !== binding.revision)
    throw new Error("Knowledge binding changed; start a new turn before reading or writing");
  return state3.local.run(binding, operation);
}
async function withKnowledgeBinding(binding, operation) {
  return withKnowledgeBindingWithState(defaultState, binding, operation);
}
var defaultState;
var init_config = __esm({
  "packages/knowledge/src/config.ts"() {
    "use strict";
    defaultState = createKnowledgeConfigState();
  }
});

// packages/knowledge/src/runtime-host.ts
function configureKnowledgeRuntime(host = {}) {
  if (host.runRuntimeExclusive) runtimeExclusive = host.runRuntimeExclusive;
  if (host.emitProcessEvent) processEvent = host.emitProcessEvent;
  if (host.toolMeta) metadataLookup = host.toolMeta;
  if (host.flowCardBuilder) cardBuilderLookup = host.flowCardBuilder;
  if (host.deliveryContract) deliveryLookup = host.deliveryContract;
  if (host.runtimeSlot) hostSlotProvider = host.runtimeSlot;
}
function runtimeSlot2(domain, key, factory) {
  let hostProxy;
  let provider;
  const resolve15 = () => {
    if (hostSlotProvider) {
      if (provider !== hostSlotProvider) {
        provider = hostSlotProvider;
        hostProxy = provider(domain, key, factory);
      }
      return hostProxy;
    }
    const slotKey = `${domain}:${key}`;
    if (!slots.has(slotKey)) slots.set(slotKey, factory());
    return slots.get(slotKey);
  };
  return new Proxy({}, {
    get: (_target, property) => {
      const state3 = resolve15();
      const value = Reflect.get(state3, property);
      return typeof value === "function" ? value.bind(state3) : value;
    },
    set: (_target, property, value) => Reflect.set(resolve15(), property, value),
    ownKeys: () => Reflect.ownKeys(resolve15()),
    getOwnPropertyDescriptor: (_target, property) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(resolve15(), property);
      return descriptor ? { ...descriptor, configurable: true } : void 0;
    }
  });
}
function configureKnowledgeWorker(factory) {
  workerFactory = factory;
}
function createKnowledgeWorker(url, options) {
  return workerFactory(url, options);
}
function configureKnowledgeHost(host = {}) {
  if (host.loadWorkspaceConfig) workspaceConfigLoader = host.loadWorkspaceConfig;
  if (host.publishExplainer) explainerPublisher = host.publishExplainer;
  if (host.consumeKnowledgeReviewPreview) reviewPreviewConsumer = host.consumeKnowledgeReviewPreview;
  if (host.specialistSettings) specialistSettingsReader = host.specialistSettings;
}
function configureKnowledgeSetup(host = {}) {
  if (host.layout) layoutDefinition = host.layout;
  if (host.inspectObsidianSetup) obsidianSetupInspector = host.inspectObsidianSetup;
  if (host.inspectSetupDirectory) setupDirectoryInspector = host.inspectSetupDirectory;
  if (host.resolveSetupVault) setupVaultResolver = host.resolveSetupVault;
  if (host.researchSetupOptions) setupOptionsReader = host.researchSetupOptions;
}
var locks, defaultRunRuntimeExclusive, runtimeExclusive, processEvent, metadataLookup, cardBuilderLookup, deliveryLookup, hostSlotProvider, runRuntimeExclusive2, emitProcessEvent2, slots, workerFactory, requiresPaperEvidence, hasPaperCitation, workspaceConfigLoader, explainerPublisher, reviewPreviewConsumer, specialistSettingsReader, layoutDefinition, obsidianSetupInspector, setupDirectoryInspector, setupVaultResolver, setupOptionsReader, LAYOUT;
var init_runtime_host = __esm({
  "packages/knowledge/src/runtime-host.ts"() {
    "use strict";
    locks = /* @__PURE__ */ new Map();
    defaultRunRuntimeExclusive = async (_namespace, key, work) => {
      const previous = locks.get(key) ?? Promise.resolve();
      let release;
      const current = new Promise((resolve15) => {
        release = resolve15;
      });
      locks.set(key, previous.then(() => current));
      await previous;
      try {
        return await work();
      } finally {
        release();
        if (locks.get(key) === current) locks.delete(key);
      }
    };
    runtimeExclusive = defaultRunRuntimeExclusive;
    processEvent = () => void 0;
    metadataLookup = () => null;
    cardBuilderLookup = () => null;
    deliveryLookup = () => null;
    runRuntimeExclusive2 = (namespace, key, work) => runtimeExclusive(namespace, key, work);
    emitProcessEvent2 = (event, payload) => processEvent(event, payload);
    slots = /* @__PURE__ */ new Map();
    workerFactory = (url, options) => {
      throw new Error(`Knowledge worker host is not configured for ${url.href}`);
    };
    requiresPaperEvidence = (query) => /paper|literature|article|æ–‡çŒ®|è®ºæ–‡/i.test(query);
    hasPaperCitation = (sources) => Array.isArray(sources) && sources.some((source) => /(?:^|\/)Library\/Papers\//.test(String(source?.path ?? "")));
    workspaceConfigLoader = async () => {
      throw new Error("Workspace config host is not configured");
    };
    explainerPublisher = async () => {
      throw new Error("Explainer publisher host is not configured");
    };
    reviewPreviewConsumer = () => null;
    specialistSettingsReader = async () => ({ mode: "strict" });
    layoutDefinition = { templates: {}, noteTemplate: "" };
    obsidianSetupInspector = async () => null;
    setupDirectoryInspector = async () => null;
    setupVaultResolver = (supplied) => supplied;
    setupOptionsReader = () => [];
    LAYOUT = new Proxy({}, {
      get: (_target, key) => layoutDefinition[key]
    });
  }
});

// packages/knowledge/src/files.ts
import { isAbsolute as isAbsolute9, join as join8, relative as relative7, sep as sep7 } from "node:path";
function allowedSegment(name) {
  return !!name && !name.startsWith(".") && !OMIT.has(name) && !/^(?:secrets?|credentials?|id_rsa|id_ed25519)(?:[.\-_]|$)/i.test(name);
}
function validateNote(path) {
  if (typeof path !== "string" || isAbsolute9(path) || path.includes("\\") || !path.endsWith(".md") || !path.split("/").every(allowedSegment))
    throw new Error("Expected an allowed Vault-relative Markdown path");
  const first = path.split("/")[0] ?? "";
  if (RESERVED2.some((name) => name.toLowerCase() === first.toLowerCase() && name !== first))
    throw new Error("Reserved Vault directories require canonical casing");
  return path;
}
function noteScope(path) {
  const parts = path.split("/");
  return path.startsWith("Projects/") && parts.length > 2 ? parts[1] ?? "shared" : "shared";
}
function canRead(path, project) {
  const scope = noteScope(path);
  return scope === "shared" || scope === project;
}
var MAX_NOTE_BYTES, OMIT, RESERVED2;
var init_files = __esm({
  "packages/knowledge/src/files.ts"() {
    "use strict";
    MAX_NOTE_BYTES = 1024 * 1024;
    OMIT = /* @__PURE__ */ new Set([
      "node_modules",
      "dist",
      "build",
      "out",
      "coverage",
      "vendor",
      "venv",
      "__pycache__",
      "Attachments",
      "Templates",
      "_template"
    ]);
    RESERVED2 = ["Projects", "Library", "Wiki", "Attachments", "Templates", "Indexes", "Inbox"];
  }
});

// packages/knowledge/src/review-policy.ts
import { readFileSync } from "node:fs";
import { join as join9 } from "node:path";
function errorCode2(error) {
  return error && typeof error === "object" && "code" in error ? error.code : void 0;
}
function readReviewMode() {
  if (process.env.DRONE_REVIEW_MODE === "strict") return "strict";
  const root = knowledgeDirectory();
  if (!root) return "automatic";
  try {
    const value = JSON.parse(readFileSync(join9(root, "review-policy.json"), "utf8"));
    const mode = value && typeof value === "object" && "mode" in value ? value.mode : void 0;
    return mode === "automatic" ? "automatic" : "strict";
  } catch (error) {
    return errorCode2(error) === "ENOENT" ? "automatic" : "strict";
  }
}
var init_review_policy = __esm({
  "packages/knowledge/src/review-policy.ts"() {
    "use strict";
    init_config();
  }
});

// packages/knowledge/src/ui-state.ts
function deliverKnowledgeUi(value) {
  if (value.kind === "flow" && value.flow?.sessionId) {
    state.flows.set(value.flow.sessionId, structuredClone(value.flow));
    while (state.flows.size > MAX_SESSIONS) state.flows.delete(state.flows.keys().next().value);
  }
  state.seq = Math.max(state.seq, Number(value.sequence) || 0);
  for (const fn of state.listeners) {
    try {
      fn(structuredClone(value));
    } catch {
    }
  }
}
function emitKnowledgeUi(event) {
  const value = { ...event, sequence: ++state.seq };
  deliverKnowledgeUi(value);
  emitProcessEvent2(UI_EVENT, { event: value, origin: uiModule });
  return value;
}
function invalidateKnowledgeUi() {
  emitKnowledgeUi({ kind: "invalidate" });
}
var state, UI_EVENT, uiModule, MAX_SESSIONS;
var init_ui_state = __esm({
  "packages/knowledge/src/ui-state.ts"() {
    "use strict";
    init_runtime_host();
    init_runtime_host();
    init_runtime_host();
    init_flow_cards();
    state = runtimeSlot2("knowledge", "ui", () => ({ listeners: /* @__PURE__ */ new Set(), flows: /* @__PURE__ */ new Map(), seq: 0 }));
    UI_EVENT = "drone:knowledge-ui/v1";
    uiModule = {};
    process.on(UI_EVENT, (payload) => {
      if (!payload || payload.origin === uiModule || !payload.event) return;
      deliverKnowledgeUi(payload.event);
    });
    MAX_SESSIONS = 64;
  }
});

// packages/knowledge/src/specialist-host.ts
var specialist_host_exports = {};
__export(specialist_host_exports, {
  SPECIALIST_LIMITS: () => SPECIALIST_LIMITS,
  contextSessionId: () => contextSessionId,
  knowledgeSpecialistHost: () => knowledgeSpecialistHost,
  registerKnowledgeSpecialistHost: () => registerKnowledgeSpecialistHost,
  setSpecialistSettings: () => setSpecialistSettings,
  specialistQueueSnapshot: () => specialistQueueSnapshot,
  specialistSettings: () => specialistSettings,
  withSpecialistSlot: () => withSpecialistSlot
});
import { randomUUID as randomUUID8 } from "node:crypto";
import { mkdir as mkdir6, readFile as readFile9, rename as rename7, unlink as unlink2, writeFile as writeFile7 } from "node:fs/promises";
import { join as join12 } from "node:path";
function registerKnowledgeSpecialistHost(id, run) {
  if (!id || typeof run !== "function") throw new Error("A specialist host requires a session identity");
  if (state2.disposed) throw new Error("Knowledge specialist runtime has been disposed");
  state2.hosts.set(id, run);
  emitProcessEvent2(HOST_EVENT, { action: "register", id, run, origin: hostModule });
  return () => {
    if (state2.hosts.get(id) === run) state2.hosts.delete(id);
    emitProcessEvent2(HOST_EVENT, { action: "unregister", id, run, origin: hostModule });
  };
}
function knowledgeSpecialistHost(ctx) {
  const id = contextSessionId(ctx);
  return state2.hosts.get(id);
}
async function specialistSettings() {
  const dir = knowledgeDirectory();
  if (!dir) return { mode: "off", revision: 0, ...SPECIALIST_LIMITS };
  let data = { mode: "automatic", revision: 0 };
  try {
    data = JSON.parse(await readFile9(join12(dir, "specialists.json"), "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw new Error("Knowledge specialist settings cannot be read");
  }
  if (!["automatic", "manual", "off"].includes(data.mode) || !Number.isSafeInteger(data.revision) || data.revision < 0)
    throw new Error("Invalid knowledge specialist settings");
  const integerLimits = {
    maxRunsPerTurn: [1, SPECIALIST_LIMITS.maxRunsPerTurn],
    maxRunsPerSession: [1, SPECIALIST_LIMITS.maxRunsPerSession],
    maxToolOperations: [1, SPECIALIST_LIMITS.maxToolOperations],
    concurrency: [1, SPECIALIST_LIMITS.maxConcurrency],
    queueLimit: [1, SPECIALIST_LIMITS.queueLimit],
    queueWaitMs: [50, SPECIALIST_LIMITS.queueWaitMs],
    timeoutMs: [50, SPECIALIST_LIMITS.timeoutMs],
    maxTokensPerTurn: [1, SPECIALIST_LIMITS.maxTokensPerTurn],
    maxTokensPerSession: [1, SPECIALIST_LIMITS.maxTokensPerSession]
  };
  for (const key of Object.keys(integerLimits))
    if (data[key] !== void 0 && (!Number.isSafeInteger(data[key]) || data[key] < integerLimits[key][0]))
      throw new Error("Invalid knowledge specialist settings");
  const costLimits = {
    maxCostPerTurn: SPECIALIST_LIMITS.maxCostPerTurn,
    maxCostPerSession: SPECIALIST_LIMITS.maxCostPerSession
  };
  for (const key of Object.keys(costLimits))
    if (data[key] !== void 0 && (typeof data[key] !== "number" || !Number.isFinite(data[key]) || data[key] < 0))
      throw new Error("Invalid knowledge specialist settings");
  const bounded = {};
  for (const [key, [min, max]] of Object.entries(integerLimits))
    bounded[key] = Math.min(max, Math.max(min, data[key] ?? SPECIALIST_LIMITS[key]));
  for (const [key, max] of Object.entries(costLimits))
    bounded[key] = Math.min(max, Math.max(0, data[key] ?? SPECIALIST_LIMITS[key]));
  return { ...SPECIALIST_LIMITS, ...bounded, mode: data.mode, revision: data.revision };
}
async function setSpecialistSettings({ mode, revision, bindingRevision, ...requested }) {
  if (!["automatic", "manual", "off"].includes(mode) || !Number.isSafeInteger(revision))
    throw new Error("Invalid specialist setting request");
  const allowedRequested = /* @__PURE__ */ new Set([
    "maxRunsPerTurn",
    "maxRunsPerSession",
    "maxToolOperations",
    "concurrency",
    "queueLimit",
    "queueWaitMs",
    "timeoutMs",
    "maxTokensPerTurn",
    "maxTokensPerSession",
    "maxCostPerTurn",
    "maxCostPerSession"
  ]);
  for (const key of Object.keys(requested))
    if (!allowedRequested.has(key)) throw new Error(`Unknown specialist setting: ${key}`);
  const operation = state2.settingsQueue.catch(() => {
  }).then(async () => {
    const binding = await readKnowledgeBinding({ fresh: true });
    if (!binding || binding.revision !== bindingRevision)
      throw new Error("Knowledge binding changed; refresh settings");
    return withKnowledgeBinding(binding, async () => {
      const current = await specialistSettings();
      if (current.revision !== revision) throw new Error("Specialist settings changed; refresh first");
      const data = { ...current, ...requested, mode, revision: revision + 1 };
      const minimums = {
        maxRunsPerTurn: 1,
        maxRunsPerSession: 1,
        maxToolOperations: 1,
        concurrency: 1,
        queueLimit: 1,
        queueWaitMs: 50,
        timeoutMs: 50,
        maxTokensPerTurn: 1,
        maxTokensPerSession: 1
      };
      for (const [key, minimum] of Object.entries(minimums))
        if (data[key] !== void 0 && (!Number.isSafeInteger(data[key]) || data[key] < minimum))
          throw new Error("Invalid knowledge specialist settings");
      for (const key of ["maxCostPerTurn", "maxCostPerSession"])
        if (data[key] !== void 0 && (typeof data[key] !== "number" || !Number.isFinite(data[key]) || data[key] < 0))
          throw new Error("Invalid knowledge specialist settings");
      for (const key of [
        "maxRunsPerTurn",
        "maxRunsPerSession",
        "maxToolOperations",
        "concurrency",
        "queueLimit",
        "queueWaitMs",
        "timeoutMs",
        "maxTokensPerTurn",
        "maxTokensPerSession",
        "maxCostPerTurn",
        "maxCostPerSession"
      ])
        data[key] = Math.min(data[key] ?? SPECIALIST_LIMITS[key], SPECIALIST_LIMITS[key]);
      data.mode = mode;
      data.revision = revision + 1;
      const dir = knowledgeDirectory(), temp = join12(dir, `specialists.${randomUUID8()}.tmp`);
      await mkdir6(dir, { recursive: true, mode: 448 });
      try {
        await writeFile7(temp, `${JSON.stringify(data)}
`, { flag: "wx", mode: 384 });
        await rename7(temp, join12(dir, "specialists.json"));
      } finally {
        await unlink2(temp).catch((e) => {
          if (e.code !== "ENOENT") throw e;
        });
      }
      invalidateKnowledgeUi();
      return { ...SPECIALIST_LIMITS, ...data };
    });
  });
  state2.settingsQueue = operation;
  return operation;
}
async function withSpecialistSlot(signal, work, options = {}) {
  signal?.throwIfAborted();
  if (state2.disposed) throw new Error("Knowledge specialist runtime has been disposed");
  const bounded = (value, fallback, max) => Number.isSafeInteger(value) ? Math.min(max, Math.max(1, value)) : fallback;
  const concurrency = bounded(
    options.concurrency,
    SPECIALIST_LIMITS.concurrency,
    SPECIALIST_LIMITS.maxConcurrency
  );
  const queueLimit = bounded(options.queueLimit, SPECIALIST_LIMITS.queueLimit, SPECIALIST_LIMITS.queueLimit);
  const queueWaitMs = bounded(
    options.queueWaitMs,
    SPECIALIST_LIMITS.queueWaitMs,
    SPECIALIST_LIMITS.queueWaitMs
  );
  if (state2.active >= concurrency) {
    if (state2.queue.length >= queueLimit) throw new Error("Knowledge specialist queue is full");
    await new Promise((resolve15, reject) => {
      let settled = false;
      const item = {
        resolve: () => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", abort);
          clearTimeout(timer);
          resolve15();
        },
        reject: () => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", abort);
          clearTimeout(timer);
          reject(new Error("Knowledge specialist runtime has been disposed"));
        }
      };
      const abort = () => {
        if (settled) return;
        settled = true;
        const at = state2.queue.indexOf(item);
        if (at >= 0) state2.queue.splice(at, 1);
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        reject(new Error("Knowledge specialist cancelled while queued"));
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const at = state2.queue.indexOf(item);
        if (at >= 0) state2.queue.splice(at, 1);
        signal?.removeEventListener("abort", abort);
        reject(new Error("Knowledge specialist queue wait deadline exceeded"));
      }, queueWaitMs);
      state2.queue.push(item);
      signal?.addEventListener("abort", abort, { once: true });
    });
  } else state2.active++;
  try {
    signal?.throwIfAborted();
    return await work();
  } finally {
    if (state2.queue.length) state2.queue.shift().resolve();
    else state2.active--;
  }
}
var state2, HOST_EVENT, hostModule, SPECIALIST_LIMITS, contextSessionId, specialistQueueSnapshot;
var init_specialist_host = __esm({
  "packages/knowledge/src/specialist-host.ts"() {
    "use strict";
    init_runtime_host();
    init_runtime_host();
    init_config();
    init_ui_state();
    state2 = runtimeSlot2("knowledge", "specialists", () => ({
      hosts: /* @__PURE__ */ new Map(),
      active: 0,
      queue: [],
      settingsQueue: Promise.resolve(),
      disposed: false,
      dispose() {
        this.disposed = true;
        this.hosts.clear();
        for (const item of this.queue.splice(0)) item.reject();
      }
    }));
    HOST_EVENT = "drone:knowledge-specialist-host/v1";
    hostModule = {};
    process.on(HOST_EVENT, (payload) => {
      if (!payload || payload.origin === hostModule || typeof payload.id !== "string") return;
      if (payload.action === "register" && typeof payload.run === "function")
        state2.hosts.set(payload.id, payload.run);
      if (payload.action === "unregister" && state2.hosts.get(payload.id) === payload.run)
        state2.hosts.delete(payload.id);
    });
    SPECIALIST_LIMITS = Object.freeze({
      maxRunsPerTurn: 4,
      maxRunsPerSession: 20,
      maxToolOperations: 80,
      concurrency: 2,
      maxConcurrency: 4,
      queueLimit: 8,
      queueWaitMs: 15e3,
      timeoutMs: 12e4,
      maxTokensPerTurn: 24e3,
      maxTokensPerSession: 12e4,
      maxCostPerTurn: 1,
      maxCostPerSession: 5
    });
    contextSessionId = (ctx) => ctx?.sessionManager?.getSessionId?.() || ctx?.sessionId || null;
    specialistQueueSnapshot = () => ({ active: state2.active, queueLength: state2.queue.length });
  }
});

// packages/knowledge/src/wiki-review.ts
var AUTOMATIC_AUTHORITY, MAX_AGE;
var init_wiki_review = __esm({
  "packages/knowledge/src/wiki-review.ts"() {
    "use strict";
    init_runtime_host();
    init_config();
    init_files();
    init_review_policy();
    init_ui_state();
    AUTOMATIC_AUTHORITY = Symbol("host-automatic-wiki");
    MAX_AGE = 24 * 60 * 60 * 1e3;
  }
});

// packages/extensions/src/source-archive.ts
init_flow_cards();

// packages/research/src/literature-receipt.ts
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
function normalizeDoi(value) {
  const doi = String(value || "").trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "").toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : null;
}
function exactDoiItems(items2, doi) {
  const wanted = normalizeDoi(doi);
  return wanted ? items2.filter((item) => normalizeDoi(item.data?.DOI || item.doi || item.DOI) === wanted) : [];
}
function errorName(error) {
  return error instanceof Error ? error.name : "Error";
}
async function verifyLiteratureReceipt({
  doi,
  zotero_key,
  note_path,
  vault,
  signal,
  fetcher = (url, init) => fetch(url, init)
}) {
  const normalizedDoi = normalizeDoi(doi);
  const zoteroKey = String(zotero_key || "");
  if (!normalizedDoi || !/^[A-Z0-9]{8}$/.test(zoteroKey))
    throw new Error("Valid DOI and Zotero key required");
  const receipt = {
    doi: normalizedDoi,
    zoteroKey,
    zotero: { status: "unavailable" },
    obsidian: { status: "unavailable" },
    scientificallyVerified: false
  };
  const get = async (path) => {
    const response = await fetcher(`http://127.0.0.1:23119/api/users/0/${path}`, {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(1e4)]) : AbortSignal.timeout(1e4),
      redirect: "error"
    });
    if (!response.ok) throw new Error(`Zotero HTTP ${response.status}`);
    return response.json();
  };
  try {
    const item = await get(`items/${zoteroKey}`);
    const data = item?.data || {};
    receipt.zotero = {
      status: exactDoiItems([item], normalizedDoi).length ? "verified" : "identity-mismatch",
      title: data.title,
      collections: data.collections || []
    };
    if (receipt.zotero.status === "verified") {
      try {
        const children = await get(`items/${zoteroKey}/children`);
        receipt.zotero.pdfAttachmentKeys = children.filter((child) => child.data?.contentType === "application/pdf").map((child) => String(child.data?.key || "")).filter(Boolean);
        receipt.zotero.fulltextStatus = receipt.zotero.pdfAttachmentKeys.length ? "attachment-indexed-not-read" : "metadata-only";
      } catch {
        receipt.zotero.fulltextStatus = "unavailable";
      }
    }
  } catch (error) {
    receipt.zotero.error = errorName(error) === "TimeoutError" ? "timeout" : "local-api-unavailable";
  }
  let vaultResolved = false;
  try {
    const notePath = String(note_path || "");
    if (!vault || !/^(?:Library)\/Papers\/.+\.md$/.test(notePath) || notePath.split("/").includes("..") || notePath.includes("\\"))
      throw new Error("invalid-note-path");
    const root = await realpath(String(vault));
    vaultResolved = true;
    const file = await realpath(resolve(root, notePath));
    const rel = relative(root, file);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("outside-vault");
    if ((await stat(file)).size > 1024 * 1024) throw new Error("note-too-large");
    const text3 = await readFile(file, "utf8");
    const linked = text3.includes(`zotero:${zoteroKey}`) || new RegExp(`zotero://select/library/items/${zoteroKey}(?=[)\\s<>]|$)`).test(text3) || new RegExp(`^zotero_key: *["']?${zoteroKey}["']? *$`, "m").test(text3);
    const dois = text3.match(/10\.\d{4,9}\/[^\s<>"'\])]+/gi) || [];
    receipt.obsidian = {
      status: linked && dois.some((item) => normalizeDoi(item.replace(/[.,;]+$/, "")) === normalizedDoi) ? "verified" : "identity-mismatch",
      path: notePath,
      vault: root,
      hash: createHash("sha256").update(text3).digest("hex")
    };
  } catch (error) {
    if (vaultResolved && error instanceof Error && "code" in error && error.code === "ENOENT") {
      receipt.obsidian.status = "missing";
      receipt.obsidian.error = "note-missing";
    } else receipt.obsidian.error = "note-unavailable-or-invalid";
  }
  receipt.status = receipt.zotero.status === "verified" && receipt.obsidian.status === "verified" ? "both-verified" : "partial";
  return receipt;
}

// packages/research/src/run-provenance.ts
import { createHash as createHash2, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile as readFile2, realpath as realpath2, rename, stat as stat2, writeFile } from "node:fs/promises";
import { isAbsolute as isAbsolute2, join, relative as relative2, resolve as resolve2, sep as sep2 } from "node:path";
var queues = /* @__PURE__ */ new Map();
var defaultWorkspaceConfig = async (cwd) => ({
  resultsRoot: resolve2(cwd, "results")
});
function within(root, path) {
  const rel = relative2(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep2}`) && !isAbsolute2(rel);
}
async function runPath(cwd, runDir, loadConfig) {
  const config = await loadConfig(cwd);
  const root = await realpath2(config.resultsRoot);
  const run = await realpath2(resolve2(cwd, runDir || ""));
  const parts = relative2(root, run).split(sep2);
  if (!within(root, run) || parts.length !== 2 || !parts[1]?.startsWith("run-")) {
    throw new Error("Expected existing run inside results root");
  }
  await readFile2(join(run, "metadata.json"), "utf8");
  return run;
}
async function readObservations(path) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024) {
      throw new Error("Invalid observation file");
    }
    const data = JSON.parse(await readFile2(path, "utf8"));
    if (data.version !== 1 || !Array.isArray(data.records) || data.records.length > 256 || data.records.some(
      (record2) => !record2 || typeof record2.toolCallId !== "string"
    )) {
      throw new Error("Invalid observation records");
    }
    return data.records;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return [];
    throw error;
  }
}
async function atomic(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2));
  await rename(temp, path);
}
function isNodeError(error, code) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
async function recordRunProvenance({
  cwd = process.cwd(),
  runDir,
  files = [],
  declarations = {},
  loadWorkspaceConfig: loadWorkspaceConfig3 = defaultWorkspaceConfig
}) {
  const run = await runPath(cwd, runDir, loadWorkspaceConfig3);
  const root = await realpath2(cwd);
  if (!Array.isArray(files) || files.length > 64) throw new Error("At most 64 explicitly selected files");
  const snapshots = [];
  for (const item of files) {
    if (!item || typeof item.path !== "string" || !["input", "output", "script", "log"].includes(item.role)) {
      throw new Error("Invalid file declaration");
    }
    const path2 = await realpath2(resolve2(root, item.path));
    if (!within(root, path2) || /(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|auth\.json|credentials(?:\.json)?|\.ssh|\.git)(?:[\\/]|$)/i.test(
      path2
    )) {
      throw new Error("File outside permitted project snapshot scope");
    }
    const before = await stat2(path2);
    if (!before.isFile() || before.size > 128 * 1024 * 1024) throw new Error("Not a bounded regular file");
    const hash = createHash2("sha256");
    for await (const chunk of createReadStream(path2)) hash.update(chunk);
    const after = await stat2(path2);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new Error("File changed while hashing");
    }
    snapshots.push({
      path: relative2(root, path2),
      role: item.role,
      bytes: after.size,
      sha256: hash.digest("hex"),
      snapshotAt: (/* @__PURE__ */ new Date()).toISOString(),
      basis: "current-file-snapshot-not-execution-time-proof"
    });
  }
  let records = [];
  const log = join(run, "execution-observations.json");
  await queues.get(log);
  try {
    records = await readObservations(log);
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
  const declared = JSON.stringify(declarations);
  if (declared.length > 16e3) throw new Error("Declarations too large");
  const value = {
    version: 1,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    runDir: run,
    hostRuntime: { node: process.version, platform: process.platform, arch: process.arch },
    files: snapshots,
    executionObservations: records,
    declarations,
    declaredSoftwareVersionsVerified: false,
    qcVerified: false,
    scientificallyVerified: false,
    executionStatus: records.length ? "tool-observations-present" : "no-execution-observed",
    limitations: [
      "Local observation files are not cryptographically attested; independently check the referenced session trace.",
      "Command text stays in the original session tool call; this manifest contains its digest, not credentials.",
      "File snapshots are post-hoc unless separately collected before execution.",
      "Software versions, parameters and seeds in declarations are not automatically verified; tool success is not QC."
    ]
  };
  const path = join(run, "reproducibility-manifest.json");
  await atomic(path, value);
  return { path, ...value };
}
async function readJson(path) {
  try {
    const value = JSON.parse(await readFile2(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return null;
    throw error;
  }
}
var text = (value) => typeof value === "string" && value ? value : null;
async function readMethodsFacts({
  cwd = process.cwd(),
  runDir,
  loadWorkspaceConfig: loadWorkspaceConfig3 = defaultWorkspaceConfig
}) {
  const run = await runPath(cwd, runDir, loadWorkspaceConfig3);
  const metadata = await readJson(join(run, "metadata.json")) ?? {};
  const manifest = await readJson(
    join(run, "reproducibility-manifest.json")
  );
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  const pick = (role) => files.filter((file) => file.role === role).map((file) => ({ path: file.path, sha256: file.sha256 }));
  const observations = Array.isArray(manifest?.executionObservations) ? manifest.executionObservations : [];
  const declarations = manifest?.declarations && typeof manifest.declarations === "object" ? manifest.declarations : {};
  let existingMethods = null;
  try {
    existingMethods = await readFile2(join(run, "METHODS.md"), "utf8");
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
  const gaps = [];
  if (!manifest)
    gaps.push(
      "No reproducibility manifest: call research_record_run_manifest with inputs, outputs, scripts and declarations first."
    );
  if (!Object.keys(declarations).length)
    gaps.push(
      "No declared software versions or parameters; ask the user or check with bio_environment before stating any."
    );
  if (!pick("input").length) gaps.push("No input files recorded.");
  if (!observations.length) gaps.push("No executed commands were observed for this run.");
  return {
    runDir: relative2(await realpath2(cwd), run) || run,
    query: text(metadata.query),
    status: text(metadata.status),
    startedAt: text(metadata.started_at),
    finalizedAt: text(metadata.finalized_at),
    hostRuntime: manifest?.hostRuntime ?? null,
    inputs: pick("input"),
    outputs: pick("output"),
    scripts: pick("script"),
    declarations,
    commandsObserved: observations.length,
    commandsFailed: observations.filter((record2) => record2.outcome === "failed-or-blocked").length,
    existingMethods,
    gaps
  };
}
async function saveMethodsSection({
  cwd = process.cwd(),
  runDir,
  text: body,
  approvedAt = (/* @__PURE__ */ new Date()).toISOString(),
  loadWorkspaceConfig: loadWorkspaceConfig3 = defaultWorkspaceConfig
}) {
  const content = String(body ?? "").trim();
  if (!content) throw new Error("Methods text is empty");
  if (content.length > 2e4) throw new Error("Methods text is longer than 20,000 characters");
  const run = await runPath(cwd, runDir, loadWorkspaceConfig3);
  const path = join(run, "METHODS.md");
  const document = `<!-- drone:methods approved_at=${approvedAt} \u2014 reviewed by the user; software versions are as declared in reproducibility-manifest.json -->

${content}
`;
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, document, "utf8");
  await rename(temp, path);
  return { path, bytes: Buffer.byteLength(document) };
}

// packages/research/src/source-archive.ts
import { createHash as createHash5, randomUUID as randomUUID2 } from "node:crypto";
import { access, mkdir, readFile as readFile3, realpath as realpath3, rename as rename2, writeFile as writeFile2 } from "node:fs/promises";
import { basename as basename2, dirname, extname, isAbsolute as isAbsolute4, join as join2, relative as relative4, resolve as resolve4, sep as sep4 } from "node:path";

// packages/compute/src/jobs/idempotency.ts
import { createHash as createHash4 } from "node:crypto";

// packages/shared/src/analysis-orchestration.ts
var ANALYSIS_STAGES = Object.freeze([
  "intake",
  "design",
  "readiness",
  "execution",
  "review",
  "delivery",
  "completed"
]);

// node_modules/typebox/build/system/memory/memory.mjs
var memory_exports = {};
__export(memory_exports, {
  Assign: () => Assign,
  Clone: () => Clone,
  Create: () => Create,
  Discard: () => Discard,
  Metrics: () => Metrics,
  Update: () => Update
});

// node_modules/typebox/build/system/memory/metrics.mjs
var Metrics = {
  assign: 0,
  create: 0,
  clone: 0,
  discard: 0,
  update: 0
};

// node_modules/typebox/build/system/memory/assign.mjs
function Assign(left, right) {
  Metrics.assign += 1;
  return { ...left, ...right };
}

// node_modules/typebox/build/guard/guard.mjs
var guard_exports = {};
__export(guard_exports, {
  Entries: () => Entries,
  EntriesRegExp: () => EntriesRegExp,
  Every: () => Every,
  EveryAll: () => EveryAll,
  GraphemeCount: () => GraphemeCount2,
  HasPropertyKey: () => HasPropertyKey,
  IsArray: () => IsArray,
  IsBigInt: () => IsBigInt,
  IsBoolean: () => IsBoolean,
  IsClassInstance: () => IsClassInstance,
  IsConstructor: () => IsConstructor,
  IsDeepEqual: () => IsDeepEqual,
  IsEqual: () => IsEqual,
  IsFunction: () => IsFunction,
  IsGreaterEqualThan: () => IsGreaterEqualThan,
  IsGreaterThan: () => IsGreaterThan,
  IsInteger: () => IsInteger,
  IsLessEqualThan: () => IsLessEqualThan,
  IsLessThan: () => IsLessThan,
  IsMaxLength: () => IsMaxLength2,
  IsMinLength: () => IsMinLength2,
  IsMultipleOf: () => IsMultipleOf,
  IsNull: () => IsNull,
  IsNumber: () => IsNumber,
  IsObject: () => IsObject,
  IsObjectNotArray: () => IsObjectNotArray,
  IsString: () => IsString,
  IsSymbol: () => IsSymbol,
  IsUndefined: () => IsUndefined,
  IsUnsafePropertyKey: () => IsUnsafePropertyKey,
  IsValueLike: () => IsValueLike,
  Keys: () => Keys,
  ShiftLeft: () => ShiftLeft,
  Symbols: () => Symbols,
  Values: () => Values
});

// node_modules/typebox/build/guard/string.mjs
function IsBetween(value, min, max) {
  return value >= min && value <= max;
}
function IsZeroWidthJoiner(value) {
  return value === 8205;
}
function IsHighSurrogate(value) {
  return IsBetween(value, 55296, 56319);
}
function IsRegionalIndicator(value) {
  return IsBetween(value, 127462, 127487);
}
function IsVariationSelector(value) {
  return IsBetween(value, 65024, 65039);
}
function IsCombiningMark(value) {
  return IsBetween(value, 768, 879) || IsBetween(value, 6832, 6911) || IsBetween(value, 7616, 7679) || IsBetween(value, 65056, 65071);
}
function CodePointLength(value) {
  return value > 65535 ? 2 : 1;
}
function ConsumeModifiers(value, index) {
  while (index < value.length) {
    const point = value.codePointAt(index);
    if (IsCombiningMark(point) || IsVariationSelector(point)) {
      index += CodePointLength(point);
    } else {
      break;
    }
  }
  return index;
}
function NextGraphemeClusterIndex(value, clusterStart) {
  const startCP = value.codePointAt(clusterStart);
  let clusterEnd = clusterStart + CodePointLength(startCP);
  clusterEnd = ConsumeModifiers(value, clusterEnd);
  while (clusterEnd < value.length - 1 && value[clusterEnd] === "\u200D") {
    const nextCP = value.codePointAt(clusterEnd + 1);
    clusterEnd += 1 + CodePointLength(nextCP);
    clusterEnd = ConsumeModifiers(value, clusterEnd);
  }
  if (IsRegionalIndicator(startCP) && clusterEnd < value.length && IsRegionalIndicator(value.codePointAt(clusterEnd))) {
    clusterEnd += CodePointLength(value.codePointAt(clusterEnd));
  }
  return clusterEnd;
}
function IsGraphemeCodePoint(value) {
  return IsHighSurrogate(value) || IsCombiningMark(value) || IsVariationSelector(value) || IsZeroWidthJoiner(value);
}
function GraphemeCount(value) {
  let count = 0;
  let index = 0;
  while (index < value.length) {
    index = NextGraphemeClusterIndex(value, index);
    count++;
  }
  return count;
}
function IsMinLength(value, minLength) {
  if (minLength === 0)
    return true;
  let count = 0;
  let index = 0;
  while (index < value.length) {
    index = NextGraphemeClusterIndex(value, index);
    count++;
    if (count >= minLength)
      return true;
  }
  return false;
}
function IsMaxLength(value, maxLength) {
  let count = 0;
  let index = 0;
  while (index < value.length) {
    index = NextGraphemeClusterIndex(value, index);
    count++;
    if (count > maxLength)
      return false;
  }
  return true;
}
function IsMinLengthFast(value, minLength) {
  if (minLength === 0)
    return true;
  let index = 0;
  while (index < value.length) {
    if (IsGraphemeCodePoint(value.charCodeAt(index))) {
      return IsMinLength(value, minLength);
    }
    index++;
    if (index >= minLength)
      return true;
  }
  return false;
}
function IsMaxLengthFast(value, maxLength) {
  let index = 0;
  while (index < value.length) {
    if (IsGraphemeCodePoint(value.charCodeAt(index))) {
      return IsMaxLength(value, maxLength);
    }
    index++;
    if (index > maxLength)
      return false;
  }
  return true;
}

// node_modules/typebox/build/guard/guard.mjs
function IsArray(value) {
  return Array.isArray(value);
}
function IsBigInt(value) {
  return IsEqual(typeof value, "bigint");
}
function IsBoolean(value) {
  return IsEqual(typeof value, "boolean");
}
function IsConstructor(value) {
  if (IsUndefined(value) || !IsFunction(value))
    return false;
  const result = Function.prototype.toString.call(value);
  if (/^class\s/.test(result))
    return true;
  if (/\[native code\]/.test(result))
    return true;
  return false;
}
function IsFunction(value) {
  return IsEqual(typeof value, "function");
}
function IsInteger(value) {
  return Number.isInteger(value);
}
function IsNull(value) {
  return IsEqual(value, null);
}
function IsNumber(value) {
  return Number.isFinite(value);
}
function IsObjectNotArray(value) {
  return IsObject(value) && !IsArray(value);
}
function IsObject(value) {
  return IsEqual(typeof value, "object") && !IsNull(value);
}
function IsString(value) {
  return IsEqual(typeof value, "string");
}
function IsSymbol(value) {
  return IsEqual(typeof value, "symbol");
}
function IsUndefined(value) {
  return IsEqual(value, void 0);
}
function IsEqual(left, right) {
  return left === right;
}
function IsGreaterThan(left, right) {
  return left > right;
}
function IsLessThan(left, right) {
  return left < right;
}
function IsLessEqualThan(left, right) {
  return left <= right;
}
function IsGreaterEqualThan(left, right) {
  return left >= right;
}
function IsMultipleOf(dividend, divisor) {
  if (IsBigInt(dividend) || IsBigInt(divisor)) {
    return BigInt(dividend) % BigInt(divisor) === 0n;
  }
  const tolerance = 1e-10;
  if (!IsNumber(dividend))
    return true;
  if (IsInteger(dividend) && 1 / divisor % 1 === 0)
    return true;
  const mod = dividend % divisor;
  return Math.min(Math.abs(mod), Math.abs(mod - divisor), Math.abs(mod + divisor)) < tolerance;
}
function IsClassInstance(value) {
  if (!IsObject(value))
    return false;
  const proto = globalThis.Object.getPrototypeOf(value);
  if (IsNull(proto))
    return false;
  return IsEqual(typeof proto.constructor, "function") && !(IsEqual(proto.constructor, globalThis.Object) || IsEqual(proto.constructor.name, "Object"));
}
function IsValueLike(value) {
  return IsBigInt(value) || IsBoolean(value) || IsNull(value) || IsNumber(value) || IsString(value) || IsUndefined(value);
}
function GraphemeCount2(value) {
  return GraphemeCount(value);
}
function IsMaxLength2(value, length) {
  return IsMaxLengthFast(value, length);
}
function IsMinLength2(value, length) {
  return IsMinLengthFast(value, length);
}
function Every(value, offset, callback) {
  for (let index = offset; index < value.length; index++) {
    if (!callback(value[index], index))
      return false;
  }
  return true;
}
function EveryAll(value, offset, callback) {
  let result = true;
  for (let index = offset; index < value.length; index++) {
    if (!callback(value[index], index))
      result = false;
  }
  return result;
}
function ShiftLeft(array, true_, false_) {
  return IsEqual(array.length, 0) ? false_() : true_(array[0], array.slice(1));
}
function IsUnsafePropertyKey(key) {
  return IsEqual(key, "__proto__") || IsEqual(key, "constructor") || IsEqual(key, "prototype");
}
function HasPropertyKey(value, key) {
  return IsUnsafePropertyKey(key) ? Object.prototype.hasOwnProperty.call(value, key) : key in value;
}
function EntriesRegExp(value) {
  return Keys(value).map((key) => [new RegExp(`^${key}$`), value[key]]);
}
function Entries(value) {
  return Object.entries(value);
}
function Keys(value) {
  return Object.getOwnPropertyNames(value);
}
function Symbols(value) {
  return Object.getOwnPropertySymbols(value);
}
function Values(value) {
  return Object.values(value);
}
function DeepEqualObject(left, right) {
  if (!IsObject(right))
    return false;
  const keys = Keys(left);
  return IsEqual(keys.length, Keys(right).length) && keys.every((key) => IsDeepEqual(left[key], right[key]));
}
function DeepEqualArray(left, right) {
  return IsArray(right) && IsEqual(left.length, right.length) && left.every((_, index) => IsDeepEqual(left[index], right[index]));
}
function IsDeepEqual(left, right) {
  return IsArray(left) ? DeepEqualArray(left, right) : IsObject(left) ? DeepEqualObject(left, right) : IsEqual(left, right);
}

// node_modules/typebox/build/guard/globals.mjs
var globals_exports = {};
__export(globals_exports, {
  IsBigInt64Array: () => IsBigInt64Array,
  IsBigUint64Array: () => IsBigUint64Array,
  IsBoolean: () => IsBoolean2,
  IsDate: () => IsDate,
  IsFloat32Array: () => IsFloat32Array,
  IsFloat64Array: () => IsFloat64Array,
  IsInt16Array: () => IsInt16Array,
  IsInt32Array: () => IsInt32Array,
  IsInt8Array: () => IsInt8Array,
  IsMap: () => IsMap,
  IsNumber: () => IsNumber2,
  IsRegExp: () => IsRegExp,
  IsSet: () => IsSet,
  IsString: () => IsString2,
  IsTypeArray: () => IsTypeArray,
  IsUint16Array: () => IsUint16Array,
  IsUint32Array: () => IsUint32Array,
  IsUint8Array: () => IsUint8Array,
  IsUint8ClampedArray: () => IsUint8ClampedArray
});
function IsBoolean2(value) {
  return value instanceof Boolean;
}
function IsNumber2(value) {
  return value instanceof Number;
}
function IsString2(value) {
  return value instanceof String;
}
function IsTypeArray(value) {
  return globalThis.ArrayBuffer.isView(value);
}
function IsInt8Array(value) {
  return value instanceof globalThis.Int8Array;
}
function IsUint8Array(value) {
  return value instanceof globalThis.Uint8Array;
}
function IsUint8ClampedArray(value) {
  return value instanceof globalThis.Uint8ClampedArray;
}
function IsInt16Array(value) {
  return value instanceof globalThis.Int16Array;
}
function IsUint16Array(value) {
  return value instanceof globalThis.Uint16Array;
}
function IsInt32Array(value) {
  return value instanceof globalThis.Int32Array;
}
function IsUint32Array(value) {
  return value instanceof globalThis.Uint32Array;
}
function IsFloat32Array(value) {
  return value instanceof globalThis.Float32Array;
}
function IsFloat64Array(value) {
  return value instanceof globalThis.Float64Array;
}
function IsBigInt64Array(value) {
  return value instanceof globalThis.BigInt64Array;
}
function IsBigUint64Array(value) {
  return value instanceof globalThis.BigUint64Array;
}
function IsRegExp(value) {
  return value instanceof globalThis.RegExp;
}
function IsDate(value) {
  return value instanceof globalThis.Date;
}
function IsSet(value) {
  return value instanceof globalThis.Set;
}
function IsMap(value) {
  return value instanceof globalThis.Map;
}

// node_modules/typebox/build/guard/index.mjs
var guard_default = guard_exports;

// node_modules/typebox/build/system/memory/clone.mjs
function FromClassInstance(value) {
  return value;
}
function IsTypeObject(value) {
  return guard_exports.HasPropertyKey(value, "~kind") || guard_exports.HasPropertyKey(value, "~unsafe");
}
function FromTypeObject(value) {
  const result = {};
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Object.keys(descriptors)) {
    if (guard_exports.IsUnsafePropertyKey(key))
      continue;
    const descriptor = descriptors[key];
    if (guard_exports.HasPropertyKey(descriptor, "value")) {
      Object.defineProperty(result, key, { ...descriptor, value: FromValue(descriptor.value) });
    }
  }
  return result;
}
function FromPlainObject(value) {
  const result = {};
  for (const key of guard_exports.Keys(value)) {
    if (guard_exports.IsUnsafePropertyKey(key))
      continue;
    result[key] = FromValue(value[key]);
  }
  for (const key of guard_exports.Symbols(value)) {
    result[key] = FromValue(value[key]);
  }
  return result;
}
function FromObject(value) {
  return guard_exports.IsClassInstance(value) ? FromClassInstance(value) : IsTypeObject(value) ? FromTypeObject(value) : FromPlainObject(value);
}
function FromArray(value) {
  return value.map((element) => FromValue(element));
}
function FromTypedArray(value) {
  return value.slice();
}
function FromRegExp(value) {
  return new RegExp(value.source, value.flags);
}
function FromMap(value) {
  return new Map(FromValue([...value.entries()]));
}
function FromSet(value) {
  return new Set(FromValue([...value.values()]));
}
function FromValue(value) {
  return globals_exports.IsTypeArray(value) ? FromTypedArray(value) : globals_exports.IsRegExp(value) ? FromRegExp(value) : globals_exports.IsMap(value) ? FromMap(value) : globals_exports.IsSet(value) ? FromSet(value) : guard_exports.IsArray(value) ? FromArray(value) : guard_exports.IsObject(value) ? FromObject(value) : value;
}
function Clone(value) {
  Metrics.clone += 1;
  return FromValue(value);
}

// node_modules/typebox/build/system/settings/settings.mjs
var settings_exports = {};
__export(settings_exports, {
  Get: () => Get,
  Reset: () => Reset,
  Set: () => Set2
});
var settings = {
  immutableTypes: false,
  maxErrors: 8,
  useAcceleration: true,
  exactOptionalPropertyTypes: false,
  enumerableKind: false,
  correctiveParse: false,
  unionPrioritySort: true
};
function Reset() {
  settings.immutableTypes = false;
  settings.maxErrors = 8;
  settings.useAcceleration = true;
  settings.exactOptionalPropertyTypes = false;
  settings.enumerableKind = false;
  settings.correctiveParse = false;
  settings.unionPrioritySort = true;
}
function Set2(options) {
  for (const key of guard_exports.Keys(options)) {
    const value = options[key];
    if (value !== void 0) {
      Object.defineProperty(settings, key, { value });
    }
  }
}
function Get() {
  return settings;
}

// node_modules/typebox/build/system/memory/create.mjs
function MergeHidden(left, right) {
  for (const key of Object.keys(right)) {
    Object.defineProperty(left, key, {
      configurable: true,
      writable: true,
      enumerable: false,
      value: right[key]
    });
  }
  return left;
}
function Merge(left, right) {
  return { ...left, ...right };
}
function Create(hidden, enumerable, options = {}) {
  Metrics.create += 1;
  const settings2 = settings_exports.Get();
  const withOptions = Merge(enumerable, options);
  const withHidden = settings2.enumerableKind ? Merge(withOptions, hidden) : MergeHidden(withOptions, hidden);
  return settings2.immutableTypes ? Object.freeze(withHidden) : withHidden;
}

// node_modules/typebox/build/system/memory/discard.mjs
function Discard(value, propertyKeys) {
  Metrics.discard += 1;
  const result = {};
  const descriptors = Object.getOwnPropertyDescriptors(Clone(value));
  const keysToDiscard = new Set(propertyKeys);
  for (const key of Object.keys(descriptors)) {
    if (keysToDiscard.has(key))
      continue;
    Object.defineProperty(result, key, descriptors[key]);
  }
  return result;
}

// node_modules/typebox/build/system/memory/update.mjs
function Update(current, hidden, enumerable) {
  Metrics.update += 1;
  const settings2 = settings_exports.Get();
  const result = Clone(current);
  for (const key of Object.keys(hidden)) {
    Object.defineProperty(result, key, {
      configurable: true,
      writable: true,
      enumerable: settings2.enumerableKind,
      value: hidden[key]
    });
  }
  for (const key of Object.keys(enumerable)) {
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: enumerable[key]
    });
  }
  return result;
}

// node_modules/typebox/build/type/types/schema.mjs
function IsKind(value, kind) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.IsEqual(value["~kind"], kind);
}
function IsSchema(value) {
  return guard_exports.IsObject(value);
}

// node_modules/typebox/build/type/types/deferred.mjs
function Deferred(action, parameters, options) {
  return memory_exports.Create({ "~kind": "Deferred" }, { type: "deferred", action, parameters, options }, {});
}
function IsDeferred(value) {
  return IsKind(value, "Deferred");
}

// node_modules/typebox/build/type/engine/readonly/instantiate_add.mjs
function AddReadonlyOperation(type) {
  return memory_exports.Update(type, { "~readonly": true }, {});
}
function AddReadonlyAction(type, options) {
  const result = memory_exports.Update(AddReadonlyOperation(type), {}, options);
  return result;
}
function AddReadonlyInstantiate(context, state3, type, options) {
  const instantiatedType = InstantiateType(context, state3, type);
  return AddReadonlyAction(instantiatedType, options);
}

// node_modules/typebox/build/type/engine/optional/instantiate_add.mjs
function AddOptionalOperation(type) {
  return memory_exports.Update(type, { "~optional": true }, {});
}
function AddOptionalAction(type, options) {
  const result = memory_exports.Update(AddOptionalOperation(type), {}, options);
  return result;
}
function AddOptionalInstantiate(context, state3, type, options) {
  const instantiatedType = InstantiateType(context, state3, type);
  return AddOptionalAction(instantiatedType, options);
}

// node_modules/typebox/build/type/types/array.mjs
function _Array_(items2, options) {
  return memory_exports.Create({ "~kind": "Array" }, { type: "array", items: items2 }, options);
}
function IsArray2(value) {
  return IsKind(value, "Array");
}
function ArrayOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "items"]);
}

// node_modules/typebox/build/type/types/constructor.mjs
function Constructor(parameters, instanceType, options = {}) {
  return memory_exports.Create({ "~kind": "Constructor" }, { type: "constructor", parameters, instanceType }, options);
}
function IsConstructor2(value) {
  return IsKind(value, "Constructor");
}
function ConstructorOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "parameters", "instanceType"]);
}

// node_modules/typebox/build/type/types/function.mjs
function _Function_(parameters, returnType, options = {}) {
  return memory_exports.Create({ ["~kind"]: "Function" }, { type: "function", parameters, returnType }, options);
}
function IsFunction2(value) {
  return IsKind(value, "Function");
}
function FunctionOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "parameters", "returnType"]);
}

// node_modules/typebox/build/type/types/ref.mjs
function Ref(ref, options) {
  return memory_exports.Create({ ["~kind"]: "Ref" }, { $ref: ref }, options);
}
function IsRef(value) {
  return IsKind(value, "Ref");
}

// node_modules/typebox/build/type/types/generic.mjs
function Generic(parameters, expression) {
  return memory_exports.Create({ "~kind": "Generic" }, { type: "generic", parameters, expression });
}
function IsGeneric(value) {
  return IsKind(value, "Generic");
}

// node_modules/typebox/build/type/types/any.mjs
function Any(options) {
  return memory_exports.Create({ ["~kind"]: "Any" }, {}, options);
}
function IsAny(value) {
  return IsKind(value, "Any");
}

// node_modules/typebox/build/type/types/never.mjs
var NeverPattern = "(?!)";
function Never(options) {
  return memory_exports.Create({ "~kind": "Never" }, { not: {} }, options);
}
function IsNever(value) {
  return IsKind(value, "Never");
}

// node_modules/typebox/build/type/action/_add_optional.mjs
function AddOptionalDeferred(type, options = {}) {
  return Deferred("AddOptional", [type], options);
}
function AddOptional(type, options = {}) {
  return AddOptionalAction(type, options);
}

// node_modules/typebox/build/type/types/_optional.mjs
function Optional(type) {
  return AddOptional(type);
}
function IsOptional(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~optional");
}

// node_modules/typebox/build/type/types/properties.mjs
function RequiredArray(properties) {
  return guard_exports.Keys(properties).filter((key) => !IsOptional(properties[key]));
}
function PropertyKeys(properties) {
  return guard_exports.Keys(properties);
}
function PropertyValues(properties) {
  return guard_exports.Values(properties);
}

// node_modules/typebox/build/type/types/object.mjs
function _Object_(properties, options = {}) {
  const requiredKeys = RequiredArray(properties);
  const required = requiredKeys.length > 0 ? { required: requiredKeys } : {};
  return memory_exports.Create({ "~kind": "Object" }, { type: "object", ...required, properties }, options);
}
function IsObject2(value) {
  return IsKind(value, "Object");
}
function ObjectOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "properties", "required"]);
}

// node_modules/typebox/build/type/types/unknown.mjs
function Unknown(options) {
  return memory_exports.Create({ ["~kind"]: "Unknown" }, {}, options);
}
function IsUnknown(value) {
  return IsKind(value, "Unknown");
}

// node_modules/typebox/build/type/types/cyclic.mjs
function Cyclic($defs, $ref, options) {
  const defs = guard_exports.Keys($defs).reduce((result, key) => {
    return { ...result, [key]: memory_exports.Update($defs[key], {}, { $id: key }) };
  }, {});
  return memory_exports.Create({ ["~kind"]: "Cyclic" }, { $defs: defs, $ref }, options);
}
function IsCyclic(value) {
  return IsKind(value, "Cyclic");
}

// node_modules/typebox/build/type/types/unsafe.mjs
function Unsafe(schema) {
  return memory_exports.Update(schema, { ["~unsafe"]: null }, {});
}
function IsUnsafe(value) {
  return guard_exports.IsObjectNotArray(value) && guard_exports.HasPropertyKey(value, "~unsafe") && guard_exports.IsNull(value["~unsafe"]);
}

// node_modules/typebox/build/system/arguments/arguments.mjs
var arguments_exports = {};
__export(arguments_exports, {
  Match: () => Match
});
function Match(args, match) {
  return match[args.length]?.(...args) ?? (() => {
    throw Error("Invalid Arguments");
  })();
}

// node_modules/typebox/build/type/types/infer.mjs
function Infer(...args) {
  const [name, extends_] = arguments_exports.Match(args, {
    2: (name2, extends_2) => [name2, extends_2, extends_2],
    1: (name2) => [name2, Unknown(), Unknown()]
  });
  return memory_exports.Create({ ["~kind"]: "Infer" }, { type: "infer", name, extends: extends_ }, {});
}
function IsInfer(value) {
  return IsKind(value, "Infer");
}

// node_modules/typebox/build/type/types/dependent.mjs
function Dependent(if_, then_, else_, options = {}) {
  return memory_exports.Create({ "~kind": "Dependent" }, { if: if_, then: then_, else: else_ }, options);
}
function IsDependent(value) {
  return IsKind(value, "Dependent");
}
function DependentOptions(type) {
  return memory_exports.Discard(type, ["~kind", "if", "then", "else"]);
}

// node_modules/typebox/build/type/engine/enum/typescript_enum_to_enum_values.mjs
function IsTypeScriptEnumLike(value) {
  return guard_exports.IsObjectNotArray(value);
}
function TypeScriptEnumToEnumValues(type) {
  const keys = guard_exports.Keys(type).filter((key) => isNaN(key));
  return keys.reduce((result, key) => [...result, type[key]], []);
}

// node_modules/typebox/build/type/types/enum.mjs
function IsEnumValue(value) {
  return guard_exports.IsString(value) || guard_exports.IsNumber(value);
}
function Enum(value, options) {
  const values = IsTypeScriptEnumLike(value) ? TypeScriptEnumToEnumValues(value) : value;
  return memory_exports.Create({ "~kind": "Enum" }, { enum: values }, options);
}
function IsEnum(value) {
  return IsKind(value, "Enum");
}

// node_modules/typebox/build/type/types/intersect.mjs
function Intersect(types, options = {}) {
  return memory_exports.Create({ "~kind": "Intersect" }, { allOf: types }, options);
}
function IsIntersect(value) {
  return IsKind(value, "Intersect");
}
function IntersectOptions(type) {
  return memory_exports.Discard(type, ["~kind", "allOf"]);
}

// node_modules/typebox/build/system/hashing/hash.mjs
var hash_exports = {};
__export(hash_exports, {
  Hash: () => Hash,
  HashCode: () => HashCode
});

// node_modules/typebox/build/system/unreachable/unreachable.mjs
function Unreachable() {
  throw new Error("Unreachable");
}

// node_modules/typebox/build/system/hashing/hash.mjs
function InstanceKeys(value) {
  const propertyKeys = /* @__PURE__ */ new Set();
  let current = value;
  while (current && current !== Object.prototype) {
    for (const key of Reflect.ownKeys(current)) {
      if (key !== "constructor" && typeof key !== "symbol")
        propertyKeys.add(key);
    }
    current = Object.getPrototypeOf(current);
  }
  return [...propertyKeys];
}
function IsIEEE754(value) {
  return typeof value === "number";
}
var ByteMarker;
(function(ByteMarker2) {
  ByteMarker2[ByteMarker2["Array"] = 0] = "Array";
  ByteMarker2[ByteMarker2["BigInt"] = 1] = "BigInt";
  ByteMarker2[ByteMarker2["Boolean"] = 2] = "Boolean";
  ByteMarker2[ByteMarker2["Date"] = 3] = "Date";
  ByteMarker2[ByteMarker2["Constructor"] = 4] = "Constructor";
  ByteMarker2[ByteMarker2["Function"] = 5] = "Function";
  ByteMarker2[ByteMarker2["Null"] = 6] = "Null";
  ByteMarker2[ByteMarker2["Number"] = 7] = "Number";
  ByteMarker2[ByteMarker2["Object"] = 8] = "Object";
  ByteMarker2[ByteMarker2["RegExp"] = 9] = "RegExp";
  ByteMarker2[ByteMarker2["String"] = 10] = "String";
  ByteMarker2[ByteMarker2["Symbol"] = 11] = "Symbol";
  ByteMarker2[ByteMarker2["TypeArray"] = 12] = "TypeArray";
  ByteMarker2[ByteMarker2["Undefined"] = 13] = "Undefined";
})(ByteMarker || (ByteMarker = {}));
var Accumulator = BigInt("14695981039346656037");
var [Prime, Size] = [BigInt("1099511628211"), BigInt(
  "18446744073709551616"
  /* 2 ^ 64 */
)];
var Bytes = Array.from({ length: 256 }).map((_, i) => BigInt(i));
var F64 = new Float64Array(1);
var F64In = new DataView(F64.buffer);
var F64Out = new Uint8Array(F64.buffer);
function FNV1A64_OP(byte) {
  Accumulator = Accumulator ^ Bytes[byte];
  Accumulator = Accumulator * Prime % Size;
}
function FromArray2(value) {
  FNV1A64_OP(ByteMarker.Array);
  for (const item of value) {
    FromValue2(item);
  }
}
function FromBigInt(value) {
  FNV1A64_OP(ByteMarker.BigInt);
  F64In.setBigInt64(0, value);
  for (const byte of F64Out) {
    FNV1A64_OP(byte);
  }
}
function FromBoolean(value) {
  FNV1A64_OP(ByteMarker.Boolean);
  FNV1A64_OP(value ? 1 : 0);
}
function FromConstructor(value) {
  FNV1A64_OP(ByteMarker.Constructor);
  FromValue2(value.toString());
}
function FromDate(value) {
  FNV1A64_OP(ByteMarker.Date);
  FromValue2(value.getTime());
}
function FromFunction(value) {
  FNV1A64_OP(ByteMarker.Function);
  FromValue2(value.toString());
}
function FromNull(_value) {
  FNV1A64_OP(ByteMarker.Null);
}
function FromNumber(value) {
  FNV1A64_OP(ByteMarker.Number);
  F64In.setFloat64(
    0,
    value,
    true
    /* little-endian */
  );
  for (const byte of F64Out) {
    FNV1A64_OP(byte);
  }
}
function FromObject2(value) {
  FNV1A64_OP(ByteMarker.Object);
  for (const key of InstanceKeys(value).sort()) {
    FromValue2(key);
    FromValue2(value[key]);
  }
}
function FromRegExp2(value) {
  FNV1A64_OP(ByteMarker.RegExp);
  FromString(value.toString());
}
var encoder = new TextEncoder();
function FromString(value) {
  FNV1A64_OP(ByteMarker.String);
  for (const byte of encoder.encode(value)) {
    FNV1A64_OP(byte);
  }
}
function FromSymbol(value) {
  FNV1A64_OP(ByteMarker.Symbol);
  FromValue2(value.toString());
}
function FromTypeArray(value) {
  FNV1A64_OP(ByteMarker.TypeArray);
  const buffer = new Uint8Array(value.buffer);
  for (let i = 0; i < buffer.length; i++) {
    FNV1A64_OP(buffer[i]);
  }
}
function FromUndefined(_value) {
  return FNV1A64_OP(ByteMarker.Undefined);
}
function FromValue2(value) {
  return globals_exports.IsTypeArray(value) ? FromTypeArray(value) : globals_exports.IsDate(value) ? FromDate(value) : globals_exports.IsRegExp(value) ? FromRegExp2(value) : globals_exports.IsBoolean(value) ? FromBoolean(value.valueOf()) : globals_exports.IsString(value) ? FromString(value.valueOf()) : globals_exports.IsNumber(value) ? FromNumber(value.valueOf()) : IsIEEE754(value) ? FromNumber(value) : guard_exports.IsArray(value) ? FromArray2(value) : guard_exports.IsBoolean(value) ? FromBoolean(value) : guard_exports.IsBigInt(value) ? FromBigInt(value) : guard_exports.IsConstructor(value) ? FromConstructor(value) : guard_exports.IsNull(value) ? FromNull(value) : guard_exports.IsObject(value) ? FromObject2(value) : guard_exports.IsString(value) ? FromString(value) : guard_exports.IsSymbol(value) ? FromSymbol(value) : guard_exports.IsUndefined(value) ? FromUndefined(value) : guard_exports.IsFunction(value) ? FromFunction(value) : Unreachable();
}
function HashCode(value) {
  Accumulator = BigInt("14695981039346656037");
  FromValue2(value);
  return Accumulator;
}
function Hash(value) {
  return HashCode(value).toString(16).padStart(16, "0");
}

// node_modules/typebox/build/system/locale/en_US.mjs
function en_US(error) {
  switch (error.keyword) {
    case "additionalProperties":
      return "must not have additional properties";
    case "anyOf":
      return "must match a schema in anyOf";
    case "boolean":
      return "schema is false";
    case "const":
      return "must be equal to constant";
    case "contains":
      return "must contain at least 1 valid item";
    case "dependencies":
      return `must have properties ${error.params.dependencies.join(", ")} when property ${error.params.property} is present`;
    case "dependentRequired":
      return `must have properties ${error.params.dependencies.join(", ")} when property ${error.params.property} is present`;
    case "enum":
      return "must be equal to one of the allowed values";
    case "exclusiveMaximum":
      return `must be ${error.params.comparison} ${error.params.limit}`;
    case "exclusiveMinimum":
      return `must be ${error.params.comparison} ${error.params.limit}`;
    case "format":
      return `must match format "${error.params.format}"`;
    case "if":
      return `must match "${error.params.failingKeyword}" schema`;
    case "maxItems":
      return `must not have more than ${error.params.limit} items`;
    case "maxLength":
      return `must not have more than ${error.params.limit} characters`;
    case "maxProperties":
      return `must not have more than ${error.params.limit} properties`;
    case "maximum":
      return `must be ${error.params.comparison} ${error.params.limit}`;
    case "minItems":
      return `must not have fewer than ${error.params.limit} items`;
    case "minLength":
      return `must not have fewer than ${error.params.limit} characters`;
    case "minProperties":
      return `must not have fewer than ${error.params.limit} properties`;
    case "minimum":
      return `must be ${error.params.comparison} ${error.params.limit}`;
    case "multipleOf":
      return `must be multiple of ${error.params.multipleOf}`;
    case "not":
      return "must not be valid";
    case "oneOf":
      return "must match exactly one schema in oneOf";
    case "pattern":
      return `must match pattern "${error.params.pattern}"`;
    case "propertyNames":
      return `property names ${error.params.propertyNames.join(", ")} are invalid`;
    case "required":
      return `must have required properties ${error.params.requiredProperties.join(", ")}`;
    case "type":
      return typeof error.params.type === "string" ? `must be ${error.params.type}` : `must be either ${error.params.type.join(" or ")}`;
    case "unevaluatedItems":
      return "must not have unevaluated items";
    case "unevaluatedProperties":
      return "must not have unevaluated properties";
    case "uniqueItems":
      return `must not have duplicate items`;
    case "~refine":
      return error.params.message;
    // deno-coverage-ignore - unreachable
    default:
      return "an unknown validation error occurred";
  }
}

// node_modules/typebox/build/system/locale/_config.mjs
var locale = en_US;
function Get2() {
  return locale;
}

// node_modules/typebox/build/type/types/_codec.mjs
var EncodeBuilder = class {
  constructor(type, decode) {
    this.type = type;
    this.decode = decode;
  }
  Encode(callback) {
    const type = this.type;
    const decode = IsCodec(type) ? (value) => this.decode(type["~codec"].decode(value)) : this.decode;
    const encode = IsCodec(type) ? (value) => type["~codec"].encode(callback(value)) : callback;
    const codec = { decode, encode };
    return memory_exports.Update(this.type, { "~codec": codec }, {});
  }
};
var DecodeBuilder = class {
  constructor(type) {
    this.type = type;
  }
  Decode(callback) {
    return new EncodeBuilder(this.type, callback);
  }
};
function Codec(type) {
  return new DecodeBuilder(type);
}
function Decode(type, callback) {
  return Codec(type).Decode(callback).Encode(() => {
    throw Error("Encode not implemented");
  });
}
function Encode(type, callback) {
  return Codec(type).Decode(() => {
    throw Error("Decode not implemented");
  }).Encode(callback);
}
function IsCodec(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~codec") && guard_exports.IsObject(value["~codec"]) && guard_exports.HasPropertyKey(value["~codec"], "encode") && guard_exports.HasPropertyKey(value["~codec"], "decode");
}

// node_modules/typebox/build/type/types/_immutable.mjs
function Immutable(type) {
  return AddImmutable(type);
}
function IsImmutable(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~immutable");
}

// node_modules/typebox/build/type/action/_add_readonly.mjs
function AddReadonlyDeferred(type, options = {}) {
  return Deferred("AddReadonly", [type], options);
}
function AddReadonly(type, options = {}) {
  return AddReadonlyAction(type, options);
}

// node_modules/typebox/build/type/types/_readonly.mjs
function Readonly(type) {
  return AddReadonly(type);
}
function IsReadonly(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~readonly");
}

// node_modules/typebox/build/type/types/_refine.mjs
function RefineAdd(type, refinement) {
  const refinements = IsRefine(type) ? [...type["~refine"], refinement] : [refinement];
  return memory_exports.Update(type, { "~refine": refinements }, {});
}
function Refine(...args) {
  const [type, check, error] = arguments_exports.Match(args, {
    3: (type2, check2, error2) => [type2, check2, error2],
    2: (type2, check2) => [type2, check2, () => "Refine Error"]
  });
  return RefineAdd(type, { check, error });
}
function IsRefinement(value) {
  return guard_exports.IsObjectNotArray(value) && guard_exports.HasPropertyKey(value, "check") && guard_exports.HasPropertyKey(value, "error") && guard_exports.IsFunction(value.check) && guard_exports.IsFunction(value.error);
}
function IsRefine(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~refine") && guard_exports.IsArray(value["~refine"]) && guard_exports.Every(value["~refine"], 0, (value2) => IsRefinement(value2));
}

// node_modules/typebox/build/type/types/bigint.mjs
var BigIntPattern = "-?(?:0|[1-9][0-9]*)n";
function BigInt2(options) {
  return memory_exports.Create({ "~kind": "BigInt" }, { type: "bigint" }, options);
}
function IsBigInt2(value) {
  return IsKind(value, "BigInt");
}

// node_modules/typebox/build/type/types/boolean.mjs
function Boolean2(options) {
  return memory_exports.Create({ "~kind": "Boolean" }, { type: "boolean" }, options);
}
function IsBoolean3(value) {
  return IsKind(value, "Boolean");
}

// node_modules/typebox/build/type/types/identifier.mjs
function Identifier(name) {
  return memory_exports.Create({ "~kind": "Identifier" }, { name });
}
function IsIdentifier(value) {
  return IsKind(value, "Identifier");
}

// node_modules/typebox/build/type/types/integer.mjs
var IntegerPattern = "-?(?:0|[1-9][0-9]*)";
function Integer(options) {
  return memory_exports.Create({ "~kind": "Integer" }, { type: "integer" }, options);
}
function IsInteger2(value) {
  return IsKind(value, "Integer");
}

// node_modules/typebox/build/type/types/literal.mjs
var InvalidLiteralValue = class extends Error {
  constructor(value) {
    super(`Invalid Literal value`);
    Object.defineProperty(this, "cause", {
      value: { value },
      writable: false,
      configurable: false,
      enumerable: false
    });
  }
};
function LiteralTypeName(value) {
  return guard_exports.IsBigInt(value) ? "bigint" : guard_exports.IsBoolean(value) ? "boolean" : guard_exports.IsNumber(value) ? "number" : guard_exports.IsString(value) ? "string" : (() => {
    throw new InvalidLiteralValue(value);
  })();
}
function Literal(value, options) {
  return memory_exports.Create({ "~kind": "Literal" }, { type: LiteralTypeName(value), const: value }, options);
}
function IsLiteralValue(value) {
  return guard_exports.IsBigInt(value) || guard_exports.IsBoolean(value) || guard_exports.IsNumber(value) || guard_exports.IsString(value);
}
function IsLiteralBigInt(value) {
  return IsLiteral(value) && guard_exports.IsBigInt(value.const);
}
function IsLiteralBoolean(value) {
  return IsLiteral(value) && guard_exports.IsBoolean(value.const);
}
function IsLiteralNumber(value) {
  return IsLiteral(value) && guard_exports.IsNumber(value.const);
}
function IsLiteralString(value) {
  return IsLiteral(value) && guard_exports.IsString(value.const);
}
function IsLiteral(value) {
  return IsKind(value, "Literal");
}

// node_modules/typebox/build/type/types/null.mjs
function Null(options) {
  return memory_exports.Create({ "~kind": "Null" }, { type: "null" }, options);
}
function IsNull2(value) {
  return IsKind(value, "Null");
}

// node_modules/typebox/build/type/types/number.mjs
var NumberPattern = "-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?";
function Number2(options) {
  return memory_exports.Create({ "~kind": "Number" }, { type: "number" }, options);
}
function IsNumber3(value) {
  return IsKind(value, "Number");
}

// node_modules/typebox/build/type/types/symbol.mjs
function Symbol2(options) {
  return memory_exports.Create({ "~kind": "Symbol" }, { type: "symbol" }, options);
}
function IsSymbol2(value) {
  return IsKind(value, "Symbol");
}

// node_modules/typebox/build/type/types/parameter.mjs
function Parameter(...args) {
  const [name, extends_, equals] = arguments_exports.Match(args, {
    3: (name2, extends_2, equals2) => [name2, extends_2, equals2],
    2: (name2, extends_2) => [name2, extends_2, extends_2],
    1: (name2) => [name2, Unknown(), Unknown()]
  });
  return memory_exports.Create({ "~kind": "Parameter" }, { name, extends: extends_, equals }, {});
}
function IsParameter(value) {
  return IsKind(value, "Parameter");
}

// node_modules/typebox/build/type/types/string.mjs
var StringPattern = ".*";
function String2(options) {
  return memory_exports.Create({ "~kind": "String" }, { type: "string" }, options);
}
function IsString3(value) {
  return IsKind(value, "String");
}

// node_modules/typebox/build/type/types/union.mjs
function Union(anyOf, options = {}) {
  return memory_exports.Create({ "~kind": "Union" }, { anyOf }, options);
}
function IsUnion(value) {
  return IsKind(value, "Union");
}
function UnionOptions(type) {
  return memory_exports.Discard(type, ["~kind", "anyOf"]);
}

// node_modules/typebox/build/type/engine/patterns/pattern.mjs
function ParsePatternIntoTypes(pattern) {
  const parsed = Pattern(pattern);
  const result = guard_exports.IsEqual(parsed.length, 2) ? parsed[0] : [];
  return result;
}

// node_modules/typebox/build/type/engine/template_literal/is_finite.mjs
function FromLiteral(_value) {
  return true;
}
function FromTypesReduce(types) {
  return guard_exports.ShiftLeft(types, (left, right) => FromType(left) ? FromTypesReduce(right) : false, () => true);
}
function FromTypes(types) {
  const result = guard_exports.IsEqual(types.length, 0) ? false : FromTypesReduce(types);
  return result;
}
function FromType(type) {
  return IsUnion(type) ? FromTypes(type.anyOf) : IsLiteral(type) ? FromLiteral(type.const) : false;
}
function IsTemplateLiteralFinite(types) {
  const result = FromTypes(types);
  return result;
}

// node_modules/typebox/build/type/engine/template_literal/create.mjs
function TemplateLiteralCreate(pattern) {
  return memory_exports.Create({ ["~kind"]: "TemplateLiteral" }, { type: "string", pattern }, {});
}

// node_modules/typebox/build/type/engine/template_literal/decode.mjs
function FromLiteralPush(variants, value, result = []) {
  return guard_exports.ShiftLeft(variants, (left, right) => FromLiteralPush(right, value, [...result, `${left}${value}`]), () => result);
}
function FromLiteral2(variants, value) {
  return guard_exports.IsEqual(variants.length, 0) ? [`${value}`] : FromLiteralPush(variants, value);
}
function FromUnion(variants, types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => FromUnion(variants, right, [...result, ...FromType2(variants, left)]), () => result);
}
function FromType2(variants, type) {
  const result = IsUnion(type) ? FromUnion(variants, type.anyOf) : IsLiteral(type) ? FromLiteral2(variants, type.const) : Unreachable();
  return result;
}
function DecodeFromSpan(variants, types) {
  return guard_exports.ShiftLeft(types, (left, right) => DecodeFromSpan(FromType2(variants, left), right), () => variants);
}
function VariantsToLiterals(variants) {
  return variants.map((variant) => Literal(variant));
}
function DecodeTypesAsUnion(types) {
  const variants = DecodeFromSpan([], types);
  const literals = VariantsToLiterals(variants);
  const result = Union(literals);
  return result;
}
function DecodeTypes(types) {
  return guard_exports.IsEqual(types.length, 0) ? Unreachable() : (
    // Literal('') :
    guard_exports.IsEqual(types.length, 1) && IsLiteral(types[0]) ? types[0] : DecodeTypesAsUnion(types)
  );
}
function TemplateLiteralDecodeUnsafe(pattern) {
  const types = ParsePatternIntoTypes(pattern);
  const result = guard_exports.IsEqual(types.length, 0) ? String2() : IsTemplateLiteralFinite(types) ? DecodeTypes(types) : TemplateLiteralCreate(pattern);
  return result;
}
function TemplateLiteralDecode(pattern) {
  const decoded = TemplateLiteralDecodeUnsafe(pattern);
  const result = IsTemplateLiteral(decoded) ? String2() : decoded;
  return result;
}

// node_modules/typebox/build/type/engine/record/record_create.mjs
function CreateRecord(key, value) {
  const type = "object";
  const patternProperties = { [key]: value };
  return memory_exports.Create({ ["~kind"]: "Record" }, { type, patternProperties });
}

// node_modules/typebox/build/type/engine/record/from_key_any.mjs
function FromAnyKey(value) {
  return CreateRecord(StringKey, value);
}

// node_modules/typebox/build/type/engine/record/from_key_boolean.mjs
function FromBooleanKey(value) {
  return _Object_({ true: value, false: value });
}

// node_modules/typebox/build/type/types/tuple.mjs
function Tuple(types, options = {}) {
  const [items2, minItems, additionalItems] = [types, types.length, false];
  return memory_exports.Create({ ["~kind"]: "Tuple" }, { type: "array", additionalItems, items: items2, minItems }, options);
}
function IsTuple(value) {
  return IsKind(value, "Tuple");
}
function TupleOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "items", "minItems", "additionalItems"]);
}

// node_modules/typebox/build/type/engine/readonly/instantiate_remove.mjs
function RemoveReadonlyOperation(type) {
  return memory_exports.Discard(type, ["~readonly"]);
}
function RemoveReadonlyAction(type, options) {
  const result = memory_exports.Update(RemoveReadonlyOperation(type), {}, options);
  return result;
}
function RemoveReadonlyInstantiate(context, state3, type, options) {
  const instantiatedType = InstantiateType(context, state3, type);
  return RemoveReadonlyAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/_remove_readonly.mjs
function RemoveReadonlyDeferred(type, options = {}) {
  return Deferred("RemoveReadonly", [type], options);
}
function RemoveReadonly(type, options = {}) {
  return RemoveReadonlyAction(type, options);
}

// node_modules/typebox/build/type/engine/optional/instantiate_remove.mjs
function RemoveOptionalOperation(type) {
  return memory_exports.Discard(type, ["~optional"]);
}
function RemoveOptionalAction(type, options) {
  const result = memory_exports.Update(RemoveOptionalOperation(type), {}, options);
  return result;
}
function RemoveOptionalInstantiate(context, state3, type, options) {
  const instantiatedType = InstantiateType(context, state3, type);
  return RemoveOptionalAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/_remove_optional.mjs
function RemoveOptionalDeferred(type, options = {}) {
  return Deferred("RemoveOptional", [type], options);
}
function RemoveOptional(type, options = {}) {
  return RemoveOptionalAction(type, options);
}

// node_modules/typebox/build/type/engine/tuple/to_object.mjs
function TupleElementsToProperties(types) {
  const result = types.reduceRight((result2, right, index) => {
    return { [index]: right, ...result2 };
  }, {});
  return result;
}
function TupleToObject(type) {
  const properties = TupleElementsToProperties(type.items);
  const result = _Object_(properties);
  return result;
}

// node_modules/typebox/build/type/engine/evaluate/composite.mjs
function IsReadonlyProperty(left, right) {
  return IsReadonly(left) ? IsReadonly(right) ? true : false : false;
}
function IsOptionalProperty(left, right) {
  return IsOptional(left) ? IsOptional(right) ? true : false : false;
}
function CompositeProperty(left, right) {
  const isReadonly = IsReadonlyProperty(left, right);
  const isOptional = IsOptionalProperty(left, right);
  const evaluated = EvaluateIntersect([left, right]);
  const property = RemoveReadonly(RemoveOptional(evaluated));
  return isReadonly && isOptional ? AddReadonly(AddOptional(property)) : isReadonly && !isOptional ? AddReadonly(property) : !isReadonly && isOptional ? AddOptional(property) : property;
}
function CompositePropertyKey(left, right, key) {
  return key in left ? key in right ? CompositeProperty(left[key], right[key]) : left[key] : key in right ? right[key] : Never();
}
function CompositeProperties(left, right) {
  const keys = /* @__PURE__ */ new Set([...guard_exports.Keys(right), ...guard_exports.Keys(left)]);
  return [...keys].reduce((result, key) => {
    return { ...result, [key]: CompositePropertyKey(left, right, key) };
  }, {});
}
function GetProperties(type) {
  const result = IsObject2(type) ? type.properties : IsTuple(type) ? TupleElementsToProperties(type.items) : Unreachable();
  return result;
}
function Composite(left, right) {
  const leftProperties = GetProperties(left);
  const rightProperties = GetProperties(right);
  const properties = CompositeProperties(leftProperties, rightProperties);
  return _Object_(properties);
}

// node_modules/typebox/build/type/engine/evaluate/narrow.mjs
function Narrow(left, right) {
  const result = Compare(left, right);
  return guard_exports.IsEqual(result, ResultLeftInside) ? left : guard_exports.IsEqual(result, ResultRightInside) ? right : guard_exports.IsEqual(result, ResultEqual) ? right : Never();
}

// node_modules/typebox/build/type/engine/evaluate/distribute.mjs
function IsObjectLike(type) {
  return IsObject2(type) || IsTuple(type);
}
function IsUnionOperand(left, right) {
  const isUnionLeft = IsUnion(left);
  const isUnionRight = IsUnion(right);
  const result = isUnionLeft || isUnionRight;
  return result;
}
function DistributeOperation(left, right) {
  const evaluatedLeft = EvaluateType(left);
  const evaluatedRight = EvaluateType(right);
  const isUnionOperand = IsUnionOperand(evaluatedLeft, evaluatedRight);
  const isObjectLeft = IsObjectLike(evaluatedLeft);
  const IsObjectRight = IsObjectLike(evaluatedRight);
  const result = isUnionOperand ? EvaluateIntersect([evaluatedLeft, evaluatedRight]) : isObjectLeft && IsObjectRight ? Composite(evaluatedLeft, evaluatedRight) : isObjectLeft && !IsObjectRight ? evaluatedLeft : !isObjectLeft && IsObjectRight ? evaluatedRight : Narrow(evaluatedLeft, evaluatedRight);
  return result;
}
function DistributeType(type, types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => DistributeType(type, right, [...result, DistributeOperation(type, left)]), () => guard_exports.IsEqual(result.length, 0) ? [type] : result);
}
function DistributeUnion(types, distribution, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => DistributeUnion(right, distribution, [...result, ...Distribute([left], distribution)]), () => result);
}
function Distribute(types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => IsUnion(left) ? Distribute(right, DistributeUnion(left.anyOf, result)) : Distribute(right, DistributeType(left, result)), () => result);
}

// node_modules/typebox/build/type/engine/exclude/operation.mjs
function ExcludeType(left, right) {
  const check = Extends({}, left, right);
  const result = result_exports.IsExtendsTrueLike(check) ? [] : [left];
  return result;
}
function ExcludeUnion(types, right) {
  return types.reduce((result, head) => {
    return [...result, ...ExcludeType(head, right)];
  }, []);
}
function ExcludeOperation(left, right) {
  const evaluated = EvaluateType(left);
  const canonical2 = IsUnion(evaluated) ? evaluated.anyOf : [evaluated];
  const remaining = ExcludeUnion(canonical2, right);
  const result = EvaluateUnion(remaining);
  return result;
}

// node_modules/typebox/build/type/engine/evaluate/evaluate.mjs
function EvaluateDependent(if_, then_, else_) {
  const intersect = Intersect([if_, then_]);
  const excluded = ExcludeOperation(else_, if_);
  const result = EvaluateUnion([intersect, excluded]);
  return result;
}
function EvaluateEnum(values) {
  const result = values.map((value) => Literal(value));
  return EvaluateUnion(result);
}
function EvaluateIntersect(types) {
  const distribution = Distribute(types);
  const broadend = Broaden(distribution);
  const result = EvaluateUnionFast(broadend);
  return result;
}
function EvaluateTemplateLiteral(pattern) {
  const evaluated = TemplateLiteralDecode(pattern);
  const result = EvaluateType(evaluated);
  return result;
}
function EvaluateUnion(types) {
  const broadend = Broaden(types);
  const result = EvaluateUnionFast(broadend);
  return result;
}
function EvaluateType(type) {
  return IsDependent(type) ? EvaluateDependent(type.if, type.then, type.else) : IsEnum(type) ? EvaluateEnum(type.enum) : IsIntersect(type) ? EvaluateIntersect(type.allOf) : IsTemplateLiteral(type) ? EvaluateTemplateLiteral(type.pattern) : IsUnion(type) ? EvaluateUnion(type.anyOf) : type;
}
function EvaluateUnionFast(types) {
  const result = guard_exports.IsEqual(types.length, 1) ? types[0] : guard_exports.IsEqual(types.length, 0) ? Never() : Union(types);
  return result;
}

// node_modules/typebox/build/type/engine/record/from_key_enum.mjs
function FromEnumKey(values, value) {
  const unionKey = EvaluateEnum(values);
  const result = FromKey(unionKey, value);
  return result;
}

// node_modules/typebox/build/type/engine/record/from_key_integer.mjs
function FromIntegerKey(_key, value) {
  const result = CreateRecord(IntegerKey, value);
  return result;
}

// node_modules/typebox/build/type/engine/record/from_key_intersect.mjs
function FromIntersectKey(types, value) {
  const evaluatedKey = EvaluateIntersect(types);
  const result = FromKey(evaluatedKey, value);
  return result;
}

// node_modules/typebox/build/type/engine/record/from_key_literal.mjs
function FromLiteralKey(key, value) {
  return guard_exports.IsString(key) || guard_exports.IsNumber(key) ? _Object_({ [key]: value }) : guard_exports.IsEqual(key, false) ? _Object_({ false: value }) : guard_exports.IsEqual(key, true) ? _Object_({ true: value }) : _Object_({});
}

// node_modules/typebox/build/type/engine/record/from_key_number.mjs
function FromNumberKey(_key, value) {
  const result = CreateRecord(NumberKey, value);
  return result;
}

// node_modules/typebox/build/type/engine/record/from_key_string.mjs
function FromStringKey(key, value) {
  return guard_exports.HasPropertyKey(key, "pattern") && (guard_exports.IsString(key.pattern) || key.pattern instanceof RegExp) ? CreateRecord(key.pattern.toString(), value) : CreateRecord(StringKey, value);
}

// node_modules/typebox/build/type/engine/record/from_key_template_literal.mjs
function FromTemplateKey(pattern, value) {
  const types = ParsePatternIntoTypes(pattern);
  const finite = IsTemplateLiteralFinite(types);
  const result = finite ? FromKey(EvaluateTemplateLiteral(pattern), value) : CreateRecord(pattern, value);
  return result;
}

// node_modules/typebox/build/type/engine/evaluate/flatten.mjs
function FlattenType(type) {
  const result = IsUnion(type) ? Flatten(type.anyOf) : [type];
  return result;
}
function Flatten(types) {
  return types.reduce((result, type) => {
    return [...result, ...FlattenType(type)];
  }, []);
}

// node_modules/typebox/build/type/engine/record/from_key_union.mjs
function StringOrNumberCheck(types) {
  return types.some((type) => IsString3(type) || IsNumber3(type) || IsInteger2(type));
}
function TryBuildRecord(types, value) {
  return guard_exports.IsEqual(StringOrNumberCheck(types), true) ? CreateRecord(StringKey, value) : void 0;
}
function CreateProperties(types, value) {
  return types.reduce((result, left) => {
    return IsLiteral(left) && (guard_exports.IsString(left.const) || guard_exports.IsNumber(left.const)) ? { ...result, [left.const]: value } : result;
  }, {});
}
function CreateObject(types, value) {
  const properties = CreateProperties(types, value);
  const result = _Object_(properties);
  return result;
}
function FromUnionKey(types, value) {
  const flattened = Flatten(types);
  const record2 = TryBuildRecord(flattened, value);
  return IsSchema(record2) ? record2 : CreateObject(flattened, value);
}

// node_modules/typebox/build/type/engine/record/from_key.mjs
function FromKey(key, value) {
  const result = IsAny(key) ? FromAnyKey(value) : IsBoolean3(key) ? FromBooleanKey(value) : IsEnum(key) ? FromEnumKey(key.enum, value) : IsInteger2(key) ? FromIntegerKey(key, value) : IsIntersect(key) ? FromIntersectKey(key.allOf, value) : IsLiteral(key) ? FromLiteralKey(key.const, value) : IsNumber3(key) ? FromNumberKey(key, value) : IsUnion(key) ? FromUnionKey(key.anyOf, value) : IsString3(key) ? FromStringKey(key, value) : IsTemplateLiteral(key) ? FromTemplateKey(key.pattern, value) : _Object_({});
  return result;
}

// node_modules/typebox/build/type/engine/record/instantiate.mjs
function RecordAction(key, value, options) {
  const result = CanInstantiate([key]) ? memory_exports.Update(FromKey(key, value), {}, options) : RecordDeferred(key, value, options);
  return result;
}
function RecordInstantiate(context, state3, key, value, options) {
  const instantiatedKey = InstantiateType(context, state3, key);
  const instantiatedValue = InstantiateType(context, state3, value);
  return RecordAction(instantiatedKey, instantiatedValue, options);
}

// node_modules/typebox/build/type/types/record.mjs
var IntegerKey = `^${IntegerPattern}$`;
var NumberKey = `^${NumberPattern}$`;
var StringKey = `^${StringPattern}$`;
function RecordDeferred(key, value, options = {}) {
  return Deferred("Record", [key, value], options);
}
function Record(key, value, options = {}) {
  return RecordAction(key, value, options);
}
function RecordFromPattern(pattern, value) {
  return CreateRecord(pattern, value);
}
function RecordPatternToType(pattern) {
  const result = guard_exports.IsEqual(pattern, StringKey) ? String2() : guard_exports.IsEqual(pattern, IntegerKey) ? Integer() : guard_exports.IsEqual(pattern, NumberKey) ? Number2() : TemplateLiteralDecodeUnsafe(pattern);
  return result;
}
function RecordPattern(type) {
  return guard_exports.Keys(type.patternProperties)[0];
}
function RecordKey(type) {
  const pattern = RecordPattern(type);
  const result = RecordPatternToType(pattern);
  return result;
}
function RecordValue(type) {
  return type.patternProperties[RecordPattern(type)];
}
function IsRecord(value) {
  return IsKind(value, "Record");
}

// node_modules/typebox/build/type/types/rest.mjs
function Rest(type) {
  return memory_exports.Create({ "~kind": "Rest" }, { type: "rest", items: type }, {});
}
function IsRest(value) {
  return IsKind(value, "Rest");
}

// node_modules/typebox/build/type/types/this.mjs
function This(options) {
  return memory_exports.Create({ ["~kind"]: "This" }, { $ref: "#" }, options);
}
function IsThis(value) {
  return IsKind(value, "This");
}

// node_modules/typebox/build/type/types/undefined.mjs
function Undefined(options) {
  return memory_exports.Create({ "~kind": "Undefined" }, { type: "undefined" }, options);
}
function IsUndefined2(value) {
  return IsKind(value, "Undefined");
}

// node_modules/typebox/build/type/types/void.mjs
function Void(options) {
  return memory_exports.Create({ "~kind": "Void" }, { type: "void" }, options);
}
function IsVoid(value) {
  return IsKind(value, "Void");
}

// node_modules/typebox/build/type/script/mapping.mjs
function IntrinsicOrCall(ref, parameters) {
  return guard_exports.IsEqual(ref, "Array") ? _Array_(parameters[0]) : guard_exports.IsEqual(ref, "Capitalize") ? CapitalizeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "ConstructorParameters") ? ConstructorParametersDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Evaluate") ? EvaluateDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Exclude") ? ExcludeDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Extract") ? ExtractDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Index") ? IndexDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "InstanceType") ? InstanceTypeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Lowercase") ? LowercaseDeferred(parameters[0]) : guard_exports.IsEqual(ref, "NonNullable") ? NonNullableDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Omit") ? OmitDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Parameters") ? ParametersDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Partial") ? PartialDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Pick") ? PickDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Readonly") ? ReadonlyObjectDeferred(parameters[0]) : guard_exports.IsEqual(ref, "KeyOf") ? KeyOfDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Record") ? RecordDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Required") ? RequiredDeferred(parameters[0]) : guard_exports.IsEqual(ref, "ReturnType") ? ReturnTypeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Uncapitalize") ? UncapitalizeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Uppercase") ? UppercaseDeferred(parameters[0]) : CallConstruct(Ref(ref), parameters);
}
function Unreachable2() {
  throw Error("Unreachable");
}
var DelimitedDecode = (input, result = []) => {
  return input.reduce((result2, left) => {
    return guard_exports.IsArray(left) && guard_exports.IsEqual(left.length, 2) ? [...result2, left[0]] : [...result2, left];
  }, []);
};
var Delimited = (input) => {
  const [left, right] = input;
  return DelimitedDecode([...left, ...right]);
};
function GenericParameterExtendsEqualsMapping(input) {
  return Parameter(input[0], input[2], input[4]);
}
function GenericParameterExtendsMapping(input) {
  return Parameter(input[0], input[2], input[2]);
}
function GenericParameterEqualsMapping(input) {
  return Parameter(input[0], Unknown(), input[2]);
}
function GenericParameterIdentifierMapping(input) {
  return Parameter(input, Unknown(), Unknown());
}
function GenericParameterMapping(input) {
  return input;
}
function GenericParameterListMapping(input) {
  return Delimited(input);
}
function GenericParametersMapping(input) {
  return input[1];
}
function GenericCallArgumentListMapping(input) {
  return Delimited(input);
}
function GenericCallArgumentsMapping(input) {
  return input[1];
}
function GenericCallMapping(input) {
  return IntrinsicOrCall(input[0], input[1]);
}
function OptionalSemiColonMapping(input) {
  return null;
}
function KeywordStringMapping(input) {
  return String2();
}
function KeywordNumberMapping(input) {
  return Number2();
}
function KeywordBooleanMapping(input) {
  return Boolean2();
}
function KeywordUndefinedMapping(input) {
  return Undefined();
}
function KeywordNullMapping(input) {
  return Null();
}
function KeywordIntegerMapping(input) {
  return Integer();
}
function KeywordBigIntMapping(input) {
  return BigInt2();
}
function KeywordUnknownMapping(input) {
  return Unknown();
}
function KeywordAnyMapping(input) {
  return Any();
}
function KeywordObjectMapping(input) {
  return _Object_({});
}
function KeywordNeverMapping(input) {
  return Never();
}
function KeywordSymbolMapping(input) {
  return Symbol2();
}
function KeywordVoidMapping(input) {
  return Void();
}
function KeywordThisMapping(input) {
  return This();
}
function LiteralBigIntMapping(input) {
  return Literal(BigInt(input));
}
function LiteralBooleanMapping(input) {
  return Literal(guard_exports.IsEqual(input, "true"));
}
function LiteralNumberMapping(input) {
  return Literal(parseFloat(input));
}
function LiteralStringMapping(input) {
  return Literal(input);
}
function TemplateInterpolateMapping(input) {
  return input[1];
}
function TemplateSpanMapping(input) {
  return Literal(input);
}
function TemplateBodyMapping(input) {
  return guard_exports.IsEqual(input.length, 3) ? [input[0], input[1], ...input[2]] : [input[0]];
}
function TemplateLiteralTypesMapping(input) {
  return input[1];
}
function TemplateLiteralMapping(input) {
  return TemplateLiteralDeferred(input);
}
function DependentMapping(input) {
  return guard_exports.IsEqual(input.length, 6) ? Dependent(input[1], input[3], input[5]) : Dependent(input[1], input[3], Unknown());
}
function KeyOfMapping(input) {
  return input.length > 0;
}
function IndexArrayMapping(input) {
  return input.reduce((result, current) => {
    return guard_exports.IsEqual(current.length, 3) ? [...result, [current[1]]] : [...result, []];
  }, []);
}
function ExtendsMapping(input) {
  return guard_exports.IsEqual(input.length, 6) ? [input[1], input[3], input[5]] : [];
}
function BaseMapping(input) {
  return guard_exports.IsArray(input) && guard_exports.IsEqual(input.length, 3) ? input[1] : input;
}
function WithMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? input[1] : [];
}
function FactorIndexArray(Type2, indexArray) {
  return indexArray.reduce((result, left) => {
    const _left = left;
    return guard_exports.IsEqual(_left.length, 1) ? IndexDeferred(result, _left[0]) : guard_exports.IsEqual(_left.length, 0) ? _Array_(result) : Unreachable2();
  }, Type2);
}
function FactorExtends(type, extend) {
  return guard_exports.IsEqual(extend.length, 3) ? ConditionalDeferred(type, extend[0], extend[1], extend[2]) : type;
}
function FactorWith(type, withClause) {
  return guard_exports.IsArray(withClause) && guard_exports.IsEqual(withClause.length, 0) ? type : WithDeferred(type, withClause);
}
function FactorMapping(input) {
  const [keyOf, type, indexArray, extend, withClause] = input;
  return FactorWith(keyOf ? FactorExtends(KeyOfDeferred(FactorIndexArray(type, indexArray)), extend) : FactorExtends(FactorIndexArray(type, indexArray), extend), withClause);
}
function ExprBinaryMapping(left, rest) {
  return guard_exports.IsEqual(rest.length, 3) ? (() => {
    const [operator, right, next] = rest;
    const Schema = ExprBinaryMapping(right, next);
    if (guard_exports.IsEqual(operator, "&")) {
      return IsIntersect(Schema) ? Intersect([left, ...Schema.allOf]) : Intersect([left, Schema]);
    }
    if (guard_exports.IsEqual(operator, "|")) {
      return IsUnion(Schema) ? Union([left, ...Schema.anyOf]) : Union([left, Schema]);
    }
    Unreachable2();
  })() : left;
}
function ExprTermTailMapping(input) {
  return input;
}
function ExprTermMapping(input) {
  const [left, rest] = input;
  return ExprBinaryMapping(left, rest);
}
function ExprTailMapping(input) {
  return input;
}
function ExprMapping(input) {
  const [left, rest] = input;
  return ExprBinaryMapping(left, rest);
}
function ExprReadonlyMapping(input) {
  return AddImmutableDeferred(input[1]);
}
function ExprPipeMapping(input) {
  return input[1];
}
function GenericTypeMapping(input) {
  return Generic(input[0], input[2]);
}
function InferTypeMapping(input) {
  return guard_exports.IsEqual(input.length, 4) ? Infer(input[1], input[3]) : guard_exports.IsEqual(input.length, 2) ? Infer(input[1], Unknown()) : Unreachable2();
}
function TypeMapping(input) {
  return input;
}
function PropertyKeyNumberMapping(input) {
  return `${input}`;
}
function PropertyKeyIdentMapping(input) {
  return input;
}
function PropertyKeyQuotedMapping(input) {
  return input;
}
function PropertyKeyIndexMapping(input) {
  return IsInteger2(input[3]) ? IntegerKey : IsNumber3(input[3]) ? NumberKey : IsSymbol2(input[3]) ? StringKey : IsString3(input[3]) ? StringKey : Unreachable2();
}
function PropertyKeyMapping(input) {
  return input;
}
function ReadonlyMapping(input) {
  return input.length > 0;
}
function OptionalMapping(input) {
  return input.length > 0;
}
function PropertyMapping(input) {
  const [isReadonly, key, isOptional, _colon, type] = input;
  return {
    [key]: isReadonly && isOptional ? AddReadonlyDeferred(AddOptionalDeferred(type)) : isReadonly && !isOptional ? AddReadonlyDeferred(type) : !isReadonly && isOptional ? AddOptionalDeferred(type) : type
  };
}
function PropertyDelimiterMapping(input) {
  return input;
}
function PropertyListMapping(input) {
  return Delimited(input);
}
function PropertiesReduce(propertyList) {
  return propertyList.reduce((result, left) => {
    const isPatternProperties = guard_exports.HasPropertyKey(left, IntegerKey) || guard_exports.HasPropertyKey(left, NumberKey) || guard_exports.HasPropertyKey(left, StringKey);
    return isPatternProperties ? [result[0], memory_exports.Assign(result[1], left)] : [memory_exports.Assign(result[0], left), result[1]];
  }, [{}, {}]);
}
function PropertiesMapping(input) {
  return PropertiesReduce(input[1]);
}
function _Object_Mapping(input) {
  const [properties, patternProperties] = input;
  const options = guard_exports.IsEqual(guard_exports.Keys(patternProperties).length, 0) ? {} : { patternProperties };
  return _Object_(properties, options);
}
function ElementNamedMapping(input) {
  return guard_exports.IsEqual(input.length, 5) ? AddReadonlyDeferred(AddOptionalDeferred(input[4])) : guard_exports.IsEqual(input.length, 3) ? input[2] : guard_exports.IsEqual(input.length, 4) ? guard_exports.IsEqual(input[2], "readonly") ? AddReadonlyDeferred(input[3]) : AddOptionalDeferred(input[3]) : Unreachable2();
}
function ElementReadonlyOptionalMapping(input) {
  return AddReadonlyDeferred(AddOptionalDeferred(input[1]));
}
function ElementReadonlyMapping(input) {
  return AddReadonlyDeferred(input[1]);
}
function ElementOptionalMapping(input) {
  return AddOptionalDeferred(input[0]);
}
function ElementBaseMapping(input) {
  return input;
}
function ElementMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? Rest(input[1]) : guard_exports.IsEqual(input.length, 1) ? input[0] : Unreachable2();
}
function ElementListMapping(input) {
  return Delimited(input);
}
function _Tuple_Mapping(input) {
  return Tuple(input[1]);
}
function ParameterReadonlyOptionalMapping(input) {
  return AddReadonlyDeferred(AddOptionalDeferred(input[4]));
}
function ParameterReadonlyMapping(input) {
  return AddReadonlyDeferred(input[3]);
}
function ParameterOptionalMapping(input) {
  return AddOptionalDeferred(input[3]);
}
function ParameterTypeMapping(input) {
  return input[2];
}
function ParameterBaseMapping(input) {
  return input;
}
function ParameterMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? Rest(input[1]) : guard_exports.IsEqual(input.length, 1) ? input[0] : Unreachable2();
}
function ParameterListMapping(input) {
  return Delimited(input);
}
function _Function_Mapping(input) {
  return _Function_(input[1], input[4]);
}
function _Constructor_Mapping(input) {
  return Constructor(input[2], input[5]);
}
function ApplyReadonly(state3, type) {
  return guard_exports.IsEqual(state3, "remove") ? RemoveReadonlyDeferred(type) : guard_exports.IsEqual(state3, "add") ? AddReadonlyDeferred(type) : type;
}
function MappedReadonlyMapping(input) {
  return guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "-") ? "remove" : guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "+") ? "add" : guard_exports.IsEqual(input.length, 1) ? "add" : "none";
}
function ApplyOptional(state3, type) {
  return guard_exports.IsEqual(state3, "remove") ? RemoveOptionalDeferred(type) : guard_exports.IsEqual(state3, "add") ? AddOptionalDeferred(type) : type;
}
function MappedOptionalMapping(input) {
  return guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "-") ? "remove" : guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "+") ? "add" : guard_exports.IsEqual(input.length, 1) ? "add" : "none";
}
function MappedAsMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? [input[1]] : [];
}
function _Mapped_Mapping(input) {
  return guard_exports.IsArray(input[6]) && guard_exports.IsEqual(input[6].length, 1) ? MappedDeferred(Identifier(input[3]), input[5], input[6][0], ApplyReadonly(input[1], ApplyOptional(input[8], input[10]))) : MappedDeferred(Identifier(input[3]), input[5], Ref(input[3]), ApplyReadonly(input[1], ApplyOptional(input[8], input[10])));
}
function ReferenceMapping(input) {
  return Ref(input);
}
function WithBigIntMapping(input) {
  return BigInt(input);
}
function WithNumberMapping(input) {
  return parseFloat(input);
}
function WithBooleanMapping(input) {
  return guard_exports.IsEqual(input, "true");
}
function WithStringMapping(input) {
  return input;
}
function WithNullMapping(input) {
  return null;
}
function WithUndefinedMapping(input) {
  return void 0;
}
function WithPropertyMapping(input) {
  return { [input[0]]: input[2] };
}
function WithPropertyListMapping(input) {
  return Delimited(input);
}
function WithObjectMappingReduce(propertyList) {
  return propertyList.reduce((result, left) => {
    return memory_exports.Assign(result, left);
  }, {});
}
function WithObjectMapping(input) {
  return WithObjectMappingReduce(input[1]);
}
function WithElementListMapping(input) {
  return Delimited(input);
}
function WithArrayMapping(input) {
  return input[1];
}
function WithValueMapping(input) {
  return input;
}
function PatternBigIntMapping(input) {
  return BigInt2();
}
function PatternStringMapping(input) {
  return String2();
}
function PatternNumberMapping(input) {
  return Number2();
}
function PatternIntegerMapping(input) {
  return Integer();
}
function PatternNeverMapping(input) {
  return Never();
}
function PatternTextMapping(input) {
  return Literal(input);
}
function PatternBaseMapping(input) {
  return input;
}
function PatternGroupMapping(input) {
  return Union(input[1]);
}
function PatternUnionMapping(input) {
  return input.length === 3 ? [...input[0], ...input[2]] : input.length === 1 ? [...input[0]] : [];
}
function PatternTermMapping(input) {
  return [input[0], ...input[1]];
}
function PatternBodyMapping(input) {
  return input;
}
function PatternMapping(input) {
  return input[1];
}
function InterfaceDeclarationHeritageListMapping(input) {
  return Delimited(input);
}
function InterfaceDeclarationHeritageMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? input[1] : [];
}
function InterfaceDeclarationGenericMapping(input) {
  const parameters = input[2];
  const heritage = input[3];
  const [properties, patternProperties] = input[4];
  const options = guard_exports.IsEqual(guard_exports.Keys(patternProperties).length, 0) ? {} : { patternProperties };
  return { [input[1]]: Generic(parameters, InterfaceDeferred(heritage, properties, options)) };
}
function InterfaceDeclarationMapping(input) {
  const heritage = input[2];
  const [properties, patternProperties] = input[3];
  const options = guard_exports.IsEqual(guard_exports.Keys(patternProperties).length, 0) ? {} : { patternProperties };
  return { [input[1]]: InterfaceDeferred(heritage, properties, options) };
}
function TypeAliasDeclarationGenericMapping(input) {
  return { [input[1]]: Generic(input[2], input[4]) };
}
function TypeAliasDeclarationMapping(input) {
  return { [input[1]]: input[3] };
}
function ExportKeywordMapping(input) {
  return null;
}
function ModuleDeclarationDelimiterMapping(input) {
  return input;
}
function ModuleDeclarationListMapping(input) {
  return PropertiesReduce(Delimited(input));
}
function ModuleDeclarationMapping(input) {
  return input[1];
}
function ModuleMapping(input) {
  const moduleDeclaration = input[0];
  const moduleDeclarationList = input[1];
  return ModuleDeferred(memory_exports.Assign(moduleDeclaration, moduleDeclarationList[0]));
}
function ScriptMapping(input) {
  return input;
}

// node_modules/typebox/build/type/script/token/internal/match.mjs
function IsMatch(value) {
  return IsEqual(value.length, 2);
}
function Match2(input, ok, fail) {
  return IsMatch(input) ? ok(input[0], input[1]) : fail();
}

// node_modules/typebox/build/type/script/token/internal/take.mjs
function TakeVariant(variant, input) {
  return IsEqual(input.indexOf(variant), 0) ? [variant, input.slice(variant.length)] : [];
}
function Take(variants, input) {
  for (let i = 0; i < variants.length; i++) {
    const result = TakeVariant(variants[i], input);
    if (IsMatch(result))
      return result;
  }
  return [];
}

// node_modules/typebox/build/type/script/token/internal/char.mjs
function Range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, i) => String.fromCharCode(start + i));
}
var Alpha = [
  ...Range(97, 122),
  // Lowercase
  ...Range(65, 90)
  // Uppercase
];
var Zero = "0";
var NonZero = Range(49, 57);
var Digit = [Zero, ...NonZero];
var WhiteSpace = " ";
var NewLine = "\n";
var UnderScore = "_";
var Dot = ".";
var DollarSign = "$";
var Hyphen = "-";

// node_modules/typebox/build/type/script/token/internal/trim.mjs
var LineComment = "//";
var OpenComment = "/*";
var CloseComment = "*/";
function DiscardMultilineComment(input) {
  const index = input.indexOf(CloseComment);
  const result = IsEqual(index, -1) ? "" : input.slice(index + 2);
  return result;
}
function DiscardLineComment(input) {
  const index = input.indexOf(NewLine);
  const result = IsEqual(index, -1) ? "" : input.slice(index);
  return result;
}
function TrimStartUntilNewline(input) {
  return input.replace(/^[ \t\r\f\v]+/, "");
}
function TrimWhitespace(input) {
  const trimmed = TrimStartUntilNewline(input);
  return trimmed.startsWith(OpenComment) ? TrimWhitespace(DiscardMultilineComment(trimmed.slice(2))) : trimmed.startsWith(LineComment) ? TrimWhitespace(DiscardLineComment(trimmed.slice(2))) : trimmed;
}
function Trim(input) {
  const trimmed = input.trimStart();
  return trimmed.startsWith(OpenComment) ? Trim(DiscardMultilineComment(trimmed.slice(2))) : trimmed.startsWith(LineComment) ? Trim(DiscardLineComment(trimmed.slice(2))) : trimmed;
}

// node_modules/typebox/build/type/script/token/internal/optional.mjs
function Optional2(value, input) {
  return Match2(Take([value], input), (Optional4, Rest2) => [Optional4, Rest2], () => ["", input]);
}

// node_modules/typebox/build/type/script/token/internal/many.mjs
function IsDiscard(discard, input) {
  return discard.includes(input);
}
function Many(allowed, discard, input, result = "") {
  return Match2(Take(allowed, input), (Char, Rest2) => IsDiscard(discard, Char) ? Many(allowed, discard, Rest2, result) : Many(allowed, discard, Rest2, `${result}${Char}`), () => [result, input]);
}

// node_modules/typebox/build/type/script/token/unsigned_integer.mjs
function TakeNonZero(input) {
  return Take(NonZero, input);
}
var AllowedDigits = [...Digit, UnderScore];
function TakeDigits(input) {
  return Many(AllowedDigits, [UnderScore], input);
}
function TakeUnsignedInteger(input) {
  return Match2(Take([Zero], input), (Zero2, ZeroRest) => [Zero2, ZeroRest], () => Match2(
    TakeNonZero(input),
    (NonZero2, NonZeroRest) => Match2(TakeDigits(NonZeroRest), (Digits, DigitsRest) => [`${NonZero2}${Digits}`, DigitsRest], () => []),
    // fail: did not match Digits
    () => []
  ));
}
function UnsignedInteger(input) {
  return TakeUnsignedInteger(Trim(input));
}

// node_modules/typebox/build/type/script/token/integer.mjs
function TakeSign(input) {
  return Optional2(Hyphen, input);
}
function TakeSignedInteger(input) {
  return Match2(
    TakeSign(input),
    (Sign, SignRest) => Match2(UnsignedInteger(SignRest), (UnsignedInteger2, UnsignedIntegerRest) => [`${Sign}${UnsignedInteger2}`, UnsignedIntegerRest], () => []),
    // fail: did not match unsigned integer
    () => []
  );
}
function Integer2(input) {
  return TakeSignedInteger(Trim(input));
}

// node_modules/typebox/build/type/script/token/bigint.mjs
function TakeBigInt(input) {
  return Match2(
    Integer2(input),
    (Integer3, IntegerRest) => Match2(Take(["n"], IntegerRest), (_N, NRest) => [`${Integer3}`, NRest], () => []),
    // fail: did not match 'n'
    () => []
  );
}
function BigInt3(input) {
  return TakeBigInt(input);
}

// node_modules/typebox/build/type/script/token/const.mjs
function TakeConst(const_, input) {
  return Take([const_], input);
}
function Const(const_, input) {
  return IsEqual(const_, "") ? ["", input] : const_.startsWith(NewLine) ? TakeConst(const_, TrimWhitespace(input)) : const_.startsWith(WhiteSpace) ? TakeConst(const_, input) : TakeConst(const_, Trim(input));
}

// node_modules/typebox/build/type/script/token/ident.mjs
var Initial = [...Alpha, UnderScore, DollarSign];
function TakeInitial(input) {
  return Take(Initial, input);
}
var Remaining = [...Initial, ...Digit];
function TakeRemaining(input, result = "") {
  return Match2(Take(Remaining, input), (Remaining2, RemainingRest) => TakeRemaining(RemainingRest, `${result}${Remaining2}`), () => [result, input]);
}
function TakeIdent(input) {
  return Match2(
    TakeInitial(input),
    (Initial2, InitialRest) => Match2(TakeRemaining(InitialRest), (Remaining2, RemainingRest) => [`${Initial2}${Remaining2}`, RemainingRest], () => []),
    // fail: did not match Remaining
    () => []
  );
}
function Ident(input) {
  return TakeIdent(Trim(input));
}

// node_modules/typebox/build/type/script/token/unsigned_number.mjs
var AllowedDigits2 = [...Digit, UnderScore];
function IsLeadingDot(input) {
  return IsMatch(Take([Dot], input));
}
function TakeFractional(input) {
  return Match2(Many(AllowedDigits2, [UnderScore], input), (Digits, DigitsRest) => IsEqual(Digits, "") ? [] : [Digits, DigitsRest], () => []);
}
function LeadingDot(input) {
  return Match2(
    Take([Dot], input),
    (Dot2, DotRest) => Match2(TakeFractional(DotRest), (Fractional, FractionalRest) => [`0${Dot2}${Fractional}`, FractionalRest], () => []),
    // fail: did not match Fractional
    () => []
  );
}
function LeadingInteger(input) {
  return Match2(
    UnsignedInteger(input),
    (Integer3, IntegerRest) => Match2(
      Take([Dot], IntegerRest),
      (Dot2, DotRest) => Match2(TakeFractional(DotRest), (Fractional, FractionalRest) => [`${Integer3}${Dot2}${Fractional}`, FractionalRest], () => [`${Integer3}`, DotRest]),
      // fail: did not match Fractional, use Integer
      () => [`${Integer3}`, IntegerRest]
    ),
    // fail: did not match Dot, use Integer
    () => []
  );
}
function TakeUnsignedNumber(input) {
  return IsLeadingDot(input) ? LeadingDot(input) : LeadingInteger(input);
}
function UnsignedNumber(input) {
  return TakeUnsignedNumber(Trim(input));
}

// node_modules/typebox/build/type/script/token/number.mjs
function TakeSign2(input) {
  return Optional2(Hyphen, input);
}
function TakeSignedNumber(input) {
  return Match2(
    TakeSign2(input),
    (Sign, SignRest) => Match2(UnsignedNumber(SignRest), (UnsignedInteger2, UnsignedIntegerRest) => [`${Sign}${UnsignedInteger2}`, UnsignedIntegerRest], () => []),
    // fail: did not match unsigned integer
    () => []
  );
}
function Number3(input) {
  return TakeSignedNumber(Trim(input));
}

// node_modules/typebox/build/type/script/token/until.mjs
function TakeOne(input) {
  const result = IsEqual(input, "") ? [] : [input.slice(0, 1), input.slice(1)];
  return result;
}
function IsInputMatchSentinal(end, input) {
  return ShiftLeft(end, (left, right) => input.startsWith(left) ? true : IsInputMatchSentinal(right, input), () => false);
}
function Until(end, input, result = "") {
  return Match2(
    TakeOne(input),
    (One, Rest2) => IsInputMatchSentinal(end, input) ? [result, input] : Until(end, Rest2, `${result}${One}`),
    () => []
  );
}

// node_modules/typebox/build/type/script/token/span.mjs
function MultiLine(start, end, input) {
  return Match2(
    Take([start], input),
    (_, Rest2) => Match2(
      Until([end], Rest2),
      (Until2, UntilRest) => Match2(Take([end], UntilRest), (_2, Rest3) => [`${Until2}`, Rest3], () => []),
      // fail: did not match End
      () => []
    ),
    // fail: did not match Until
    () => []
  );
}
function SingleLine(start, end, input) {
  return Match2(
    Take([start], input),
    (_, Rest2) => Match2(
      Until([NewLine, end], Rest2),
      (Until2, UntilRest) => Match2(Take([end], UntilRest), (_2, EndRest) => [`${Until2}`, EndRest], () => []),
      // fail: did not match End
      () => []
    ),
    // fail: did not match Until
    () => []
  );
}
function Span(start, end, multiLine, input) {
  return multiLine ? MultiLine(start, end, Trim(input)) : SingleLine(start, end, Trim(input));
}

// node_modules/typebox/build/type/script/token/string.mjs
function TakeInitial2(quotes, input) {
  return Take(quotes, input);
}
function TakeSpan(quote, input) {
  return Span(quote, quote, false, input);
}
function TakeString(quotes, input) {
  return Match2(TakeInitial2(quotes, input), (Initial2, InitialRest) => TakeSpan(Initial2, `${Initial2}${InitialRest}`), () => []);
}
function String3(quotes, input) {
  return TakeString(quotes, Trim(input));
}

// node_modules/typebox/build/type/script/token/until_1.mjs
function Until_1(end, input) {
  return Match2(Until(end, input), (Until2, UntilRest) => IsEqual(Until2, "") ? [] : [Until2, UntilRest], () => []);
}

// node_modules/typebox/build/type/script/parser.mjs
var If = (result, left, right = () => []) => result.length === 2 ? left(result) : right();
var GenericParameterExtendsEquals = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("extends", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => If(Const("=", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [GenericParameterExtendsEqualsMapping(_0), input2]);
var GenericParameterExtends = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("extends", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericParameterExtendsMapping(_0), input2]);
var GenericParameterEquals = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("=", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericParameterEqualsMapping(_0), input2]);
var GenericParameterIdentifier = (input) => If(Ident(input), ([_0, input2]) => [GenericParameterIdentifierMapping(_0), input2]);
var GenericParameter = (input) => If(If(GenericParameterExtendsEquals(input), ([_0, input2]) => [_0, input2], () => If(GenericParameterExtends(input), ([_0, input2]) => [_0, input2], () => If(GenericParameterEquals(input), ([_0, input2]) => [_0, input2], () => If(GenericParameterIdentifier(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [GenericParameterMapping(_0), input2]);
var GenericParameterList_0 = (input, result = []) => If(If(GenericParameter(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => GenericParameterList_0(input2, [...result, _0]), () => [result, input]);
var GenericParameterList = (input) => If(If(GenericParameterList_0(input), ([_0, input2]) => If(If(If(GenericParameter(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [GenericParameterListMapping(_0), input2]);
var GenericParameters = (input) => If(If(Const("<", input), ([_0, input2]) => If(GenericParameterList(input2), ([_1, input3]) => If(Const(">", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericParametersMapping(_0), input2]);
var GenericCallArgumentList_0 = (input, result = []) => If(If(Type(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => GenericCallArgumentList_0(input2, [...result, _0]), () => [result, input]);
var GenericCallArgumentList = (input) => If(If(GenericCallArgumentList_0(input), ([_0, input2]) => If(If(If(Type(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [GenericCallArgumentListMapping(_0), input2]);
var GenericCallArguments = (input) => If(If(Const("<", input), ([_0, input2]) => If(GenericCallArgumentList(input2), ([_1, input3]) => If(Const(">", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericCallArgumentsMapping(_0), input2]);
var GenericCall = (input) => If(If(Ident(input), ([_0, input2]) => If(GenericCallArguments(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [GenericCallMapping(_0), input2]);
var OptionalSemiColon = (input) => If(If(If(Const(";", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [OptionalSemiColonMapping(_0), input2]);
var KeywordString = (input) => If(Const("string", input), ([_0, input2]) => [KeywordStringMapping(_0), input2]);
var KeywordNumber = (input) => If(Const("number", input), ([_0, input2]) => [KeywordNumberMapping(_0), input2]);
var KeywordBoolean = (input) => If(Const("boolean", input), ([_0, input2]) => [KeywordBooleanMapping(_0), input2]);
var KeywordUndefined = (input) => If(Const("undefined", input), ([_0, input2]) => [KeywordUndefinedMapping(_0), input2]);
var KeywordNull = (input) => If(Const("null", input), ([_0, input2]) => [KeywordNullMapping(_0), input2]);
var KeywordInteger = (input) => If(Const("integer", input), ([_0, input2]) => [KeywordIntegerMapping(_0), input2]);
var KeywordBigInt = (input) => If(Const("bigint", input), ([_0, input2]) => [KeywordBigIntMapping(_0), input2]);
var KeywordUnknown = (input) => If(Const("unknown", input), ([_0, input2]) => [KeywordUnknownMapping(_0), input2]);
var KeywordAny = (input) => If(Const("any", input), ([_0, input2]) => [KeywordAnyMapping(_0), input2]);
var KeywordObject = (input) => If(Const("object", input), ([_0, input2]) => [KeywordObjectMapping(_0), input2]);
var KeywordNever = (input) => If(Const("never", input), ([_0, input2]) => [KeywordNeverMapping(_0), input2]);
var KeywordSymbol = (input) => If(Const("symbol", input), ([_0, input2]) => [KeywordSymbolMapping(_0), input2]);
var KeywordVoid = (input) => If(Const("void", input), ([_0, input2]) => [KeywordVoidMapping(_0), input2]);
var KeywordThis = (input) => If(Const("this", input), ([_0, input2]) => [KeywordThisMapping(_0), input2]);
var TemplateInterpolate = (input) => If(If(Const("${", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("}", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [TemplateInterpolateMapping(_0), input2]);
var TemplateSpan = (input) => If(Until(["${", "`"], input), ([_0, input2]) => [TemplateSpanMapping(_0), input2]);
var TemplateBody = (input) => If(If(If(TemplateSpan(input), ([_0, input2]) => If(TemplateInterpolate(input2), ([_1, input3]) => If(TemplateBody(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(If(TemplateSpan(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(TemplateSpan(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [TemplateBodyMapping(_0), input2]);
var TemplateLiteralTypes = (input) => If(If(Const("`", input), ([_0, input2]) => If(TemplateBody(input2), ([_1, input3]) => If(Const("`", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [TemplateLiteralTypesMapping(_0), input2]);
var TemplateLiteral = (input) => If(TemplateLiteralTypes(input), ([_0, input2]) => [TemplateLiteralMapping(_0), input2]);
var Dependent2 = (input) => If(If(If(Const("if", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("then", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => If(Const("else", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => [[_0, _1, _2, _3, _4, _5], input7])))))), ([_0, input2]) => [_0, input2], () => If(If(Const("if", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("then", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [DependentMapping(_0), input2]);
var LiteralBigInt = (input) => If(BigInt3(input), ([_0, input2]) => [LiteralBigIntMapping(_0), input2]);
var LiteralBoolean = (input) => If(If(Const("true", input), ([_0, input2]) => [_0, input2], () => If(Const("false", input), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [LiteralBooleanMapping(_0), input2]);
var LiteralNumber = (input) => If(Number3(input), ([_0, input2]) => [LiteralNumberMapping(_0), input2]);
var LiteralString = (input) => If(String3(["'", '"'], input), ([_0, input2]) => [LiteralStringMapping(_0), input2]);
var KeyOf = (input) => If(If(If(Const("keyof", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [KeyOfMapping(_0), input2]);
var IndexArray_0 = (input, result = []) => If(If(If(Const("[", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("]", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(If(Const("[", input), ([_0, input2]) => If(Const("]", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => IndexArray_0(input2, [...result, _0]), () => [result, input]);
var IndexArray = (input) => If(IndexArray_0(input), ([_0, input2]) => [IndexArrayMapping(_0), input2]);
var Extends2 = (input) => If(If(If(Const("extends", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("?", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => If(Const(":", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => [[_0, _1, _2, _3, _4, _5], input7])))))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExtendsMapping(_0), input2]);
var Base = (input) => If(If(If(Const("(", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const(")", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(KeywordString(input), ([_0, input2]) => [_0, input2], () => If(KeywordNumber(input), ([_0, input2]) => [_0, input2], () => If(KeywordBoolean(input), ([_0, input2]) => [_0, input2], () => If(KeywordUndefined(input), ([_0, input2]) => [_0, input2], () => If(KeywordNull(input), ([_0, input2]) => [_0, input2], () => If(KeywordInteger(input), ([_0, input2]) => [_0, input2], () => If(KeywordBigInt(input), ([_0, input2]) => [_0, input2], () => If(KeywordUnknown(input), ([_0, input2]) => [_0, input2], () => If(KeywordAny(input), ([_0, input2]) => [_0, input2], () => If(KeywordObject(input), ([_0, input2]) => [_0, input2], () => If(KeywordNever(input), ([_0, input2]) => [_0, input2], () => If(KeywordSymbol(input), ([_0, input2]) => [_0, input2], () => If(KeywordVoid(input), ([_0, input2]) => [_0, input2], () => If(KeywordThis(input), ([_0, input2]) => [_0, input2], () => If(LiteralBigInt(input), ([_0, input2]) => [_0, input2], () => If(LiteralBoolean(input), ([_0, input2]) => [_0, input2], () => If(LiteralNumber(input), ([_0, input2]) => [_0, input2], () => If(LiteralString(input), ([_0, input2]) => [_0, input2], () => If(TemplateLiteral(input), ([_0, input2]) => [_0, input2], () => If(Dependent2(input), ([_0, input2]) => [_0, input2], () => If(_Object_2(input), ([_0, input2]) => [_0, input2], () => If(_Tuple_(input), ([_0, input2]) => [_0, input2], () => If(_Constructor_(input), ([_0, input2]) => [_0, input2], () => If(_Function_2(input), ([_0, input2]) => [_0, input2], () => If(_Mapped_(input), ([_0, input2]) => [_0, input2], () => If(GenericCall(input), ([_0, input2]) => [_0, input2], () => If(Reference(input), ([_0, input2]) => [_0, input2], () => [])))))))))))))))))))))))))))), ([_0, input2]) => [BaseMapping(_0), input2]);
var With = (input) => If(If(If(Const("with", input), ([_0, input2]) => If(WithObject(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [WithMapping(_0), input2]);
var Factor = (input) => If(If(KeyOf(input), ([_0, input2]) => If(Base(input2), ([_1, input3]) => If(IndexArray(input3), ([_2, input4]) => If(Extends2(input4), ([_3, input5]) => If(With(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [FactorMapping(_0), input2]);
var ExprTermTail = (input) => If(If(If(Const("&", input), ([_0, input2]) => If(Factor(input2), ([_1, input3]) => If(ExprTermTail(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExprTermTailMapping(_0), input2]);
var ExprTerm = (input) => If(If(Factor(input), ([_0, input2]) => If(ExprTermTail(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprTermMapping(_0), input2]);
var ExprTail = (input) => If(If(If(Const("|", input), ([_0, input2]) => If(ExprTerm(input2), ([_1, input3]) => If(ExprTail(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExprTailMapping(_0), input2]);
var Expr = (input) => If(If(ExprTerm(input), ([_0, input2]) => If(ExprTail(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprMapping(_0), input2]);
var ExprReadonly = (input) => If(If(Const("readonly", input), ([_0, input2]) => If(Expr(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprReadonlyMapping(_0), input2]);
var ExprPipe = (input) => If(If(Const("|", input), ([_0, input2]) => If(Expr(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprPipeMapping(_0), input2]);
var GenericType = (input) => If(If(GenericParameters(input), ([_0, input2]) => If(Const("=", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericTypeMapping(_0), input2]);
var InferType = (input) => If(If(If(Const("infer", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(Const("extends", input3), ([_2, input4]) => If(Expr(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => If(If(Const("infer", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [InferTypeMapping(_0), input2]);
var Type = (input) => If(If(InferType(input), ([_0, input2]) => [_0, input2], () => If(ExprPipe(input), ([_0, input2]) => [_0, input2], () => If(ExprReadonly(input), ([_0, input2]) => [_0, input2], () => If(Expr(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [TypeMapping(_0), input2]);
var PropertyKeyNumber = (input) => If(Number3(input), ([_0, input2]) => [PropertyKeyNumberMapping(_0), input2]);
var PropertyKeyIdent = (input) => If(Ident(input), ([_0, input2]) => [PropertyKeyIdentMapping(_0), input2]);
var PropertyKeyQuoted = (input) => If(String3(["'", '"'], input), ([_0, input2]) => [PropertyKeyQuotedMapping(_0), input2]);
var PropertyKeyIndex = (input) => If(If(Const("[", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(If(KeywordInteger(input4), ([_02, input5]) => [_02, input5], () => If(KeywordNumber(input4), ([_02, input5]) => [_02, input5], () => If(KeywordString(input4), ([_02, input5]) => [_02, input5], () => If(KeywordSymbol(input4), ([_02, input5]) => [_02, input5], () => [])))), ([_3, input5]) => If(Const("]", input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [PropertyKeyIndexMapping(_0), input2]);
var PropertyKey = (input) => If(If(PropertyKeyNumber(input), ([_0, input2]) => [_0, input2], () => If(PropertyKeyIdent(input), ([_0, input2]) => [_0, input2], () => If(PropertyKeyQuoted(input), ([_0, input2]) => [_0, input2], () => If(PropertyKeyIndex(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [PropertyKeyMapping(_0), input2]);
var Readonly2 = (input) => If(If(If(Const("readonly", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ReadonlyMapping(_0), input2]);
var Optional3 = (input) => If(If(If(Const("?", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [OptionalMapping(_0), input2]);
var Property = (input) => If(If(Readonly2(input), ([_0, input2]) => If(PropertyKey(input2), ([_1, input3]) => If(Optional3(input3), ([_2, input4]) => If(Const(":", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [PropertyMapping(_0), input2]);
var PropertyDelimiter = (input) => If(If(If(Const(",", input), ([_0, input2]) => If(Const("\n", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const(";", input), ([_0, input2]) => If(Const("\n", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const(",", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(Const(";", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(Const("\n", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => []))))), ([_0, input2]) => [PropertyDelimiterMapping(_0), input2]);
var PropertyList_0 = (input, result = []) => If(If(Property(input), ([_0, input2]) => If(PropertyDelimiter(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => PropertyList_0(input2, [...result, _0]), () => [result, input]);
var PropertyList = (input) => If(If(PropertyList_0(input), ([_0, input2]) => If(If(If(Property(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [PropertyListMapping(_0), input2]);
var Properties = (input) => If(If(Const("{", input), ([_0, input2]) => If(PropertyList(input2), ([_1, input3]) => If(Const("}", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [PropertiesMapping(_0), input2]);
var _Object_2 = (input) => If(Properties(input), ([_0, input2]) => [_Object_Mapping(_0), input2]);
var ElementNamed = (input) => If(If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Const("readonly", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [_0, input2], () => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Const("readonly", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [ElementNamedMapping(_0), input2]);
var ElementReadonlyOptional = (input) => If(If(Const("readonly", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("?", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [ElementReadonlyOptionalMapping(_0), input2]);
var ElementReadonly = (input) => If(If(Const("readonly", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ElementReadonlyMapping(_0), input2]);
var ElementOptional = (input) => If(If(Type(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ElementOptionalMapping(_0), input2]);
var ElementBase = (input) => If(If(ElementNamed(input), ([_0, input2]) => [_0, input2], () => If(ElementReadonlyOptional(input), ([_0, input2]) => [_0, input2], () => If(ElementReadonly(input), ([_0, input2]) => [_0, input2], () => If(ElementOptional(input), ([_0, input2]) => [_0, input2], () => If(Type(input), ([_0, input2]) => [_0, input2], () => []))))), ([_0, input2]) => [ElementBaseMapping(_0), input2]);
var Element = (input) => If(If(If(Const("...", input), ([_0, input2]) => If(ElementBase(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(ElementBase(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ElementMapping(_0), input2]);
var ElementList_0 = (input, result = []) => If(If(Element(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => ElementList_0(input2, [...result, _0]), () => [result, input]);
var ElementList = (input) => If(If(ElementList_0(input), ([_0, input2]) => If(If(If(Element(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ElementListMapping(_0), input2]);
var _Tuple_ = (input) => If(If(Const("[", input), ([_0, input2]) => If(ElementList(input2), ([_1, input3]) => If(Const("]", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_Tuple_Mapping(_0), input2]);
var ParameterReadonlyOptional = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Const("readonly", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [ParameterReadonlyOptionalMapping(_0), input2]);
var ParameterReadonly = (input) => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Const("readonly", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [ParameterReadonlyMapping(_0), input2]);
var ParameterOptional = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [ParameterOptionalMapping(_0), input2]);
var ParameterType = (input) => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [ParameterTypeMapping(_0), input2]);
var ParameterBase = (input) => If(If(ParameterReadonlyOptional(input), ([_0, input2]) => [_0, input2], () => If(ParameterReadonly(input), ([_0, input2]) => [_0, input2], () => If(ParameterOptional(input), ([_0, input2]) => [_0, input2], () => If(ParameterType(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [ParameterBaseMapping(_0), input2]);
var Parameter2 = (input) => If(If(If(Const("...", input), ([_0, input2]) => If(ParameterBase(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(ParameterBase(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ParameterMapping(_0), input2]);
var ParameterList_0 = (input, result = []) => If(If(Parameter2(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => ParameterList_0(input2, [...result, _0]), () => [result, input]);
var ParameterList = (input) => If(If(ParameterList_0(input), ([_0, input2]) => If(If(If(Parameter2(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ParameterListMapping(_0), input2]);
var _Function_2 = (input) => If(If(Const("(", input), ([_0, input2]) => If(ParameterList(input2), ([_1, input3]) => If(Const(")", input3), ([_2, input4]) => If(Const("=>", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [_Function_Mapping(_0), input2]);
var _Constructor_ = (input) => If(If(Const("new", input), ([_0, input2]) => If(Const("(", input2), ([_1, input3]) => If(ParameterList(input3), ([_2, input4]) => If(Const(")", input4), ([_3, input5]) => If(Const("=>", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => [[_0, _1, _2, _3, _4, _5], input7])))))), ([_0, input2]) => [_Constructor_Mapping(_0), input2]);
var MappedReadonly = (input) => If(If(If(Const("+", input), ([_0, input2]) => If(Const("readonly", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("-", input), ([_0, input2]) => If(Const("readonly", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("readonly", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [MappedReadonlyMapping(_0), input2]);
var MappedOptional = (input) => If(If(If(Const("+", input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("-", input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("?", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [MappedOptionalMapping(_0), input2]);
var MappedAs = (input) => If(If(If(Const("as", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [MappedAsMapping(_0), input2]);
var _Mapped_ = (input) => If(If(Const("{", input), ([_0, input2]) => If(MappedReadonly(input2), ([_1, input3]) => If(Const("[", input3), ([_2, input4]) => If(Ident(input4), ([_3, input5]) => If(Const("in", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => If(MappedAs(input7), ([_6, input8]) => If(Const("]", input8), ([_7, input9]) => If(MappedOptional(input9), ([_8, input10]) => If(Const(":", input10), ([_9, input11]) => If(Type(input11), ([_10, input12]) => If(OptionalSemiColon(input12), ([_11, input13]) => If(Const("}", input13), ([_12, input14]) => [[_0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12], input14]))))))))))))), ([_0, input2]) => [_Mapped_Mapping(_0), input2]);
var Reference = (input) => If(Ident(input), ([_0, input2]) => [ReferenceMapping(_0), input2]);
var WithBigInt = (input) => If(BigInt3(input), ([_0, input2]) => [WithBigIntMapping(_0), input2]);
var WithNumber = (input) => If(Number3(input), ([_0, input2]) => [WithNumberMapping(_0), input2]);
var WithBoolean = (input) => If(If(Const("true", input), ([_0, input2]) => [_0, input2], () => If(Const("false", input), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [WithBooleanMapping(_0), input2]);
var WithString = (input) => If(String3(['"', "'"], input), ([_0, input2]) => [WithStringMapping(_0), input2]);
var WithNull = (input) => If(Const("null", input), ([_0, input2]) => [WithNullMapping(_0), input2]);
var WithUndefined = (input) => If(Const("undefined", input), ([_0, input2]) => [WithUndefinedMapping(_0), input2]);
var WithProperty = (input) => If(If(PropertyKey(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(WithValue(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [WithPropertyMapping(_0), input2]);
var WithPropertyList_0 = (input, result = []) => If(If(WithProperty(input), ([_0, input2]) => If(PropertyDelimiter(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => WithPropertyList_0(input2, [...result, _0]), () => [result, input]);
var WithPropertyList = (input) => If(If(WithPropertyList_0(input), ([_0, input2]) => If(If(If(WithProperty(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [WithPropertyListMapping(_0), input2]);
var WithObject = (input) => If(If(Const("{", input), ([_0, input2]) => If(WithPropertyList(input2), ([_1, input3]) => If(Const("}", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [WithObjectMapping(_0), input2]);
var WithElementList_0 = (input, result = []) => If(If(WithValue(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => WithElementList_0(input2, [...result, _0]), () => [result, input]);
var WithElementList = (input) => If(If(WithElementList_0(input), ([_0, input2]) => If(If(If(WithValue(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [WithElementListMapping(_0), input2]);
var WithArray = (input) => If(If(Const("[", input), ([_0, input2]) => If(WithElementList(input2), ([_1, input3]) => If(Const("]", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [WithArrayMapping(_0), input2]);
var WithValue = (input) => If(If(WithBigInt(input), ([_0, input2]) => [_0, input2], () => If(WithNumber(input), ([_0, input2]) => [_0, input2], () => If(WithBoolean(input), ([_0, input2]) => [_0, input2], () => If(WithString(input), ([_0, input2]) => [_0, input2], () => If(WithNull(input), ([_0, input2]) => [_0, input2], () => If(WithUndefined(input), ([_0, input2]) => [_0, input2], () => If(WithObject(input), ([_0, input2]) => [_0, input2], () => If(WithArray(input), ([_0, input2]) => [_0, input2], () => [])))))))), ([_0, input2]) => [WithValueMapping(_0), input2]);
var PatternBigInt = (input) => If(Const("-?(?:0|[1-9][0-9]*)n", input), ([_0, input2]) => [PatternBigIntMapping(_0), input2]);
var PatternString = (input) => If(Const(".*", input), ([_0, input2]) => [PatternStringMapping(_0), input2]);
var PatternNumber = (input) => If(Const("-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?", input), ([_0, input2]) => [PatternNumberMapping(_0), input2]);
var PatternInteger = (input) => If(Const("-?(?:0|[1-9][0-9]*)", input), ([_0, input2]) => [PatternIntegerMapping(_0), input2]);
var PatternNever = (input) => If(Const("(?!)", input), ([_0, input2]) => [PatternNeverMapping(_0), input2]);
var PatternText = (input) => If(Until_1(["-?(?:0|[1-9][0-9]*)n", ".*", "-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?", "-?(?:0|[1-9][0-9]*)", "(?!)", "(", ")", "$", "|"], input), ([_0, input2]) => [PatternTextMapping(_0), input2]);
var PatternBase = (input) => If(If(PatternBigInt(input), ([_0, input2]) => [_0, input2], () => If(PatternString(input), ([_0, input2]) => [_0, input2], () => If(PatternNumber(input), ([_0, input2]) => [_0, input2], () => If(PatternInteger(input), ([_0, input2]) => [_0, input2], () => If(PatternNever(input), ([_0, input2]) => [_0, input2], () => If(PatternGroup(input), ([_0, input2]) => [_0, input2], () => If(PatternText(input), ([_0, input2]) => [_0, input2], () => []))))))), ([_0, input2]) => [PatternBaseMapping(_0), input2]);
var PatternGroup = (input) => If(If(Const("(", input), ([_0, input2]) => If(PatternBody(input2), ([_1, input3]) => If(Const(")", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [PatternGroupMapping(_0), input2]);
var PatternUnion = (input) => If(If(If(PatternTerm(input), ([_0, input2]) => If(Const("|", input2), ([_1, input3]) => If(PatternUnion(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(If(PatternTerm(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [PatternUnionMapping(_0), input2]);
var PatternTerm = (input) => If(If(PatternBase(input), ([_0, input2]) => If(PatternBody(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [PatternTermMapping(_0), input2]);
var PatternBody = (input) => If(If(PatternUnion(input), ([_0, input2]) => [_0, input2], () => If(PatternTerm(input), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [PatternBodyMapping(_0), input2]);
var Pattern = (input) => If(If(Const("^", input), ([_0, input2]) => If(PatternBody(input2), ([_1, input3]) => If(Const("$", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [PatternMapping(_0), input2]);
var InterfaceDeclarationHeritageList_0 = (input, result = []) => If(If(Type(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => InterfaceDeclarationHeritageList_0(input2, [...result, _0]), () => [result, input]);
var InterfaceDeclarationHeritageList = (input) => If(If(InterfaceDeclarationHeritageList_0(input), ([_0, input2]) => If(If(If(Type(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [InterfaceDeclarationHeritageListMapping(_0), input2]);
var InterfaceDeclarationHeritage = (input) => If(If(If(Const("extends", input), ([_0, input2]) => If(InterfaceDeclarationHeritageList(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [InterfaceDeclarationHeritageMapping(_0), input2]);
var InterfaceDeclarationGeneric = (input) => If(If(Const("interface", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(GenericParameters(input3), ([_2, input4]) => If(InterfaceDeclarationHeritage(input4), ([_3, input5]) => If(Properties(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [InterfaceDeclarationGenericMapping(_0), input2]);
var InterfaceDeclaration = (input) => If(If(Const("interface", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(InterfaceDeclarationHeritage(input3), ([_2, input4]) => If(Properties(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [InterfaceDeclarationMapping(_0), input2]);
var TypeAliasDeclarationGeneric = (input) => If(If(Const("type", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(GenericParameters(input3), ([_2, input4]) => If(Const("=", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [TypeAliasDeclarationGenericMapping(_0), input2]);
var TypeAliasDeclaration = (input) => If(If(Const("type", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(Const("=", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [TypeAliasDeclarationMapping(_0), input2]);
var ExportKeyword = (input) => If(If(If(Const("export", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExportKeywordMapping(_0), input2]);
var ModuleDeclarationDelimiter = (input) => If(If(If(Const(";", input), ([_0, input2]) => If(Const("\n", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const(";", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(Const("\n", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [ModuleDeclarationDelimiterMapping(_0), input2]);
var ModuleDeclarationList_0 = (input, result = []) => If(If(ModuleDeclaration(input), ([_0, input2]) => If(ModuleDeclarationDelimiter(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => ModuleDeclarationList_0(input2, [...result, _0]), () => [result, input]);
var ModuleDeclarationList = (input) => If(If(ModuleDeclarationList_0(input), ([_0, input2]) => If(If(If(ModuleDeclaration(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ModuleDeclarationListMapping(_0), input2]);
var ModuleDeclaration = (input) => If(If(ExportKeyword(input), ([_0, input2]) => If(If(InterfaceDeclarationGeneric(input2), ([_02, input3]) => [_02, input3], () => If(InterfaceDeclaration(input2), ([_02, input3]) => [_02, input3], () => If(TypeAliasDeclarationGeneric(input2), ([_02, input3]) => [_02, input3], () => If(TypeAliasDeclaration(input2), ([_02, input3]) => [_02, input3], () => [])))), ([_1, input3]) => If(OptionalSemiColon(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [ModuleDeclarationMapping(_0), input2]);
var Module = (input) => If(If(ModuleDeclaration(input), ([_0, input2]) => If(ModuleDeclarationList(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ModuleMapping(_0), input2]);
var Script = (input) => If(If(Module(input), ([_0, input2]) => [_0, input2], () => If(GenericType(input), ([_0, input2]) => [_0, input2], () => If(Type(input), ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [ScriptMapping(_0), input2]);

// node_modules/typebox/build/type/engine/patterns/template.mjs
function ParseTemplateIntoTypes(template) {
  const parsed = TemplateLiteralTypes(`\`${template}\``);
  const result = guard_exports.IsEqual(parsed.length, 2) ? parsed[0] : Unreachable();
  return result;
}

// node_modules/typebox/build/type/engine/template_literal/encode.mjs
function JoinString(input) {
  return input.join("|");
}
function UnwrapTemplateLiteralPattern(pattern) {
  return pattern.slice(1, pattern.length - 1);
}
function EncodeLiteral(value, right, pattern) {
  return EncodeTypes(right, `${pattern}${value}`);
}
function EncodeBigInt(right, pattern) {
  return EncodeTypes(right, `${pattern}${BigIntPattern}`);
}
function EncodeInteger(right, pattern) {
  return EncodeTypes(right, `${pattern}${IntegerPattern}`);
}
function EncodeNumber(right, pattern) {
  return EncodeTypes(right, `${pattern}${NumberPattern}`);
}
function EncodeBoolean(right, pattern) {
  return EncodeType(Union([Literal("false"), Literal("true")]), right, pattern);
}
function EncodeString(right, pattern) {
  return EncodeTypes(right, `${pattern}${StringPattern}`);
}
function EncodeTemplateLiteral(templatePattern, right, pattern) {
  return EncodeTypes(right, `${pattern}${UnwrapTemplateLiteralPattern(templatePattern)}`);
}
function EncodeTemplateLiteralDeferred(types, right, pattern) {
  const templateLiteral = TemplateLiteralAction(types, {});
  const result = EncodeType(templateLiteral, right, pattern);
  return result;
}
function EncodeEnum(values, right, pattern) {
  const evaluated = EvaluateEnum(values);
  return EncodeType(evaluated, right, pattern);
}
function EncodeUnion(types, right, pattern, result = []) {
  return guard_exports.ShiftLeft(types, (head, tail) => EncodeUnion(tail, right, pattern, [...result, EncodeType(head, [], "")]), () => EncodeTypes(right, `${pattern}(${JoinString(result)})`));
}
function EncodeType(type, right, pattern) {
  return IsEnum(type) ? EncodeEnum(type.enum, right, pattern) : IsInteger2(type) ? EncodeInteger(right, pattern) : IsLiteral(type) ? EncodeLiteral(type.const, right, pattern) : IsBigInt2(type) ? EncodeBigInt(right, pattern) : IsBoolean3(type) ? EncodeBoolean(right, pattern) : IsNumber3(type) ? EncodeNumber(right, pattern) : IsString3(type) ? EncodeString(right, pattern) : IsTemplateLiteral(type) ? EncodeTemplateLiteral(type.pattern, right, pattern) : IsTemplateLiteralDeferred(type) ? EncodeTemplateLiteralDeferred(type.parameters[0], right, pattern) : IsUnion(type) ? EncodeUnion(type.anyOf, right, pattern) : NeverPattern;
}
function EncodeTypes(types, pattern) {
  return guard_exports.ShiftLeft(types, (left, right) => EncodeType(left, right, pattern), () => pattern);
}
function EncodePattern(types) {
  const encoded = EncodeTypes(types, "");
  const result = `^${encoded}$`;
  return result;
}
function TemplateLiteralEncode(types) {
  const pattern = EncodePattern(types);
  const result = TemplateLiteralCreate(pattern);
  return result;
}

// node_modules/typebox/build/type/engine/template_literal/instantiate.mjs
function TemplateLiteralAction(types, options) {
  const result = CanInstantiate(types) ? memory_exports.Update(TemplateLiteralEncode(types), {}, options) : TemplateLiteralDeferred(types, options);
  return result;
}
function TemplateLiteralInstantiate(context, state3, types, options) {
  const instantiatedTypes = InstantiateTypes(context, state3, types);
  return TemplateLiteralAction(instantiatedTypes, options);
}

// node_modules/typebox/build/type/types/template_literal.mjs
function TemplateLiteralDeferred(types, options = {}) {
  return Deferred("TemplateLiteral", [types], options);
}
function IsTemplateLiteralDeferred(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "action") && guard_exports.IsEqual(value.action, "TemplateLiteral");
}
function TemplateLiteralFromTypes(types) {
  return TemplateLiteralAction(types, {});
}
function TemplateLiteralFromString(template) {
  const types = ParseTemplateIntoTypes(template);
  return TemplateLiteralFromTypes(types);
}
function TemplateLiteral2(input, options = {}) {
  const type = guard_exports.IsString(input) ? TemplateLiteralFromString(input) : TemplateLiteralFromTypes(input);
  return memory_exports.Update(type, {}, options);
}
function IsTemplateLiteral(value) {
  return IsKind(value, "TemplateLiteral");
}

// node_modules/typebox/build/type/extends/result.mjs
var result_exports = {};
__export(result_exports, {
  ExtendsFalse: () => ExtendsFalse,
  ExtendsTrue: () => ExtendsTrue,
  ExtendsUnion: () => ExtendsUnion,
  IsExtendsFalse: () => IsExtendsFalse,
  IsExtendsTrue: () => IsExtendsTrue,
  IsExtendsTrueLike: () => IsExtendsTrueLike,
  IsExtendsUnion: () => IsExtendsUnion,
  Match: () => Match3
});
function ExtendsUnion(inferred) {
  return memory_exports.Create({ ["~kind"]: "ExtendsUnion" }, { inferred });
}
function IsExtendsUnion(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.HasPropertyKey(value, "inferred") && guard_exports.IsEqual(value["~kind"], "ExtendsUnion") && guard_exports.IsObject(value.inferred);
}
function ExtendsTrue(inferred) {
  return memory_exports.Create({ ["~kind"]: "ExtendsTrue" }, { inferred });
}
function IsExtendsTrue(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.HasPropertyKey(value, "inferred") && guard_exports.IsEqual(value["~kind"], "ExtendsTrue") && guard_exports.IsObject(value.inferred);
}
function ExtendsFalse() {
  return memory_exports.Create({ ["~kind"]: "ExtendsFalse" }, {});
}
function IsExtendsFalse(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.IsEqual(value["~kind"], "ExtendsFalse");
}
function IsExtendsTrueLike(value) {
  return IsExtendsUnion(value) || IsExtendsTrue(value);
}
function Match3(result, true_, false_) {
  return IsExtendsTrueLike(result) ? true_(result.inferred) : false_();
}

// node_modules/typebox/build/type/extends/extends_right.mjs
function ExtendsRightInfer(inferred, name, left, right) {
  return Match3(ExtendsLeft(inferred, left, right), (checkInferred) => ExtendsTrue(memory_exports.Assign(memory_exports.Assign(inferred, checkInferred), { [name]: left })), () => ExtendsFalse());
}
function ExtendsRightAny(inferred, _left) {
  return ExtendsTrue(inferred);
}
function ExtendsRightDependent(inferred, left, if_, then_, else_) {
  return Match3(ExtendsLeft(inferred, left, if_), (inferred2) => Match3(ExtendsLeft(inferred2, left, then_), (inferred3) => ExtendsTrue(inferred3), () => ExtendsFalse()), () => Match3(ExtendsLeft(inferred, left, else_), (inferred2) => ExtendsTrue(inferred2), () => ExtendsFalse()));
}
function ExtendsRightEnum(inferred, left, right) {
  const evaluated = EvaluateEnum(right);
  return ExtendsLeft(inferred, left, evaluated);
}
function ExtendsRightIntersect(inferred, left, right) {
  return guard_exports.ShiftLeft(right, (head, tail) => Match3(ExtendsLeft(inferred, left, head), (inferred2) => ExtendsRightIntersect(inferred2, left, tail), () => ExtendsFalse()), () => ExtendsTrue(inferred));
}
function ExtendsRightTemplateLiteral(inferred, left, right) {
  const evaluated = EvaluateTemplateLiteral(right);
  return ExtendsLeft(inferred, left, evaluated);
}
function ExtendsRightUnion(inferred, left, right) {
  return guard_exports.ShiftLeft(right, (head, tail) => Match3(ExtendsLeft(inferred, left, head), (inferred2) => ExtendsTrue(inferred2), () => ExtendsRightUnion(inferred, left, tail)), () => ExtendsFalse());
}
function ExtendsRight(inferred, left, right) {
  return IsAny(right) ? ExtendsRightAny(inferred, left) : IsDependent(right) ? ExtendsRightDependent(inferred, left, right.if, right.then, right.else) : IsEnum(right) ? ExtendsRightEnum(inferred, left, right.enum) : IsInfer(right) ? ExtendsRightInfer(inferred, right.name, left, right.extends) : IsIntersect(right) ? ExtendsRightIntersect(inferred, left, right.allOf) : IsTemplateLiteral(right) ? ExtendsRightTemplateLiteral(inferred, left, right.pattern) : IsUnion(right) ? ExtendsRightUnion(inferred, left, right.anyOf) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsFalse();
}

// node_modules/typebox/build/type/extends/any.mjs
function ExtendsAny(inferred, left, right) {
  return IsInfer(right) ? ExtendsRight(inferred, left, right) : IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsUnion(inferred);
}

// node_modules/typebox/build/type/extends/array.mjs
function ExtendsImmutable(left, right) {
  const isImmutableLeft = IsImmutable(left);
  const isImmutableRight = IsImmutable(right);
  return isImmutableLeft && isImmutableRight ? true : !isImmutableLeft && isImmutableRight ? true : isImmutableLeft && !isImmutableRight ? false : true;
}
function ExtendsArray(inferred, arrayLeft, left, right) {
  return IsArray2(right) ? ExtendsImmutable(arrayLeft, right) ? ExtendsLeft(inferred, left, right.items) : ExtendsFalse() : ExtendsRight(inferred, arrayLeft, right);
}

// node_modules/typebox/build/type/extends/bigint.mjs
function ExtendsBigInt(inferred, left, right) {
  return IsBigInt2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/boolean.mjs
function ExtendsBoolean(inferred, left, right) {
  return IsBoolean3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/parameters.mjs
function ParameterCompare(inferred, left, leftRest, right, rightRest) {
  const checkLeft = IsInfer(right) ? left : right;
  const checkRight = IsInfer(right) ? right : left;
  const isLeftOptional = IsOptional(left);
  const isRightOptional = IsOptional(right);
  return !isLeftOptional && isRightOptional ? ExtendsFalse() : Match3(ExtendsLeft(inferred, checkLeft, checkRight), (inferred2) => ExtendsParameters(inferred2, leftRest, rightRest), () => ExtendsFalse());
}
function ParameterRight(inferred, left, leftRest, rightRest) {
  return guard_exports.ShiftLeft(rightRest, (head, tail) => ParameterCompare(inferred, left, leftRest, head, tail), () => IsOptional(left) ? ExtendsTrue(inferred) : ExtendsFalse());
}
function ParametersLeft(inferred, left, rightRest) {
  return guard_exports.ShiftLeft(left, (head, tail) => ParameterRight(inferred, head, tail, rightRest), () => ExtendsTrue(inferred));
}
function ExtendsParameters(inferred, left, right) {
  return ParametersLeft(inferred, left, right);
}

// node_modules/typebox/build/type/extends/return_type.mjs
function ExtendsReturnType(inferred, left, right) {
  return IsVoid(right) ? ExtendsTrue(inferred) : ExtendsLeft(inferred, left, right);
}

// node_modules/typebox/build/type/extends/constructor.mjs
function ExtendsConstructor(inferred, parameters, returnType, right) {
  return IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : IsConstructor2(right) ? Match3(ExtendsParameters(inferred, parameters, right["parameters"]), (inferred2) => ExtendsReturnType(inferred2, returnType, right["instanceType"]), () => ExtendsFalse()) : ExtendsFalse();
}

// node_modules/typebox/build/type/extends/dependent.mjs
function ExtendsDependent(inferred, if_, then_, else_, right) {
  return Match3(ExtendsLeft(inferred, if_, right), () => ExtendsLeft(inferred, then_, right), () => ExtendsLeft(inferred, else_, right));
}

// node_modules/typebox/build/type/extends/enum.mjs
function ExtendsEnum(inferred, left, right) {
  const evaluated = EvaluateEnum(left);
  return ExtendsLeft(inferred, evaluated, right);
}

// node_modules/typebox/build/type/extends/function.mjs
function ExtendsFunction(inferred, parameters, returnType, right) {
  return IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : IsFunction2(right) ? Match3(ExtendsParameters(inferred, parameters, right["parameters"]), (inferred2) => ExtendsReturnType(inferred2, returnType, right["returnType"]), () => ExtendsFalse()) : ExtendsFalse();
}

// node_modules/typebox/build/type/extends/integer.mjs
function ExtendsInteger(inferred, left, right) {
  return IsInteger2(right) ? ExtendsTrue(inferred) : IsNumber3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/intersect.mjs
function ExtendsIntersect(inferred, left, right) {
  const evaluated = EvaluateIntersect(left);
  return ExtendsLeft(inferred, evaluated, right);
}

// node_modules/typebox/build/type/extends/literal.mjs
function ExtendsLiteralValue(inferred, left, right) {
  return left === right ? ExtendsTrue(inferred) : ExtendsFalse();
}
function ExtendsLiteralBigInt(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsBigInt2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteralBoolean(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsBoolean3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteralNumber(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsNumber3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteralString(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsString3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteral(inferred, left, right) {
  return guard_exports.IsBigInt(left.const) ? ExtendsLiteralBigInt(inferred, left.const, right) : guard_exports.IsBoolean(left.const) ? ExtendsLiteralBoolean(inferred, left.const, right) : guard_exports.IsNumber(left.const) ? ExtendsLiteralNumber(inferred, left.const, right) : guard_exports.IsString(left.const) ? ExtendsLiteralString(inferred, left.const, right) : Unreachable();
}

// node_modules/typebox/build/type/extends/never.mjs
function ExtendsNever(inferred, left, right) {
  return IsInfer(right) ? ExtendsRight(inferred, left, right) : ExtendsTrue(inferred);
}

// node_modules/typebox/build/type/extends/null.mjs
function ExtendsNull(inferred, left, right) {
  return IsNull2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/number.mjs
function ExtendsNumber(inferred, left, right) {
  return IsNumber3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/object.mjs
function ExtendsPropertyOptional(inferred, left, right) {
  return IsOptional(left) ? IsOptional(right) ? ExtendsTrue(inferred) : ExtendsFalse() : ExtendsTrue(inferred);
}
function ExtendsProperty(inferred, left, right) {
  return (
    // Right TInfer<TNever> is TExtendsFalse
    IsInfer(right) && IsNever(right.extends) ? ExtendsFalse() : Match3(ExtendsLeft(inferred, left, right), (inferred2) => ExtendsPropertyOptional(inferred2, left, right), () => ExtendsFalse())
  );
}
function ExtractInferredProperties(keys, properties) {
  return keys.reduce((result, key) => {
    return key in properties ? IsExtendsTrueLike(properties[key]) ? { ...result, ...properties[key].inferred } : Unreachable() : Unreachable();
  }, {});
}
function ExtendsPropertiesComparer(inferred, left, right) {
  const properties = {};
  for (const rightKey of guard_exports.Keys(right)) {
    properties[rightKey] = rightKey in left ? ExtendsProperty({}, left[rightKey], right[rightKey]) : IsOptional(right[rightKey]) ? IsInfer(right[rightKey]) ? ExtendsTrue(memory_exports.Assign(inferred, { [right[rightKey].name]: right[rightKey].extends })) : ExtendsTrue(inferred) : ExtendsFalse();
  }
  const checked = guard_exports.Values(properties).every((result) => IsExtendsTrueLike(result));
  const extracted = checked ? ExtractInferredProperties(guard_exports.Keys(properties), properties) : {};
  return checked ? ExtendsTrue(extracted) : ExtendsFalse();
}
function ExtendsProperties(inferred, left, right) {
  const compared = ExtendsPropertiesComparer(inferred, left, right);
  return IsExtendsTrueLike(compared) ? ExtendsTrue(memory_exports.Assign(inferred, compared.inferred)) : ExtendsFalse();
}
function ExtendsObjectToObject(inferred, left, right) {
  return ExtendsProperties(inferred, left, right);
}
function RecordMergeInferred(left, right) {
  return guard_exports.Keys(right).reduce((result, key) => {
    return {
      ...result,
      [key]: guard_exports.HasPropertyKey(left, key) ? IsUnion(result[key]) ? Union([...result[key].anyOf, right[key]]) : Union([left[key], right[key]]) : right[key]
    };
  }, left);
}
function ExtendsRecordComparer(properties, keys, type, result) {
  return guard_exports.ShiftLeft(keys, (left, right) => Match3(ExtendsLeft({}, properties[left], type), (inferred) => ExtendsRecordComparer(properties, right, type, RecordMergeInferred(result, inferred)), () => ExtendsFalse()), () => ExtendsTrue(result));
}
function ExtendsObjectToRecord(inferred, properties, _pattern, value) {
  const keys = guard_exports.Keys(properties);
  const result = ExtendsRecordComparer(properties, keys, value, inferred);
  return result;
}
function ExtendsObject(inferred, left, right) {
  return IsRecord(right) ? ExtendsObjectToRecord(inferred, left, RecordPattern(right), RecordValue(right)) : IsObject2(right) ? ExtendsObjectToObject(inferred, left, right.properties) : ExtendsRight(inferred, _Object_(left), right);
}

// node_modules/typebox/build/type/extends/record.mjs
function FromObject3(inferred, properties) {
  return guard_exports.IsEqual(guard_exports.Keys(properties).length, 0) ? ExtendsTrue(inferred) : ExtendsFalse();
}
function FromRecord(inferred, _leftKey, leftValue, _rightKey, rightValue) {
  return ExtendsLeft(inferred, leftValue, rightValue);
}
function ExtendsRecord(inferred, leftPattern, leftValue, right) {
  return IsRecord(right) ? FromRecord(inferred, RecordPatternToType(leftPattern), leftValue, RecordPatternToType(RecordPattern(right)), RecordValue(right)) : IsObject2(right) ? FromObject3(inferred, right.properties) : IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsFalse();
}

// node_modules/typebox/build/type/extends/string.mjs
function ExtendsString(inferred, left, right) {
  return IsString3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/symbol.mjs
function ExtendsSymbol(inferred, left, right) {
  return IsSymbol2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/template_literal.mjs
function ExtendsTemplateLiteral(inferred, left, right) {
  const evaluated = EvaluateTemplateLiteral(left);
  return ExtendsLeft(inferred, evaluated, right);
}

// node_modules/typebox/build/type/extends/inference.mjs
function Inferrable(name, type) {
  return memory_exports.Create({ "~kind": "Inferrable" }, { name, type }, {});
}
function IsInferable(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.HasPropertyKey(value, "name") && guard_exports.HasPropertyKey(value, "type") && guard_exports.IsEqual(value["~kind"], "Inferrable") && guard_exports.IsString(value.name) && guard_exports.IsObject(value.type);
}
function TryRestInferable(type) {
  return IsRest(type) ? IsInfer(type.items) ? IsArray2(type.items.extends) ? Inferrable(type.items.name, type.items.extends.items) : IsUnknown(type.items.extends) ? Inferrable(type.items.name, type.items.extends) : void 0 : Unreachable() : void 0;
}
function TryInferable(type) {
  return IsInfer(type) ? Inferrable(type.name, type.extends) : void 0;
}
function TryInferResults(rest, right, result = []) {
  return guard_exports.ShiftLeft(rest, (head, tail) => Match3(ExtendsLeft({}, head, right), () => TryInferResults(tail, right, [...result, head]), () => void 0), () => result);
}
function InferTupleResult(inferred, name, left, right) {
  const results = TryInferResults(left, right);
  return guard_exports.IsArray(results) ? ExtendsTrue(memory_exports.Assign(inferred, { [name]: Tuple(results) })) : ExtendsFalse();
}
function InferUnionResult(inferred, name, left, right) {
  const results = TryInferResults(left, right);
  return guard_exports.IsArray(results) ? ExtendsTrue(memory_exports.Assign(inferred, { [name]: Union(results) })) : ExtendsFalse();
}

// node_modules/typebox/build/type/extends/tuple.mjs
function Reverse(types) {
  return [...types].reverse();
}
function ApplyReverse(types, reversed) {
  return reversed ? Reverse(types) : types;
}
function Reversed(types) {
  const first = types.length > 0 ? types[0] : void 0;
  const inferrable = IsSchema(first) ? TryRestInferable(first) : void 0;
  return IsSchema(inferrable);
}
function ElementsCompare(inferred, reversed, left, leftRest, right, rightRest) {
  return Match3(ExtendsLeft(inferred, left, right), (checkInferred) => Elements(checkInferred, reversed, leftRest, rightRest), () => ExtendsFalse());
}
function ElementsLeft(inferred, reversed, leftRest, right, rightRest) {
  const inferable = TryRestInferable(right);
  return (
    // Rest Inferrable Right Means we delegate to TInferTupleResult to Generate a Result
    IsInferable(inferable) ? InferTupleResult(inferred, inferable["name"], ApplyReverse(leftRest, reversed), inferable["type"]) : guard_exports.ShiftLeft(leftRest, (head, tail) => ElementsCompare(inferred, reversed, head, tail, right, rightRest), () => ExtendsFalse())
  );
}
function ElementsRight(inferred, reversed, leftRest, rightRest) {
  return guard_exports.ShiftLeft(rightRest, (head, tail) => ElementsLeft(inferred, reversed, leftRest, head, tail), () => guard_exports.IsEqual(leftRest.length, 0) ? ExtendsTrue(inferred) : ExtendsFalse());
}
function Elements(inferred, reversed, leftRest, rightRest) {
  return ElementsRight(inferred, reversed, leftRest, rightRest);
}
function ExtendsTupleToTuple(inferred, left, right) {
  const instantiatedRight = InstantiateElements(inferred, State([], []), right);
  const reversed = Reversed(instantiatedRight);
  return Elements(inferred, reversed, ApplyReverse(left, reversed), ApplyReverse(instantiatedRight, reversed));
}
function ExtendsTupleToArray(inferred, left, right) {
  const inferrable = TryInferable(right);
  return IsInferable(inferrable) ? InferUnionResult(inferred, inferrable["name"], left, inferrable["type"]) : guard_exports.ShiftLeft(left, (head, tail) => Match3(ExtendsLeft(inferred, head, right), (inferred2) => ExtendsTupleToArray(inferred2, tail, right), () => ExtendsFalse()), () => ExtendsTrue(inferred));
}
function ExtendsTuple(inferred, left, right) {
  const instantiatedLeft = InstantiateElements(inferred, State([], []), left);
  return IsTuple(right) ? ExtendsTupleToTuple(inferred, instantiatedLeft, right.items) : IsArray2(right) ? ExtendsTupleToArray(inferred, instantiatedLeft, right.items) : ExtendsRight(inferred, Tuple(instantiatedLeft), right);
}

// node_modules/typebox/build/type/extends/undefined.mjs
function ExtendsUndefined(inferred, left, right) {
  return IsVoid(right) ? ExtendsTrue(inferred) : IsUndefined2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/union.mjs
function ExtendsUnionSome(inferred, type, unionTypes) {
  return guard_exports.ShiftLeft(unionTypes, (head, tail) => Match3(ExtendsLeft(inferred, type, head), (inferred2) => ExtendsTrue(inferred2), () => ExtendsUnionSome(inferred, type, tail)), () => ExtendsFalse());
}
function ExtendsUnionLeft(inferred, left, right) {
  return guard_exports.ShiftLeft(left, (head, tail) => Match3(ExtendsUnionSome(inferred, head, right), (inferred2) => ExtendsUnionLeft(inferred2, tail, right), () => ExtendsFalse()), () => ExtendsTrue(inferred));
}
function ExtendsUnion2(inferred, left, right) {
  const inferrable = TryInferable(right);
  return IsInferable(inferrable) ? InferUnionResult(inferred, inferrable.name, left, inferrable.type) : IsUnion(right) ? ExtendsUnionLeft(inferred, left, right.anyOf) : ExtendsUnionLeft(inferred, left, [right]);
}

// node_modules/typebox/build/type/extends/unknown.mjs
function ExtendsUnknown(inferred, left, right) {
  return IsInfer(right) ? ExtendsRight(inferred, left, right) : IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsFalse();
}

// node_modules/typebox/build/type/extends/void.mjs
function ExtendsVoid(inferred, left, right) {
  return IsVoid(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/extends_left.mjs
function ExtendsLeft(inferred, left, right) {
  return IsAny(left) ? ExtendsAny(inferred, left, right) : IsArray2(left) ? ExtendsArray(inferred, left, left.items, right) : IsBigInt2(left) ? ExtendsBigInt(inferred, left, right) : IsBoolean3(left) ? ExtendsBoolean(inferred, left, right) : IsConstructor2(left) ? ExtendsConstructor(inferred, left.parameters, left.instanceType, right) : IsDependent(left) ? ExtendsDependent(inferred, left.if, left.then, left.else, right) : IsEnum(left) ? ExtendsEnum(inferred, left.enum, right) : IsFunction2(left) ? ExtendsFunction(inferred, left.parameters, left.returnType, right) : IsInteger2(left) ? ExtendsInteger(inferred, left, right) : IsIntersect(left) ? ExtendsIntersect(inferred, left.allOf, right) : IsLiteral(left) ? ExtendsLiteral(inferred, left, right) : IsNever(left) ? ExtendsNever(inferred, left, right) : IsNull2(left) ? ExtendsNull(inferred, left, right) : IsNumber3(left) ? ExtendsNumber(inferred, left, right) : IsObject2(left) ? ExtendsObject(inferred, left.properties, right) : IsRecord(left) ? ExtendsRecord(inferred, RecordPattern(left), RecordValue(left), right) : IsString3(left) ? ExtendsString(inferred, left, right) : IsSymbol2(left) ? ExtendsSymbol(inferred, left, right) : IsTemplateLiteral(left) ? ExtendsTemplateLiteral(inferred, left.pattern, right) : IsTuple(left) ? ExtendsTuple(inferred, left.items, right) : IsUndefined2(left) ? ExtendsUndefined(inferred, left, right) : IsUnion(left) ? ExtendsUnion2(inferred, left.anyOf, right) : IsUnknown(left) ? ExtendsUnknown(inferred, left, right) : IsVoid(left) ? ExtendsVoid(inferred, left, right) : ExtendsFalse();
}

// node_modules/typebox/build/type/engine/interface/instantiate.mjs
function InterfaceOperation(heritage, properties) {
  const result = EvaluateIntersect([...heritage, _Object_(properties)]);
  return result;
}
function InterfaceAction(heritage, properties, options) {
  const result = CanInstantiate(heritage) ? memory_exports.Update(InterfaceOperation(heritage, properties), {}, options) : InterfaceDeferred(heritage, properties, options);
  return result;
}
function InterfaceInstantiate(context, state3, heritage, properties, options) {
  const instantiatedHeritage = InstantiateTypes(context, state3, heritage);
  const instantiatedProperties = InstantiateProperties(context, state3, properties);
  return InterfaceAction(instantiatedHeritage, instantiatedProperties, options);
}

// node_modules/typebox/build/type/action/interface.mjs
function InterfaceDeferred(heritage, properties, options = {}) {
  return Deferred("Interface", [heritage, properties], options);
}
function IsInterfaceDeferred(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "action") && guard_exports.IsEqual(value.action, "Interface");
}
function Interface(heritage, properties, options = {}) {
  return InterfaceAction(heritage, properties, options);
}

// node_modules/typebox/build/type/engine/cyclic/check.mjs
function FromRef(stack, context, ref) {
  return stack.includes(ref) ? true : FromType3([...stack, ref], context, context[ref]);
}
function FromProperties(stack, context, properties) {
  const types = PropertyValues(properties);
  return FromTypes2(stack, context, types);
}
function FromTypes2(stack, context, types) {
  return guard_exports.ShiftLeft(types, (left, right) => FromType3(stack, context, left) ? true : FromTypes2(stack, context, right), () => false);
}
function FromType3(stack, context, type) {
  return IsRef(type) ? FromRef(stack, context, type.$ref) : IsArray2(type) ? FromType3(stack, context, type.items) : IsConstructor2(type) ? FromTypes2(stack, context, [...type.parameters, type.instanceType]) : IsFunction2(type) ? FromTypes2(stack, context, [...type.parameters, type.returnType]) : IsInterfaceDeferred(type) ? FromProperties(stack, context, type.parameters[1]) : IsIntersect(type) ? FromTypes2(stack, context, type.allOf) : IsObject2(type) ? FromProperties(stack, context, type.properties) : IsUnion(type) ? FromTypes2(stack, context, type.anyOf) : IsTuple(type) ? FromTypes2(stack, context, type.items) : IsRecord(type) ? FromType3(stack, context, RecordValue(type)) : false;
}
function CyclicCheck(stack, context, type) {
  const result = FromType3(stack, context, type);
  return result;
}

// node_modules/typebox/build/type/engine/cyclic/candidates.mjs
function ResolveCandidateKeys(context, keys) {
  return keys.reduce((result, left) => {
    return CyclicCheck([left], context, context[left]) ? [...result, left] : result;
  }, []);
}
function CyclicCandidates(context) {
  const keys = PropertyKeys(context);
  const result = ResolveCandidateKeys(context, keys);
  return result;
}

// node_modules/typebox/build/type/engine/cyclic/dependencies.mjs
function FromRef2(context, ref, result) {
  return result.includes(ref) ? result : ref in context ? FromType4(context, context[ref], [...result, ref]) : Unreachable();
}
function FromProperties2(context, properties, result) {
  const types = PropertyValues(properties);
  return FromTypes3(context, types, result);
}
function FromTypes3(context, types, result) {
  return types.reduce((result2, left) => {
    return FromType4(context, left, result2);
  }, result);
}
function FromType4(context, type, result) {
  return IsRef(type) ? FromRef2(context, type.$ref, result) : IsArray2(type) ? FromType4(context, type.items, result) : IsConstructor2(type) ? FromTypes3(context, [...type.parameters, type.instanceType], result) : IsFunction2(type) ? FromTypes3(context, [...type.parameters, type.returnType], result) : IsInterfaceDeferred(type) ? FromProperties2(context, type.parameters[1], result) : IsIntersect(type) ? FromTypes3(context, type.allOf, result) : IsObject2(type) ? FromProperties2(context, type.properties, result) : IsUnion(type) ? FromTypes3(context, type.anyOf, result) : IsTuple(type) ? FromTypes3(context, type.items, result) : IsRecord(type) ? FromType4(context, RecordValue(type), result) : result;
}
function CyclicDependencies(context, key, type) {
  const result = FromType4(context, type, [key]);
  return result;
}

// node_modules/typebox/build/type/engine/cyclic/extends.mjs
function FromRef3(_ref) {
  return Any();
}
function FromProperties3(properties) {
  return guard_exports.Keys(properties).reduce((result, key) => {
    return { ...result, [key]: FromType5(properties[key]) };
  }, {});
}
function FromTypes4(types) {
  return types.reduce((result, left) => {
    return [...result, FromType5(left)];
  }, []);
}
function FromType5(type) {
  return IsRef(type) ? FromRef3(type.$ref) : IsArray2(type) ? _Array_(FromType5(type.items), ArrayOptions(type)) : IsConstructor2(type) ? Constructor(FromTypes4(type.parameters), FromType5(type.instanceType)) : IsFunction2(type) ? _Function_(FromTypes4(type.parameters), FromType5(type.returnType)) : IsIntersect(type) ? Intersect(FromTypes4(type.allOf)) : IsObject2(type) ? _Object_(FromProperties3(type.properties)) : IsRecord(type) ? Record(RecordKey(type), FromType5(RecordValue(type))) : IsUnion(type) ? Union(FromTypes4(type.anyOf)) : IsTuple(type) ? Tuple(FromTypes4(type.items)) : type;
}
function CyclicAnyFromParameters(defs, ref) {
  return ref in defs ? FromType5(defs[ref]) : Unknown();
}
function CyclicExtends(type) {
  return CyclicAnyFromParameters(type.$defs, type.$ref);
}

// node_modules/typebox/build/type/engine/cyclic/instantiate.mjs
function CyclicInterface(context, heritage, properties) {
  const instantiatedHeritage = InstantiateTypes(context, State([], []), heritage);
  const instantiatedProperties = InstantiateProperties({}, State([], []), properties);
  const evaluatedInterface = EvaluateIntersect([...instantiatedHeritage, _Object_(instantiatedProperties)]);
  return evaluatedInterface;
}
function CyclicDefinitions(context, dependencies) {
  const keys = guard_exports.Keys(context).filter((key) => dependencies.includes(key));
  return keys.reduce((result, key) => {
    const type = context[key];
    const instantiatedType = IsInterfaceDeferred(type) ? CyclicInterface(context, type.parameters[0], type.parameters[1]) : type;
    return { ...result, [key]: instantiatedType };
  }, {});
}
function InstantiateCyclic(context, ref, type) {
  const dependencies = CyclicDependencies(context, ref, type);
  const definitions = CyclicDefinitions(context, dependencies);
  const result = Cyclic(definitions, ref);
  return result;
}

// node_modules/typebox/build/type/engine/cyclic/target.mjs
function Resolve(defs, ref) {
  return ref in defs ? IsRef(defs[ref]) ? Resolve(defs, defs[ref].$ref) : defs[ref] : Never();
}
function CyclicTarget(defs, ref) {
  const result = Resolve(defs, ref);
  return result;
}

// node_modules/typebox/build/type/extends/extends.mjs
function Canonical(type) {
  return IsCyclic(type) ? CyclicExtends(type) : IsUnsafe(type) ? Unknown() : type;
}
function Extends(inferred, left, right) {
  const canonicalLeft = Canonical(left);
  const canonicalRight = Canonical(right);
  return ExtendsLeft(inferred, canonicalLeft, canonicalRight);
}

// node_modules/typebox/build/type/engine/evaluate/compare.mjs
var ResultEqual = "equal";
var ResultDisjoint = "disjoint";
var ResultLeftInside = "left-inside";
var ResultRightInside = "right-inside";
function Compare(left, right) {
  const extendsCheck = [
    IsUnknown(left) ? result_exports.ExtendsFalse() : Extends({}, left, right),
    IsUnknown(left) ? result_exports.ExtendsTrue({}) : Extends({}, right, left)
  ];
  return result_exports.IsExtendsTrueLike(extendsCheck[0]) && result_exports.IsExtendsTrueLike(extendsCheck[1]) ? ResultEqual : result_exports.IsExtendsTrueLike(extendsCheck[0]) && result_exports.IsExtendsFalse(extendsCheck[1]) ? ResultLeftInside : result_exports.IsExtendsFalse(extendsCheck[0]) && result_exports.IsExtendsTrueLike(extendsCheck[1]) ? ResultRightInside : ResultDisjoint;
}

// node_modules/typebox/build/type/engine/evaluate/broaden.mjs
function BroadFilter(type, types) {
  return types.filter((left) => {
    return Compare(type, left) === ResultRightInside ? false : true;
  });
}
function IsBroadestType(type, types) {
  const result = types.some((left) => {
    const result2 = Compare(type, left);
    return guard_exports.IsEqual(result2, ResultLeftInside) || guard_exports.IsEqual(result2, ResultEqual);
  });
  return guard_exports.IsEqual(result, false);
}
function BroadenType(type, types) {
  const evaluated = EvaluateType(type);
  return IsAny(evaluated) ? [evaluated] : IsBroadestType(evaluated, types) ? [...BroadFilter(evaluated, types), evaluated] : types;
}
function BroadenTypes(types) {
  return types.reduce((result, left) => {
    return IsObject2(left) ? [...result, left] : (
      // push
      IsNever(left) ? result : (
        // ignore
        BroadenType(left, result)
      )
    );
  }, []);
}
function Broaden(types) {
  const broadened = BroadenTypes(types);
  const flattened = Flatten(broadened);
  return flattened;
}

// node_modules/typebox/build/type/engine/evaluate/instantiate.mjs
function EvaluateAction(type, options) {
  const result = memory_exports.Update(EvaluateType(type), {}, options);
  return result;
}
function EvaluateInstantiate(context, state3, type, options) {
  const instantiatedType = InstantiateType(context, state3, type);
  return EvaluateAction(instantiatedType, options);
}

// node_modules/typebox/build/type/engine/call/distribute_arguments.mjs
function CollectDistributionNames(expression, result = []) {
  return (
    // Conditional
    IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Conditional") ? IsRef(expression.parameters[0]) ? CollectDistributionNames(expression.parameters[2], CollectDistributionNames(expression.parameters[3], [...result, expression.parameters[0]["$ref"]])) : CollectDistributionNames(expression.parameters[2], CollectDistributionNames(expression.parameters[3], result)) : IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Mapped") ? IsDeferred(expression.parameters[1]) && guard_exports.IsEqual(expression.parameters[1].action, "KeyOf") && IsRef(expression.parameters[1].parameters[0]) ? [...result, expression.parameters[1].parameters[0]["$ref"]] : result : result
  );
}
function BuildDistributionArray(parameters, names) {
  return parameters.reduce((result, left) => [...result, names.includes(left.name)], []);
}
function ZipDistributionArray(arguments_, distributionArray, result = []) {
  return guard_exports.ShiftLeft(arguments_, (argumentLeft, argumentRight) => guard_exports.ShiftLeft(distributionArray, (booleanLeft, booleanRight) => ZipDistributionArray(argumentRight, booleanRight, [...result, [booleanLeft, argumentLeft]]), () => result), () => result);
}
function Expand(type) {
  return IsUnion(type) ? [...type.anyOf] : [type];
}
function Append(current, type) {
  return current.reduce((result, left) => [...result, [...left, type]], []);
}
function Cross(current, variants) {
  return variants.reduce((result, left) => {
    return [...result, ...Append(current, left)];
  }, []);
}
function Distribute2(zipped) {
  return zipped.reduce((result, left) => {
    return guard_exports.IsEqual(left[0], true) ? Cross(result, Expand(left[1])) : Cross(result, [left[1]]);
  }, [[]]);
}
function DistributeArguments(parameters, arguments_, expression) {
  const distributionNames = CollectDistributionNames(expression);
  const distributionArray = BuildDistributionArray(parameters, distributionNames);
  const zippedArguments = ZipDistributionArray(arguments_, distributionArray);
  return IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Conditional") ? Distribute2(zippedArguments) : IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Mapped") ? Distribute2(zippedArguments) : [arguments_];
}

// node_modules/typebox/build/type/engine/call/resolve_target.mjs
function FromNotResolvable() {
  return ["(not-resolvable)", Never()];
}
function FromNotGeneric() {
  return ["(not-generic)", Never()];
}
function FromGeneric(name, parameters, expression) {
  return [name, Generic(parameters, expression)];
}
function FromRef4(context, ref, arguments_) {
  return ref in context ? FromType6(context, ref, context[ref], arguments_) : FromNotResolvable();
}
function FromType6(context, name, target, arguments_) {
  return IsGeneric(target) ? FromGeneric(name, target.parameters, target.expression) : IsRef(target) ? FromRef4(context, target.$ref, arguments_) : FromNotGeneric();
}
function ResolveTarget(context, target, arguments_) {
  return FromType6(context, "(anonymous)", target, arguments_);
}

// node_modules/typebox/build/type/engine/call/resolve_arguments.mjs
function AssertArgumentExtends(name, type, extends_) {
  if (IsInfer(type) || IsCall(type) || result_exports.IsExtendsTrueLike(Extends({}, type, extends_)))
    return;
  const cause = { parameter: name, expect: extends_, actual: type };
  throw new Error(`Argument for parameter ${name} does not satisfy constraint`, { cause });
}
function BindArgument(context, state3, name, extends_, type) {
  const instantiatedArgument = InstantiateType(context, state3, type);
  AssertArgumentExtends(name, instantiatedArgument, extends_);
  return memory_exports.Assign(context, { [name]: instantiatedArgument });
}
function BindArguments(context, state3, parameterLeft, parameterRight, arguments_) {
  const instantiatedExtends = InstantiateType(context, state3, parameterLeft.extends);
  const instantiatedEquals = InstantiateType(context, state3, parameterLeft.equals);
  return guard_exports.ShiftLeft(arguments_, (left, right) => BindParameters(BindArgument(context, state3, parameterLeft["name"], instantiatedExtends, left), state3, parameterRight, right), () => BindParameters(BindArgument(context, state3, parameterLeft["name"], instantiatedExtends, instantiatedEquals), state3, parameterRight, []));
}
function BindParameters(context, state3, parameters, arguments_) {
  return guard_exports.ShiftLeft(parameters, (left, right) => BindArguments(context, state3, left, right, arguments_), () => context);
}
function ResolveArgumentsContext(context, state3, parameters, arguments_) {
  return BindParameters(context, state3, parameters, arguments_);
}

// node_modules/typebox/build/type/engine/call/instantiate.mjs
function Peek(state3) {
  const result = guard_exports.IsGreaterThan(state3.callstack.length, 0) ? state3.callstack[state3.callstack.length - 1] : "";
  return result;
}
function IsTailCall(state3, name) {
  const result = guard_exports.IsEqual(Peek(state3), name);
  return result;
}
function CallDispatch(context, state3, target, parameters, expression, arguments_) {
  const argumentsContext = ResolveArgumentsContext(context, state3, parameters, arguments_);
  const returnType = InstantiateType(argumentsContext, State([...state3["callstack"], target["$ref"]], state3["visited"]), expression);
  return InstantiateType(argumentsContext, State([], []), returnType);
}
function CallDistributed(context, state3, target, parameters, expression, distributedArguments) {
  return distributedArguments.reduce((result, arguments_) => [...result, CallDispatch(context, state3, target, parameters, expression, arguments_)], []);
}
function CallImmediate(context, state3, target, parameters, expression, arguments_) {
  const distributedArguments = DistributeArguments(parameters, arguments_, expression);
  const returnTypes = CallDistributed(context, state3, target, parameters, expression, distributedArguments);
  const result = guard_exports.IsEqual(returnTypes.length, 1) ? returnTypes[0] : EvaluateUnion(returnTypes);
  return result;
}
function CallInstantiate(context, state3, target, arguments_) {
  const instantiatedArguments = InstantiateTypes(context, state3, arguments_);
  const resolved = ResolveTarget(context, target, arguments_);
  const name = resolved[0];
  const type = resolved[1];
  const result = IsGeneric(type) ? IsTailCall(state3, name) ? CallConstruct(Ref(name), instantiatedArguments) : CallImmediate(context, state3, Ref(name), type.parameters, type.expression, instantiatedArguments) : CallConstruct(target, instantiatedArguments);
  return result;
}

// node_modules/typebox/build/type/types/call.mjs
function CallConstruct(target, arguments_) {
  return memory_exports.Create({ ["~kind"]: "Call" }, { type: "call", target, arguments: arguments_ }, {});
}
function Call(target, arguments_) {
  return CallInstantiate({}, State([], []), target, arguments_);
}
function IsCall(value) {
  return IsKind(value, "Call");
}

// node_modules/typebox/build/type/engine/immutable/instantiate_remove.mjs
function RemoveImmutableOperation(type) {
  return memory_exports.Discard(type, ["~immutable"]);
}
function RemoveImmutableAction(type, options) {
  const result = memory_exports.Update(RemoveImmutableOperation(type), {}, options);
  return result;
}
function RemoveImmutableInstantiate(context, state3, type, options) {
  const instantiatedType = InstantiateType(context, state3, type);
  return RemoveImmutableAction(instantiatedType, options);
}

// node_modules/typebox/build/type/engine/intrinsics/mapping.mjs
function ApplyMapping(mapping, value) {
  return mapping(value);
}

// node_modules/typebox/build/type/engine/intrinsics/from_literal.mjs
function FromLiteral3(mapping, value) {
  return guard_exports.IsString(value) ? Literal(ApplyMapping(mapping, value)) : Literal(value);
}

// node_modules/typebox/build/type/engine/intrinsics/from_template_literal.mjs
function FromTemplateLiteral(mapping, pattern) {
  const evaluated = EvaluateTemplateLiteral(pattern);
  const result = FromType7(mapping, evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/intrinsics/from_union.mjs
function FromUnion2(mapping, types) {
  const result = types.map((type) => FromType7(mapping, type));
  return Union(result);
}

// node_modules/typebox/build/type/engine/intrinsics/from_type.mjs
function FromType7(mapping, type) {
  return IsLiteral(type) ? FromLiteral3(mapping, type.const) : IsTemplateLiteral(type) ? FromTemplateLiteral(mapping, type.pattern) : IsUnion(type) ? FromUnion2(mapping, type.anyOf) : type;
}

// node_modules/typebox/build/type/action/capitalize.mjs
function CapitalizeDeferred(type, options = {}) {
  return Deferred("Capitalize", [type], options);
}
function Capitalize(type, options = {}) {
  return CapitalizeAction(type, options);
}

// node_modules/typebox/build/type/action/lowercase.mjs
function LowercaseDeferred(type, options = {}) {
  return Deferred("Lowercase", [type], options);
}
function Lowercase(type, options = {}) {
  return LowercaseAction(type, options);
}

// node_modules/typebox/build/type/action/uncapitalize.mjs
function UncapitalizeDeferred(type, options = {}) {
  return Deferred("Uncapitalize", [type], options);
}
function Uncapitalize(type, options = {}) {
  return UncapitalizeAction(type, options);
}

// node_modules/typebox/build/type/action/uppercase.mjs
function UppercaseDeferred(type, options = {}) {
  return Deferred("Uppercase", [type], options);
}
function Uppercase(type, options = {}) {
  return UppercaseAction(type, options);
}

// node_modules/typebox/build/type/engine/intrinsics/instantiate.mjs
var CapitalizeMapping = (input) => input[0].toUpperCase() + input.slice(1);
var LowercaseMapping = (input) => input.toLowerCase();
var UncapitalizeMapping = (input) => input[0].toLowerCase() + input.slice(1);
var UppercaseMapping = (input) => input.toUpperCase();
function CapitalizeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(CapitalizeMapping, type), {}, options) : CapitalizeDeferred(type, options);
  return result;
}
function LowercaseAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(LowercaseMapping, type), {}, options) : LowercaseDeferred(type, options);
  return result;
}
function UncapitalizeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(UncapitalizeMapping, type), {}, options) : UncapitalizeDeferred(type, options);
  return result;
}
function UppercaseAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(UppercaseMapping, type), {}, options) : UppercaseDeferred(type, options);
  return result;
}
function CapitalizeInstantiate(context, state3, type, options) {
  const instantiatedType = InstantiateType(context, state3, type);
  return CapitalizeAction(instantiatedType, options);
}
function LowercaseInstantiate(context, state3, type, options) {
  const instantiatedType = InstantiateType(context, state3, type);
  return LowercaseAction(instantiatedType, options);
}
function UncapitalizeInstantiate(context, state3, type, options) {
  const instantiatedType = InstantiateType(context, state3, type);
  return UncapitalizeAction(instantiatedType, options);
}
function UppercaseInstantiate(context, state3, type, options) {
  const instantiatedType = InstantiateType(context, state3, type);
  return UppercaseAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/conditional.mjs
function ConditionalDeferred(left, right, true_, false_, options = {}) {
  return Deferred("Conditional", [left, right, true_, false_], options);
}
function Conditional(left, right, true_, false_, options = {}) {
  return ConditionalAction({}, State([], []), left, right, true_, false_, options);
}

// node_modules/typebox/build/type/engine/conditional/instantiate.mjs
function ConditionalOperation(context, state3, left, right, true_, false_) {
  const extendsResult = Extends(context, left, right);
  return result_exports.IsExtendsUnion(extendsResult) ? Union([InstantiateType(extendsResult.inferred, state3, true_), InstantiateType(context, state3, false_)]) : result_exports.IsExtendsTrue(extendsResult) ? InstantiateType(extendsResult.inferred, state3, true_) : InstantiateType(context, state3, false_);
}
function ConditionalAction(context, state3, left, right, true_, false_, options) {
  const result = CanInstantiate([left, right]) ? memory_exports.Update(ConditionalOperation(context, state3, left, right, true_, false_), {}, options) : ConditionalDeferred(left, right, true_, false_, options);
  return result;
}
function ConditionalInstantiate(context, state3, left, right, true_, false_, options) {
  const instantiatedLeft = InstantiateType(context, state3, left);
  const instantiatedRight = InstantiateType(context, state3, right);
  return ConditionalAction(context, state3, instantiatedLeft, instantiatedRight, true_, false_, options);
}

// node_modules/typebox/build/type/action/constructor_parameters.mjs
function ConstructorParametersDeferred(type, options = {}) {
  return Deferred("ConstructorParameters", [type], options);
}
function ConstructorParameters(type, options = {}) {
  return ConstructorParametersAction(type, options);
}

// node_modules/typebox/build/type/engine/constructor_parameters/instantiate.mjs
function ConstructorParametersOperation(type) {
  const parameters = IsConstructor2(type) ? type["parameters"] : [];
  const instantiatedParameters = InstantiateElements({}, State([], []), parameters);
  const result = Tuple(instantiatedParameters);
  return result;
}
function ConstructorParametersAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(ConstructorParametersOperation(type), {}, options) : ConstructorParametersDeferred(type, options);
  return result;
}
function ConstructorParametersInstantiate(context, state3, type, options) {
  const instantiatedType = InstantiateType(context, state3, type);
  return ConstructorParametersAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/exclude.mjs
function ExcludeDeferred(left, right, options = {}) {
  return Deferred("Exclude", [left, right], options);
}
function Exclude(left, right, options = {}) {
  return ExcludeAction(left, right, options);
}

// node_modules/typebox/build/type/engine/exclude/instantiate.mjs
function ExcludeAction(left, right, options) {
  const result = CanInstantiate([left, right]) ? memory_exports.Update(ExcludeOperation(left, right), {}, options) : ExcludeDeferred(left, right, options);
  return result;
}
function ExcludeInstantiate(context, state3, left, right, options) {
  const instantiatedLeft = InstantiateType(context, state3, left);
  const instantiatedRight = InstantiateType(context, state3, right);
  return ExcludeAction(instantiatedLeft, instantiatedRight, options);
}

// node_modules/typebox/build/type/action/extract.mjs
function ExtractDeferred(left, right, options = {}) {
  return Deferred("Extract", [left, right], options);
}
function Extract(left, right, options = {}) {
  return ExtractAction(left, right, options);
}

// node_modules/typebox/build/type/engine/extract/operation.mjs
function ExtractType(left, right) {
  const check = Extends({}, left, right);
  const result = result_exports.IsExtendsTrueLike(check) ? [left] : [];
  return result;
}
function ExtractUnion(types, right) {
  return types.reduce((result, head) => {
    return [...result, ...ExtractType(head, right)];
  }, []);
}
function ExtractOperation(left, right) {
  const evaluated = EvaluateType(left);
  const canonical2 = IsUnion(evaluated) ? evaluated.anyOf : [evaluated];
  const remaining = ExtractUnion(canonical2, right);
  const result = EvaluateUnion(remaining);
  return result;
}

// node_modules/typebox/build/type/engine/extract/instantiate.mjs
function ExtractAction(left, right, options) {
  const result = CanInstantiate([left, right]) ? memory_exports.Update(ExtractOperation(left, right), {}, options) : ExtractDeferred(left, right, options);
  return result;
}
function ExtractInstantiate(context, state3, left, right, options) {
  const instantiatedLeft = InstantiateType(context, state3, left);
  const instantiatedRight = InstantiateType(context, state3, right);
  return ExtractAction(instantiatedLeft, instantiatedRight, options);
}

// node_modules/typebox/build/type/engine/helpers/keys_to_indexer.mjs
function KeysToLiterals(keys) {
  return keys.reduce((result, left) => {
    return IsLiteralValue(left) ? [...result, Literal(left)] : result;
  }, []);
}
function KeysToIndexer(keys) {
  const literals = KeysToLiterals(keys);
  const result = Union(literals);
  return result;
}

// node_modules/typebox/build/type/action/indexed.mjs
function IndexDeferred(type, indexer, options = {}) {
  return Deferred("Index", [type, indexer], options);
}
function Index(type, indexer_or_keys, options = {}) {
  const indexer = guard_exports.IsArray(indexer_or_keys) ? KeysToIndexer(indexer_or_keys) : indexer_or_keys;
  return IndexAction(type, indexer, options);
}

// node_modules/typebox/build/type/engine/object/from_cyclic.mjs
function FromCyclic(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const result = FromType8(target);
  return result;
}

// node_modules/typebox/build/type/engine/object/from_dependent.mjs
function FromDependent(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType8(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/object/from_intersect.mjs
function CollapseIntersectProperties(left, right) {
  const leftKeys = guard_exports.Keys(left).filter((key) => !guard_exports.HasPropertyKey(right, key));
  const rightKeys = guard_exports.Keys(right).filter((key) => !guard_exports.HasPropertyKey(left, key));
  const sharedKeys = guard_exports.Keys(left).filter((key) => guard_exports.HasPropertyKey(right, key));
  const leftProperties = leftKeys.reduce((result, key) => ({ ...result, [key]: left[key] }), {});
  const rightProperties = rightKeys.reduce((result, key) => ({ ...result, [key]: right[key] }), {});
  const sharedProperties = sharedKeys.reduce((result, key) => ({ ...result, [key]: EvaluateIntersect([left[key], right[key]]) }), {});
  const unique = memory_exports.Assign(leftProperties, rightProperties);
  const shared = memory_exports.Assign(unique, sharedProperties);
  return shared;
}
function FromIntersect(types) {
  return types.reduce((result, left) => {
    return CollapseIntersectProperties(result, FromType8(left));
  }, {});
}

// node_modules/typebox/build/type/engine/object/from_object.mjs
function FromObject4(properties) {
  return properties;
}

// node_modules/typebox/build/type/engine/object/from_tuple.mjs
function FromTuple(types) {
  const object = TupleToObject(Tuple(types));
  const result = FromType8(object);
  return result;
}

// node_modules/typebox/build/type/engine/object/from_union.mjs
function CollapseUnionProperties(left, right) {
  const sharedKeys = guard_exports.Keys(left).filter((key) => key in right);
  const result = sharedKeys.reduce((result2, key) => {
    return { ...result2, [key]: EvaluateUnion([left[key], right[key]]) };
  }, {});
  return result;
}
function ReduceVariants(types, result) {
  return guard_exports.ShiftLeft(types, (left, right) => ReduceVariants(right, CollapseUnionProperties(result, FromType8(left))), () => result);
}
function FromUnion3(types) {
  return guard_exports.ShiftLeft(types, (left, right) => ReduceVariants(right, FromType8(left)), () => Unreachable());
}

// node_modules/typebox/build/type/engine/object/from_type.mjs
function FromType8(type) {
  return IsCyclic(type) ? FromCyclic(type.$defs, type.$ref) : IsDependent(type) ? FromDependent(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect(type.allOf) : IsUnion(type) ? FromUnion3(type.anyOf) : IsTuple(type) ? FromTuple(type.items) : IsObject2(type) ? FromObject4(type.properties) : {};
}

// node_modules/typebox/build/type/engine/object/collapse.mjs
function CollapseToObject(type) {
  const properties = FromType8(type);
  const result = _Object_(properties);
  return result;
}

// node_modules/typebox/build/type/engine/helpers/keys.mjs
var integerKeyPattern = new RegExp("^(?:0|[1-9][0-9]*)$");
function ConvertToIntegerKey(value) {
  const normal = `${value}`;
  return integerKeyPattern.test(normal) ? parseInt(normal) : value;
}

// node_modules/typebox/build/type/engine/indexed/from_array.mjs
function NormalizeLiteral(value) {
  return Literal(ConvertToIntegerKey(value));
}
function NormalizeIndexerTypes(types) {
  return types.map((type) => NormalizeIndexer(type));
}
function NormalizeIndexer(type) {
  return IsIntersect(type) ? Intersect(NormalizeIndexerTypes(type.allOf)) : IsUnion(type) ? Union(NormalizeIndexerTypes(type.anyOf)) : IsLiteral(type) ? NormalizeLiteral(type.const) : type;
}
function FromArray3(type, indexer) {
  const normalizedIndexer = NormalizeIndexer(indexer);
  const check = Extends({}, normalizedIndexer, Number2());
  const result = (
    // indexer
    result_exports.IsExtendsTrueLike(check) ? type : IsLiteral(indexer) && guard_exports.IsEqual(indexer.const, "length") ? Number2() : Never()
  );
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_cyclic.mjs
function FromCyclic2(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const result = FromType9(target);
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_dependent.mjs
function FromDependent2(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType9(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_enum.mjs
function FromEnum(values) {
  const evaluated = EvaluateEnum(values);
  const result = FromType9(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_intersect.mjs
function FromIntersect2(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType9(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_literal.mjs
function FromLiteral4(value) {
  const result = [`${value}`];
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_template_literal.mjs
function FromTemplateLiteral2(pattern) {
  const evaluated = EvaluateTemplateLiteral(pattern);
  const result = FromType9(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_union.mjs
function FromUnion4(types) {
  return types.reduce((result, left) => {
    return [...result, ...FromType9(left)];
  }, []);
}

// node_modules/typebox/build/type/engine/indexable/from_type.mjs
function FromType9(type) {
  return IsCyclic(type) ? FromCyclic2(type.$defs, type.$ref) : IsDependent(type) ? FromDependent2(type.if, type.then, type.else) : IsEnum(type) ? FromEnum(type.enum) : IsIntersect(type) ? FromIntersect2(type.allOf) : IsLiteral(type) ? FromLiteral4(type.const) : IsTemplateLiteral(type) ? FromTemplateLiteral2(type.pattern) : IsUnion(type) ? FromUnion4(type.anyOf) : [];
}

// node_modules/typebox/build/type/engine/indexable/to_indexable_keys.mjs
function ToIndexableKeys(type) {
  const result = FromType9(type);
  return result;
}

// node_modules/typebox/build/type/engine/this/expand_this.mjs
function FromTypes5(properties, types) {
  return types.map((type) => FromType10(properties, type));
}
function FromType10(properties, type) {
  return IsArray2(type) ? _Array_(FromType10(properties, type.items)) : IsConstructor2(type) ? Constructor(FromTypes5(properties, type.parameters), FromType10(properties, type.instanceType)) : IsFunction2(type) ? _Function_(FromTypes5(properties, type.parameters), FromType10(properties, type.returnType)) : IsTuple(type) ? Tuple(FromTypes5(properties, type.items)) : IsUnion(type) ? Union(FromTypes5(properties, type.anyOf)) : IsIntersect(type) ? Intersect(FromTypes5(properties, type.allOf)) : IsThis(type) ? _Object_(properties) : type;
}
function ExpandThis(properties, type) {
  const result = FromType10(properties, type);
  return result;
}

// node_modules/typebox/build/type/engine/indexed/from_object.mjs
function IndexProperty(properties, key) {
  const selectedType = key in properties ? properties[key] : Never();
  const result = ExpandThis(properties, selectedType);
  return result;
}
function IndexProperties(properties, keys) {
  return keys.reduce((result, left) => {
    return [...result, IndexProperty(properties, left)];
  }, []);
}
function FromIndexer(properties, indexer) {
  const keys = ToIndexableKeys(indexer);
  const variants = IndexProperties(properties, keys);
  const result = EvaluateUnion(variants);
  return result;
}
var NumericKeyPattern = new RegExp(IntegerKey);
function NumericKeys(keys) {
  const result = keys.filter((key) => NumericKeyPattern.test(key));
  return result;
}
function FromIndexerNumber(properties) {
  const keys = PropertyKeys(properties);
  const numericKeys = NumericKeys(keys);
  const variants = IndexProperties(properties, numericKeys);
  const result = EvaluateUnion(variants);
  return result;
}
function FromObject5(properties, indexer) {
  const result = IsNumber3(indexer) ? FromIndexerNumber(properties) : FromIndexer(properties, indexer);
  return result;
}

// node_modules/typebox/build/type/engine/indexed/array_indexer.mjs
function ConvertLiteral(value) {
  return Literal(ConvertToIntegerKey(value));
}
function ArrayIndexerTypes(types) {
  return types.map((type) => FormatArrayIndexer(type));
}
function FormatArrayIndexer(type) {
  return IsIntersect(type) ? Intersect(ArrayIndexerTypes(type.allOf)) : IsUnion(type) ? Union(ArrayIndexerTypes(type.anyOf)) : IsLiteral(type) ? ConvertLiteral(type.const) : type;
}

// node_modules/typebox/build/type/engine/indexed/from_tuple.mjs
function IndexElementsWithIndexer(types, indexer) {
  return types.reduceRight((result, right, index) => {
    const check = Extends({}, Literal(index), indexer);
    return result_exports.IsExtendsTrueLike(check) ? [right, ...result] : result;
  }, []);
}
function FromTupleWithIndexer(types, indexer) {
  const formattedArrayIndexer = FormatArrayIndexer(indexer);
  const elements = IndexElementsWithIndexer(types, formattedArrayIndexer);
  return EvaluateUnionFast(elements);
}
function FromTupleWithoutIndexer(types) {
  return EvaluateUnionFast(types);
}
function FromTuple2(types, indexer) {
  return (
    // length (intrinsic)
    IsLiteral(indexer) && guard_exports.IsEqual(indexer.const, "length") ? Literal(types.length) : IsNumber3(indexer) || IsInteger2(indexer) ? FromTupleWithoutIndexer(types) : FromTupleWithIndexer(types, indexer)
  );
}

// node_modules/typebox/build/type/engine/indexed/from_type.mjs
function FromType11(type, indexer) {
  return IsArray2(type) ? FromArray3(type.items, indexer) : IsObject2(type) ? FromObject5(type.properties, indexer) : IsTuple(type) ? FromTuple2(type.items, indexer) : Never();
}

// node_modules/typebox/build/type/engine/indexed/instantiate.mjs
function NormalizeType(type) {
  const result = IsCyclic(type) || IsDependent(type) || IsIntersect(type) || IsUnion(type) ? CollapseToObject(type) : type;
  return result;
}
function IndexAction(type, indexer, options) {
  const result = CanInstantiate([type, indexer]) ? memory_exports.Update(FromType11(NormalizeType(type), indexer), {}, options) : IndexDeferred(type, indexer, options);
  return result;
}
function IndexInstantiate(context, state3, type, indexer, options) {
  const instantiatedType = InstantiateType(context, state3, type);
  const instantiatedIndexer = InstantiateType(context, state3, indexer);
  return IndexAction(instantiatedType, instantiatedIndexer, options);
}

// node_modules/typebox/build/type/action/instance_type.mjs
function InstanceTypeDeferred(type, options = {}) {
  return Deferred("InstanceType", [type], options);
}
function InstanceType(type, options = {}) {
  return InstanceTypeAction(type, options);
}

// node_modules/typebox/build/type/engine/instance_type/instantiate.mjs
function InstanceTypeOperation(type) {
  return IsConstructor2(type) ? type["instanceType"] : Never();
}
function InstanceTypeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(InstanceTypeOperation(type), {}, options) : InstanceTypeDeferred(type, options);
  return result;
}
function InstanceTypeInstantiate(context, state3, type, options = {}) {
  const instantiatedType = InstantiateType(context, state3, type);
  return InstanceTypeAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/keyof.mjs
function KeyOfDeferred(type, options = {}) {
  return Deferred("KeyOf", [type], options);
}
function KeyOf2(type, options = {}) {
  return KeyOfAction(type, options);
}

// node_modules/typebox/build/type/engine/keyof/from_any.mjs
function FromAny() {
  return Union([Number2(), String2(), Symbol2()]);
}

// node_modules/typebox/build/type/engine/keyof/from_array.mjs
function FromArray4(_type) {
  return Number2();
}

// node_modules/typebox/build/type/engine/keyof/from_object.mjs
function FromPropertyKeys(keys) {
  const result = keys.reduce((result2, left) => {
    return IsLiteralValue(left) ? [...result2, Literal(ConvertToIntegerKey(left))] : Unreachable();
  }, []);
  return result;
}
function FromObject6(properties) {
  const propertyKeys = guard_exports.Keys(properties);
  const variants = FromPropertyKeys(propertyKeys);
  const result = EvaluateUnionFast(variants);
  return result;
}

// node_modules/typebox/build/type/engine/keyof/from_record.mjs
function FromRecord2(type) {
  return RecordKey(type);
}

// node_modules/typebox/build/type/engine/keyof/from_tuple.mjs
function FromTuple3(types) {
  const result = types.map((_, index) => Literal(index));
  return EvaluateUnionFast(result);
}

// node_modules/typebox/build/type/engine/keyof/from_type.mjs
function FromType12(type) {
  return IsAny(type) ? FromAny() : IsArray2(type) ? FromArray4(type.items) : IsObject2(type) ? FromObject6(type.properties) : IsRecord(type) ? FromRecord2(type) : IsTuple(type) ? FromTuple3(type.items) : Never();
}

// node_modules/typebox/build/type/engine/keyof/instantiate.mjs
function NormalizeType2(type) {
  const result = IsCyclic(type) || IsDependent(type) || IsIntersect(type) || IsUnion(type) ? CollapseToObject(type) : type;
  return result;
}
function KeyOfAction(type, options) {
  return CanInstantiate([type]) ? memory_exports.Update(FromType12(NormalizeType2(type)), {}, options) : KeyOfDeferred(type, options);
}
function KeyOfInstantiate(context, state3, type, options) {
  const instantiatedType = InstantiateType(context, state3, type);
  return KeyOfAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/mapped.mjs
function MappedDeferred(identifier, type, as, property, options = {}) {
  return Deferred("Mapped", [identifier, type, as, property], options);
}
function Mapped(identifier, type, as, property, options = {}) {
  return MappedAction({}, State([], []), identifier, type, as, property, options);
}

// node_modules/typebox/build/type/engine/mapped/mapped_variants.mjs
function FromTemplateLiteral3(pattern) {
  const evaluated = EvaluateTemplateLiteral(pattern);
  const result = FromType13(evaluated);
  return result;
}
function FromUnion5(types) {
  return types.reduce((result, left) => {
    return [...result, ...FromType13(left)];
  }, []);
}
function FromEnum2(values) {
  const evaluated = EvaluateEnum(values);
  const result = FromType13(evaluated);
  return result;
}
function FromLiteral5(value) {
  const result = guard_exports.IsNumber(value) ? [Literal(`${value}`)] : [Literal(value)];
  return result;
}
function FromType13(type) {
  const result = IsEnum(type) ? FromEnum2(type.enum) : IsLiteral(type) ? FromLiteral5(type.const) : IsTemplateLiteral(type) ? FromTemplateLiteral3(type.pattern) : IsUnion(type) ? FromUnion5(type.anyOf) : [type];
  return result;
}
function MappedVariants(type) {
  const result = FromType13(type);
  return result;
}

// node_modules/typebox/build/type/engine/mapped/mapped_operation.mjs
function CanonicalAs(instantiatedAs) {
  const result = IsTemplateLiteral(instantiatedAs) ? EvaluateTemplateLiteral(instantiatedAs.pattern) : instantiatedAs;
  return result;
}
function MappedVariant(context, state3, identifier, variant, as, property) {
  const variantContext = memory_exports.Assign(context, { [identifier["name"]]: variant });
  const instantiatedAs = InstantiateType(variantContext, state3, as);
  const canonicalAs = CanonicalAs(instantiatedAs);
  const instantiatedProperty = InstantiateType(variantContext, state3, property);
  return IsLiteralNumber(canonicalAs) || IsLiteralString(canonicalAs) ? { [canonicalAs.const]: instantiatedProperty } : {};
}
function MappedProperties(context, state3, identifier, variants, as, property) {
  return variants.reduce((result, left) => {
    return [...result, MappedVariant(context, state3, identifier, left, as, property)];
  }, []);
}
function MappedObjects(properties) {
  return properties.reduce((result, left) => {
    return [...result, _Object_(left)];
  }, []);
}
function MappedOperation(context, state3, identifier, type, as, property) {
  const variants = MappedVariants(type);
  const mappedProperties = MappedProperties(context, state3, identifier, variants, as, property);
  const mappedObjects = MappedObjects(mappedProperties);
  const result = EvaluateIntersect(mappedObjects);
  return result;
}

// node_modules/typebox/build/type/engine/mapped/instantiate.mjs
function MappedAction(context, state3, identifier, type, as, property, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(MappedOperation(context, state3, identifier, type, as, property), {}, options) : MappedDeferred(identifier, type, as, property, options);
  return result;
}
function MappedInstantiate(context, state3, identifier, type, as, property, options) {
  const instantiatedType = InstantiateType(context, state3, type);
  return MappedAction(context, state3, identifier, instantiatedType, as, property, options);
}

// node_modules/typebox/build/type/engine/module/instantiate.mjs
function InstantiateCyclics(context, declarations, cyclicKeys) {
  const declarationContext = memory_exports.Assign(context, declarations);
  const declarationKeys = guard_exports.Keys(declarations).filter((key) => cyclicKeys.includes(key));
  return declarationKeys.reduce((result, key) => {
    return { ...result, [key]: InstantiateCyclic(declarationContext, key, declarations[key]) };
  }, {});
}
function InstantiateNonCyclics(context, declarations, cyclicKeys) {
  const declarationContext = memory_exports.Assign(context, declarations);
  const declarationKeys = guard_exports.Keys(declarations).filter((key) => !cyclicKeys.includes(key));
  return declarationKeys.reduce((result, key) => {
    return { ...result, [key]: InstantiateType(declarationContext, State([], []), declarations[key]) };
  }, {});
}
function InstantiateModule(context, declarations, options) {
  const cyclicCandidates = CyclicCandidates(declarations);
  const instantiatedCyclics = InstantiateCyclics(context, declarations, cyclicCandidates);
  const instantiatedNonCyclics = InstantiateNonCyclics(context, declarations, cyclicCandidates);
  const instantiatedModule = { ...instantiatedCyclics, ...instantiatedNonCyclics };
  return memory_exports.Update(instantiatedModule, {}, options);
}
function ModuleInstantiate(context, _state, declarations, options) {
  const instantiatedModule = InstantiateModule(context, declarations, options);
  return instantiatedModule;
}

// node_modules/typebox/build/type/action/non_nullable.mjs
function NonNullableDeferred(type, options = {}) {
  return Deferred("NonNullable", [type], options);
}
function NonNullable(type, options = {}) {
  return NonNullableAction(type, options);
}

// node_modules/typebox/build/type/engine/non_nullable/instantiate.mjs
function NonNullableOperation(type) {
  const excluded = Union([Null(), Undefined()]);
  return ExcludeAction(type, excluded, {});
}
function NonNullableAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(NonNullableOperation(type), {}, options) : NonNullableDeferred(type, options);
  return result;
}
function NonNullableInstantiate(context, state3, type, options) {
  const instantiatedType = InstantiateType(context, state3, type);
  return NonNullableAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/omit.mjs
function OmitDeferred(type, indexer, options = {}) {
  return Deferred("Omit", [type, indexer], options);
}
function Omit(type, indexer_or_keys, options = {}) {
  const indexer = guard_exports.IsArray(indexer_or_keys) ? KeysToIndexer(indexer_or_keys) : indexer_or_keys;
  return OmitAction(type, indexer, options);
}

// node_modules/typebox/build/type/engine/indexable/to_indexable.mjs
function ToIndexable(type) {
  const collapsed = CollapseToObject(type);
  const result = IsObject2(collapsed) ? collapsed.properties : Unreachable();
  return result;
}

// node_modules/typebox/build/type/engine/omit/from_type.mjs
function FromKeys(properties, keys) {
  const result = guard_exports.Keys(properties).reduce((result2, key) => {
    return keys.includes(key) ? result2 : { ...result2, [key]: properties[key] };
  }, {});
  return result;
}
function FromType14(type, indexer) {
  const indexable = ToIndexable(type);
  const indexableKeys = ToIndexableKeys(indexer);
  const omitted = FromKeys(indexable, indexableKeys);
  const result = _Object_(omitted);
  return result;
}

// node_modules/typebox/build/type/engine/omit/instantiate.mjs
function OmitAction(type, indexer, options) {
  const result = CanInstantiate([type, indexer]) ? memory_exports.Update(FromType14(type, indexer), {}, options) : OmitDeferred(type, indexer, options);
  return result;
}
function OmitInstantiate(context, state3, type, indexer, options) {
  const instantiatedType = InstantiateType(context, state3, type);
  const instantiatedIndexer = InstantiateType(context, state3, indexer);
  return OmitAction(instantiatedType, instantiatedIndexer, options);
}

// node_modules/typebox/build/type/action/parameters.mjs
function ParametersDeferred(type, options = {}) {
  return Deferred("Parameters", [type], options);
}
function Parameters(type, options = {}) {
  return ParametersAction(type, options);
}

// node_modules/typebox/build/type/engine/parameters/instantiate.mjs
function ParametersOperation(type) {
  const parameters = IsFunction2(type) ? type["parameters"] : [];
  const instantiatedParameters = InstantiateElements({}, State([], []), parameters);
  const result = Tuple(instantiatedParameters);
  return result;
}
function ParametersAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(ParametersOperation(type), {}, options) : ParametersDeferred(type, options);
  return result;
}
function ParametersInstantiate(context, state3, type, options) {
  const instantiatedType = InstantiateType(context, state3, type);
  return ParametersAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/partial.mjs
function PartialDeferred(type, options = {}) {
  return Deferred("Partial", [type], options);
}
function Partial(type, options = {}) {
  return PartialAction(type, options);
}

// node_modules/typebox/build/type/engine/partial/from_cyclic.mjs
function FromCyclic3(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const partial = FromType15(target);
  const result = Cyclic(memory_exports.Assign(defs, { [ref]: partial }), ref);
  return result;
}

// node_modules/typebox/build/type/engine/partial/from_dependent.mjs
function FromDependent3(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType15(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/partial/from_intersect.mjs
function FromIntersect3(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType15(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/partial/from_union.mjs
function FromUnion6(types) {
  const result = types.map((type) => FromType15(type));
  return Union(result);
}

// node_modules/typebox/build/type/engine/partial/from_object.mjs
function FromObject7(properties) {
  const mapped = guard_exports.Keys(properties).reduce((result2, left) => {
    return { ...result2, [left]: AddOptional(properties[left]) };
  }, {});
  const result = _Object_(mapped);
  return result;
}

// node_modules/typebox/build/type/engine/partial/from_type.mjs
function FromType15(type) {
  return IsCyclic(type) ? FromCyclic3(type.$defs, type.$ref) : IsDependent(type) ? FromDependent3(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect3(type.allOf) : IsUnion(type) ? FromUnion6(type.anyOf) : IsObject2(type) ? FromObject7(type.properties) : _Object_({});
}

// node_modules/typebox/build/type/engine/partial/instantiate.mjs
function PartialAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType15(type), {}, options) : PartialDeferred(type, options);
  return result;
}
function PartialInstantiate(context, state3, type, options) {
  const instantiatedType = InstantiateType(context, state3, type);
  return PartialAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/pick.mjs
function PickDeferred(type, indexer, options = {}) {
  return Deferred("Pick", [type, indexer], options);
}
function Pick(type, indexer_or_keys, options = {}) {
  const indexer = guard_exports.IsArray(indexer_or_keys) ? KeysToIndexer(indexer_or_keys) : indexer_or_keys;
  return PickAction(type, indexer, options);
}

// node_modules/typebox/build/type/engine/pick/from_type.mjs
function FromKeys2(properties, keys) {
  const result = guard_exports.Keys(properties).reduce((result2, key) => {
    return keys.includes(key) ? memory_exports.Assign(result2, { [key]: properties[key] }) : result2;
  }, {});
  return result;
}
function FromType16(type, indexer) {
  const indexable = ToIndexable(type);
  const keys = ToIndexableKeys(indexer);
  const applied = FromKeys2(indexable, keys);
  const result = _Object_(applied);
  return result;
}

// node_modules/typebox/build/type/engine/pick/instantiate.mjs
function PickAction(type, indexer, options) {
  const result = CanInstantiate([type, indexer]) ? memory_exports.Update(FromType16(type, indexer), {}, options) : PickDeferred(type, indexer, options);
  return result;
}
function PickInstantiate(context, state3, type, indexer, options) {
  const instantiatedType = InstantiateType(context, state3, type);
  const instantiatedIndexer = InstantiateType(context, state3, indexer);
  return PickAction(instantiatedType, instantiatedIndexer, options);
}

// node_modules/typebox/build/type/action/readonly_object.mjs
function ReadonlyObjectDeferred(type, options = {}) {
  return Deferred("ReadonlyObject", [type], options);
}
function ReadonlyObject(type, options = {}) {
  return ReadonlyObjectAction(type, options);
}
var ReadonlyType = ReadonlyObject;

// node_modules/typebox/build/type/engine/readonly_object/from_array.mjs
function FromArray5(type) {
  const result = AddImmutable(_Array_(type));
  return result;
}

// node_modules/typebox/build/type/engine/readonly_object/from_cyclic.mjs
function FromCyclic4(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const partial = FromType17(target);
  const result = Cyclic(memory_exports.Assign(defs, { [ref]: partial }), ref);
  return result;
}

// node_modules/typebox/build/type/engine/readonly_object/from_dependent.mjs
function FromDependent4(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType17(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/readonly_object/from_intersect.mjs
function FromIntersect4(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType17(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/readonly_object/from_object.mjs
function FromObject8(properties) {
  const mapped = guard_exports.Keys(properties).reduce((result2, left) => {
    return { ...result2, [left]: AddReadonly(properties[left]) };
  }, {});
  const result = _Object_(mapped);
  return result;
}

// node_modules/typebox/build/type/engine/readonly_object/from_tuple.mjs
function FromTuple4(types) {
  const result = AddImmutable(Tuple(types));
  return result;
}

// node_modules/typebox/build/type/engine/readonly_object/from_union.mjs
function FromUnion7(types) {
  const result = types.map((type) => FromType17(type));
  return Union(result);
}

// node_modules/typebox/build/type/engine/readonly_object/from_type.mjs
function FromType17(type) {
  return IsArray2(type) ? FromArray5(type.items) : IsCyclic(type) ? FromCyclic4(type.$defs, type.$ref) : IsDependent(type) ? FromDependent4(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect4(type.allOf) : IsObject2(type) ? FromObject8(type.properties) : IsTuple(type) ? FromTuple4(type.items) : IsUnion(type) ? FromUnion7(type.anyOf) : type;
}

// node_modules/typebox/build/type/engine/readonly_object/instantiate.mjs
function ReadonlyObjectAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType17(type), {}, options) : ReadonlyObjectDeferred(type);
  return result;
}
function ReadonlyObjectInstantiate(context, state3, type, options) {
  const instantiatedType = InstantiateType(context, state3, type);
  return ReadonlyObjectAction(instantiatedType, options);
}

// node_modules/typebox/build/type/engine/ref/instantiate.mjs
function RefInstantiate(context, state3, type, ref) {
  return state3.visited.includes(ref) ? type : ref in context ? InstantiateType(context, State(state3["callstack"], [...state3["visited"], ref]), context[ref]) : type;
}

// node_modules/typebox/build/type/engine/required/from_cyclic.mjs
function FromCyclic5(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const partial = FromType18(target);
  const result = Cyclic(memory_exports.Assign(defs, { [ref]: partial }), ref);
  return result;
}

// node_modules/typebox/build/type/engine/required/from_dependent.mjs
function FromDependent5(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType18(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/required/from_intersect.mjs
function FromIntersect5(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType18(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/required/from_union.mjs
function FromUnion8(types) {
  const result = types.map((type) => FromType18(type));
  return Union(result);
}

// node_modules/typebox/build/type/engine/required/from_object.mjs
function FromObject9(properties) {
  const mapped = guard_exports.Keys(properties).reduce((result2, left) => {
    return { ...result2, [left]: RemoveOptional(properties[left]) };
  }, {});
  const result = _Object_(mapped);
  return result;
}

// node_modules/typebox/build/type/engine/required/from_type.mjs
function FromType18(type) {
  return IsCyclic(type) ? FromCyclic5(type.$defs, type.$ref) : IsDependent(type) ? FromDependent5(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect5(type.allOf) : IsUnion(type) ? FromUnion8(type.anyOf) : IsObject2(type) ? FromObject9(type.properties) : _Object_({});
}

// node_modules/typebox/build/type/action/required.mjs
function RequiredDeferred(type, options = {}) {
  return Deferred("Required", [type], options);
}
function Required(type, options = {}) {
  return RequiredAction(type, options);
}

// node_modules/typebox/build/type/engine/required/instantiate.mjs
function RequiredAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType18(type), {}, options) : RequiredDeferred(type, options);
  return result;
}
function RequiredInstantiate(context, state3, type, options) {
  const instaniatedType = InstantiateType(context, state3, type);
  return RequiredAction(instaniatedType, options);
}

// node_modules/typebox/build/type/action/return_type.mjs
function ReturnTypeDeferred(type, options = {}) {
  return Deferred("ReturnType", [type], options);
}
function ReturnType(type, options = {}) {
  return ReturnTypeAction(type, options);
}

// node_modules/typebox/build/type/engine/return_type/instantiate.mjs
function ReturnTypeOperation(type) {
  return IsFunction2(type) ? type["returnType"] : Never();
}
function ReturnTypeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(ReturnTypeOperation(type), {}, options) : ReturnTypeDeferred(type, options);
  return result;
}
function ReturnTypeInstantiate(context, state3, type, options = {}) {
  const instantiatedType = InstantiateType(context, state3, type);
  return ReturnTypeAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/with.mjs
function WithDeferred(type, options) {
  return Deferred("With", [type, options], {});
}
function With2(type, options) {
  return WithAction(type, options);
}

// node_modules/typebox/build/type/engine/with/instantiate.mjs
function WithAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(type, {}, options) : WithDeferred(type, options);
  return result;
}
function WithInstantiate(context, state3, type, options) {
  const instaniatedType = InstantiateType(context, state3, type);
  return WithAction(instaniatedType, options);
}

// node_modules/typebox/build/type/engine/rest/spread.mjs
function SpreadElement(type) {
  const result = IsRest(type) ? IsTuple(type.items) ? RestSpread(type.items.items) : IsInfer(type.items) ? [type] : IsRef(type.items) ? [type] : [Never()] : [type];
  return result;
}
function RestSpread(types) {
  const result = types.reduce((result2, left) => {
    return [...result2, ...SpreadElement(left)];
  }, []);
  return result;
}

// node_modules/typebox/build/type/engine/instantiate.mjs
function State(callstack, visited) {
  return { callstack, visited };
}
function CanInstantiate(types) {
  return guard_exports.ShiftLeft(types, (left, right) => IsRef(left) ? false : CanInstantiate(right), () => true);
}
function InstantiateProperties(context, state3, properties) {
  return guard_exports.Keys(properties).reduce((result, key) => {
    return { ...result, [key]: InstantiateType(context, state3, properties[key]) };
  }, {});
}
function InstantiateElements(context, state3, types) {
  const elements = InstantiateTypes(context, state3, types);
  const result = RestSpread(elements);
  return result;
}
function InstantiateTypes(context, state3, types) {
  return types.map((type) => InstantiateType(context, state3, type));
}
function WithModifiers(type, instantiatedType) {
  const withOptional = IsOptional(type) ? AddOptionalAction(instantiatedType, {}) : instantiatedType;
  const withReadonly = IsReadonly(type) ? AddReadonlyAction(withOptional, {}) : withOptional;
  const withImmutable = IsImmutable(type) ? AddImmutableAction(withReadonly, {}) : withReadonly;
  return withImmutable;
}
function InstantiateDeferred(context, state3, action, parameters, options) {
  return (
    // Modifiers
    guard_exports.IsEqual(action, "AddImmutable") ? AddImmutableInstantiate(context, state3, parameters[0], options) : guard_exports.IsEqual(action, "RemoveImmutable") ? RemoveImmutableInstantiate(context, state3, parameters[0], options) : guard_exports.IsEqual(action, "AddReadonly") ? AddReadonlyInstantiate(context, state3, parameters[0], options) : guard_exports.IsEqual(action, "RemoveReadonly") ? RemoveReadonlyInstantiate(context, state3, parameters[0], options) : guard_exports.IsEqual(action, "AddOptional") ? AddOptionalInstantiate(context, state3, parameters[0], options) : guard_exports.IsEqual(action, "RemoveOptional") ? RemoveOptionalInstantiate(context, state3, parameters[0], options) : (
      // Actions
      guard_exports.IsEqual(action, "Capitalize") ? CapitalizeInstantiate(context, state3, parameters[0], options) : guard_exports.IsEqual(action, "Conditional") ? ConditionalInstantiate(context, state3, parameters[0], parameters[1], parameters[2], parameters[3], options) : guard_exports.IsEqual(action, "ConstructorParameters") ? ConstructorParametersInstantiate(context, state3, parameters[0], options) : guard_exports.IsEqual(action, "Evaluate") ? EvaluateInstantiate(context, state3, parameters[0], options) : guard_exports.IsEqual(action, "Exclude") ? ExcludeInstantiate(context, state3, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Extract") ? ExtractInstantiate(context, state3, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Index") ? IndexInstantiate(context, state3, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "InstanceType") ? InstanceTypeInstantiate(context, state3, parameters[0], options) : guard_exports.IsEqual(action, "Interface") ? InterfaceInstantiate(context, state3, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "KeyOf") ? KeyOfInstantiate(context, state3, parameters[0], options) : guard_exports.IsEqual(action, "Lowercase") ? LowercaseInstantiate(context, state3, parameters[0], options) : guard_exports.IsEqual(action, "Mapped") ? MappedInstantiate(context, state3, parameters[0], parameters[1], parameters[2], parameters[3], options) : guard_exports.IsEqual(action, "Module") ? ModuleInstantiate(context, state3, parameters[0], options) : guard_exports.IsEqual(action, "NonNullable") ? NonNullableInstantiate(context, state3, parameters[0], options) : guard_exports.IsEqual(action, "Pick") ? PickInstantiate(context, state3, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Parameters") ? ParametersInstantiate(context, state3, parameters[0], options) : guard_exports.IsEqual(action, "Partial") ? PartialInstantiate(context, state3, parameters[0], options) : guard_exports.IsEqual(action, "Omit") ? OmitInstantiate(context, state3, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "ReadonlyObject") ? ReadonlyObjectInstantiate(context, state3, parameters[0], options) : guard_exports.IsEqual(action, "Record") ? RecordInstantiate(context, state3, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Required") ? RequiredInstantiate(context, state3, parameters[0], options) : guard_exports.IsEqual(action, "ReturnType") ? ReturnTypeInstantiate(context, state3, parameters[0], options) : guard_exports.IsEqual(action, "TemplateLiteral") ? TemplateLiteralInstantiate(context, state3, parameters[0], options) : guard_exports.IsEqual(action, "Uncapitalize") ? UncapitalizeInstantiate(context, state3, parameters[0], options) : guard_exports.IsEqual(action, "Uppercase") ? UppercaseInstantiate(context, state3, parameters[0], options) : guard_exports.IsEqual(action, "With") ? WithInstantiate(context, state3, parameters[0], parameters[1]) : Deferred(action, parameters, options)
    )
  );
}
function InstantiateImmediate(context, state3, type) {
  const instantiatedType = IsRef(type) ? RefInstantiate(context, state3, type, type.$ref) : IsArray2(type) ? _Array_(InstantiateType(context, state3, type.items), ArrayOptions(type)) : IsCall(type) ? CallInstantiate(context, state3, type.target, type.arguments) : IsConstructor2(type) ? Constructor(InstantiateTypes(context, state3, type.parameters), InstantiateType(context, state3, type.instanceType), ConstructorOptions(type)) : IsFunction2(type) ? _Function_(InstantiateTypes(context, state3, type.parameters), InstantiateType(context, state3, type.returnType), FunctionOptions(type)) : IsDependent(type) ? Dependent(InstantiateType(context, state3, type.if), InstantiateType(context, state3, type.then), InstantiateType(context, state3, type.else), DependentOptions(type)) : IsIntersect(type) ? Intersect(InstantiateTypes(context, state3, type.allOf), IntersectOptions(type)) : IsObject2(type) ? _Object_(InstantiateProperties(context, state3, type.properties), ObjectOptions(type)) : IsRecord(type) ? RecordFromPattern(RecordPattern(type), InstantiateType(context, state3, RecordValue(type))) : IsRest(type) ? Rest(InstantiateType(context, state3, type.items)) : IsTuple(type) ? Tuple(InstantiateElements(context, state3, type.items), TupleOptions(type)) : IsUnion(type) ? Union(InstantiateTypes(context, state3, type.anyOf), UnionOptions(type)) : type;
  const withModifiers = WithModifiers(type, instantiatedType);
  return withModifiers;
}
function InstantiateType(context, state3, type) {
  const result = IsDeferred(type) ? InstantiateDeferred(context, state3, type.action, type.parameters, type.options) : InstantiateImmediate(context, state3, type);
  return result;
}
function Instantiate(context, type) {
  return InstantiateType(context, State([], []), type);
}

// node_modules/typebox/build/type/engine/immutable/instantiate_add.mjs
function AddImmutableOperation(type) {
  return memory_exports.Update(type, { "~immutable": true }, {});
}
function AddImmutableAction(type, options) {
  const result = memory_exports.Update(AddImmutableOperation(type), {}, options);
  return result;
}
function AddImmutableInstantiate(context, state3, type, options) {
  const instantiatedType = InstantiateType(context, state3, type);
  return AddImmutableAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/_add_immutable.mjs
function AddImmutableDeferred(type, options = {}) {
  return Deferred("AddImmutable", [type], options);
}
function AddImmutable(type, options = {}) {
  return AddImmutableAction(type, options);
}

// node_modules/typebox/build/type/action/evaluate.mjs
function EvaluateDeferred(type, options = {}) {
  return Deferred("Evaluate", [type], options);
}
function Evaluate(type, options = {}) {
  return EvaluateAction(type, options);
}

// node_modules/typebox/build/type/action/module.mjs
function ModuleDeferred(declarations, options = {}) {
  return Deferred("Module", [declarations], options);
}
function Module2(declarations, options = {}) {
  return ModuleInstantiate({}, State([], []), declarations, options);
}

// node_modules/typebox/build/type/engine/priority/priority.mjs
function Comparer(left, right) {
  const compareResult = Compare(left, right);
  const result = guard_exports.IsEqual(compareResult, "right-inside") ? 1 : guard_exports.IsEqual(compareResult, "disjoint") ? 1 : 0;
  return result;
}
function Insert(type, types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => guard_exports.IsEqual(Comparer(type, left), 1) ? Insert(type, right, [...result, left]) : [...result, type, ...types], () => [...result, type]);
}
function Sort(types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => Sort(right, Insert(left, result)), () => result);
}
function Priority(types) {
  const result = Sort(types);
  return result;
}

// node_modules/typebox/build/type/script/script.mjs
function Script2(...args) {
  const [context, input, options] = arguments_exports.Match(args, {
    2: (script, options2) => guard_exports.IsString(script) ? [{}, script, options2] : [script, options2, {}],
    3: (context2, script, options2) => [context2, script, options2],
    1: (script) => [{}, script, {}]
  });
  const result = Script(input);
  const parsed = guard_exports.IsArray(result) && guard_exports.IsEqual(result.length, 2) ? InstantiateType(context, State([], []), result[0]) : Never();
  return memory_exports.Update(parsed, {}, options);
}

// node_modules/typebox/build/typebox.mjs
var typebox_exports = {};
__export(typebox_exports, {
  Any: () => Any,
  Array: () => _Array_,
  BigInt: () => BigInt2,
  Boolean: () => Boolean2,
  Call: () => Call,
  Capitalize: () => Capitalize,
  Codec: () => Codec,
  Conditional: () => Conditional,
  Constructor: () => Constructor,
  ConstructorParameters: () => ConstructorParameters,
  Cyclic: () => Cyclic,
  Decode: () => Decode,
  DecodeBuilder: () => DecodeBuilder,
  Dependent: () => Dependent,
  Encode: () => Encode,
  EncodeBuilder: () => EncodeBuilder,
  Enum: () => Enum,
  Evaluate: () => Evaluate,
  Exclude: () => Exclude,
  Extends: () => Extends,
  ExtendsResult: () => result_exports,
  Extract: () => Extract,
  Function: () => _Function_,
  Generic: () => Generic,
  Identifier: () => Identifier,
  Immutable: () => Immutable,
  Index: () => Index,
  Infer: () => Infer,
  InstanceType: () => InstanceType,
  Instantiate: () => Instantiate,
  Integer: () => Integer,
  Interface: () => Interface,
  Intersect: () => Intersect,
  IsAny: () => IsAny,
  IsArray: () => IsArray2,
  IsBigInt: () => IsBigInt2,
  IsBoolean: () => IsBoolean3,
  IsCall: () => IsCall,
  IsCodec: () => IsCodec,
  IsConstructor: () => IsConstructor2,
  IsCyclic: () => IsCyclic,
  IsDependent: () => IsDependent,
  IsEnum: () => IsEnum,
  IsEnumValue: () => IsEnumValue,
  IsFunction: () => IsFunction2,
  IsGeneric: () => IsGeneric,
  IsIdentifier: () => IsIdentifier,
  IsImmutable: () => IsImmutable,
  IsInfer: () => IsInfer,
  IsInteger: () => IsInteger2,
  IsIntersect: () => IsIntersect,
  IsKind: () => IsKind,
  IsLiteral: () => IsLiteral,
  IsNever: () => IsNever,
  IsNull: () => IsNull2,
  IsNumber: () => IsNumber3,
  IsObject: () => IsObject2,
  IsOptional: () => IsOptional,
  IsParameter: () => IsParameter,
  IsReadonly: () => IsReadonly,
  IsRecord: () => IsRecord,
  IsRef: () => IsRef,
  IsRefine: () => IsRefine,
  IsRest: () => IsRest,
  IsSchema: () => IsSchema,
  IsString: () => IsString3,
  IsSymbol: () => IsSymbol2,
  IsTemplateLiteral: () => IsTemplateLiteral,
  IsThis: () => IsThis,
  IsTuple: () => IsTuple,
  IsUndefined: () => IsUndefined2,
  IsUnion: () => IsUnion,
  IsUnknown: () => IsUnknown,
  IsUnsafe: () => IsUnsafe,
  IsVoid: () => IsVoid,
  KeyOf: () => KeyOf2,
  Literal: () => Literal,
  Lowercase: () => Lowercase,
  Mapped: () => Mapped,
  Module: () => Module2,
  Never: () => Never,
  NonNullable: () => NonNullable,
  Null: () => Null,
  Number: () => Number2,
  Object: () => _Object_,
  Omit: () => Omit,
  Optional: () => Optional,
  Parameter: () => Parameter,
  Parameters: () => Parameters,
  Partial: () => Partial,
  Pick: () => Pick,
  Readonly: () => Readonly,
  ReadonlyObject: () => ReadonlyObject,
  ReadonlyType: () => ReadonlyType,
  Record: () => Record,
  RecordKey: () => RecordKey,
  RecordPattern: () => RecordPattern,
  RecordValue: () => RecordValue,
  Ref: () => Ref,
  Refine: () => Refine,
  Required: () => Required,
  Rest: () => Rest,
  ReturnType: () => ReturnType,
  Script: () => Script2,
  String: () => String2,
  Symbol: () => Symbol2,
  TemplateLiteral: () => TemplateLiteral2,
  This: () => This,
  Tuple: () => Tuple,
  Uncapitalize: () => Uncapitalize,
  Undefined: () => Undefined,
  Union: () => Union,
  Unknown: () => Unknown,
  Unsafe: () => Unsafe,
  Uppercase: () => Uppercase,
  Void: () => Void,
  With: () => With2
});

// packages/shared/src/causality.ts
var CAUSALITY_SCHEMA_VERSION = 1;
var SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
var CausalEnvelopeSchema = typebox_exports.Object(
  {
    schemaVersion: typebox_exports.Literal(CAUSALITY_SCHEMA_VERSION),
    eventId: typebox_exports.String({ minLength: 1, maxLength: 128, pattern: SAFE_ID.source }),
    causationId: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 128, pattern: SAFE_ID.source })),
    runAttemptId: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 128, pattern: SAFE_ID.source }))
  },
  { additionalProperties: false }
);

// packages/shared/src/research-status.ts
var RESEARCH_EVIDENCE_STATES = Object.freeze([
  "observed",
  "reproduced",
  "verified",
  "partial",
  "stale",
  "unsupported",
  "unknown",
  "blocked"
]);
var RESEARCH_CLAIM_STATES = Object.freeze([
  "supported",
  "mixed",
  "inferred",
  "hypothesis",
  "unsupported"
]);
var RESEARCH_CAPABILITY_STATES = Object.freeze([
  "candidate",
  "recommended",
  "registered",
  "enabled",
  "retired"
]);
var RESEARCH_REUSE_LEVELS = Object.freeze([
  "navigation-only",
  "evidence-eligible",
  "validated-capability",
  "reproduced-capability"
]);
var RESEARCH_VALIDATION_SCOPES = Object.freeze([
  "fixture",
  "integration",
  "real-data",
  "scientific-review"
]);
var RESEARCH_FRESHNESS_STATES = Object.freeze(["fresh", "stale", "unknown"]);

// packages/shared/src/research-skill-sources.json
var research_skill_sources_default = {
  schemaVersion: 1,
  sources: [
    {
      id: "nature",
      repository: "Yuan1z0825/nature-skills",
      commit: "2375e0abdf42158ef149256f2c64b1f759a0d274",
      archiveSha256: "d5017c0e6415275306f3b1774a70ffc88a865969adc10816eb8e9a795464b363",
      license: "Apache-2.0",
      licenseFiles: ["LICENSE"],
      skills: [
        {
          name: "nature-academic-search",
          path: "skills/nature-academic-search/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-citation",
          path: "skills/nature-citation/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-data",
          path: "skills/nature-data/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-downloader",
          path: "skills/nature-downloader/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-experiment-log",
          path: "skills/nature-experiment-log/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "nature-figure",
          path: "skills/nature-figure/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-image2ppt",
          path: "skills/nature-image2ppt/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-literature-pipeline",
          path: "skills/nature-literature-pipeline/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "nature-paper-card",
          path: "skills/nature-paper-card/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-paper-to-patent",
          path: "skills/nature-paper-to-patent/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-paper2ppt",
          path: "skills/nature-paper2ppt/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-polishing",
          path: "skills/nature-polishing/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "researchwrite",
          path: "skills/nature-proposal-writer/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "nature-reader",
          path: "skills/nature-reader/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-ref-verifier",
          path: "skills/nature-ref-verifier/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-response",
          path: "skills/nature-response/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-reviewer",
          path: "skills/nature-reviewer/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-shared",
          path: "skills/nature-shared/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-statistics",
          path: "skills/nature-statistics/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-writing",
          path: "skills/nature-writing/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        }
      ],
      runtimeFiles: []
    },
    {
      id: "scientific",
      repository: "K-Dense-AI/scientific-agent-skills",
      commit: "330c8e764435a731eff571e3efdda70b363d0792",
      archiveSha256: "559c0a1c32666e08854e0276399cdb961d5ab5faf31183b2dc94382ee38c90f3",
      license: "MIT",
      licenseFiles: ["LICENSE.md"],
      skills: [
        {
          name: "adaptyv",
          path: "skills/adaptyv/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "aeon",
          path: "skills/aeon/SKILL.md",
          license: "BSD-3-Clause license",
          bundled: true
        },
        {
          name: "alphagenome",
          path: "skills/alphagenome/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "analytical-method-validation",
          path: "skills/analytical-method-validation/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "anndata",
          path: "skills/anndata/SKILL.md",
          license: "BSD-3-Clause license",
          bundled: true
        },
        {
          name: "arbor",
          path: "skills/arbor/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "arboreto",
          path: "skills/arboreto/SKILL.md",
          license: "BSD-3-Clause license",
          bundled: true
        },
        {
          name: "astropy",
          path: "skills/astropy/SKILL.md",
          license: "BSD-3-Clause license",
          bundled: true
        },
        {
          name: "autoskill",
          path: "skills/autoskill/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "benchling-integration",
          path: "skills/benchling-integration/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "bgpt-paper-search",
          path: "skills/bgpt-paper-search/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "bids",
          path: "skills/bids/SKILL.md",
          license: "https://creativecommons.org/licenses/by/4.0/",
          bundled: true
        },
        {
          name: "biopython",
          path: "skills/biopython/SKILL.md",
          license: "Biopython License Agreement",
          bundled: false
        },
        {
          name: "bioservices",
          path: "skills/bioservices/SKILL.md",
          license: "GPLv3 license",
          bundled: false
        },
        {
          name: "bulk-rnaseq",
          path: "skills/bulk-rnaseq/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "cellxgene-census",
          path: "skills/cellxgene-census/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "cirq",
          path: "skills/cirq/SKILL.md",
          license: "Apache-2.0 license",
          bundled: true
        },
        {
          name: "citation-management",
          path: "skills/citation-management/SKILL.md",
          license: "MIT License",
          bundled: true
        },
        {
          name: "clinical-decision-support",
          path: "skills/clinical-decision-support/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "clinical-reports",
          path: "skills/clinical-reports/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "cobrapy",
          path: "skills/cobrapy/SKILL.md",
          license: "GPL-2.0 license",
          bundled: false
        },
        {
          name: "consciousness-council",
          path: "skills/consciousness-council/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "dask",
          path: "skills/dask/SKILL.md",
          license: "BSD-3-Clause license",
          bundled: true
        },
        {
          name: "database-lookup",
          path: "skills/database-lookup/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "datalad",
          path: "skills/datalad/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "datamol",
          path: "skills/datamol/SKILL.md",
          license: "Apache-2.0 license",
          bundled: true
        },
        {
          name: "deepchem",
          path: "skills/deepchem/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "deepspot-m",
          path: "skills/deepspot-m/SKILL.md",
          license: "PolyForm-Noncommercial-1.0.0",
          bundled: false
        },
        {
          name: "deeptools",
          path: "skills/deeptools/SKILL.md",
          license: "BSD license",
          bundled: true
        },
        {
          name: "depmap",
          path: "skills/depmap/SKILL.md",
          license: "CC-BY-4.0",
          bundled: true
        },
        {
          name: "dhdna-profiler",
          path: "skills/dhdna-profiler/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "diffdock",
          path: "skills/diffdock/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "dnanexus-integration",
          path: "skills/dnanexus-integration/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "docx",
          path: "skills/docx/SKILL.md",
          license: "Proprietary. LICENSE.txt has complete terms",
          bundled: false
        },
        {
          name: "esm",
          path: "skills/esm/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "etetoolkit",
          path: "skills/etetoolkit/SKILL.md",
          license: "GPL-3.0-or-later",
          bundled: false
        },
        {
          name: "exa-search",
          path: "skills/exa-search/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "experimental-design",
          path: "skills/experimental-design/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "exploratory-data-analysis",
          path: "skills/exploratory-data-analysis/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "flowio",
          path: "skills/flowio/SKILL.md",
          license: "BSD-3-Clause license",
          bundled: true
        },
        {
          name: "fluidsim",
          path: "skills/fluidsim/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "folklore-variant-evidence",
          path: "skills/folklore-variant-evidence/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "generate-image",
          path: "skills/generate-image/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "geniml",
          path: "skills/geniml/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "genomic-coordinates",
          path: "skills/genomic-coordinates/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "genomic-intelligence",
          path: "skills/genomic-intelligence/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "geomaster",
          path: "skills/geomaster/SKILL.md",
          license: "MIT License",
          bundled: true
        },
        {
          name: "geopandas",
          path: "skills/geopandas/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "get-available-resources",
          path: "skills/get-available-resources/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "gget",
          path: "skills/gget/SKILL.md",
          license: "BSD-2-Clause license",
          bundled: true
        },
        {
          name: "ginkgo-cloud-lab",
          path: "skills/ginkgo-cloud-lab/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "glycoengineering",
          path: "skills/glycoengineering/SKILL.md",
          license: "Unknown",
          bundled: false
        },
        {
          name: "gtars",
          path: "skills/gtars/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "histolab",
          path: "skills/histolab/SKILL.md",
          license: "Apache-2.0 license",
          bundled: true
        },
        {
          name: "hugging-science",
          path: "skills/hugging-science/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "hypogenic",
          path: "skills/hypogenic/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "hypothesis-generation",
          path: "skills/hypothesis-generation/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "imaging-data-commons",
          path: "skills/imaging-data-commons/SKILL.md",
          license: "This skill is provided under the MIT License. IDC data itself has individual licensing (mostly CC-BY, some CC-NC) that must be respected when using the data.",
          bundled: false
        },
        {
          name: "infographics",
          path: "skills/infographics/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "iso-standards-readiness",
          path: "skills/iso-standards-readiness/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "lab-hardware-cad",
          path: "skills/lab-hardware-cad/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "labarchive-integration",
          path: "skills/labarchive-integration/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "lamindb",
          path: "skills/lamindb/SKILL.md",
          license: "Apache-2.0 license",
          bundled: true
        },
        {
          name: "latchbio-integration",
          path: "skills/latchbio-integration/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "latex-posters",
          path: "skills/latex-posters/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "liteparse",
          path: "skills/liteparse/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "literature-review",
          path: "skills/literature-review/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "markdown-mermaid-writing",
          path: "skills/markdown-mermaid-writing/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "market-research-reports",
          path: "skills/market-research-reports/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "markitdown",
          path: "skills/markitdown/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "matchms",
          path: "skills/matchms/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "matlab",
          path: "skills/matlab/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "matplotlib",
          path: "skills/matplotlib/SKILL.md",
          license: "https://github.com/matplotlib/matplotlib/tree/main/LICENSE",
          bundled: false
        },
        {
          name: "medchem",
          path: "skills/medchem/SKILL.md",
          license: "Apache-2.0 license",
          bundled: true
        },
        {
          name: "modal",
          path: "skills/modal/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "molecular-dynamics",
          path: "skills/molecular-dynamics/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "molfeat",
          path: "skills/molfeat/SKILL.md",
          license: "Apache-2.0 license",
          bundled: true
        },
        {
          name: "ncats-arax",
          path: "skills/ncats-arax/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "networkx",
          path: "skills/networkx/SKILL.md",
          license: "3-clause BSD license",
          bundled: true
        },
        {
          name: "neurokit2",
          path: "skills/neurokit2/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "neuropixels-analysis",
          path: "skills/neuropixels-analysis/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "nextflow",
          path: "skills/nextflow/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "omero-integration",
          path: "skills/omero-integration/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "onekgpd",
          path: "skills/onekgpd/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "ontology-term-resolution",
          path: "skills/ontology-term-resolution/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "open-notebook",
          path: "skills/open-notebook/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "openpiv",
          path: "skills/openpiv/SKILL.md",
          license: "BSD-3-Clause",
          bundled: true
        },
        {
          name: "opentrons-integration",
          path: "skills/opentrons-integration/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "optimize-for-gpu",
          path: "skills/optimize-for-gpu/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pacsomatic",
          path: "skills/pacsomatic/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "paper-lookup",
          path: "skills/paper-lookup/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "paperclip",
          path: "skills/paperclip/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "paperzilla",
          path: "skills/paperzilla/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "parallel-web",
          path: "skills/parallel-web/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pathml",
          path: "skills/pathml/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pathogen-variant-surveillance",
          path: "skills/pathogen-variant-surveillance/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pathway-enrichment",
          path: "skills/pathway-enrichment/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pdf",
          path: "skills/pdf/SKILL.md",
          license: "Proprietary. LICENSE.txt has complete terms",
          bundled: false
        },
        {
          name: "peer-review",
          path: "skills/peer-review/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pennylane",
          path: "skills/pennylane/SKILL.md",
          license: "Apache-2.0 license",
          bundled: true
        },
        {
          name: "phylogenetics",
          path: "skills/phylogenetics/SKILL.md",
          license: "Unknown",
          bundled: false
        },
        {
          name: "pi-agent",
          path: "skills/pi-agent/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pkpd-modeling",
          path: "skills/pkpd-modeling/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "polars",
          path: "skills/polars/SKILL.md",
          license: "https://github.com/pola-rs/polars/blob/main/LICENSE",
          bundled: false
        },
        {
          name: "polars-bio",
          path: "skills/polars-bio/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "pptx",
          path: "skills/pptx/SKILL.md",
          license: "Proprietary. LICENSE.txt has complete terms",
          bundled: false
        },
        {
          name: "pptx-posters",
          path: "skills/pptx-posters/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "primekg",
          path: "skills/primekg/SKILL.md",
          license: "Unknown",
          bundled: false
        },
        {
          name: "protocolsio-integration",
          path: "skills/protocolsio-integration/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pufferlib",
          path: "skills/pufferlib/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pydeseq2",
          path: "skills/pydeseq2/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "pydicom",
          path: "skills/pydicom/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pyhealth",
          path: "skills/pyhealth/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pylabrobot",
          path: "skills/pylabrobot/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pymatgen",
          path: "skills/pymatgen/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pymc",
          path: "skills/pymc/SKILL.md",
          license: "Apache License, Version 2.0",
          bundled: true
        },
        {
          name: "pymoo",
          path: "skills/pymoo/SKILL.md",
          license: "Apache-2.0 license",
          bundled: true
        },
        {
          name: "pyopenms",
          path: "skills/pyopenms/SKILL.md",
          license: "3 clause BSD license",
          bundled: true
        },
        {
          name: "pysam",
          path: "skills/pysam/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pytdc",
          path: "skills/pytdc/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pytorch-lightning",
          path: "skills/pytorch-lightning/SKILL.md",
          license: "Apache-2.0 license",
          bundled: true
        },
        {
          name: "pyzotero",
          path: "skills/pyzotero/SKILL.md",
          license: "MIT License",
          bundled: true
        },
        {
          name: "qiskit",
          path: "skills/qiskit/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "qutip",
          path: "skills/qutip/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "rdkit",
          path: "skills/rdkit/SKILL.md",
          license: "BSD-3-Clause license",
          bundled: true
        },
        {
          name: "relsa-severity-assessment",
          path: "skills/relsa-severity-assessment/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "research-grants",
          path: "skills/research-grants/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "research-lookup",
          path: "skills/research-lookup/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "rowan",
          path: "skills/rowan/SKILL.md",
          license: "Proprietary (API key required)",
          bundled: false
        },
        {
          name: "scanpy",
          path: "skills/scanpy/SKILL.md",
          license: "BSD-3-Clause",
          bundled: true
        },
        {
          name: "scholar-evaluation",
          path: "skills/scholar-evaluation/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "scientific-brainstorming",
          path: "skills/scientific-brainstorming/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "scientific-critical-thinking",
          path: "skills/scientific-critical-thinking/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "scientific-schematics",
          path: "skills/scientific-schematics/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "scientific-slides",
          path: "skills/scientific-slides/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "scientific-visualization",
          path: "skills/scientific-visualization/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "scientific-writing",
          path: "skills/scientific-writing/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "scikit-bio",
          path: "skills/scikit-bio/SKILL.md",
          license: "BSD-3-Clause license",
          bundled: true
        },
        {
          name: "scikit-learn",
          path: "skills/scikit-learn/SKILL.md",
          license: "BSD-3-Clause license",
          bundled: true
        },
        {
          name: "scikit-survival",
          path: "skills/scikit-survival/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "scvelo",
          path: "skills/scvelo/SKILL.md",
          license: "BSD-3-Clause",
          bundled: true
        },
        {
          name: "scvi-tools",
          path: "skills/scvi-tools/SKILL.md",
          license: "BSD-3-Clause license",
          bundled: true
        },
        {
          name: "seaborn",
          path: "skills/seaborn/SKILL.md",
          license: "BSD-3-Clause license",
          bundled: true
        },
        {
          name: "shap",
          path: "skills/shap/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "simpy",
          path: "skills/simpy/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "stable-baselines3",
          path: "skills/stable-baselines3/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "statistical-analysis",
          path: "skills/statistical-analysis/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "statistical-power",
          path: "skills/statistical-power/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "statsmodels",
          path: "skills/statsmodels/SKILL.md",
          license: "BSD-3-Clause license",
          bundled: true
        },
        {
          name: "sympy",
          path: "skills/sympy/SKILL.md",
          license: "https://github.com/sympy/sympy/blob/master/LICENSE",
          bundled: false
        },
        {
          name: "tamarind",
          path: "skills/tamarind/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "tiledbvcf",
          path: "skills/tiledbvcf/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "timesfm-forecasting",
          path: "skills/timesfm-forecasting/SKILL.md",
          license: "Apache-2.0 license",
          bundled: true
        },
        {
          name: "torch-geometric",
          path: "skills/torch-geometric/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "torchdrug",
          path: "skills/torchdrug/SKILL.md",
          license: "Apache-2.0 license",
          bundled: true
        },
        {
          name: "transformers",
          path: "skills/transformers/SKILL.md",
          license: "Apache-2.0 license",
          bundled: true
        },
        {
          name: "treatment-plans",
          path: "skills/treatment-plans/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "umap-learn",
          path: "skills/umap-learn/SKILL.md",
          license: "BSD-3-Clause license",
          bundled: true
        },
        {
          name: "uncertainty-and-units",
          path: "skills/uncertainty-and-units/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "usfiscaldata",
          path: "skills/usfiscaldata/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "vaex",
          path: "skills/vaex/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "venue-templates",
          path: "skills/venue-templates/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "waypoint-bio",
          path: "skills/waypoint-bio/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "what-if-oracle",
          path: "skills/what-if-oracle/SKILL.md",
          license: "CC BY-NC-SA 4.0",
          bundled: false
        },
        {
          name: "xlsx",
          path: "skills/xlsx/SKILL.md",
          license: "Proprietary. LICENSE.txt has complete terms",
          bundled: false
        },
        {
          name: "zarr-python",
          path: "skills/zarr-python/SKILL.md",
          license: "MIT license",
          bundled: true
        }
      ],
      runtimeFiles: []
    },
    {
      id: "academic",
      repository: "Imbad0202/academic-research-skills",
      commit: "3c546bc08c56f79e0068f1ea4f0acedf5bf69b5e",
      archiveSha256: "98aa80d4d160c6e92d7b73d902998ffcb8599b8ab89f0b6727ae738584838217",
      license: "CC-BY-NC-4.0",
      licenseFiles: ["LICENSE", "NOTICE.md"],
      skills: [
        {
          name: "academic-paper",
          path: "academic-paper/SKILL.md",
          license: "CC-BY-NC-4.0",
          bundled: true
        },
        {
          name: "academic-paper-reviewer",
          path: "academic-paper-reviewer/SKILL.md",
          license: "CC-BY-NC-4.0",
          bundled: true
        },
        {
          name: "academic-pipeline",
          path: "academic-pipeline/SKILL.md",
          license: "CC-BY-NC-4.0",
          bundled: true
        },
        {
          name: "deep-research",
          path: "deep-research/SKILL.md",
          license: "CC-BY-NC-4.0",
          bundled: true
        }
      ],
      runtimeFiles: [
        {
          path: "MODE_REGISTRY.md",
          sha256: "fe3974f9cd139801c935f9dffb0031e73901f3548cb3c887f1a15a1001a1eb5d"
        },
        {
          path: "commands/ars-3w.md",
          sha256: "2db86727d54541ef4ea605805018b6c68ee2aa497cfdc2844dff3015d6e23b94"
        },
        {
          path: "commands/ars-abstract.md",
          sha256: "c2040a286ac382001a61ea81c7f6fb165716320406ec31379ce1f1eda5cc2104"
        },
        {
          path: "commands/ars-cache-invalidate.md",
          sha256: "60c6dc0d42eaf881d52e781dc1528904438b9a6ab23a5f0d8f56d426f311933e"
        },
        {
          path: "commands/ars-citation-check.md",
          sha256: "5834a3cf8ca5caae07ec85dbbe833ca09930e64b2eb60adaeabadbbe8bef6435"
        },
        {
          path: "commands/ars-disclosure.md",
          sha256: "5108d232b745ba085e45f94ca85f468abdf4bc8370180634c7bfc7fd9cb8fdfb"
        },
        {
          path: "commands/ars-format-convert.md",
          sha256: "49364fcd2a0a5b96ed3e979931b6db73f18ca0667d79268ef5c33b60f16e4b5c"
        },
        {
          path: "commands/ars-full.md",
          sha256: "b310bb23b83fc7b11460068b22fd5d56b28d8c151f524956fb5f5feee15e2606"
        },
        {
          path: "commands/ars-lit-review.md",
          sha256: "08cacaa17125aa386774683ad2bc8c360c003ab1323dfc931941f7f16768dbc8"
        },
        {
          path: "commands/ars-mark-read.md",
          sha256: "1272790ecd5a34835fc90584b48b6aa06985fb609410f191c1b55c9ad4259de1"
        },
        {
          path: "commands/ars-outline.md",
          sha256: "f1c993aa598ef67337109c8367c800d43cbcae760c0bdc2fe7c5bb469e395a05"
        },
        {
          path: "commands/ars-plan.md",
          sha256: "c231143a84bbe086091f5fcd94b1f3117fd91a00fa2e8c19707f386be49909b1"
        },
        {
          path: "commands/ars-rebuttal-audit.md",
          sha256: "4b48c4cd799417fe5d5cd62f55fc87050a562d47d5a7084ee6446454f0908ba4"
        },
        {
          path: "commands/ars-reviewer.md",
          sha256: "c8316335cfa054962afc6dd87a6a45036d0c07efe8c1d1911f013498d036c17b"
        },
        {
          path: "commands/ars-revision-coach.md",
          sha256: "975591bf5e9fd1d4a697798844c6d1604a6f1d5220da24b090b3d895c8125745"
        },
        {
          path: "commands/ars-revision.md",
          sha256: "7135f32bca5cc125539de4d8170ea673d2bb73cdccd9272d2d72f514b5290fb0"
        },
        {
          path: "commands/ars-unmark-read.md",
          sha256: "4ce45672f07da9d48bb3350b273523e1b0e9cb021ddf1849ca1b7d8cc8d896ca"
        },
        {
          path: "package.json",
          sha256: "5497d262a2af42e25d0e31ab65f115735c2b85c6c256576494cafda760165550"
        },
        {
          path: "pi/package.json",
          sha256: "a4fceb32c55830f4cbd0116482414707de4a37067036bfa8243321186f06687a"
        },
        {
          path: "pi/wrapper.js",
          sha256: "4ec8a6884f87b55d2e201dbe93aaaabc0ba33a46ef9ae0677b212c53fcc9ce2a"
        }
      ]
    }
  ]
};

// packages/shared/src/workflow-profiles.json
var workflow_profiles_default = [
  {
    name: "nature-academic-search",
    direction: "evidence",
    subdomain: "\u8BC1\u636E\u68C0\u7D22\u4E0E\u7EFC\u8FF0",
    source: "nature"
  },
  {
    name: "nature-citation",
    direction: "evidence",
    subdomain: "\u5F15\u6587\u4E0E\u8BBA\u636E\u6838\u9A8C",
    source: "nature"
  },
  {
    name: "nature-data",
    direction: "writing",
    subdomain: "\u62A5\u544A\u89C4\u8303\u3001\u7EDF\u8BA1\u5448\u73B0\u4E0E\u6570\u636E\u58F0\u660E",
    source: "nature"
  },
  {
    name: "nature-downloader",
    direction: "evidence",
    subdomain: "\u83B7\u53D6\u3001\u9605\u8BFB\u4E0E\u8BBA\u6587\u5361",
    source: "nature"
  },
  {
    name: "nature-experiment-log",
    direction: "evidence",
    subdomain: "\u8BA2\u9605\u4E0E\u5B9E\u9A8C\u65E5\u5FD7",
    source: "nature"
  },
  {
    name: "nature-figure",
    direction: "presentation",
    subdomain: "\u6570\u636E\u56FE\u8868",
    source: "nature"
  },
  {
    name: "nature-image2ppt",
    direction: "presentation",
    subdomain: "\u5E7B\u706F\u7247\u4E0E\u6D77\u62A5",
    source: "nature"
  },
  {
    name: "nature-literature-pipeline",
    direction: "evidence",
    subdomain: "\u8BA2\u9605\u4E0E\u5B9E\u9A8C\u65E5\u5FD7",
    source: "nature"
  },
  {
    name: "nature-paper-card",
    direction: "evidence",
    subdomain: "\u83B7\u53D6\u3001\u9605\u8BFB\u4E0E\u8BBA\u6587\u5361",
    source: "nature"
  },
  {
    name: "nature-paper-to-patent",
    direction: "writing",
    subdomain: "\u4E13\u5229\u4E0E\u4E13\u4E1A\u62A5\u544A\uFF08\u53D7\u9650\u5206\u652F\uFF09",
    source: "nature"
  },
  {
    name: "nature-paper2ppt",
    direction: "presentation",
    subdomain: "\u5E7B\u706F\u7247\u4E0E\u6D77\u62A5",
    source: "nature"
  },
  {
    name: "nature-polishing",
    direction: "writing",
    subdomain: "\u6B63\u6587\u4E0E\u8BED\u8A00\u7F16\u8F91",
    source: "nature"
  },
  {
    name: "researchwrite",
    direction: "planning",
    subdomain: "\u9879\u76EE\u7533\u8BF7\u4E0E\u7814\u7A76\u8BA1\u5212",
    source: "nature"
  },
  {
    name: "nature-reader",
    direction: "evidence",
    subdomain: "\u83B7\u53D6\u3001\u9605\u8BFB\u4E0E\u8BBA\u6587\u5361",
    source: "nature"
  },
  {
    name: "nature-ref-verifier",
    direction: "evidence",
    subdomain: "\u5F15\u6587\u4E0E\u8BBA\u636E\u6838\u9A8C",
    source: "nature"
  },
  {
    name: "nature-response",
    direction: "writing",
    subdomain: "\u5BA1\u7A3F\u3001\u56DE\u590D\u4E0E\u8BC4\u4EF7",
    source: "nature"
  },
  {
    name: "nature-reviewer",
    direction: "writing",
    subdomain: "\u5BA1\u7A3F\u3001\u56DE\u590D\u4E0E\u8BC4\u4EF7",
    source: "nature"
  },
  {
    name: "nature-shared",
    direction: "internal",
    subdomain: "\u8BC1\u636E\u4E0E\u4EFB\u52A1\u63A7\u5236/\u5171\u4EAB\u8D44\u6E90",
    source: "nature"
  },
  {
    name: "nature-statistics",
    direction: "writing",
    subdomain: "\u62A5\u544A\u89C4\u8303\u3001\u7EDF\u8BA1\u5448\u73B0\u4E0E\u6570\u636E\u58F0\u660E",
    source: "nature"
  },
  {
    name: "nature-writing",
    direction: "writing",
    subdomain: "\u6B63\u6587\u4E0E\u8BED\u8A00\u7F16\u8F91",
    source: "nature"
  },
  {
    name: "adaptyv",
    direction: "engineering",
    subdomain: "\u5B9E\u9A8C\u5E73\u53F0\u3001\u8BB0\u5F55\u7CFB\u7EDF\u4E0E\u8BBE\u5907",
    source: "scientific"
  },
  {
    name: "aeon",
    direction: "analysis",
    subdomain: "\u673A\u5668\u5B66\u4E60\u3001\u65F6\u95F4\u5E8F\u5217\u4E0E\u89E3\u91CA",
    source: "scientific"
  },
  {
    name: "alphagenome",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "analytical-method-validation",
    direction: "planning",
    subdomain: "\u65B9\u6CD5\u9A8C\u8BC1\u4E0E\u5408\u89C4\u51C6\u5907",
    source: "scientific"
  },
  {
    name: "anndata",
    direction: "analysis",
    subdomain: "\u8F6C\u5F55\u7EC4\u4E0E\u5355\u7EC6\u80DE",
    source: "scientific"
  },
  {
    name: "arbor",
    direction: "engineering",
    subdomain: "\u81EA\u52A8\u4F18\u5316\u4E0E\u6280\u80FD\u63D0\u6848\uFF08\u663E\u5F0F\u6388\u6743\uFF09",
    source: "scientific"
  },
  {
    name: "arboreto",
    direction: "analysis",
    subdomain: "\u8F6C\u5F55\u7EC4\u4E0E\u5355\u7EC6\u80DE",
    source: "scientific"
  },
  {
    name: "astropy",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "autoskill",
    direction: "engineering",
    subdomain: "\u81EA\u52A8\u4F18\u5316\u4E0E\u6280\u80FD\u63D0\u6848\uFF08\u663E\u5F0F\u6388\u6743\uFF09",
    source: "scientific"
  },
  {
    name: "benchling-integration",
    direction: "engineering",
    subdomain: "\u5B9E\u9A8C\u5E73\u53F0\u3001\u8BB0\u5F55\u7CFB\u7EDF\u4E0E\u8BBE\u5907",
    source: "scientific"
  },
  {
    name: "bgpt-paper-search",
    direction: "evidence",
    subdomain: "\u68C0\u7D22\u670D\u52A1\u9002\u914D",
    source: "scientific"
  },
  {
    name: "bids",
    direction: "analysis",
    subdomain: "\u5F71\u50CF\u3001\u751F\u7406\u4E0E\u533B\u5B66\u7814\u7A76",
    source: "scientific"
  },
  {
    name: "biopython",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "bioservices",
    direction: "evidence",
    subdomain: "\u4E13\u4E1A\u6570\u636E\u5E93\u4E0E\u6807\u8BC6",
    source: "scientific"
  },
  {
    name: "bulk-rnaseq",
    direction: "analysis",
    subdomain: "\u8F6C\u5F55\u7EC4\u4E0E\u5355\u7EC6\u80DE",
    source: "scientific"
  },
  {
    name: "cellxgene-census",
    direction: "analysis",
    subdomain: "\u8F6C\u5F55\u7EC4\u4E0E\u5355\u7EC6\u80DE",
    source: "scientific"
  },
  {
    name: "cirq",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "citation-management",
    direction: "evidence",
    subdomain: "\u5F15\u6587\u4E0E\u8BBA\u636E\u6838\u9A8C",
    source: "scientific"
  },
  {
    name: "clinical-decision-support",
    direction: "writing",
    subdomain: "\u4E13\u5229\u4E0E\u4E13\u4E1A\u62A5\u544A\uFF08\u53D7\u9650\u5206\u652F\uFF09",
    source: "scientific"
  },
  {
    name: "clinical-reports",
    direction: "writing",
    subdomain: "\u4E13\u5229\u4E0E\u4E13\u4E1A\u62A5\u544A\uFF08\u53D7\u9650\u5206\u652F\uFF09",
    source: "scientific"
  },
  {
    name: "cobrapy",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "consciousness-council",
    direction: "planning",
    subdomain: "\u63A2\u7D22\u6027\u63A8\u6F14\uFF08\u975E\u6838\u5FC3\uFF09",
    source: "scientific"
  },
  {
    name: "dask",
    direction: "analysis",
    subdomain: "\u6570\u636E\u6574\u7406\u3001\u5B58\u50A8\u4E0E\u6EAF\u6E90",
    source: "scientific"
  },
  {
    name: "database-lookup",
    direction: "evidence",
    subdomain: "\u4E13\u4E1A\u6570\u636E\u5E93\u4E0E\u6807\u8BC6",
    source: "scientific"
  },
  {
    name: "datalad",
    direction: "analysis",
    subdomain: "\u6570\u636E\u6574\u7406\u3001\u5B58\u50A8\u4E0E\u6EAF\u6E90",
    source: "scientific"
  },
  {
    name: "datamol",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "deepchem",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "deepspot-m",
    direction: "analysis",
    subdomain: "\u5F71\u50CF\u3001\u751F\u7406\u4E0E\u533B\u5B66\u7814\u7A76",
    source: "scientific"
  },
  {
    name: "deeptools",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "depmap",
    direction: "evidence",
    subdomain: "\u4E13\u4E1A\u6570\u636E\u5E93\u4E0E\u6807\u8BC6",
    source: "scientific"
  },
  {
    name: "dhdna-profiler",
    direction: "planning",
    subdomain: "\u63A2\u7D22\u6027\u63A8\u6F14\uFF08\u975E\u6838\u5FC3\uFF09",
    source: "scientific"
  },
  {
    name: "diffdock",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "dnanexus-integration",
    direction: "engineering",
    subdomain: "\u7B97\u529B\u3001\u4E91\u5E73\u53F0\u4E0E\u7BA1\u7EBF",
    source: "scientific"
  },
  {
    name: "docx",
    direction: "presentation",
    subdomain: "\u6587\u6863\u4E0E\u8868\u683C\u683C\u5F0F\uFF08\u5F85\u8BB8\u53EF\u590D\u6838\uFF09",
    source: "scientific"
  },
  {
    name: "esm",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "etetoolkit",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "exa-search",
    direction: "evidence",
    subdomain: "\u68C0\u7D22\u670D\u52A1\u9002\u914D",
    source: "scientific"
  },
  {
    name: "experimental-design",
    direction: "planning",
    subdomain: "\u9009\u9898\u3001\u5047\u8BBE\u4E0E\u5B9E\u9A8C\u8BBE\u8BA1",
    source: "scientific"
  },
  {
    name: "exploratory-data-analysis",
    direction: "analysis",
    subdomain: "\u6570\u636E\u6574\u7406\u3001\u5B58\u50A8\u4E0E\u6EAF\u6E90",
    source: "scientific"
  },
  {
    name: "flowio",
    direction: "analysis",
    subdomain: "\u5F71\u50CF\u3001\u751F\u7406\u4E0E\u533B\u5B66\u7814\u7A76",
    source: "scientific"
  },
  {
    name: "fluidsim",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "folklore-variant-evidence",
    direction: "evidence",
    subdomain: "\u4E13\u4E1A\u6570\u636E\u5E93\u4E0E\u6807\u8BC6",
    source: "scientific"
  },
  {
    name: "generate-image",
    direction: "presentation",
    subdomain: "\u89E3\u91CA\u56FE\u4E0E\u89C6\u89C9\u7D20\u6750",
    source: "scientific"
  },
  {
    name: "geniml",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "genomic-coordinates",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "genomic-intelligence",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "geomaster",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "geopandas",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "get-available-resources",
    direction: "engineering",
    subdomain: "\u7B97\u529B\u3001\u4E91\u5E73\u53F0\u4E0E\u7BA1\u7EBF",
    source: "scientific"
  },
  {
    name: "gget",
    direction: "evidence",
    subdomain: "\u4E13\u4E1A\u6570\u636E\u5E93\u4E0E\u6807\u8BC6",
    source: "scientific"
  },
  {
    name: "ginkgo-cloud-lab",
    direction: "engineering",
    subdomain: "\u5B9E\u9A8C\u5E73\u53F0\u3001\u8BB0\u5F55\u7CFB\u7EDF\u4E0E\u8BBE\u5907",
    source: "scientific"
  },
  {
    name: "glycoengineering",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "gtars",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "histolab",
    direction: "analysis",
    subdomain: "\u5F71\u50CF\u3001\u751F\u7406\u4E0E\u533B\u5B66\u7814\u7A76",
    source: "scientific"
  },
  {
    name: "hugging-science",
    direction: "engineering",
    subdomain: "\u7B97\u529B\u3001\u4E91\u5E73\u53F0\u4E0E\u7BA1\u7EBF",
    source: "scientific"
  },
  {
    name: "hypogenic",
    direction: "analysis",
    subdomain: "\u673A\u5668\u5B66\u4E60\u3001\u65F6\u95F4\u5E8F\u5217\u4E0E\u89E3\u91CA",
    source: "scientific"
  },
  {
    name: "hypothesis-generation",
    direction: "planning",
    subdomain: "\u9009\u9898\u3001\u5047\u8BBE\u4E0E\u5B9E\u9A8C\u8BBE\u8BA1",
    source: "scientific"
  },
  {
    name: "imaging-data-commons",
    direction: "evidence",
    subdomain: "\u4E13\u4E1A\u6570\u636E\u5E93\u4E0E\u6807\u8BC6",
    source: "scientific"
  },
  {
    name: "infographics",
    direction: "presentation",
    subdomain: "\u89E3\u91CA\u56FE\u4E0E\u89C6\u89C9\u7D20\u6750",
    source: "scientific"
  },
  {
    name: "iso-standards-readiness",
    direction: "planning",
    subdomain: "\u65B9\u6CD5\u9A8C\u8BC1\u4E0E\u5408\u89C4\u51C6\u5907",
    source: "scientific"
  },
  {
    name: "lab-hardware-cad",
    direction: "engineering",
    subdomain: "\u5B9E\u9A8C\u5E73\u53F0\u3001\u8BB0\u5F55\u7CFB\u7EDF\u4E0E\u8BBE\u5907",
    source: "scientific"
  },
  {
    name: "labarchive-integration",
    direction: "engineering",
    subdomain: "\u5B9E\u9A8C\u5E73\u53F0\u3001\u8BB0\u5F55\u7CFB\u7EDF\u4E0E\u8BBE\u5907",
    source: "scientific"
  },
  {
    name: "lamindb",
    direction: "analysis",
    subdomain: "\u6570\u636E\u6574\u7406\u3001\u5B58\u50A8\u4E0E\u6EAF\u6E90",
    source: "scientific"
  },
  {
    name: "latchbio-integration",
    direction: "engineering",
    subdomain: "\u7B97\u529B\u3001\u4E91\u5E73\u53F0\u4E0E\u7BA1\u7EBF",
    source: "scientific"
  },
  {
    name: "latex-posters",
    direction: "presentation",
    subdomain: "\u5E7B\u706F\u7247\u4E0E\u6D77\u62A5",
    source: "scientific"
  },
  {
    name: "liteparse",
    direction: "evidence",
    subdomain: "\u83B7\u53D6\u3001\u9605\u8BFB\u4E0E\u8BBA\u6587\u5361",
    source: "scientific"
  },
  {
    name: "literature-review",
    direction: "evidence",
    subdomain: "\u8BC1\u636E\u68C0\u7D22\u4E0E\u7EFC\u8FF0",
    source: "scientific"
  },
  {
    name: "markdown-mermaid-writing",
    direction: "presentation",
    subdomain: "\u89E3\u91CA\u56FE\u4E0E\u89C6\u89C9\u7D20\u6750",
    source: "scientific"
  },
  {
    name: "market-research-reports",
    direction: "writing",
    subdomain: "\u4E13\u5229\u4E0E\u4E13\u4E1A\u62A5\u544A\uFF08\u53D7\u9650\u5206\u652F\uFF09",
    source: "scientific"
  },
  {
    name: "markitdown",
    direction: "evidence",
    subdomain: "\u83B7\u53D6\u3001\u9605\u8BFB\u4E0E\u8BBA\u6587\u5361",
    source: "scientific"
  },
  {
    name: "matchms",
    direction: "analysis",
    subdomain: "\u8D28\u8C31\u4E0E\u86CB\u767D\u7EC4",
    source: "scientific"
  },
  {
    name: "matlab",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "matplotlib",
    direction: "presentation",
    subdomain: "\u6570\u636E\u56FE\u8868",
    source: "scientific"
  },
  {
    name: "medchem",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "modal",
    direction: "engineering",
    subdomain: "\u7B97\u529B\u3001\u4E91\u5E73\u53F0\u4E0E\u7BA1\u7EBF",
    source: "scientific"
  },
  {
    name: "molecular-dynamics",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "molfeat",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "ncats-arax",
    direction: "evidence",
    subdomain: "\u4E13\u4E1A\u6570\u636E\u5E93\u4E0E\u6807\u8BC6",
    source: "scientific"
  },
  {
    name: "networkx",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "neurokit2",
    direction: "analysis",
    subdomain: "\u5F71\u50CF\u3001\u751F\u7406\u4E0E\u533B\u5B66\u7814\u7A76",
    source: "scientific"
  },
  {
    name: "neuropixels-analysis",
    direction: "analysis",
    subdomain: "\u5F71\u50CF\u3001\u751F\u7406\u4E0E\u533B\u5B66\u7814\u7A76",
    source: "scientific"
  },
  {
    name: "nextflow",
    direction: "engineering",
    subdomain: "\u7B97\u529B\u3001\u4E91\u5E73\u53F0\u4E0E\u7BA1\u7EBF",
    source: "scientific"
  },
  {
    name: "omero-integration",
    direction: "engineering",
    subdomain: "\u5B9E\u9A8C\u5E73\u53F0\u3001\u8BB0\u5F55\u7CFB\u7EDF\u4E0E\u8BBE\u5907",
    source: "scientific"
  },
  {
    name: "onekgpd",
    direction: "evidence",
    subdomain: "\u4E13\u4E1A\u6570\u636E\u5E93\u4E0E\u6807\u8BC6",
    source: "scientific"
  },
  {
    name: "ontology-term-resolution",
    direction: "evidence",
    subdomain: "\u4E13\u4E1A\u6570\u636E\u5E93\u4E0E\u6807\u8BC6",
    source: "scientific"
  },
  {
    name: "open-notebook",
    direction: "evidence",
    subdomain: "\u77E5\u8BC6\u5E93\u4E0E\u6587\u732E\u5E93",
    source: "scientific"
  },
  {
    name: "openpiv",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "opentrons-integration",
    direction: "engineering",
    subdomain: "\u5B9E\u9A8C\u5E73\u53F0\u3001\u8BB0\u5F55\u7CFB\u7EDF\u4E0E\u8BBE\u5907",
    source: "scientific"
  },
  {
    name: "optimize-for-gpu",
    direction: "engineering",
    subdomain: "\u7B97\u529B\u3001\u4E91\u5E73\u53F0\u4E0E\u7BA1\u7EBF",
    source: "scientific"
  },
  {
    name: "pacsomatic",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "paper-lookup",
    direction: "evidence",
    subdomain: "\u8BC1\u636E\u68C0\u7D22\u4E0E\u7EFC\u8FF0",
    source: "scientific"
  },
  {
    name: "paperclip",
    direction: "evidence",
    subdomain: "\u68C0\u7D22\u670D\u52A1\u9002\u914D",
    source: "scientific"
  },
  {
    name: "paperzilla",
    direction: "evidence",
    subdomain: "\u68C0\u7D22\u670D\u52A1\u9002\u914D",
    source: "scientific"
  },
  {
    name: "parallel-web",
    direction: "evidence",
    subdomain: "\u68C0\u7D22\u670D\u52A1\u9002\u914D",
    source: "scientific"
  },
  {
    name: "pathml",
    direction: "analysis",
    subdomain: "\u5F71\u50CF\u3001\u751F\u7406\u4E0E\u533B\u5B66\u7814\u7A76",
    source: "scientific"
  },
  {
    name: "pathogen-variant-surveillance",
    direction: "evidence",
    subdomain: "\u4E13\u4E1A\u6570\u636E\u5E93\u4E0E\u6807\u8BC6",
    source: "scientific"
  },
  {
    name: "pathway-enrichment",
    direction: "analysis",
    subdomain: "\u8F6C\u5F55\u7EC4\u4E0E\u5355\u7EC6\u80DE",
    source: "scientific"
  },
  {
    name: "pdf",
    direction: "presentation",
    subdomain: "\u6587\u6863\u4E0E\u8868\u683C\u683C\u5F0F\uFF08\u5F85\u8BB8\u53EF\u590D\u6838\uFF09",
    source: "scientific"
  },
  {
    name: "peer-review",
    direction: "writing",
    subdomain: "\u5BA1\u7A3F\u3001\u56DE\u590D\u4E0E\u8BC4\u4EF7",
    source: "scientific"
  },
  {
    name: "pennylane",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "phylogenetics",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "pi-agent",
    direction: "engineering",
    subdomain: "\u4EA4\u63A5\u4E0E\u5E94\u7528\u5B9A\u5236",
    source: "scientific"
  },
  {
    name: "pkpd-modeling",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "polars-bio",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "polars",
    direction: "analysis",
    subdomain: "\u6570\u636E\u6574\u7406\u3001\u5B58\u50A8\u4E0E\u6EAF\u6E90",
    source: "scientific"
  },
  {
    name: "pptx-posters",
    direction: "presentation",
    subdomain: "\u5E7B\u706F\u7247\u4E0E\u6D77\u62A5",
    source: "scientific"
  },
  {
    name: "pptx",
    direction: "presentation",
    subdomain: "\u6587\u6863\u4E0E\u8868\u683C\u683C\u5F0F\uFF08\u5F85\u8BB8\u53EF\u590D\u6838\uFF09",
    source: "scientific"
  },
  {
    name: "primekg",
    direction: "evidence",
    subdomain: "\u4E13\u4E1A\u6570\u636E\u5E93\u4E0E\u6807\u8BC6",
    source: "scientific"
  },
  {
    name: "protocolsio-integration",
    direction: "engineering",
    subdomain: "\u5B9E\u9A8C\u5E73\u53F0\u3001\u8BB0\u5F55\u7CFB\u7EDF\u4E0E\u8BBE\u5907",
    source: "scientific"
  },
  {
    name: "pufferlib",
    direction: "analysis",
    subdomain: "\u673A\u5668\u5B66\u4E60\u3001\u65F6\u95F4\u5E8F\u5217\u4E0E\u89E3\u91CA",
    source: "scientific"
  },
  {
    name: "pydeseq2",
    direction: "analysis",
    subdomain: "\u8F6C\u5F55\u7EC4\u4E0E\u5355\u7EC6\u80DE",
    source: "scientific"
  },
  {
    name: "pydicom",
    direction: "analysis",
    subdomain: "\u5F71\u50CF\u3001\u751F\u7406\u4E0E\u533B\u5B66\u7814\u7A76",
    source: "scientific"
  },
  {
    name: "pyhealth",
    direction: "analysis",
    subdomain: "\u5F71\u50CF\u3001\u751F\u7406\u4E0E\u533B\u5B66\u7814\u7A76",
    source: "scientific"
  },
  {
    name: "pylabrobot",
    direction: "engineering",
    subdomain: "\u5B9E\u9A8C\u5E73\u53F0\u3001\u8BB0\u5F55\u7CFB\u7EDF\u4E0E\u8BBE\u5907",
    source: "scientific"
  },
  {
    name: "pymatgen",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "pymc",
    direction: "analysis",
    subdomain: "\u7EDF\u8BA1\u5EFA\u6A21\u4E0E\u4E0D\u786E\u5B9A\u6027",
    source: "scientific"
  },
  {
    name: "pymoo",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "pyopenms",
    direction: "analysis",
    subdomain: "\u8D28\u8C31\u4E0E\u86CB\u767D\u7EC4",
    source: "scientific"
  },
  {
    name: "pysam",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "pytdc",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "pytorch-lightning",
    direction: "analysis",
    subdomain: "\u673A\u5668\u5B66\u4E60\u3001\u65F6\u95F4\u5E8F\u5217\u4E0E\u89E3\u91CA",
    source: "scientific"
  },
  {
    name: "pyzotero",
    direction: "evidence",
    subdomain: "\u77E5\u8BC6\u5E93\u4E0E\u6587\u732E\u5E93",
    source: "scientific"
  },
  {
    name: "qiskit",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "qutip",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "rdkit",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "relsa-severity-assessment",
    direction: "analysis",
    subdomain: "\u5F71\u50CF\u3001\u751F\u7406\u4E0E\u533B\u5B66\u7814\u7A76",
    source: "scientific"
  },
  {
    name: "research-grants",
    direction: "planning",
    subdomain: "\u9879\u76EE\u7533\u8BF7\u4E0E\u7814\u7A76\u8BA1\u5212",
    source: "scientific"
  },
  {
    name: "research-lookup",
    direction: "evidence",
    subdomain: "\u8BC1\u636E\u68C0\u7D22\u4E0E\u7EFC\u8FF0",
    source: "scientific"
  },
  {
    name: "rowan",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "scanpy",
    direction: "analysis",
    subdomain: "\u8F6C\u5F55\u7EC4\u4E0E\u5355\u7EC6\u80DE",
    source: "scientific"
  },
  {
    name: "scholar-evaluation",
    direction: "writing",
    subdomain: "\u5BA1\u7A3F\u3001\u56DE\u590D\u4E0E\u8BC4\u4EF7",
    source: "scientific"
  },
  {
    name: "scientific-brainstorming",
    direction: "planning",
    subdomain: "\u9009\u9898\u3001\u5047\u8BBE\u4E0E\u5B9E\u9A8C\u8BBE\u8BA1",
    source: "scientific"
  },
  {
    name: "scientific-critical-thinking",
    direction: "evidence",
    subdomain: "\u5F15\u6587\u4E0E\u8BBA\u636E\u6838\u9A8C",
    source: "scientific"
  },
  {
    name: "scientific-schematics",
    direction: "presentation",
    subdomain: "\u89E3\u91CA\u56FE\u4E0E\u89C6\u89C9\u7D20\u6750",
    source: "scientific"
  },
  {
    name: "scientific-slides",
    direction: "presentation",
    subdomain: "\u5E7B\u706F\u7247\u4E0E\u6D77\u62A5",
    source: "scientific"
  },
  {
    name: "scientific-visualization",
    direction: "presentation",
    subdomain: "\u6570\u636E\u56FE\u8868",
    source: "scientific"
  },
  {
    name: "scientific-writing",
    direction: "writing",
    subdomain: "\u6B63\u6587\u4E0E\u8BED\u8A00\u7F16\u8F91",
    source: "scientific"
  },
  {
    name: "scikit-bio",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "scikit-learn",
    direction: "analysis",
    subdomain: "\u673A\u5668\u5B66\u4E60\u3001\u65F6\u95F4\u5E8F\u5217\u4E0E\u89E3\u91CA",
    source: "scientific"
  },
  {
    name: "scikit-survival",
    direction: "analysis",
    subdomain: "\u5F71\u50CF\u3001\u751F\u7406\u4E0E\u533B\u5B66\u7814\u7A76",
    source: "scientific"
  },
  {
    name: "scvelo",
    direction: "analysis",
    subdomain: "\u8F6C\u5F55\u7EC4\u4E0E\u5355\u7EC6\u80DE",
    source: "scientific"
  },
  {
    name: "scvi-tools",
    direction: "analysis",
    subdomain: "\u8F6C\u5F55\u7EC4\u4E0E\u5355\u7EC6\u80DE",
    source: "scientific"
  },
  {
    name: "seaborn",
    direction: "presentation",
    subdomain: "\u6570\u636E\u56FE\u8868",
    source: "scientific"
  },
  {
    name: "shap",
    direction: "analysis",
    subdomain: "\u673A\u5668\u5B66\u4E60\u3001\u65F6\u95F4\u5E8F\u5217\u4E0E\u89E3\u91CA",
    source: "scientific"
  },
  {
    name: "simpy",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "stable-baselines3",
    direction: "analysis",
    subdomain: "\u673A\u5668\u5B66\u4E60\u3001\u65F6\u95F4\u5E8F\u5217\u4E0E\u89E3\u91CA",
    source: "scientific"
  },
  {
    name: "statistical-analysis",
    direction: "analysis",
    subdomain: "\u7EDF\u8BA1\u5EFA\u6A21\u4E0E\u4E0D\u786E\u5B9A\u6027",
    source: "scientific"
  },
  {
    name: "statistical-power",
    direction: "planning",
    subdomain: "\u9009\u9898\u3001\u5047\u8BBE\u4E0E\u5B9E\u9A8C\u8BBE\u8BA1",
    source: "scientific"
  },
  {
    name: "statsmodels",
    direction: "analysis",
    subdomain: "\u7EDF\u8BA1\u5EFA\u6A21\u4E0E\u4E0D\u786E\u5B9A\u6027",
    source: "scientific"
  },
  {
    name: "sympy",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "tamarind",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "tiledbvcf",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "timesfm-forecasting",
    direction: "analysis",
    subdomain: "\u673A\u5668\u5B66\u4E60\u3001\u65F6\u95F4\u5E8F\u5217\u4E0E\u89E3\u91CA",
    source: "scientific"
  },
  {
    name: "torch-geometric",
    direction: "analysis",
    subdomain: "\u673A\u5668\u5B66\u4E60\u3001\u65F6\u95F4\u5E8F\u5217\u4E0E\u89E3\u91CA",
    source: "scientific"
  },
  {
    name: "torchdrug",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "transformers",
    direction: "analysis",
    subdomain: "\u673A\u5668\u5B66\u4E60\u3001\u65F6\u95F4\u5E8F\u5217\u4E0E\u89E3\u91CA",
    source: "scientific"
  },
  {
    name: "treatment-plans",
    direction: "writing",
    subdomain: "\u4E13\u5229\u4E0E\u4E13\u4E1A\u62A5\u544A\uFF08\u53D7\u9650\u5206\u652F\uFF09",
    source: "scientific"
  },
  {
    name: "umap-learn",
    direction: "analysis",
    subdomain: "\u673A\u5668\u5B66\u4E60\u3001\u65F6\u95F4\u5E8F\u5217\u4E0E\u89E3\u91CA",
    source: "scientific"
  },
  {
    name: "uncertainty-and-units",
    direction: "analysis",
    subdomain: "\u7EDF\u8BA1\u5EFA\u6A21\u4E0E\u4E0D\u786E\u5B9A\u6027",
    source: "scientific"
  },
  {
    name: "usfiscaldata",
    direction: "evidence",
    subdomain: "\u4E13\u4E1A\u6570\u636E\u5E93\u4E0E\u6807\u8BC6",
    source: "scientific"
  },
  {
    name: "vaex",
    direction: "analysis",
    subdomain: "\u6570\u636E\u6574\u7406\u3001\u5B58\u50A8\u4E0E\u6EAF\u6E90",
    source: "scientific"
  },
  {
    name: "venue-templates",
    direction: "writing",
    subdomain: "\u62A5\u544A\u89C4\u8303\u3001\u7EDF\u8BA1\u5448\u73B0\u4E0E\u6570\u636E\u58F0\u660E",
    source: "scientific"
  },
  {
    name: "waypoint-bio",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "what-if-oracle",
    direction: "planning",
    subdomain: "\u63A2\u7D22\u6027\u63A8\u6F14\uFF08\u975E\u6838\u5FC3\uFF09",
    source: "scientific"
  },
  {
    name: "xlsx",
    direction: "presentation",
    subdomain: "\u6587\u6863\u4E0E\u8868\u683C\u683C\u5F0F\uFF08\u5F85\u8BB8\u53EF\u590D\u6838\uFF09",
    source: "scientific"
  },
  {
    name: "zarr-python",
    direction: "analysis",
    subdomain: "\u6570\u636E\u6574\u7406\u3001\u5B58\u50A8\u4E0E\u6EAF\u6E90",
    source: "scientific"
  },
  {
    name: "academic-paper-reviewer",
    direction: "writing",
    subdomain: "\u5BA1\u7A3F\u3001\u56DE\u590D\u4E0E\u8BC4\u4EF7",
    source: "academic"
  },
  {
    name: "academic-paper",
    direction: "writing",
    subdomain: "\u6B63\u6587\u4E0E\u8BED\u8A00\u7F16\u8F91",
    source: "academic"
  },
  {
    name: "academic-pipeline",
    direction: "planning",
    subdomain: "\u5B8C\u6574\u79D1\u7814\u8BA1\u5212\uFF08\u663E\u5F0F\u6A21\u5F0F\uFF09",
    source: "academic"
  },
  {
    name: "deep-research",
    direction: "evidence",
    subdomain: "\u8BC1\u636E\u68C0\u7D22\u4E0E\u7EFC\u8FF0",
    source: "academic"
  },
  {
    name: "research-show-me",
    direction: "presentation",
    subdomain: "\u89E3\u91CA\u56FE\u4E0E\u89C6\u89C9\u7D20\u6750",
    source: "project"
  },
  {
    name: "research-vault",
    direction: "evidence",
    subdomain: "\u77E5\u8BC6\u5E93\u4E0E\u6587\u732E\u5E93",
    source: "project"
  },
  {
    name: "research-workflow",
    direction: "internal",
    subdomain: "\u8BC1\u636E\u4E0E\u4EFB\u52A1\u63A7\u5236/\u5171\u4EAB\u8D44\u6E90",
    source: "project"
  },
  {
    name: "zotero-literature",
    direction: "evidence",
    subdomain: "\u77E5\u8BC6\u5E93\u4E0E\u6587\u732E\u5E93",
    source: "project"
  },
  {
    name: "channel-pickup",
    direction: "engineering",
    subdomain: "\u4EA4\u63A5\u4E0E\u5E94\u7528\u5B9A\u5236",
    source: "project"
  },
  {
    name: "design-handoff",
    direction: "engineering",
    subdomain: "\u4EA4\u63A5\u4E0E\u5E94\u7528\u5B9A\u5236",
    source: "project"
  },
  {
    name: "drone-ui-plugin",
    direction: "engineering",
    subdomain: "\u4EA4\u63A5\u4E0E\u5E94\u7528\u5B9A\u5236",
    source: "project"
  }
];

// packages/shared/src/workflow-catalog.ts
var WORKFLOW_PROFILES = workflow_profiles_default;
var byName = new Map(WORKFLOW_PROFILES.map((p) => [p.name, p]));
var WORKFLOW_STAGES = [
  {
    id: "ideation",
    direction: "planning",
    label: {
      zh: "\u79D1\u7814\u9009\u9898\u4E0E\u5047\u8BBE",
      en: "Questions and hypotheses"
    },
    commands: ["skill:hypothesis-generation", "skill:scientific-brainstorming"],
    contract: "Question, rival hypotheses, discriminating evidence; no claim of completed experiments."
  },
  {
    id: "methods",
    direction: "planning",
    label: {
      zh: "\u5B9E\u9A8C\u8BBE\u8BA1",
      en: "Experimental design"
    },
    commands: ["skill:experimental-design"],
    contract: "Design, experimental units, controls and assumptions before data collection."
  },
  {
    id: "power",
    direction: "planning",
    label: {
      zh: "\u6837\u672C\u91CF\u4E0E\u7EDF\u8BA1\u6548\u80FD",
      en: "Sample size and power"
    },
    commands: ["skill:statistical-power"],
    contract: "Prospective sample-size assumptions, effect size and uncertainty."
  },
  {
    id: "grants",
    direction: "planning",
    label: {
      zh: "\u5F00\u9898\u4E0E\u9879\u76EE\u7533\u8BF7",
      en: "Proposals and grants"
    },
    commands: ["skill:researchwrite", "skill:research-grants"],
    contract: "Evidence-grounded proposal; preserve the selected funder or opening-report format."
  },
  {
    id: "pipeline",
    direction: "planning",
    label: {
      zh: "ARS \u5B8C\u6574\u9879\u76EE \xB7 \u9010\u9636\u6BB5\u786E\u8BA4",
      en: "ARS full project \xB7 stage confirmations"
    },
    commands: ["ars-full"],
    contract: "ARS original stage confirmations and resume semantics; host owns task state."
  },
  {
    id: "search",
    direction: "evidence",
    label: {
      zh: "\u6587\u732E\u53D1\u73B0",
      en: "Literature discovery"
    },
    commands: ["skill:nature-academic-search", "skill:paper-lookup", "skill:research-lookup"],
    contract: "Bounded search scope, provenance and failures; a search hit is not a source read."
  },
  {
    id: "reading",
    direction: "evidence",
    label: {
      zh: "\u8BBA\u6587\u9605\u8BFB\u4E0E\u5BF9\u7167\u7FFB\u8BD1",
      en: "Paper reading and translation"
    },
    commands: ["skill:nature-reader"],
    contract: "Source-linked reading within requested scope; do not translate the full paper for a local question."
  },
  {
    id: "paperCard",
    direction: "evidence",
    label: {
      zh: "\u8BBA\u6587\u8BC1\u636E\u5361",
      en: "Evidence-grounded paper card"
    },
    commands: ["skill:nature-paper-card"],
    contract: "Reuse supplied reader source maps; mark unsupported sections rather than invent evidence."
  },
  {
    id: "synthesis",
    direction: "evidence",
    label: {
      zh: "\u7CFB\u7EDF\u6587\u732E\u7EFC\u8FF0",
      en: "Systematic literature review"
    },
    commands: ["skill:literature-review"],
    contract: "Search, eligibility and synthesis; no mandatory AI images, payments or uploads."
  },
  {
    id: "citation",
    direction: "evidence",
    label: {
      zh: "\u5F15\u6587\u6838\u9A8C\u4E0E\u5BFC\u51FA",
      en: "Citation verification and export"
    },
    commands: ["skill:nature-ref-verifier", "skill:citation-management"],
    contract: "Bibliographic identity and formatting are distinct from scientific claim support."
  },
  {
    id: "library",
    direction: "evidence",
    label: {
      zh: "Zotero \u6587\u732E\u5E93",
      en: "Zotero library"
    },
    commands: ["skill:zotero-literature"],
    contract: "Use host-controlled library writes and separate Zotero/Vault receipts."
  },
  {
    id: "vault",
    direction: "evidence",
    label: {
      zh: "\u77E5\u8BC6\u5E93\u68C0\u7D22\u4E0E\u7EF4\u62A4",
      en: "Knowledge retrieval and maintenance"
    },
    commands: ["skill:research-vault"],
    contract: "Keep application binding, evidence reads and Wiki approval under host control."
  },
  {
    id: "subscription",
    direction: "evidence",
    label: {
      zh: "\u6587\u732E\u8BA2\u9605 \xB7 \u9700\u6388\u6743\u63A8\u9001",
      en: "Literature feeds \xB7 authorized delivery"
    },
    commands: ["skill:nature-literature-pipeline"],
    contract: "Subscription is not publication orchestration; scheduling and delivery require authorization."
  },
  {
    id: "explore",
    direction: "analysis",
    label: {
      zh: "\u6570\u636E\u63A2\u7D22\u4E0E\u8D28\u91CF\u68C0\u67E5",
      en: "Data exploration and QC"
    },
    commands: ["skill:exploratory-data-analysis"],
    contract: "Inspect supplied data locally and disclose supported formats and actual executed checks."
  },
  {
    id: "statistics",
    direction: "analysis",
    label: {
      zh: "\u7EDF\u8BA1\u5206\u6790",
      en: "Statistical analysis"
    },
    commands: ["skill:statistical-analysis"],
    contract: "Assumptions, effect sizes, uncertainty and provenance; do not infer analysis from manuscript prose."
  },
  {
    id: "rnaseq",
    direction: "analysis",
    label: {
      zh: "Bulk RNA-seq",
      en: "Bulk RNA-seq"
    },
    commands: ["skill:bulk-rnaseq"],
    contract: "Enter at the supplied input stage; existing counts must not trigger a fresh FASTQ pipeline."
  },
  {
    id: "de",
    direction: "analysis",
    label: {
      zh: "\u5DF2\u6709\u8BA1\u6570\u7684\u5DEE\u5F02\u8868\u8FBE",
      en: "Differential expression from counts"
    },
    commands: ["skill:pydeseq2"],
    contract: "Validate counts, biological replicates, design and contrasts before differential expression."
  },
  {
    id: "enrichment",
    direction: "analysis",
    label: {
      zh: "\u901A\u8DEF\u4E0E\u57FA\u56E0\u96C6\u5BCC\u96C6",
      en: "Pathway enrichment"
    },
    commands: ["skill:pathway-enrichment"],
    contract: "Preserve gene identifiers, method and background universe."
  },
  {
    id: "singlecell",
    direction: "analysis",
    label: {
      zh: "\u5355\u7EC6\u80DE\u6807\u51C6\u5206\u6790",
      en: "Standard single-cell analysis"
    },
    commands: ["skill:scanpy"],
    contract: "Standard analysis; keep AnnData structure and specialized models as distinct modules."
  },
  {
    id: "bioinformatics",
    direction: "analysis",
    label: {
      zh: "\u5E8F\u5217\u3001\u540C\u6E90\u4E0E\u7ED3\u6784\u57DF\u5206\u6790",
      en: "Sequence, homology and domain analysis"
    },
    commands: ["skill:scikit-bio", "skill:waypoint-bio"],
    contract: "Resolve species and accessions first, preserve database/release evidence, use a reproducible alignment or annotation method, and report unsupported species or missing annotations instead of improvising an unbounded remote script."
  },
  {
    id: "phylogeny",
    direction: "analysis",
    label: {
      zh: "\u7CFB\u7EDF\u53D1\u80B2\u5EFA\u6811\u4E0E\u6E32\u67D3",
      en: "Phylogenetic tree building and rendering"
    },
    commands: ["skill:phylogenetics", "skill:etetoolkit"],
    contract: "Resolve taxa and accessions first, align (MAFFT), trim (trimAl) and infer the tree (IQ-TREE/FastTree) with recorded versions and models, then render with ETE; if a tool is missing, check bio_environment and propose a mamba/bioconda environment instead of stopping."
  },
  {
    id: "chemistry",
    direction: "analysis",
    label: {
      zh: "\u5316\u5B66\u4FE1\u606F\u4E0E\u5206\u5B50\u5904\u7406",
      en: "Cheminformatics"
    },
    commands: ["skill:rdkit", "skill:datamol"],
    contract: "Choose molecular operations explicitly; docking, dynamics and property prediction are different tasks."
  },
  {
    id: "writing",
    direction: "writing",
    label: {
      zh: "\u8BBA\u6587\u8D77\u8349\u4E0E\u91CD\u6784",
      en: "Draft or restructure a manuscript"
    },
    commands: ["skill:nature-writing", "skill:scientific-writing"],
    contract: "Complete the requested section; preserve evidence scope and do not force a full pipeline."
  },
  {
    id: "polishing",
    direction: "writing",
    label: {
      zh: "\u8BED\u8A00\u6DA6\u8272\u4E0E\u5B66\u672F\u7FFB\u8BD1",
      en: "Polish or translate prose"
    },
    commands: ["skill:nature-polishing"],
    contract: "Preserve facts and terminology; no new study design or automatic full rewrite."
  },
  {
    id: "review",
    direction: "writing",
    label: {
      zh: "\u666E\u901A\u5BA1\u6821",
      en: "Manuscript assessment"
    },
    commands: ["skill:peer-review"],
    contract: "Evidence-bounded assessment with confidentiality and venue-policy checks."
  },
  {
    id: "blindReview",
    direction: "writing",
    label: {
      zh: "Nature \u4E09\u4EFD\u4E92\u76F2\u8BC4\u5BA1",
      en: "Nature: three blind reviews"
    },
    commands: ["skill:nature-reviewer"],
    contract: "Three genuinely isolated reports frozen before synthesis; disclose inability to isolate."
  },
  {
    id: "arsReview",
    direction: "writing",
    label: {
      zh: "ARS \u4E94\u5E2D\u89D2\u8272\u8BC4\u8BAE",
      en: "ARS: five-seat role-separated panel"
    },
    commands: ["ars-reviewer"],
    contract: "Original five-seat contract and provenance; role separation is not independent error processes."
  },
  {
    id: "response",
    direction: "writing",
    label: {
      zh: "\u9010\u70B9\u56DE\u590D\u4E0E\u8FD4\u4FEE",
      en: "Respond to reviewers"
    },
    commands: ["skill:nature-response"],
    contract: "Respond to actual reviewer comments and trace manuscript changes; do not run another review panel."
  },
  {
    id: "reporting",
    direction: "writing",
    label: {
      zh: "\u7EDF\u8BA1\u62A5\u544A\u5BA1\u67E5",
      en: "Statistical reporting audit"
    },
    commands: ["skill:nature-statistics"],
    contract: "Review reported units, replication and uncertainty; compute only if requested with data."
  },
  {
    id: "availability",
    direction: "writing",
    label: {
      zh: "\u6570\u636E\u4E0E\u4EE3\u7801\u53EF\u7528\u6027\u58F0\u660E",
      en: "Data/code availability statements"
    },
    commands: ["skill:nature-data"],
    contract: "Availability/FAIR statements, not data cleaning; never invent accessions or permissions."
  },
  {
    id: "patent",
    direction: "writing",
    label: {
      zh: "\u4E13\u5229\u6280\u672F\u4EA4\u5E95",
      en: "Patent disclosure drafting"
    },
    commands: ["skill:nature-paper-to-patent"],
    contract: "Source-grounded disclosure with original stage gates; do not infer inventorship or rights."
  },
  {
    id: "figures",
    direction: "presentation",
    label: {
      zh: "\u771F\u5B9E\u6570\u636E\u56FE\u8868",
      en: "Data-backed figures"
    },
    commands: ["skill:nature-figure", "skill:scientific-visualization"],
    contract: "Truthful data, uncertainty and accessible figures; AI diagrams are not data plots."
  },
  {
    id: "slides",
    direction: "presentation",
    label: {
      zh: "\u8BBA\u6587\u6C47\u62A5\u4E0E\u6F14\u793A",
      en: "Research presentations"
    },
    commands: ["skill:nature-paper2ppt", "skill:scientific-slides"],
    contract: "Preserve source figures, speaker notes and requested output format."
  },
  {
    id: "reconstruct",
    direction: "presentation",
    label: {
      zh: "\u56FE\u7247\u91CD\u5EFA\u53EF\u7F16\u8F91 PPT",
      en: "Editable slides from images"
    },
    commands: ["skill:nature-image2ppt"],
    contract: "Reconstruct object-level editable slides; this is not authoring a new deck."
  },
  {
    id: "poster",
    direction: "presentation",
    label: {
      zh: "LaTeX \u5B66\u672F\u6D77\u62A5",
      en: "LaTeX research poster"
    },
    commands: ["skill:latex-posters"],
    contract: "Deliver the requested poster format using authorized content and assets."
  },
  {
    id: "pptPoster",
    direction: "presentation",
    label: {
      zh: "\u53EF\u7F16\u8F91 PPT \u6D77\u62A5",
      en: "Editable PowerPoint poster"
    },
    commands: ["skill:pptx-posters"],
    contract: "Preserve editable poster objects; do not silently substitute a PDF-only artifact."
  },
  {
    id: "explainer",
    direction: "presentation",
    label: {
      zh: "\u6765\u6E90\u53EF\u8FFD\u6EAF\u7684\u89E3\u91CA\u9875",
      en: "Source-grounded explainer"
    },
    commands: ["skill:research-show-me"],
    contract: "Static self-contained presentation, not evidence; use authorized artifact sinks."
  },
  {
    id: "handoff",
    direction: "engineering",
    label: {
      zh: "\u8BBE\u8BA1\u5E76\u4EA4\u63A5\u4EFB\u52A1",
      en: "Design and hand off work"
    },
    commands: ["skill:design-handoff"],
    contract: "Produce spec, plan and HANDOFF; notify in batches and preserve channel protocol."
  },
  {
    id: "pickup",
    direction: "engineering",
    label: {
      zh: "\u63A5\u624B\u5DF2\u6709\u4EA4\u63A5",
      en: "Pick up a handoff"
    },
    commands: ["skill:channel-pickup"],
    contract: "Read HANDOFF/spec/plan; verify changes, report completion and unsubscribe at termination."
  },
  {
    id: "plugin",
    direction: "engineering",
    label: {
      zh: "\u5B9A\u5236 Drone \u754C\u9762",
      en: "Customize Drone UI"
    },
    commands: ["skill:drone-ui-plugin"],
    contract: "Respect UI plugin SPEC, sandbox and user-only enablement; do not auto-enable."
  },
  {
    id: "resources",
    direction: "engineering",
    label: {
      zh: "\u68C0\u67E5\u8BA1\u7B97\u8D44\u6E90",
      en: "Inspect compute resources"
    },
    commands: ["skill:get-available-resources"],
    contract: "Bounded inventory only; no installation, cloud job or paid resource reservation."
  },
  {
    id: "nextflow",
    direction: "engineering",
    label: {
      zh: "Nextflow \u7BA1\u7EBF",
      en: "Nextflow pipelines"
    },
    commands: ["skill:nextflow"],
    contract: "Preserve samplesheets, executor/container versions and execution authorization."
  }
];
var WORKFLOW_OWNER_NAMES = /* @__PURE__ */ new Set([
  ...WORKFLOW_STAGES.flatMap((s) => s.commands.filter((n) => n.startsWith("skill:")).map((n) => n.slice(6))),
  "academic-paper",
  "academic-paper-reviewer",
  "academic-pipeline",
  "deep-research"
]);

// packages/shared/src/research-skills.ts
var RESEARCH_SKILL_SOURCES = research_skill_sources_default.sources;
var profiles = new Map(
  research_skill_sources_default.sources.flatMap(
    (source) => source.skills.map(
      (skill) => [skill.name, { ...skill, source: source.id }]
    )
  )
);

// packages/shared/src/skill-catalog.ts
var groups = {
  knowledge: ["research-vault", "nature-experiment-log"],
  research: [
    "research-workflow",
    "zotero-literature",
    "bio-environment",
    "research",
    "nature-academic-search",
    "nature-downloader",
    "nature-literature-pipeline",
    "nature-paper-card",
    "nature-reader",
    "nature-ref-verifier",
    "nature-statistics"
  ],
  writing: [
    "nature-citation",
    "nature-data",
    "nature-paper-to-patent",
    "nature-polishing",
    "nature-response",
    "nature-reviewer",
    "nature-writing",
    "researchwrite",
    "writing-beats",
    "writing-for-agents",
    "writing-fragments",
    "writing-great-skills",
    "writing-shape"
  ],
  presentation: [
    "show-me",
    "teach",
    "nature-figure",
    "nature-image2ppt",
    "nature-paper2ppt",
    "drone-ui-plugin"
  ],
  engineering: [
    "code-review",
    "codebase-design",
    "diagnosing-bugs",
    "domain-modeling",
    "git-guardrails-claude-code",
    "grill-me",
    "grill-with-docs",
    "grilling",
    "implement",
    "implement-spec",
    "improve-codebase-architecture",
    "loop-me",
    "migrate-to-shoehorn",
    "prototype",
    "resolving-merge-conflicts",
    "retro",
    "scaffold-exercises",
    "tdd",
    "to-questionnaire",
    "to-spec",
    "to-tickets",
    "triage",
    "wait-what",
    "wayfinder"
  ],
  collaboration: [
    "channel-pickup",
    "design-handoff",
    "claude-handoff",
    "codexhost-delegation",
    "handoff",
    "council-mode",
    "pi-subagents",
    "ask-user",
    "ask-matt",
    "find-skills",
    "wizard",
    "mcp-scripting"
  ],
  support: ["nature-shared"]
};
var categoryByName = new Map(
  Object.entries(groups).flatMap(
    ([category, names]) => (names ?? []).map((name) => [name, category])
  )
);

// packages/shared/src/compute.ts
var ComputeIdSchema = typebox_exports.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9._:-]+$" });
var ComputeHostKindSchema = typebox_exports.Union([
  typebox_exports.Literal("ssh"),
  typebox_exports.Literal("scheduler"),
  typebox_exports.Literal("local")
]);
var ComputeHealthStatusSchema = typebox_exports.Union([
  typebox_exports.Literal("unknown"),
  typebox_exports.Literal("checking"),
  typebox_exports.Literal("healthy"),
  typebox_exports.Literal("degraded"),
  typebox_exports.Literal("offline"),
  typebox_exports.Literal("blocked")
]);
var ComputeAuthStateSchema = typebox_exports.Union([
  typebox_exports.Literal("not_configured"),
  typebox_exports.Literal("ready"),
  typebox_exports.Literal("needs_login"),
  typebox_exports.Literal("rejected")
]);
var ComputeCapabilitySchema = typebox_exports.Object(
  {
    name: typebox_exports.String({ minLength: 1, maxLength: 128 }),
    version: typebox_exports.Optional(typebox_exports.String({ maxLength: 128 })),
    available: typebox_exports.Boolean(),
    details: typebox_exports.Optional(typebox_exports.String({ maxLength: 512 }))
  },
  { additionalProperties: false }
);
var ComputeResourcesSchema = typebox_exports.Object(
  {
    cpuCores: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1, maximum: 1e6 })),
    memoryBytes: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
    gpuCount: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0, maximum: 1e6 })),
    diskFreeBytes: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }))
  },
  { additionalProperties: false }
);
var ComputeHostSchema = typebox_exports.Object(
  {
    id: ComputeIdSchema,
    alias: typebox_exports.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9._-]+$" }),
    displayName: typebox_exports.String({ minLength: 1, maxLength: 160 }),
    kind: ComputeHostKindSchema,
    endpoint: typebox_exports.Optional(typebox_exports.String({ maxLength: 512, pattern: "^[^@]*$" })),
    port: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1, maximum: 65535 })),
    user: typebox_exports.Optional(typebox_exports.String({ maxLength: 128 })),
    platform: typebox_exports.Optional(typebox_exports.String({ maxLength: 64 })),
    arch: typebox_exports.Optional(typebox_exports.String({ maxLength: 64 })),
    workspaceRoot: typebox_exports.Optional(typebox_exports.String({ maxLength: 1024 })),
    authState: ComputeAuthStateSchema,
    managed: typebox_exports.Boolean(),
    health: typebox_exports.Object(
      {
        status: ComputeHealthStatusSchema,
        checkedAt: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 64 })),
        latencyMs: typebox_exports.Optional(typebox_exports.Number({ minimum: 0 })),
        version: typebox_exports.Optional(typebox_exports.String({ maxLength: 128 })),
        details: typebox_exports.Optional(typebox_exports.String({ maxLength: 512 })),
        errorCode: typebox_exports.Optional(typebox_exports.String({ maxLength: 128 }))
      },
      { additionalProperties: false }
    ),
    capabilities: typebox_exports.Array(ComputeCapabilitySchema, { maxItems: 256 }),
    resources: typebox_exports.Optional(ComputeResourcesSchema),
    createdAt: typebox_exports.String({ minLength: 1, maxLength: 64 }),
    updatedAt: typebox_exports.String({ minLength: 1, maxLength: 64 })
  },
  { additionalProperties: false }
);
var ComputeHostInputSchema = typebox_exports.Object(
  {
    alias: typebox_exports.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9._-]+$" }),
    displayName: typebox_exports.String({ minLength: 1, maxLength: 160 }),
    kind: ComputeHostKindSchema,
    endpoint: typebox_exports.Optional(typebox_exports.String({ maxLength: 512, pattern: "^[^@]*$" })),
    port: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1, maximum: 65535 })),
    user: typebox_exports.Optional(typebox_exports.String({ maxLength: 128 })),
    identityFile: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 1024 })),
    jumpHosts: typebox_exports.Optional(
      typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9._-]+$" }), { maxItems: 8 })
    ),
    hostKeyFingerprint: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 256 })),
    workspaceRoot: typebox_exports.Optional(typebox_exports.String({ maxLength: 1024 })),
    managed: typebox_exports.Optional(typebox_exports.Boolean())
  },
  { additionalProperties: false }
);
var ComputeBudgetSchema = typebox_exports.Object(
  {
    /** Total CPU core-hours allowed for this task. */
    maxCoreHours: typebox_exports.Number({ minimum: 0, maximum: 1e9 }),
    /** Longest wall-clock duration of one job. */
    maxWalltimeMinutes: typebox_exports.Integer({ minimum: 1, maximum: 2e6 }),
    maxConcurrentJobs: typebox_exports.Integer({ minimum: 1, maximum: 1e4 }),
    maxDiskGb: typebox_exports.Integer({ minimum: 1, maximum: 1e6 })
  },
  { additionalProperties: false }
);
var ComputeSha256Schema = typebox_exports.String({ pattern: "^[a-fA-F0-9]{64}$" });
var ComputeDatasetFileSchema = typebox_exports.Object(
  {
    path: typebox_exports.String({ minLength: 1, maxLength: 1024 }),
    bytes: typebox_exports.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    sha256: ComputeSha256Schema,
    mediaType: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 256 }))
  },
  { additionalProperties: false }
);
var ComputeDatasetSourceSchema = typebox_exports.Object(
  {
    kind: typebox_exports.Union([
      typebox_exports.Literal("local"),
      typebox_exports.Literal("public"),
      typebox_exports.Literal("generated"),
      typebox_exports.Literal("imported")
    ]),
    uri: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 2048 })),
    accession: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 256 })),
    license: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 512 }))
  },
  { additionalProperties: false }
);
var ComputeDatasetVersionSchema = typebox_exports.Object(
  {
    datasetId: ComputeIdSchema,
    versionId: typebox_exports.String({ minLength: 1, maxLength: 128, pattern: "^sha256:[a-fA-F0-9]{64}$" }),
    contentSha256: ComputeSha256Schema,
    schemaVersion: typebox_exports.Integer({ minimum: 1, maximum: 100 }),
    files: typebox_exports.Array(ComputeDatasetFileSchema, { maxItems: 1e6 }),
    sizeBytes: typebox_exports.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    source: typebox_exports.Optional(ComputeDatasetSourceSchema),
    createdAt: typebox_exports.String({ minLength: 1, maxLength: 64 })
  },
  { additionalProperties: false }
);
var ComputeDatasetVersionRefSchema = typebox_exports.Object(
  {
    datasetId: ComputeIdSchema,
    versionId: typebox_exports.String({ minLength: 1, maxLength: 128, pattern: "^sha256:[a-fA-F0-9]{64}$" })
  },
  { additionalProperties: false }
);
var ComputeSampleColumnSchema = typebox_exports.Object(
  {
    name: typebox_exports.String({ minLength: 1, maxLength: 128 }),
    type: typebox_exports.Union([
      typebox_exports.Literal("string"),
      typebox_exports.Literal("integer"),
      typebox_exports.Literal("number"),
      typebox_exports.Literal("boolean")
    ]),
    required: typebox_exports.Optional(typebox_exports.Boolean()),
    unique: typebox_exports.Optional(typebox_exports.Boolean()),
    allowedValues: typebox_exports.Optional(
      typebox_exports.Array(typebox_exports.Union([typebox_exports.String(), typebox_exports.Number(), typebox_exports.Boolean()]), { maxItems: 512 })
    )
  },
  { additionalProperties: false }
);
var ComputeSampleSheetSchema = typebox_exports.Object(
  {
    id: ComputeIdSchema,
    version: typebox_exports.Integer({ minimum: 1, maximum: 100 }),
    idColumn: typebox_exports.String({ minLength: 1, maxLength: 128 }),
    columns: typebox_exports.Array(ComputeSampleColumnSchema, { minItems: 1, maxItems: 512 })
  },
  { additionalProperties: false }
);
var ComputeStatisticalAnalysisPlanSchema = typebox_exports.Object(
  {
    id: ComputeIdSchema,
    version: typebox_exports.Integer({ minimum: 1, maximum: 100 }),
    outcome: typebox_exports.String({ minLength: 1, maxLength: 256 }),
    design: typebox_exports.Union([
      typebox_exports.Literal("two-group"),
      typebox_exports.Literal("paired"),
      typebox_exports.Literal("factorial"),
      typebox_exports.Literal("regression")
    ]),
    primaryTest: typebox_exports.String({ minLength: 1, maxLength: 256 }),
    alpha: typebox_exports.Number({ exclusiveMinimum: 0, exclusiveMaximum: 1 }),
    targetPower: typebox_exports.Number({ exclusiveMinimum: 0, exclusiveMaximum: 1 }),
    effectSize: typebox_exports.Number({ exclusiveMinimum: 0 }),
    totalSampleSize: typebox_exports.Optional(typebox_exports.Integer({ minimum: 2, maximum: 1e7 })),
    perGroupSampleSize: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1, maximum: 5e6 })),
    groups: typebox_exports.Optional(
      typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 128 }), { minItems: 2, maxItems: 256 })
    ),
    covariates: typebox_exports.Optional(typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 128 }), { maxItems: 256 })),
    datasetVersion: typebox_exports.Optional(ComputeDatasetVersionRefSchema),
    sampleSheetSchemaId: typebox_exports.Optional(ComputeIdSchema)
  },
  { additionalProperties: false }
);
var ComputeDescriptiveAnalysisPlanSchema = typebox_exports.Object(
  {
    id: ComputeIdSchema,
    version: typebox_exports.Integer({ minimum: 1, maximum: 100 }),
    outcome: typebox_exports.String({ minLength: 1, maxLength: 256 }),
    design: typebox_exports.Literal("descriptive"),
    primaryTest: typebox_exports.String({ minLength: 1, maxLength: 256 }),
    datasetVersion: typebox_exports.Optional(ComputeDatasetVersionRefSchema),
    sampleSheetSchemaId: typebox_exports.Optional(ComputeIdSchema)
  },
  { additionalProperties: false }
);
var ComputeAnalysisPlanSchema = typebox_exports.Union([
  ComputeStatisticalAnalysisPlanSchema,
  ComputeDescriptiveAnalysisPlanSchema
]);
var ComputePublicDataFetchRecordSchema = typebox_exports.Object(
  {
    id: ComputeIdSchema,
    uri: typebox_exports.String({ minLength: 1, maxLength: 2048 }),
    accession: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 256 })),
    source: typebox_exports.String({ minLength: 1, maxLength: 256 }),
    license: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 512 })),
    termsAccepted: typebox_exports.Boolean(),
    fetchedAt: typebox_exports.String({ minLength: 1, maxLength: 64 }),
    bytes: typebox_exports.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    sha256: ComputeSha256Schema
  },
  { additionalProperties: false }
);
var ComputeDataDesignContractSchema = typebox_exports.Object(
  {
    datasetVersion: ComputeDatasetVersionRefSchema,
    sampleSheetSchemaId: ComputeIdSchema,
    sampleSheetSha256: ComputeSha256Schema,
    analysisPlanId: ComputeIdSchema,
    analysisPlanSha256: ComputeSha256Schema,
    fetchRecordIds: typebox_exports.Optional(typebox_exports.Array(ComputeIdSchema, { maxItems: 256 }))
  },
  { additionalProperties: false }
);
var ComputeAuthorizationSchema = typebox_exports.Object(
  {
    hosts: typebox_exports.Array(ComputeIdSchema, { minItems: 1, maxItems: 32 }),
    remoteRead: typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 1024 }), { maxItems: 64 }),
    remoteWrite: typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 1024 }), { maxItems: 64 }),
    budget: ComputeBudgetSchema,
    workflows: typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 256 }), { maxItems: 128 }),
    agentCode: typebox_exports.Optional(typebox_exports.Boolean()),
    /** B7 records are optional for legacy compute tasks and required by B7-aware hosts. */
    dataDesign: typebox_exports.Optional(ComputeDataDesignContractSchema)
  },
  { additionalProperties: false }
);
var ComputeUsageSchema = typebox_exports.Object(
  {
    coreHours: typebox_exports.Number({ minimum: 0 }),
    activeJobs: typebox_exports.Integer({ minimum: 0 }),
    diskBytes: typebox_exports.Integer({ minimum: 0 })
  },
  { additionalProperties: false }
);
var ComputeJobProcessSchema = typebox_exports.Object(
  {
    name: typebox_exports.String({ minLength: 1, maxLength: 256 }),
    label: typebox_exports.Optional(typebox_exports.String({ maxLength: 160 })),
    total: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    completed: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    running: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    queued: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    failed: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    cached: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 }))
  },
  { additionalProperties: false }
);
var ComputeJobProgressSchema = typebox_exports.Object(
  {
    stage: typebox_exports.Optional(typebox_exports.String({ maxLength: 160 })),
    completedTasks: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    totalTasks: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    runningTasks: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    queuedTasks: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    failedTasks: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    processes: typebox_exports.Array(ComputeJobProcessSchema, { maxItems: 512 }),
    tracePath: typebox_exports.Optional(typebox_exports.String({ maxLength: 1024 })),
    timelinePath: typebox_exports.Optional(typebox_exports.String({ maxLength: 1024 })),
    reportPath: typebox_exports.Optional(typebox_exports.String({ maxLength: 1024 })),
    multiqcPath: typebox_exports.Optional(typebox_exports.String({ maxLength: 1024 })),
    failureReason: typebox_exports.Optional(typebox_exports.String({ maxLength: 1e3 }))
  },
  { additionalProperties: false }
);
var ComputeJobSchema = typebox_exports.Object(
  {
    id: ComputeIdSchema,
    hostId: ComputeIdSchema,
    taskId: typebox_exports.Optional(ComputeIdSchema),
    sessionId: typebox_exports.Optional(ComputeIdSchema),
    state: typebox_exports.Union([
      typebox_exports.Literal("queued"),
      typebox_exports.Literal("running"),
      typebox_exports.Literal("succeeded"),
      typebox_exports.Literal("failed"),
      typebox_exports.Literal("cancelled"),
      typebox_exports.Literal("unknown")
    ]),
    label: typebox_exports.Optional(typebox_exports.String({ maxLength: 160 })),
    startedAt: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 64 })),
    finishedAt: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 64 })),
    exitCode: typebox_exports.Optional(typebox_exports.Integer()),
    budget: typebox_exports.Object(
      {
        coreHours: typebox_exports.Number({ minimum: 0 }),
        wallMinutes: typebox_exports.Number({ minimum: 0 }),
        diskBytes: typebox_exports.Number({ minimum: 0 })
      },
      { additionalProperties: false }
    ),
    publicSummary: typebox_exports.Optional(typebox_exports.String({ maxLength: 1e3 })),
    progress: typebox_exports.Optional(ComputeJobProgressSchema),
    artifacts: typebox_exports.Array(
      typebox_exports.Object(
        {
          name: typebox_exports.String({ minLength: 1, maxLength: 256 }),
          path: typebox_exports.String({ maxLength: 1024 }),
          sha256: typebox_exports.Optional(typebox_exports.String({ maxLength: 128 }))
        },
        { additionalProperties: false }
      ),
      { maxItems: 256 }
    ),
    updatedAt: typebox_exports.String({ minLength: 1, maxLength: 64 })
  },
  { additionalProperties: false }
);
var ComputeJobInputSchema = typebox_exports.Object(
  {
    hostId: ComputeIdSchema,
    idempotencyKey: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 256 })),
    remoteWorkDir: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 1024 })),
    workflow: typebox_exports.Object(
      {
        name: typebox_exports.String({ minLength: 1, maxLength: 256 }),
        version: typebox_exports.String({ minLength: 1, maxLength: 128 }),
        source: typebox_exports.Optional(typebox_exports.String({ maxLength: 256 })),
        specHash: typebox_exports.Optional(typebox_exports.String({ maxLength: 128 }))
      },
      { additionalProperties: false }
    ),
    resources: typebox_exports.Optional(
      typebox_exports.Object(
        {
          cpus: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1, maximum: 1e6 })),
          memoryBytes: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
          wallTimeSeconds: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1, maximum: 1728e5 }))
        },
        { additionalProperties: false }
      )
    ),
    readPaths: typebox_exports.Optional(typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 1024 }), { maxItems: 64 })),
    writePaths: typebox_exports.Optional(typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 1024 }), { maxItems: 64 })),
    outputs: typebox_exports.Optional(typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 1024 }), { maxItems: 256 }))
  },
  { additionalProperties: false }
);
var ComputeLogChunkSchema = typebox_exports.Object(
  {
    jobId: ComputeIdSchema,
    cursor: typebox_exports.String({ minLength: 0, maxLength: 256 }),
    text: typebox_exports.String({ maxLength: 1048576 }),
    truncated: typebox_exports.Boolean(),
    at: typebox_exports.String({ minLength: 1, maxLength: 64 })
  },
  { additionalProperties: false }
);
var ComputeTerminalSchema = typebox_exports.Object(
  {
    id: ComputeIdSchema,
    hostId: ComputeIdSchema,
    jobId: typebox_exports.Optional(ComputeIdSchema),
    cwd: typebox_exports.String({ maxLength: 1024 }),
    mode: typebox_exports.Union([typebox_exports.Literal("shell"), typebox_exports.Literal("command")]),
    state: typebox_exports.Union([
      typebox_exports.Literal("connecting"),
      typebox_exports.Literal("open"),
      typebox_exports.Literal("needs_login"),
      typebox_exports.Literal("closed"),
      typebox_exports.Literal("error")
    ]),
    output: typebox_exports.String({ maxLength: 131072 }),
    truncated: typebox_exports.Boolean(),
    startedAt: typebox_exports.String({ minLength: 1, maxLength: 64 }),
    endedAt: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 64 }))
  },
  { additionalProperties: false }
);
var ComputeOnboardingStepSchema = typebox_exports.Union([
  typebox_exports.Literal("model"),
  typebox_exports.Literal("project"),
  typebox_exports.Literal("knowledge"),
  typebox_exports.Literal("literature"),
  typebox_exports.Literal("mcp"),
  typebox_exports.Literal("remote-host"),
  typebox_exports.Literal("example-task")
]);
var ComputeOnboardingStatusSchema = typebox_exports.Object(
  {
    step: ComputeOnboardingStepSchema,
    state: typebox_exports.Union([
      typebox_exports.Literal("ready"),
      typebox_exports.Literal("needs_action"),
      typebox_exports.Literal("not_configured"),
      typebox_exports.Literal("checking")
    ]),
    summary: typebox_exports.String({ maxLength: 512 }),
    checkedAt: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 64 })),
    action: typebox_exports.Optional(typebox_exports.String({ maxLength: 128 }))
  },
  { additionalProperties: false }
);
var ProfileId = typebox_exports.String({ minLength: 1, maxLength: 256 });
var ProfileAlias = typebox_exports.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" });
var ComputeHostProfileSchema = typebox_exports.Object(
  {
    alias: ProfileAlias,
    host: ProfileId,
    port: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1, maximum: 65535 })),
    username: typebox_exports.Optional(ProfileId),
    transport: typebox_exports.Optional(typebox_exports.Union([typebox_exports.Literal("builtin-ssh"), typebox_exports.Literal("openssh")])),
    identityFile: typebox_exports.Optional(typebox_exports.String({ minLength: 1 })),
    jumpHosts: typebox_exports.Optional(typebox_exports.Array(ProfileAlias, { maxItems: 8 })),
    hostKeyFingerprint: typebox_exports.Optional(typebox_exports.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);
var WorkflowModuleSchema = typebox_exports.Object(
  {
    id: ProfileId,
    source: typebox_exports.Union([typebox_exports.Literal("nf-core"), typebox_exports.Literal("user"), typebox_exports.Literal("agent")]),
    name: ProfileId,
    version: ProfileId,
    commit: typebox_exports.Optional(ProfileId),
    containerDigest: typebox_exports.Optional(ProfileId)
  },
  { additionalProperties: false }
);
var WorkflowStepSchema = typebox_exports.Object(
  {
    id: ProfileId,
    module: WorkflowModuleSchema,
    dependsOn: typebox_exports.Optional(typebox_exports.Array(ProfileId)),
    parameters: typebox_exports.Optional(
      typebox_exports.Record(typebox_exports.String(), typebox_exports.Union([typebox_exports.String(), typebox_exports.Number(), typebox_exports.Boolean()]))
    )
  },
  { additionalProperties: false }
);
var WorkflowSpecSchema = typebox_exports.Object(
  {
    version: typebox_exports.Literal(1),
    modules: typebox_exports.Array(WorkflowModuleSchema),
    steps: typebox_exports.Array(WorkflowStepSchema),
    inputs: typebox_exports.Optional(typebox_exports.Record(typebox_exports.String(), typebox_exports.String())),
    outputs: typebox_exports.Optional(typebox_exports.Array(typebox_exports.String()))
  },
  { additionalProperties: false }
);
var WorkflowRefSchema = typebox_exports.Object(
  {
    name: ProfileId,
    version: ProfileId,
    source: typebox_exports.Optional(ProfileId),
    specHash: typebox_exports.Optional(ProfileId)
  },
  { additionalProperties: false }
);
var ArtifactExpectationSchema = typebox_exports.Object(
  {
    path: typebox_exports.String({ minLength: 1 }),
    bytes: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    sha256: typebox_exports.Optional(typebox_exports.String({ pattern: "^[a-fA-F0-9]{64}$" })),
    maxBytes: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 }))
  },
  { additionalProperties: false }
);
var JobSpecSchema = typebox_exports.Object(
  {
    jobId: typebox_exports.Optional(ProfileId),
    idempotencyKey: typebox_exports.Optional(ProfileId),
    hostAlias: ProfileAlias,
    workflow: typebox_exports.Union([WorkflowSpecSchema, WorkflowRefSchema]),
    workDir: typebox_exports.Optional(typebox_exports.String({ minLength: 1 })),
    remoteWorkDir: typebox_exports.Optional(typebox_exports.String({ minLength: 1 })),
    resources: typebox_exports.Optional(
      typebox_exports.Object(
        {
          cpus: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1 })),
          memoryBytes: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
          wallTimeSeconds: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1 }))
        },
        { additionalProperties: false }
      )
    ),
    remoteRead: typebox_exports.Optional(typebox_exports.Array(typebox_exports.String())),
    remoteWrite: typebox_exports.Optional(typebox_exports.Array(typebox_exports.String())),
    outputs: typebox_exports.Optional(typebox_exports.Array(typebox_exports.Union([typebox_exports.String(), ArtifactExpectationSchema])))
  },
  { additionalProperties: false }
);

// packages/shared/src/discovery.ts
var DiscoveryKernelLanguageSchema = typebox_exports.Union([typebox_exports.Literal("python"), typebox_exports.Literal("r")]);
var DiscoveryDataClassificationSchema = typebox_exports.Union([
  typebox_exports.Literal("public"),
  typebox_exports.Literal("internal"),
  typebox_exports.Literal("controlled"),
  typebox_exports.Literal("restricted")
]);
var DiscoveryKernelStatusSchema = typebox_exports.Union([
  typebox_exports.Literal("ready"),
  typebox_exports.Literal("running"),
  typebox_exports.Literal("closed"),
  typebox_exports.Literal("idle-timeout"),
  typebox_exports.Literal("needs-container")
]);
var DiscoveryRunnerKindSchema = typebox_exports.Union([
  typebox_exports.Literal("container"),
  typebox_exports.Literal("fixture"),
  typebox_exports.Literal("unavailable")
]);
var DiscoveryCapabilitiesSchema = typebox_exports.Object(
  {
    kind: DiscoveryRunnerKindSchema,
    languages: typebox_exports.Array(DiscoveryKernelLanguageSchema, { maxItems: 2 }),
    networkDisabled: typebox_exports.Boolean(),
    writesOnlyToRunDirectory: typebox_exports.Boolean()
  },
  { additionalProperties: false }
);
var DiscoveryKernelSessionSchema = typebox_exports.Object(
  {
    sessionId: typebox_exports.String({ minLength: 1, maxLength: 128 }),
    language: DiscoveryKernelLanguageSchema,
    dataClassification: DiscoveryDataClassificationSchema,
    runDirectory: typebox_exports.String({ pattern: "^runs/" }),
    status: DiscoveryKernelStatusSchema,
    executionCount: typebox_exports.Integer({ minimum: 0 }),
    remainingExecutions: typebox_exports.Integer({ minimum: 0 }),
    expiresAt: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 64 })),
    capabilities: DiscoveryCapabilitiesSchema
  },
  { additionalProperties: false }
);
var DiscoveryExecutionSchema = typebox_exports.Object(
  {
    id: typebox_exports.String({ minLength: 1, maxLength: 128 }),
    status: typebox_exports.Union([typebox_exports.Literal("succeeded"), typebox_exports.Literal("failed"), typebox_exports.Literal("blocked")]),
    output: typebox_exports.String({ maxLength: 1e6 }),
    outputClassification: DiscoveryDataClassificationSchema,
    contentKinds: typebox_exports.Array(
      typebox_exports.Union([typebox_exports.Literal("summary"), typebox_exports.Literal("plot"), typebox_exports.Literal("table"), typebox_exports.Literal("raw")]),
      { maxItems: 4 }
    ),
    producedBytes: typebox_exports.Integer({ minimum: 0 }),
    redactedBytes: typebox_exports.Integer({ minimum: 0 }),
    blockedReason: typebox_exports.Optional(typebox_exports.String({ maxLength: 256 }))
  },
  { additionalProperties: false }
);
var DiscoveryCriticQuestionSchema = typebox_exports.Object(
  {
    checklistItem: typebox_exports.String({ minLength: 1, maxLength: 64 }),
    question: typebox_exports.String({ minLength: 1, maxLength: 1e4 }),
    severity: typebox_exports.Union([typebox_exports.Literal("high"), typebox_exports.Literal("medium"), typebox_exports.Literal("low")]),
    evidenceArtifactIds: typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 128 }), { maxItems: 128 })
  },
  { additionalProperties: false }
);
var DiscoveryCriticReviewSchema = typebox_exports.Object(
  {
    findingId: typebox_exports.String({ minLength: 1, maxLength: 128 }),
    status: typebox_exports.Union([
      typebox_exports.Literal("complete"),
      typebox_exports.Literal("blocked"),
      typebox_exports.Literal("needs-independent-provider")
    ]),
    providerId: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 128 })),
    questions: typebox_exports.Array(DiscoveryCriticQuestionSchema, { maxItems: 256 }),
    reason: typebox_exports.Optional(typebox_exports.String({ maxLength: 1e4 }))
  },
  { additionalProperties: false }
);
var DiscoveryMultipathAssessmentSchema = typebox_exports.Object(
  {
    planId: typebox_exports.String({ minLength: 1, maxLength: 128 }),
    findingId: typebox_exports.String({ minLength: 1, maxLength: 128 }),
    grade: typebox_exports.Union([
      typebox_exports.Literal("robust"),
      typebox_exports.Literal("sensitive"),
      typebox_exports.Literal("unstable"),
      typebox_exports.Literal("unknown")
    ]),
    intent: typebox_exports.Union([typebox_exports.Literal("exploratory"), typebox_exports.Literal("confirmatory")]),
    attemptCount: typebox_exports.Integer({ minimum: 0 }),
    consistentCount: typebox_exports.Integer({ minimum: 0 }),
    consistency: typebox_exports.Number({ minimum: 0, maximum: 1 })
  },
  { additionalProperties: false }
);
var DiscoveryExplorationPlanSchema = typebox_exports.Object(
  {
    id: typebox_exports.String({ minLength: 1, maxLength: 128 }),
    projectId: typebox_exports.String({ minLength: 1, maxLength: 128 }),
    hypothesisId: typebox_exports.String({ minLength: 1, maxLength: 128 }),
    prior: typebox_exports.Unknown(),
    budget: typebox_exports.Object(
      {
        maxExecutions: typebox_exports.Integer({ minimum: 1 }),
        maxWallTimeMs: typebox_exports.Integer({ minimum: 1 }),
        maxOutputBytes: typebox_exports.Integer({ minimum: 1 }),
        maxCostUnits: typebox_exports.Number({ exclusiveMinimum: 0 })
      },
      { additionalProperties: false }
    ),
    rankedCandidateIds: typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 128 }), { maxItems: 1024 }),
    createdAt: typebox_exports.String({ minLength: 1, maxLength: 64 })
  },
  { additionalProperties: false }
);
var DiscoveryEvaluationMetricSchema = typebox_exports.Union([
  typebox_exports.Literal("bixbench-regression"),
  typebox_exports.Literal("rediscovery-rate"),
  typebox_exports.Literal("inconsistency-interception-rate"),
  typebox_exports.Literal("confounder-detection-rate"),
  typebox_exports.Literal("clue-hit-rate"),
  typebox_exports.Literal("verification-time-ms"),
  typebox_exports.Literal("repeated-failure-count")
]);
var DiscoveryEvaluationSchema = typebox_exports.Object(
  {
    runId: typebox_exports.String({ minLength: 1, maxLength: 128 }),
    status: typebox_exports.Union([typebox_exports.Literal("complete"), typebox_exports.Literal("needs-data"), typebox_exports.Literal("blocked")]),
    startedAt: typebox_exports.String({ minLength: 1, maxLength: 64 }),
    finishedAt: typebox_exports.String({ minLength: 1, maxLength: 64 }),
    missingData: typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 128 }), { maxItems: 256 }),
    blockedCases: typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 128 }), { maxItems: 256 }),
    metrics: typebox_exports.Array(
      typebox_exports.Object(
        {
          metric: DiscoveryEvaluationMetricSchema,
          value: typebox_exports.Number({ minimum: 0 }),
          baseline: typebox_exports.Optional(typebox_exports.Number({ minimum: 0 })),
          delta: typebox_exports.Optional(typebox_exports.Number()),
          passed: typebox_exports.Boolean(),
          baselineAvailable: typebox_exports.Boolean(),
          caseIds: typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 128 }), { maxItems: 256 })
        },
        { additionalProperties: false }
      ),
      { maxItems: 16 }
    )
  },
  { additionalProperties: false }
);

// packages/shared/src/execution.ts
var ExecutionRouteSchema = typebox_exports.Object(
  {
    version: typebox_exports.Literal(1),
    routeId: typebox_exports.Literal("rnaseq"),
    /** Original user text, bounded for display and audit. */
    intent: typebox_exports.String({ minLength: 1, maxLength: 400 }),
    /** Stable task/workflow direction. */
    workflow: typebox_exports.Literal("rnaseq"),
    pipeline: typebox_exports.Literal("nf-core/rnaseq"),
    inputStage: typebox_exports.Literal("fastq"),
    profile: typebox_exports.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9_.-]+$" }),
    samplesheet: typebox_exports.String({ minLength: 1, maxLength: 1024 }),
    genome: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_.-]+$" })),
    outdir: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 1024 })),
    remoteWorkDir: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 1024 })),
    strandedness: typebox_exports.Optional(
      typebox_exports.Union([typebox_exports.Literal("unstranded"), typebox_exports.Literal("forward"), typebox_exports.Literal("reverse")])
    )
  },
  { additionalProperties: false }
);
var ComputeTaskBindingSchema = typebox_exports.Object(
  {
    version: typebox_exports.Literal(1),
    taskId: typebox_exports.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" }),
    routeId: typebox_exports.Literal("rnaseq"),
    workflowId: typebox_exports.Literal("rnaseq"),
    pipeline: typebox_exports.Literal("nf-core/rnaseq"),
    hostAlias: typebox_exports.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" }),
    workflowSpecSha256: typebox_exports.String({ pattern: "^[a-fA-F0-9]{64}$" }),
    samplesheet: typebox_exports.String({ minLength: 1, maxLength: 1024 }),
    outdir: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 1024 })),
    remoteWorkDir: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 1024 })),
    revision: typebox_exports.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9_.-]+$" }),
    profile: typebox_exports.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9_.-]+$" }),
    executionMode: typebox_exports.Union([typebox_exports.Literal("fixture"), typebox_exports.Literal("production")]),
    idempotencyKey: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 256 })),
    lineage: typebox_exports.Optional(CausalEnvelopeSchema)
  },
  { additionalProperties: false }
);
var ExecutionReceiptStatusSchema = typebox_exports.Union([
  typebox_exports.Literal("preflight_passed"),
  typebox_exports.Literal("submitted"),
  typebox_exports.Literal("queued"),
  typebox_exports.Literal("running"),
  typebox_exports.Literal("succeeded"),
  typebox_exports.Literal("failed"),
  typebox_exports.Literal("unknown"),
  typebox_exports.Literal("blocked")
]);
var ExecutionReceiptSchema = typebox_exports.Object(
  {
    version: typebox_exports.Literal(1),
    executionId: typebox_exports.String({ minLength: 1, maxLength: 128 }),
    status: ExecutionReceiptStatusSchema,
    fixture: typebox_exports.Boolean(),
    route: typebox_exports.Optional(ExecutionRouteSchema),
    binding: typebox_exports.Optional(ComputeTaskBindingSchema),
    workflowSpecSha256: typebox_exports.String({ pattern: "^[a-fA-F0-9]{64}$" }),
    preflight: typebox_exports.Object(
      {
        ok: typebox_exports.Boolean(),
        errors: typebox_exports.Array(typebox_exports.String({ maxLength: 512 }), { maxItems: 64 }),
        warnings: typebox_exports.Array(typebox_exports.String({ maxLength: 512 }), { maxItems: 64 })
      },
      { additionalProperties: false }
    ),
    jobId: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 128 })),
    remoteId: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 256 })),
    createdAt: typebox_exports.String({ minLength: 1, maxLength: 64 }),
    submittedAt: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 64 })),
    finishedAt: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 64 })),
    error: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 1024 })),
    lineage: typebox_exports.Optional(CausalEnvelopeSchema)
  },
  { additionalProperties: false }
);

// packages/shared/src/file-types.ts
var TEXT_KINDS = /* @__PURE__ */ new Set([
  "text",
  "code",
  "markdown",
  "json",
  "table",
  "notebook",
  "mermaid",
  "sequence",
  "alignment",
  "tree",
  "html",
  "svg",
  "typst",
  "latex",
  "molecule"
]);
var ROWS = [
  ["txt log out err fai dict", "text/plain", "text"],
  ["md markdown mdown rmd", "text/markdown", "markdown", "markdown"],
  ["json", "application/json", "json", "json"],
  ["jsonl ndjson", "application/x-ndjson", "code", "json"],
  ["csv", "text/csv", "table"],
  ["tsv gff gff3 gtf bed bedgraph vcf sam", "text/tab-separated-values", "table"],
  ["ipynb", "application/x-ipynb+json", "notebook", "json"],
  ["mmd mermaid", "text/vnd.mermaid", "mermaid", "mermaid"],
  ["fa fasta fna faa ffn frn fas fq fastq", "text/x-fasta", "sequence"],
  ["aln clustal clw sto stk stockholm phy phylip afa msa mfa", "text/plain", "alignment"],
  ["nwk newick tree treefile tre contree", "text/x-newick", "tree"],
  ["html htm", "text/html", "html", "html"],
  ["svg", "image/svg+xml", "svg", "xml"],
  ["typ", "text/x-typst", "typst", "typst"],
  ["tex latex", "text/x-latex", "latex", "latex"],
  ["pdb cif mmcif sdf mol mol2 xyz", "chemical/x-pdb", "molecule"],
  ["png", "image/png", "image"],
  ["jpg jpeg", "image/jpeg", "image"],
  ["gif", "image/gif", "image"],
  ["webp", "image/webp", "image"],
  ["bmp", "image/bmp", "image"],
  ["ico", "image/x-icon", "image"],
  ["avif", "image/avif", "image"],
  ["pdf", "application/pdf", "pdf"],
  ["mp3", "audio/mpeg", "audio"],
  ["wav", "audio/wav", "audio"],
  ["ogg oga", "audio/ogg", "audio"],
  ["flac", "audio/flac", "audio"],
  ["m4a aac", "audio/mp4", "audio"],
  ["mp4 m4v", "video/mp4", "video"],
  ["webm", "video/webm", "video"],
  ["mov", "video/quicktime", "video"],
  ["npy", "application/x-npy", "array"],
  ["stl", "model/stl", "mesh"],
  ["obj", "model/obj", "mesh"],
  ["tif tiff", "image/tiff", "tiff"],
  ["nii", "application/x-nifti", "volume"],
  ["mrc map rec ccp4", "application/x-mrc", "volume"],
  ["py pyi pyw ipy smk", "text/x-python", "code", "python"],
  ["r rprofile rhistory rscript", "text/x-r", "code", "r"],
  ["js mjs cjs", "text/javascript", "code", "javascript"],
  ["jsx", "text/javascript", "code", "jsx"],
  ["ts mts cts", "text/typescript", "code", "typescript"],
  ["tsx", "text/typescript", "code", "tsx"],
  ["yml yaml", "text/yaml", "code", "yaml"],
  ["toml", "text/toml", "code", "toml"],
  ["sh bash zsh", "text/x-shellscript", "code", "bash"],
  ["fish", "text/x-shellscript", "code", "fish"],
  ["ps1", "text/plain", "code", "powershell"],
  ["sql", "text/x-sql", "code", "sql"],
  ["c h", "text/x-c", "code", "c"],
  ["cpp hpp cc cxx", "text/x-c++", "code", "cpp"],
  ["java", "text/x-java", "code", "java"],
  ["go", "text/x-go", "code", "go"],
  ["rs", "text/x-rust", "code", "rust"],
  ["css", "text/css", "code", "css"],
  ["scss", "text/x-scss", "code", "scss"],
  ["xml", "application/xml", "code", "xml"],
  ["jl", "text/x-julia", "code", "julia"],
  ["nf", "text/plain", "code", "groovy"],
  ["zip tar 7z rar exe dll so dylib bin", "application/octet-stream", "binary"]
];
var RENDERED_WITH_SOURCE = /* @__PURE__ */ new Set([
  "markdown",
  "json",
  "table",
  "notebook",
  "mermaid",
  "sequence",
  "alignment",
  "tree",
  "html",
  "svg",
  "typst",
  "latex",
  "molecule"
]);
var REGISTRY = /* @__PURE__ */ new Map();
for (const [exts, mime, previewKind, language = "text"] of ROWS)
  for (const ext of exts.split(" "))
    REGISTRY.set(ext, {
      ext,
      mime,
      text: TEXT_KINDS.has(previewKind),
      language,
      previewKind,
      hasSource: RENDERED_WITH_SOURCE.has(previewKind)
    });
var UNKNOWN_FILE_TYPE = Object.freeze({
  ext: "",
  mime: "application/octet-stream",
  text: false,
  language: "text",
  previewKind: "binary",
  hasSource: false
});

// packages/shared/src/harness.ts
var HARNESS_CONTRACT = [
  "Drone harness contract:",
  "- Inspect before assuming: read the relevant files, specifications, and tool results before choosing a method.",
  "- Verify important claims, numbers, and outputs against current evidence or measured results.",
  "- Preserve source data and existing work; keep partial results and state the blocker when a step fails.",
  "- Track the requested deliverables and check the final files under the conditions that will consume them.",
  "- Report evidence and limitations, unresolved questions, and the next observable action precisely.",
  "- Use the available tools and permissions; do not claim work, evidence, or review that did not happen.",
  "- Keep progress updates concise and public. The final answer follows the answer mode below; for code or file work it also names the changed files and checks run.",
  "- Private reasoning stays private; expose actions, observations, decisions, and conclusions that the evidence supports."
].join("\n");
var SCIENCE_CONTRACT = [
  "Scientific contract:",
  "- Inspect relevant files, data, and source records before assuming or fitting.",
  "- Keep observations, interpretations, hypotheses, and unknowns separate.",
  "- Check numbers and generated outputs against the current source or a fresh run.",
  "- Preserve source data and write new results beside existing work; do not silently overwrite or delete.",
  "- Treat simulated data, teacher outputs, pseudo-labels, and self-generated validators as assumptions, not real-world error checks.",
  "- State missing evidence, failed checks, and remaining limitations in the final answer."
].join("\n");
var RESPONSE_CONTRACT = [
  "Response contract:",
  "- Progress narration between tools is short and only reports a new observation, choice, result, or blocker.",
  "- The final answer is the user-facing answer; its length and structure follow the answer mode.",
  "- Never claim a file was saved, a source was read, or a check passed unless the host returned that evidence.",
  "- Keep private reasoning private; expose observable actions, evidence, decisions, and conclusions."
].join("\n");
var OVERLOOKED_POINTS_RULE = 'Only if you found something substantive, end with a short section titled "\u53EF\u80FD\u88AB\u5FFD\u7565\u7684\u70B9" (or "Possibly overlooked" in English) with at most 3 items the user did not ask about: a contradiction between sources, an untested combination, a method from another field, a questionable default assumption, or a next implication of the conclusion. Mark each item as speculative, name its basis (a specific note or paper) and say what experiment or data would test it. Omit the section entirely rather than padding it.';
var QUICK_ANSWER_CONTRACT = [
  "Answer mode: quick.",
  "- Answer the question directly in a few sentences or a short list; no headings.",
  "- Keep only the caveat that changes how the answer should be used.",
  "- Cite a source (Vault path, DOI or URL) only for a specific fact that depends on it; never invent one."
].join("\n");
var ACADEMIC_ANSWER_CONTRACT = [
  "Answer mode: academic. Write the final answer as a scholarly synthesis, in the user's language:",
  "- Structure it as Background and question \u2192 Methods and evidence \u2192 Conclusion, with short headings.",
  "- Cite each substantive claim inline as (Author, Year). End with a numbered References list: authors, year, title, venue, DOI; when the reference has a note in the local Vault, add its Vault path.",
  "- Grade every claim explicitly as established (replicated or consensus), supported by evidence (one or a few studies), or speculative (hypothesis or inference); never upgrade weak evidence.",
  "- Use precise terms, units and numbers together with their conditions (organism, sample size, method) instead of vague qualifiers.",
  "- Never invent a reference, DOI, author or number. If a citation could not be checked against a source you actually read, say so next to it.",
  "- Say which parts came from the local knowledge base and which from the web.",
  `- ${OVERLOOKED_POINTS_RULE}`
].join("\n");

// packages/shared/src/host-api/define.ts
function defineDomain(name, spec) {
  const methods = Object.fromEntries(
    Object.entries(spec.methods).map(([methodName, method]) => [
      methodName,
      { ...method, access: method.access ?? "desktop" }
    ])
  );
  return {
    name,
    methods,
    events: spec.events ?? {}
  };
}

// packages/shared/src/decisions.ts
var DecisionKindSchema = typebox_exports.Union([
  typebox_exports.Literal("task-authorization"),
  typebox_exports.Literal("workflow-repair"),
  typebox_exports.Literal("subagent-dispatch"),
  typebox_exports.Literal("compute-submit"),
  typebox_exports.Literal("zotero-write"),
  typebox_exports.Literal("rebind")
]);
var DecisionRecordSchema = typebox_exports.Object(
  {
    id: typebox_exports.String({ minLength: 1, maxLength: 256 }),
    schemaVersion: typebox_exports.Literal(2),
    projectId: typebox_exports.String({ minLength: 1, maxLength: 512 }),
    kind: DecisionKindSchema,
    summary: typebox_exports.String({ minLength: 1, maxLength: 2e3 }),
    basis: typebox_exports.Array(typebox_exports.String({ maxLength: 512 }), { maxItems: 32 }),
    affectedArtifactIds: typebox_exports.Array(typebox_exports.String({ maxLength: 256 }), { maxItems: 512 }),
    status: typebox_exports.Union([typebox_exports.Literal("active"), typebox_exports.Literal("revoked")]),
    revokedAt: typebox_exports.Optional(typebox_exports.String()),
    revokeReason: typebox_exports.Optional(typebox_exports.String({ maxLength: 2e3 })),
    createdAt: typebox_exports.String()
  },
  { additionalProperties: false }
);
var ProjectIdArgs = typebox_exports.Tuple([typebox_exports.String({ minLength: 1, maxLength: 512 })]);
var RevokeArgs = typebox_exports.Tuple([
  typebox_exports.String({ minLength: 1, maxLength: 256 }),
  typebox_exports.String({ minLength: 1, maxLength: 2e3 })
]);
var ConfirmArgs = typebox_exports.Tuple([
  typebox_exports.String({ minLength: 1, maxLength: 256 }),
  typebox_exports.String({ minLength: 1, maxLength: 2e3 })
]);
var DecisionsContract = defineDomain("decisions", {
  methods: {
    list: {
      args: ProjectIdArgs,
      result: typebox_exports.Array(DecisionRecordSchema, { maxItems: 4096 })
    },
    revoke: {
      args: RevokeArgs,
      result: DecisionRecordSchema
    },
    confirm: {
      args: ConfirmArgs,
      result: DecisionRecordSchema
    }
  },
  events: {}
});

// packages/shared/src/host-api/app.ts
var AppInfoSchema = typebox_exports.Object(
  {
    name: typebox_exports.String(),
    version: typebox_exports.String(),
    electron: typebox_exports.String(),
    chrome: typebox_exports.String(),
    node: typebox_exports.String(),
    platform: typebox_exports.String(),
    arch: typebox_exports.String(),
    repoUrl: typebox_exports.String()
  },
  { additionalProperties: false }
);
var DiagnosticsSnapshotSchema = typebox_exports.Unsafe({ type: "object" });
var SavedTabsSchema = typebox_exports.Unsafe({ type: "object" });
var UiStateSchema = typebox_exports.Unsafe({ type: "object" });
var ResourcePreviewResultSchema = typebox_exports.Unsafe({ type: "object" });
var FigureAnnotationSchema = typebox_exports.Unsafe(
  typebox_exports.Object(
    {
      id: typebox_exports.String({ minLength: 1, maxLength: 64 }),
      x: typebox_exports.Number({ minimum: 0, maximum: 1 }),
      y: typebox_exports.Number({ minimum: 0, maximum: 1 }),
      text: typebox_exports.String({ maxLength: 2e3 }),
      createdAt: typebox_exports.String({ maxLength: 64 })
    },
    { additionalPropertieë¾}Ù¼­zÊ&ŠÛ^u½ÉÑÌ¹QÕÁ±”¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¥t¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹Í…™”¡M•ÍÍ¥½¹5•Ñ…M¡•µ„¤(€€€ô°(€€€±½Í•M•ÍÍ¥½¸èì…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%Ét¤°É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹Y½¥ ¤ô°(€€€‘•±•Ñ•M•ÍÍ¥½¸èì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%Ét¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%È°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¥t¥t¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹Y½¥ ¤(€€€ô°(€€€ÁÉ½µÁÐèì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡l(€€€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%È°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¥t¤°(€€€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%È°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹ÉÉ…ä¡%µ…•%¹ÁÕÑM¡•µ„¥t¤°(€€€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%È°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹ÉÉ…ä¡%µ…•%¹ÁÕÑM¡•µ„¤°AÉ½µÁÑ%‘ÍM¡•µ…t¤(€€€€€t¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹Í…™”¡AÉ½µÁÑI••¥ÁÑM¡•µ„¤(€€€ô°(€€€…‰½ÉÐèì…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%Ét¤°É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹Y½¥ ¤ô°(€€€É•ÑÉäèì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%È°%Ét¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%È°%È°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹9Õµ‰•È ¥t¥t¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹Í…™”¡AÉ½µÁÑI••¥ÁÑM¡•µ„¤(€€€ô°(€€€Í•Ñ5½‘•°èì…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%È°%È°%Ét¤°É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹Y½¥ ¤ô°(€€€Í•ÑQ¡¥¹­¥¹1•Ù•°èì…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%È°%Ét¤°É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹Y½¥ ¤ô°(€€€€¼¨¨@Äã¾òkš¢‡–ò?–6Ï–Þ—–ßžf÷–B7–6W¾ò!Í¥¹±”€¼±•…€¼ÍÝ…É·¾ò'¾òo¢þS–n{šr³š²‡–Š{–?žj–Þ—–ß¾ò3’úlU$ƒš>Cž’è€¨¼(€€€Í•Ñ•¹Ñ5½‘”èì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡l(€€€€€€€%È°(€€€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰Í¥¹±”ˆ¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰±•…ˆ¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰ÍÝ…É´ˆ¥t¤(€€€€€t¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð (€€€€€€€ì…‘‘•èÑåÁ•‰½á}•áÁ½ÉÑÌ¹ÉÉ…ä¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°É•µ½Ù•èÑåÁ•‰½á}•áÁ½ÉÑÌ¹ÉÉ…ä¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤ô°(€€€€€€€ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô(€€€€€€¤(€€€ô°(€€€½µÁ…Ðèì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%Ét¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%È°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¥t¥t¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹Y½¥ ¤(€€€ô°(€€€•ÑMÑ…ÑÌèì…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%Ét¤°É•ÍÕ±Ðè=‰©•ÑI•ÍÕ±ÐÈ ¤ô°(€€€•Ñ½¹Ñ•áÑUÍ…”èì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%Ét¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹9Õ±° ¤°=‰©•ÑI•ÍÕ±ÐÈ ¥t¤(€€€ô°(€€€±•…ÉEÕ•Õ”èì…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%Ét¤°É•ÍÕ±ÐèEÕ•Õ•‘5•ÍÍ…•ÍM¡•µ„ô°(€€€•Ñ½±±½ÝUÁ5•ÍÍ…•Ìèì…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%Ét¤°É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹ÉÉ…ä¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤ô°(€€€±¥ÍÑM±…Í¡½µµ…¹‘Ìèì…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%Ét¤°É•ÍÕ±ÐèÉÉ…åI•ÍÕ±ÐÈ ¤ô°(€€€±¥ÍÑM±…Í¡½µµ…¹‘Í½ÉÝèì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mt¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¥t¥t¤°(€€€€€É•ÍÕ±ÐèÉÉ…åI•ÍÕ±ÐÈ ¤(€€€ô°(€€€Í•ÑM•ÍÍ¥½¹9…µ”èì…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%È°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¥t¤°É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹Y½¥ ¤ô°(€€€•áÁ½ÉÑM•ÍÍ¥½¸èì…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%È°áÁ½ÉÑ½Éµ…ÑM¡•µ…t¤°É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤ô°(€€€™½É­M•ÍÍ¥½¸èì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%È°½É­I•™M¡•µ…t¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹Í…™”¡M•ÍÍ¥½¹5•Ñ…M¡•µ„¤(€€€ô°(€€€É•…±±5•ÍÍ…”èì…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%È°I•…±±I•™M¡•µ…t¤°É•ÍÕ±ÐèI•…±±I•ÍÕ±ÑM¡•µ„ô°(€€€•Ñ1½…‘•‘I•Í½ÕÉ•Ìèì…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%Ét¤°É•ÍÕ±Ðè=‰©•ÑI•ÍÕ±ÐÈ ¤ô°(€€€•ÑM•ÍÍ¥½¹5•ÍÍ…•Ìèì…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%Ét¤°É•ÍÕ±ÐèÉÉ…åI•ÍÕ±ÐÈ ¤ô°(€€€Á••­MÕ‰…•¹Ñ5•ÍÍ…•Ìèì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¥t¤°(€€€€€É•ÍÕ±ÐèÉÉ…åI•ÍÕ±ÐÈ ¤(€€€ô°(€€€ÍÑ••ÉMÕ‰…•¹Ðèì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡l(€€€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%È°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¥t¤°(€€€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%È°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰ÍÑ••Èˆ¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰™½±±½ÝUÀˆ¥t¥t¤(€€€€€t¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹Y½¥ ¤(€€€ô°(€€€É•Á±åMÕ‰…•¹ÑMÕÁ•ÉÙ¥Í½Èèì…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%È°%È°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¥t¤°É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹Y½¥ ¤ô°(€€€•ÑQ½‘½Ìèì…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡m%Ét¤°É•ÍÕ±ÐèÉÉ…åI•ÍÕ±ÐÈ ¤ô°(€€€±¥ÍÑ5½‘•±Ìèì…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mt¤°É•ÍÕ±ÐèÉÉ…åI•ÍÕ±ÐÈ ¤ô°(€€€±¥ÍÑAÉ½©•Ñ¥±•Ìèì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mt¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¥t¥t¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹ÉÉ…ä¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤(€€€ô°(€€€•¹ÍÕÉ•AÉ½©•ÑQÉÕÍÐèì…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¥t¤°É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤ô(€ô)ô¤ì((¼¼Á…­…•Ì½Í¡…É•½ÍÉŒ½¡½ÍÐµ…Á¤½Í•ÑÑ¥¹Ì¹ÑÌ)Ù…ÈMÑÉ¥¹%€ôÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤ì)Ù…ÈAÉ½Ù¥‘•É=ÁÑ¥½¹Ì€ôÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð (€ì™½É•9•ÑÝ½É¬èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤¤ô°(€ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô(¤ì)Ù…ÈAÉ½Ù¥‘•É5½‘•°€ôÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð (€ì(€€€¥èMÑÉ¥¹%°(€€€¹…µ”èMÑÉ¥¹%°(€€€É•…Í½¹¥¹œèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤¤°(€€€½¹Ñ•áÑ]¥¹‘½ÜèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹9Õµ‰•È¡ìµ¥¹¥µÕ´è€Àô¤¤°(€€€µ…áQ½­•¹ÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹9Õµ‰•È¡ìµ¥¹¥µÕ´è€Àô¤¤°(€€€¥µ…•%¹ÁÕÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤¤(€ô°(€ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô(¤ì)Ù…ÈAÉ½Ù¥‘•É%¹™½M¡•µ„€ôÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð (€ì(€€€¥èMÑÉ¥¹%°(€€€¹…µ”èÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤°(€€€ÕÍÑ½´èÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤°(€€€½Ù•ÉÉ¥‘•Í	Õ¥±Ñ¥¸èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤¤°(€€€½¹™¥ÕÉ•èÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤°(€€€…ÕÑ¡M½ÕÉ”èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°(€€€…ÕÑ¡1…‰•°èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°(€€€½…ÕÑ èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…° (€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð (€€€€€€€ì±½¥¹1…‰•°èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°¥ÍMÕ‰ÍÉ¥ÁÑ¥½¸èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤¤ô°(€€€€€€€ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô(€€€€€€¤(€€€€¤°(€€€…Á¥-•å1½¥¸èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤¤°(€€€‰…Í•UÉ°èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°(€€€…Á¤èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°(€€€ÕÍÑ½µ5½‘•±ÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…° (€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹ÉÉ…ä (€€€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð (€€€€€€€€€ì(€€€€€€€€€€€¥èMÑÉ¥¹%°(€€€€€€€€€€€¹…µ”èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°(€€€€€€€€€€€É•…Í½¹¥¹œèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤¤°(€€€€€€€€€€€½¹Ñ•áÑ]¥¹‘½ÜèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹9Õµ‰•È¡ìµ¥¹¥µÕ´è€Àô¤¤°(€€€€€€€€€€€µ…áQ½­•¹ÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹9Õµ‰•È¡ìµ¥¹¥µÕ´è€Àô¤¤°(€€€€€€€€€€€¥µ…•%¹ÁÕÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤¤(€€€€€€€€€ô°(€€€€€€€€€ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô(€€€€€€€€¤(€€€€€€¤(€€€€¤°(€€€µ½‘•±ÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹ÉÉ…ä¡AÉ½Ù¥‘•É5½‘•°¤(€ô°(€ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô(¤ì)Ù…È5½‘•±AÉ•™ÍM¡•µ„€ôÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð (€ì(€€€¡¥‘‘•¹5½‘•±ÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹I•½É¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹ÉÉ…ä¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤¤°(€€€ÍÕ‰…•¹Ñ5½‘•±ÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹I•½É¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°(€€€ÍÕ‰…•¹ÑQ¡¥¹­¥¹œèÑåÁ•‰½á}•áÁ½ÉÑÌ¹I•½É (€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤°(€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡l(€€€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰½™˜ˆ¤°(€€€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰µ¥¹¥µ…°ˆ¤°(€€€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰±½Üˆ¤°(€€€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰µ•‘¥Õ´ˆ¤°(€€€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰¡¥ ˆ¤°(€€€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰á¡¥ ˆ¤°(€€€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰µ…àˆ¤(€€€€€t¤(€€€€¤°(€€€‰…­É½Õ¹‘I•Ù¥•Ý•É5½‘•°èÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤(€ô°(€ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô(¤ì)Ù…ÈÕÍÑ½µ5½‘•°€ôÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð (€ì(€€€¥èMÑÉ¥¹%°(€€€¹…µ”èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°(€€€É•…Í½¹¥¹œèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤¤°(€€€½¹Ñ•áÑ]¥¹‘½ÜèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹9Õµ‰•È¡ìµ¥¹¥µÕ´è€Àô¤¤°(€€€µ…áQ½­•¹ÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹9Õµ‰•È¡ìµ¥¹¥µÕ´è€Àô¤¤°(€€€¥µ…•%¹ÁÕÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤¤(€ô°(€ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô(¤ì)Ù…ÈÕÍÑ½µAÉ½Ù¥‘•È€ôÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð (€ì(€€€¥èMÑÉ¥¹%°(€€€¹…µ”èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°(€€€‰…Í•UÉ°èÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤°(€€€…Á¤èÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤°(€€€µ½‘•±ÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹ÉÉ…ä¡ÕÍÑ½µ5½‘•°¤°(€€€…Á¥-•äèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤(€ô°(€ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô(¤ì)Ù…ÈMÕ‰…•¹Ñ%¹™½M¡•µ„€ôÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð (€ì(€€€¹…µ”èMÑÉ¥¹%°(€€€‘•ÍÉ¥ÁÑ¥½¸èÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤°(€€€Í½ÕÉ”èÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰‰Õ¥±Ñ¥¸ˆ¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰ÕÍ•Èˆ¥t¤(€ô°(€ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô(¤ì)Ù…È1½¥¹I•ÍÕ±ÑM¡•µ„€ôÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð (€ì½¬èÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤°…¹•±±•èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤¤°•ÉÉ½ÈèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤ô°(€ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô(¤ì)Ù…ÈAÉ½Ù¥‘•ÉQ•ÍÑI•ÍÕ±ÑM¡•µ„€ôÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð (€ì½¬èÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤°•ÉÉ½ÈèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°µ½‘•±%èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤ô°(€ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô(¤ì)Ù…ÈM•ÑÑ¥¹Í½¹ÑÉ…Ð€ô‘•™¥¹•½µ…¥¸ ‰Í•ÑÑ¥¹Ìˆ°ì(€µ•Ñ¡½‘Ìèì(€€€±¥ÍÑAÉ½Ù¥‘•ÉÌèì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mt¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mAÉ½Ù¥‘•É=ÁÑ¥½¹Ít¥t¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹ÉÉ…ä¡AÉ½Ù¥‘•É%¹™½M¡•µ„¤(€€€ô°(€€€Í…Ù•Á¥-•äèì…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mMÑÉ¥¹%°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¥t¤°É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹Y½¥ ¤ô°(€€€É•µ½Ù•É•‘•¹Ñ¥…°èì…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mMÑÉ¥¹%‘t¤°É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹Y½¥ ¤ô°(€€€…‘‘ÕÍÑ½µAÉ½Ù¥‘•Èèì…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mÕÍÑ½µAÉ½Ù¥‘•Ét¤°É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹Y½¥ ¤ô°(€€€ÕÁ‘…Ñ•ÕÍÑ½µAÉ½Ù¥‘•Èèì…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mÕÍÑ½µAÉ½Ù¥‘•Ét¤°É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹Y½¥ ¤ô°(€€€É•µ½Ù•ÕÍÑ½µAÉ½Ù¥‘•Èèì…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mMÑÉ¥¹%‘t¤°É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹Y½¥ ¤ô°(€€€Í•ÑAÉ½Ù¥‘•É	…Í•UÉ°èì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡l(€€€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mMÑÉ¥¹%°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¥t¤°(€€€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mMÑÉ¥¹%°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¥t¤(€€€€€t¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹Y½¥ ¤(€€€ô°(€€€Ñ•ÍÑAÉ½Ù¥‘•Èèì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mMÑÉ¥¹%‘t¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mMÑÉ¥¹%°MÑÉ¥¹%‘t¥t¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹Í…™”¡AÉ½Ù¥‘•ÉQ•ÍÑI•ÍÕ±ÑM¡•µ„¤(€€€ô°(€€€•Ñ5½‘•±AÉ•™Ìèì…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mt¤°É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹Í…™”¡5½‘•±AÉ•™ÍM¡•µ„¤ô°(€€€Í•Ñ5½‘•±!¥‘‘•¸èì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mMÑÉ¥¹%°MÑÉ¥¹%°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¥t¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹Í…™”¡5½‘•±AÉ•™ÍM¡•µ„¤(€€€ô°(€€€Í•Ñ5½‘•±Í!¥‘‘•¸èì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mMÑÉ¥¹%°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹ÉÉ…ä¡MÑÉ¥¹%¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¥t¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹Í…™”¡5½‘•±AÉ•™ÍM¡•µ„¤(€€€ô°(€€€Í•ÑMÕ‰…•¹Ñ5½‘•°èì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mMÑÉ¥¹%°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹9Õ±° ¥t¥t¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹Í…™”¡5½‘•±AÉ•™ÍM¡•µ„¤(€€€ô°(€€€Í•ÑMÕ‰…•¹ÑQ¡¥¹­¥¹œèì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mMÑÉ¥¹%°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹9Õ±° ¥t¥t¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹Í…™”¡5½‘•±AÉ•™ÍM¡•µ„¤(€€€ô°(€€€Í•Ñ	…­É½Õ¹‘I•Ù¥•Ý•É5½‘•°èì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¥t¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹Í…™”¡5½‘•±AÉ•™ÍM¡•µ„¤(€€€ô°(€€€±¥ÍÑMÕ‰…•¹ÑÌèì…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mt¤°É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹ÉÉ…ä¡MÕ‰…•¹Ñ%¹™½M¡•µ„¤ô°(€€€ÍÑ…ÉÑAÉ½Ù¥‘•É1½¥¸èì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mMÑÉ¥¹%°MÑÉ¥¹%‘t¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹Í…™”¡1½¥¹I•ÍÕ±ÑM¡•µ„¤(€€€ô°(€€€…¹•±AÉ½Ù¥‘•É1½¥¸èì…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mMÑÉ¥¹%‘t¤°É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹Y½¥ ¤ô°(€€€É•ÍÁ½¹‘AÉ½Ù¥‘•É1½¥¸èì…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mMÑÉ¥¹%°MÑÉ¥¹%°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¥t¤°É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹Y½¥ ¤ô(€ô)ô¤ì((¼¼Á…­…•Ì½Í¡…É•½ÍÉŒ½¡½ÍÐµ…Á¤½ÍÕ‰…•¹ÑÌ¹ÑÌ)Ù…ÈMÕ‰…•¹ÑA…¹•±M½ÕÉ•M¡•µ„€ôÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡l(€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰‰Õ¥±Ñ¥¸ˆ¤°(€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰ÕÍ•Èˆ¤°(€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰ÁÉ½©•Ðˆ¤)t¤ì)Ù…ÈMÕ‰…•¹ÑA…¹•±IÕ¹MÑ…ÑÕÍM¡•µ„€ôÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡l(€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰ÅÕ•Õ•ˆ¤°(€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰ÉÕ¹¹¥¹œˆ¤°(€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰¹••‘Í}É•Á±äˆ¤°(€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰Ý…¥Ñ¥¹}…ÁÁÉ½Ù…°ˆ¤°(€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰‘½¹”ˆ¤°(€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰•ÉÉ½Èˆ¤°(€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰…‰½ÉÑ•ˆ¤)t¤ì)Ù…ÈMÕ‰…•¹ÑA…¹•±½¹Ñ•áÑMÑ…Ñ•M¡•µ„€ôÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡l(€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰¹½¹”ˆ¤°(€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰Á•¹‘¥¹œˆ¤°(€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰‘•±¥Ù•É•ˆ¤)t¤ì)Ù…ÈMÕÁ•ÉÙ¥Í½ÉI•ÅÕ•ÍÑM¡•µ„€ôÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð (€ì(€€€¥èÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤°(€€€É•…Í½¸èÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡l(€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰¹••‘}‘•¥Í¥½¸ˆ¤°(€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰¥¹Ñ•ÉÙ¥•Ý}É•ÅÕ•ÍÐˆ¤°(€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰ÁÉ½É•ÍÍ}ÕÁ‘…Ñ”ˆ¤(€€€t¤°(€€€µ•ÍÍ…”èÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤°(€€€•áÁ•ÑÍI•Á±äèÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤(€ô°(€ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô(¤ì)Ù…ÈMÕ‰…•¹ÑA…¹•±•¹ÑM¡•µ„€ôÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð (€ì(€€€¹…µ”èÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤°(€€€‘•ÍÉ¥ÁÑ¥½¸èÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤°(€€€Í½ÕÉ”èMÕ‰…•¹ÑA…¹•±M½ÕÉ•M¡•µ„°(€€€Ñ½½±ÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹ÉÉ…ä¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°(€€€µ½‘•°èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°(€€€µÁ•ÍÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰¹½¹”ˆ¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰É•…µ±½…°ˆ¥t¤°(€€€ÑÉÕÍÑ•èÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤°(€€€Á…Ñ èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤(€ô°(€ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô(¤ì)Ù…ÈMÕ‰…•¹ÑA…¹•±M¹…ÁÍ¡½ÑM¡•µ„€ôÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð (€ì(€€€Í•ÍÍ¥½¹%èÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤°(€€€ÝèÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤°(€€€…•¹ÑÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹ÉÉ…ä¡MÕ‰…•¹ÑA…¹•±•¹ÑM¡•µ„¤°(€€€µ…á½¹ÕÉÉ•¹ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹%¹Ñ••È¡ìµ¥¹¥µÕ´è€Äô¤°(€€€ÁÉ½©•ÑQÉÕÍÑ•èÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤°(€€€ÕÍ•É•¹ÑÍ¥ÈèÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤°(€€€ÁÉ½©•Ñ•¹ÑÍ¥ÈèÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤°(€€€É•…‘=¹±äèÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤(€ô°(€ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô(¤ì)Ù…ÈMÕ‰…•¹Ñ¥ÍÁ…Ñ¡Q…Í­M¡•µ„€ôÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð (€ì(€€€…•¹ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤°(€€€Ñ…Í¬èÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤°(€€€É•ÅÕ¥É•‘Q½½±ÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹ÉÉ…ä¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤¤¤(€ô°(€ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô(¤ì)Ù…ÈMÕ‰…•¹Ñ¥ÍÁ…Ñ¡%¹ÁÕÑM¡•µ„€ôÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð (€ì(€€€Ñ…Í­ÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹ÉÉ…ä¡MÕ‰…•¹Ñ¥ÍÁ…Ñ¡Q…Í­M¡•µ„°ìµ¥¹%Ñ•µÌè€Ä°µ…á%Ñ•µÌè€àô¤°(€€€ÝèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤¤°(€€€™½±±½ÝUÀèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤¤°(€€€ÑÉÕÍÑAÉ½©•Ñ•¹ÑÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤¤(€ô°(€ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô(¤ì)Ù…ÈMÕ‰…•¹ÑA…¹•±IÕ¹M¡•µ„€ôÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð (€ì(€€€ÉÕ¹%èÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤°(€€€‘¥ÍÁ…Ñ¡%èÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤°(€€€Á…É•¹ÑM•ÍÍ¥½¹%èÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤°(€€€…•¹ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤°(€€€Í½ÕÉ”èMÕ‰…•¹ÑA…¹•±M½ÕÉ•M¡•µ„°(€€€Ñ…Í¬èÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤°(€€€ÝèÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤°(€€€É•ÅÕ¥É•‘Q½½±ÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹ÉÉ…ä¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤¤°(€€€™½±±½ÝUÀèÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤°(€€€ÍÑ…ÑÕÌèMÕ‰…•¹ÑA…¹•±IÕ¹MÑ…ÑÕÍM¡•µ„°(€€€½¹Ñ•áÑMÑ…Ñ”èMÕ‰…•¹ÑA…¹•±½¹Ñ•áÑMÑ…Ñ•M¡•µ„°(€€€ÅÕ•Õ•A½Í¥Ñ¥½¸èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹%¹Ñ••È¡ìµ¥¹¥µÕ´è€Äô¤¤°(€€€É•…Ñ•‘ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹9Õµ‰•È ¤°(€€€ÍÑ…ÉÑ•‘ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹9Õµ‰•È ¤¤°(€€€•¹‘•‘ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹9Õµ‰•È ¤¤°(€€€¡¥±‘M•ÍÍ¥½¹%èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤¤°(€€€Í•ÍÍ¥½¹¥±”èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤¤°(€€€µ½‘•°èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°(€€€Ñ½­•¹ÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹9Õµ‰•È¡ìµ¥¹¥µÕ´è€Àô¤¤°(€€€•á¥Ñ½‘”èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹%¹Ñ••È ¤¤°(€€€•ÉÉ½ÈèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°(€€€½¹Ñ•¹ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°(€€€ÍÑ…ÑÕÍQ•áÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°(€€€ÍÑ…ÑÕÍA¡…Í”èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°(€€€ÕÉÉ•¹ÑÑ¥½¸èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°(€€€ÕÉÉ•¹ÑQ½½°èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°(€€€±…ÍÑMÑ••ÉÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹9Õµ‰•È ¤¤°(€€€ÍÕÁ•ÉÙ¥Í½ÉI•ÅÕ•ÍÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡mMÕÁ•ÉÙ¥Í½ÉI•ÅÕ•ÍÑM¡•µ„°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹9Õ±° ¥t¤¤°(€€€Á•¹‘¥¹ÁÁÉ½Ù…±%‘ÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹ÉÉ…ä¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤¤(€ô°(€ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô(¤ì)Ù…ÈMÕ‰…•¹Ñ¥ÍÁ…Ñ¡I••¥ÁÑM¡•µ„€ôÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð (€ì(€€€‘¥ÍÁ…Ñ¡%èÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤°(€€€ÉÕ¹ÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹ÉÉ…ä¡MÕ‰…•¹ÑA…¹•±IÕ¹M¡•µ„¤(€ô°(€ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô(¤ì)Ù…ÈMÕ‰…•¹ÑÍ½¹ÑÉ…Ð€ô‘•™¥¹•½µ…¥¸ ‰ÍÕ‰…•¹ÑÌˆ°ì(€µ•Ñ¡½‘Ìèì(€€€±¥ÍÐèì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¥t¤°(€€€€€É•ÍÕ±ÐèMÕ‰…•¹ÑA…¹•±M¹…ÁÍ¡½ÑM¡•µ„(€€€ô°(€€€‘¥ÍÁ…Ñ èì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤°MÕ‰…•¹Ñ¥ÍÁ…Ñ¡%¹ÁÕÑM¡•µ…t¤°(€€€€€É•ÍÕ±ÐèMÕ‰…•¹Ñ¥ÍÁ…Ñ¡I••¥ÁÑM¡•µ„(€€€ô°(€€€…‰½ÉÐèì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¥t¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤(€€€ô°(€€€ÉÕ¹Ìèì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¥t¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹ÉÉ…ä¡MÕ‰…•¹ÑA…¹•±IÕ¹M¡•µ„¤(€€€ô(€ô)ô¤ì((¼¼Á…­…•Ì½Í¡…É•½ÍÉŒ½¡½ÍÐµ…Á¤½Õ¤µÁ±Õ¥¹Ì¹ÑÌ)Ù…ÈU¥A±Õ¥¹¹¡½ÉM¡•µ„€ôÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡l(€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰Ñ½Àµ±•™Ðˆ¤°(€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰Ñ½Àµ•¹Ñ•Èˆ¤°(€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰Ñ½ÀµÉ¥¡Ðˆ¤°(€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰•¹Ñ•Èµ±•™Ðˆ¤°(€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰•¹Ñ•Èˆ¤°(€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰•¹Ñ•ÈµÉ¥¡Ðˆ¤°(€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰‰½ÑÑ½´µ±•™Ðˆ¤°(€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰‰½ÑÑ½´µ•¹Ñ•Èˆ¤°(€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰‰½ÑÑ½´µÉ¥¡Ðˆ¤)t¤ì)Ù…ÈU¥A±Õ¥¹½¹ÑÉ¥‰ÕÑ¥½¹M¡•µ„€ôÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð (€ì(€€€¥èÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤°(€€€É•¥½¸èÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤°(€€€•áÁ½ÉÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤°(€€€…¹¡½ÈèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡U¥A±Õ¥¹¹¡½ÉM¡•µ„¤°(€€€Ñ¥Ñ±”èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤(€ô°(€ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô(¤ì)Ù…ÈU¥A±Õ¥¹5…¹¥™•ÍÑM¡•µ„€ôÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð (€ì(€€€¹…µ”èÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤°(€€€‘É½¹•U¤èÑåÁ•‰½á}•áÁ½ÉÑÌ¹%¹Ñ••È¡ìµ¥¹¥µÕ´è€Äô¤°(€€€µ…¥¸èÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤°(€€€Í±½ÑÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹I•½É¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤¤°(€€€½¹ÑÉ¥‰ÕÑ¥½¹ÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹ÉÉ…ä¡U¥A±Õ¥¹½¹ÑÉ¥‰ÕÑ¥½¹M¡•µ„¤¤°(€€€¡•…‘±•ÍÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤¤°(€€€Ù•ÉÍ¥½¸èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°(€€€‘¥ÍÁ±…å9…µ”èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°(€€€‘•ÍÉ¥ÁÑ¥½¸èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤(€ô°(€ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô(¤ì)Ù…ÈU¥A±Õ¥¹%¹™½M¡•µ„€ôÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð (€ì(€€€¹…µ”èÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤°(€€€‘¥ÍÁ±…å9…µ”èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°(€€€‘•ÍÉ¥ÁÑ¥½¸èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°(€€€Ù•ÉÍ¥½¸èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°(€€€‘É½¹•U¤èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹%¹Ñ••È¡ìµ¥¹¥µÕ´è€Äô¤¤°(€€€Í±½ÑÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹I•½É¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°(€€€½¹ÑÉ¥‰ÕÑ¥½¹ÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹ÉÉ…ä¡U¥A±Õ¥¹½¹ÑÉ¥‰ÕÑ¥½¹M¡•µ„¤°(€€€¡•…‘±•ÍÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤¤°(€€€•¹…‰±•èÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤°(€€€ÑÉÕÍÑ•èÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤°(€€€¥¹Ù…±¥‘I•…Í½¸èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°(€€€‰Õ¥±‘ÉÉ½ÈèÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤°(€€€‰Õ¥±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤°(€€€‰Õ¥±Ñ¥¸èÑåÁ•‰½á}•áÁ½ÉÑÌ¹=ÁÑ¥½¹…°¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤¤(€ô°(€ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô(¤ì)Ù…ÈU¥A±Õ¥¹Í½¹™¥M¡•µ„€ôÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð (€ì(€€€•¹…‰±•èÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤°(€€€Á±Õ¥¹ÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹I•½É (€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤°(€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð (€€€€€€€ì(€€€€€€€€€•¹…‰±•èÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤°(€€€€€€€€€ÑÉÕÍÑ•èÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¤(€€€€€€€ô°(€€€€€€€ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô(€€€€€€¤(€€€€¤°(€€€…ÍÍ¥¹µ•¹ÑÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹I•½É¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤¤(€ô°(€ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô(¤ì)Ù…ÈU¥A±Õ¥¹ÍÙ•¹ÑM¡•µ„€ôÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡l(€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð (€€€ì­¥¹èÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰¡…¹•ˆ¤°¹…µ”èÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤ô°(€€€ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô(€€¤°(€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð¡ì­¥¹èÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…° ‰½¹™¥œˆ¤ô°ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô¤)t¤ì)Ù…ÈU¥A±Õ¥¹Í½¹ÑÉ…Ð€ô‘•™¥¹•½µ…¥¸ ‰Õ¥A±Õ¥¹Ìˆ°ì(€µ•Ñ¡½‘Ìèì(€€€•Ñ½¹™¥œèì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mt¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹Í…™”¡U¥A±Õ¥¹Í½¹™¥M¡•µ„¤(€€€ô°(€€€Í•Ñ¹…‰±•èì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¥t¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹Y½¥ ¤(€€€ô°(€€€±¥ÍÐèì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mt¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹ÉÉ…ä¡ÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹Í…™”¡U¥A±Õ¥¹%¹™½M¡•µ„¤¤(€€€ô°(€€€É•…‘½‘”èì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¥t¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡l(€€€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð (€€€€€€€€€ì(€€€€€€€€€€€µ…¹¥™•ÍÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹Í…™”¡U¥A±Õ¥¹5…¹¥™•ÍÑM¡•µ„¤°(€€€€€€€€€€€½‘”èÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤(€€€€€€€€€ô°(€€€€€€€€€ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô(€€€€€€€€¤°(€€€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð¡ì•ÉÉ½ÈèÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤ô°ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô¤(€€€€€t¤(€€€ô°(€€€Í•ÑA±Õ¥¹¹…‰±•èì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹	½½±•…¸ ¥t¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹Y½¥ ¤(€€€ô°(€€€…ÍÍ¥¹M±½Ðèì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹9Õ±° ¥t¥t¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹Y½¥ ¤(€€€ô°(€€€É•‰Õ¥±èì(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¥t¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡l(€€€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð¡ì½¬èÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…°¡ÑÉÕ”¤ô°ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô¤°(€€€€€€€ÑåÁ•‰½á}•áÁ½ÉÑÌ¹=‰©•Ð¡ì½¬èÑåÁ•‰½á}•áÁ½ÉÑÌ¹1¥Ñ•É…°¡™…±Í”¤°•ÉÉ½ÈèÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ ¤ô°ì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìè™…±Í”ô¤(€€€€€t¤(€€€ô°(€€€½Á•¹¥Èèì(€€€€€€¼¼QåÁ•	½à½ÁÑ¥½¹…°ÑÕÁ±”¥Ñ•µÌÍÑ¥±°ÁÉ½‘Õ”µ¥¹%Ñ•µÌôÄìµ½‘•°Ñ¡”(€€€€€€¼¼¹¼µ…ÉÕµ•¹Ð…¹¹…µ•µÁ±Õ¥¸™½ÉµÌ•áÁ±¥¥Ñ±ä¸(€€€€€…ÉÌèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹¥½¸¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mt¤°ÑåÁ•‰½á}•áÁ½ÉÑÌ¹QÕÁ±”¡mÑåÁ•‰½á}•áÁ½ÉÑÌ¹MÑÉ¥¹œ¡ìµ¥¹1•¹Ñ è€Äô¥t¥t¤°(€€€€€É•ÍÕ±ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹Y½¥ ¤(€€€ô(€ô°(€•Ù•¹ÑÌèì(€€€•Ù•¹ÐèÑåÁ•‰½á}•áÁ½ÉÑÌ¹U¹Í…™”¡U¥A±Õ¥¹ÍÙ•¹ÑM¡•µ„¤(€ô)ô¤ì((¼¼Á…­…•Ì½Í¡…É•½ÍÉŒ½­¹½Ý±•‘”µÍÁ•¥…±¥ÍÑÌ¹ÑÌ)Ù…È-9=]1}MA%1%MQL€ôl(€ì(€€€É½±”è€‰¹…Ù¥…Ñ½Èˆ°(€€€¹…µ”è€‰­¹½Ý±•‘”µ¹…Ù¥…Ñ½Èˆ°(€€€±…‰•°è€‰qÔÜÝÕqÔá	ÙqÔÕ	qÔàÈÉqÔÔÐÔàˆ°(€€€‘•ÍÉ¥ÁÑ¥½¸è€‰qÔØÌÀåqÔÕ	qÔàÈÉqÔØáÁqÔÝÈÉqÔÔÄÜÅqÔÑ	qÔÜÝÕqÔá	ÙqÔÑÁqÔÕÔÍqÔÔÈÑqÔäàÜåqÔÜÙqÕÁqÔÔÍqÔáÑqÔÔÙqÔÕÄÅqÔäÅqÔÜÙáqÔÔÄÜÍqÔØÜØÕqÔÙäÁqÔÌÀÀÈˆ°(€€€Á•Éµ¥ÍÍ¥½¹Ìèl‰­¹½Ý±•‘•}É•…ˆ°€‰­¹½Ý±•‘•}Í•…É ˆ°€‰­¹½Ý±•‘•}ÍÕ‰µ¥Ð‰t°(€€€µ…áQÕÉ¹Ìè€Ø°(€€€µ…áQ½­•¹Ìè€ÄàÀÀ(€ô°(€ì(€€€É½±”è€‰•Ù¥‘•¹”ˆ°(€€€¹…µ”è€‰­¹½Ý±•‘”µ•Ù¥‘•¹”µÕÉ…Ñ½Èˆ°(€€€±…‰•°è€‰qÔá	ÅqÔØÌÙqÔØÔÜÑqÔÜÐÀÙqÔÔÐÔàˆ°(€€€‘•ÍÉ¥ÁÑ¥½¸è€‰qÔØàÌáqÔÕ	åqÔØÌÀÝqÔÕåqÔØÜØÕqÔÙäÁqÔÜØàÑqÔäÀÀÉqÔÜÔÈáqÔàÌÀÍqÔÔÙÑqÔÌÀÀÅqÔÔÅÉqÔÝàÅqÔÑÁqÔÝÍqÔÔÍÍqÕÁqÔÑÁqÔàÅqÔÔÉáqÔá	ÑqÔá	ÅqÔÝÍqÔá		qÔÌÀÀÈˆ°(€€€Á•Éµ¥ÍÍ¥½¹Ìèl‰­¹½Ý±•‘•}É•…ˆ°€‰­¹½Ý±•‘•}ÍÕ‰µ¥Ð‰t°(€€€µ…áQÕÉ¹Ìè€Ð°(€€€µ…áQ½­•¹Ìè€ÈÐÀÀ(€ô°(€ì(€€€É½±”è€‰Ý¥­¤ˆ°(€€€¹…µ”è€‰­¹½Ý±•‘”µÝ¥­¤µ•‘¥Ñ½Èˆ°(€€€±…‰•°è€‰]¥­¤qÔÑqÔá	ÉqÔÔÐÔàˆ°(€€€‘•ÍÉ¥ÁÑ¥½¸è€‰qÔØàÌåqÔØÌÙqÔÕÉqÔá		qÔá	ÅqÔØÌÙqÔÜÔÅqÔØÈÄÁqÔÕàÕqÔÕ	ÅqÔØàÌáqÔÑqÔá	ÉqÔÙØÍqÔØÔàÝqÕÁqÔØÕÁqÔÙØÍqÔÕÁ]¥­¤qÔÔÄäåqÔÔÄØÕqÔÑÁqÔØÈÜåqÔÔÅÙqÔØÜÐÍqÔäØÔÁqÔÌÀÀÈˆ°(€€€Á•Éµ¥ÍÍ¥½¹Ìèl‰­¹½Ý±•‘•}É•…ˆ°€‰­¹½Ý±•‘•}ÍÕ‰µ¥Ð‰t°(€€€µ…áQÕÉ¹Ìè€Ì°(€€€µ…áQ½­•¹Ìè€ØÔÀÀ(€ô°(€ì(€€€É½±”è€‰•áÁ±…¥¹•Èˆ°(€€€¹…µ”è€‰­¹½Ý±•‘”µ•áÁ±…¥¹•Èˆ°(€€€±…‰•°è€‰M¡½Ü5”qÔá	ÉqÔàåÍqÔÔÐÔàˆ°(€€€‘•ÍÉ¥ÁÑ¥½¸è€‰qÔØÌÀåqÔÕåqÔäØÐÔM¡½Ü5”Í­¥±°qÔÜÔÅqÔØÈÄÁqÔÜÉqÔÝ	qÔá	ÉqÔàåÍqÔÑÝqÔÜÈØåqÕÁqÔÜÔÌÅqÔÕ		qÔÑÍ	qÔÑqÔÕÔáqÕÅ	qÔÑÁqÔØÈØÝqÔààÑqÔáÙqÔÑÙqÔØÈÄÙqÔÙÑ	qÔá	ÕqÔÌÀÀÈˆ°(€€€Á•Éµ¥ÍÍ¥½¹Ìèl‰­¹½Ý±•‘•}É•…ˆ°€‰­¹½Ý±•‘•}ÍÕ‰µ¥Ð‰t°(€€€µ…áQÕÉ¹Ìè€Ì°(€€€µ…áQ½­•¹Ìè€ÄÉ”Ì(€ô)tì)Ù…È-9=]1}IY%]H€ôì(€É½±”è€‰É•Ù¥•Ý•Èˆ°(€¹…µ”è€‰­¹½Ý±•‘”µÝ¥­¤µÉ•Ù¥•Ý•Èˆ°(€±…‰•°è€‰]¥­¤qÔÙÈÅqÔÔÜá	qÔÕ	ÅqÔØàÌáqÔÔÐÔàˆ°(€‘•ÍÉ¥ÁÑ¥½¸è€‰qÔÜÉqÔÝ	qÔØàÌáqÔÕ	åqÔäÀÀåqÔÑÉqÔÜØàÑqÔÔÀÄåqÔäÀÀåqÔÔÐáqÔØÜØÕqÔÙäÁqÕÁqÔÑÕqÔáÑqÔÔÙqÔÕ	ÅqÔØàÌáqÔØÄÁqÔàåÅqÕÅ	qÔàÅqÔÔÉáqÔÕäÑqÔÜÔÈáqÔäàÝ	qÔÜÔÌÅqÔÜÔÈáqÔØÈÌÝqÔÔÌÔÕqÔÜÉqÔØÌàáqÔØÜÐÍqÔÌÀÀÈˆ°(€Á•Éµ¥ÍÍ¥½¹Ìèl‰­¹½Ý±•‘•}ÍÕ‰µ¥Ð‰t°(€µ…áQÕÉ¹Ìè€Ä°(€µ…áQ½­•¹Ìè€ÈàÀÀ)ôì)Ù…ÈAI=QQ}-9=]1}9QL€ôl¸¸¹-9=]1}MA%1%MQL°-9=]1}IY%]Itì((¼¼Á…­…•Ì½Í¡…É•½ÍÉŒ½ÁÉ½•ÍÌµ±…¹•Ì½‘•µ¼¹ÑÌ)Ù…ÈÉ½ÕÑ”€ô€¡ÕÑÑ•É…¹”°ÁÉ¥µ…Éä°ÍÑ…”°¥¹Ñ…­”°±…¹‘¥¹œ°­•ÁÑ¡•­Á½¥¹Ð€ô™…±Í”°¡½ÍÐ€ô¹Õ±°¤€ôø€¡ì(€ÕÑÑ•É…¹”°(€¥¹Ñ…­”°(€…Á…‰¥±¥Ñ¥•ÌèÁÉ¥µ…Éä€ôôô€‰Áå‘•Í•ÄÈˆ€ül‰É•Í•…É ‰t€èl‰­¹½Ý±•‘”ˆ°€‰É•Í•…É ‰t°(€Ñ½Á¥Ìèmt°(€‘¥É•Ñ¥½¸èÍÑ…”€ôôô€‰‘”ˆ€ü€‰…¹…±åÍ¥Ìˆ€è€‰•Ù¥‘•¹”ˆ°(€ÍÑ…”°(€½¹ÑÉ…Ðè¹Õ±°°(€ÁÉ¥µ…Éä°(€É•…Í½¸è¹Õ±°°(€Õ¹…Ù…¥±…‰±•MÑ…”è¹Õ±°°(€½µÁ…É¥Í½¸è™…±Í”°(€……‘•µ¥Œè™…±Í”°(€­•ÁÑ¡•­Á½¥¹Ð°(€‘•™•ÉA¡É…Í”è¥¹Ñ…­”€ôôô€‰½¹Ñ¥¹Õ…Ñ¥½¸ˆ°(€Ù¥Í¥‰±•AÉ¥µ…Éäè	½½±•…¸¡ÁÉ¥µ…Éä¤°(€±…¹‘¥¹œ°(€¡½ÍÐ)ô¤ì)Ù…ÈÑ…Í¬€ô€¡ÍÑ…Ñ”Ì°É•…Í½¸°Á±…¹ÁÁÉ½Ù•€ô™…±Í”¤€ôø€¡ì(€Ù•ÉÍ¥½¸è€È°(€É•Ù¥Í¥½¸è€Ä°(€…Ñ¥Ù•Q…Í­%è€‰‘•µ¼µÑ…Í¬ˆ°(€Í•±•Ñ¥½¹I•ÅÕ¥É•è™…±Í”°(€±¥µ¥ÑÌèìÍÑ…•…±±Ìè€Ðà°Ñ½Ñ…±…±±Ìè€ÄäÈô°(€Ñ…Í­Ìèl(€€€ì(€€€€€¥è€‰‘•µ¼µÑ…Í¬ˆ°(€€€€€½…°è€‰‘•µ¼ˆ°(€€€€€ÍÑ…Ñ”èÍÑ…Ñ”Ì°(€€€€€ÕÁ‘…Ñ•‘Ðè€ˆÈÀÈØ´ÄÀ´ÀÑPÀÀèÀÀèÀÁhˆ°(€€€€€É•…Í½¸°(€€€€€ÍÑ…”è€Ä°(€€€€€Á±…¹ÁÁÉ½Ù•°(€€€€€…ÕÑ¡½É¥é…Ñ¥½¹I•ÅÕ¥É•è€…Á±…¹ÁÁÉ½Ù•°(€€€€€‰Õ‘•Ðèì…±±Ìè€È°ÍÑ…•…±±Ìè€Äô°(€€€€€Ý…¥Ñ5Ìè€À°(€€€€€…Á…‰¥±¥Ñ¥•Ìèl‰É•Í•…É ‰t°(€€€€€µ¥±•ÍÑ½¹•Ìèmt°(€€€€€…Ñ¥½¹Ìèmt°(€€€€€½Á•É…Ñ¥½¹Ìèmt(€€€ô(€t)ô¤ì)Ù…ÈAI=MM}5=}MQAL€ôl(€l(€€€ìÑåÁ”è€‰ÕÍ•Èµ¥¹ÁÕÐˆ°¥è€‰ÔÄˆ°Í•Äè€À°Ñ•áÐè€‰qÔØáÁqÔÝÈÉqÔá		qÔØÔàÝqÕÅqÔÕÁqÔàÍqÔàÙ!`ÄØqÔÔÜÈáqÔØÀÈÝqÔÔÈÉ	qÔÔÅÍqÔÕåqÔÑÉqÔÜØàÑqÔá	ÅqÔØÌÙˆô°(€€€ì(€€€€€ÑåÁ”è€‰ÑÕÉ¸µÉ½ÕÑ”ˆ°(€€€€€¥è€‰ÈÄˆ°(€€€€€Í•Äè€Ä°(€€€€€É½ÕÑ”èÉ½ÕÑ” (€€€€€€€€‰qÔØáÁqÔÝÈÉqÔá		qÔØÔàÝqÕÅqÔÕÁqÔàÍqÔàÙ!`ÄØqÔÔÜÈáqÔØÀÈÝqÔÔÈÉ	qÔÔÅÍqÔÕåqÔÑÉqÔÜØàÑqÔá	ÅqÔØÌÙˆ°(€€€€€€€€‰¹…ÑÕÉ”µ……‘•µ¥ŒµÍ•…É ˆ°(€€€€€€€€‰Í•…É ˆ°(€€€€€€€€‰¹•ÜµÑ½Á¥Œˆ°(€€€€€€€€‰Ý½É­™±½Üˆ(€€€€€€¤(€€€ô(€t°(€l(€€€ìÑåÁ”è€‰ÕÍ•Èµ¥¹ÁÕÐˆ°¥è€‰ÔÈˆ°Í•Äè€È°Ñ•áÐè€‰qÔÝÝqÔÝqÔÌÀÀÉqÔäØÀÕqÔá		qÔÕÔÉqÔØàØÍqÔÔÐÁqÔØÜØÕqÔÙäÁqÕÁqÔÝÅqÔÕåqÔÑÍ	qÔÕÈÁqÔÕÜÙqÔÔÄäåqÔÔÄØÕqÔÜÝÕqÔá	ÙqÔÕäÌˆô°(€€€ì(€€€€€ÑåÁ”è€‰ÑÕÉ¸µÉ½ÕÑ”ˆ°(€€€€€¥è€‰ÈÈˆ°(€€€€€Í•Äè€Ì°(€€€€€É½ÕÑ”èÉ½ÕÑ” (€€€€€€€€‰qÔÝÝqÔÝqÔÌÀÀÉqÔäØÀÕqÔá		qÔÕÔÉqÔØàØÍqÔÔÐÁqÔØÜØÕqÔÙäÁqÕÁqÔÝÅqÔÕåqÔÑÍ	qÔÕÈÁqÔÕÜÙqÔÔÄäåqÔÔÄØÕqÔÜÝÕqÔá	ÙqÔÕäÌˆ°(€€€€€€€€‰É•Í•…É µÙ…Õ±Ðˆ°(€€€€€€€€‰Ù…Õ±Ðˆ°(€€€€€€€€‰¹•ÜµÑ½Á¥Œˆ°(€€€€€€€€‰Ý½É­™±½Üˆ(€€€€€€¤(€€€ô(€t°(€l(€€€ìÑåÁ”è€‰ÕÍ•Èµ¥¹ÁÕÐˆ°¥è€‰ÔÌˆ°Í•Äè€Ð°Ñ•áÐè€‰qÔÕ	åqÔÕÉqÔØÜÀåqÔá	ÅqÔØÔÜÁqÔÔÀÕ!`ÄØqÔÜØàÑqÔÕqÔÕÀÉqÔààØáqÔá	ˆô°(€€€ì(€€€€€ÑåÁ”è€‰ÑÕÉ¸µÉ½ÕÑ”ˆ°(€€€€€¥è€‰ÈÌˆ°(€€€€€Í•Äè€Ô°(€€€€€É½ÕÑ”èÉ½ÕÑ” ‰qÔÕ	åqÔÕÉqÔØÜÀåqÔá	ÅqÔØÔÜÁqÔÔÀÕ!`ÄØqÔÜØàÑqÔÕqÔÕÀÉqÔààØáqÔá	ˆ°€‰Áå‘•Í•ÄÈˆ°€‰‘”ˆ°€‰¹•ÜµÑ½Á¥Œˆ°€‰Ý½É­™±½Üˆ¤(€€€ô(€t°(€mìÑåÁ”è€‰Ñ½½°µÉ••¥ÁÐˆ°¥è€‰ÐÐˆ°Í•Äè€Ø°¹…µ”è€‰É•…ˆ°ÍÑ…Ñ”è€‰‘½¹”ˆõt°(€l(€€€ì(€€€€€ÑåÁ”è€‰Ñ½½°µÉ••¥ÁÐˆ°(€€€€€¥è€‰ÐÔˆ°(€€€€€Í•Äè€Ü°(€€€€€¹…µ”è€‰ÝÉ¥Ñ”ˆ°(€€€€€ÍÑ…Ñ”è€‰•ÉÉ½Èˆ°(€€€€€‰±½­•‘I•…Í½¸è€‰Ñ…Í¬µ…ÕÑ¡½É¥é…Ñ¥½¸µÉ•ÅÕ¥É•ˆ(€€€ô(€t°(€mìÑåÁ”è€‰Ñ…Í¬µÙ¥•Üˆ°¥è€‰ØØˆ°Í•Äè€à°Ù¥•ÜèÑ…Í¬ ‰ÉÕ¹¹¥¹œˆ°¹Õ±°°ÑÉÕ”¤°‘•µ¼èÑÉÕ”õt°(€mìÑåÁ”è€‰Ñ…Í¬µÙ¥•Üˆ°¥è€‰ØÜˆ°Í•Äè€ä°Ù¥•ÜèÑ…Í¬ ‰‰±½­•ˆ°€‰É•½¹¥±”µ‰•™½É”µÉ•ÑÉäˆ°ÑÉÕ”¤õt°(€l(€€€ìÑåÁ”è€‰ÕÍ•Èµ¥¹ÁÕÐˆ°¥è€‰Ôàˆ°Í•Äè€ÄÀ°Ñ•áÐè€‰qÔá	qÔÕÙqÔÔäàÉqÔÑÔÔˆô°(€€€ì(€€€€€ÑåÁ”è€‰ÑÕÉ¸µÉ½ÕÑ”ˆ°(€€€€€¥è€‰Èàˆ°(€€€€€Í•Äè€ÄÄ°(€€€€€É½ÕÑ”èÉ½ÕÑ” ‰qÔá	qÔÕÙqÔÔäàÉqÔÑÔÔˆ°€‰Áå‘•Í•ÄÈˆ°€‰‘”ˆ°€‰ÍÑ…ÑÕÌˆ°€‰¡½ÍÐµ…Ñ”ˆ°ÑÉÕ”°ì(€€€€€€€É•…Í½¸è€‰É•½¹¥±”µ‰•™½É”µÉ•ÑÉäˆ°(€€€€€€€ÍÑ…Ñ”è€‰‰±½­•ˆ°(€€€€€€€ÍÑ…•…±±Ìè€Ä°(€€€€€€€…±±Ìè€È°(€€€€€€€ÁÉ½É•ÍÍ½Õ¹Ðè€Ä°(€€€€€€€ÍÑ…•MÑ…ÉÑAÉ½É•ÍÌè€À°(€€€€€€€ÍÑ…•1¥µ¥Ñ•è™…±Í”°(€€€€€€€¡…ÍAÉ½É•ÍÌèÑÉÕ”°(€€€€€€€Á•¹‘¥¹I•Ù¥•Üè™…±Í”°(€€€€€€€É•Ù¥•Ý1¥¹­•è™…±Í”°(€€€€€€€‘•™•ÉÉ•‘I•Ù¥•ÝÌè€À°(€€€€€€€É•±•…Í•‘MÑ…”è™…±Í”(€€€€€ô¤(€€€ô(€t)tì((¼¼Á…­…•Ì½Í¡…É•½ÍÉŒ½É•Í½ÕÉ”µÁÉ•Ù¥•Üµ™½Éµ…Ð¹ÑÌ)Ù…ÈQaQ}AIY%]}	eQL€ô€ÄÈà€¨€ÄÀÈÐì((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½}É•™¥¹”¹µ©Ì)™Õ¹Ñ¥½¸%ÍI•™¥¹”È¡Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Ù…±Õ”°€‰ùÉ•™¥¹”ˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Ù…±Õ•l‰ùÉ•™¥¹”‰t¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹Ù•Éä¡Ù…±Õ•l‰ùÉ•™¥¹”‰t°€À°€¡Ù…±Õ”È¤€ôøÕ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ð¡Ù…±Õ”È¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Ù…±Õ”È°€‰¡•¬ˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Ù…±Õ”È°€‰•ÉÉ½Èˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍÕ¹Ñ¥½¸¡Ù…±Õ”È¹¡•¬¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍÕ¹Ñ¥½¸¡Ù…±Õ”È¹•ÉÉ½È¤¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½Í¡•µ„¹µ©Ì)™Õ¹Ñ¥½¸%ÍM¡•µ…=‰©•Ð¡Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ð¡Ù…±Õ”¤€˜˜€…Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Ù…±Õ”¤ì)ô)™Õ¹Ñ¥½¸%ÍM¡•µ…	½½±•…¸¡Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%Í	½½±•…¸¡Ù…±Õ”¤ì)ô)™Õ¹Ñ¥½¸%ÍM¡•µ„È¡Ù…±Õ”¤ì(€É•ÑÕÉ¸%ÍM¡•µ…=‰©•Ð¡Ù…±Õ”¤ñð%ÍM¡•µ…	½½±•…¸¡Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½…‘‘¥Ñ¥½¹…±%Ñ•µÌ¹µ©Ì)™Õ¹Ñ¥½¸%Í‘‘¥Ñ¥½¹…±%Ñ•µÌ¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰…‘‘¥Ñ¥½¹…±%Ñ•µÌˆ¤€˜˜%ÍM¡•µ„È¡Í¡•µ„¹…‘‘¥Ñ¥½¹…±%Ñ•µÌ¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì¹µ©Ì)™Õ¹Ñ¥½¸%Í‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìˆ¤€˜˜%ÍM¡•µ„È¡Í¡•µ„¹…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½…±±=˜¹µ©Ì)™Õ¹Ñ¥½¸%Í±±=˜¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰…±±=˜ˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Í¡•µ„¹…±±=˜¤€˜˜Í¡•µ„¹…±±=˜¹•Ù•Éä ¡Ù…±Õ”¤€ôø%ÍM¡•µ„È¡Ù…±Õ”¤¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½…¹¡½È¹µ©Ì)™Õ¹Ñ¥½¸%Í¹¡½È¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€ˆ‘…¹¡½Èˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍMÑÉ¥¹œ¡Í¡•µ„¸‘…¹¡½È¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½…¹å=˜¹µ©Ì)™Õ¹Ñ¥½¸%Í¹å=˜¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰…¹å=˜ˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Í¡•µ„¹…¹å=˜¤€˜˜Í¡•µ„¹…¹å=˜¹•Ù•Éä ¡Ù…±Õ”¤€ôø%ÍM¡•µ„È¡Ù…±Õ”¤¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½½¹ÍÐ¹µ©Ì)™Õ¹Ñ¥½¸%Í½¹ÍÐ¡Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Ù…±Õ”°€‰½¹ÍÐˆ¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½½¹Ñ…¥¹Ì¹µ©Ì)™Õ¹Ñ¥½¸%Í½¹Ñ…¥¹Ì¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰½¹Ñ…¥¹Ìˆ¤€˜˜%ÍM¡•µ„È¡Í¡•µ„¹½¹Ñ…¥¹Ì¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½‘•™…Õ±Ð¹µ©Ì)™Õ¹Ñ¥½¸%Í•™…Õ±Ð¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰‘•™…Õ±Ðˆ¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½‘•Á•¹‘•¹¥•Ì¹µ©Ì)™Õ¹Ñ¥½¸%Í•Á•¹‘•¹¥•Ì¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰‘•Á•¹‘•¹¥•Ìˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ð¡Í¡•µ„¹‘•Á•¹‘•¹¥•Ì¤€˜˜=‰©•Ð¹Ù…±Õ•Ì¡Í¡•µ„¹‘•Á•¹‘•¹¥•Ì¤¹•Ù•Éä ¡Ù…±Õ”¤€ôø%ÍM¡•µ„È¡Ù…±Õ”¤ñðÕ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Ù…±Õ”¤€˜˜Ù…±Õ”¹•Ù•Éä ¡Ù…±Õ”È¤€ôøÕ…É‘}•áÁ½ÉÑÌ¹%ÍMÑÉ¥¹œ¡Ù…±Õ”È¤¤¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½‘•Á•¹‘•¹ÑI•ÅÕ¥É•¹µ©Ì)™Õ¹Ñ¥½¸%Í•Á•¹‘•¹ÑI•ÅÕ¥É•¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰‘•Á•¹‘•¹ÑI•ÅÕ¥É•ˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ð¡Í¡•µ„¹‘•Á•¹‘•¹ÑI•ÅÕ¥É•¤€˜˜=‰©•Ð¹Ù…±Õ•Ì¡Í¡•µ„¹‘•Á•¹‘•¹ÑI•ÅÕ¥É•¤¹•Ù•Éä ¡Ù…±Õ”¤€ôøÕ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Ù…±Õ”¤€˜˜Ù…±Õ”¹•Ù•Éä ¡Ù…±Õ”È¤€ôøÕ…É‘}•áÁ½ÉÑÌ¹%ÍMÑÉ¥¹œ¡Ù…±Õ”È¤¤¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½‘•Á•¹‘•¹ÑM¡•µ…Ì¹µ©Ì)™Õ¹Ñ¥½¸%Í•Á•¹‘•¹ÑM¡•µ…Ì¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰‘•Á•¹‘•¹ÑM¡•µ…Ìˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ð¡Í¡•µ„¹‘•Á•¹‘•¹ÑM¡•µ…Ì¤€˜˜=‰©•Ð¹Ù…±Õ•Ì¡Í¡•µ„¹‘•Á•¹‘•¹ÑM¡•µ…Ì¤¹•Ù•Éä ¡Ù…±Õ”¤€ôø%ÍM¡•µ„È¡Ù…±Õ”¤¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½‘å¹…µ¥¹¡½È¹µ©Ì)™Õ¹Ñ¥½¸%Íå¹…µ¥¹¡½È¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€ˆ‘‘å¹…µ¥¹¡½Èˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍMÑÉ¥¹œ¡Í¡•µ„¸‘‘å¹…µ¥¹¡½È¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½‘å¹…µ¥I•˜¹µ©Ì)™Õ¹Ñ¥½¸%Íå¹…µ¥I•˜¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€ˆ‘‘å¹…µ¥I•˜ˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍMÑÉ¥¹œ¡Í¡•µ„¸‘‘å¹…µ¥I•˜¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½•±Í”¹µ©Ì)™Õ¹Ñ¥½¸%Í±Í”¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰•±Í”ˆ¤€˜˜%ÍM¡•µ„È¡Í¡•µ„¹•±Í”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½•¹Õ´¹µ©Ì)™Õ¹Ñ¥½¸%Í¹Õ´È¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰•¹Õ´ˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Í¡•µ„¹•¹Õ´¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½•á±ÕÍ¥Ù•5…á¥µÕ´¹µ©Ì)™Õ¹Ñ¥½¸%Íá±ÕÍ¥Ù•5…á¥µÕ´¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰•á±ÕÍ¥Ù•5…á¥µÕ´ˆ¤€˜˜€¡Õ…É‘}•áÁ½ÉÑÌ¹%Í9Õµ‰•È¡Í¡•µ„¹•á±ÕÍ¥Ù•5…á¥µÕ´¤ñðÕ…É‘}•áÁ½ÉÑÌ¹%Í	¥%¹Ð¡Í¡•µ„¹•á±ÕÍ¥Ù•5…á¥µÕ´¤¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½•á±ÕÍ¥Ù•5¥¹¥µÕ´¹µ©Ì)™Õ¹Ñ¥½¸%Íá±ÕÍ¥Ù•5¥¹¥µÕ´¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰•á±ÕÍ¥Ù•5¥¹¥µÕ´ˆ¤€˜˜€¡Õ…É‘}•áÁ½ÉÑÌ¹%Í9Õµ‰•È¡Í¡•µ„¹•á±ÕÍ¥Ù•5¥¹¥µÕ´¤ñðÕ…É‘}•áÁ½ÉÑÌ¹%Í	¥%¹Ð¡Í¡•µ„¹•á±ÕÍ¥Ù•5¥¹¥µÕ´¤¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½™½Éµ…Ð¹µ©Ì)™Õ¹Ñ¥½¸%Í½Éµ…Ð¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰™½Éµ…Ðˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍMÑÉ¥¹œ¡Í¡•µ„¹™½Éµ…Ð¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½¥¹µ©Ì)™Õ¹Ñ¥½¸%Í%¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€ˆ‘¥ˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍMÑÉ¥¹œ¡Í¡•µ„¸‘¥¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½¥˜¹µ©Ì)™Õ¹Ñ¥½¸%Í%˜¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰¥˜ˆ¤€˜˜%ÍM¡•µ„È¡Í¡•µ„¹¥˜¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½¥Ñ•µÌ¹µ©Ì)™Õ¹Ñ¥½¸%Í%Ñ•µÌ¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰¥Ñ•µÌˆ¤€˜˜€¡%ÍM¡•µ„È¡Í¡•µ„¹¥Ñ•µÌ¤ñðÕ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Í¡•µ„¹¥Ñ•µÌ¤€˜˜Í¡•µ„¹¥Ñ•µÌ¹•Ù•Éä ¡Ù…±Õ”¤€ôøì(€€€É•ÑÕÉ¸%ÍM¡•µ„È¡Ù…±Õ”¤ì(€ô¤¤ì)ô)™Õ¹Ñ¥½¸%Í%Ñ•µÍM¥é•¡Í¡•µ„¤ì(€É•ÑÕÉ¸%Í%Ñ•µÌ¡Í¡•µ„¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Í¡•µ„¹¥Ñ•µÌ¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½µ…á¥µÕ´¹µ©Ì)™Õ¹Ñ¥½¸%Í5…á¥µÕ´¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰µ…á¥µÕ´ˆ¤€˜˜€¡Õ…É‘}•áÁ½ÉÑÌ¹%Í9Õµ‰•È¡Í¡•µ„¹µ…á¥µÕ´¤ñðÕ…É‘}•áÁ½ÉÑÌ¹%Í	¥%¹Ð¡Í¡•µ„¹µ…á¥µÕ´¤¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½µ…á½¹Ñ…¥¹Ì¹µ©Ì)™Õ¹Ñ¥½¸%Í5…á½¹Ñ…¥¹Ì¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰µ…á½¹Ñ…¥¹Ìˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%Í9Õµ‰•È¡Í¡•µ„¹µ…á½¹Ñ…¥¹Ì¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½µ…á%Ñ•µÌ¹µ©Ì)™Õ¹Ñ¥½¸%Í5…á%Ñ•µÌ¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰µ…á%Ñ•µÌˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%Í9Õµ‰•È¡Í¡•µ„¹µ…á%Ñ•µÌ¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½µ…á1•¹Ñ ¹µ©Ì)™Õ¹Ñ¥½¸%Í5…á1•¹Ñ Ì¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰µ…á1•¹Ñ ˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%Í9Õµ‰•È¡Í¡•µ„¹µ…á1•¹Ñ ¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½µ…áAÉ½Á•ÉÑ¥•Ì¹µ©Ì)™Õ¹Ñ¥½¸%Í5…áAÉ½Á•ÉÑ¥•Ì¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰µ…áAÉ½Á•ÉÑ¥•Ìˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%Í9Õµ‰•È¡Í¡•µ„¹µ…áAÉ½Á•ÉÑ¥•Ì¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½µ¥¹¥µÕ´¹µ©Ì)™Õ¹Ñ¥½¸%Í5¥¹¥µÕ´¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰µ¥¹¥µÕ´ˆ¤€˜˜€¡Õ…É‘}•áÁ½ÉÑÌ¹%Í9Õµ‰•È¡Í¡•µ„¹µ¥¹¥µÕ´¤ñðÕ…É‘}•áÁ½ÉÑÌ¹%Í	¥%¹Ð¡Í¡•µ„¹µ¥¹¥µÕ´¤¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½µ¥¹½¹Ñ…¥¹Ì¹µ©Ì)™Õ¹Ñ¥½¸%Í5¥¹½¹Ñ…¥¹Ì¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰µ¥¹½¹Ñ…¥¹Ìˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%Í9Õµ‰•È¡Í¡•µ„¹µ¥¹½¹Ñ…¥¹Ì¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½µ¥¹%Ñ•µÌ¹µ©Ì)™Õ¹Ñ¥½¸%Í5¥¹%Ñ•µÌ¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰µ¥¹%Ñ•µÌˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%Í9Õµ‰•È¡Í¡•µ„¹µ¥¹%Ñ•µÌ¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½µ¥¹1•¹Ñ ¹µ©Ì)™Õ¹Ñ¥½¸%Í5¥¹1•¹Ñ Ì¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰µ¥¹1•¹Ñ ˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%Í9Õµ‰•È¡Í¡•µ„¹µ¥¹1•¹Ñ ¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½µ¥¹AÉ½Á•ÉÑ¥•Ì¹µ©Ì)™Õ¹Ñ¥½¸%Í5¥¹AÉ½Á•ÉÑ¥•Ì¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰µ¥¹AÉ½Á•ÉÑ¥•Ìˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%Í9Õµ‰•È¡Í¡•µ„¹µ¥¹AÉ½Á•ÉÑ¥•Ì¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½µÕ±Ñ¥Á±•=˜¹µ©Ì)™Õ¹Ñ¥½¸%Í5Õ±Ñ¥Á±•=˜È¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰µÕ±Ñ¥Á±•=˜ˆ¤€˜˜€¡Õ…É‘}•áÁ½ÉÑÌ¹%Í9Õµ‰•È¡Í¡•µ„¹µÕ±Ñ¥Á±•=˜¤ñðÕ…É‘}•áÁ½ÉÑÌ¹%Í	¥%¹Ð¡Í¡•µ„¹µÕ±Ñ¥Á±•=˜¤¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½¹½Ð¹µ©Ì)™Õ¹Ñ¥½¸%Í9½Ð¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰¹½Ðˆ¤€˜˜%ÍM¡•µ„È¡Í¡•µ„¹¹½Ð¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½½¹•=˜¹µ©Ì)™Õ¹Ñ¥½¸%Í=¹•=˜¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰½¹•=˜ˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Í¡•µ„¹½¹•=˜¤€˜˜Í¡•µ„¹½¹•=˜¹•Ù•Éä ¡Ù…±Õ”¤€ôø%ÍM¡•µ„È¡Ù…±Õ”¤¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½Á…ÑÑ•É¸¹µ©Ì)™Õ¹Ñ¥½¸%ÍA…ÑÑ•É¸¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰Á…ÑÑ•É¸ˆ¤€˜˜€¡Õ…É‘}•áÁ½ÉÑÌ¹%ÍMÑÉ¥¹œ¡Í¡•µ„¹Á…ÑÑ•É¸¤ñðÍ¡•µ„¹Á…ÑÑ•É¸¥¹ÍÑ…¹•½˜I•áÀ¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½Á…ÑÑ•É¹AÉ½Á•ÉÑ¥•Ì¹µ©Ì)™Õ¹Ñ¥½¸%ÍA…ÑÑ•É¹AÉ½Á•ÉÑ¥•Ì¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰Á…ÑÑ•É¹AÉ½Á•ÉÑ¥•Ìˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ð¡Í¡•µ„¹Á…ÑÑ•É¹AÉ½Á•ÉÑ¥•Ì¤€˜˜=‰©•Ð¹Ù…±Õ•Ì¡Í¡•µ„¹Á…ÑÑ•É¹AÉ½Á•ÉÑ¥•Ì¤¹•Ù•Éä ¡Ù…±Õ”¤€ôø%ÍM¡•µ„È¡Ù…±Õ”¤¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½ÁÉ•™¥á%Ñ•µÌ¹µ©Ì)™Õ¹Ñ¥½¸%ÍAÉ•™¥á%Ñ•µÌ¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰ÁÉ•™¥á%Ñ•µÌˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Í¡•µ„¹ÁÉ•™¥á%Ñ•µÌ¤€˜˜Í¡•µ„¹ÁÉ•™¥á%Ñ•µÌ¹•Ù•Éä ¡Í¡•µ„È¤€ôø%ÍM¡•µ„È¡Í¡•µ„È¤¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½ÁÉ½Á•ÉÑ¥•Ì¹µ©Ì)™Õ¹Ñ¥½¸%ÍAÉ½Á•ÉÑ¥•Ì¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰ÁÉ½Á•ÉÑ¥•Ìˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ð¡Í¡•µ„¹ÁÉ½Á•ÉÑ¥•Ì¤€˜˜=‰©•Ð¹Ù…±Õ•Ì¡Í¡•µ„¹ÁÉ½Á•ÉÑ¥•Ì¤¹•Ù•Éä ¡Ù…±Õ”¤€ôø%ÍM¡•µ„È¡Ù…±Õ”¤¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½ÁÉ½Á•ÉÑå9…µ•Ì¹µ©Ì)™Õ¹Ñ¥½¸%ÍAÉ½Á•ÉÑå9…µ•Ì¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰ÁÉ½Á•ÉÑå9…µ•Ìˆ¤€˜˜€¡Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ð¡Í¡•µ„¹ÁÉ½Á•ÉÑå9…µ•Ì¤ñð%ÍM¡•µ„È¡Í¡•µ„¹ÁÉ½Á•ÉÑå9…µ•Ì¤¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½É•ÕÉÍ¥Ù•¹¡½È¹µ©Ì)™Õ¹Ñ¥½¸%ÍI•ÕÉÍ¥Ù•¹¡½È¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€ˆ‘É•ÕÉÍ¥Ù•¹¡½Èˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%Í	½½±•…¸¡Í¡•µ„¸‘É•ÕÉÍ¥Ù•¹¡½È¤ì)ô)™Õ¹Ñ¥½¸%ÍI•ÕÉÍ¥Ù•¹¡½ÉQÉÕ”¡Í¡•µ„¤ì(€É•ÑÕÉ¸%ÍI•ÕÉÍ¥Ù•¹¡½È¡Í¡•µ„¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Í¡•µ„¸‘É•ÕÉÍ¥Ù•¹¡½È°ÑÉÕ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½É•ÕÉÍ¥Ù•I•˜¹µ©Ì)™Õ¹Ñ¥½¸%ÍI•ÕÉÍ¥Ù•I•˜¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€ˆ‘É•ÕÉÍ¥Ù•I•˜ˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍMÑÉ¥¹œ¡Í¡•µ„¸‘É•ÕÉÍ¥Ù•I•˜¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½É•˜¹µ©Ì)™Õ¹Ñ¥½¸%ÍI•˜È¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€ˆ‘É•˜ˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍMÑÉ¥¹œ¡Í¡•µ„¸‘É•˜¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½É•ÅÕ¥É•¹µ©Ì)™Õ¹Ñ¥½¸%ÍI•ÅÕ¥É•¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰É•ÅÕ¥É•ˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Í¡•µ„¹É•ÅÕ¥É•¤€˜˜Í¡•µ„¹É•ÅÕ¥É•¹•Ù•Éä ¡Ù…±Õ”¤€ôøÕ…É‘}•áÁ½ÉÑÌ¹%ÍMÑÉ¥¹œ¡Ù…±Õ”¤¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½Ñ¡•¸¹µ©Ì)™Õ¹Ñ¥½¸%ÍQ¡•¸¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰Ñ¡•¸ˆ¤€˜˜%ÍM¡•µ„È¡Í¡•µ„¹Ñ¡•¸¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½ÑåÁ”¹µ©Ì)™Õ¹Ñ¥½¸%ÍQåÁ”¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰ÑåÁ”ˆ¤€˜˜€¡Õ…É‘}•áÁ½ÉÑÌ¹%ÍMÑÉ¥¹œ¡Í¡•µ„¹ÑåÁ”¤ñðÕ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Í¡•µ„¹ÑåÁ”¤€˜˜Í¡•µ„¹ÑåÁ”¹•Ù•Éä ¡Ù…±Õ”¤€ôøÕ…É‘}•áÁ½ÉÑÌ¹%ÍMÑÉ¥¹œ¡Ù…±Õ”¤¤¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½Õ¹¥ÅÕ•%Ñ•µÌ¹µ©Ì)™Õ¹Ñ¥½¸%ÍU¹¥ÅÕ•%Ñ•µÌ¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰Õ¹¥ÅÕ•%Ñ•µÌˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%Í	½½±•…¸¡Í¡•µ„¹Õ¹¥ÅÕ•%Ñ•µÌ¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½Õ¹•Ù…±Õ…Ñ•‘%Ñ•µÌ¹µ©Ì)™Õ¹Ñ¥½¸%ÍU¹•Ù…±Õ…Ñ•‘%Ñ•µÌ¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰Õ¹•Ù…±Õ…Ñ•‘%Ñ•µÌˆ¤€˜˜%ÍM¡•µ„È¡Í¡•µ„¹Õ¹•Ù…±Õ…Ñ•‘%Ñ•µÌ¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½ÑåÁ•Ì½Õ¹•Ù…±Õ…Ñ•‘AÉ½Á•ÉÑ¥•Ì¹µ©Ì)™Õ¹Ñ¥½¸%ÍU¹•Ù…±Õ…Ñ•‘AÉ½Á•ÉÑ¥•Ì¡Í¡•µ„¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Í¡•µ„°€‰Õ¹•Ù…±Õ…Ñ•‘AÉ½Á•ÉÑ¥•Ìˆ¤€˜˜%ÍM¡•µ„È¡Í¡•µ„¹Õ¹•Ù…±Õ…Ñ•‘AÉ½Á•ÉÑ¥•Ì¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½}½¹Ñ•áÐ¹µ©Ì)Ù…È¡•­½¹Ñ•áÐ€ô±…ÍÌì(€½¹ÍÑÉÕÑ½È ¤ì(€€€½¹ÍÐ¥¹‘¥•Ì€ô€¼¨}}AUI}|€¨¼¹•ÜM•Ð ¤ì(€€€½¹ÍÐ­•åÌ€ô€¼¨}}AUI}|€¨¼¹•ÜM•Ð ¤ì(€€€Ñ¡¥Ì¹ÍÑ…¬€ômì¥¹‘¥•Ì°­•åÌõtì(€ô(€€¼¼€´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´(€€¼¼MÑ…¬(€€¼¼€´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´(€AÕÍ  ¤ì(€€€½¹ÍÐ¥¹‘¥•Ì€ô€¼¨}}AUI}|€¨¼¹•ÜM•Ð ¤ì(€€€½¹ÍÐ­•åÌ€ô€¼¨}}AUI}|€¨¼¹•ÜM•Ð ¤ì(€€€Ñ¡¥Ì¹ÍÑ…¬¹ÁÕÍ ¡ì¥¹‘¥•Ì°­•åÌô¤ì(€€€É•ÑÕÉ¸ÑÉÕ”ì(€ô(€A½À ¤ì(€€€Ñ¡¥Ì¹ÍÑ…¬¹Á½À ¤ì(€€€É•ÑÕÉ¸ÑÉÕ”ì(€ô(€€¼¼€´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´(€€¼¼Q½À(€€¼¼€´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´(€‘‘%¹‘•à¡¥¹‘•à¤ì(€€€Ñ¡¥Ì¹•Ñ%¹‘¥•Ì ¤¹…‘¡¥¹‘•à¤ì(€€€É•ÑÕÉ¸ÑÉÕ”ì(€ô(€‘‘-•ä¡­•ä¤ì(€€€Ñ¡¥Ì¹•Ñ-•åÌ ¤¹…‘¡­•ä¤ì(€€€É•ÑÕÉ¸ÑÉÕ”ì(€ô(€•Ñ%¹‘¥•Ì ¤ì(€€€½¹ÍÐÑ½À€ôÑ¡¥Ì¹ÍÑ…­mÑ¡¥Ì¹ÍÑ…¬¹±•¹Ñ €´€Åtì(€€€É•ÑÕÉ¸Ñ½À¹¥¹‘¥•Ìì(€ô(€•Ñ-•åÌ ¤ì(€€€½¹ÍÐÑ½À€ôÑ¡¥Ì¹ÍÑ…­mÑ¡¥Ì¹ÍÑ…¬¹±•¹Ñ €´€Åtì(€€€É•ÑÕÉ¸Ñ½À¹­•åÌì(€ô(€5•É”¡É•ÍÕ±ÑÌ¤ì(€€€™½È€¡½¹ÍÐ½¹Ñ•áÐ½˜É•ÍÕ±ÑÌ¤ì(€€€€€½¹Ñ•áÐ¹•Ñ%¹‘¥•Ì ¤¹™½É…  ¡Ù…±Õ”¤€ôøÑ¡¥Ì¹•Ñ%¹‘¥•Ì ¤¹…‘¡Ù…±Õ”¤¤ì(€€€€€½¹Ñ•áÐ¹•Ñ-•åÌ ¤¹™½É…  ¡Ù…±Õ”¤€ôøÑ¡¥Ì¹•Ñ-•åÌ ¤¹…‘¡Ù…±Õ”¤¤ì(€€€ô(€€€É•ÑÕÉ¸ÑÉÕ”ì(€ô)ôì)Ù…ÈÉÉ½É½¹Ñ•áÐ€ô±…ÍÌ•áÑ•¹‘Ì¡•­½¹Ñ•áÐì(€½¹ÍÑÉÕÑ½È¡…±±‰…¬¤ì(€€€ÍÕÁ•È ¤ì(€€€Ñ¡¥Ì¹…±±‰…¬€ô…±±‰…¬ì(€ô(€‘‘ÉÉ½È¡•ÉÉ½È¤ì(€€€Ñ¡¥Ì¹…±±‰…¬¡•ÉÉ½È¤ì(€€€É•ÑÕÉ¸™…±Í”ì(€ô)ôì)Ù…ÈÕµÕ±…Ñ•‘ÉÉ½É½¹Ñ•áÐ€ô±…ÍÌ•áÑ•¹‘ÌÉÉ½É½¹Ñ•áÐì(€½¹ÍÑÉÕÑ½È ¤ì(€€€ÍÕÁ•È ¡•ÉÉ½È¤€ôøÑ¡¥Ì¹•ÉÉ½ÉÌ¹ÁÕÍ ¡•ÉÉ½È¤¤ì(€€€Ñ¡¥Ì¹•ÉÉ½ÉÌ€ômtì(€ô(€‘‘ÉÉ½È¡•ÉÉ½È¤ì(€€€Ñ¡¥Ì¹•ÉÉ½ÉÌ¹ÁÕÍ ¡•ÉÉ½È¤ì(€€€É•ÑÕÉ¸™…±Í”ì(€ô(€•ÑÉÉ½ÉÌ ¤ì(€€€É•ÑÕÉ¸Ñ¡¥Ì¹•ÉÉ½ÉÌì(€ô)ôì((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½}É•™¥¹”¹µ©Ì)™Õ¹Ñ¥½¸¡•­I•™¥¹”¡}ÍÑ…¬°}½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹Ù•Éä¡Í¡•µ…l‰ùÉ•™¥¹”‰t°€À°€¡É•™¥¹•µ•¹Ð°|¤€ôøÉ•™¥¹•µ•¹Ð¹¡•¬¡Ù…±Õ”¤¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½ÉI•™¥¹”¡}ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹Ù•Éå±°¡Í¡•µ…l‰ùÉ•™¥¹”‰t°€À°€¡É•™¥¹•µ•¹Ð°¥¹‘•à¤€ôøì(€€€É•ÑÕÉ¸É•™¥¹•µ•¹Ð¹¡•¬¡Ù…±Õ”¤ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€€€­•åÝ½Éè€‰ùÉ•™¥¹”ˆ°(€€€€€Í¡•µ…A…Ñ °(€€€€€¥¹ÍÑ…¹•A…Ñ °(€€€€€Á…É…µÌèì¥¹‘•à°µ•ÍÍ…”èÉ•™¥¹•µ•¹Ð¹•ÉÉ½È¡Ù…±Õ”¤ô(€€€ô¤ì(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½…‘‘¥Ñ¥½¹…±%Ñ•µÌ¹µ©Ì)™Õ¹Ñ¥½¸%ÍY…±¥¡Í¡•µ„¤ì(€É•ÑÕÉ¸%Í%Ñ•µÌ¡Í¡•µ„¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Í¡•µ„¹¥Ñ•µÌ¤ì)ô)™Õ¹Ñ¥½¸¡•­‘‘¥Ñ¥½¹…±%Ñ•µÌ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€¥˜€ …%ÍY…±¥¡Í¡•µ„¤¤(€€€É•ÑÕÉ¸ÑÉÕ”ì(€½¹ÍÐ¥Í‘‘¥Ñ¥½¹…±%Ñ•µÌ€ôÙ…±Õ”¹•Ù•Éä ¡¥Ñ•´°¥¹‘•à¤€ôøì(€€€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%Í1•ÍÍQ¡…¸¡¥¹‘•à°Í¡•µ„¹¥Ñ•µÌ¹±•¹Ñ ¤ñð¡•­M¡•µ…AÕÍ¡MÑ…¬¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„¹…‘‘¥Ñ¥½¹…±%Ñ•µÌ°¥Ñ•´¤€˜˜½¹Ñ•áÐ¹‘‘%¹‘•à¡¥¹‘•à¤ì(€ô¤ì(€É•ÑÕÉ¸¥Í‘‘¥Ñ¥½¹…±%Ñ•µÌì)ô)™Õ¹Ñ¥½¸ÉÉ½É‘‘¥Ñ¥½¹…±%Ñ•µÌ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€¥˜€ …%ÍY…±¥¡Í¡•µ„¤¤(€€€É•ÑÕÉ¸ÑÉÕ”ì(€½¹ÍÐ¥Í‘‘¥Ñ¥½¹…±%Ñ•µÌ€ôÙ…±Õ”¹•Ù•Éä ¡¥Ñ•´°¥¹‘•à¤€ôøì(€€€½¹ÍÐ¹•áÑM¡•µ…A…Ñ €ô€‘íÍ¡•µ…A…Ñ¡ô½…‘‘¥Ñ¥½¹…±%Ñ•µÍ€ì(€€€½¹ÍÐ¹•áÑ%¹ÍÑ…¹•A…Ñ €ô€‘í¥¹ÍÑ…¹•A…Ñ¡ô¼‘í¥¹‘•áõ€ì(€€€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%Í1•ÍÍQ¡…¸¡¥¹‘•à°Í¡•µ„¹¥Ñ•µÌ¹±•¹Ñ ¤ñðÉÉ½ÉM¡•µ…AÕÍ¡MÑ…¬¡ÍÑ…¬°½¹Ñ•áÐ°¹•áÑM¡•µ…A…Ñ °¹•áÑ%¹ÍÑ…¹•A…Ñ °Í¡•µ„¹…‘‘¥Ñ¥½¹…±%Ñ•µÌ°¥Ñ•´¤€˜˜½¹Ñ•áÐ¹‘‘%¹‘•à¡¥¹‘•à¤ì(€ô¤ì(€É•ÑÕÉ¸¥Í‘‘¥Ñ¥½¹…±%Ñ•µÌì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì¹µ©Ì)™Õ¹Ñ¥½¸•ÑAÉ½Á•ÉÑå-•åÍA…ÑÑ•É¸¡­•ä¤ì(€½¹ÍÐ•Í…Á•€ô­•ä¹É•Á±…” ½l¸¨¬ýx‘íô ¥ñmquqqt½œ°€‰qp˜ˆ¤ì(€É•ÑÕÉ¸x‘í•Í…Á•‘ô‘€ì)ô)™Õ¹Ñ¥½¸•ÑAÉ½Á•ÉÑ¥•ÍA…ÑÑ•É¸¡Í¡•µ„¤ì(€½¹ÍÐÁ…ÑÑ•É¹Ì€ômtì(€¥˜€¡%ÍA…ÑÑ•É¹AÉ½Á•ÉÑ¥•Ì¡Í¡•µ„¤¤(€€€Á…ÑÑ•É¹Ì¹ÁÕÍ  ¸¸¹Õ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡Í¡•µ„¹Á…ÑÑ•É¹AÉ½Á•ÉÑ¥•Ì¤¤ì(€¥˜€¡%ÍAÉ½Á•ÉÑ¥•Ì¡Í¡•µ„¤¤(€€€Á…ÑÑ•É¹Ì¹ÁÕÍ  ¸¸¹Õ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡Í¡•µ„¹ÁÉ½Á•ÉÑ¥•Ì¤¹µ…À¡•ÑAÉ½Á•ÉÑå-•åÍA…ÑÑ•É¸¤¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Á…ÑÑ•É¹Ì¹±•¹Ñ °€À¤€ü€ˆ ü„¤ˆ€è€ ‘íÁ…ÑÑ•É¹Ì¹©½¥¸ ‰ðˆ¥ô¥€ì)ô)™Õ¹Ñ¥½¸¡•­‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐÉ••áÀ€ô¹•ÜI•áÀ¡•ÑAÉ½Á•ÉÑ¥•ÍA…ÑÑ•É¸¡Í¡•µ„¤¤ì(€½¹ÍÐ¥Í‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì€ôÕ…É‘}•áÁ½ÉÑÌ¹Ù•Éä¡Õ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡Ù…±Õ”¤°€À°€¡­•ä°}¥¹‘•à¤€ôøì(€€€É•ÑÕÉ¸É••áÀ¹Ñ•ÍÐ¡­•ä¤ñð¡•­M¡•µ…AÕÍ¡MÑ…¬¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„¹…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì°Ù…±Õ•m­•åt¤€˜˜½¹Ñ•áÐ¹‘‘-•ä¡­•ä¤ì(€ô¤ì(€É•ÑÕÉ¸¥Í‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìì)ô)™Õ¹Ñ¥½¸ÉÉ½É‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐÉ••áÀ€ô¹•ÜI•áÀ¡•ÑAÉ½Á•ÉÑ¥•ÍA…ÑÑ•É¸¡Í¡•µ„¤¤ì(€½¹ÍÐ…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì€ômtì(€½¹ÍÐ¥Í‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì€ôÕ…É‘}•áÁ½ÉÑÌ¹Ù•Éå±°¡Õ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡Ù…±Õ”¤°€À°€¡­•ä°}¥¹‘•à¤€ôøì(€€€½¹ÍÐ¹•áÑM¡•µ…A…Ñ €ô€‘íÍ¡•µ…A…Ñ¡ô½…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Í€ì(€€€½¹ÍÐ¹•áÑ%¹ÍÑ…¹•A…Ñ €ô€‘í¥¹ÍÑ…¹•A…Ñ¡ô¼‘í­•åõ€ì(€€€½¹ÍÐ¹•áÑ½¹Ñ•áÐ€ô¹•ÜÕµÕ±…Ñ•‘ÉÉ½É½¹Ñ•áÐ ¤ì(€€€½¹ÍÐ¥Í‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑä€ôÉ••áÀ¹Ñ•ÍÐ¡­•ä¤ñðÉÉ½ÉM¡•µ…AÕÍ¡MÑ…¬¡ÍÑ…¬°¹•áÑ½¹Ñ•áÐ°¹•áÑM¡•µ…A…Ñ °¹•áÑ%¹ÍÑ…¹•A…Ñ °Í¡•µ„¹…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì°Ù…±Õ•m­•åt¤€˜˜½¹Ñ•áÐ¹‘‘-•ä¡­•ä¤ì(€€€¥˜€ …¥Í‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑä¤(€€€€€…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì¹ÁÕÍ ¡­•ä¤ì(€€€É•ÑÕÉ¸¥Í‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑäì(€ô¤ì(€É•ÑÕÉ¸¥Í‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½…±±=˜¹µ©Ì)™Õ¹Ñ¥½¸¡•­±±=˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐÉ•ÍÕ±ÑÌ€ôÍ¡•µ„¹…±±=˜¹É•‘Õ” ¡É•ÍÕ±Ð°Í¡•µ„È¤€ôøì(€€€½¹ÍÐ¹•áÑ½¹Ñ•áÐ€ô¹•Ü¡•­½¹Ñ•áÐ ¤ì(€€€É•ÑÕÉ¸¡•­M¡•µ„¡ÍÑ…¬°¹•áÑ½¹Ñ•áÐ°Í¡•µ„È°Ù…±Õ”¤€ül¸¸¹É•ÍÕ±Ð°¹•áÑ½¹Ñ•áÑt€èÉ•ÍÕ±Ðì(€ô°mt¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡É•ÍÕ±ÑÌ¹±•¹Ñ °Í¡•µ„¹…±±=˜¹±•¹Ñ ¤€˜˜½¹Ñ•áÐ¹5•É”¡É•ÍÕ±ÑÌ¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½É±±=˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐ™…¥±•‘½¹Ñ•áÑÌ€ômtì(€½¹ÍÐÉ•ÍÕ±ÑÌ€ôÍ¡•µ„¹…±±=˜¹É•‘Õ” ¡É•ÍÕ±Ð°Í¡•µ„È°¥¹‘•à¤€ôøì(€€€½¹ÍÐ¹•áÑM¡•µ…A…Ñ €ô€‘íÍ¡•µ…A…Ñ¡ô½…±±=˜¼‘í¥¹‘•áõ€ì(€€€½¹ÍÐ¹•áÑ½¹Ñ•áÐ€ô¹•ÜÕµÕ±…Ñ•‘ÉÉ½É½¹Ñ•áÐ ¤ì(€€€½¹ÍÐ¥ÍM¡•µ„€ôÉÉ½ÉM¡•µ„¡ÍÑ…¬°¹•áÑ½¹Ñ•áÐ°¹•áÑM¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„È°Ù…±Õ”¤ì(€€€¥˜€ …¥ÍM¡•µ„¤(€€€€€™…¥±•‘½¹Ñ•áÑÌ¹ÁÕÍ ¡¹•áÑ½¹Ñ•áÐ¤ì(€€€É•ÑÕÉ¸¥ÍM¡•µ„€ül¸¸¹É•ÍÕ±Ð°¹•áÑ½¹Ñ•áÑt€èÉ•ÍÕ±Ðì(€ô°mt¤ì(€½¹ÍÐ¥Í±±=˜€ôÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡É•ÍÕ±ÑÌ¹±•¹Ñ °Í¡•µ„¹…±±=˜¹±•¹Ñ ¤€˜˜½¹Ñ•áÐ¹5•É”¡É•ÍÕ±ÑÌ¤ì(€¥˜€ …¥Í±±=˜¤(€€€™…¥±•‘½¹Ñ•áÑÌ¹™½É…  ¡™…¥±•¤€ôø™…¥±•¹•ÑÉÉ½ÉÌ ¤¹™½É…  ¡•ÉÉ½È¤€ôø½¹Ñ•áÐ¹‘‘ÉÉ½È¡•ÉÉ½È¤¤¤ì(€É•ÑÕÉ¸¥Í±±=˜ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½…¹å=˜¹µ©Ì)™Õ¹Ñ¥½¸¡•­¹å=˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐÉ•ÍÕ±ÑÌ€ôÍ¡•µ„¹…¹å=˜¹É•‘Õ” ¡É•ÍÕ±Ð°Í¡•µ„È¤€ôøì(€€€½¹ÍÐ¹•áÑ½¹Ñ•áÐ€ô¹•Ü¡•­½¹Ñ•áÐ ¤ì(€€€É•ÑÕÉ¸¡•­M¡•µ„¡ÍÑ…¬°¹•áÑ½¹Ñ•áÐ°Í¡•µ„È°Ù…±Õ”¤€ül¸¸¹É•ÍÕ±Ð°¹•áÑ½¹Ñ•áÑt€èÉ•ÍÕ±Ðì(€ô°mt¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉ•…Ñ•ÉQ¡…¸¡É•ÍÕ±ÑÌ¹±•¹Ñ °€À¤€˜˜½¹Ñ•áÐ¹5•É”¡É•ÍÕ±ÑÌ¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½É¹å=˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐ™…¥±•‘½¹Ñ•áÑÌ€ômtì(€½¹ÍÐÉ•ÍÕ±ÑÌ€ôÍ¡•µ„¹…¹å=˜¹É•‘Õ” ¡É•ÍÕ±Ð°Í¡•µ„È°¥¹‘•à¤€ôøì(€€€½¹ÍÐ¹•áÑ½¹Ñ•áÐ€ô¹•ÜÕµÕ±…Ñ•‘ÉÉ½É½¹Ñ•áÐ ¤ì(€€€½¹ÍÐ¹•áÑM¡•µ…A…Ñ €ô€‘íÍ¡•µ…A…Ñ¡ô½…¹å=˜¼‘í¥¹‘•áõ€ì(€€€½¹ÍÐ¥ÍM¡•µ„€ôÉÉ½ÉM¡•µ„¡ÍÑ…¬°¹•áÑ½¹Ñ•áÐ°¹•áÑM¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„È°Ù…±Õ”¤ì(€€€¥˜€ …¥ÍM¡•µ„¤(€€€€€™…¥±•‘½¹Ñ•áÑÌ¹ÁÕÍ ¡¹•áÑ½¹Ñ•áÐ¤ì(€€€É•ÑÕÉ¸¥ÍM¡•µ„€ül¸¸¹É•ÍÕ±Ð°¹•áÑ½¹Ñ•áÑt€èÉ•ÍÕ±Ðì(€ô°mt¤ì(€½¹ÍÐ¥Í¹å=˜€ôÕ…É‘}•áÁ½ÉÑÌ¹%ÍÉ•…Ñ•ÉQ¡…¸¡É•ÍÕ±ÑÌ¹±•¹Ñ °€À¤€˜˜½¹Ñ•áÐ¹5•É”¡É•ÍÕ±ÑÌ¤ì(€¥˜€ …¥Í¹å=˜¤(€€€™…¥±•‘½¹Ñ•áÑÌ¹™½É…  ¡™…¥±•¤€ôø™…¥±•¹•ÑÉÉ½ÉÌ ¤¹™½É…  ¡•ÉÉ½È¤€ôø½¹Ñ•áÐ¹‘‘ÉÉ½È¡•ÉÉ½È¤¤¤ì(€É•ÑÕÉ¸¥Í¹å=˜ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰…¹å=˜ˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèíô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½‰½½±•…¸¹µ©Ì)™Õ¹Ñ¥½¸¡•­M¡•µ…	½½±•…¸¡}ÍÑ…¬°}½¹Ñ•áÐ°Í¡•µ„°}Ù…±Õ”¤ì(€É•ÑÕÉ¸Í¡•µ„ì)ô)™Õ¹Ñ¥½¸ÉÉ½ÉM¡•µ…	½½±•…¸¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸¡•­M¡•µ…	½½±•…¸¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰‰½½±•…¸ˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèíô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½½¹ÍÐ¹µ©Ì)™Õ¹Ñ¥½¸¡•­½¹ÍÐ¡}ÍÑ…¬°}½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍY…±Õ•1¥­”¡Í¡•µ„¹½¹ÍÐ¤€üÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Ù…±Õ”°Í¡•µ„¹½¹ÍÐ¤€èÕ…É‘}•áÁ½ÉÑÌ¹%Í••ÁÅÕ…°¡Ù…±Õ”°Í¡•µ„¹½¹ÍÐ¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½É½¹ÍÐ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸¡•­½¹ÍÐ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰½¹ÍÐˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèì…±±½Ý•‘Y…±Õ”èÍ¡•µ„¹½¹ÍÐô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½½¹Ñ…¥¹Ì¹µ©Ì)™Õ¹Ñ¥½¸%ÍY…±¥È¡Í¡•µ„¤ì(€É•ÑÕÉ¸€„¡%Í5¥¹½¹Ñ…¥¹Ì¡Í¡•µ„¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Í¡•µ„¹µ¥¹½¹Ñ…¥¹Ì°€À¤¤ì)ô)™Õ¹Ñ¥½¸¡•­½¹Ñ…¥¹Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€¥˜€ …%ÍY…±¥È¡Í¡•µ„¤¤(€€€É•ÑÕÉ¸ÑÉÕ”ì(€É•ÑÕÉ¸€…Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Ù…±Õ”¹±•¹Ñ °€À¤€˜˜Ù…±Õ”¹Í½µ” ¡¥Ñ•´¤€ôø¡•­M¡•µ„¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„¹½¹Ñ…¥¹Ì°¥Ñ•´¤¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½É½¹Ñ…¥¹Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸¡•­½¹Ñ…¥¹Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰½¹Ñ…¥¹Ìˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèìµ¥¹½¹Ñ…¥¹Ìè€Äô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½‘•Á•¹‘•¹¥•Ì¹µ©Ì)™Õ¹Ñ¥½¸¡•­•Á•¹‘•¹¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐ¥Í1•¹Ñ €ôÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Õ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡Ù…±Õ”¤¹±•¹Ñ °€À¤ì(€½¹ÍÐ¥ÍÙ•Éä€ôÕ…É‘}•áÁ½ÉÑÌ¹Ù•Éä¡Õ…É‘}•áÁ½ÉÑÌ¹¹ÑÉ¥•Ì¡Í¡•µ„¹‘•Á•¹‘•¹¥•Ì¤°€À°€¡m­•ä°Í¡•µ„Ét¤€ôøì(€€€É•ÑÕÉ¸€…Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Ù…±Õ”°­•ä¤ñð€¡Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Í¡•µ„È¤€üÍ¡•µ„È¹•Ù•Éä ¡­•äÈ¤€ôøÕ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Ù…±Õ”°­•äÈ¤¤€è¡•­M¡•µ„¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„È°Ù…±Õ”¤¤ì(€ô¤ì(€É•ÑÕÉ¸¥Í1•¹Ñ ñð¥ÍÙ•Éäì)ô)™Õ¹Ñ¥½¸ÉÉ½É•Á•¹‘•¹¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐ¥Í1•¹Ñ €ôÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Õ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡Ù…±Õ”¤¹±•¹Ñ °€À¤ì(€½¹ÍÐ¥ÍÙ•Éä€ôÕ…É‘}•áÁ½ÉÑÌ¹Ù•Éå±°¡Õ…É‘}•áÁ½ÉÑÌ¹¹ÑÉ¥•Ì¡Í¡•µ„¹‘•Á•¹‘•¹¥•Ì¤°€À°€¡m­•ä°Í¡•µ„Ét¤€ôøì(€€€½¹ÍÐ¹•áÑM¡•µ…A…Ñ €ô€‘íÍ¡•µ…A…Ñ¡ô½‘•Á•¹‘•¹¥•Ì¼‘í­•åõ€ì(€€€É•ÑÕÉ¸€…Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Ù…±Õ”°­•ä¤ñð€¡Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Í¡•µ„È¤€üÍ¡•µ„È¹•Ù•Éä ¡‘•Á•¹‘•¹ä¤€ôøÕ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Ù…±Õ”°‘•Á•¹‘•¹ä¤ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€€€­•åÝ½Éè€‰‘•Á•¹‘•¹¥•Ìˆ°(€€€€€Í¡•µ…A…Ñ °(€€€€€¥¹ÍÑ…¹•A…Ñ °(€€€€€Á…É…µÌèìÁÉ½Á•ÉÑäè­•ä°‘•Á•¹‘•¹¥•ÌèÍ¡•µ„Èô(€€€ô¤¤€èÉÉ½ÉM¡•µ„¡ÍÑ…¬°½¹Ñ•áÐ°¹•áÑM¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„È°Ù…±Õ”¤¤ì(€ô¤ì(€É•ÑÕÉ¸¥Í1•¹Ñ ñð¥ÍÙ•Éäì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½‘•Á•¹‘•¹ÑI•ÅÕ¥É•¹µ©Ì)™Õ¹Ñ¥½¸¡•­•Á•¹‘•¹ÑI•ÅÕ¥É•¡}ÍÑ…¬°}½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐ¥Í1•¹Ñ €ôÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Õ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡Ù…±Õ”¤¹±•¹Ñ °€À¤ì(€½¹ÍÐ¥ÍÙ•Éä€ôÕ…É‘}•áÁ½ÉÑÌ¹Ù•Éä¡Õ…É‘}•áÁ½ÉÑÌ¹¹ÑÉ¥•Ì¡Í¡•µ„¹‘•Á•¹‘•¹ÑI•ÅÕ¥É•¤°€À°€¡m­•ä°­•åÍt¤€ôøì(€€€É•ÑÕÉ¸€…Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Ù…±Õ”°­•ä¤ñð­•åÌ¹•Ù•Éä ¡­•äÈ¤€ôøÕ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Ù…±Õ”°­•äÈ¤¤ì(€ô¤ì(€É•ÑÕÉ¸¥Í1•¹Ñ ñð¥ÍÙ•Éäì)ô)™Õ¹Ñ¥½¸ÉÉ½É•Á•¹‘•¹ÑI•ÅÕ¥É•¡}ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐ¥Í1•¹Ñ €ôÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Õ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡Ù…±Õ”¤¹±•¹Ñ °€À¤ì(€½¹ÍÐ¥ÍÙ•Éå¹ÑÉä€ôÕ…É‘}•áÁ½ÉÑÌ¹Ù•Éå±°¡Õ…É‘}•áÁ½ÉÑÌ¹¹ÑÉ¥•Ì¡Í¡•µ„¹‘•Á•¹‘•¹ÑI•ÅÕ¥É•¤°€À°€¡m­•ä°­•åÍt¤€ôøì(€€€É•ÑÕÉ¸€…Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Ù…±Õ”°­•ä¤ñðÕ…É‘}•áÁ½ÉÑÌ¹Ù•Éå±°¡­•åÌ°€À°€¡‘•Á•¹‘•¹ä¤€ôøÕ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Ù…±Õ”°‘•Á•¹‘•¹ä¤ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€€€­•åÝ½Éè€‰‘•Á•¹‘•¹ÑI•ÅÕ¥É•ˆ°(€€€€€Í¡•µ…A…Ñ °(€€€€€¥¹ÍÑ…¹•A…Ñ °(€€€€€Á…É…µÌèìÁÉ½Á•ÉÑäè­•ä°‘•Á•¹‘•¹¥•Ìè­•åÌô(€€€ô¤¤ì(€ô¤ì(€É•ÑÕÉ¸¥Í1•¹Ñ ñð¥ÍÙ•Éå¹ÑÉäì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½‘•Á•¹‘•¹ÑM¡•µ…Ì¹µ©Ì)™Õ¹Ñ¥½¸¡•­•Á•¹‘•¹ÑM¡•µ…Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐ¥Í1•¹Ñ €ôÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Õ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡Ù…±Õ”¤¹±•¹Ñ °€À¤ì(€½¹ÍÐ¥ÍÙ•Éä€ôÕ…É‘}•áÁ½ÉÑÌ¹Ù•Éä¡Õ…É‘}•áÁ½ÉÑÌ¹¹ÑÉ¥•Ì¡Í¡•µ„¹‘•Á•¹‘•¹ÑM¡•µ…Ì¤°€À°€¡m­•ä°Í¡•µ„Ét¤€ôøì(€€€É•ÑÕÉ¸€…Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Ù…±Õ”°­•ä¤ñð¡•­M¡•µ„¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„È°Ù…±Õ”¤ì(€ô¤ì(€É•ÑÕÉ¸¥Í1•¹Ñ ñð¥ÍÙ•Éäì)ô)™Õ¹Ñ¥½¸ÉÉ½É•Á•¹‘•¹ÑM¡•µ…Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐ¥Í1•¹Ñ €ôÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Õ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡Ù…±Õ”¤¹±•¹Ñ °€À¤ì(€½¹ÍÐ¥ÍÙ•Éä€ôÕ…É‘}•áÁ½ÉÑÌ¹Ù•Éå±°¡Õ…É‘}•áÁ½ÉÑÌ¹¹ÑÉ¥•Ì¡Í¡•µ„¹‘•Á•¹‘•¹ÑM¡•µ…Ì¤°€À°€¡m­•ä°Í¡•µ„Ét¤€ôøì(€€€½¹ÍÐ¹•áÑM¡•µ…A…Ñ €ô€‘íÍ¡•µ…A…Ñ¡ô½‘•Á•¹‘•¹ÑM¡•µ…Ì¼‘í­•åõ€ì(€€€É•ÑÕÉ¸€…Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Ù…±Õ”°­•ä¤ñðÉÉ½ÉM¡•µ„¡ÍÑ…¬°½¹Ñ•áÐ°¹•áÑM¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„È°Ù…±Õ”¤ì(€ô¤ì(€É•ÑÕÉ¸¥Í1•¹Ñ ñð¥ÍÙ•Éäì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½‘å¹…µ¥I•˜¹µ©Ì)™Õ¹Ñ¥½¸¡•­å¹…µ¥I•˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐÑ…É•Ð€ôÍÑ…¬¹å¹…µ¥I•˜¡Í¡•µ„¤€üü™…±Í”ì(€É•ÑÕÉ¸%ÍM¡•µ„È¡Ñ…É•Ð¤€˜˜¡•­M¡•µ„¡ÍÑ…¬°½¹Ñ•áÐ°Ñ…É•Ð°Ù…±Õ”¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½Éå¹…µ¥I•˜¡ÍÑ…¬°½¹Ñ•áÐ°}Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐÑ…É•Ð€ôÍÑ…¬¹å¹…µ¥I•˜¡Í¡•µ„¤€üü™…±Í”ì(€É•ÑÕÉ¸%ÍM¡•µ„È¡Ñ…É•Ð¤€˜˜ÉÉ½ÉM¡•µ„¡ÍÑ…¬°½¹Ñ•áÐ°€ˆŒˆ°¥¹ÍÑ…¹•A…Ñ °Ñ…É•Ð°Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½•¹Õ´¹µ©Ì)™Õ¹Ñ¥½¸¡•­¹Õ´¡}ÍÑ…¬°}½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸Í¡•µ„¹•¹Õ´¹Í½µ” ¡½ÁÑ¥½¸¤€ôøÕ…É‘}•áÁ½ÉÑÌ¹%ÍY…±Õ•1¥­”¡½ÁÑ¥½¸¤€üÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Ù…±Õ”°½ÁÑ¥½¸¤€èÕ…É‘}•áÁ½ÉÑÌ¹%Í••ÁÅÕ…°¡Ù…±Õ”°½ÁÑ¥½¸¤¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½É¹Õ´¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸¡•­¹Õ´¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰•¹Õ´ˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèì…±±½Ý•‘Y…±Õ•ÌèÍ¡•µ„¹•¹Õ´ô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½•á±ÕÍ¥Ù•5…á¥µÕ´¹µ©Ì)™Õ¹Ñ¥½¸¡•­á±ÕÍ¥Ù•5…á¥µÕ´¡}ÍÑ…¬°}½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%Í1•ÍÍQ¡…¸¡Ù…±Õ”°Í¡•µ„¹•á±ÕÍ¥Ù•5…á¥µÕ´¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½Éá±ÕÍ¥Ù•5…á¥µÕ´¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸¡•­á±ÕÍ¥Ù•5…á¥µÕ´¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰•á±ÕÍ¥Ù•5…á¥µÕ´ˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèì½µÁ…É¥Í½¸è€ˆðˆ°±¥µ¥ÐèÍ¡•µ„¹•á±ÕÍ¥Ù•5…á¥µÕ´ô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½•á±ÕÍ¥Ù•5¥¹¥µÕ´¹µ©Ì)™Õ¹Ñ¥½¸¡•­á±ÕÍ¥Ù•5¥¹¥µÕ´¡}ÍÑ…¬°}½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉ•…Ñ•ÉQ¡…¸¡Ù…±Õ”°Í¡•µ„¹•á±ÕÍ¥Ù•5¥¹¥µÕ´¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½Éá±ÕÍ¥Ù•5¥¹¥µÕ´¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸¡•­á±ÕÍ¥Ù•5¥¹¥µÕ´¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰•á±ÕÍ¥Ù•5¥¹¥µÕ´ˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèì½µÁ…É¥Í½¸è€ˆøˆ°±¥µ¥ÐèÍ¡•µ„¹•á±ÕÍ¥Ù•5¥¹¥µÕ´ô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½™½Éµ…Ð½™½Éµ…Ð¹µ©Ì)Ù…È™½Éµ…Ñ}•áÁ½ÉÑÌ€ôíôì)}}•áÁ½ÉÐ¡™½Éµ…Ñ}•áÁ½ÉÑÌ°ì(€±•…Èè€ ¤€ôø±•…È°(€¹ÑÉ¥•Ìè€ ¤€ôø¹ÑÉ¥•ÌÈ°(€•Ðè€ ¤€ôø•ÐÌ°(€!…Ìè€ ¤€ôø!…Ì°(€%Í…Ñ”è€ ¤€ôø%Í…Ñ”È°(€%Í…Ñ•Q¥µ”è€ ¤€ôø%Í…Ñ•Q¥µ”°(€%ÍÕÉ…Ñ¥½¸è€ ¤€ôø%ÍÕÉ…Ñ¥½¸°(€%Íµ…¥°è€ ¤€ôø%Íµ…¥°°(€%Í!½ÍÑ¹…µ”è€ ¤€ôø%Í!½ÍÑ¹…µ”°(€%Í%AØÐè€ ¤€ôø%Í%AØÐ°(€%Í%AØØè€ ¤€ôø%Í%AØØ°(€%Í%‘¹µ…¥°è€ ¤€ôø%Í%‘¹µ…¥°°(€%Í%‘¹!½ÍÑ¹…µ”è€ ¤€ôø%Í%‘¹!½ÍÑ¹…µ”°(€%Í%É¤è€ ¤€ôø%Í%É¤°(€%Í%É¥I•™•É•¹”è€ ¤€ôø%Í%É¥I•™•É•¹”°(€%Í)Í½¹A½¥¹Ñ•Èè€ ¤€ôø%Í)Í½¹A½¥¹Ñ•È°(€%Í)Í½¹A½¥¹Ñ•ÉUÉ¥É…µ•¹Ðè€ ¤€ôø%Í)Í½¹A½¥¹Ñ•ÉUÉ¥É…µ•¹Ð°(€%ÍI••àè€ ¤€ôø%ÍI••à°(€%ÍI•±…Ñ¥Ù•)Í½¹A½¥¹Ñ•Èè€ ¤€ôø%ÍI•±…Ñ¥Ù•)Í½¹A½¥¹Ñ•È°(€%ÍQ¥µ”è€ ¤€ôø%ÍQ¥µ”°(€%ÍUÉ¤è€ ¤€ôø%ÍUÉ¤°(€%ÍUÉ¥I•™•É•¹”è€ ¤€ôø%ÍUÉ¥I•™•É•¹”°(€%ÍUÉ¥Q•µÁ±…Ñ”è€ ¤€ôø%ÍUÉ¥Q•µÁ±…Ñ”°(€%ÍUÉ°è€ ¤€ôø%ÍUÉ°°(€%ÍUÕ¥è€ ¤€ôø%ÍUÕ¥°(€I•Í•Ðè€ ¤€ôøI•Í•ÐÈ°(€M•Ðè€ ¤€ôøM•ÐÌ°(€Q•ÍÐè€ ¤€ôøQ•ÍÐ)ô¤ì((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½™½Éµ…Ð½‘…Ñ”¹µ©Ì)Ù…ÈeL€ôlÀ°€ÌÄ°€Èà°€ÌÄ°€ÌÀ°€ÌÄ°€ÌÀ°€ÌÄ°€ÌÄ°€ÌÀ°€ÌÄ°€ÌÀ°€ÌÅtì)Ù…ÈQ€ô€½x¡q‘q‘q‘q¤´¡q‘q¤´¡q‘q¤¼ì)™Õ¹Ñ¥½¸%Í1•…Áe•…È¡å•…È¤ì(€É•ÑÕÉ¸å•…È€”€Ð€ôôô€À€˜˜€¡å•…È€”€ÄÀÀ€„ôô€Àñðå•…È€”€ÐÀÀ€ôôô€À¤ì)ô)™Õ¹Ñ¥½¸%Í…Ñ”È¡Ù…±Õ”¤ì(€½¹ÍÐµ…Ñ¡•Ì€ôQ¹•á•Œ¡Ù…±Õ”¤ì(€¥˜€ …µ…Ñ¡•Ì¤(€€€É•ÑÕÉ¸™…±Í”ì(€½¹ÍÐå•…È€ô€­µ…Ñ¡•ÍlÅtì(€½¹ÍÐµ½¹Ñ €ô€­µ…Ñ¡•ÍlÉtì(€½¹ÍÐ‘…ä€ô€­µ…Ñ¡•ÍlÍtì(€É•ÑÕÉ¸µ½¹Ñ €øô€Ä€˜˜µ½¹Ñ €ðô€ÄÈ€˜˜‘…ä€øô€Ä€˜˜‘…ä€ðô€¡µ½¹Ñ €ôôô€È€˜˜%Í1•…Áe•…È¡å•…È¤€ü€Èä€èeMmµ½¹Ñ¡t¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½™½Éµ…Ð½Ñ¥µ”¹µ©Ì)Ù…ÈQ%5€ô€½x¡q‘q¤è¡q‘q¤è¡q‘q üép¹q¬¤ü¤ üéið¡l¬µt¤¡q‘q¤è¡q‘q¤¤ü½¤ì)™Õ¹Ñ¥½¸%ÍQ¥µ”¡Ù…±Õ”°ÍÑÉ¥ÑQ¥µ•i½¹”€ôÑÉÕ”¤ì(€½¹ÍÐµ…Ñ¡•Ì€ôQ%5¹•á•Œ¡Ù…±Õ”¤ì(€¥˜€ …µ…Ñ¡•Ì¤(€€€É•ÑÕÉ¸™…±Í”ì(€½¹ÍÐ¡È€ô€­µ…Ñ¡•ÍlÅtì(€½¹ÍÐµ¥¸€ô€­µ…Ñ¡•ÍlÉtì(€½¹ÍÐÍ•Œ€ô€­µ…Ñ¡•ÍlÍtì(€½¹ÍÐÑéM¥¸€ôµ…Ñ¡•ÍlÑt€ôôô€ˆ´ˆ€ü€´Ä€è€Äì(€½¹ÍÐÑé €ô€¬¡µ…Ñ¡•ÍlÕtñð€À¤ì(€½¹ÍÐÑé4€ô€¬¡µ…Ñ¡•ÍlÙtñð€À¤ì(€¥˜€¡Ñé €ø€ÈÌñðÑé4€ø€Ôä¤(€€€É•ÑÕÉ¸™…±Í”ì(€¥˜€¡ÍÑÉ¥ÑQ¥µ•i½¹”€˜˜€…µ…Ñ¡•ÍlÑt€˜˜Ù…±Õ”¹Ñ½1½Ý•É…Í” ¤¹¥¹‘•á=˜ ‰èˆ¤€ôôô€´Ä¤ì(€€€É•ÑÕÉ¸™…±Í”ì(€ô(€¥˜€¡¡È€ðô€ÈÌ€˜˜µ¥¸€ðô€Ôä€˜˜Í•Œ€ð€ØÀ¤(€€€É•ÑÕÉ¸ÑÉÕ”ì(€½¹ÍÐÕÑ5¥¸€ôµ¥¸€´Ñé4€¨ÑéM¥¸ì(€½¹ÍÐÕÑ!È€ô¡È€´Ñé €¨ÑéM¥¸€´€¡ÕÑ5¥¸€ð€À€ü€Ä€è€À¤ì(€É•ÑÕÉ¸€¡ÕÑ!È€ôôô€ÈÌñðÕÑ!È€ôôô€´Ä¤€˜˜€¡ÕÑ5¥¸€ôôô€ÔäñðÕÑ5¥¸€ôôô€´Ä¤€˜˜Í•Œ€ð€ØÄì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½™½Éµ…Ð½‘…Ñ•}Ñ¥µ”¹µ©Ì)™Õ¹Ñ¥½¸%Í…Ñ•Q¥µ”¡Ù…±Õ”°ÍÑÉ¥ÑQ¥µ•i½¹”€ôÑÉÕ”¤ì(€½¹ÍÐ‘…Ñ•Q¥µ”€ôÙ…±Õ”¹ÍÁ±¥Ð ½P½¤¤ì(€É•ÑÕÉ¸‘…Ñ•Q¥µ”¹±•¹Ñ €ôôô€È€˜˜%Í…Ñ”È¡‘…Ñ•Q¥µ•lÁt¤€˜˜%ÍQ¥µ”¡‘…Ñ•Q¥µ•lÅt°ÍÑÉ¥ÑQ¥µ•i½¹”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½™½Éµ…Ð½‘ÕÉ…Ñ¥½¸¹µ©Ì)Ù…ÈÕÉ…Ñ¥½¸€ô€½y@ ¡q­d¡q­4¡q­¤ü¤ýñq­4¡q­¤ýñq­¤¡P¡q­ ¡q­4¡q­L¤ü¤ýñq­4¡q­L¤ýñq­L¤¤ýñP¡q­ ¡q­4¡q­L¤ü¤ýñq­4¡q­L¤ýñq­L¥ñq­\¤¼ì)™Õ¹Ñ¥½¸%ÍÕÉ…Ñ¥½¸¡Ù…±Õ”¤ì(€É•ÑÕÉ¸ÕÉ…Ñ¥½¸¹Ñ•ÍÐ¡Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½™½Éµ…Ð½•µ…¥°¹µ©Ì)Ù…Èµ…¥°€ô€½x ü„¸©p¹p¸¥m„µèÀ´ä„Œ”˜œ¨¬¼ôýy}íñõøµt¬ üép¹m„µèÀ´ä„Œ”˜œ¨¬¼ôýy}íñõøµt¬¤©m„µèÀ´åt üém„µèÀ´äµuìÀ°ØÅõm„µèÀ´åt¤ü üép¹m„µèÀ´åt üém„µèÀ´äµuìÀ°ØÅõm„µèÀ´åt¤ü¤¨½¤ì)™Õ¹Ñ¥½¸%Íµ…¥°¡Ù…±Õ”¤ì(€É•ÑÕÉ¸µ…¥°¹Ñ•ÍÐ¡Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½™½Éµ…Ð½}ÁÕ¹ä¹µ©Ì)Ù…ÈAU9e=}	M€ô€ÌØì)Ù…ÈAU9e=}Q5%8€ô€Äì)Ù…ÈAU9e=}Q5`€ô€ÈØì)Ù…ÈAU9e=}M-\€ô€Ìàì)Ù…ÈAU9e=}5@€ô€ÜÀÀì)Ù…ÈAU9e=}%9%Q%1}	%L€ô€ÜÈì)Ù…ÈAU9e=}%9%Q%1}8€ô€ÄÈàì)™Õ¹Ñ¥½¸‘…ÁÐ¡‘•±Ñ„°¹ÕµA½¥¹ÑÌ°™¥ÉÍÑQ¥µ”¤ì(€‘•±Ñ„€ô™¥ÉÍÑQ¥µ”€ü5…Ñ ¹™±½½È¡‘•±Ñ„€¼AU9e=}5@¤€è‘•±Ñ„€øø€Äì(€‘•±Ñ„€¬ô5…Ñ ¹™±½½È¡‘•±Ñ„€¼¹ÕµA½¥¹ÑÌ¤ì(€±•Ð¬€ô€Àì(€Ý¡¥±”€¡‘•±Ñ„€ø€¡AU9e=}	M€´AU9e=}Q5%8¤€¨AU9e=}Q5`€øø€Ä¤ì(€€€‘•±Ñ„€ô5…Ñ ¹™±½½È¡‘•±Ñ„€¼€¡AU9e=}	M€´AU9e=}Q5%8¤¤ì(€€€¬€¬ôAU9e=}	Mì(€ô(€É•ÑÕÉ¸¬€¬5…Ñ ¹™±½½È ¡AU9e=}	M€´AU9e=}Q5%8€¬€Ä¤€¨‘•±Ñ„€¼€¡‘•±Ñ„€¬AU9e=}M-\¤¤ì)ô)™Õ¹Ñ¥½¸•½‘”È¡Ù…±Õ”¤ì(€½¹ÍÐ½ÕÑÁÕÐ€ômtì(€±•Ð¸€ôAU9e=}%9%Q%1}8ì(€±•Ð¤€ô€Àì(€±•Ð‰¥…Ì€ôAU9e=}%9%Q%1}	%Lì(€½¹ÍÐ‘•±¥µ%‘à€ôÙ…±Õ”¹±…ÍÑ%¹‘•á=˜ ˆ´ˆ¤ì(€¥˜€¡‘•±¥µ%‘à€ø€À¤ì(€€€™½È€¡±•Ð¨€ô€Àì¨€ð‘•±¥µ%‘àì¨¬¬¤ì(€€€€€½¹ÍÐÀ€ôÙ…±Õ”¹¡…É½‘•Ð¡¨¤ì(€€€€€¥˜€¡À€øô€ÄÈà¤(€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰%¹Ù…±¥ÁÕ¹å½‘”è¹½¸µ‰…Í¥Œ‰•™½É”‘•±¥µ¥Ñ•Èˆ¤ì(€€€€€½ÕÑÁÕÐ¹ÁÕÍ ¡À¤ì(€€€ô(€ô(€±•Ð¥¹%‘à€ô‘•±¥µ%‘à€ð€À€ü€À€è‘•±¥µ%‘à€¬€Äì(€Ý¡¥±”€¡¥¹%‘à€ðÙ…±Õ”¹±•¹Ñ ¤ì(€€€½¹ÍÐ½±‘¤€ô¤ì(€€€±•ÐÜ€ô€Äì(€€€±•Ð¬€ôAU9e=}	Mì(€€€Ý¡¥±”€¡ÑÉÕ”¤ì(€€€€€¥˜€¡¥¹%‘à€øôÙ…±Õ”¹±•¹Ñ ¤(€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰%¹Ù…±¥ÁÕ¹å½‘”èÕ¹•áÁ•Ñ••¹½˜¥¹ÁÕÐˆ¤ì(€€€€€½¹ÍÐ €ôÙ…±Õ”¹¡…É½‘•Ð¡¥¹%‘à¬¬¤ì(€€€€€±•Ð‘¥¥Ðì(€€€€€¥˜€¡ €øô€äÜ€˜˜ €ðô€ÄÈÈ¤(€€€€€€€‘¥¥Ð€ô €´€äÜì(€€€€€•±Í”¥˜€¡ €øô€Ðà€˜˜ €ðô€ÔÜ¤(€€€€€€€‘¥¥Ð€ô €´€Ðà€¬€ÈØì(€€€€€•±Í”¥˜€¡ €øô€ØÔ€˜˜ €ðô€äÀ¤(€€€€€€€U¹É•…¡…‰±” ¤ì(€€€€€•±Í”(€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰%¹Ù…±¥ÁÕ¹å½‘”è‰…‘¥¥Ð¡…É…Ñ•Èˆ¤ì(€€€€€¤€¬ô‘¥¥Ð€¨Üì(€€€€€½¹ÍÐÐ€ô¬€ðô‰¥…Ì€üAU9e=}Q5%8€è¬€øô‰¥…Ì€¬AU9e=}Q5`€üAU9e=}Q5`€è¬€´‰¥…Ìì(€€€€€¥˜€¡‘¥¥Ð€ðÐ¤(€€€€€€€‰É•…¬ì(€€€€€Ü€¨ôAU9e=}	M€´Ðì(€€€€€¬€¬ôAU9e=}	Mì(€€€ô(€€€½¹ÍÐ½ÕÑ1•¸€ô½ÕÑÁÕÐ¹±•¹Ñ €¬€Äì(€€€‰¥…Ì€ô‘…ÁÐ¡¤€´½±‘¤°½ÕÑ1•¸°½±‘¤€ôôô€À¤ì(€€€¸€¬ô5…Ñ ¹™±½½È¡¤€¼½ÕÑ1•¸¤ì(€€€¤€”ô½ÕÑ1•¸ì(€€€½ÕÑÁÕÐ¹ÍÁ±¥”¡¤°€À°¸¤ì(€€€¤¬¬ì(€ô(€É•ÑÕÉ¸±½‰…±Q¡¥Ì¹MÑÉ¥¹œ¹™É½µ½‘•A½¥¹Ð ¸¸¹½ÕÑÁÕÐ¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½™½Éµ…Ð½}¥‘¹„¹µ©Ì)™Õ¹Ñ¥½¸%Í9½¹ÍÁ…¥¹5…É¬¡À¤ì(€É•ÑÕÉ¸€½qÁí5¹ô½Ô¹Ñ•ÍÐ¡MÑÉ¥¹œ¹™É½µ½‘•A½¥¹Ð¡À¤¤ì)ô)™Õ¹Ñ¥½¸%ÍMÁ…¥¹½µ‰¥¹¥¹5…É¬¡À¤ì(€É•ÑÕÉ¸€½qÁí5ô½Ô¹Ñ•ÍÐ¡MÑÉ¥¹œ¹™É½µ½‘•A½¥¹Ð¡À¤¤ì)ô)™Õ¹Ñ¥½¸%Í¹±½Í¥¹5…É¬¡À¤ì(€É•ÑÕÉ¸€½qÁí5•ô½Ô¹Ñ•ÍÐ¡MÑÉ¥¹œ¹™É½µ½‘•A½¥¹Ð¡À¤¤ì)ô)™Õ¹Ñ¥½¸%Í½µ‰¥¹¥¹5…É¬È¡À¤ì(€É•ÑÕÉ¸%Í9½¹ÍÁ…¥¹5…É¬¡À¤ñð%ÍMÁ…¥¹½µ‰¥¹¥¹5…É¬¡À¤ñð%Í¹±½Í¥¹5…É¬¡À¤ì)ô)Ù…ÈIÔàäÉ}%M11=]€ô€¼¨}}AUI}|€¨¼¹•ÜM•Ð¡l(€€ÄØÀÀ°(€€¼¼I	%QQ]0(€€ÈÀÐÈ°(€€¼¼9-<1)9e18(€€ÄÈÌÌÐ°(€€¼¼!9U0M%91=PQ=95I,(€€ÄÈÌÌÔ°(€€¼¼!9U0=U	1=PQ=95I,(€€ÄÈÌÌÜ°(€€¼¼YIQ%0-9IAP5I,(€€ÄÈÌÌà°(€€¼¼YIQ%0-9IAP]%Q Y=%%QIQ%=85I,(€€ÄÈÌÌä°(€€¼¼YIQ%0-9IAP5I,UAAH!1(€€ÄÈÌÐÀ°(€€¼¼YIQ%0-9IAP]%Q Y=%%QIQ%=85I,UAAH!1(€€ÄÈÌÐÄ°(€€¼¼YIQ%0-9IAP5I,1=]H!1(€€ÄÈÌÐÜ(€€¼¼YIQ%0%=IA!%%QIQ%=85I,)t¤ì)Ù…ÈY%I5}AL€ô€¼¨}}AUI}|€¨¼¹•ÜM•Ð¡l(€€ÈÌàÄ°(€€ÈÔÀä°(€€ÈØÌÜ°(€€ÈÜØÔ°(€€ÈàäÌ°(€€ÌÀÈÄ°(€€ÌÄÐä°(€€ÌÈÜÜ°(€€ÌÌàÜ°(€€ÌÌàà°(€€ÌÐÀÔ°(€€ÌÔÌÀ°(€€ØäàÀ°(€€ÜÀàÈ°(€€ÜÀàÌ°(€€ÐÌÐÔØ°(€€ØäÜÀÈ°(€€ØäÜÔä°(€€ØäàÄÜ°(€€ØääÌä°(€€ØääÐÀ°(€€ÜÀÀàÀ°(€€ÜÀÄäÜ°(€€ÜÀÐÜÜ°(€€ÜÀÜÈÈ°(€€ÜÀàÔÀ°(€€ÜÄÄÀÌ°(€€ÜÄÈÌÄ°(€€ÜÄÌÔÀ°(€€ÜÈÜØÜ°(€€ÜÌÀÈà°(€€ÜÌÀÈä)t¤ì)™Õ¹Ñ¥½¸%ÍÉ••¬¡À¤ì(€É•ÑÕÉ¸€½qÁíMÉ¥ÁÐõÉ••­ô½Ô¹Ñ•ÍÐ¡MÑÉ¥¹œ¹™É½µ½‘•A½¥¹Ð¡À¤¤ì)ô)™Õ¹Ñ¥½¸%Í!•‰É•Ü¡À¤ì(€É•ÑÕÉ¸€½qÁíMÉ¥ÁÐõ!•‰É•Ýô½Ô¹Ñ•ÍÐ¡MÑÉ¥¹œ¹™É½µ½‘•A½¥¹Ð¡À¤¤ì)ô)™Õ¹Ñ¥½¸%Í!¥É……¹„¡À¤ì(€É•ÑÕÉ¸€½qÁíMÉ¥ÁÐõ!¥É……¹…ô½Ô¹Ñ•ÍÐ¡MÑÉ¥¹œ¹™É½µ½‘•A½¥¹Ð¡À¤¤ì)ô)™Õ¹Ñ¥½¸%Í-…Ñ…­…¹„¡À¤ì(€É•ÑÕÉ¸€½qÁíMÉ¥ÁÐõ-…Ñ…­…¹…ô½Ô¹Ñ•ÍÐ¡MÑÉ¥¹œ¹™É½µ½‘•A½¥¹Ð¡À¤¤ì)ô)™Õ¹Ñ¥½¸%Í!…¸¡À¤ì(€É•ÑÕÉ¸€½qÁíMÉ¥ÁÐõ!…¹ô½Ô¹Ñ•ÍÐ¡MÑÉ¥¹œ¹™É½µ½‘•A½¥¹Ð¡À¤¤ì)ô)™Õ¹Ñ¥½¸%ÍÉ…‰¥%¹‘¥¥¥Ð¡À¤ì(€É•ÑÕÉ¸À€øô€ÄØÌÈ€˜˜À€ðô€ÄØÐÄì)ô)™Õ¹Ñ¥½¸%ÍáÑ•¹‘•‘É…‰¥%¹‘¥¥¥Ð¡À¤ì(€É•ÑÕÉ¸À€øô€ÄÜÜØ€˜˜À€ðô€ÄÜàÔì)ô)™Õ¹Ñ¥½¸%ÍY¥É…µ„¡À¤ì(€É•ÑÕÉ¸Y%I5}AL¹¡…Ì¡À¤ì)ô)™Õ¹Ñ¥½¸%ÍU¹¥½‘•1…‰•°¡Ù…±Õ”¤ì(€¥˜€¡Ù…±Õ”¹±•¹Ñ €ôôô€À¤(€€€É•ÑÕÉ¸U¹É•…¡…‰±” ¤ì(€½¹ÍÐÁÌ€ôl¸¸¹Ù…±Õ•t¹µ…À ¡Œ¤€ôøŒ¹½‘•A½¥¹ÑÐ À¤¤ì(€½¹ÍÐ±•¸€ôÁÌ¹±•¹Ñ ì(€¥˜€¡ÁÍlÁt€ôôô€ÐÔñðÁÍm±•¸€´€Åt€ôôô€ÐÔ¤(€€€É•ÑÕÉ¸™…±Í”ì(€¥˜€¡±•¸€øô€Ð€˜˜ÁÍlÉt€ôôô€ÐÔ€˜˜ÁÍlÍt€ôôô€ÐÔ¤(€€€É•ÑÕÉ¸™…±Í”ì(€¥˜€¡%Í½µ‰¥¹¥¹5…É¬È¡ÁÍlÁt¤¤(€€€É•ÑÕÉ¸™…±Í”ì(€±•Ð¡…Í)…Á…¹•Í”€ô™…±Í”ì(€±•Ð¡…ÍÉ…‰¥%¹‘¥Œ€ô™…±Í”ì(€±•Ð¡…ÍáÑ•¹‘•‘É…‰¥%¹‘¥Œ€ô™…±Í”ì(€™½È€¡±•Ð¤€ô€Àì¤€ð±•¸ì¤¬¬¤ì(€€€½¹ÍÐÀ€ôÁÍm¥tì(€€€¥˜€¡IÔàäÉ}%M11=]¹¡…Ì¡À¤¤(€€€€€É•ÑÕÉ¸™…±Í”ì(€€€¥˜€¡%Í!¥É……¹„¡À¤ñð%Í-…Ñ…­…¹„¡À¤ñð%Í!…¸¡À¤¤(€€€€€¡…Í)…Á…¹•Í”€ôÑÉÕ”ì(€€€¥˜€¡%ÍÉ…‰¥%¹‘¥¥¥Ð¡À¤¤(€€€€€¡…ÍÉ…‰¥%¹‘¥Œ€ôÑÉÕ”ì(€€€¥˜€¡%ÍáÑ•¹‘•‘É…‰¥%¹‘¥¥¥Ð¡À¤¤(€€€€€¡…ÍáÑ•¹‘•‘É…‰¥%¹‘¥Œ€ôÑÉÕ”ì(€€€½¹ÍÐÁÉ•Ø€ôÁÍm¤€´€Åt°¹•áÐ€ôÁÍm¤€¬€Åtì(€€€ÍÝ¥Ñ €¡À¤ì(€€€€€…Í”€ÄàÌè(€€€€€€€¥˜€¡ÁÉ•Ø€„ôô€ÄÀàñð¹•áÐ€„ôô€ÄÀà¤(€€€€€€€€€É•ÑÕÉ¸™…±Í”ì(€€€€€€€‰É•…¬ì(€€€€€€¼¼5%1=P€¡…Ñ…±…¸¤(€€€€€…Í”€ààÔè(€€€€€€€¥˜€¡¹•áÐ€ôôôÙ½¥€Àñð€…%ÍÉ••¬¡¹•áÐ¤¤(€€€€€€€€€É•ÑÕÉ¸™…±Í”ì(€€€€€€€‰É•…¬ì(€€€€€€¼¼É••¬-I%(€€€€€…Í”€ÄÔÈÌè(€€€€€…Í”€ÄÔÈÐè(€€€€€€€¥˜€¡ÁÉ•Ø€ôôôÙ½¥€Àñð€…%Í!•‰É•Ü¡ÁÉ•Ø¤¤(€€€€€€€€€É•ÑÕÉ¸™…±Í”ì(€€€€€€€‰É•…¬ì(€€€€€€¼¼!•‰É•ÜIM (€€€€€…Í”€àÈÀÐè(€€€€€€€¥˜€¡ÁÉ•Ø€ôôôÙ½¥€ÀñðÁÉ•Ø€ð€ÄÈà€˜˜€…%ÍY¥É…µ„¡ÁÉ•Ø¤¤(€€€€€€€€€É•ÑÕÉ¸™…±Í”ì(€€€€€€€‰É•…¬ì(€€€€€…Í”€àÈÀÔè(€€€€€€€¥˜€¡ÁÉ•Ø€ôôôÙ½¥€Àñð€…%ÍY¥É…µ„¡ÁÉ•Ø¤¤(€€€€€€€€€É•ÑÕÉ¸™…±Í”ì(€€€€€€€‰É•…¬ì(€€€€€…Í”€ÄÈÔÌäè(€€€€€€€‰É•…¬ì(€€€ô(€ô(€¥˜€¡Ù…±Õ”¹¥¹±Õ‘•Ì ‰qÔÌÁˆ¤€˜˜€…¡…Í)…Á…¹•Í”¤(€€€É•ÑÕÉ¸™…±Í”ì(€¥˜€¡¡…ÍÉ…‰¥%¹‘¥Œ€˜˜¡…ÍáÑ•¹‘•‘É…‰¥%¹‘¥Œ¤(€€€É•ÑÕÉ¸™…±Í”ì(€É•ÑÕÉ¸ÑÉÕ”ì)ô)™Õ¹Ñ¥½¸%ÍÍ¥¥1…‰•°¡Ù…±Õ”¤ì(€¥˜€¡Ù…±Õ”¹¡…É½‘•Ð À¤€ôôô€ÐÔñðÙ…±Õ”¹¡…É½‘•Ð¡Ù…±Õ”¹±•¹Ñ €´€Ä¤€ôôô€ÐÔ¤(€€€É•ÑÕÉ¸™…±Í”ì(€¥˜€¡Ù…±Õ”¹±•¹Ñ €øô€Ð€˜˜Ù…±Õ”¹¡…É½‘•Ð È¤€ôôô€ÐÔ€˜˜Ù…±Õ”¹¡…É½‘•Ð Ì¤€ôôô€ÐÔ¤(€€€É•ÑÕÉ¸™…±Í”ì(€™½È€¡±•Ð¤€ô€Àì¤€ðÙ…±Õ”¹±•¹Ñ ì¤¬¬¤ì(€€€½¹ÍÐ €ôÙ…±Õ”¹¡…É½‘•Ð¡¤¤ì(€€€¥˜€ „¡ €øô€äÜ€˜˜ €ðô€ÄÈÈñð€¼¼„µè(€€€ €øô€ØÔ€˜˜ €ðô€äÀñð€¼¼µh(€€€ €øô€Ðà€˜˜ €ðô€ÔÜñð€¼¼€À´ä(€€€ €ôôô€ÐÔ¤¤(€€€€€É•ÑÕÉ¸™…±Í”ì(€ô(€É•ÑÕÉ¸ÑÉÕ”ì)ô)™Õ¹Ñ¥½¸%ÍAÕ¹ä¡Ù…±Õ”¤ì(€É•ÑÕÉ¸Ù…±Õ”¹Ñ½1½Ý•É…Í” ¤¹ÍÑ…ÉÑÍ]¥Ñ  ‰á¸´´ˆ¤ì)ô)™Õ¹Ñ¥½¸%ÍAÕ¹å1…‰•°¡Ù…±Õ”¤ì(€ÑÉäì(€€€½¹ÍÐÁ…å±½…€ôÙ…±Õ”¹Í±¥” Ð¤¹Ñ½1½Ý•É…Í” ¤ì(€€€½¹ÍÐ±…ÍÑ!åÁ¡•¸€ôÁ…å±½…¹±…ÍÑ%¹‘•á=˜ ˆ´ˆ¤ì(€€€¥˜€¡±…ÍÑ!åÁ¡•¸€ôôô€À¤ì(€€€€€É•ÑÕÉ¸™…±Í”ì(€€€ô(€€€½¹ÍÐ‘•½‘•€ô•½‘”È¡Á…å±½…¤ì(€€€¥˜€ …‘•½‘•¤(€€€€€É•ÑÕÉ¸™…±Í”ì(€€€É•ÑÕÉ¸%ÍU¹¥½‘•1…‰•°¡‘•½‘•¤ì(€ô…Ñ ì(€€€É•ÑÕÉ¸™…±Í”ì(€ô)ô)™Õ¹Ñ¥½¸%Í%‘¹1…‰•°¡Ù…±Õ”¤ì(€¥˜€¡Ù…±Õ”¹±•¹Ñ €ôôô€ÀñðÙ…±Õ”¹±•¹Ñ €ø€ØÌ¤(€€€É•ÑÕÉ¸™…±Í”ì(€É•ÑÕÉ¸%ÍAÕ¹ä¡Ù…±Õ”¤€ü%ÍAÕ¹å1…‰•°¡Ù…±Õ”¤€è%ÍU¹¥½‘•1…‰•°¡Ù…±Õ”¤ì)ô)™Õ¹Ñ¥½¸%Í1…‰•°¡Ù…±Õ”¤ì(€¥˜€¡Ù…±Õ”¹±•¹Ñ €ôôô€ÀñðÙ…±Õ”¹±•¹Ñ €ø€ØÌ¤(€€€É•ÑÕÉ¸™…±Í”ì(€É•ÑÕÉ¸%ÍAÕ¹ä¡Ù…±Õ”¤€ü%ÍAÕ¹å1…‰•°¡Ù…±Õ”¤€è%ÍÍ¥¥1…‰•°¡Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½™½Éµ…Ð½¡½ÍÑ¹…µ”¹µ©Ì)™Õ¹Ñ¥½¸%Í!½ÍÑ¹…µ”¡Ù…±Õ”¤ì(€¥˜€¡Ù…±Õ”¹±•¹Ñ €ôôô€ÀñðÙ…±Õ”¹±•¹Ñ €ø€ÈÔÌ¤(€€€É•ÑÕÉ¸™…±Í”ì(€¥˜€¡Ù…±Õ”¹¡…É½‘•Ð¡Ù…±Õ”¹±•¹Ñ €´€Ä¤€ôôô€ÐØ¤(€€€É•ÑÕÉ¸™…±Í”ì(€™½È€¡½¹ÍÐ±…‰•°È½˜Ù…±Õ”¹ÍÁ±¥Ð ˆ¸ˆ¤¤ì(€€€¥˜€ …%Í1…‰•°¡±…‰•°È¤¤(€€€€€É•ÑÕÉ¸™…±Í”ì(€ô(€É•ÑÕÉ¸ÑÉÕ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½™½Éµ…Ð½¥‘¹}•µ…¥°¹µ©Ì)Ù…È%‘¹µ…¥°€ô€½x ü„¸©p¹p¸¥mqÁí1õqÁí9ô„Œ”˜œ¨¬¼ôýy}íñõøµt¬ üép¹mqÁí1õqÁí9ô„Œ”˜œ¨¬¼ôýy}íñõøµt¬¤©mqÁí1õqÁí9õt üémqÁí1õqÁí9ôµuìÀ°ØÅõmqÁí1õqÁí9õt¤ü üép¹mqÁí1õqÁí9õt üémqÁí1õqÁí9ôµuìÀ°ØÅõmqÁí1õqÁí9õt¤ü¤¨½¥Ôì)™Õ¹Ñ¥½¸%Í%‘¹µ…¥°¡Ù…±Õ”¤ì(€É•ÑÕÉ¸%‘¹µ…¥°¹Ñ•ÍÐ¡Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½™½Éµ…Ð½¥‘¹}¡½ÍÑ¹…µ”¹µ©Ì)™Õ¹Ñ¥½¸%Í%‘¹!½ÍÑ¹…µ”¡Ù…±Õ”¤ì(€¥˜€¡Ù…±Õ”¹±•¹Ñ €ôôô€ÀñðÙ…±Õ”¹¥¹±Õ‘•Ì ˆ€ˆ¤¤(€€€É•ÑÕÉ¸™…±Í”ì(€½¹ÍÐ…¹½¹¥…°È€ôÙ…±Õ”¹¹½Éµ…±¥é” ‰9ˆ¤¹É•Á±…” ½mqÔÀÀÉqÔÌÀÀÉqÕÁqÕØÅt½œ°€ˆ¸ˆ¤ì(€¥˜€¡…¹½¹¥…°È¹±•¹Ñ €ø€ÈÔÌ¤(€€€É•ÑÕÉ¸™…±Í”ì(€™½È€¡½¹ÍÐ±…‰•°È½˜…¹½¹¥…°È¹ÍÁ±¥Ð ˆ¸ˆ¤¤ì(€€€¥˜€ …%Í%‘¹1…‰•°¡±…‰•°È¤¤(€€€€€É•ÑÕÉ¸™…±Í”ì(€ô(€É•ÑÕÉ¸ÑÉÕ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½™½Éµ…Ð½¥ÁØÐ¹µ©Ì)™Õ¹Ñ¥½¸%Í%AØÑ%¹Ñ•É¹…°¡Ù…±Õ”°ÍÑ…ÉÐ°•¹¤ì(€±•Ð‘½ÑÌ€ô€Àì(€±•Ð¹Õ´€ô€Àì(€±•Ð‘¥¥ÑÌ€ô€Àì(€±•Ð±•…‘¥¹œ€ô€Àì(€™½È€¡±•Ð¤€ôÍÑ…ÉÐì¤€ð•¹ì¤¬¬¤ì(€€€½¹ÍÐ €ôÙ…±Õ”¹¡…É½‘•Ð¡¤¤ì(€€€¥˜€¡ €ôôô€ÐØ¤ì(€€€€€¥˜€¡‘¥¥ÑÌ€ôôô€Àñð¹Õ´€ø€ÈÔÔñð±•…‘¥¹œ€ôôô€Ðà€˜˜‘¥¥ÑÌ€ø€Ä¤(€€€€€€€É•ÑÕÉ¸™…±Í”ì(€€€€€‘½ÑÌ¬¬ì(€€€€€¹Õ´€ô€Àì(€€€€€‘¥¥ÑÌ€ô€Àì(€€€€€±•…‘¥¹œ€ô€Àì(€€€ô•±Í”¥˜€¡ €øô€Ðà€˜˜ €ðô€ÔÜ¤ì(€€€€€¥˜€¡‘¥¥ÑÌ€ôôô€À¤(€€€€€€€±•…‘¥¹œ€ô ì(€€€€€¹Õ´€ô¹Õ´€¨€ÄÀ€¬€¡ €´€Ðà¤ì(€€€€€‘¥¥ÑÌ¬¬ì(€€€ô•±Í”ì(€€€€€É•ÑÕÉ¸™…±Í”ì(€€€ô(€ô(€É•ÑÕÉ¸‘½ÑÌ€ôôô€Ì€˜˜‘¥¥ÑÌ€ø€À€˜˜¹Õ´€ðô€ÈÔÔ€˜˜€„¡±•…‘¥¹œ€ôôô€Ðà€˜˜‘¥¥ÑÌ€ø€Ä¤ì)ô)™Õ¹Ñ¥½¸%Í%AØÐ¡Ù…±Õ”¤ì(€É•ÑÕÉ¸%Í%AØÑ%¹Ñ•É¹…°¡Ù…±Õ”°€À°Ù…±Õ”¹±•¹Ñ ¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½™½Éµ…Ð½¥ÁØØ¹µ©Ì)™Õ¹Ñ¥½¸%¹I…¹”¡ ¤ì(€É•ÑÕÉ¸ €øô€Ðà€˜˜ €ðô€ÔÜñð€¼¼€À´ä(€ €øô€ØÔ€˜˜ €ðô€ÜÀñð€¼¼µ(€ €øô€äÜ€˜˜ €ðô€ÄÀÈì)ô)™Õ¹Ñ¥½¸%Í%AØØ¡Ù…±Õ”¤ì(€½¹ÍÐ±•¹Ñ €ôÙ…±Õ”¹±•¹Ñ ì(€¥˜€¡±•¹Ñ €ôôô€À¤(€€€É•ÑÕÉ¸™…±Í”ì(€±•ÐÉ½ÕÁÌÈ€ô€Àì(€±•Ð½µÁÉ•ÍÍ•€ô™…±Í”ì(€±•Ð¤€ô€Àì(€¥˜€¡Ù…±Õ”¹¡…É½‘•Ð À¤€ôôô€Ôà€˜˜Ù…±Õ”¹¡…É½‘•Ð Ä¤€ôôô€Ôà¤ì(€€€¥˜€¡±•¹Ñ €ôôô€È¤(€€€€€É•ÑÕÉ¸ÑÉÕ”ì(€€€½µÁÉ•ÍÍ•€ôÑÉÕ”ì(€€€¤€ô€Èì(€ô(€Ý¡¥±”€¡¤€ð±•¹Ñ ¤ì(€€€±•Ð‘¥¥ÑÌ€ô€Àì(€€€½¹ÍÐÍÑ…ÉÐ€ô¤ì(€€€Ý¡¥±”€¡¤€ð±•¹Ñ €˜˜%¹I…¹”¡Ù…±Õ”¹¡…É½‘•Ð¡¤¤¤¤ì(€€€€€¤¬¬ì(€€€€€‘¥¥ÑÌ¬¬ì(€€€ô(€€€¥˜€¡‘¥¥ÑÌ€ôôô€À¤(€€€€€É•ÑÕÉ¸™…±Í”ì(€€€½¹ÍÐ¹•áÐ€ôÙ…±Õ”¹¡…É½‘•Ð¡¤¤ì(€€€¥˜€¡¹•áÐ€ôôô€ÐØ¤ì(€€€€€¥˜€ …%Í%AØÑ%¹Ñ•É¹…°¡Ù…±Õ”°ÍÑ…ÉÐ°±•¹Ñ ¤¤(€€€€€€€É•ÑÕÉ¸™…±Í”ì(€€€€€É½ÕÁÌÈ€¬ô€Èì(€€€€€¤€ô±•¹Ñ ì(€€€€€‰É•…¬ì(€€€ô(€€€¥˜€¡‘¥¥ÑÌ€ø€Ð¤(€€€€€É•ÑÕÉ¸™…±Í”ì(€€€É½ÕÁÌÈ¬¬ì(€€€¥˜€¡¤€ôôô±•¹Ñ ¤(€€€€€‰É•…¬ì(€€€¥˜€¡¹•áÐ€„ôô€Ôà¤(€€€€€É•ÑÕÉ¸™…±Í”ì(€€€¤¬¬ì(€€€¥˜€¡Ù…±Õ”¹¡…É½‘•Ð¡¤¤€ôôô€Ôà¤ì(€€€€€¥˜€¡½µÁÉ•ÍÍ•¤(€€€€€€€É•ÑÕÉ¸™…±Í”ì(€€€€€¥˜€¡Ù…±Õ”¹¡…É½‘•Ð¡¤€¬€Ä¤€ôôô€Ôà¤(€€€€€€€É•ÑÕÉ¸™…±Í”ì(€€€€€½µÁÉ•ÍÍ•€ôÑÉÕ”ì(€€€€€¤¬¬ì(€€€€€¥˜€¡¤€ôôô±•¹Ñ ¤(€€€€€€€‰É•…¬ì(€€€ô(€ô(€É•ÑÕÉ¸½µÁÉ•ÍÍ•€üÉ½ÕÁÌÈ€ðô€Ü€èÉ½ÕÁÌÈ€ôôô€àì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½™½Éµ…Ð½¥É¥}É•™•É•¹”¹µ©Ì)™Õ¹Ñ¥½¸QÉåUÉ°¡Ù…±Õ”¤ì(€ÑÉäì(€€€¹•ÜUI0¡Ù…±Õ”°€‰¡ÑÑÀè¼½•á…µÁ±”¹½´ˆ¤ì(€€€É•ÑÕÉ¸ÑÉÕ”ì(€ô…Ñ ì(€€€É•ÑÕÉ¸™…±Í”ì(€ô)ô)™Õ¹Ñ¥½¸%Í%É¥I•™•É•¹”¡Ù…±Õ”¤ì(€¥˜€¡Ù…±Õ”¹¥¹±Õ‘•Ì ˆ€ˆ¤¤ì(€€€É•ÑÕÉ¸™…±Í”ì(€ô(€¥˜€¡Ù…±Õ”¹¥¹±Õ‘•Ì ‰qpˆ¤¤ì(€€€É•ÑÕÉ¸™…±Í”ì(€ô(€¥˜€ ½mqàÀÀµqàÅqàÝt¼¹Ñ•ÍÐ¡Ù…±Õ”¤¤ì(€€€É•ÑÕÉ¸™…±Í”ì(€ô(€¥˜€ ¼” ü…lÀ´å„µ™µuìÉô¤¼¹Ñ•ÍÐ¡Ù…±Õ”¤¤ì(€€€É•ÑÕÉ¸™…±Í”ì(€ô(€¥˜€¡Ù…±Õ”€ôôô€ˆˆ¤ì(€€€É•ÑÕÉ¸ÑÉÕ”ì(€ô(€½¹ÍÐ½±½¹%¹‘•à€ôÙ…±Õ”¹¥¹‘•á=˜ ˆèˆ¤ì(€½¹ÍÐ¡…ÍY…±¥‘M¡•µ•AÉ•™¥à€ô½±½¹%¹‘•à€ø€À€˜˜€¼¼½±½¸µÕÍÐ¹½Ð‰”…ÐÑ¡”Ù•Éä‰•¥¹¹¥¹œ€¡”¹œ¸°€ˆé™½¼ˆ¤(€€½ym„µéµium„µéµhÀ´ä­p´¹t¨¼¹Ñ•ÍÐ¡Ù…±Õ”¹ÍÕ‰ÍÑÉ¥¹œ À°½±½¹%¹‘•à¤¤ì(€¥˜€¡¡…ÍY…±¥‘M¡•µ•AÉ•™¥à¤ì(€€€É•ÑÕÉ¸QÉåUÉ°¡Ù…±Õ”¤ì(€ô•±Í”ì(€€€½¹ÍÐ±½½­Í1¥­•5…±™½Éµ•‘M¡•µ•¹‘ÕÑ¡½É¥Ñä€ôÙ…±Õ”¹µ…Ñ  ½x¡m„µéµium„µéµhÀ´ä­p´¹t¨¤¡p½p¼¤¼¤ì(€€€¥˜€¡±½½­Í1¥­•5…±™½Éµ•‘M¡•µ•¹‘ÕÑ¡½É¥Ñä€˜˜½±½¹%¹‘•à€ôôô€´Ä¤ì(€€€€€É•ÑÕÉ¸™…±Í”ì(€€€ô(€€€É•ÑÕÉ¸QÉåUÉ°¡Ù…±Õ”¤ì(€ô)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½™½Éµ…Ð½¥É¤¹µ©Ì)™Õ¹Ñ¥½¸%Í%É¤¡Ù…±Õ”¤ì(€ÑÉäì(€€€¹•ÜUI0¡Ù…±Õ”¤ì(€€€É•ÑÕÉ¸ÑÉÕ”ì(€ô…Ñ ì(€€€É•ÑÕÉ¸™…±Í”ì(€ô)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½™½Éµ…Ð½©Í½¹}Á½¥¹Ñ•É}ÕÉ¥}™É…µ•¹Ð¹µ©Ì)Ù…È)Í½¹A½¥¹Ñ•ÉUÉ¥É…µ•¹Ð€ô€½xŒ üép¼ üém„µèÀ´å}p´¸„˜œ ¤¨¬°ìèõuð•lÀ´å„µ™uìÉõñøÁñøÄ¤¨¤¨½¤ì)™Õ¹Ñ¥½¸%Í)Í½¹A½¥¹Ñ•ÉUÉ¥É…µ•¹Ð¡Ù…±Õ”¤ì(€É•ÑÕÉ¸)Í½¹A½¥¹Ñ•ÉUÉ¥É…µ•¹Ð¹Ñ•ÍÐ¡Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½™½Éµ…Ð½©Í½¹}Á½¥¹Ñ•È¹µ©Ì)Ù…È)Í½¹A½¥¹Ñ•È€ô€½x üép¼ üémyø½uñøÁñøÄ¤¨¤¨¼ì)™Õ¹Ñ¥½¸%Í)Í½¹A½¥¹Ñ•È¡Ù…±Õ”¤ì(€É•ÑÕÉ¸)Í½¹A½¥¹Ñ•È¹Ñ•ÍÐ¡Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½™½Éµ…Ð½É••à¹µ©Ì)™Õ¹Ñ¥½¸%ÍI••à¡Ù…±Õ”¤ì(€¥˜€¡Ù…±Õ”¹±•¹Ñ €ôôô€À¤ì(€€€É•ÑÕÉ¸™…±Í”ì(€ô(€ÑÉäì(€€€¹•ÜI•áÀ¡Ù…±Õ”¤ì(€€€É•ÑÕÉ¸ÑÉÕ”ì(€ô…Ñ ì(€€€É•ÑÕÉ¸™…±Í”ì(€ô)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½™½Éµ…Ð½É•±…Ñ¥Ù•}©Í½¹}Á½¥¹Ñ•È¹µ©Ì)Ù…ÈI•±…Ñ¥Ù•)Í½¹A½¥¹Ñ•È€ô€½x üèÁñlÄ´åulÀ´åt¨¤ üèð üép¼ üémyø½uñøÁñøÄ¤¨¤¨¤¼ì)™Õ¹Ñ¥½¸%ÍI•±…Ñ¥Ù•)Í½¹A½¥¹Ñ•È¡Ù…±Õ”¤ì(€É•ÑÕÉ¸I•±…Ñ¥Ù•)Í½¹A½¥¹Ñ•È¹Ñ•ÍÐ¡Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½™½Éµ…Ð½ÕÉ¥}É•™•É•¹”¹µ©Ì)Ù…ÈUÉ¥I•™•É•¹”€ô€½x ü„¸©myqàÀÀµqàÝt¤ ü„¸©qp¤ üè üém„µéum„µèÀ´ä­p´¹t¨è¤ü üép½p½myqÍmquíôðùyñt¨¤ýñmyqÍmquíôðùyñt¨¤ üépýmyqÍmquíôðùyñt¨¤ü üèmyqÍmquíôðùyñt¨¤ü½¤ì)™Õ¹Ñ¥½¸%ÍUÉ¥I•™•É•¹”¡Ù…±Õ”¤ì(€É•ÑÕÉ¸UÉ¥I•™•É•¹”¹Ñ•ÍÐ¡Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½™½Éµ…Ð½ÕÉ¥}Ñ•µÁ±…Ñ”¹µ©Ì)Ù…ÈUÉ¥Q•µÁ±…Ñ”€ô€½x üè üémyqàÀÀµqàÈÀˆœðø•qqyíñõuð•lÀ´å„µ™uìÉô¥ñqíl¬Œ¸¼ìü˜ô°…ñtü üém„µèÀ´å}uð•lÀ´å„µ™uìÉô¤¬ üèélÄ´åulÀ´åuìÀ°Íõñp¨¤ü üè° üém„µèÀ´å}uð•lÀ´å„µ™uìÉô¤¬ üèélÄ´åulÀ´åuìÀ°Íõñp¨¤ü¤©qô¤¨½¤ì)™Õ¹Ñ¥½¸%ÍUÉ¥Q•µÁ±…Ñ”¡Ù…±Õ”¤ì(€É•ÑÕÉ¸UÉ¥Q•µÁ±…Ñ”¹Ñ•ÍÐ¡Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½™½Éµ…Ð½ÕÉ¤¹µ©Ì)™Õ¹Ñ¥½¸%Í±Á¡„¡ ¤ì(€É•ÑÕÉ¸ €øô€äÜ€˜˜ €ðô€ÄÈÈñð €øô€ØÔ€˜˜ €ðô€äÀì)ô)™Õ¹Ñ¥½¸%Í±Á¡…9Õµ•É¥Œ¡ ¤ì(€É•ÑÕÉ¸%Í±Á¡„¡ ¤ñð €øô€Ðà€˜˜ €ðô€ÔÜì)ô)™Õ¹Ñ¥½¸%Í!•à¡ ¤ì(€É•ÑÕÉ¸ €øô€Ðà€˜˜ €ðô€ÔÜñð€¼¼€À´ä(€ €øô€ØÔ€˜˜ €ðô€ÜÀñð€¼¼µ(€ €øô€äÜ€˜˜ €ðô€ÄÀÈì)ô)™Õ¹Ñ¥½¸%ÍM¡•µ•¡…È¡ ¤ì(€É•ÑÕÉ¸%Í±Á¡…9Õµ•É¥Œ¡ ¤ñð €ôôô€ÐÌñð €ôôô€ÐÔñð €ôôô€ÐØì)ô)™Õ¹Ñ¥½¸%ÍU¹É•Í•ÉÙ•¡ ¤ì(€É•ÑÕÉ¸%Í±Á¡…9Õµ•É¥Œ¡ ¤ñð €ôôô€ÐÔñð €ôôô€ÐØñð€¼¼€œ´œ°€œ¸œ(€ €ôôô€äÔñð €ôôô€ÄÈØì)ô)™Õ¹Ñ¥½¸%ÍMÕ‰•±¥´¡ ¤ì(€É•ÑÕÉ¸ €ôôô€ÌÌñð €ôôô€ÌØñð €ôôô€Ìàñð €ôôô€Ìäñð €ôôô€ÐÀñð €ôôô€ÐÄñð €ôôô€ÐÈñð €ôôô€ÐÌñð €ôôô€ÐÐñð €ôôô€Ôäñð €ôôô€ØÄì)ô)™Õ¹Ñ¥½¸%ÍA¡…È¡ ¤ì(€É•ÑÕÉ¸%ÍU¹É•Í•ÉÙ•¡ ¤ñð%ÍMÕ‰•±¥´¡ ¤ñð €ôôô€Ôàñð €ôôô€ØÐì)ô)™Õ¹Ñ¥½¸%ÍUÉ¤¡Ù…±Õ”¤ì(€½¹ÍÐ±•¹Ñ €ôÙ…±Õ”¹±•¹Ñ ì(€¥˜€¡±•¹Ñ €ôôô€À¤(€€€É•ÑÕÉ¸™…±Í”ì(€¥˜€ …%Í±Á¡„¡Ù…±Õ”¹¡…É½‘•Ð À¤¤¤(€€€É•ÑÕÉ¸™…±Í”ì(€±•Ð¤€ô€Äì(€Ý¡¥±”€¡¤€ð±•¹Ñ ¤ì(€€€½¹ÍÐ €ôÙ…±Õ”¹¡…É½‘•Ð¡¤¤ì(€€€¥˜€¡ €ôôô€Ôà¤(€€€€€‰É•…¬ì(€€€¥˜€ …%ÍM¡•µ•¡…È¡ ¤¤(€€€€€É•ÑÕÉ¸™…±Í”ì(€€€¤¬¬ì(€ô(€¥˜€¡Ù…±Õ”¹¡…É½‘•Ð¡¤¤€„ôô€Ôà¤(€€€É•ÑÕÉ¸™…±Í”ì(€¤¬¬ì(€¥˜€¡Ù…±Õ”¹¡…É½‘•Ð¡¤¤€ôôô€ÐÜ€˜˜Ù…±Õ”¹¡…É½‘•Ð¡¤€¬€Ä¤€ôôô€ÐÜ¤ì(€€€¤€¬ô€Èì(€€€½¹ÍÐ…ÕÑ¡½É¥ÑåMÑ…ÉÐ€ô¤ì(€€€±•Ð…ÑA½Ì€ô€´Äì(€€€™½È€¡±•Ð¨€ô¤ì¨€ð±•¹Ñ ì¨¬¬¤ì(€€€€€½¹ÍÐ €ôÙ…±Õ”¹¡…É½‘•Ð¡¨¤ì(€€€€€¥˜€¡ €ôôô€ØÐ¤ì(€€€€€€€…ÑA½Ì€ô¨ì(€€€€€€€‰É•…¬ì(€€€€€ô(€€€€€¥˜€¡ €ôôô€ÐÜñð €ôôô€ØÌñð €ôôô€ÌÔ¤(€€€€€€€‰É•…¬ì(€€€ô(€€€¥˜€¡…ÑA½Ì€„ôô€´Ä¤ì(€€€€€™½È€¡±•Ð¨€ô…ÕÑ¡½É¥ÑåMÑ…ÉÐì¨€ð…ÑA½Ìì¨¬¬¤ì(€€€€€€€½¹ÍÐ €ôÙ…±Õ”¹¡…É½‘•Ð¡¨¤ì(€€€€€€€¥˜€¡ €ôôô€äÄñð €ôôô€äÌ¤(€€€€€€€€€É•ÑÕÉ¸™…±Í”ì(€€€€€€€¥˜€¡ €ôôô€ÌÜ¤ì(€€€€€€€€€¥˜€¡¨€¬€È€øô…ÑA½Ìñð€…%Í!•à¡Ù…±Õ”¹¡…É½‘•Ð¡¨€¬€Ä¤¤ñð€…%Í!•à¡Ù…±Õ”¹¡…É½‘•Ð¡¨€¬€È¤¤¤(€€€€€€€€€€€É•ÑÕÉ¸™…±Í”ì(€€€€€€€€€¨€¬ô€Èì(€€€€€€€ô•±Í”¥˜€ …%ÍU¹É•Í•ÉÙ•¡ ¤€˜˜€…%ÍMÕ‰•±¥´¡ ¤€˜˜ €„ôô€Ôà¤(€€€€€€€€€É•ÑÕÉ¸™…±Í”ì(€€€€€ô(€€€€€¤€ô…ÑA½Ì€¬€Äì(€€€ô(€€€¥˜€¡Ù…±Õ”¹¡…É½‘•Ð¡¤¤€ôôô€äÄ¤ì(€€€€€¤¬¬ì(€€€€€Ý¡¥±”€¡¤€ð±•¹Ñ €˜˜Ù…±Õ”¹¡…É½‘•Ð¡¤¤€„ôô€äÌ¤(€€€€€€€¤¬¬ì(€€€€€¥˜€¡Ù…±Õ”¹¡…É½‘•Ð¡¤¤€„ôô€äÌ¤(€€€€€€€É•ÑÕÉ¸™…±Í”ì(€€€€€¤¬¬ì(€€€ô•±Í”ì(€€€€€Ý¡¥±”€¡¤€ð±•¹Ñ ¤ì(€€€€€€€½¹ÍÐ €ôÙ…±Õ”¹¡…É½‘•Ð¡¤¤ì(€€€€€€€¥˜€¡ €ôôô€ÐÜñð €ôôô€ØÌñð €ôôô€ÌÔñð €ôôô€Ôà¤(€€€€€€€€€‰É•…¬ì(€€€€€€€¥˜€¡ €ð€ÄÈà€˜˜€…%ÍU¹É•Í•ÉÙ•¡ ¤€˜˜€…%ÍMÕ‰•±¥´¡ ¤¤(€€€€€€€€€É•ÑÕÉ¸™…±Í”ì(€€€€€€€¤¬¬ì(€€€€€ô(€€€ô(€€€¥˜€¡Ù…±Õ”¹¡…É½‘•Ð¡¤¤€ôôô€Ôà¤ì(€€€€€¤¬¬ì(€€€€€Ý¡¥±”€¡¤€ð±•¹Ñ ¤ì(€€€€€€€½¹ÍÐ €ôÙ…±Õ”¹¡…É½‘•Ð¡¤¤ì(€€€€€€€¥˜€¡ €ôôô€ÐÜñð €ôôô€ØÌñð €ôôô€ÌÔ¤(€€€€€€€€€‰É•…¬ì(€€€€€€€¥˜€¡ €ð€Ðàñð €ø€ÔÜ¤(€€€€€€€€€É•ÑÕÉ¸™…±Í”ì(€€€€€€€¤¬¬ì(€€€€€ô(€€€ô(€ô(€Ý¡¥±”€¡¤€ð±•¹Ñ ¤ì(€€€½¹ÍÐ €ôÙ…±Õ”¹¡…É½‘•Ð¡¤¤ì(€€€¥˜€¡ €ôôô€ÌÜ¤ì(€€€€€¥˜€¡¤€¬€È€øô±•¹Ñ ñð€…%Í!•à¡Ù…±Õ”¹¡…É½‘•Ð¡¤€¬€Ä¤¤ñð€…%Í!•à¡Ù…±Õ”¹¡…É½‘•Ð¡¤€¬€È¤¤¤(€€€€€€€É•ÑÕÉ¸™…±Í”ì(€€€€€¤€¬ô€Èì(€€€ô•±Í”¥˜€¡ €ø€ÄÈÜ¤ì(€€€€€É•ÑÕÉ¸™…±Í”ì(€€€ô•±Í”¥˜€ „¡%ÍA¡…È¡ ¤ñð €ôôô€ÐÜñð €ôôô€ØÌñð €ôôô€ÌÔ¤¤ì(€€€€€É•ÑÕÉ¸™…±Í”ì(€€€ô(€€€¤¬¬ì(€ô(€É•ÑÕÉ¸ÑÉÕ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½™½Éµ…Ð½ÕÉ°¹µ©Ì)Ù…ÈUÉ°€ô€½x üé¡ÑÑÁÌýñ™ÑÀ¤ép½p¼ üéqL¬ üèéqL¨¤ý ¤ü üè ü„ üèÄÁðÄÈÜ¤ üép¹q‘ìÄ°Íô¥ìÍô¤ ü„ üèÄØåp¸ÈÔÑðÄäÉp¸ÄØà¤ üép¹q‘ìÄ°Íô¥ìÉô¤ ü„ÄÜÉp¸ üèÅlØ´åuðÉq‘ðÍlÀ´Åt¤ üép¹q‘ìÄ°Íô¥ìÉô¤ üélÄ´åuqýðÅq‘q‘ðÉlÀÅuq‘ðÈÉlÀ´Ít¤ üép¸ üèÄýq‘ìÄ°ÉõðÉlÀ´Ñuq‘ðÈÕlÀ´Õt¤¥ìÉô üép¸ üélÄ´åuqýðÅq‘q‘ðÉlÀ´Ñuq‘ðÈÕlÀ´Ñt¤¥ð üè üém„µèÀ´åqÕìÀÁ„ÅôµqÕí™™™™õt¬´¤©m„µèÀ´åqÕìÀÁ„ÅôµqÕí™™™™õt¬¤ üép¸ üém„µèÀ´åqÕìÀÁ„ÅôµqÕí™™™™õt¬´¤©m„µèÀ´åqÕìÀÁ„ÅôµqÕí™™™™õt¬¤¨ üép¸ üém„µéqÕìÀÁ„ÅôµqÕí™™™™õuìÈ±ô¤¤¤ üèéq‘ìÈ°Õô¤ü üép½myqÍt¨¤ü½¥Ôì)™Õ¹Ñ¥½¸%ÍUÉ°¡Ù…±Õ”¤ì(€É•ÑÕÉ¸UÉ°¹Ñ•ÍÐ¡Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½™½Éµ…Ð½ÕÕ¥¹µ©Ì)Ù…ÈUÕ¥€ô€½ylÀ´å„µ™uìáô´ üélÀ´å„µ™uìÑô´¥ìÍõlÀ´å„µ™uìÄÉô½¤ì)™Õ¹Ñ¥½¸%ÍUÕ¥¡Ù…±Õ”¤ì(€É•ÑÕÉ¸UÕ¥¹Ñ•ÍÐ¡Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½™½Éµ…Ð½}É•¥ÍÑÉä¹µ©Ì)Ù…È™½Éµ…ÑÌ€ô€¼¨}}AUI}|€¨¼¹•Ü5…À ¤ì)™Õ¹Ñ¥½¸±•…È ¤ì(€™½Éµ…ÑÌ¹±•…È ¤ì)ô)™Õ¹Ñ¥½¸¹ÑÉ¥•ÌÈ ¤ì(€É•ÑÕÉ¸l¸¸¹™½Éµ…ÑÌ¹•¹ÑÉ¥•Ì ¥tì)ô)™Õ¹Ñ¥½¸M•ÐÌ¡™½Éµ…Ð°¡•¬¤ì(€™½Éµ…ÑÌ¹Í•Ð¡™½Éµ…Ð°¡•¬¤ì)ô)™Õ¹Ñ¥½¸!…Ì¡™½Éµ…Ð¤ì(€É•ÑÕÉ¸™½Éµ…ÑÌ¹¡…Ì¡™½Éµ…Ð¤ì)ô)™Õ¹Ñ¥½¸•ÐÌ¡™½Éµ…Ð¤ì(€É•ÑÕÉ¸™½Éµ…ÑÌ¹•Ð¡™½Éµ…Ð¤ì)ô)™Õ¹Ñ¥½¸Q•ÍÐ¡™½Éµ…Ð°Ù…±Õ”¤ì(€É•ÑÕÉ¸™½Éµ…ÑÌ¹•Ð¡™½Éµ…Ð¤ü¸¡Ù…±Õ”¤€üüÑÉÕ”ì)ô)™Õ¹Ñ¥½¸I•Í•ÐÈ ¤ì(€±•…È ¤ì(€™½Éµ…ÑÌ¹Í•Ð ‰‘…Ñ”µÑ¥µ”ˆ°%Í…Ñ•Q¥µ”¤ì(€™½Éµ…ÑÌ¹Í•Ð ‰‘…Ñ”ˆ°%Í…Ñ”È¤ì(€™½Éµ…ÑÌ¹Í•Ð ‰‘ÕÉ…Ñ¥½¸ˆ°%ÍÕÉ…Ñ¥½¸¤ì(€™½Éµ…ÑÌ¹Í•Ð ‰•µ…¥°ˆ°%Íµ…¥°¤ì(€™½Éµ…ÑÌ¹Í•Ð ‰¡½ÍÑ¹…µ”ˆ°%Í!½ÍÑ¹…µ”¤ì(€™½Éµ…ÑÌ¹Í•Ð ‰¥‘¸µ•µ…¥°ˆ°%Í%‘¹µ…¥°¤ì(€™½Éµ…ÑÌ¹Í•Ð ‰¥‘¸µ¡½ÍÑ¹…µ”ˆ°%Í%‘¹!½ÍÑ¹…µ”¤ì(€™½Éµ…ÑÌ¹Í•Ð ‰¥ÁØÐˆ°%Í%AØÐ¤ì(€™½Éµ…ÑÌ¹Í•Ð ‰¥ÁØØˆ°%Í%AØØ¤ì(€™½Éµ…ÑÌ¹Í•Ð ‰¥É¤µÉ•™•É•¹”ˆ°%Í%É¥I•™•É•¹”¤ì(€™½Éµ…ÑÌ¹Í•Ð ‰¥É¤ˆ°%Í%É¤¤ì(€™½Éµ…ÑÌ¹Í•Ð ‰©Í½¸µÁ½¥¹Ñ•ÈµÕÉ¤µ™É…µ•¹Ðˆ°%Í)Í½¹A½¥¹Ñ•ÉUÉ¥É…µ•¹Ð¤ì(€™½Éµ…ÑÌ¹Í•Ð ‰©Í½¸µÁ½¥¹Ñ•Èˆ°%Í)Í½¹A½¥¹Ñ•È¤ì(€™½Éµ…ÑÌ¹Í•Ð ‰É••àˆ°%ÍI••à¤ì(€™½Éµ…ÑÌ¹Í•Ð ‰É•±…Ñ¥Ù”µ©Í½¸µÁ½¥¹Ñ•Èˆ°%ÍI•±…Ñ¥Ù•)Í½¹A½¥¹Ñ•È¤ì(€™½Éµ…ÑÌ¹Í•Ð ‰Ñ¥µ”ˆ°%ÍQ¥µ”¤ì(€™½Éµ…ÑÌ¹Í•Ð ‰ÕÉ¤µÉ•™•É•¹”ˆ°%ÍUÉ¥I•™•É•¹”¤ì(€™½Éµ…ÑÌ¹Í•Ð ‰ÕÉ¤µÑ•µÁ±…Ñ”ˆ°%ÍUÉ¥Q•µÁ±…Ñ”¤ì(€™½Éµ…ÑÌ¹Í•Ð ‰ÕÉ¤ˆ°%ÍUÉ¤¤ì(€™½Éµ…ÑÌ¹Í•Ð ‰ÕÉ°ˆ°%ÍUÉ°¤ì(€™½Éµ…ÑÌ¹Í•Ð ‰ÕÕ¥ˆ°%ÍUÕ¥¤ì)ô)I•Í•ÐÈ ¤ì((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½™½Éµ…Ð¹µ©Ì)™Õ¹Ñ¥½¸¡•­½Éµ…Ð¡}ÍÑ…¬°}½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸™½Éµ…Ñ}•áÁ½ÉÑÌ¹Q•ÍÐ¡Í¡•µ„¹™½Éµ…Ð°Ù…±Õ”¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½É½Éµ…Ð¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸¡•­½Éµ…Ð¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰™½Éµ…Ðˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèì™½Éµ…ÐèÍ¡•µ„¹™½Éµ…Ðô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½¥˜¹µ©Ì)™Õ¹Ñ¥½¸¡•­%˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐÑ¡•¹M¡•µ„€ô%ÍQ¡•¸¡Í¡•µ„¤€üÍ¡•µ„¹Ñ¡•¸€èÑÉÕ”ì(€½¹ÍÐ•±Í•M¡•µ„€ô%Í±Í”¡Í¡•µ„¤€üÍ¡•µ„¹•±Í”€èÑÉÕ”ì(€É•ÑÕÉ¸¡•­M¡•µ„¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„¹¥˜°Ù…±Õ”¤€ü¡•­M¡•µ„¡ÍÑ…¬°½¹Ñ•áÐ°Ñ¡•¹M¡•µ„°Ù…±Õ”¤€è¡•­M¡•µ„¡ÍÑ…¬°½¹Ñ•áÐ°•±Í•M¡•µ„°Ù…±Õ”¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½É%˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐÑ¡•¹M¡•µ„€ô%ÍQ¡•¸¡Í¡•µ„¤€üÍ¡•µ„¹Ñ¡•¸€èÑÉÕ”ì(€½¹ÍÐ•±Í•M¡•µ„€ô%Í±Í”¡Í¡•µ„¤€üÍ¡•µ„¹•±Í”€èÑÉÕ”ì(€½¹ÍÐÑÉÕ•½¹Ñ•áÐ€ô¹•ÜÕµÕ±…Ñ•‘ÉÉ½É½¹Ñ•áÐ ¤ì(€½¹ÍÐ¥Í%˜€ôÉÉ½ÉM¡•µ„¡ÍÑ…¬°ÑÉÕ•½¹Ñ•áÐ°€‘íÍ¡•µ…A…Ñ¡ô½¥™€°¥¹ÍÑ…¹•A…Ñ °Í¡•µ„¹¥˜°Ù…±Õ”¤€üÉÉ½ÉM¡•µ„¡ÍÑ…¬°ÑÉÕ•½¹Ñ•áÐ°€‘íÍ¡•µ…A…Ñ¡ô½Ñ¡•¹€°¥¹ÍÑ…¹•A…Ñ °Ñ¡•¹M¡•µ„°Ù…±Õ”¤ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰¥˜ˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèì™…¥±¥¹-•åÝ½Éè€‰Ñ¡•¸ˆô(€ô¤€èÉÉ½ÉM¡•µ„¡ÍÑ…¬°½¹Ñ•áÐ°€‘íÍ¡•µ…A…Ñ¡ô½•±Í•€°¥¹ÍÑ…¹•A…Ñ °•±Í•M¡•µ„°Ù…±Õ”¤ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰¥˜ˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèì™…¥±¥¹-•åÝ½Éè€‰•±Í”ˆô(€ô¤ì(€¥˜€¡¥Í%˜¤(€€€½¹Ñ•áÐ¹5•É”¡mÑÉÕ•½¹Ñ•áÑt¤ì(€É•ÑÕÉ¸¥Í%˜ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½¥Ñ•µÌ¹µ©Ì)™Õ¹Ñ¥½¸¡•­%Ñ•µÍM¥é•¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹Ù•Éä¡Í¡•µ„¹¥Ñ•µÌ°€À°€¡Í¡•µ„È°¥¹‘•à¤€ôøì(€€€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%Í1•ÍÍÅÕ…±Q¡…¸¡Ù…±Õ”¹±•¹Ñ °¥¹‘•à¤ñð¡•­M¡•µ…AÕÍ¡MÑ…¬¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„È°Ù…±Õ•m¥¹‘•át¤€˜˜½¹Ñ•áÐ¹‘‘%¹‘•à¡¥¹‘•à¤ì(€ô¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½É%Ñ•µÍM¥é•¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹Ù•Éå±°¡Í¡•µ„¹¥Ñ•µÌ°€À°€¡Í¡•µ„È°¥¹‘•à¤€ôøì(€€€½¹ÍÐ¹•áÑM¡•µ…A…Ñ €ô€‘íÍ¡•µ…A…Ñ¡ô½¥Ñ•µÌ¼‘í¥¹‘•áõ€ì(€€€½¹ÍÐ¹•áÑ%¹ÍÑ…¹•A…Ñ €ô€‘í¥¹ÍÑ…¹•A…Ñ¡ô¼‘í¥¹‘•áõ€ì(€€€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%Í1•ÍÍÅÕ…±Q¡…¸¡Ù…±Õ”¹±•¹Ñ °¥¹‘•à¤ñðÉÉ½ÉM¡•µ…AÕÍ¡MÑ…¬¡ÍÑ…¬°½¹Ñ•áÐ°¹•áÑM¡•µ…A…Ñ °¹•áÑ%¹ÍÑ…¹•A…Ñ °Í¡•µ„È°Ù…±Õ•m¥¹‘•át¤€˜˜½¹Ñ•áÐ¹‘‘%¹‘•à¡¥¹‘•à¤ì(€ô¤ì)ô)™Õ¹Ñ¥½¸¡•­%Ñ•µÍU¹Í¥é•¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐ½™™Í•Ð€ô%ÍAÉ•™¥á%Ñ•µÌ¡Í¡•µ„¤€üÍ¡•µ„¹ÁÉ•™¥á%Ñ•µÌ¹±•¹Ñ €è€Àì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹Ù•Éä¡Ù…±Õ”°½™™Í•Ð°€¡•±•µ•¹Ð°¥¹‘•à¤€ôøì(€€€É•ÑÕÉ¸¡•­M¡•µ…AÕÍ¡MÑ…¬¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„¹¥Ñ•µÌ°•±•µ•¹Ð¤€˜˜½¹Ñ•áÐ¹‘‘%¹‘•à¡¥¹‘•à¤ì(€ô¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½É%Ñ•µÍU¹Í¥é•¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐ½™™Í•Ð€ô%ÍAÉ•™¥á%Ñ•µÌ¡Í¡•µ„¤€üÍ¡•µ„¹ÁÉ•™¥á%Ñ•µÌ¹±•¹Ñ €è€Àì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹Ù•Éå±°¡Ù…±Õ”°½™™Í•Ð°€¡•±•µ•¹Ð°¥¹‘•à¤€ôøì(€€€½¹ÍÐ¹•áÑM¡•µ…A…Ñ €ô€‘íÍ¡•µ…A…Ñ¡ô½¥Ñ•µÍ€ì(€€€½¹ÍÐ¹•áÑ%¹ÍÑ…¹•A…Ñ €ô€‘í¥¹ÍÑ…¹•A…Ñ¡ô¼‘í¥¹‘•áõ€ì(€€€É•ÑÕÉ¸ÉÉ½ÉM¡•µ…AÕÍ¡MÑ…¬¡ÍÑ…¬°½¹Ñ•áÐ°¹•áÑM¡•µ…A…Ñ °¹•áÑ%¹ÍÑ…¹•A…Ñ °Í¡•µ„¹¥Ñ•µÌ°•±•µ•¹Ð¤€˜˜½¹Ñ•áÐ¹‘‘%¹‘•à¡¥¹‘•à¤ì(€ô¤ì)ô)™Õ¹Ñ¥½¸¡•­%Ñ•µÌ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸%Í%Ñ•µÍM¥é•¡Í¡•µ„¤€ü¡•­%Ñ•µÍM¥é•¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤€è¡•­%Ñ•µÍU¹Í¥é•¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½É%Ñ•µÌ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸%Í%Ñ•µÍM¥é•¡Í¡•µ„¤€üÉÉ½É%Ñ•µÍM¥é•¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤€èÉÉ½É%Ñ•µÍU¹Í¥é•¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½µ…á½¹Ñ…¥¹Ì¹µ©Ì)™Õ¹Ñ¥½¸%ÍY…±¥Ì¡Í¡•µ„¤ì(€É•ÑÕÉ¸%Í½¹Ñ…¥¹Ì¡Í¡•µ„¤ì)ô)™Õ¹Ñ¥½¸¡•­5…á½¹Ñ…¥¹Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€¥˜€ …%ÍY…±¥Ì¡Í¡•µ„¤¤(€€€É•ÑÕÉ¸ÑÉÕ”ì(€½¹ÍÐ½Õ¹Ð€ôÙ…±Õ”¹É•‘Õ” ¡É•ÍÕ±Ð°¥Ñ•´¤€ôø¡•­M¡•µ„¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„¹½¹Ñ…¥¹Ì°¥Ñ•´¤€ü€¬­É•ÍÕ±Ð€èÉ•ÍÕ±Ð°€À¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%Í1•ÍÍÅÕ…±Q¡…¸¡½Õ¹Ð°Í¡•µ„¹µ…á½¹Ñ…¥¹Ì¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½É5…á½¹Ñ…¥¹Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐµ¥¹½¹Ñ…¥¹Ì€ô%Í5¥¹½¹Ñ…¥¹Ì¡Í¡•µ„¤€üÍ¡•µ„¹µ¥¹½¹Ñ…¥¹Ì€è€Äì(€É•ÑÕÉ¸¡•­5…á½¹Ñ…¥¹Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰½¹Ñ…¥¹Ìˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèìµ¥¹½¹Ñ…¥¹Ì°µ…á½¹Ñ…¥¹ÌèÍ¡•µ„¹µ…á½¹Ñ…¥¹Ìô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½µ…á¥µÕ´¹µ©Ì)™Õ¹Ñ¥½¸¡•­5…á¥µÕ´¡}ÍÑ…¬°}½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%Í1•ÍÍÅÕ…±Q¡…¸¡Ù…±Õ”°Í¡•µ„¹µ…á¥µÕ´¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½É5…á¥µÕ´¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸¡•­5…á¥µÕ´¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰µ…á¥µÕ´ˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèì½µÁ…É¥Í½¸è€ˆðôˆ°±¥µ¥ÐèÍ¡•µ„¹µ…á¥µÕ´ô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½µ…á%Ñ•µÌ¹µ©Ì)™Õ¹Ñ¥½¸¡•­5…á%Ñ•µÌ¡}ÍÑ…¬°}½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%Í1•ÍÍÅÕ…±Q¡…¸¡Ù…±Õ”¹±•¹Ñ °Í¡•µ„¹µ…á%Ñ•µÌ¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½É5…á%Ñ•µÌ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸¡•­5…á%Ñ•µÌ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰µ…á%Ñ•µÌˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèì±¥µ¥ÐèÍ¡•µ„¹µ…á%Ñ•µÌô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½µ…á1•¹Ñ ¹µ©Ì)™Õ¹Ñ¥½¸¡•­5…á1•¹Ñ ¡}ÍÑ…¬°}½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%Í5…á1•¹Ñ ¡Ù…±Õ”°Í¡•µ„¹µ…á1•¹Ñ ¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½É5…á1•¹Ñ ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸¡•­5…á1•¹Ñ ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰µ…á1•¹Ñ ˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèì±¥µ¥ÐèÍ¡•µ„¹µ…á1•¹Ñ ô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½µ…áAÉ½Á•ÉÑ¥•Ì¹µ©Ì)™Õ¹Ñ¥½¸¡•­5…áAÉ½Á•ÉÑ¥•Ì¡}ÍÑ…¬°}½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%Í1•ÍÍÅÕ…±Q¡…¸¡Õ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡Ù…±Õ”¤¹±•¹Ñ °Í¡•µ„¹µ…áAÉ½Á•ÉÑ¥•Ì¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½É5…áAÉ½Á•ÉÑ¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸¡•­5…áAÉ½Á•ÉÑ¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰µ…áAÉ½Á•ÉÑ¥•Ìˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèì±¥µ¥ÐèÍ¡•µ„¹µ…áAÉ½Á•ÉÑ¥•Ìô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½µ¥¹½¹Ñ…¥¹Ì¹µ©Ì)™Õ¹Ñ¥½¸%ÍY…±¥Ð¡Í¡•µ„¤ì(€É•ÑÕÉ¸%Í½¹Ñ…¥¹Ì¡Í¡•µ„¤ì)ô)™Õ¹Ñ¥½¸¡•­5¥¹½¹Ñ…¥¹Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€¥˜€ …%ÍY…±¥Ð¡Í¡•µ„¤¤(€€€É•ÑÕÉ¸ÑÉÕ”ì(€½¹ÍÐ½Õ¹Ð€ôÙ…±Õ”¹É•‘Õ” ¡É•ÍÕ±Ð°¥Ñ•´¤€ôø¡•­M¡•µ„¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„¹½¹Ñ…¥¹Ì°¥Ñ•´¤€ü€¬­É•ÍÕ±Ð€èÉ•ÍÕ±Ð°€À¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉ•…Ñ•ÉÅÕ…±Q¡…¸¡½Õ¹Ð°Í¡•µ„¹µ¥¹½¹Ñ…¥¹Ì¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½É5¥¹½¹Ñ…¥¹Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸¡•­5¥¹½¹Ñ…¥¹Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰½¹Ñ…¥¹Ìˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèìµ¥¹½¹Ñ…¥¹ÌèÍ¡•µ„¹µ¥¹½¹Ñ…¥¹Ìô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½µ¥¹¥µÕ´¹µ©Ì)™Õ¹Ñ¥½¸¡•­5¥¹¥µÕ´¡}ÍÑ…¬°}½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉ•…Ñ•ÉÅÕ…±Q¡…¸¡Ù…±Õ”°Í¡•µ„¹µ¥¹¥µÕ´¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½É5¥¹¥µÕ´¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸¡•­5¥¹¥µÕ´¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰µ¥¹¥µÕ´ˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèì½µÁ…É¥Í½¸è€ˆøôˆ°±¥µ¥ÐèÍ¡•µ„¹µ¥¹¥µÕ´ô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½µ¥¹%Ñ•µÌ¹µ©Ì)™Õ¹Ñ¥½¸¡•­5¥¹%Ñ•µÌ¡}ÍÑ…¬°}½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉ•…Ñ•ÉÅÕ…±Q¡…¸¡Ù…±Õ”¹±•¹Ñ °Í¡•µ„¹µ¥¹%Ñ•µÌ¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½É5¥¹%Ñ•µÌ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸¡•­5¥¹%Ñ•µÌ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰µ¥¹%Ñ•µÌˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèì±¥µ¥ÐèÍ¡•µ„¹µ¥¹%Ñ•µÌô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½µ¥¹1•¹Ñ ¹µ©Ì)™Õ¹Ñ¥½¸¡•­5¥¹1•¹Ñ ¡}ÍÑ…¬°}½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%Í5¥¹1•¹Ñ ¡Ù…±Õ”°Í¡•µ„¹µ¥¹1•¹Ñ ¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½É5¥¹1•¹Ñ ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸¡•­5¥¹1•¹Ñ ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰µ¥¹1•¹Ñ ˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèì±¥µ¥ÐèÍ¡•µ„¹µ¥¹1•¹Ñ ô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½µ¥¹AÉ½Á•ÉÑ¥•Ì¹µ©Ì)™Õ¹Ñ¥½¸¡•­5¥¹AÉ½Á•ÉÑ¥•Ì¡}ÍÑ…¬°}½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉ•…Ñ•ÉÅÕ…±Q¡…¸¡Õ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡Ù…±Õ”¤¹±•¹Ñ °Í¡•µ„¹µ¥¹AÉ½Á•ÉÑ¥•Ì¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½É5¥¹AÉ½Á•ÉÑ¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸¡•­5¥¹AÉ½Á•ÉÑ¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰µ¥¹AÉ½Á•ÉÑ¥•Ìˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèì±¥µ¥ÐèÍ¡•µ„¹µ¥¹AÉ½Á•ÉÑ¥•Ìô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½µÕ±Ñ¥Á±•=˜¹µ©Ì)™Õ¹Ñ¥½¸¡•­5Õ±Ñ¥Á±•=˜¡}ÍÑ…¬°}½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%Í5Õ±Ñ¥Á±•=˜¡Ù…±Õ”°Í¡•µ„¹µÕ±Ñ¥Á±•=˜¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½É5Õ±Ñ¥Á±•=˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸¡•­5Õ±Ñ¥Á±•=˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰µÕ±Ñ¥Á±•=˜ˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèìµÕ±Ñ¥Á±•=˜èÍ¡•µ„¹µÕ±Ñ¥Á±•=˜ô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½¹½Ð¹µ©Ì)™Õ¹Ñ¥½¸¡•­9½Ð¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐ¹•áÑ½¹Ñ•áÐ€ô¹•Ü¡•­½¹Ñ•áÐ ¤ì(€½¹ÍÐ¥ÍM¡•µ„€ô€…¡•­M¡•µ„¡ÍÑ…¬°¹•áÑ½¹Ñ•áÐ°Í¡•µ„¹¹½Ð°Ù…±Õ”¤ì(€½¹ÍÐ¥Í9½Ð€ô¥ÍM¡•µ„€˜˜½¹Ñ•áÐ¹5•É”¡m¹•áÑ½¹Ñ•áÑt¤ì(€É•ÑÕÉ¸¥Í9½Ðì)ô)™Õ¹Ñ¥½¸ÉÉ½É9½Ð¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸¡•­9½Ð¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰¹½Ðˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèíô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½½¹•=˜¹µ©Ì)™Õ¹Ñ¥½¸¡•­=¹•=˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐÁ…ÍÍ•‘½¹Ñ•áÑÌ€ôÍ¡•µ„¹½¹•=˜¹É•‘Õ” ¡É•ÍÕ±Ð°Í¡•µ„È¤€ôøì(€€€½¹ÍÐ¹•áÑ½¹Ñ•áÐ€ô¹•Ü¡•­½¹Ñ•áÐ ¤ì(€€€É•ÑÕÉ¸¡•­M¡•µ„¡ÍÑ…¬°¹•áÑ½¹Ñ•áÐ°Í¡•µ„È°Ù…±Õ”¤€ül¸¸¹É•ÍÕ±Ð°¹•áÑ½¹Ñ•áÑt€èÉ•ÍÕ±Ðì(€ô°mt¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Á…ÍÍ•‘½¹Ñ•áÑÌ¹±•¹Ñ °€Ä¤€˜˜½¹Ñ•áÐ¹5•É”¡Á…ÍÍ•‘½¹Ñ•áÑÌ¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½É=¹•=˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐ™…¥±•‘½¹Ñ•áÑÌ€ômtì(€½¹ÍÐÁ…ÍÍ¥¹M¡•µ…Ì€ômtì(€½¹ÍÐÁ…ÍÍ•‘½¹Ñ•áÑÌ€ôÍ¡•µ„¹½¹•=˜¹É•‘Õ” ¡É•ÍÕ±Ð°Í¡•µ„È°¥¹‘•à¤€ôøì(€€€½¹ÍÐ¹•áÑ½¹Ñ•áÐ€ô¹•ÜÕµÕ±…Ñ•‘ÉÉ½É½¹Ñ•áÐ ¤ì(€€€½¹ÍÐ¹•áÑM¡•µ…A…Ñ €ô€‘íÍ¡•µ…A…Ñ¡ô½½¹•=˜¼‘í¥¹‘•áõ€ì(€€€½¹ÍÐ¥ÍM¡•µ„€ôÉÉ½ÉM¡•µ„¡ÍÑ…¬°¹•áÑ½¹Ñ•áÐ°¹•áÑM¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„È°Ù…±Õ”¤ì(€€€¥˜€¡¥ÍM¡•µ„¤(€€€€€Á…ÍÍ¥¹M¡•µ…Ì¹ÁÕÍ ¡¥¹‘•à¤ì(€€€¥˜€ …¥ÍM¡•µ„¤(€€€€€™…¥±•‘½¹Ñ•áÑÌ¹ÁÕÍ ¡¹•áÑ½¹Ñ•áÐ¤ì(€€€É•ÑÕÉ¸¥ÍM¡•µ„€ül¸¸¹É•ÍÕ±Ð°¹•áÑ½¹Ñ•áÑt€èÉ•ÍÕ±Ðì(€ô°mt¤ì(€½¹ÍÐ¥Í=¹•=˜€ôÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Á…ÍÍ•‘½¹Ñ•áÑÌ¹±•¹Ñ °€Ä¤€˜˜½¹Ñ•áÐ¹5•É”¡Á…ÍÍ•‘½¹Ñ•áÑÌ¤ì(€¥˜€ …¥Í=¹•=˜€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Á…ÍÍ¥¹M¡•µ…Ì¹±•¹Ñ °€À¤¤(€€€™…¥±•‘½¹Ñ•áÑÌ¹™½É…  ¡™…¥±•¤€ôø™…¥±•¹•ÑÉÉ½ÉÌ ¤¹™½É…  ¡•ÉÉ½È¤€ôø½¹Ñ•áÐ¹‘‘ÉÉ½È¡•ÉÉ½È¤¤¤ì(€É•ÑÕÉ¸¥Í=¹•=˜ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰½¹•=˜ˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèìÁ…ÍÍ¥¹M¡•µ…Ìô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½Á…ÑÑ•É¸¹µ©Ì)™Õ¹Ñ¥½¸¡•­A…ÑÑ•É¸¡}ÍÑ…¬°}½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐÉ••áÀ€ôÕ…É‘}•áÁ½ÉÑÌ¹%ÍMÑÉ¥¹œ¡Í¡•µ„¹Á…ÑÑ•É¸¤€ü¹•ÜI•áÀ¡Í¡•µ„¹Á…ÑÑ•É¸°€‰Ôˆ¤€èÍ¡•µ„¹Á…ÑÑ•É¸ì(€É•ÑÕÉ¸É••áÀ¹Ñ•ÍÐ¡Ù…±Õ”¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½ÉA…ÑÑ•É¸¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸¡•­A…ÑÑ•É¸¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰Á…ÑÑ•É¸ˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèìÁ…ÑÑ•É¸èÍ¡•µ„¹Á…ÑÑ•É¸ô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½Á…ÑÑ•É¹AÉ½Á•ÉÑ¥•Ì¹µ©Ì)™Õ¹Ñ¥½¸¡•­A…ÑÑ•É¹AÉ½Á•ÉÑ¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹Ù•Éä¡Õ…É‘}•áÁ½ÉÑÌ¹¹ÑÉ¥•Ì¡Í¡•µ„¹Á…ÑÑ•É¹AÉ½Á•ÉÑ¥•Ì¤°€À°€¡mÁ…ÑÑ•É¸°Í¡•µ„Ét¤€ôøì(€€€½¹ÍÐÉ••áÀ€ô¹•ÜI•áÀ¡Á…ÑÑ•É¸°€‰Ôˆ¤ì(€€€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹Ù•Éä¡Õ…É‘}•áÁ½ÉÑÌ¹¹ÑÉ¥•Ì¡Ù…±Õ”¤°€À°€¡m­•ä°ÁÉ½Át¤€ôøì(€€€€€É•ÑÕÉ¸€…É••áÀ¹Ñ•ÍÐ¡­•ä¤ñð¡•­M¡•µ…AÕÍ¡MÑ…¬¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„È°ÁÉ½À¤€˜˜½¹Ñ•áÐ¹‘‘-•ä¡­•ä¤ì(€€€ô¤ì(€ô¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½ÉA…ÑÑ•É¹AÉ½Á•ÉÑ¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹Ù•Éå±°¡Õ…É‘}•áÁ½ÉÑÌ¹¹ÑÉ¥•Ì¡Í¡•µ„¹Á…ÑÑ•É¹AÉ½Á•ÉÑ¥•Ì¤°€À°€¡mÁ…ÑÑ•É¸°Í¡•µ„Ét¤€ôøì(€€€½¹ÍÐ¹•áÑM¡•µ…A…Ñ €ô€‘íÍ¡•µ…A…Ñ¡ô½Á…ÑÑ•É¹AÉ½Á•ÉÑ¥•Ì¼‘íÁ…ÑÑ•É¹õ€ì(€€€½¹ÍÐÉ••áÀ€ô¹•ÜI•áÀ¡Á…ÑÑ•É¸°€‰Ôˆ¤ì(€€€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹Ù•Éå±°¡Õ…É‘}•áÁ½ÉÑÌ¹¹ÑÉ¥•Ì¡Ù…±Õ”¤°€À°€¡m­•ä°Ù…±Õ”Ét¤€ôøì(€€€€€½¹ÍÐ¹•áÑ%¹ÍÑ…¹•A…Ñ €ô€‘í¥¹ÍÑ…¹•A…Ñ¡ô¼‘í­•åõ€ì(€€€€€½¹ÍÐ¹½Ñ-•ä€ô€…É••áÀ¹Ñ•ÍÐ¡­•ä¤ì(€€€€€É•ÑÕÉ¸¹½Ñ-•äñðÉÉ½ÉM¡•µ…AÕÍ¡MÑ…¬¡ÍÑ…¬°½¹Ñ•áÐ°¹•áÑM¡•µ…A…Ñ °¹•áÑ%¹ÍÑ…¹•A…Ñ °Í¡•µ„È°Ù…±Õ”È¤€˜˜½¹Ñ•áÐ¹‘‘-•ä¡­•ä¤ì(€€€ô¤ì(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½ÁÉ•™¥á%Ñ•µÌ¹µ©Ì)™Õ¹Ñ¥½¸¡•­AÉ•™¥á%Ñ•µÌ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Ù…±Õ”¹±•¹Ñ °€À¤ñðÕ…É‘}•áÁ½ÉÑÌ¹Ù•Éä¡Í¡•µ„¹ÁÉ•™¥á%Ñ•µÌ°€À°€¡Í¡•µ„È°¥¹‘•à¤€ôøì(€€€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%Í1•ÍÍÅÕ…±Q¡…¸¡Ù…±Õ”¹±•¹Ñ °¥¹‘•à¤ñð¡•­M¡•µ…AÕÍ¡MÑ…¬¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„È°Ù…±Õ•m¥¹‘•át¤€˜˜½¹Ñ•áÐ¹‘‘%¹‘•à¡¥¹‘•à¤ì(€ô¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½ÉAÉ•™¥á%Ñ•µÌ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Ù…±Õ”¹±•¹Ñ °€À¤ñðÕ…É‘}•áÁ½ÉÑÌ¹Ù•Éå±°¡Í¡•µ„¹ÁÉ•™¥á%Ñ•µÌ°€À°€¡Í¡•µ„È°¥¹‘•à¤€ôøì(€€€½¹ÍÐ¹•áÑM¡•µ…A…Ñ €ô€‘íÍ¡•µ…A…Ñ¡ô½ÁÉ•™¥á%Ñ•µÌ¼‘í¥¹‘•áõ€ì(€€€½¹ÍÐ¹•áÑ%¹ÍÑ…¹•A…Ñ €ô€‘í¥¹ÍÑ…¹•A…Ñ¡ô¼‘í¥¹‘•áõ€ì(€€€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%Í1•ÍÍÅÕ…±Q¡…¸¡Ù…±Õ”¹±•¹Ñ °¥¹‘•à¤ñðÉÉ½ÉM¡•µ…AÕÍ¡MÑ…¬¡ÍÑ…¬°½¹Ñ•áÐ°¹•áÑM¡•µ…A…Ñ °¹•áÑ%¹ÍÑ…¹•A…Ñ °Í¡•µ„È°Ù…±Õ•m¥¹‘•át¤€˜˜½¹Ñ•áÐ¹‘‘%¹‘•à¡¥¹‘•à¤ì(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½}•á…Ñ}½ÁÑ¥½¹…°¹µ©Ì)™Õ¹Ñ¥½¸%Íá…Ñ=ÁÑ¥½¹…°¡É•ÅÕ¥É•°­•ä¤ì(€É•ÑÕÉ¸É•ÅÕ¥É•¹¥¹±Õ‘•Ì¡­•ä¤ñðÍ•ÑÑ¥¹Í}•áÁ½ÉÑÌ¹•Ð ¤¹•á…Ñ=ÁÑ¥½¹…±AÉ½Á•ÉÑåQåÁ•Ìì)ô)™Õ¹Ñ¥½¸%¹•á…Ñ=ÁÑ¥½¹…±¡•¬¡Ù…±Õ”°­•ä¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍU¹‘•™¥¹•¡Ù…±Õ•m­•åt¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½ÁÉ½Á•ÉÑ¥•Ì¹µ©Ì)™Õ¹Ñ¥½¸¡•­AÉ½Á•ÉÑ¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐÉ•ÅÕ¥É•€ô%ÍI•ÅÕ¥É•¡Í¡•µ„¤€üÍ¡•µ„¹É•ÅÕ¥É•€èmtì(€½¹ÍÐ¥ÍAÉ½Á•ÉÑ¥•Ì€ôÕ…É‘}•áÁ½ÉÑÌ¹Ù•Éä¡Õ…É‘}•áÁ½ÉÑÌ¹¹ÑÉ¥•Ì¡Í¡•µ„¹ÁÉ½Á•ÉÑ¥•Ì¤°€À°€¡m­•ä°Í¡•µ„Ét¤€ôøì(€€€½¹ÍÐ¥ÍAÉ½Á•ÉÑä€ô€…Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Ù…±Õ”°­•ä¤ñð¡•­M¡•µ…AÕÍ¡MÑ…¬¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„È°Ù…±Õ•m­•åt¤€˜˜½¹Ñ•áÐ¹‘‘-•ä¡­•ä¤ì(€€€É•ÑÕÉ¸%Íá…Ñ=ÁÑ¥½¹…°¡É•ÅÕ¥É•°­•ä¤€ü¥ÍAÉ½Á•ÉÑä€è%¹•á…Ñ=ÁÑ¥½¹…±¡•¬¡Ù…±Õ”°­•ä¤ñð¥ÍAÉ½Á•ÉÑäì(€ô¤ì(€É•ÑÕÉ¸¥ÍAÉ½Á•ÉÑ¥•Ìì)ô)™Õ¹Ñ¥½¸ÉÉ½ÉAÉ½Á•ÉÑ¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐÉ•ÅÕ¥É•€ô%ÍI•ÅÕ¥É•¡Í¡•µ„¤€üÍ¡•µ„¹É•ÅÕ¥É•€èmtì(€½¹ÍÐ¥ÍAÉ½Á•ÉÑ¥•Ì€ôÕ…É‘}•áÁ½ÉÑÌ¹Ù•Éå±°¡Õ…É‘}•áÁ½ÉÑÌ¹¹ÑÉ¥•Ì¡Í¡•µ„¹ÁÉ½Á•ÉÑ¥•Ì¤°€À°€¡m­•ä°Í¡•µ„Ét¤€ôøì(€€€½¹ÍÐ¹•áÑM¡•µ…A…Ñ €ô€‘íÍ¡•µ…A…Ñ¡ô½ÁÉ½Á•ÉÑ¥•Ì¼‘í­•åõ€ì(€€€½¹ÍÐ¹•áÑ%¹ÍÑ…¹•A…Ñ €ô€‘í¥¹ÍÑ…¹•A…Ñ¡ô¼‘í­•åõ€ì(€€€½¹ÍÐ¥ÍAÉ½Á•ÉÑä€ô€ ¤€ôø€…Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Ù…±Õ”°­•ä¤ñðÉÉ½ÉM¡•µ…AÕÍ¡MÑ…¬¡ÍÑ…¬°½¹Ñ•áÐ°¹•áÑM¡•µ…A…Ñ °¹•áÑ%¹ÍÑ…¹•A…Ñ °Í¡•µ„È°Ù…±Õ•m­•åt¤€˜˜½¹Ñ•áÐ¹‘‘-•ä¡­•ä¤ì(€€€É•ÑÕÉ¸%Íá…Ñ=ÁÑ¥½¹…°¡É•ÅÕ¥É•°­•ä¤€ü¥ÍAÉ½Á•ÉÑä ¤€è%¹•á…Ñ=ÁÑ¥½¹…±¡•¬¡Ù…±Õ”°­•ä¤ñð¥ÍAÉ½Á•ÉÑä ¤ì(€ô¤ì(€É•ÑÕÉ¸¥ÍAÉ½Á•ÉÑ¥•Ìì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½ÁÉ½Á•ÉÑå9…µ•Ì¹µ©Ì)™Õ¹Ñ¥½¸¡•­AÉ½Á•ÉÑå9…µ•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹Ù•Éä¡Õ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡Ù…±Õ”¤°€À°€¡­•ä°}¥¹‘•à¤€ôø¡•­M¡•µ„¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„¹ÁÉ½Á•ÉÑå9…µ•Ì°­•ä¤¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½ÉAÉ½Á•ÉÑå9…µ•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐÁÉ½Á•ÉÑå9…µ•Ì€ômtì(€½¹ÍÐ¥ÍAÉ½Á•ÉÑå9…µ•Ì€ôÕ…É‘}•áÁ½ÉÑÌ¹Ù•Éå±°¡Õ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡Ù…±Õ”¤°€À°€¡­•ä°}¥¹‘•à¤€ôøì(€€€½¹ÍÐ¹•áÑ%¹ÍÑ…¹•A…Ñ €ô€‘í¥¹ÍÑ…¹•A…Ñ¡ô¼‘í­•åõ€ì(€€€½¹ÍÐ¹•áÑM¡•µ…A…Ñ €ô€‘íÍ¡•µ…A…Ñ¡ô½ÁÉ½Á•ÉÑå9…µ•Í€ì(€€€½¹ÍÐ¹•áÑ½¹Ñ•áÐ€ô¹•ÜÕµÕ±…Ñ•‘ÉÉ½É½¹Ñ•áÐ ¤ì(€€€½¹ÍÐ¥ÍAÉ½Á•ÉÑå9…µ”€ôÉÉ½ÉM¡•µ„¡ÍÑ…¬°¹•áÑ½¹Ñ•áÐ°¹•áÑM¡•µ…A…Ñ °¹•áÑ%¹ÍÑ…¹•A…Ñ °Í¡•µ„¹ÁÉ½Á•ÉÑå9…µ•Ì°­•ä¤ì(€€€¥˜€ …¥ÍAÉ½Á•ÉÑå9…µ”¤(€€€€€ÁÉ½Á•ÉÑå9…µ•Ì¹ÁÕÍ ¡­•ä¤ì(€€€É•ÑÕÉ¸¥ÍAÉ½Á•ÉÑå9…µ”ì(€ô¤ì(€É•ÑÕÉ¸¥ÍAÉ½Á•ÉÑå9…µ•Ìñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰ÁÉ½Á•ÉÑå9…µ•Ìˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèìÁÉ½Á•ÉÑå9…µ•Ìô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½É•ÕÉÍ¥Ù•I•˜¹µ©Ì)™Õ¹Ñ¥½¸¡•­I•ÕÉÍ¥Ù•I•˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐÑ…É•Ð€ôÍÑ…¬¹I•ÕÉÍ¥Ù•I•˜¡Í¡•µ„¤€üü™…±Í”ì(€É•ÑÕÉ¸%ÍM¡•µ„È¡Ñ…É•Ð¤€˜˜¡•­M¡•µ„¡ÍÑ…¬°½¹Ñ•áÐ°Ñ…É•Ð°Ù…±Õ”¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½ÉI•ÕÉÍ¥Ù•I•˜¡ÍÑ…¬°½¹Ñ•áÐ°}Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐÑ…É•Ð€ôÍÑ…¬¹I•ÕÉÍ¥Ù•I•˜¡Í¡•µ„¤€üü™…±Í”ì(€É•ÑÕÉ¸%ÍM¡•µ„È¡Ñ…É•Ð¤€˜˜ÉÉ½ÉM¡•µ„¡ÍÑ…¬°½¹Ñ•áÐ°€ˆŒˆ°¥¹ÍÑ…¹•A…Ñ °Ñ…É•Ð°Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½É•˜¹µ©Ì)™Õ¹Ñ¥½¸¡•­I•˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐÑ…É•Ð€ôÍÑ…¬¹I•˜¡Í¡•µ„¤€üü™…±Í”ì(€½¹ÍÐ¹•áÑ½¹Ñ•áÐ€ô¹•Ü¡•­½¹Ñ•áÐ ¤ì(€½¹ÍÐÉ•ÍÕ±Ð€ô%ÍM¡•µ„È¡Ñ…É•Ð¤€˜˜¡•­M¡•µ„¡ÍÑ…¬°¹•áÑ½¹Ñ•áÐ°Ñ…É•Ð°Ù…±Õ”¤ì(€¥˜€¡É•ÍÕ±Ð¤(€€€½¹Ñ•áÐ¹5•É”¡m¹•áÑ½¹Ñ•áÑt¤ì(€É•ÑÕÉ¸É•ÍÕ±Ðì)ô)™Õ¹Ñ¥½¸ÉÉ½ÉI•˜¡ÍÑ…¬°½¹Ñ•áÐ°}Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐÑ…É•Ð€ôÍÑ…¬¹I•˜¡Í¡•µ„¤€üü™…±Í”ì(€½¹ÍÐ¹•áÑ½¹Ñ•áÐ€ô¹•ÜÕµÕ±…Ñ•‘ÉÉ½É½¹Ñ•áÐ ¤ì(€½¹ÍÐÉ•ÍÕ±Ð€ô%ÍM¡•µ„È¡Ñ…É•Ð¤€˜˜ÉÉ½ÉM¡•µ„¡ÍÑ…¬°¹•áÑ½¹Ñ•áÐ°€ˆŒˆ°¥¹ÍÑ…¹•A…Ñ °Ñ…É•Ð°Ù…±Õ”¤ì(€¥˜€¡É•ÍÕ±Ð¤(€€€½¹Ñ•áÐ¹5•É”¡m¹•áÑ½¹Ñ•áÑt¤ì(€¥˜€ …É•ÍÕ±Ð¤(€€€¹•áÑ½¹Ñ•áÐ¹•ÑÉÉ½ÉÌ ¤¹™½É…  ¡•ÉÉ½È¤€ôø½¹Ñ•áÐ¹‘‘ÉÉ½È¡•ÉÉ½È¤¤ì(€É•ÑÕÉ¸É•ÍÕ±Ðì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½É•ÅÕ¥É•¹µ©Ì)™Õ¹Ñ¥½¸¡•­I•ÅÕ¥É•¡}ÍÑ…¬°}½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹Ù•Éä¡Í¡•µ„¹É•ÅÕ¥É•°€À°€¡­•ä¤€ôøÕ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Ù…±Õ”°­•ä¤¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½ÉI•ÅÕ¥É•¡}ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐÉ•ÅÕ¥É•‘AÉ½Á•ÉÑ¥•Ì€ômtì(€½¹ÍÐ¥ÍI•ÅÕ¥É•€ôÕ…É‘}•áÁ½ÉÑÌ¹Ù•Éå±°¡Í¡•µ„¹É•ÅÕ¥É•°€À°€¡­•ä¤€ôøì(€€€½¹ÍÐ¡…Í-•ä€ôÕ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Ù…±Õ”°­•ä¤ì(€€€¥˜€ …¡…Í-•ä¤(€€€€€É•ÅÕ¥É•‘AÉ½Á•ÉÑ¥•Ì¹ÁÕÍ ¡­•ä¤ì(€€€É•ÑÕÉ¸¡…Í-•äì(€ô¤ì(€É•ÑÕÉ¸¥ÍI•ÅÕ¥É•ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰É•ÅÕ¥É•ˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèìÉ•ÅÕ¥É•‘AÉ½Á•ÉÑ¥•Ìô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½ÑåÁ”¹µ©Ì)™Õ¹Ñ¥½¸¡•­QåÁ•9…µ”¡}ÍÑ…¬°}½¹Ñ•áÐ°ÑåÁ”°}Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸€ (€€€€¼¼©Í½¹Í¡•µ„(€€€Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡ÑåÁ”°€‰½‰©•Ðˆ¤€üÕ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ñ9½ÑÉÉ…ä¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡ÑåÁ”°€‰…ÉÉ…äˆ¤€üÕ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡ÑåÁ”°€‰‰½½±•…¸ˆ¤€üÕ…É‘}•áÁ½ÉÑÌ¹%Í	½½±•…¸¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡ÑåÁ”°€‰¥¹Ñ••Èˆ¤€üÕ…É‘}•áÁ½ÉÑÌ¹%Í%¹Ñ••È¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡ÑåÁ”°€‰¹Õµ‰•Èˆ¤€üÕ…É‘}•áÁ½ÉÑÌ¹%Í9Õµ‰•È¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡ÑåÁ”°€‰¹Õ±°ˆ¤€üÕ…É‘}•áÁ½ÉÑÌ¹%Í9Õ±°¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡ÑåÁ”°€‰ÍÑÉ¥¹œˆ¤€üÕ…É‘}•áÁ½ÉÑÌ¹%ÍMÑÉ¥¹œ¡Ù…±Õ”¤€è€ (€€€€€€¼¼áÍ¡•µ„(€€€€€Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡ÑåÁ”°€‰‰¥¥¹Ðˆ¤€üÕ…É‘}•áÁ½ÉÑÌ¹%Í	¥%¹Ð¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡ÑåÁ”°€‰½¹ÍÑÉÕÑ½Èˆ¤€üÕ…É‘}•áÁ½ÉÑÌ¹%Í½¹ÍÑÉÕÑ½È¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡ÑåÁ”°€‰™Õ¹Ñ¥½¸ˆ¤€üÕ…É‘}•áÁ½ÉÑÌ¹%ÍÕ¹Ñ¥½¸¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡ÑåÁ”°€‰Íåµ‰½°ˆ¤€üÕ…É‘}•áÁ½ÉÑÌ¹%ÍMåµ‰½°¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡ÑåÁ”°€‰Õ¹‘•™¥¹•ˆ¤€üÕ…É‘}•áÁ½ÉÑÌ¹%ÍU¹‘•™¥¹•¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡ÑåÁ”°€‰Ù½¥ˆ¤€üÕ…É‘}•áÁ½ÉÑÌ¹%ÍU¹‘•™¥¹•¡Ù…±Õ”¤€èÑÉÕ”(€€€€¤(€€¤ì)ô)™Õ¹Ñ¥½¸¡•­QåÁ•9…µ•Ì¡ÍÑ…¬°½¹Ñ•áÐ°ÑåÁ•Ì°Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸ÑåÁ•Ì¹Í½µ” ¡ÑåÁ”¤€ôø¡•­QåÁ•9…µ”¡ÍÑ…¬°½¹Ñ•áÐ°ÑåÁ”°Í¡•µ„°Ù…±Õ”¤¤ì)ô)™Õ¹Ñ¥½¸¡•­QåÁ”¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Í¡•µ„¹ÑåÁ”¤€ü¡•­QåÁ•9…µ•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„¹ÑåÁ”°Í¡•µ„°Ù…±Õ”¤€è¡•­QåÁ•9…µ”¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„¹ÑåÁ”°Í¡•µ„°Ù…±Õ”¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½ÉQåÁ”¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐ¥ÍQåÁ”€ôÕ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Í¡•µ„¹ÑåÁ”¤€ü¡•­QåÁ•9…µ•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„¹ÑåÁ”°Í¡•µ„°Ù…±Õ”¤€è¡•­QåÁ•9…µ”¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„¹ÑåÁ”°Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸¥ÍQåÁ”ñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰ÑåÁ”ˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèìÑåÁ”èÍ¡•µ„¹ÑåÁ”ô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½Õ¹•Ù…±Õ…Ñ•‘%Ñ•µÌ¹µ©Ì)™Õ¹Ñ¥½¸¡•­U¹•Ù…±Õ…Ñ•‘%Ñ•µÌ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐ¥¹‘¥•Ì€ô½¹Ñ•áÐ¹•Ñ%¹‘¥•Ì ¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹Ù•Éä¡Ù…±Õ”°€À°€¡¥Ñ•´°¥¹‘•à¤€ôøì(€€€É•ÑÕÉ¸€¡¥¹‘¥•Ì¹¡…Ì¡¥¹‘•à¤ñð¡•­M¡•µ„¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„¹Õ¹•Ù…±Õ…Ñ•‘%Ñ•µÌ°¥Ñ•´¤¤€˜˜½¹Ñ•áÐ¹‘‘%¹‘•à¡¥¹‘•à¤ì(€ô¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½ÉU¹•Ù…±Õ…Ñ•‘%Ñ•µÌ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐ¥¹‘¥•Ì€ô½¹Ñ•áÐ¹•Ñ%¹‘¥•Ì ¤ì(€½¹ÍÐÕ¹•Ù…±Õ…Ñ•‘%Ñ•µÌ€ômtì(€½¹ÍÐ¥ÍU¹•Ù…±Õ…Ñ•‘%Ñ•µÌ€ôÕ…É‘}•áÁ½ÉÑÌ¹Ù•Éå±°¡Ù…±Õ”°€À°€¡¥Ñ•´°¥¹‘•à¤€ôøì(€€€½¹ÍÐ¹•áÑ½¹Ñ•áÐ€ô¹•ÜÕµÕ±…Ñ•‘ÉÉ½É½¹Ñ•áÐ ¤ì(€€€½¹ÍÐ¥ÍÙ…±Õ…Ñ•‘%Ñ•´€ô€¡¥¹‘¥•Ì¹¡…Ì¡¥¹‘•à¤ñðÉÉ½ÉM¡•µ„¡ÍÑ…¬°¹•áÑ½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„¹Õ¹•Ù…±Õ…Ñ•‘%Ñ•µÌ°¥Ñ•´¤¤€˜˜½¹Ñ•áÐ¹‘‘%¹‘•à¡¥¹‘•à¤ì(€€€¥˜€ …¥ÍÙ…±Õ…Ñ•‘%Ñ•´¤(€€€€€Õ¹•Ù…±Õ…Ñ•‘%Ñ•µÌ¹ÁÕÍ ¡¥¹‘•à¤ì(€€€É•ÑÕÉ¸¥ÍÙ…±Õ…Ñ•‘%Ñ•´ì(€ô¤ì(€É•ÑÕÉ¸¥ÍU¹•Ù…±Õ…Ñ•‘%Ñ•µÌñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰Õ¹•Ù…±Õ…Ñ•‘%Ñ•µÌˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèìÕ¹•Ù…±Õ…Ñ•‘%Ñ•µÌô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½Õ¹•Ù…±Õ…Ñ•‘AÉ½Á•ÉÑ¥•Ì¹µ©Ì)™Õ¹Ñ¥½¸¡•­U¹•Ù…±Õ…Ñ•‘AÉ½Á•ÉÑ¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐ­•åÌ€ô½¹Ñ•áÐ¹•Ñ-•åÌ ¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹Ù•Éä¡Õ…É‘}•áÁ½ÉÑÌ¹¹ÑÉ¥•Ì¡Ù…±Õ”¤°€À°€¡m­•ä°ÁÉ½Át¤€ôøì(€€€É•ÑÕÉ¸­•åÌ¹¡…Ì¡­•ä¤ñð¡•­M¡•µ„¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„¹Õ¹•Ù…±Õ…Ñ•‘AÉ½Á•ÉÑ¥•Ì°ÁÉ½À¤€˜˜½¹Ñ•áÐ¹‘‘-•ä¡­•ä¤ì(€ô¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½ÉU¹•Ù…±Õ…Ñ•‘AÉ½Á•ÉÑ¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€½¹ÍÐ­•åÌ€ô½¹Ñ•áÐ¹•Ñ-•åÌ ¤ì(€½¹ÍÐÕ¹•Ù…±Õ…Ñ•‘AÉ½Á•ÉÑ¥•Ì€ômtì(€½¹ÍÐ¥ÍU¹•Ù…±Õ…Ñ•‘AÉ½Á•ÉÑ¥•Ì€ôÕ…É‘}•áÁ½ÉÑÌ¹Ù•Éå±°¡Õ…É‘}•áÁ½ÉÑÌ¹¹ÑÉ¥•Ì¡Ù…±Õ”¤°€À°€¡m­•ä°ÁÉ½Át¤€ôøì(€€€½¹ÍÐ¹•áÑ½¹Ñ•áÐ€ô¹•ÜÕµÕ±…Ñ•‘ÉÉ½É½¹Ñ•áÐ ¤ì(€€€½¹ÍÐ¥ÍÙ…±Õ…Ñ•‘AÉ½Á•ÉÑä€ô­•åÌ¹¡…Ì¡­•ä¤ñðÉÉ½ÉM¡•µ„¡ÍÑ…¬°¹•áÑ½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„¹Õ¹•Ù…±Õ…Ñ•‘AÉ½Á•ÉÑ¥•Ì°ÁÉ½À¤€˜˜½¹Ñ•áÐ¹‘‘-•ä¡­•ä¤ì(€€€¥˜€ …¥ÍÙ…±Õ…Ñ•‘AÉ½Á•ÉÑä¤(€€€€€Õ¹•Ù…±Õ…Ñ•‘AÉ½Á•ÉÑ¥•Ì¹ÁÕÍ ¡­•ä¤ì(€€€É•ÑÕÉ¸¥ÍÙ…±Õ…Ñ•‘AÉ½Á•ÉÑäì(€ô¤ì(€É•ÑÕÉ¸¥ÍU¹•Ù…±Õ…Ñ•‘AÉ½Á•ÉÑ¥•Ìñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰Õ¹•Ù…±Õ…Ñ•‘AÉ½Á•ÉÑ¥•Ìˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèìÕ¹•Ù…±Õ…Ñ•‘AÉ½Á•ÉÑ¥•Ìô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½Õ¹¥ÅÕ•%Ñ•µÌ¹µ©Ì)™Õ¹Ñ¥½¸%ÍY…±¥Ô¡Í¡•µ„¤ì(€É•ÑÕÉ¸€…Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Í¡•µ„¹Õ¹¥ÅÕ•%Ñ•µÌ°™…±Í”¤ì)ô)™Õ¹Ñ¥½¸¡•­U¹¥ÅÕ•%Ñ•µÌ¡}ÍÑ…¬°}½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€¥˜€ …%ÍY…±¥Ô¡Í¡•µ„¤¤(€€€É•ÑÕÉ¸ÑÉÕ”ì(€½¹ÍÐÍ•Ð€ô¹•ÜM•Ð¡Ù…±Õ”¹µ…À¡¡…Í¡}•áÁ½ÉÑÌ¹!…Í ¤¤¹Í¥é”ì(€½¹ÍÐ¥Í1•¹Ñ €ôÙ…±Õ”¹±•¹Ñ ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Í•Ð°¥Í1•¹Ñ ¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½ÉU¹¥ÅÕ•%Ñ•µÌ¡}ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€¥˜€ …%ÍY…±¥Ô¡Í¡•µ„¤¤(€€€É•ÑÕÉ¸ÑÉÕ”ì(€½¹ÍÐÍ•Ð€ô€¼¨}}AUI}|€¨¼¹•ÜM•Ð ¤ì(€½¹ÍÐ‘ÕÁ±¥…Ñ•%Ñ•µÌ€ôÙ…±Õ”¹É•‘Õ” ¡É•ÍÕ±Ð°Ù…±Õ”È°¥¹‘•à¤€ôøì(€€€½¹ÍÐ¡…Í €ô¡…Í¡}•áÁ½ÉÑÌ¹!…Í ¡Ù…±Õ”È¤ì(€€€¥˜€¡Í•Ð¹¡…Ì¡¡…Í ¤¤(€€€€€É•ÑÕÉ¸l¸¸¹É•ÍÕ±Ð°¥¹‘•átì(€€€Í•Ð¹…‘¡¡…Í ¤ì(€€€É•ÑÕÉ¸É•ÍÕ±Ðì(€ô°mt¤ì(€½¹ÍÐ¥ÍU¹¥ÅÕ•%Ñ•µÌ€ôÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡‘ÕÁ±¥…Ñ•%Ñ•µÌ¹±•¹Ñ °€À¤ì(€É•ÑÕÉ¸¥ÍU¹¥ÅÕ•%Ñ•µÌñð½¹Ñ•áÐ¹‘‘ÉÉ½È¡ì(€€€­•åÝ½Éè€‰Õ¹¥ÅÕ•%Ñ•µÌˆ°(€€€Í¡•µ…A…Ñ °(€€€¥¹ÍÑ…¹•A…Ñ °(€€€Á…É…µÌèì‘ÕÁ±¥…Ñ•%Ñ•µÌô(€ô¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½Í¡•µ„¹µ©Ì)™Õ¹Ñ¥½¸¡•­M¡•µ…AÕÍ¡MÑ…¬¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸½¹Ñ•áÐ¹AÕÍ  ¤€˜˜¡•­M¡•µ„¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤€˜˜½¹Ñ•áÐ¹A½À ¤ì)ô)™Õ¹Ñ¥½¸¡•­M¡•µ„¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€ÍÑ…¬¹AÕÍ ¡Í¡•µ„¤ì(€½¹ÍÐÉ•ÍÕ±Ð€ô%ÍM¡•µ…	½½±•…¸¡Í¡•µ„¤€ü¡•­M¡•µ…	½½±•…¸¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤€è€ …%ÍQåÁ”¡Í¡•µ„¤ñð¡•­QåÁ”¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ „¡Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ð¡Ù…±Õ”¤€˜˜€…Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Ù…±Õ”¤¤ñð€ …%ÍI•ÅÕ¥É•¡Í¡•µ„¤ñð¡•­I•ÅÕ¥É•¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%Í‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì¡Í¡•µ„¤ñð¡•­‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%Í•Á•¹‘•¹¥•Ì¡Í¡•µ„¤ñð¡•­•Á•¹‘•¹¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%Í•Á•¹‘•¹ÑI•ÅÕ¥É•¡Í¡•µ„¤ñð¡•­•Á•¹‘•¹ÑI•ÅÕ¥É•¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%Í•Á•¹‘•¹ÑM¡•µ…Ì¡Í¡•µ„¤ñð¡•­•Á•¹‘•¹ÑM¡•µ…Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%ÍA…ÑÑ•É¹AÉ½Á•ÉÑ¥•Ì¡Í¡•µ„¤ñð¡•­A…ÑÑ•É¹AÉ½Á•ÉÑ¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%ÍAÉ½Á•ÉÑ¥•Ì¡Í¡•µ„¤ñð¡•­AÉ½Á•ÉÑ¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%ÍAÉ½Á•ÉÑå9…µ•Ì¡Í¡•µ„¤ñð¡•­AÉ½Á•ÉÑå9…µ•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%Í5¥¹AÉ½Á•ÉÑ¥•Ì¡Í¡•µ„¤ñð¡•­5¥¹AÉ½Á•ÉÑ¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%Í5…áAÉ½Á•ÉÑ¥•Ì¡Í¡•µ„¤ñð¡•­5…áAÉ½Á•ÉÑ¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤¤€˜˜€ …Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Ù…±Õ”¤ñð€ …%Í‘‘¥Ñ¥½¹…±%Ñ•µÌ¡Í¡•µ„¤ñð¡•­‘‘¥Ñ¥½¹…±%Ñ•µÌ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%Í½¹Ñ…¥¹Ì¡Í¡•µ„¤ñð¡•­½¹Ñ…¥¹Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%Í%Ñ•µÌ¡Í¡•µ„¤ñð¡•­%Ñ•µÌ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%Í5…á½¹Ñ…¥¹Ì¡Í¡•µ„¤ñð¡•­5…á½¹Ñ…¥¹Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%Í5…á%Ñ•µÌ¡Í¡•µ„¤ñð¡•­5…á%Ñ•µÌ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%Í5¥¹½¹Ñ…¥¹Ì¡Í¡•µ„¤ñð¡•­5¥¹½¹Ñ…¥¹Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%Í5¥¹%Ñ•µÌ¡Í¡•µ„¤ñð¡•­5¥¹%Ñ•µÌ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%ÍAÉ•™¥á%Ñ•µÌ¡Í¡•µ„¤ñð¡•­AÉ•™¥á%Ñ•µÌ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%ÍU¹¥ÅÕ•%Ñ•µÌ¡Í¡•µ„¤ñð¡•­U¹¥ÅÕ•%Ñ•µÌ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤¤€˜˜€ …Õ…É‘}•áÁ½ÉÑÌ¹%ÍMÑÉ¥¹œ¡Ù…±Õ”¤ñð€ …%Í5…á1•¹Ñ Ì¡Í¡•µ„¤ñð¡•­5…á1•¹Ñ ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%Í5¥¹1•¹Ñ Ì¡Í¡•µ„¤ñð¡•­5¥¹1•¹Ñ ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%Í½Éµ…Ð¡Í¡•µ„¤ñð¡•­½Éµ…Ð¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%ÍA…ÑÑ•É¸¡Í¡•µ„¤ñð¡•­A…ÑÑ•É¸¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤¤€˜˜€ „¡Õ…É‘}•áÁ½ÉÑÌ¹%Í9Õµ‰•È¡Ù…±Õ”¤ñðÕ…É‘}•áÁ½ÉÑÌ¹%Í	¥%¹Ð¡Ù…±Õ”¤¤ñð€ …%Íá±ÕÍ¥Ù•5…á¥µÕ´¡Í¡•µ„¤ñð¡•­á±ÕÍ¥Ù•5…á¥µÕ´¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%Íá±ÕÍ¥Ù•5¥¹¥µÕ´¡Í¡•µ„¤ñð¡•­á±ÕÍ¥Ù•5¥¹¥µÕ´¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%Í5…á¥µÕ´¡Í¡•µ„¤ñð¡•­5…á¥µÕ´¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%Í5¥¹¥µÕ´¡Í¡•µ„¤ñð¡•­5¥¹¥µÕ´¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%Í5Õ±Ñ¥Á±•=˜È¡Í¡•µ„¤ñð¡•­5Õ±Ñ¥Á±•=˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤¤€˜˜€ …%ÍI•˜È¡Í¡•µ„¤ñð¡•­I•˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%ÍI•ÕÉÍ¥Ù•I•˜¡Í¡•µ„¤ñð¡•­I•ÕÉÍ¥Ù•I•˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%Íå¹…µ¥I•˜¡Í¡•µ„¤ñð¡•­å¹…µ¥I•˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%Í½¹ÍÐ¡Í¡•µ„¤ñð¡•­½¹ÍÐ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%Í¹Õ´È¡Í¡•µ„¤ñð¡•­¹Õ´¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%Í%˜¡Í¡•µ„¤ñð¡•­%˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%Í9½Ð¡Í¡•µ„¤ñð¡•­9½Ð¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%Í±±=˜¡Í¡•µ„¤ñð¡•­±±=˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%Í¹å=˜¡Í¡•µ„¤ñð¡•­¹å=˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%Í=¹•=˜¡Í¡•µ„¤ñð¡•­=¹•=˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤€˜˜€ …%ÍU¹•Ù…±Õ…Ñ•‘%Ñ•µÌ¡Í¡•µ„¤ñð€ …Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Ù…±Õ”¤ñð¡•­U¹•Ù…±Õ…Ñ•‘%Ñ•µÌ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤¤€˜˜€ …%ÍU¹•Ù…±Õ…Ñ•‘AÉ½Á•ÉÑ¥•Ì¡Í¡•µ„¤ñð€ …Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ð¡Ù…±Õ”¤ñð¡•­U¹•Ù…±Õ…Ñ•‘AÉ½Á•ÉÑ¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤¤€˜˜€ …%ÍI•™¥¹”È¡Í¡•µ„¤ñð¡•­I•™¥¹”¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤ì(€ÍÑ…¬¹A½À¡Í¡•µ„¤ì(€É•ÑÕÉ¸É•ÍÕ±Ðì)ô)™Õ¹Ñ¥½¸ÉÉ½ÉM¡•µ…AÕÍ¡MÑ…¬¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸½¹Ñ•áÐ¹AÕÍ  ¤€˜˜ÉÉ½ÉM¡•µ„¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤€˜˜½¹Ñ•áÐ¹A½À ¤ì)ô)™Õ¹Ñ¥½¸ÉÉ½ÉM¡•µ„¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤ì(€ÍÑ…¬¹AÕÍ ¡Í¡•µ„¤ì(€½¹ÍÐÉ•ÍÕ±Ð€ô%ÍM¡•µ…	½½±•…¸¡Í¡•µ„¤€üÉÉ½ÉM¡•µ…	½½±•…¸¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤€è€„„ ¬ …%ÍQåÁ”¡Í¡•µ„¤ñðÉÉ½ÉQåÁ”¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ „¡Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ð¡Ù…±Õ”¤€˜˜€…Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Ù…±Õ”¤¤ñð€„„ ¬ …%ÍI•ÅÕ¥É•¡Í¡•µ„¤ñðÉÉ½ÉI•ÅÕ¥É•¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%Í‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì¡Í¡•µ„¤ñðÉÉ½É‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%Í•Á•¹‘•¹¥•Ì¡Í¡•µ„¤ñðÉÉ½É•Á•¹‘•¹¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%Í•Á•¹‘•¹ÑI•ÅÕ¥É•¡Í¡•µ„¤ñðÉÉ½É•Á•¹‘•¹ÑI•ÅÕ¥É•¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%Í•Á•¹‘•¹ÑM¡•µ…Ì¡Í¡•µ„¤ñðÉÉ½É•Á•¹‘•¹ÑM¡•µ…Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%ÍA…ÑÑ•É¹AÉ½Á•ÉÑ¥•Ì¡Í¡•µ„¤ñðÉÉ½ÉA…ÑÑ•É¹AÉ½Á•ÉÑ¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%ÍAÉ½Á•ÉÑ¥•Ì¡Í¡•µ„¤ñðÉÉ½ÉAÉ½Á•ÉÑ¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%ÍAÉ½Á•ÉÑå9…µ•Ì¡Í¡•µ„¤ñðÉÉ½ÉAÉ½Á•ÉÑå9…µ•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%Í5¥¹AÉ½Á•ÉÑ¥•Ì¡Í¡•µ„¤ñðÉÉ½É5¥¹AÉ½Á•ÉÑ¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%Í5…áAÉ½Á•ÉÑ¥•Ì¡Í¡•µ„¤ñðÉÉ½É5…áAÉ½Á•ÉÑ¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤¤¤€˜€¬ …Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Ù…±Õ”¤ñð€„„ ¬ …%Í‘‘¥Ñ¥½¹…±%Ñ•µÌ¡Í¡•µ„¤ñðÉÉ½É‘‘¥Ñ¥½¹…±%Ñ•µÌ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%Í½¹Ñ…¥¹Ì¡Í¡•µ„¤ñðÉÉ½É½¹Ñ…¥¹Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%Í%Ñ•µÌ¡Í¡•µ„¤ñðÉÉ½É%Ñ•µÌ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%Í5…á½¹Ñ…¥¹Ì¡Í¡•µ„¤ñðÉÉ½É5…á½¹Ñ…¥¹Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%Í5…á%Ñ•µÌ¡Í¡•µ„¤ñðÉÉ½É5…á%Ñ•µÌ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%Í5¥¹½¹Ñ…¥¹Ì¡Í¡•µ„¤ñðÉÉ½É5¥¹½¹Ñ…¥¹Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%Í5¥¹%Ñ•µÌ¡Í¡•µ„¤ñðÉÉ½É5¥¹%Ñ•µÌ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%ÍAÉ•™¥á%Ñ•µÌ¡Í¡•µ„¤ñðÉÉ½ÉAÉ•™¥á%Ñ•µÌ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%ÍU¹¥ÅÕ•%Ñ•µÌ¡Í¡•µ„¤ñðÉÉ½ÉU¹¥ÅÕ•%Ñ•µÌ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤¤¤€˜€¬ …Õ…É‘}•áÁ½ÉÑÌ¹%ÍMÑÉ¥¹œ¡Ù…±Õ”¤ñð€„„ ¬ …%Í5…á1•¹Ñ Ì¡Í¡•µ„¤ñðÉÉ½É5…á1•¹Ñ ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%Í5¥¹1•¹Ñ Ì¡Í¡•µ„¤ñðÉÉ½É5¥¹1•¹Ñ ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%Í½Éµ…Ð¡Í¡•µ„¤ñðÉÉ½É½Éµ…Ð¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%ÍA…ÑÑ•É¸¡Í¡•µ„¤ñðÉÉ½ÉA…ÑÑ•É¸¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤¤¤€˜€¬ „¡Õ…É‘}•áÁ½ÉÑÌ¹%Í9Õµ‰•È¡Ù…±Õ”¤ñðÕ…É‘}•áÁ½ÉÑÌ¹%Í	¥%¹Ð¡Ù…±Õ”¤¤ñð€„„ ¬ …%Íá±ÕÍ¥Ù•5…á¥µÕ´¡Í¡•µ„¤ñðÉÉ½Éá±ÕÍ¥Ù•5…á¥µÕ´¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%Íá±ÕÍ¥Ù•5¥¹¥µÕ´¡Í¡•µ„¤ñðÉÉ½Éá±ÕÍ¥Ù•5¥¹¥µÕ´¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%Í5…á¥µÕ´¡Í¡•µ„¤ñðÉÉ½É5…á¥µÕ´¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%Í5¥¹¥µÕ´¡Í¡•µ„¤ñðÉÉ½É5¥¹¥µÕ´¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%Í5Õ±Ñ¥Á±•=˜È¡Í¡•µ„¤ñðÉÉ½É5Õ±Ñ¥Á±•=˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤¤¤€˜€¬ …%ÍI•˜È¡Í¡•µ„¤ñðÉÉ½ÉI•˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%ÍI•ÕÉÍ¥Ù•I•˜¡Í¡•µ„¤ñðÉÉ½ÉI•ÕÉÍ¥Ù•I•˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%Íå¹…µ¥I•˜¡Í¡•µ„¤ñðÉÉ½Éå¹…µ¥I•˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%Í½¹ÍÐ¡Í¡•µ„¤ñðÉÉ½É½¹ÍÐ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%Í¹Õ´È¡Í¡•µ„¤ñðÉÉ½É¹Õ´¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%Í%˜¡Í¡•µ„¤ñðÉÉ½É%˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%Í9½Ð¡Í¡•µ„¤ñðÉÉ½É9½Ð¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%Í±±=˜¡Í¡•µ„¤ñðÉÉ½É±±=˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%Í¹å=˜¡Í¡•µ„¤ñðÉÉ½É¹å=˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%Í=¹•=˜¡Í¡•µ„¤ñðÉÉ½É=¹•=˜¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤€˜€¬ …%ÍU¹•Ù…±Õ…Ñ•‘%Ñ•µÌ¡Í¡•µ„¤ñð€ …Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Ù…±Õ”¤ñðÉÉ½ÉU¹•Ù…±Õ…Ñ•‘%Ñ•µÌ¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤¤€˜€¬ …%ÍU¹•Ù…±Õ…Ñ•‘AÉ½Á•ÉÑ¥•Ì¡Í¡•µ„¤ñð€ …Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ð¡Ù…±Õ”¤ñðÉÉ½ÉU¹•Ù…±Õ…Ñ•‘AÉ½Á•ÉÑ¥•Ì¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤¤¤€˜˜€ …%ÍI•™¥¹”È¡Í¡•µ„¤ñðÉÉ½ÉI•™¥¹”¡ÍÑ…¬°½¹Ñ•áÐ°Í¡•µ…A…Ñ °¥¹ÍÑ…¹•A…Ñ °Í¡•µ„°Ù…±Õ”¤¤ì(€ÍÑ…¬¹A½À¡Í¡•µ„¤ì(€É•ÑÕÉ¸É•ÍÕ±Ðì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½É•Í½±Ù”½É•Í½±Ù”¹µ©Ì)Ù…ÈÉ•Í½±Ù•}•áÁ½ÉÑÌ€ôíôì)}}•áÁ½ÉÐ¡É•Í½±Ù•}•áÁ½ÉÑÌ°ì(€å¹…µ¥I•˜è€ ¤€ôøå¹…µ¥I•˜°(€I•˜è€ ¤€ôøI•˜È)ô¤ì((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½Á½¥¹Ñ•È½Á½¥¹Ñ•È¹µ©Ì)Ù…ÈÁ½¥¹Ñ•É}•áÁ½ÉÑÌ€ôíôì)}}•áÁ½ÉÐ¡Á½¥¹Ñ•É}•áÁ½ÉÑÌ°ì(€•±•Ñ”è€ ¤€ôø•±•Ñ”°(€•Ðè€ ¤€ôø•ÐÐ°(€!…Ìè€ ¤€ôø!…ÌÈ°(€%¹‘¥•Ìè€ ¤€ôø%¹‘¥•Ì°(€M•Ðè€ ¤€ôøM•ÐÐ)ô¤ì)™Õ¹Ñ¥½¸ÍÍ•ÉÑ9½ÑI½½Ð¡¥¹‘¥•Ì¤ì(€¥˜€¡¥¹‘¥•Ì¹±•¹Ñ €ôôô€À¤(€€€Ñ¡É½ÜÉÉ½È ‰…¹¹½ÐÍ•ÐÉ½½Ðˆ¤ì)ô)™Õ¹Ñ¥½¸ÍÍ•ÉÑ…¹M•Ð¡Ù…±Õ”¤ì(€¥˜€ …Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ð¡Ù…±Õ”¤¤(€€€Ñ¡É½ÜÉÉ½È ‰…¹¹½ÐÍ•ÐÙ…±Õ”ˆ¤ì)ô)™Õ¹Ñ¥½¸ÍÍ•ÉÑ%¹‘•à¡¥¹‘•à¤ì(€¥˜€¡Õ…É‘}•áÁ½ÉÑÌ¹%ÍU¹Í…™•AÉ½Á•ÉÑå-•ä¡¥¹‘•à¤¤(€€€Ñ¡É½ÜÉÉ½È ‰A½¥¹Ñ•È½¹Ñ…¥¹ÌÕ¹Í…™”ÁÉ½Á•ÉÑä­•äˆ¤ì)ô)™Õ¹Ñ¥½¸ÍÍ•ÉÑ%¹‘¥•Ì¡¥¹‘¥•Ì¤ì(€™½È€¡½¹ÍÐ¥¹‘•à½˜¥¹‘¥•Ì¤(€€€ÍÍ•ÉÑ%¹‘•à¡¥¹‘•à¤ì)ô)™Õ¹Ñ¥½¸%Í9Õµ•É¥%¹‘•à¡¥¹‘•à¤ì(€É•ÑÕÉ¸€½x ÁñlÄ´åuq¨¤¼¹Ñ•ÍÐ¡¥¹‘•à¤ì)ô)™Õ¹Ñ¥½¸Q…­•%¹‘•áI¥¡Ð¡¥¹‘¥•Ì¤ì(€É•ÑÕÉ¸l(€€€¥¹‘¥•Ì¹Í±¥” À°¥¹‘¥•Ì¹±•¹Ñ €´€Ä¤°(€€€¥¹‘¥•Ì¹Í±¥”¡¥¹‘¥•Ì¹±•¹Ñ €´€Ä¥lÁt(€tì)ô)™Õ¹Ñ¥½¸!…Í%¹‘•à¡¥¹‘•à°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ð¡Ù…±Õ”¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Ù…±Õ”°¥¹‘•à¤ì)ô)™Õ¹Ñ¥½¸•Ñ%¹‘•à¡¥¹‘•à°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ð¡Ù…±Õ”¤€˜˜€…Õ…É‘}•áÁ½ÉÑÌ¹%ÍU¹Í…™•AÉ½Á•ÉÑå-•ä¡¥¹‘•à¤€üÙ…±Õ•m¥¹‘•át€èÙ½¥€Àì)ô)™Õ¹Ñ¥½¸•Ñ%¹‘¥•Ì¡¥¹‘¥•Ì°Ù…±Õ”¤ì(€É•ÑÕÉ¸¥¹‘¥•Ì¹É•‘Õ” ¡Ù…±Õ”È°¥¹‘•à¤€ôø•Ñ%¹‘•à¡¥¹‘•à°Ù…±Õ”È¤°Ù…±Õ”¤ì)ô)™Õ¹Ñ¥½¸%¹‘¥•Ì¡Á½¥¹Ñ•È¤ì(€¥˜€¡Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Á½¥¹Ñ•È¹±•¹Ñ °€À¤¤(€€€É•ÑÕÉ¸mtì(€½¹ÍÐ¥¹‘¥•Ì€ôÁ½¥¹Ñ•È¹ÍÁ±¥Ð ˆ¼ˆ¤¹µ…À ¡¥¹‘•à¤€ôø¥¹‘•à¹É•Á±…” ½øÄ½œ°€ˆ¼ˆ¤¹É•Á±…” ½øÀ½œ°€‰øˆ¤¤ì(€É•ÑÕÉ¸¥¹‘¥•Ì¹±•¹Ñ €ø€À€˜˜¥¹‘¥•ÍlÁt€ôôô€ˆˆ€ü¥¹‘¥•Ì¹Í±¥” Ä¤€è¥¹‘¥•Ìì)ô)™Õ¹Ñ¥½¸!…ÌÈ¡Ù…±Õ”°Á½¥¹Ñ•È¤ì(€±•ÐÕÉÉ•¹Ð€ôÙ…±Õ”ì(€É•ÑÕÉ¸%¹‘¥•Ì¡Á½¥¹Ñ•È¤¹•Ù•Éä ¡¥¹‘•à¤€ôøì(€€€¥˜€ …!…Í%¹‘•à¡¥¹‘•à°ÕÉÉ•¹Ð¤¤(€€€€€É•ÑÕÉ¸™…±Í”ì(€€€ÕÉÉ•¹Ð€ôÕÉÉ•¹Ñm¥¹‘•átì(€€€É•ÑÕÉ¸ÑÉÕ”ì(€ô¤ì)ô)™Õ¹Ñ¥½¸•ÐÐ¡Ù…±Õ”°Á½¥¹Ñ•È¤ì(€½¹ÍÐ¥¹‘¥•Ì€ô%¹‘¥•Ì¡Á½¥¹Ñ•È¤ì(€É•ÑÕÉ¸•Ñ%¹‘¥•Ì¡¥¹‘¥•Ì°Ù…±Õ”¤ì)ô)™Õ¹Ñ¥½¸M•ÐÐ¡Ù…±Õ”°Á½¥¹Ñ•È°¹•áÐ¤ì(€½¹ÍÐ¥¹‘¥•Ì€ô%¹‘¥•Ì¡Á½¥¹Ñ•È¤ì(€ÍÍ•ÉÑ9½ÑI½½Ð¡¥¹‘¥•Ì¤ì(€ÍÍ•ÉÑ%¹‘¥•Ì¡¥¹‘¥•Ì¤ì(€½¹ÍÐm¡•…°¥¹‘•át€ôQ…­•%¹‘•áI¥¡Ð¡¥¹‘¥•Ì¤ì(€½¹ÍÐÁ…É•¹Ð€ô•Ñ%¹‘¥•Ì¡¡•…°Ù…±Õ”¤ì(€ÍÍ•ÉÑ…¹M•Ð¡Á…É•¹Ð¤ì(€Á…É•¹Ñm¥¹‘•át€ô¹•áÐì(€É•ÑÕÉ¸Ù…±Õ”ì)ô)™Õ¹Ñ¥½¸•±•Ñ”¡Ù…±Õ”°Á½¥¹Ñ•È¤ì(€½¹ÍÐ¥¹‘¥•Ì€ô%¹‘¥•Ì¡Á½¥¹Ñ•È¤ì(€ÍÍ•ÉÑ9½ÑI½½Ð¡¥¹‘¥•Ì¤ì(€ÍÍ•ÉÑ%¹‘¥•Ì¡¥¹‘¥•Ì¤ì(€½¹ÍÐm¡•…°¥¹‘•át€ôQ…­•%¹‘•áI¥¡Ð¡¥¹‘¥•Ì¤ì(€½¹ÍÐÁ…É•¹Ð€ô•Ñ%¹‘¥•Ì¡¡•…°Ù…±Õ”¤ì(€ÍÍ•ÉÑ…¹M•Ð¡Á…É•¹Ð¤ì(€¥˜€¡Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Á…É•¹Ð¤€˜˜%Í9Õµ•É¥%¹‘•à¡¥¹‘•à¤¤ì(€€€Á…É•¹Ð¹ÍÁ±¥” ­¥¹‘•à°€Ä¤ì(€ô•±Í”ì(€€€‘•±•Ñ”Á…É•¹Ñm¥¹‘•átì(€ô(€É•ÑÕÉ¸Ù…±Õ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½É•Í½±Ù”½É•˜¹µ©Ì)™Õ¹Ñ¥½¸5…Ñ¡%¡Í¡•µ„°‰…Í”°É•˜¤ì(€¥˜€¡Í¡•µ„¸‘¥€ôôôÉ•˜¹¡…Í ¤(€€€É•ÑÕÉ¸Í¡•µ„ì(€½¹ÍÐ…‰Í½±ÕÑ•%€ô¹•ÜUI0¡Í¡•µ„¸‘¥°‰…Í”¹¡É•˜¤ì(€½¹ÍÐ…‰Í½±ÕÑ•I•˜€ô¹•ÜUI0¡É•˜¹¡É•˜°‰…Í”¹¡É•˜¤ì(€¥˜€¡Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡…‰Í½±ÕÑ•%¹Á…Ñ¡¹…µ”°…‰Í½±ÕÑ•I•˜¹Á…Ñ¡¹…µ”¤¤ì(€€€É•ÑÕÉ¸É•˜¹¡…Í ¹ÍÑ…ÉÑÍ]¥Ñ  ˆŒˆ¤€ü5…Ñ¡!…Í ¡Í¡•µ„°‰…Í”°É•˜¤€èÍ¡•µ„ì(€ô(€É•ÑÕÉ¸Ù½¥€Àì)ô)™Õ¹Ñ¥½¸5…Ñ¡¹¡½È¡Í¡•µ„°‰…Í”°É•˜¤ì(€½¹ÍÐ…‰Í½±ÕÑ•¹¡½È€ô¹•ÜUI0¡€Œ‘íÍ¡•µ„¸‘…¹¡½Éõ€°‰…Í”¹¡É•˜¤ì(€½¹ÍÐ…‰Í½±ÕÑ•I•˜€ô¹•ÜUI0¡É•˜¹¡É•˜°‰…Í”¹¡É•˜¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡…‰Í½±ÕÑ•¹¡½È¹¡É•˜°…‰Í½±ÕÑ•I•˜¹¡É•˜¤€üÍ¡•µ„€èÙ½¥€Àì)ô)™Õ¹Ñ¥½¸5…Ñ¡å¹…µ¥¹¡½È¡Í¡•µ„°‰…Í”°É•˜¤ì(€½¹ÍÐ…‰Í½±ÕÑ•¹¡½È€ô¹•ÜUI0¡€Œ‘íÍ¡•µ„¸‘‘å¹…µ¥¹¡½Éõ€°‰…Í”¹¡É•˜¤ì(€½¹ÍÐ…‰Í½±ÕÑ•I•˜€ô¹•ÜUI0¡É•˜¹¡É•˜°‰…Í”¹¡É•˜¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡…‰Í½±ÕÑ•¹¡½È¹¡É•˜°…‰Í½±ÕÑ•I•˜¹¡É•˜¤€üÍ¡•µ„€èÙ½¥€Àì)ô)™Õ¹Ñ¥½¸5…Ñ¡!…Í ¡Í¡•µ„°}‰…Í”°É•˜¤ì(€¥˜€¡É•˜¹¡É•˜¹•¹‘Í]¥Ñ  ˆŒˆ¤¤(€€€É•ÑÕÉ¸Í¡•µ„ì(€¥˜€ …É•˜¹¡…Í ¹ÍÑ…ÉÑÍ]¥Ñ  ˆŒˆ¤¤(€€€É•ÑÕÉ¸Ù½¥€Àì(€½¹ÍÐ™É…µ•¹Ð€ô‘•½‘•UI%½µÁ½¹•¹Ð¡É•˜¹¡…Í ¹Í±¥” Ä¤¤ì(€¥˜€ …™É…µ•¹Ð¹ÍÑ…ÉÑÍ]¥Ñ  ˆ¼ˆ¤¤(€€€É•ÑÕÉ¸Ù½¥€Àì(€É•ÑÕÉ¸Á½¥¹Ñ•É}•áÁ½ÉÑÌ¹•Ð¡Í¡•µ„°™É…µ•¹Ð¤ì)ô)™Õ¹Ñ¥½¸5…Ñ Ð¡Í¡•µ„°‰…Í”°É•˜¤ì(€¥˜€¡%Í%¡Í¡•µ„¤¤ì(€€€½¹ÍÐÉ•ÍÕ±Ð€ô5…Ñ¡%¡Í¡•µ„°‰…Í”°É•˜¤ì(€€€¥˜€ …Õ…É‘}•áÁ½ÉÑÌ¹%ÍU¹‘•™¥¹•¡É•ÍÕ±Ð¤¤(€€€€€É•ÑÕÉ¸É•ÍÕ±Ðì(€ô(€¥˜€¡%Í¹¡½È¡Í¡•µ„¤¤ì(€€€½¹ÍÐÉ•ÍÕ±Ð€ô5…Ñ¡¹¡½È¡Í¡•µ„°‰…Í”°É•˜¤ì(€€€¥˜€ …Õ…É‘}•áÁ½ÉÑÌ¹%ÍU¹‘•™¥¹•¡É•ÍÕ±Ð¤¤(€€€€€É•ÑÕÉ¸É•ÍÕ±Ðì(€ô(€¥˜€¡%Íå¹…µ¥¹¡½È¡Í¡•µ„¤¤ì(€€€½¹ÍÐÉ•ÍÕ±Ð€ô5…Ñ¡å¹…µ¥¹¡½È¡Í¡•µ„°‰…Í”°É•˜¤ì(€€€¥˜€ …Õ…É‘}•áÁ½ÉÑÌ¹%ÍU¹‘•™¥¹•¡É•ÍÕ±Ð¤¤(€€€€€É•ÑÕÉ¸É•ÍÕ±Ðì(€ô(€É•ÑÕÉ¸5…Ñ¡!…Í ¡Í¡•µ„°‰…Í”°É•˜¤ì)ô)™Õ¹Ñ¥½¸É½µÉÉ…äØ¡Í¡•µ„°‰…Í”°É•˜¤ì(€É•ÑÕÉ¸Í¡•µ„¹É•‘Õ” ¡É•ÍÕ±Ð°¥Ñ•´¤€ôøì(€€€½¹ÍÐµ…Ñ €ôÉ½µY…±Õ”Ì¡¥Ñ•´°‰…Í”°É•˜¤ì(€€€É•ÑÕÉ¸€…Õ…É‘}•áÁ½ÉÑÌ¹%ÍU¹‘•™¥¹•¡µ…Ñ ¤€üµ…Ñ €èÉ•ÍÕ±Ðì(€ô°Ù½¥€À¤ì)ô)™Õ¹Ñ¥½¸É½µ=‰©•ÐÄÀ¡Í¡•µ„°‰…Í”°É•˜¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡Í¡•µ„¤¹É•‘Õ” ¡É•ÍÕ±Ð°­•ä¤€ôøì(€€€½¹ÍÐµ…Ñ €ôÉ½µY…±Õ”Ì¡Í¡•µ…m­•åt°‰…Í”°É•˜¤ì(€€€É•ÑÕÉ¸€…Õ…É‘}•áÁ½ÉÑÌ¹%ÍU¹‘•™¥¹•¡µ…Ñ ¤€üµ…Ñ €èÉ•ÍÕ±Ðì(€ô°Ù½¥€À¤ì)ô)™Õ¹Ñ¥½¸É½µY…±Õ”Ì¡Í¡•µ„°‰…Í”°É•˜¤ì(€½¹ÍÐ¹•áÑ	…Í”€ô%ÍM¡•µ…=‰©•Ð¡Í¡•µ„¤€˜˜%Í%¡Í¡•µ„¤€ü¹•ÜUI0¡Í¡•µ„¸‘¥°‰…Í”¹¡É•˜¤€è‰…Í”ì(€¥˜€¡%ÍM¡•µ…=‰©•Ð¡Í¡•µ„¤¤ì(€€€½¹ÍÐÉ•ÍÕ±Ð€ô5…Ñ Ð¡Í¡•µ„°¹•áÑ	…Í”°É•˜¤ì(€€€¥˜€ …Õ…É‘}•áÁ½ÉÑÌ¹%ÍU¹‘•™¥¹•¡É•ÍÕ±Ð¤¤(€€€€€É•ÑÕÉ¸É•ÍÕ±Ðì(€ô(€¥˜€¡Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Í¡•µ„¤¤(€€€É•ÑÕÉ¸É½µÉÉ…äØ¡Í¡•µ„°¹•áÑ	…Í”°É•˜¤ì(€¥˜€¡Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ð¡Í¡•µ„¤¤(€€€É•ÑÕÉ¸É½µ=‰©•ÐÄÀ¡Í¡•µ„°¹•áÑ	…Í”°É•˜¤ì(€É•ÑÕÉ¸Ù½¥€Àì)ô)™Õ¹Ñ¥½¸I•˜È¡Í¡•µ„°É•˜¤ì(€½¹ÍÐ‘•™…Õ±Ñ	…Í”€ô¹•ÜUI0 ‰¡ÑÑÀè¼½Õ¹­¹½Ý¸¼ˆ¤ì(€½¹ÍÐ¥¹¥Ñ¥…±	…Í”€ô%Í%¡Í¡•µ„¤€ü¹•ÜUI0¡Í¡•µ„¸‘¥°‘•™…Õ±Ñ	…Í”¹¡É•˜¤€è‘•™…Õ±Ñ	…Í”ì(€½¹ÍÐ¥¹¥Ñ¥…±I•˜€ô¹•ÜUI0¡É•˜°¥¹¥Ñ¥…±	…Í”¹¡É•˜¤ì(€É•ÑÕÉ¸É½µY…±Õ”Ì¡Í¡•µ„°¥¹¥Ñ¥…±	…Í”°¥¹¥Ñ¥…±I•˜¤ì)ô)™Õ¹Ñ¥½¸å¹…µ¥I•˜¡É½½Ð°‰…Í”°‘å¹…µ¥I•˜°‘å¹…µ¥¹¡½ÉÌ¤ì(€½¹ÍÐ™É…µ•¹ÑQ…É•Ð€ô‘å¹…µ¥I•˜¸‘‘å¹…µ¥I•˜¹ÍÑ…ÉÑÍ]¥Ñ  ˆŒˆ¤€üI•˜È¡‰…Í”°‘å¹…µ¥I•˜¸‘‘å¹…µ¥I•˜¤€èI•˜È¡É½½Ð°‘å¹…µ¥I•˜¸‘‘å¹…µ¥I•˜¤ì(€¥˜€¡Õ…É‘}•áÁ½ÉÑÌ¹%ÍU¹‘•™¥¹•¡™É…µ•¹ÑQ…É•Ð¤¤(€€€É•ÑÕÉ¸Ù½¥€Àì(€¥˜€ …%ÍM¡•µ…=‰©•Ð¡™É…µ•¹ÑQ…É•Ð¤ñð€…%Íå¹…µ¥¹¡½È¡™É…µ•¹ÑQ…É•Ð¤¤(€€€É•ÑÕÉ¸™É…µ•¹ÑQ…É•Ðì(€½¹ÍÐ™É…µ•¹Ð€ô¹•ÜUI0¡‘å¹…µ¥I•˜¸‘‘å¹…µ¥I•˜°€‰¡ÑÑÀè¼½Õ¹­¹½Ý¸¼ˆ¤¹¡…Í ì(€¥˜€¡™É…µ•¹Ð¹ÍÑ…ÉÑÍ]¥Ñ  ˆŒ¼ˆ¤¤(€€€É•ÑÕÉ¸™É…µ•¹ÑQ…É•Ðì(€½¹ÍÐ…¹¡½ÉQ…É•Ð€ô‘å¹…µ¥¹¡½ÉÌ¹™¥¹ ¡…¹¡½È¤€ôø…¹¡½È¸‘‘å¹…µ¥¹¡½È€ôôô™É…µ•¹ÑQ…É•Ð¸‘‘å¹…µ¥¹¡½È¤ì(€É•ÑÕÉ¸…¹¡½ÉQ…É•Ð€üü™É…µ•¹ÑQ…É•Ðì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•¹¥¹”½}ÍÑ…¬¹µ©Ì)Ù…È}}±…ÍÍAÉ¥Ù…Ñ•¥•±‘•Ð€ô™Õ¹Ñ¥½¸¡É••¥Ù•È°ÍÑ…Ñ”Ì°­¥¹°˜¤ì(€¥˜€¡­¥¹€ôôô€‰„ˆ€˜˜€…˜¤Ñ¡É½Ü¹•ÜQåÁ•ÉÉ½È ‰AÉ¥Ù…Ñ”…•ÍÍ½ÈÝ…Ì‘•™¥¹•Ý¥Ñ¡½ÕÐ„•ÑÑ•Èˆ¤ì(€¥˜€¡ÑåÁ•½˜ÍÑ…Ñ”Ì€ôôô€‰™Õ¹Ñ¥½¸ˆ€üÉ••¥Ù•È€„ôôÍÑ…Ñ”Ìñð€…˜€è€…ÍÑ…Ñ”Ì¹¡…Ì¡É••¥Ù•È¤¤Ñ¡É½Ü¹•ÜQåÁ•ÉÉ½È ‰…¹¹½ÐÉ•…ÁÉ¥Ù…Ñ”µ•µ‰•È™É½´…¸½‰©•ÐÝ¡½Í”±…ÍÌ‘¥¹½Ð‘•±…É”¥Ðˆ¤ì(€É•ÑÕÉ¸­¥¹€ôôô€‰´ˆ€ü˜€è­¥¹€ôôô€‰„ˆ€ü˜¹…±°¡É••¥Ù•È¤€è˜€ü˜¹Ù…±Õ”€èÍÑ…Ñ”Ì¹•Ð¡É••¥Ù•È¤ì)ôì)Ù…È}MÑ…­}¥¹ÍÑ…¹•Ìì)Ù…È}MÑ…­}AÕÍ¡I•Í½ÕÉ•¹¡½ÉÌì)Ù…È}MÑ…­}A½ÁI•Í½ÕÉ•¹¡½ÉÌì)Ù…È}MÑ…­}É½µ½¹Ñ•áÐì)Ù…È}MÑ…­}É½µI•˜ì)Ù…ÈMÑ…¬€ô±…ÍÌì(€½¹ÍÑÉÕÑ½È¡½¹Ñ•áÐ°Í¡•µ„¤ì(€€€}MÑ…­}¥¹ÍÑ…¹•Ì¹…‘¡Ñ¡¥Ì¤ì(€€€Ñ¡¥Ì¹½¹Ñ•áÐ€ô½¹Ñ•áÐì(€€€Ñ¡¥Ì¹Í¡•µ„€ôÍ¡•µ„ì(€€€Ñ¡¥Ì¹¥‘Ì€ômtì(€€€Ñ¡¥Ì¹…¹¡½ÉÌ€ômtì(€€€Ñ¡¥Ì¹É•ÕÉÍ¥Ù•¹¡½ÉÌ€ômtì(€€€Ñ¡¥Ì¹‘å¹…µ¥¹¡½ÉÌ€ômtì(€ô(€€¼¼€´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´(€€¼¼	…Í”(€€¼¼€´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´(€	…Í•UI0 ¤ì(€€€É•ÑÕÉ¸Ñ¡¥Ì¹¥‘Ì¹É•‘Õ” ¡É•ÍÕ±Ð°Í¡•µ„¤€ôø¹•ÜUI0¡Í¡•µ„¸‘¥°É•ÍÕ±Ð¤°¹•ÜUI0 ‰¡ÑÑÀè¼½Õ¹­¹½Ý¸ˆ¤¤ì(€ô(€	…Í” ¤ì(€€€É•ÑÕÉ¸Ñ¡¥Ì¹¥‘ÍmÑ¡¥Ì¹¥‘Ì¹±•¹Ñ €´€Åt€üüÑ¡¥Ì¹Í¡•µ„ì(€ô(€€¼¼€´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´(€€¼¼MÑ…¬(€€¼¼€´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´(€AÕÍ ¡Í¡•µ„¤ì(€€€¥˜€ …%ÍM¡•µ…=‰©•Ð¡Í¡•µ„¤¤(€€€€€É•ÑÕÉ¸ì(€€€¥˜€¡%Í%¡Í¡•µ„¤¤ì(€€€€€Ñ¡¥Ì¹¥‘Ì¹ÁÕÍ ¡Í¡•µ„¤ì(€€€€€}}±…ÍÍAÉ¥Ù…Ñ•¥•±‘•Ð¡Ñ¡¥Ì°}MÑ…­}¥¹ÍÑ…¹•Ì°€‰´ˆ°}MÑ…­}AÕÍ¡I•Í½ÕÉ•¹¡½ÉÌ¤¹…±°¡Ñ¡¥Ì°Í¡•µ„¤ì(€€€ô(€€€¥˜€¡%Í¹¡½È¡Í¡•µ„¤¤(€€€€€Ñ¡¥Ì¹…¹¡½ÉÌ¹ÁÕÍ ¡Í¡•µ„¤ì(€€€¥˜€¡%ÍI•ÕÉÍ¥Ù•¹¡½ÉQÉÕ”¡Í¡•µ„¤¤(€€€€€Ñ¡¥Ì¹É•ÕÉÍ¥Ù•¹¡½ÉÌ¹ÁÕÍ ¡Í¡•µ„¤ì(€€€¥˜€¡%Íå¹…µ¥¹¡½È¡Í¡•µ„¤¤(€€€€€Ñ¡¥Ì¹‘å¹…µ¥¹¡½ÉÌ¹ÁÕÍ ¡Í¡•µ„¤ì(€ô(€A½À¡Í¡•µ„¤ì(€€€¥˜€ …%ÍM¡•µ…=‰©•Ð¡Í¡•µ„¤¤(€€€€€É•ÑÕÉ¸ì(€€€¥˜€¡%Í%¡Í¡•µ„¤¤ì(€€€€€Ñ¡¥Ì¹¥‘Ì¹Á½À ¤ì(€€€€€}}±…ÍÍAÉ¥Ù…Ñ•¥•±‘•Ð¡Ñ¡¥Ì°}MÑ…­}¥¹ÍÑ…¹•Ì°€‰´ˆ°}MÑ…­}A½ÁI•Í½ÕÉ•¹¡½ÉÌ¤¹…±°¡Ñ¡¥Ì°Í¡•µ„¤ì(€€€ô(€€€¥˜€¡%Í¹¡½È¡Í¡•µ„¤¤(€€€€€Ñ¡¥Ì¹…¹¡½ÉÌ¹Á½À ¤ì(€€€¥˜€¡%ÍI•ÕÉÍ¥Ù•¹¡½ÉQÉÕ”¡Í¡•µ„¤¤(€€€€€Ñ¡¥Ì¹É•ÕÉÍ¥Ù•¹¡½ÉÌ¹Á½À ¤ì(€€€¥˜€¡%Íå¹…µ¥¹¡½È¡Í¡•µ„¤¤(€€€€€Ñ¡¥Ì¹‘å¹…µ¥¹¡½ÉÌ¹Á½À ¤ì(€ô(€I•˜¡É•˜¤ì(€€€É•ÑÕÉ¸}}±…ÍÍAÉ¥Ù…Ñ•¥•±‘•Ð¡Ñ¡¥Ì°}MÑ…­}¥¹ÍÑ…¹•Ì°€‰´ˆ°}MÑ…­}É½µ½¹Ñ•áÐ¤¹…±°¡Ñ¡¥Ì°É•˜¤€üü}}±…ÍÍAÉ¥Ù…Ñ•¥•±‘•Ð¡Ñ¡¥Ì°}MÑ…­}¥¹ÍÑ…¹•Ì°€‰´ˆ°}MÑ…­}É½µI•˜¤¹…±°¡Ñ¡¥Ì°É•˜¤ì(€ô(€€¼¼€´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´(€€¼¼I•ÕÉÍ¥Ù•I•˜(€€¼¼€´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´(€I•ÕÉÍ¥Ù•I•˜¡É•ÕÉÍ¥Ù•I•˜¤ì(€€€É•ÑÕÉ¸%ÍI•ÕÉÍ¥Ù•¹¡½ÉQÉÕ”¡Ñ¡¥Ì¹	…Í” ¤¤€üÉ•Í½±Ù•}•áÁ½ÉÑÌ¹I•˜¡Ñ¡¥Ì¹É•ÕÉÍ¥Ù•¹¡½ÉÍlÁt°É•ÕÉÍ¥Ù•I•˜¸‘É•ÕÉÍ¥Ù•I•˜¤€èÉ•Í½±Ù•}•áÁ½ÉÑÌ¹I•˜¡Ñ¡¥Ì¹	…Í” ¤°É•ÕÉÍ¥Ù•I•˜¸‘É•ÕÉÍ¥Ù•I•˜¤ì(€ô(€€¼¼€´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´(€€¼¼å¹…µ¥I•˜(€€¼¼€´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´´(€å¹…µ¥I•˜¡‘å¹…µ¥I•˜¤ì(€€€½¹ÍÐÉ½½Ð€ôÑ¡¥Ì¹Í¡•µ„ì(€€€É•ÑÕÉ¸É•Í½±Ù•}•áÁ½ÉÑÌ¹å¹…µ¥I•˜¡É½½Ð°Ñ¡¥Ì¹	…Í” ¤°‘å¹…µ¥I•˜°Ñ¡¥Ì¹‘å¹…µ¥¹¡½ÉÌ¤ì(€ô)ôì)}MÑ…­}¥¹ÍÑ…¹•Ì€ô€¼¨}}AUI}|€¨¼¹•Ü]•…­M•Ð ¤°}MÑ…­}AÕÍ¡I•Í½ÕÉ•¹¡½ÉÌ€ô™Õ¹Ñ¥½¸}MÑ…­}AÕÍ¡I•Í½ÕÉ•¹¡½ÉÌÈ¡Í¡•µ„°¥ÍI½½Ð€ôÑÉÕ”¤ì(€¥˜€ …%ÍM¡•µ…=‰©•Ð¡Í¡•µ„¤¤(€€€É•ÑÕÉ¸ì(€½¹ÍÐÕÉÉ•¹Ð€ôÍ¡•µ„ì(€¥˜€ …¥ÍI½½Ð€˜˜%Í%¡ÕÉÉ•¹Ð¤¤(€€€É•ÑÕÉ¸ì(€¥˜€ …¥ÍI½½Ð€˜˜%Íå¹…µ¥¹¡½È¡ÕÉÉ•¹Ð¤¤(€€€Ñ¡¥Ì¹‘å¹…µ¥¹¡½ÉÌ¹ÁÕÍ ¡ÕÉÉ•¹Ð¤ì(€™½È€¡½¹ÍÐ­•ä½˜Õ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡ÕÉÉ•¹Ð¤¤(€€€}}±…ÍÍAÉ¥Ù…Ñ•¥•±‘•Ð¡Ñ¡¥Ì°}MÑ…­}¥¹ÍÑ…¹•Ì°€‰´ˆ°}MÑ…­}AÕÍ¡I•Í½ÕÉ•¹¡½ÉÌÈ¤¹…±°¡Ñ¡¥Ì°ÕÉÉ•¹Ñm­•åt°™…±Í”¤ì)ô°}MÑ…­}A½ÁI•Í½ÕÉ•¹¡½ÉÌ€ô™Õ¹Ñ¥½¸}MÑ…­}A½ÁI•Í½ÕÉ•¹¡½ÉÌÈ¡Í¡•µ„°¥ÍI½½Ð€ôÑÉÕ”¤ì(€¥˜€ …%ÍM¡•µ…=‰©•Ð¡Í¡•µ„¤¤(€€€É•ÑÕÉ¸ì(€½¹ÍÐÕÉÉ•¹Ð€ôÍ¡•µ„ì(€¥˜€ …¥ÍI½½Ð€˜˜%Í%¡ÕÉÉ•¹Ð¤¤(€€€É•ÑÕÉ¸ì(€¥˜€ …¥ÍI½½Ð€˜˜%Íå¹…µ¥¹¡½È¡ÕÉÉ•¹Ð¤¤(€€€Ñ¡¥Ì¹‘å¹…µ¥¹¡½ÉÌ¹Á½À ¤ì(€™½È€¡½¹ÍÐ­•ä½˜Õ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡ÕÉÉ•¹Ð¤¤(€€€}}±…ÍÍAÉ¥Ù…Ñ•¥•±‘•Ð¡Ñ¡¥Ì°}MÑ…­}¥¹ÍÑ…¹•Ì°€‰´ˆ°}MÑ…­}A½ÁI•Í½ÕÉ•¹¡½ÉÌÈ¤¹…±°¡Ñ¡¥Ì°ÕÉÉ•¹Ñm­•åt°™…±Í”¤ì)ô°}MÑ…­}É½µ½¹Ñ•áÐ€ô™Õ¹Ñ¥½¸}MÑ…­}É½µ½¹Ñ•áÐÈ¡É•˜¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Ñ¡¥Ì¹½¹Ñ•áÐ°É•˜¸‘É•˜¤€üÑ¡¥Ì¹½¹Ñ•áÑmÉ•˜¸‘É•™t€èÙ½¥€Àì)ô°}MÑ…­}É½µI•˜€ô™Õ¹Ñ¥½¸}MÑ…­}É½µI•˜È¡É•˜¤ì(€½¹ÍÐÉ½½Ð€ôÑ¡¥Ì¹Í¡•µ„ì(€É•ÑÕÉ¸€…É•˜¸‘É•˜¹ÍÑ…ÉÑÍ]¥Ñ  ˆŒˆ¤€üÉ•Í½±Ù•}•áÁ½ÉÑÌ¹I•˜¡É½½Ð°É•˜¸‘É•˜¤€èÉ•Í½±Ù•}•áÁ½ÉÑÌ¹I•˜¡Ñ¡¥Ì¹	…Í” ¤°É•˜¸‘É•˜¤ì)ôì((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½•ÉÉ½ÉÌ¹µ©Ì)™Õ¹Ñ¥½¸ÉÉ½ÉÌ ¸¸¹…ÉÌ¤ì(€½¹ÍÐm½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ•t€ô…ÉÕµ•¹ÑÍ}•áÁ½ÉÑÌ¹5…Ñ ¡…ÉÌ°ì(€€€€Ìè€¡½¹Ñ•áÐÈ°Í¡•µ„È°Ù…±Õ”È¤€ôøm½¹Ñ•áÐÈ°Í¡•µ„È°Ù…±Õ”Ét°(€€€€Èè€¡Í¡•µ„È°Ù…±Õ”È¤€ôømíô°Í¡•µ„È°Ù…±Õ”Ét(€ô¤ì(€½¹ÍÐÍ•ÑÑ¥¹ÌÈ€ôÍ•ÑÑ¥¹Í}•áÁ½ÉÑÌ¹•Ð ¤ì(€½¹ÍÐ±½…±”È€ô•ÐÈ ¤ì(€½¹ÍÐ•ÉÉ½ÉÌ€ômtì(€½¹ÍÐÍÑ…¬€ô¹•ÜMÑ…¬¡½¹Ñ•áÐ°Í¡•µ„¤ì(€½¹ÍÐ•ÉÉ½É½¹Ñ•áÐ€ô¹•ÜÉÉ½É½¹Ñ•áÐ ¡•ÉÉ½È¤€ôøì(€€€¥˜€¡Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉ•…Ñ•ÉÅÕ…±Q¡…¸¡•ÉÉ½ÉÌ¹±•¹Ñ °Í•ÑÑ¥¹ÌÈ¹µ…áÉÉ½ÉÌ¤¤(€€€€€É•ÑÕÉ¸ì(€€€É•ÑÕÉ¸•ÉÉ½ÉÌ¹ÁÕÍ ¡ì€¸¸¹•ÉÉ½È°µ•ÍÍ…”è±½…±”È¡•ÉÉ½È¤ô¤ì(€ô¤ì(€½¹ÍÐÉ•ÍÕ±Ð€ôÉÉ½ÉM¡•µ„¡ÍÑ…¬°•ÉÉ½É½¹Ñ•áÐ°€ˆŒˆ°€ˆˆ°Í¡•µ„°Ù…±Õ”¤ì(€É•ÑÕÉ¸mÉ•ÍÕ±Ð°•ÉÉ½ÉÍtì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Í¡•µ„½¡•¬¹µ©Ì)™Õ¹Ñ¥½¸¡•¬ ¸¸¹…ÉÌ¤ì(€½¹ÍÐm½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ•t€ô…ÉÕµ•¹ÑÍ}•áÁ½ÉÑÌ¹5…Ñ ¡…ÉÌ°ì(€€€€Ìè€¡½¹Ñ•áÐÈ°Í¡•µ„È°Ù…±Õ”È¤€ôøm½¹Ñ•áÐÈ°Í¡•µ„È°Ù…±Õ”Ét°(€€€€Èè€¡Í¡•µ„È°Ù…±Õ”È¤€ôømíô°Í¡•µ„È°Ù…±Õ”Ét(€ô¤ì(€½¹ÍÐÍÑ…¬€ô¹•ÜMÑ…¬¡½¹Ñ•áÐ°Í¡•µ„¤ì(€½¹ÍÐ¡•­½¹Ñ•áÐ€ô¹•Ü¡•­½¹Ñ•áÐ ¤ì(€É•ÑÕÉ¸¡•­M¡•µ„¡ÍÑ…¬°¡•­½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½¡•¬½¡•¬¹µ©Ì)™Õ¹Ñ¥½¸¡•¬È ¸¸¹…ÉÌ¤ì(€½¹ÍÐm½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ•t€ô…ÉÕµ•¹ÑÍ}•áÁ½ÉÑÌ¹5…Ñ ¡…ÉÌ°ì(€€€€Ìè€¡½¹Ñ•áÐÈ°ÑåÁ”È°Ù…±Õ”È¤€ôøm½¹Ñ•áÐÈ°ÑåÁ”È°Ù…±Õ”Ét°(€€€€Èè€¡ÑåÁ”È°Ù…±Õ”È¤€ôømíô°ÑåÁ”È°Ù…±Õ”Ét(€ô¤ì(€É•ÑÕÉ¸¡•¬¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½•ÉÉ½ÉÌ½•ÉÉ½ÉÌ¹µ©Ì)™Õ¹Ñ¥½¸ÉÉ½ÉÌÈ ¸¸¹…ÉÌ¤ì(€½¹ÍÐm½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ•t€ô…ÉÕµ•¹ÑÍ}•áÁ½ÉÑÌ¹5…Ñ ¡…ÉÌ°ì(€€€€Ìè€¡½¹Ñ•áÐÈ°ÑåÁ”È°Ù…±Õ”È¤€ôøm½¹Ñ•áÐÈ°ÑåÁ”È°Ù…±Õ”Ét°(€€€€Èè€¡ÑåÁ”È°Ù…±Õ”È¤€ôømíô°ÑåÁ”È°Ù…±Õ”Ét(€ô¤ì(€½¹ÍÐm|°•ÉÉ½ÉÍt€ôÉÉ½ÉÌ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€É•ÑÕÉ¸•ÉÉ½ÉÌì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½…ÍÍ•ÉÐ½…ÍÍ•ÉÐ¹µ©Ì)Ù…ÈÍÍ•ÉÑÉÉ½È€ô±…ÍÌ•áÑ•¹‘ÌÉÉ½Èì(€½¹ÍÑÉÕÑ½È¡Í½ÕÉ”°Ù…±Õ”°•ÉÉ½ÉÌ¤ì(€€€ÍÕÁ•È¡Í½ÕÉ”¤ì(€€€=‰©•Ð¹‘•™¥¹•AÉ½Á•ÉÑä¡Ñ¡¥Ì°€‰…ÕÍ”ˆ°ì(€€€€€Ù…±Õ”èìÍ½ÕÉ”°•ÉÉ½ÉÌ°Ù…±Õ”ô°(€€€€€ÝÉ¥Ñ…‰±”è™…±Í”°(€€€€€½¹™¥ÕÉ…‰±”è™…±Í”°(€€€€€•¹Õµ•É…‰±”è™…±Í”(€€€ô¤ì(€ô)ôì((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½±•…¸½™É½µ}…ÉÉ…ä¹µ©Ì)™Õ¹Ñ¥½¸É½µÉÉ…äÜ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€¥˜€ …Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Ù…±Õ”¤¤(€€€É•ÑÕÉ¸Ù…±Õ”ì(€É•ÑÕÉ¸Ù…±Õ”¹µ…À ¡Ù…±Õ”È¤€ôøÉ½µQåÁ”Ää¡½¹Ñ•áÐ°ÑåÁ”¹¥Ñ•µÌ°Ù…±Õ”È¤¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½±•…¸½™É½µ}å±¥Œ¹µ©Ì)™Õ¹Ñ¥½¸É½µå±¥ŒØ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€É•ÑÕÉ¸É½µQåÁ”Ää¡ì€¸¸¹½¹Ñ•áÐ°€¸¸¹ÑåÁ”¸‘‘•™Ìô°I•˜¡ÑåÁ”¸‘É•˜¤°Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½±•…¸½™É½µ}¥¹Ñ•ÉÍ•Ð¹µ©Ì)™Õ¹Ñ¥½¸Ù…±Õ…Ñ•%¹Ñ•ÉÍ•Ñ¥½¸¡½¹Ñ•áÐ°ÑåÁ”¤ì(€½¹ÍÐ…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì€ôÕ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡ÑåÁ”°€‰Õ¹•Ù…±Õ…Ñ•‘AÉ½Á•ÉÑ¥•Ìˆ¤€üì…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•ÌèÑåÁ”¹Õ¹•Ù…±Õ…Ñ•‘AÉ½Á•ÉÑ¥•Ìô€èíôì(€½¹ÍÐ¥¹ÍÑ…¹Ñ¥…Ñ•€ô%¹ÍÑ…¹Ñ¥…Ñ”¡½¹Ñ•áÐ°ÑåÁ”¤ì(€½¹ÍÐ•Ù…±Õ…Ñ•€ôÙ…±Õ…Ñ”¡¥¹ÍÑ…¹Ñ¥…Ñ•¤ì(€É•ÑÕÉ¸%Í=‰©•ÐÈ¡•Ù…±Õ…Ñ•¤€ü]¥Ñ È¡•Ù…±Õ…Ñ•°…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì¤€è•Ù…±Õ…Ñ•ì)ô)™Õ¹Ñ¥½¸É½µ%¹Ñ•ÉÍ•ÐØ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐ•Ù…±Õ…Ñ•€ôÙ…±Õ…Ñ•%¹Ñ•ÉÍ•Ñ¥½¸¡½¹Ñ•áÐ°ÑåÁ”¤ì(€É•ÑÕÉ¸É½µQåÁ”Ää¡½¹Ñ•áÐ°•Ù…±Õ…Ñ•°Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½±•…¸½…‘‘¥Ñ¥½¹…°¹µ©Ì)™Õ¹Ñ¥½¸•Ñ‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì¡ÑåÁ”¤ì(€½¹ÍÐ…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì€ôÕ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡ÑåÁ”°€‰…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìˆ¤€üÑåÁ”¹…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì€èÙ½¥€Àì(€É•ÑÕÉ¸…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½±•…¸½™É½µ}½‰©•Ð¹µ©Ì)™Õ¹Ñ¥½¸É½µ=‰©•ÐÄÄ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€¥˜€ …Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ð¡Ù…±Õ”¤ñðÕ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Ù…±Õ”¤¤(€€€É•ÑÕÉ¸Ù…±Õ”ì(€½¹ÍÐ…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì€ô•Ñ‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì¡ÑåÁ”¤ì(€™½È€¡½¹ÍÐ­•ä½˜Õ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡Ù…±Õ”¤¤ì(€€€¥˜€¡Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡ÑåÁ”¹ÁÉ½Á•ÉÑ¥•Ì°­•ä¤¤ì(€€€€€Ù…±Õ•m­•åt€ôÉ½µQåÁ”Ää¡½¹Ñ•áÐ°ÑåÁ”¹ÁÉ½Á•ÉÑ¥•Ím­•åt°Ù…±Õ•m­•åt¤ì(€€€€€½¹Ñ¥¹Õ”ì(€€€ô(€€€½¹ÍÐÕ¹­¹½Ý¹¡•¬€ô€ (€€€€€€¼¼€Ä¸…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•ÌèÑÉÕ”(€€€€€Õ…É‘}•áÁ½ÉÑÌ¹%Í	½½±•…¸¡…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì°ÑÉÕ”¤ñð%ÍM¡•µ„¡…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì¤€˜˜¡•¬È¡½¹Ñ•áÐ°…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì°Ù…±Õ•m­•åt¤(€€€€¤ì(€€€¥˜€¡Õ¹­¹½Ý¹¡•¬¤ì(€€€€€Ù…±Õ•m­•åt€ôÉ½µQåÁ”Ää¡½¹Ñ•áÐ°…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì°Ù…±Õ•m­•åt¤ì(€€€€€½¹Ñ¥¹Õ”ì(€€€ô(€€€‘•±•Ñ”Ù…±Õ•m­•åtì(€ô(€É•ÑÕÉ¸Ù…±Õ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½±•…¸½™É½µ}É•½É¹µ©Ì)™Õ¹Ñ¥½¸É½µI•½ÉÌ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€¥˜€ …Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ð¡Ù…±Õ”¤¤(€€€É•ÑÕÉ¸Ù…±Õ”ì(€½¹ÍÐ…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì€ô•Ñ‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì¡ÑåÁ”¤ì(€½¹ÍÐmÉ•½É‘A…ÑÑ•É¸°É•½É‘Y…±Õ•t€ôm¹•ÜI•áÀ¡I•½É‘A…ÑÑ•É¸¡ÑåÁ”¤¤°I•½É‘Y…±Õ”¡ÑåÁ”¥tì(€™½È€¡½¹ÍÐ­•ä½˜Õ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡Ù…±Õ”¤¤ì(€€€¥˜€¡É•½É‘A…ÑÑ•É¸¹Ñ•ÍÐ¡­•ä¤¤ì(€€€€€Ù…±Õ•m­•åt€ôÉ½µQåÁ”Ää¡½¹Ñ•áÐ°É•½É‘Y…±Õ”°Ù…±Õ•m­•åt¤ì(€€€€€½¹Ñ¥¹Õ”ì(€€€ô(€€€½¹ÍÐÕ¹­¹½Ý¹¡•¬€ô€ (€€€€€€¼¼€Ä¸…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•ÌèÑÉÕ”(€€€€€Õ…É‘}•áÁ½ÉÑÌ¹%Í	½½±•…¸¡…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì°ÑÉÕ”¤ñð%ÍM¡•µ„¡…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì¤€˜˜¡•¬È¡½¹Ñ•áÐ°…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì°Ù…±Õ•m­•åt¤(€€€€¤ì(€€€¥˜€¡Õ¹­¹½Ý¹¡•¬¤ì(€€€€€Ù…±Õ•m­•åt€ôÉ½µQåÁ”Ää¡½¹Ñ•áÐ°…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì°Ù…±Õ•m­•åt¤ì(€€€€€½¹Ñ¥¹Õ”ì(€€€ô(€€€‘•±•Ñ”Ù…±Õ•m­•åtì(€ô(€É•ÑÕÉ¸Ù…±Õ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½±•…¸½™É½µ}É•˜¹µ©Ì)™Õ¹Ñ¥½¸É½µI•˜Ô¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡½¹Ñ•áÐ°ÑåÁ”¸‘É•˜¤€üÉ½µQåÁ”Ää¡½¹Ñ•áÐ°½¹Ñ•áÑmÑåÁ”¸‘É•™t°Ù…±Õ”¤€èÙ…±Õ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½±•…¸½™É½µ}ÑÕÁ±”¹µ©Ì)™Õ¹Ñ¥½¸É½µQÕÁ±”Ô¡½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€¥˜€ …Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Ù…±Õ”¤¤(€€€É•ÑÕÉ¸Ù…±Õ”ì(€½¹ÍÐ±•¹Ñ €ô5…Ñ ¹µ¥¸¡Ù…±Õ”¹±•¹Ñ °Í¡•µ„¹¥Ñ•µÌ¹±•¹Ñ ¤ì(€™½È€¡±•Ð¥¹‘•à€ô€Àì¥¹‘•à€ð±•¹Ñ ì¥¹‘•à¬¬¤ì(€€€Ù…±Õ•m¥¹‘•át€ôÉ½µQåÁ”Ää¡½¹Ñ•áÐ°Í¡•µ„¹¥Ñ•µÍm¥¹‘•át°Ù…±Õ•m¥¹‘•át¤ì(€ô(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉ•…Ñ•ÉQ¡…¸¡Ù…±Õ”¹±•¹Ñ °±•¹Ñ ¤€üÙ…±Õ”¹Í±¥” À°±•¹Ñ ¤€èÙ…±Õ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½±½¹”½±½¹”¹µ©Ì)™Õ¹Ñ¥½¸±½¹”È¡Ù…±Õ”¤ì(€É•ÑÕÉ¸±½¹”¡Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½±•…¸½™É½µ}Õ¹¥½¸¹µ©Ì)™Õ¹Ñ¥½¸É½µU¹¥½¸ä¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€™½È€¡½¹ÍÐÍ¡•µ„½˜ÑåÁ”¹…¹å=˜¤ì(€€€½¹ÍÐ±•…¸€ôÉ½µQåÁ”Ää¡½¹Ñ•áÐ°Í¡•µ„°±½¹”È¡Ù…±Õ”¤¤ì(€€€¥˜€¡¡•¬È¡½¹Ñ•áÐ°Í¡•µ„°±•…¸¤¤(€€€€€É•ÑÕÉ¸±•…¸ì(€ô(€É•ÑÕÉ¸Ù…±Õ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½±•…¸½™É½µ}ÑåÁ”¹µ©Ì)™Õ¹Ñ¥½¸É½µQåÁ”Ää¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€É•ÑÕÉ¸%ÍÉÉ…äÈ¡ÑåÁ”¤€üÉ½µÉÉ…äÜ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%Íå±¥Œ¡ÑåÁ”¤€üÉ½µå±¥ŒØ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%Í%¹Ñ•ÉÍ•Ð¡ÑåÁ”¤€üÉ½µ%¹Ñ•ÉÍ•ÐØ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%Í=‰©•ÐÈ¡ÑåÁ”¤€üÉ½µ=‰©•ÐÄÄ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%ÍI•½É¡ÑåÁ”¤€üÉ½µI•½ÉÌ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%ÍI•˜¡ÑåÁ”¤€üÉ½µI•˜Ô¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%ÍQÕÁ±”¡ÑåÁ”¤€üÉ½µQÕÁ±”Ô¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%ÍU¹¥½¸¡ÑåÁ”¤€üÉ½µU¹¥½¸ä¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€èÙ…±Õ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½Í¡…É•½Õ¹¥½¹}ÁÉ¥½É¥Ñå}Í½ÉÐ¹µ©Ì)™Õ¹Ñ¥½¸5½‘¥™¥•ÉÌ¡ÑåÁ”°¹•áÐ¤ì(€™½È€¡½¹ÍÐ­•ä½˜Õ…É‘}‘•™…Õ±Ð¹-•åÌ¡ÑåÁ”¤¤ì(€€€¥˜€¡Õ…É‘}‘•™…Õ±Ð¹!…ÍAÉ½Á•ÉÑå-•ä¡¹•áÐ°­•ä¤¤(€€€€€½¹Ñ¥¹Õ”ì(€€€¹•áÑm­•åt€ôÑåÁ•m­•åtì(€ô(€É•ÑÕÉ¸¹•áÐì)ô)™Õ¹Ñ¥½¸É½µAÉ½Á•ÉÑ¥•ÌÐ¡ÁÉ½Á•ÉÑ¥•Ì¤ì(€½¹ÍÐÉ•ÍÕ±Ð€ôíôì(€™½È€¡½¹ÍÐ­•ä½˜Õ…É‘}‘•™…Õ±Ð¹-•åÌ¡ÁÉ½Á•ÉÑ¥•Ì¤¤(€€€É•ÍÕ±Ñm­•åt€ôÉ½µQåÁ”ÈÀ¡ÁÉ½Á•ÉÑ¥•Ím­•åt¤ì(€É•ÑÕÉ¸É•ÍÕ±Ðì)ô)™Õ¹Ñ¥½¸É½µAÉ¥½É¥ÑåQåÁ•Ì¡ÑåÁ•Ì¤ì(€É•ÑÕÉ¸É½µQåÁ•ÌØ¡AÉ¥½É¥Ñä¡ÑåÁ•Ì¤¤ì)ô)™Õ¹Ñ¥½¸É½µQåÁ•ÌØ¡ÑåÁ•Ì¤ì(€É•ÑÕÉ¸ÑåÁ•Ì¹µ…À ¡ÑåÁ”¤€ôøÉ½µQåÁ”ÈÀ¡ÑåÁ”¤¤ì)ô)™Õ¹Ñ¥½¸É½µQåÁ”ÈÀ¡ÑåÁ”¤ì(€½¹ÍÐ¹•áÐ€ô%ÍÉÉ…äÈ¡ÑåÁ”¤€ü}ÉÉ…å|¡É½µQåÁ”ÈÀ¡ÑåÁ”¹¥Ñ•µÌ¤°ÉÉ…å=ÁÑ¥½¹Ì¡ÑåÁ”¤¤€è%Í%¹Ñ•ÉÍ•Ð¡ÑåÁ”¤€ü%¹Ñ•ÉÍ•Ð¡É½µQåÁ•ÌØ¡ÑåÁ”¹…±±=˜¤¤€è%ÍU¹¥½¸¡ÑåÁ”¤€üU¹¥½¸¡É½µAÉ¥½É¥ÑåQåÁ•Ì¡ÑåÁ”¹…¹å=˜¤¤€è%Í=‰©•ÐÈ¡ÑåÁ”¤€ü}=‰©•Ñ|¡É½µAÉ½Á•ÉÑ¥•ÌÐ¡ÑåÁ”¹ÁÉ½Á•ÉÑ¥•Ì¤¤€è%ÍI•½É¡ÑåÁ”¤€üI•½É¡I•½É‘-•ä¡ÑåÁ”¤°É½µQåÁ”ÈÀ¡I•½É‘Y…±Õ”¡ÑåÁ”¤¤¤€è%ÍQÕÁ±”¡ÑåÁ”¤€üQÕÁ±”¡É½µQåÁ•ÌØ¡ÑåÁ”¹¥Ñ•µÌ¤¤€èÑåÁ”ì(€É•ÑÕÉ¸5½‘¥™¥•ÉÌ¡ÑåÁ”°¹•áÐ¤ì)ô)™Õ¹Ñ¥½¸U¹¥½¹AÉ¥½É¥ÑåM½ÉÐ¡ÑåÁ”¤ì(€½¹ÍÐÉ•ÍÕ±Ð€ôÉ½µQåÁ”ÈÀ¡ÑåÁ”¤ì(€É•ÑÕÉ¸É•ÍÕ±Ðì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½±•…¸½±•…¸¹µ©Ì)™Õ¹Ñ¥½¸±•…¸ ¸¸¹…ÉÌ¤ì(€½¹ÍÐm½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ•t€ô…ÉÕµ•¹ÑÍ}•áÁ½ÉÑÌ¹5…Ñ ¡…ÉÌ°ì(€€€€Ìè€¡½¹Ñ•áÐÈ°ÑåÁ”È°Ù…±Õ”È¤€ôøm½¹Ñ•áÐÈ°ÑåÁ”È°Ù…±Õ”Ét°(€€€€Èè€¡ÑåÁ”È°Ù…±Õ”È¤€ôømíô°ÑåÁ”È°Ù…±Õ”Ét(€ô¤ì(€½¹ÍÐÍ½ÉÑ•€ôÍ•ÑÑ¥¹Í}•áÁ½ÉÑÌ¹•Ð ¤¹Õ¹¥½¹AÉ¥½É¥ÑåM½ÉÐ€üU¹¥½¹AÉ¥½É¥ÑåM½ÉÐ¡ÑåÁ”¤€èÑåÁ”ì(€É•ÑÕÉ¸É½µQåÁ”Ää¡½¹Ñ•áÐ°Í½ÉÑ•°Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½ÑÉä½ÑÉä¹µ©Ì)Ù…ÈÑÉå}•áÁ½ÉÑÌ€ôíôì)}}•áÁ½ÉÐ¡ÑÉå}•áÁ½ÉÑÌ°ì(€…¥°è€ ¤€ôø…¥°°(€%Í=¬è€ ¤€ôø%Í=¬°(€=¬è€ ¤€ôø=¬°(€QÉåÉÉ…äè€ ¤€ôøQÉåÉÉ…ä°(€QÉå	¥%¹Ðè€ ¤€ôøQÉå	¥%¹Ð°(€QÉå	½½±•…¸è€ ¤€ôøQÉå	½½±•…¸°(€QÉå9Õ±°è€ ¤€ôøQÉå9Õ±°°(€QÉå9Õµ‰•Èè€ ¤€ôøQÉå9Õµ‰•È°(€QÉåMÑÉ¥¹œè€ ¤€ôøQÉåMÑÉ¥¹œ°(€QÉåU¹‘•™¥¹•è€ ¤€ôøQÉåU¹‘•™¥¹•)ô¤ì((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½ÑÉä½ÑÉå}É•ÍÕ±Ð¹µ©Ì)™Õ¹Ñ¥½¸%Í=¬¡Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ð¡Ù…±Õ”¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Ù…±Õ”°€‰Ù…±Õ”ˆ¤ì)ô)™Õ¹Ñ¥½¸=¬¡Ù…±Õ”¤ì(€É•ÑÕÉ¸ìÙ…±Õ”ôì)ô)™Õ¹Ñ¥½¸…¥° ¤ì(€É•ÑÕÉ¸Ù½¥€Àì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½ÑÉä½ÑÉå}…ÉÉ…ä¹µ©Ì)™Õ¹Ñ¥½¸QÉåÉÉ…ä¡Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Ù…±Õ”¤€ü=¬¡Ù…±Õ”¤€è=¬¡mÙ…±Õ•t¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½ÑÉä½ÑÉå}‰¥¥¹Ð¹µ©Ì)™Õ¹Ñ¥½¸É½µ	½½±•…¸È¡Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Ù…±Õ”°ÑÉÕ”¤€ü=¬¡	¥%¹Ð Ä¤¤€è=¬¡	¥%¹Ð À¤¤ì)ô)Ù…È‰¥¥¹ÑA…ÑÑ•É¸€ô€½x´ü ÁñlÄ´åuq¨¥¸¼ì)Ù…È‘•¥µ…±A…ÑÑ•É¸€ô€½x´ü ÁñlÄ´åuq¨¥p¹q¬¼ì)Ù…È¥¹Ñ••ÉA…ÑÑ•É¸€ô€½x´ü ÁñlÄ´åuq¨¤¼ì)™Õ¹Ñ¥½¸%ÍMÑÉ¥¹	¥%¹Ñ1¥­”¡Ù…±Õ”¤ì(€É•ÑÕÉ¸‰¥¥¹ÑA…ÑÑ•É¸¹Ñ•ÍÐ¡Ù…±Õ”¤ì)ô)™Õ¹Ñ¥½¸%ÍMÑÉ¥¹•¥µ…±1¥­”¡Ù…±Õ”¤ì(€É•ÑÕÉ¸‘•¥µ…±A…ÑÑ•É¸¹Ñ•ÍÐ¡Ù…±Õ”¤ì)ô)™Õ¹Ñ¥½¸%ÍMÑÉ¥¹%¹Ñ••É1¥­”¡Ù…±Õ”¤ì(€É•ÑÕÉ¸¥¹Ñ••ÉA…ÑÑ•É¸¹Ñ•ÍÐ¡Ù…±Õ”¤ì)ô)™Õ¹Ñ¥½¸É½µMÑÉ¥¹œÈ¡Ù…±Õ”¤ì(€½¹ÍÐ±½Ý•É…Í”€ôÙ…±Õ”¹Ñ½1½Ý•É…Í” ¤ì(€É•ÑÕÉ¸%ÍMÑÉ¥¹	¥%¹Ñ1¥­”¡Ù…±Õ”¤€ü=¬¡	¥%¹Ð¡Ù…±Õ”¹Í±¥” À°Ù…±Õ”¹±•¹Ñ €´€Ä¤¤¤€è%ÍMÑÉ¥¹•¥µ…±1¥­”¡Ù…±Õ”¤€ü=¬¡	¥%¹Ð¡Ù…±Õ”¹ÍÁ±¥Ð ˆ¸ˆ¥lÁt¤¤€è%ÍMÑÉ¥¹%¹Ñ••É1¥­”¡Ù…±Õ”¤€ü=¬¡	¥%¹Ð¡Ù…±Õ”¤¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡±½Ý•É…Í”°€‰™…±Í”ˆ¤€ü=¬¡	¥%¹Ð À¤¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡±½Ý•É…Í”°€‰ÑÉÕ”ˆ¤€ü=¬¡	¥%¹Ð Ä¤¤€è…¥° ¤ì)ô)™Õ¹Ñ¥½¸QÉå	¥%¹Ð¡Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%Í	¥%¹Ð¡Ù…±Õ”¤€ü=¬¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%Í	½½±•…¸¡Ù…±Õ”¤€üÉ½µ	½½±•…¸È¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%Í9Õµ‰•È¡Ù…±Õ”¤€ü=¬¡	¥%¹Ð¡5…Ñ ¹ÑÉÕ¹Œ¡Ù…±Õ”¤¤¤€èÕ…É‘}•áÁ½ÉÑÌ¹%Í9Õ±°¡Ù…±Õ”¤€ü=¬¡	¥%¹Ð À¤¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍMÑÉ¥¹œ¡Ù…±Õ”¤€üÉ½µMÑÉ¥¹œÈ¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍU¹‘•™¥¹•¡Ù…±Õ”¤€ü=¬¡	¥%¹Ð À¤¤€è…¥° ¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½ÑÉä½ÑÉå}‰½½±•…¸¹µ©Ì)™Õ¹Ñ¥½¸É½µ	¥%¹ÐÈ¡Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Ù…±Õ”°	¥%¹Ð À¤¤€ü=¬¡™…±Í”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Ù…±Õ”°	¥%¹Ð Ä¤¤€ü=¬¡ÑÉÕ”¤€è…¥° ¤ì)ô)™Õ¹Ñ¥½¸É½µ9Õµ‰•ÈÈ¡Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Ù…±Õ”°€À¤€ü=¬¡™…±Í”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Ù…±Õ”°€Ä¤€ü=¬¡ÑÉÕ”¤€è…¥° ¤ì)ô)™Õ¹Ñ¥½¸É½µMÑÉ¥¹œÌ¡Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Ù…±Õ”¹Ñ½1½Ý•É…Í” ¤°€‰™…±Í”ˆ¤€ü=¬¡™…±Í”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Ù…±Õ”¹Ñ½1½Ý•É…Í” ¤°€‰ÑÉÕ”ˆ¤€ü=¬¡ÑÉÕ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Ù…±Õ”°€ˆÀˆ¤€ü=¬¡™…±Í”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Ù…±Õ”°€ˆÄˆ¤€ü=¬¡ÑÉÕ”¤€è…¥° ¤ì)ô)™Õ¹Ñ¥½¸QÉå	½½±•…¸¡Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%Í	¥%¹Ð¡Ù…±Õ”¤€üÉ½µ	¥%¹ÐÈ¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%Í	½½±•…¸¡Ù…±Õ”¤€ü=¬¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%Í9Õµ‰•È¡Ù…±Õ”¤€üÉ½µ9Õµ‰•ÈÈ¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%Í9Õ±°¡Ù…±Õ”¤€ü=¬¡™…±Í”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍMÑÉ¥¹œ¡Ù…±Õ”¤€üÉ½µMÑÉ¥¹œÌ¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍU¹‘•™¥¹•¡Ù…±Õ”¤€ü=¬¡™…±Í”¤€è…¥° ¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½ÑÉä½ÑÉå}¹Õ±°¹µ©Ì)™Õ¹Ñ¥½¸É½µ	¥%¹ÐÌ¡Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Ù…±Õ”°	¥%¹Ð À¤¤€ü=¬¡¹Õ±°¤€è…¥° ¤ì)ô)™Õ¹Ñ¥½¸É½µ	½½±•…¸Ì¡Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Ù…±Õ”°™…±Í”¤€ü=¬¡¹Õ±°¤€è…¥° ¤ì)ô)™Õ¹Ñ¥½¸É½µ9Õµ‰•ÈÌ¡Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Ù…±Õ”°€À¤€ü=¬¡¹Õ±°¤€è…¥° ¤ì)ô)™Õ¹Ñ¥½¸É½µMÑÉ¥¹œÐ¡Ù…±Õ”¤ì(€½¹ÍÐ±½Ý•É…Í”€ôÙ…±Õ”¹Ñ½1½Ý•É…Í” ¤ì(€½¹ÍÐÁÉ•‘¥…Ñ”€ôÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡±½Ý•É…Í”°€‰Õ¹‘•™¥¹•ˆ¤ñðÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡±½Ý•É…Í”°€‰¹Õ±°ˆ¤ñðÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Ù…±Õ”°€ˆˆ¤ñðÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Ù…±Õ”°€ˆÀˆ¤ì(€É•ÑÕÉ¸ÁÉ•‘¥…Ñ”€ü=¬¡¹Õ±°¤€è…¥° ¤ì)ô)™Õ¹Ñ¥½¸QÉå9Õ±°¡Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%Í	¥%¹Ð¡Ù…±Õ”¤€üÉ½µ	¥%¹ÐÌ¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%Í	½½±•…¸¡Ù…±Õ”¤€üÉ½µ	½½±•…¸Ì¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%Í9Õµ‰•È¡Ù…±Õ”¤€üÉ½µ9Õµ‰•ÈÌ¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%Í9Õ±°¡Ù…±Õ”¤€ü=¬¡¹Õ±°¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍMÑÉ¥¹œ¡Ù…±Õ”¤€üÉ½µMÑÉ¥¹œÐ¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍU¹‘•™¥¹•¡Ù…±Õ”¤€ü=¬¡¹Õ±°¤€è…¥° ¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½ÑÉä½ÑÉå}¹Õµ‰•È¹µ©Ì)Ù…Èµ…á	¥%¹Ð€ô	¥%¹Ð¡9Õµ‰•È¹5a}M}%9QH¤ì)Ù…Èµ¥¹	¥%¹Ð€ô	¥%¹Ð¡9Õµ‰•È¹5%9}M}%9QH¤ì)™Õ¹Ñ¥½¸É½µ	¥%¹ÐÐ¡Ù…±Õ”¤ì(€É•ÑÕÉ¸Ù…±Õ”€ðôµ…á	¥%¹Ð€˜˜Ù…±Õ”€øôµ¥¹	¥%¹Ð€ü=¬¡9Õµ‰•È¡Ù…±Õ”¤¤€è…¥° ¤ì)ô)™Õ¹Ñ¥½¸É½µ	½½±•…¸Ð¡Ù…±Õ”¤ì(€É•ÑÕÉ¸=¬¡Ù…±Õ”€ü€Ä€è€À¤ì)ô)™Õ¹Ñ¥½¸É½µMÑÉ¥¹œÔ¡Ù…±Õ”¤ì(€½¹ÍÐ½•É•€ô€­Ù…±Õ”ì(€¥˜€¡Õ…É‘}•áÁ½ÉÑÌ¹%Í9Õµ‰•È¡½•É•¤¤(€€€É•ÑÕÉ¸=¬¡½•É•¤ì(€½¹ÍÐ±½Ý•É…Í”€ôÙ…±Õ”¹Ñ½1½Ý•É…Í” ¤ì(€¥˜€¡Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡±½Ý•É…Í”°€‰™…±Í”ˆ¤¤(€€€É•ÑÕÉ¸=¬ À¤ì(€¥˜€¡Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡±½Ý•É…Í”°€‰ÑÉÕ”ˆ¤¤(€€€É•ÑÕÉ¸=¬ Ä¤ì(€½¹ÍÐÉ•ÍÕ±Ð€ôQÉå	¥%¹Ð¡Ù…±Õ”¤ì(€¥˜€¡%Í=¬¡É•ÍÕ±Ð¤¤(€€€É•ÑÕÉ¸É•ÍÕ±Ð¹Ù…±Õ”€ðôµ…á	¥%¹Ð€˜˜É•ÍÕ±Ð¹Ù…±Õ”€øôµ¥¹	¥%¹Ð€ü=¬¡9Õµ‰•È¡É•ÍÕ±Ð¹Ù…±Õ”¤¤€è…¥° ¤ì(€É•ÑÕÉ¸…¥° ¤ì)ô)™Õ¹Ñ¥½¸QÉå9Õµ‰•È¡Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%Í	¥%¹Ð¡Ù…±Õ”¤€üÉ½µ	¥%¹ÐÐ¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%Í	½½±•…¸¡Ù…±Õ”¤€üÉ½µ	½½±•…¸Ð¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%Í9Õµ‰•È¡Ù…±Õ”¤€ü=¬¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%Í9Õ±°¡Ù…±Õ”¤€ü=¬ À¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍMÑÉ¥¹œ¡Ù…±Õ”¤€üÉ½µMÑÉ¥¹œÔ¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍU¹‘•™¥¹•¡Ù…±Õ”¤€ü=¬ À¤€è…¥° ¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½ÑÉä½ÑÉå}ÍÑÉ¥¹œ¹µ©Ì)™Õ¹Ñ¥½¸QÉåMÑÉ¥¹œ¡Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%Í	¥%¹Ð¡Ù…±Õ”¤€ü=¬¡Ù…±Õ”¹Ñ½MÑÉ¥¹œ ¤¤€èÕ…É‘}•áÁ½ÉÑÌ¹%Í	½½±•…¸¡Ù…±Õ”¤€ü=¬¡Ù…±Õ”¹Ñ½MÑÉ¥¹œ ¤¤€èÕ…É‘}•áÁ½ÉÑÌ¹%Í9Õµ‰•È¡Ù…±Õ”¤€ü=¬¡Ù…±Õ”¹Ñ½MÑÉ¥¹œ ¤¤€èÕ…É‘}•áÁ½ÉÑÌ¹%Í9Õ±°¡Ù…±Õ”¤€ü=¬ ‰¹Õ±°ˆ¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍMÑÉ¥¹œ¡Ù…±Õ”¤€ü=¬¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍU¹‘•™¥¹•¡Ù…±Õ”¤€ü=¬ ˆˆ¤€è…¥° ¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½ÑÉä½ÑÉå}Õ¹‘•™¥¹•¹µ©Ì)™Õ¹Ñ¥½¸É½µ	¥%¹ÐÔ¡Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Ù…±Õ”°	¥%¹Ð À¤¤€ü=¬¡Ù½¥€À¤€è…¥° ¤ì)ô)™Õ¹Ñ¥½¸É½µ	½½±•…¸Ô¡Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Ù…±Õ”°™…±Í”¤€ü=¬¡Ù½¥€À¤€è…¥° ¤ì)ô)™Õ¹Ñ¥½¸É½µ9Õµ‰•ÈÐ¡Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Ù…±Õ”°€À¤€ü=¬¡Ù½¥€À¤€è…¥° ¤ì)ô)™Õ¹Ñ¥½¸É½µMÑÉ¥¹œØ¡Ù…±Õ”¤ì(€½¹ÍÐ±½Ý•É…Í”€ôÙ…±Õ”¹Ñ½1½Ý•É…Í” ¤ì(€½¹ÍÐÁÉ•‘¥…Ñ”€ôÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡±½Ý•É…Í”°€‰Õ¹‘•™¥¹•ˆ¤ñðÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡±½Ý•É…Í”°€‰¹Õ±°ˆ¤ñðÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Ù…±Õ”°€ˆˆ¤ñðÕ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡Ù…±Õ”°€ˆÀˆ¤ì(€É•ÑÕÉ¸ÁÉ•‘¥…Ñ”€ü=¬¡Ù½¥€À¤€è…¥° ¤ì)ô)™Õ¹Ñ¥½¸QÉåU¹‘•™¥¹•¡Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%Í	¥%¹Ð¡Ù…±Õ”¤€üÉ½µ	¥%¹ÐÔ¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%Í	½½±•…¸¡Ù…±Õ”¤€üÉ½µ	½½±•…¸Ô¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%Í9Õµ‰•È¡Ù…±Õ”¤€üÉ½µ9Õµ‰•ÈÐ¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%Í9Õ±°¡Ù…±Õ”¤€ü=¬¡Ù½¥€À¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍMÑÉ¥¹œ¡Ù…±Õ”¤€üÉ½µMÑÉ¥¹œØ¡Ù…±Õ”¤€èÕ…É‘}•áÁ½ÉÑÌ¹%ÍU¹‘•™¥¹•¡Ù…±Õ”¤€ü=¬¡Ù…±Õ”¤€è…¥° ¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½™É½µ}…ÉÉ…ä¹µ©Ì)™Õ¹Ñ¥½¸É½µÉÉ…äà¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐÉ•ÍÕ±Ð€ôÑÉå}•áÁ½ÉÑÌ¹QÉåÉÉ…ä¡Ù…±Õ”¤ì(€É•ÑÕÉ¸É•ÍÕ±Ð¹Ù…±Õ”¹µ…À ¡Ù…±Õ”È¤€ôøÉ½µQåÁ”ÈÄ¡½¹Ñ•áÐ°ÑåÁ”¹¥Ñ•µÌ°Ù…±Õ”È¤¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½™É½µ}‰¥¥¹Ð¹µ©Ì)™Õ¹Ñ¥½¸É½µ	¥%¹ÐØ¡}½¹Ñ•áÐ°}ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐÉ•ÍÕ±Ð€ôÑÉå}•áÁ½ÉÑÌ¹QÉå	¥%¹Ð¡Ù…±Õ”¤ì(€É•ÑÕÉ¸ÑÉå}•áÁ½ÉÑÌ¹%Í=¬¡É•ÍÕ±Ð¤€üÉ•ÍÕ±Ð¹Ù…±Õ”€èÙ…±Õ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½™É½µ}‰½½±•…¸¹µ©Ì)™Õ¹Ñ¥½¸É½µ	½½±•…¸Ø¡}½¹Ñ•áÐ°}ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐÉ•ÍÕ±Ð€ôÑÉå}•áÁ½ÉÑÌ¹QÉå	½½±•…¸¡Ù…±Õ”¤ì(€É•ÑÕÉ¸ÑÉå}•áÁ½ÉÑÌ¹%Í=¬¡É•ÍÕ±Ð¤€üÉ•ÍÕ±Ð¹Ù…±Õ”€èÙ…±Õ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½™É½µ}å±¥Œ¹µ©Ì)™Õ¹Ñ¥½¸É½µå±¥ŒÜ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€É•ÑÕÉ¸É½µQåÁ”ÈÄ¡ì€¸¸¹½¹Ñ•áÐ°€¸¸¹ÑåÁ”¸‘‘•™Ìô°I•˜¡ÑåÁ”¸‘É•˜¤°Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½™É½µ}•¹Õ´¹µ©Ì)™Õ¹Ñ¥½¸É½µ¹Õ´Ì¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€É•ÑÕÉ¸É½µQåÁ”ÈÄ¡½¹Ñ•áÐ°Ù…±Õ…Ñ”¡ÑåÁ”¤°Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½™É½µ}¥¹Ñ••È¹µ©Ì)™Õ¹Ñ¥½¸É½µ%¹Ñ••È¡}½¹Ñ•áÐ°}ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐÉ•ÍÕ±Ð€ôÑÉå}•áÁ½ÉÑÌ¹QÉå9Õµ‰•È¡Ù…±Õ”¤ì(€É•ÑÕÉ¸ÑÉå}•áÁ½ÉÑÌ¹%Í=¬¡É•ÍÕ±Ð¤€ü5…Ñ ¹ÑÉÕ¹Œ¡É•ÍÕ±Ð¹Ù…±Õ”¤€èÙ…±Õ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½™É½µ}¥¹Ñ•ÉÍ•Ð¹µ©Ì)™Õ¹Ñ¥½¸É½µ%¹Ñ•ÉÍ•ÐÜ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐ¥¹ÍÑ…¹Ñ¥…Ñ•€ô%¹ÍÑ…¹Ñ¥…Ñ”¡½¹Ñ•áÐ°ÑåÁ”¤ì(€½¹ÍÐ•Ù…±Õ…Ñ•€ôÙ…±Õ…Ñ”¡¥¹ÍÑ…¹Ñ¥…Ñ•¤ì(€É•ÑÕÉ¸É½µQåÁ”ÈÄ¡½¹Ñ•áÐ°•Ù…±Õ…Ñ•°Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½™É½µ}±¥Ñ•É…°¹µ©Ì)™Õ¹Ñ¥½¸É½µ1¥Ñ•É…±	¥%¹Ð¡}½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐÉ•ÍÕ±Ð€ôÑÉå}•áÁ½ÉÑÌ¹QÉå	¥%¹Ð¡Ù…±Õ”¤ì(€É•ÑÕÉ¸ÑÉå}•áÁ½ÉÑÌ¹%Í=¬¡É•ÍÕ±Ð¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡ÑåÁ”¹½¹ÍÐ°É•ÍÕ±Ð¹Ù…±Õ”¤€üÉ•ÍÕ±Ð¹Ù…±Õ”€èÙ…±Õ”ì)ô)™Õ¹Ñ¥½¸É½µ1¥Ñ•É…±	½½±•…¸¡}½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐÉ•ÍÕ±Ð€ôÑÉå}•áÁ½ÉÑÌ¹QÉå	½½±•…¸¡Ù…±Õ”¤ì(€É•ÑÕÉ¸ÑÉå}•áÁ½ÉÑÌ¹%Í=¬¡É•ÍÕ±Ð¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡ÑåÁ”¹½¹ÍÐ°É•ÍÕ±Ð¹Ù…±Õ”¤€üÉ•ÍÕ±Ð¹Ù…±Õ”€èÙ…±Õ”ì)ô)™Õ¹Ñ¥½¸É½µ1¥Ñ•É…±9Õµ‰•È¡}½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐÉ•ÍÕ±Ð€ôÑÉå}•áÁ½ÉÑÌ¹QÉå9Õµ‰•È¡Ù…±Õ”¤ì(€É•ÑÕÉ¸ÑÉå}•áÁ½ÉÑÌ¹%Í=¬¡É•ÍÕ±Ð¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡ÑåÁ”¹½¹ÍÐ°É•ÍÕ±Ð¹Ù…±Õ”¤€üÉ•ÍÕ±Ð¹Ù…±Õ”€èÙ…±Õ”ì)ô)™Õ¹Ñ¥½¸É½µ1¥Ñ•É…±MÑÉ¥¹œ¡}½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐÉ•ÍÕ±Ð€ôÑÉå}•áÁ½ÉÑÌ¹QÉåMÑÉ¥¹œ¡Ù…±Õ”¤ì(€É•ÑÕÉ¸ÑÉå}•áÁ½ÉÑÌ¹%Í=¬¡É•ÍÕ±Ð¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡ÑåÁ”¹½¹ÍÐ°É•ÍÕ±Ð¹Ù…±Õ”¤€üÉ•ÍÕ±Ð¹Ù…±Õ”€èÙ…±Õ”ì)ô)™Õ¹Ñ¥½¸É½µ1¥Ñ•É…°Ø¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€¥˜€¡Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡ÑåÁ”¹½¹ÍÐ°Ù…±Õ”¤¤(€€€É•ÑÕÉ¸Ù…±Õ”ì(€É•ÑÕÉ¸%Í1¥Ñ•É…±	¥%¹Ð¡ÑåÁ”¤€üÉ½µ1¥Ñ•É…±	¥%¹Ð¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%Í1¥Ñ•É…±	½½±•…¸¡ÑåÁ”¤€üÉ½µ1¥Ñ•É…±	½½±•…¸¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%Í1¥Ñ•É…±9Õµ‰•È¡ÑåÁ”¤€üÉ½µ1¥Ñ•É…±9Õµ‰•È¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%Í1¥Ñ•É…±MÑÉ¥¹œ¡ÑåÁ”¤€üÉ½µ1¥Ñ•É…±MÑÉ¥¹œ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€èU¹É•…¡…‰±” ¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½™É½µ}¹Õ±°¹µ©Ì)™Õ¹Ñ¥½¸É½µ9Õ±°È¡}½¹Ñ•áÐ°}ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐÉ•ÍÕ±Ð€ôÑÉå}•áÁ½ÉÑÌ¹QÉå9Õ±°¡Ù…±Õ”¤ì(€É•ÑÕÉ¸ÑÉå}•áÁ½ÉÑÌ¹%Í=¬¡É•ÍÕ±Ð¤€üÉ•ÍÕ±Ð¹Ù…±Õ”€èÙ…±Õ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½™É½µ}¹Õµ‰•È¹µ©Ì)™Õ¹Ñ¥½¸É½µ9Õµ‰•ÈÔ¡}½¹Ñ•áÐ°}ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐÉ•ÍÕ±Ð€ôÑÉå}•áÁ½ÉÑÌ¹QÉå9Õµ‰•È¡Ù…±Õ”¤ì(€É•ÑÕÉ¸ÑÉå}•áÁ½ÉÑÌ¹%Í=¬¡É•ÍÕ±Ð¤€üÉ•ÍÕ±Ð¹Ù…±Õ”€èÙ…±Õ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½™É½µ}…‘‘¥Ñ¥½¹…°¹µ©Ì)™Õ¹Ñ¥½¸É½µ‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì¡½¹Ñ•áÐ°•¹ÑÉ¥•Ì°…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì°Ù…±Õ”¤ì(€½¹ÍÐ­•åÌ€ôÕ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡Ù…±Õ”¤ì(€™½È€¡½¹ÍÐmÉ••áÀ°}t½˜•¹ÑÉ¥•Ì¤ì(€€€™½È€¡½¹ÍÐ­•ä½˜­•åÌ¤ì(€€€€€¥˜€ …É••áÀ¹Ñ•ÍÐ¡­•ä¤¤ì(€€€€€€€Ù…±Õ•m­•åt€ôÉ½µQåÁ”ÈÄ¡½¹Ñ•áÐ°…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì°Ù…±Õ•m­•åt¤ì(€€€€€ô(€€€ô(€ô(€É•ÑÕÉ¸Ù…±Õ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½Í¡…É•½½ÁÑ¥½¹…±}Õ¹‘•™¥¹•¹µ©Ì)™Õ¹Ñ¥½¸%Í=ÁÑ¥½¹…±U¹‘•™¥¹•¡ÁÉ½Á•ÉÑä°­•ä°Ù…±Õ”¤ì(€É•ÑÕÉ¸%Í=ÁÑ¥½¹…°¡ÁÉ½Á•ÉÑä¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%ÍU¹‘•™¥¹•¡Ù…±Õ•m­•åt¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½™É½µ}½‰©•Ð¹µ©Ì)™Õ¹Ñ¥½¸É½µAÉ½Á•ÉÑ¥•ÌÔ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐ•¹ÑÉ¥•Ì€ôÕ…É‘}•áÁ½ÉÑÌ¹¹ÑÉ¥•ÍI•áÀ¡ÑåÁ”¹ÁÉ½Á•ÉÑ¥•Ì¤ì(€½¹ÍÐ­•åÌ€ôÕ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡Ù…±Õ”¤ì(€™½È€¡½¹ÍÐmÉ••áÀ°ÁÉ½Á•ÉÑåt½˜•¹ÑÉ¥•Ì¤ì(€€€™½È€¡½¹ÍÐ­•ä½˜­•åÌ¤ì(€€€€€¥˜€ …É••áÀ¹Ñ•ÍÐ¡­•ä¤ñð%Í=ÁÑ¥½¹…±U¹‘•™¥¹•¡ÁÉ½Á•ÉÑä°­•ä°Ù…±Õ”¤¤(€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€Ù…±Õ•m­•åt€ôÉ½µQåÁ”ÈÄ¡½¹Ñ•áÐ°ÁÉ½Á•ÉÑä°Ù…±Õ•m­•åt¤ì(€€€ô(€ô(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡ÑåÁ”°€‰…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ð¡ÑåÁ”¹…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì¤€üÉ½µ‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì¡½¹Ñ•áÐ°•¹ÑÉ¥•Ì°ÑåÁ”¹…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì°Ù…±Õ”¤€èÙ…±Õ”ì)ô)™Õ¹Ñ¥½¸É½µ=‰©•ÐÄÈ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ñ9½ÑÉÉ…ä¡Ù…±Õ”¤€üÉ½µAÉ½Á•ÉÑ¥•ÌÔ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€èÙ…±Õ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½™É½µ}É•½É¹µ©Ì)™Õ¹Ñ¥½¸É½µA…ÑÑ•É¹AÉ½Á•ÉÑ¥•Ì¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐ•¹ÑÉ¥•Ì€ôÕ…É‘}•áÁ½ÉÑÌ¹¹ÑÉ¥•ÍI•áÀ¡ÑåÁ”¹Á…ÑÑ•É¹AÉ½Á•ÉÑ¥•Ì¤ì(€½¹ÍÐ­•åÌ€ôÕ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡Ù…±Õ”¤ì(€™½È€¡½¹ÍÐmÉ••áÀ°Í¡•µ…t½˜•¹ÑÉ¥•Ì¤ì(€€€™½È€¡½¹ÍÐ­•ä½˜­•åÌ¤ì(€€€€€¥˜€¡É••áÀ¹Ñ•ÍÐ¡­•ä¤¤ì(€€€€€€€Ù…±Õ•m­•åt€ôÉ½µQåÁ”ÈÄ¡½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ•m­•åt¤ì(€€€€€ô(€€€ô(€ô(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡ÑåÁ”°€‰…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ìˆ¤€˜˜Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ð¡ÑåÁ”¹…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì¤€üÉ½µ‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì¡½¹Ñ•áÐ°•¹ÑÉ¥•Ì°ÑåÁ”¹…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì°Ù…±Õ”¤€èÙ…±Õ”ì)ô)™Õ¹Ñ¥½¸É½µI•½ÉÐ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ñ9½ÑÉÉ…ä¡Ù…±Õ”¤€üÉ½µA…ÑÑ•É¹AÉ½Á•ÉÑ¥•Ì¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€èÙ…±Õ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½™É½µ}É•˜¹µ©Ì)™Õ¹Ñ¥½¸É½µI•˜Ø¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡½¹Ñ•áÐ°ÑåÁ”¸‘É•˜¤€üÉ½µQåÁ”ÈÄ¡½¹Ñ•áÐ°½¹Ñ•áÑmÑåÁ”¸‘É•™t°Ù…±Õ”¤€èÙ…±Õ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½™É½µ}ÍÑÉ¥¹œ¹µ©Ì)™Õ¹Ñ¥½¸É½µMÑÉ¥¹œÜ¡}½¹Ñ•áÐ°}ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐÉ•ÍÕ±Ð€ôÑÉå}•áÁ½ÉÑÌ¹QÉåMÑÉ¥¹œ¡Ù…±Õ”¤ì(€É•ÑÕÉ¸ÑÉå}•áÁ½ÉÑÌ¹%Í=¬¡É•ÍÕ±Ð¤€üÉ•ÍÕ±Ð¹Ù…±Õ”€èÙ…±Õ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½™É½µ}Ñ•µÁ±…Ñ•}±¥Ñ•É…°¹µ©Ì)™Õ¹Ñ¥½¸É½µQ•µÁ±…Ñ•1¥Ñ•É…°Ð¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€É•ÑÕÉ¸É½µQåÁ”ÈÄ¡½¹Ñ•áÐ°Ù…±Õ…Ñ”¡ÑåÁ”¤°Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½™É½µ}ÑÕÁ±”¹µ©Ì)™Õ¹Ñ¥½¸É½µQÕÁ±”Ø¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€¥˜€ …Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Ù…±Õ”¤¤(€€€É•ÑÕÉ¸Ù…±Õ”ì(€™½È€¡±•Ð¥¹‘•à€ô€Àì¥¹‘•à€ð5…Ñ ¹µ¥¸¡ÑåÁ”¹¥Ñ•µÌ¹±•¹Ñ °Ù…±Õ”¹±•¹Ñ ¤ì¥¹‘•à¬¬¤ì(€€€Ù…±Õ•m¥¹‘•át€ôÉ½µQåÁ”ÈÄ¡½¹Ñ•áÐ°ÑåÁ”¹¥Ñ•µÍm¥¹‘•át°Ù…±Õ•m¥¹‘•át¤ì(€ô(€É•ÑÕÉ¸Ù…±Õ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½™É½µ}Õ¹‘•™¥¹•¹µ©Ì)™Õ¹Ñ¥½¸É½µU¹‘•™¥¹•È¡}½¹Ñ•áÐ°}ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐÉ•ÍÕ±Ð€ôÑÉå}•áÁ½ÉÑÌ¹QÉåU¹‘•™¥¹•¡Ù…±Õ”¤ì(€É•ÑÕÉ¸ÑÉå}•áÁ½ÉÑÌ¹%Í=¬¡É•ÍÕ±Ð¤€üÉ•ÍÕ±Ð¹Ù…±Õ”€èÙ…±Õ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½™É½µ}Õ¹¥½¸¹µ©Ì)™Õ¹Ñ¥½¸É½µU¹¥½¸ÄÀ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐµ…Ñ¡•€ôÑåÁ”¹…¹å=˜¹Í½µ” ¡ÑåÁ”È¤€ôø¡•¬È¡½¹Ñ•áÐ°ÑåÁ”È°Ù…±Õ”¤¤ì(€¥˜€¡µ…Ñ¡•¤(€€€É•ÑÕÉ¸Ù…±Õ”ì(€½¹ÍÐ…¹‘¥‘…Ñ•Ì€ôÑåÁ”¹…¹å=˜¹µ…À ¡ÑåÁ”È¤€ôøÉ½µQåÁ”ÈÄ¡½¹Ñ•áÐ°ÑåÁ”È°±½¹”È¡Ù…±Õ”¤¤¤ì(€½¹ÍÐÍ•±•Ñ•€ô…¹‘¥‘…Ñ•Ì¹™¥¹ ¡Ù…±Õ”È¤€ôø¡•¬È¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”È¤¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍU¹‘•™¥¹•¡Í•±•Ñ•¤€üÙ…±Õ”€èÍ•±•Ñ•ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½™É½µ}Ù½¥¹µ©Ì)™Õ¹Ñ¥½¸É½µY½¥¡}½¹Ñ•áÐ°}ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐÉ•ÍÕ±Ð€ôÑÉå}•áÁ½ÉÑÌ¹QÉåU¹‘•™¥¹•¡Ù…±Õ”¤ì(€É•ÑÕÉ¸ÑÉå}•áÁ½ÉÑÌ¹%Í=¬¡É•ÍÕ±Ð¤€üÙ½¥€À€èÙ…±Õ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½™É½µ}ÑåÁ”¹µ©Ì)™Õ¹Ñ¥½¸É½µQåÁ”ÈÄ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€É•ÑÕÉ¸%ÍÉÉ…äÈ¡ÑåÁ”¤€üÉ½µÉÉ…äà¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%Í	¥%¹ÐÈ¡ÑåÁ”¤€üÉ½µ	¥%¹ÐØ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%Í	½½±•…¸Ì¡ÑåÁ”¤€üÉ½µ	½½±•…¸Ø¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%Íå±¥Œ¡ÑåÁ”¤€üÉ½µå±¥ŒÜ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%Í¹Õ´¡ÑåÁ”¤€üÉ½µ¹Õ´Ì¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%Í%¹Ñ••ÈÈ¡ÑåÁ”¤€üÉ½µ%¹Ñ••È¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%Í%¹Ñ•ÉÍ•Ð¡ÑåÁ”¤€üÉ½µ%¹Ñ•ÉÍ•ÐÜ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%Í1¥Ñ•É…°¡ÑåÁ”¤€üÉ½µ1¥Ñ•É…°Ø¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%Í9Õ±°È¡ÑåÁ”¤€üÉ½µ9Õ±°È¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%Í9Õµ‰•ÈÌ¡ÑåÁ”¤€üÉ½µ9Õµ‰•ÈÔ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%Í=‰©•ÐÈ¡ÑåÁ”¤€üÉ½µ=‰©•ÐÄÈ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%ÍI•½É¡ÑåÁ”¤€üÉ½µI•½ÉÐ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%ÍI•˜¡ÑåÁ”¤€üÉ½µI•˜Ø¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%ÍMÑÉ¥¹œÌ¡ÑåÁ”¤€üÉ½µMÑÉ¥¹œÜ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%ÍQ•µÁ±…Ñ•1¥Ñ•É…°¡ÑåÁ”¤€üÉ½µQ•µÁ±…Ñ•1¥Ñ•É…°Ð¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%ÍQÕÁ±”¡ÑåÁ”¤€üÉ½µQÕÁ±”Ø¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%ÍU¹‘•™¥¹•È¡ÑåÁ”¤€üÉ½µU¹‘•™¥¹•È¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%ÍU¹¥½¸¡ÑåÁ”¤€üÉ½µU¹¥½¸ÄÀ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%ÍY½¥¡ÑåÁ”¤€üÉ½µY½¥¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€èÙ…±Õ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½¹Ù•ÉÐ½½¹Ù•ÉÐ¹µ©Ì)™Õ¹Ñ¥½¸½¹Ù•ÉÐ ¸¸¹…ÉÌ¤ì(€½¹ÍÐm½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ•t€ô…ÉÕµ•¹ÑÍ}•áÁ½ÉÑÌ¹5…Ñ ¡…ÉÌ°ì(€€€€Ìè€¡½¹Ñ•áÐÈ°ÑåÁ”È°Ù…±Õ”È¤€ôøm½¹Ñ•áÐÈ°ÑåÁ”È°Ù…±Õ”Ét°(€€€€Èè€¡ÑåÁ”È°Ù…±Õ”È¤€ôømíô°ÑåÁ”È°Ù…±Õ”Ét(€ô¤ì(€É•ÑÕÉ¸É½µQåÁ”ÈÄ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½‘•™…Õ±Ð½™É½µ}…ÉÉ…ä¹µ©Ì)™Õ¹Ñ¥½¸É½µÉÉ…ää¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€¥˜€ …Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Ù…±Õ”¤¤(€€€É•ÑÕÉ¸Ù…±Õ”ì(€™½È€¡±•Ð¤€ô€Àì¤€ðÙ…±Õ”¹±•¹Ñ ì¤¬¬¤ì(€€€Ù…±Õ•m¥t€ôÉ½µQåÁ”ÈÈ¡½¹Ñ•áÐ°ÑåÁ”¹¥Ñ•µÌ°Ù…±Õ•m¥t¤ì(€ô(€É•ÑÕÉ¸Ù…±Õ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½‘•™…Õ±Ð½™É½µ}å±¥Œ¹µ©Ì)™Õ¹Ñ¥½¸É½µå±¥Œà¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€É•ÑÕÉ¸É½µQåÁ”ÈÈ¡ì€¸¸¹½¹Ñ•áÐ°€¸¸¹ÑåÁ”¸‘‘•™Ìô°I•˜¡ÑåÁ”¸‘É•˜¤°Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½‘•™…Õ±Ð½™É½µ}‘•™…Õ±Ð¹µ©Ì)™Õ¹Ñ¥½¸É½µ•™…Õ±Ð¡ÑåÁ”°Ù…±Õ”¤ì(€¥˜€ …Õ…É‘}•áÁ½ÉÑÌ¹%ÍU¹‘•™¥¹•¡Ù…±Õ”¤¤(€€€É•ÑÕÉ¸Ù…±Õ”ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÕ¹Ñ¥½¸¡ÑåÁ”¹‘•™…Õ±Ð¤€üÑåÁ”¹‘•™…Õ±Ð ¤€è±½¹”È¡ÑåÁ”¹‘•™…Õ±Ð¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½‘•™…Õ±Ð½™É½µ}¥¹Ñ•ÉÍ•Ð¹µ©Ì)™Õ¹Ñ¥½¸É½µ%¹Ñ•ÉÍ•Ðà¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐ¥¹ÍÑ…¹Ñ¥…Ñ•€ô%¹ÍÑ…¹Ñ¥…Ñ”¡½¹Ñ•áÐ°ÑåÁ”¤ì(€½¹ÍÐ•Ù…±Õ…Ñ•€ôÙ…±Õ…Ñ”¡¥¹ÍÑ…¹Ñ¥…Ñ•¤ì(€É•ÑÕÉ¸É½µQåÁ”ÈÈ¡½¹Ñ•áÐ°•Ù…±Õ…Ñ•°Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½‘•™…Õ±Ð½™É½µ}½‰©•Ð¹µ©Ì)™Õ¹Ñ¥½¸É½µ=‰©•ÐÄÌ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€¥˜€ …Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ð¡Ù…±Õ”¤¤(€€€É•ÑÕÉ¸Ù…±Õ”ì(€½¹ÍÐ­¹½Ý¹AÉ½Á•ÉÑå-•åÌ€ôÕ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡ÑåÁ”¹ÁÉ½Á•ÉÑ¥•Ì¤ì(€™½È€¡½¹ÍÐ­•ä½˜­¹½Ý¹AÉ½Á•ÉÑå-•åÌ¤ì(€€€½¹ÍÐÁÉ½Á•ÉÑåY…±Õ”€ôÉ½µQåÁ”ÈÈ¡½¹Ñ•áÐ°ÑåÁ”¹ÁÉ½Á•ÉÑ¥•Ím­•åt°Ù…±Õ•m­•åt¤ì(€€€½¹ÍÐ¥ÍU¹…ÍÍ¥¹…‰±•U¹‘•™¥¹•€ôÕ…É‘}•áÁ½ÉÑÌ¹%ÍU¹‘•™¥¹•¡ÁÉ½Á•ÉÑåY…±Õ”¤€˜˜€¡%Í=ÁÑ¥½¹…°¡ÑåÁ”¹ÁÉ½Á•ÉÑ¥•Ím­•åt¤ñð€…Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡ÑåÁ”¹ÁÉ½Á•ÉÑ¥•Ím­•åt°€‰‘•™…Õ±Ðˆ¤¤ì(€€€¥˜€¡¥ÍU¹…ÍÍ¥¹…‰±•U¹‘•™¥¹•¤(€€€€€½¹Ñ¥¹Õ”ì(€€€Ù…±Õ•m­•åt€ôÁÉ½Á•ÉÑåY…±Õ”ì(€ô(€¥˜€ …%Í‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì¡ÑåÁ”¤ñðÕ…É‘}•áÁ½ÉÑÌ¹%Í	½½±•…¸¡ÑåÁ”¹…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì¤¤(€€€É•ÑÕÉ¸Ù…±Õ”ì(€™½È€¡½¹ÍÐ­•ä½˜Õ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡Ù…±Õ”¤¤ì(€€€¥˜€¡­¹½Ý¹AÉ½Á•ÉÑå-•åÌ¹¥¹±Õ‘•Ì¡­•ä¤¤(€€€€€½¹Ñ¥¹Õ”ì(€€€Ù…±Õ•m­•åt€ôÉ½µQåÁ”ÈÈ¡½¹Ñ•áÐ°ÑåÁ”¹…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì°Ù…±Õ•m­•åt¤ì(€ô(€É•ÑÕÉ¸Ù…±Õ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½‘•™…Õ±Ð½™É½µ}É•½É¹µ©Ì)™Õ¹Ñ¥½¸É½µI•½ÉÔ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€¥˜€ …Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ð¡Ù…±Õ”¤¤(€€€É•ÑÕÉ¸Ù…±Õ”ì(€½¹ÍÐmÉ•½É‘-•ä°É•½É‘Y…±Õ•t€ôm¹•ÜI•áÀ¡I•½É‘A…ÑÑ•É¸¡ÑåÁ”¤¤°I•½É‘Y…±Õ”¡ÑåÁ”¥tì(€™½È€¡½¹ÍÐ­•ä½˜Õ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡Ù…±Õ”¤¤ì(€€€¥˜€ „¡É•½É‘-•ä¹Ñ•ÍÐ¡­•ä¤€˜˜%Í•™…Õ±Ð¡É•½É‘Y…±Õ”¤¤¤(€€€€€½¹Ñ¥¹Õ”ì(€€€Ù…±Õ•m­•åt€ôÉ½µQåÁ”ÈÈ¡½¹Ñ•áÐ°É•½É‘Y…±Õ”°Ù…±Õ•m­•åt¤ì(€ô(€¥˜€ …%Í‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì¡ÑåÁ”¤¤(€€€É•ÑÕÉ¸Ù…±Õ”ì(€™½È€¡½¹ÍÐ­•ä½˜Õ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡Ù…±Õ”¤¤ì(€€€¥˜€¡É•½É‘-•ä¹Ñ•ÍÐ¡­•ä¤¤(€€€€€½¹Ñ¥¹Õ”ì(€€€Ù…±Õ•m­•åt€ôÉ½µQåÁ”ÈÈ¡½¹Ñ•áÐ°ÑåÁ”¹…‘‘¥Ñ¥½¹…±AÉ½Á•ÉÑ¥•Ì°Ù…±Õ•m­•åt¤ì(€ô(€É•ÑÕÉ¸Ù…±Õ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½‘•™…Õ±Ð½™É½µ}É•˜¹µ©Ì)™Õ¹Ñ¥½¸É½µI•˜Ü¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡½¹Ñ•áÐ°ÑåÁ”¸‘É•˜¤€üÉ½µQåÁ”ÈÈ¡½¹Ñ•áÐ°½¹Ñ•áÑmÑåÁ”¸‘É•™t°Ù…±Õ”¤€èÙ…±Õ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½‘•™…Õ±Ð½™É½µ}ÑÕÁ±”¹µ©Ì)™Õ¹Ñ¥½¸É½µQÕÁ±”Ü¡½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€¥˜€ …Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Ù…±Õ”¤¤(€€€É•ÑÕÉ¸Ù…±Õ”ì(€½¹ÍÐm¥Ñ•µÌÈ°µ…át€ômÍ¡•µ„¹¥Ñ•µÌ°5…Ñ ¹µ…à¡Í¡•µ„¹¥Ñ•µÌ¹±•¹Ñ °Ù…±Õ”¹±•¹Ñ ¥tì(€™½È€¡±•Ð¤€ô€Àì¤€ðµ…àì¤¬¬¤ì(€€€¥˜€¡¤€ð¥Ñ•µÌÈ¹±•¹Ñ ¤(€€€€€Ù…±Õ•m¥t€ôÉ½µQåÁ”ÈÈ¡½¹Ñ•áÐ°¥Ñ•µÌÉm¥t°Ù…±Õ•m¥t¤ì(€ô(€É•ÑÕÉ¸Ù…±Õ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½‘•™…Õ±Ð½™É½µ}Õ¹¥½¸¹µ©Ì)™Õ¹Ñ¥½¸É½µU¹¥½¸ÄÄ¡½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€™½È€¡½¹ÍÐ¥¹¹•È½˜Í¡•µ„¹…¹å=˜¤ì(€€€½¹ÍÐÉ•ÍÕ±Ð€ôÉ½µQåÁ”ÈÈ¡½¹Ñ•áÐ°¥¹¹•È°±½¹”È¡Ù…±Õ”¤¤ì(€€€¥˜€¡¡•¬È¡½¹Ñ•áÐ°¥¹¹•È°É•ÍÕ±Ð¤¤ì(€€€€€É•ÑÕÉ¸É•ÍÕ±Ðì(€€€ô(€ô(€É•ÑÕÉ¸Ù…±Õ”ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½‘•™…Õ±Ð½™É½µ}ÑåÁ”¹µ©Ì)™Õ¹Ñ¥½¸É½µQåÁ”ÈÈ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐ‘•™…Õ±Ñ•€ô%Í•™…Õ±Ð¡ÑåÁ”¤€üÉ½µ•™…Õ±Ð¡ÑåÁ”°Ù…±Õ”¤€èÙ…±Õ”ì(€É•ÑÕÉ¸%ÍÉÉ…äÈ¡ÑåÁ”¤€üÉ½µÉÉ…ää¡½¹Ñ•áÐ°ÑåÁ”°‘•™…Õ±Ñ•¤€è%Íå±¥Œ¡ÑåÁ”¤€üÉ½µå±¥Œà¡½¹Ñ•áÐ°ÑåÁ”°‘•™…Õ±Ñ•¤€è%Í%¹Ñ•ÉÍ•Ð¡ÑåÁ”¤€üÉ½µ%¹Ñ•ÉÍ•Ðà¡½¹Ñ•áÐ°ÑåÁ”°‘•™…Õ±Ñ•¤€è%Í=‰©•ÐÈ¡ÑåÁ”¤€üÉ½µ=‰©•ÐÄÌ¡½¹Ñ•áÐ°ÑåÁ”°‘•™…Õ±Ñ•¤€è%ÍI•½É¡ÑåÁ”¤€üÉ½µI•½ÉÔ¡½¹Ñ•áÐ°ÑåÁ”°‘•™…Õ±Ñ•¤€è%ÍI•˜¡ÑåÁ”¤€üÉ½µI•˜Ü¡½¹Ñ•áÐ°ÑåÁ”°‘•™…Õ±Ñ•¤€è%ÍQÕÁ±”¡ÑåÁ”¤€üÉ½µQÕÁ±”Ü¡½¹Ñ•áÐ°ÑåÁ”°‘•™…Õ±Ñ•¤€è%ÍU¹¥½¸¡ÑåÁ”¤€üÉ½µU¹¥½¸ÄÄ¡½¹Ñ•áÐ°ÑåÁ”°‘•™…Õ±Ñ•¤€è‘•™…Õ±Ñ•ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½‘•™…Õ±Ð½‘•™…Õ±Ð¹µ©Ì)™Õ¹Ñ¥½¸•™…Õ±Ð ¸¸¹…ÉÌ¤ì(€½¹ÍÐm½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ•t€ô…ÉÕµ•¹ÑÍ}•áÁ½ÉÑÌ¹5…Ñ ¡…ÉÌ°ì(€€€€Ìè€¡½¹Ñ•áÐÈ°ÑåÁ”È°Ù…±Õ”È¤€ôøm½¹Ñ•áÐÈ°ÑåÁ”È°Ù…±Õ”Ét°(€€€€Èè€¡ÑåÁ”È°Ù…±Õ”È¤€ôømíô°ÑåÁ”È°Ù…±Õ”Ét(€ô¤ì(€É•ÑÕÉ¸É½µQåÁ”ÈÈ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½Á¥Á•±¥¹”½Á¥Á•±¥¹”¹µ©Ì)™Õ¹Ñ¥½¸A¥Á•±¥¹”¡Á¥Á•±¥¹”¤ì(€É•ÑÕÉ¸€ ¸¸¹…ÉÌ¤€ôøì(€€€½¹ÍÐm½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ•t€ô…ÉÕµ•¹ÑÍ}•áÁ½ÉÑÌ¹5…Ñ ¡…ÉÌ°ì(€€€€€€Ìè€¡½¹Ñ•áÐÈ°ÑåÁ”È°Ù…±Õ”È¤€ôøm½¹Ñ•áÐÈ°ÑåÁ”È°Ù…±Õ”Ét°(€€€€€€Èè€¡ÑåÁ”È°Ù…±Õ”È¤€ôømíô°ÑåÁ”È°Ù…±Õ”Ét(€€€ô¤ì(€€€É•ÑÕÉ¸Á¥Á•±¥¹”¹É•‘Õ” ¡É•ÍÕ±Ð°™Õ¹Œ¤€ôø™Õ¹Œ¡½¹Ñ•áÐ°ÑåÁ”°É•ÍÕ±Ð¤°Ù…±Õ”¤ì(€ôì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½‘•Œ½…±±‰…¬¹µ©Ì)™Õ¹Ñ¥½¸•½‘”Ì¡}½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€É•ÑÕÉ¸ÑåÁ•l‰ù½‘•Œ‰t¹‘•½‘”¡Ù…±Õ”¤ì)ô)™Õ¹Ñ¥½¸¹½‘”È¡}½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€É•ÑÕÉ¸ÑåÁ•l‰ù½‘•Œ‰t¹•¹½‘”¡Ù…±Õ”¤ì)ô)™Õ¹Ñ¥½¸…±±‰…¬¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€¥˜€ …%Í½‘•Œ¡ÑåÁ”¤¤(€€€É•ÑÕÉ¸Ù…±Õ”ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡‘¥É•Ñ¥½¸°€‰•½‘”ˆ¤€ü•½‘”Ì¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è¹½‘”È¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½‘•Œ½™É½µ}…ÉÉ…ä¹µ©Ì)™Õ¹Ñ¥½¸•½‘”Ð¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€¥˜€ …Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Ù…±Õ”¤¤(€€€É•ÑÕÉ¸Ù…±Õ”ì(€™½È€¡±•Ð¤€ô€Àì¤€ðÙ…±Õ”¹±•¹Ñ ì¤¬¬¤ì(€€€Ù…±Õ•m¥t€ôÉ½µQåÁ”ÈÌ¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”¹¥Ñ•µÌ°Ù…±Õ•m¥t¤ì(€ô(€É•ÑÕÉ¸…±±‰…¬¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì)ô)™Õ¹Ñ¥½¸¹½‘”Ì¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐ•áÑ•É¥½È€ô…±±‰…¬¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€¥˜€ …Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡•áÑ•É¥½È¤¤(€€€É•ÑÕÉ¸•áÑ•É¥½Èì(€™½È€¡±•Ð¤€ô€Àì¤€ð•áÑ•É¥½È¹±•¹Ñ ì¤¬¬¤ì(€€€•áÑ•É¥½Ém¥t€ôÉ½µQåÁ”ÈÌ¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”¹¥Ñ•µÌ°•áÑ•É¥½Ém¥t¤ì(€ô(€É•ÑÕÉ¸•áÑ•É¥½Èì)ô)™Õ¹Ñ¥½¸É½µÉÉ…äÄÀ¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡‘¥É•Ñ¥½¸°€‰•½‘”ˆ¤€ü•½‘”Ð¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è¹½‘”Ì¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½‘•Œ½™É½µ}å±¥Œ¹µ©Ì)™Õ¹Ñ¥½¸É½µå±¥Œä¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€Ù…±Õ”€ôÉ½µQåÁ”ÈÌ¡‘¥É•Ñ¥½¸°ì€¸¸¹½¹Ñ•áÐ°€¸¸¹ÑåÁ”¸‘‘•™Ìô°I•˜¡ÑåÁ”¸‘É•˜¤°Ù…±Õ”¤ì(€É•ÑÕÉ¸…±±‰…¬¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½‘•Œ½™É½µ}¥¹Ñ•ÉÍ•Ð¹µ©Ì)™Õ¹Ñ¥½¸5•É•%¹Ñ•É¥½ÉÌ¡¥¹Ñ•É¥½ÉÌ¤ì(€É•ÑÕÉ¸¥¹Ñ•É¥½ÉÌ¹É•‘Õ” ¡É•ÍÕ±ÑÌ°¥¹Ñ•É¥½È¤€ôø€¡ì€¸¸¹É•ÍÕ±ÑÌ°€¸¸¹¥¹Ñ•É¥½Èô¤°íô¤ì)ô)™Õ¹Ñ¥½¸9½¹5…Ñ¡¥¹%¹Ñ•É¥½È¡Ù…±Õ”°¥¹Ñ•É¥½ÉÌ¤ì(€™½È€¡½¹ÍÐ¥¹Ñ•É¥½È½˜¥¹Ñ•É¥½ÉÌ¤(€€€¥˜€ …Õ…É‘}•áÁ½ÉÑÌ¹%Í••ÁÅÕ…°¡Ù…±Õ”°¥¹Ñ•É¥½È¤¤(€€€€€É•ÑÕÉ¸¥¹Ñ•É¥½Èì(€É•ÑÕÉ¸Ù…±Õ”ì)ô)™Õ¹Ñ¥½¸•½‘”Ô¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€¥˜€¡Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡ÑåÁ”¹…±±=˜¹±•¹Ñ °€À¤¤(€€€É•ÑÕÉ¸…±±‰…¬¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐ¥¹Ñ•É¥½ÉÌ€ôÑåÁ”¹…±±=˜¹µ…À ¡Í¡•µ„¤€ôøÉ½µQåÁ”ÈÌ¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°Í¡•µ„°±•…¸¡Í¡•µ„°±½¹”È¡Ù…±Õ”¤¤¤¤ì(€½¹ÍÐÍÑÉÕÑÕÉ…°€ô¥¹Ñ•É¥½ÉÌ¹•Ù•Éä ¡É•ÍÕ±Ð¤€ôøÕ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ð¡É•ÍÕ±Ð¤¤ì(€½¹ÍÐ•áÑ•É¥½È€ôÍÑÉÕÑÕÉ…°€ü5•É•%¹Ñ•É¥½ÉÌ¡¥¹Ñ•É¥½ÉÌ¤€è9½¹5…Ñ¡¥¹%¹Ñ•É¥½È¡Ù…±Õ”°¥¹Ñ•É¥½ÉÌ¤ì(€É•ÑÕÉ¸…±±‰…¬¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°•áÑ•É¥½È¤ì)ô)™Õ¹Ñ¥½¸¹½‘”Ð¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€¥˜€¡Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡ÑåÁ”¹…±±=˜¹±•¹Ñ °€À¤¤(€€€É•ÑÕÉ¸…±±‰…¬¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐ•áÑ•É¥½È€ô…±±‰…¬¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐ¥¹Ñ•É¥½ÉÌ€ôÑåÁ”¹…±±=˜¹µ…À ¡Í¡•µ„¤€ôøÉ½µQåÁ”ÈÌ¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°Í¡•µ„°±•…¸¡Í¡•µ„°±½¹”È¡•áÑ•É¥½È¤¤¤¤ì(€½¹ÍÐÍÑÉÕÑÕÉ…°€ô¥¹Ñ•É¥½ÉÌ¹•Ù•Éä ¡É•ÍÕ±Ð¤€ôøÕ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ð¡É•ÍÕ±Ð¤¤ì(€¥˜€¡ÍÑÉÕÑÕÉ…°¤(€€€É•ÑÕÉ¸5•É•%¹Ñ•É¥½ÉÌ¡¥¹Ñ•É¥½ÉÌ¤ì(€É•ÑÕÉ¸9½¹5…Ñ¡¥¹%¹Ñ•É¥½È¡•áÑ•É¥½È°¥¹Ñ•É¥½ÉÌ¤ì)ô)™Õ¹Ñ¥½¸É½µ%¹Ñ•ÉÍ•Ðä¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡‘¥É•Ñ¥½¸°€‰•½‘”ˆ¤€ü•½‘”Ô¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è¹½‘”Ð¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½‘•Œ½™É½µ}½‰©•Ð¹µ©Ì)™Õ¹Ñ¥½¸•½‘”Ø¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€¥˜€ …Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ñ9½ÑÉÉ…ä¡Ù…±Õ”¤¤(€€€É•ÑÕÉ¸Ù…±Õ”ì(€™½È€¡½¹ÍÐ­•ä½˜Õ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡ÑåÁ”¹ÁÉ½Á•ÉÑ¥•Ì¤¤ì(€€€¥˜€ …Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡Ù…±Õ”°­•ä¤ñð%Í=ÁÑ¥½¹…±U¹‘•™¥¹•¡ÑåÁ”¹ÁÉ½Á•ÉÑ¥•Ím­•åt°­•ä°Ù…±Õ”¤¤(€€€€€½¹Ñ¥¹Õ”ì(€€€Ù…±Õ•m­•åt€ôÉ½µQåÁ”ÈÌ¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”¹ÁÉ½Á•ÉÑ¥•Ím­•åt°Ù…±Õ•m­•åt¤ì(€ô(€É•ÑÕÉ¸…±±‰…¬¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì)ô)™Õ¹Ñ¥½¸¹½‘”Ô¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐ•áÑ•É¥½È€ô…±±‰…¬¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€¥˜€ …Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ñ9½ÑÉÉ…ä¡•áÑ•É¥½È¤¤(€€€É•ÑÕÉ¸•áÑ•É¥½Èì(€™½È€¡½¹ÍÐ­•ä½˜Õ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡ÑåÁ”¹ÁÉ½Á•ÉÑ¥•Ì¤¤ì(€€€¥˜€ …Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡•áÑ•É¥½È°­•ä¤ñð%Í=ÁÑ¥½¹…±U¹‘•™¥¹•¡ÑåÁ”¹ÁÉ½Á•ÉÑ¥•Ím­•åt°­•ä°•áÑ•É¥½È¤¤(€€€€€½¹Ñ¥¹Õ”ì(€€€•áÑ•É¥½Ém­•åt€ôÉ½µQåÁ”ÈÌ¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”¹ÁÉ½Á•ÉÑ¥•Ím­•åt°•áÑ•É¥½Ém­•åt¤ì(€ô(€É•ÑÕÉ¸•áÑ•É¥½Èì)ô)™Õ¹Ñ¥½¸É½µ=‰©•ÐÄÐ¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡‘¥É•Ñ¥½¸°€‰•½‘”ˆ¤€ü•½‘”Ø¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è¹½‘”Ô¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½‘•Œ½™É½µ}É•½É¹µ©Ì)™Õ¹Ñ¥½¸•½‘”Ü¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€¥˜€ …Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ñ9½ÑÉÉ…ä¡Ù…±Õ”¤¤(€€€É•ÑÕÉ¸Ù…±Õ”ì(€½¹ÍÐÉ••áÀ€ô¹•ÜI•áÀ¡I•½É‘A…ÑÑ•É¸¡ÑåÁ”¤¤ì(€™½È€¡½¹ÍÐ­•ä½˜Õ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡Ù…±Õ”¤¤ì(€€€¥˜€ …É••áÀ¹Ñ•ÍÐ¡­•ä¤¤(€€€€€½¹Ñ¥¹Õ”ì(€€€Ù…±Õ•m­•åt€ôÉ½µQåÁ”ÈÌ¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°I•½É‘Y…±Õ”¡ÑåÁ”¤°Ù…±Õ•m­•åt¤ì(€ô(€É•ÑÕÉ¸…±±‰…¬¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì)ô)™Õ¹Ñ¥½¸¹½‘”Ø¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐ•áÑ•É¥½È€ô…±±‰…¬¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€¥˜€ …Õ…É‘}•áÁ½ÉÑÌ¹%Í=‰©•Ñ9½ÑÉÉ…ä¡•áÑ•É¥½È¤¤(€€€É•ÑÕÉ¸•áÑ•É¥½Èì(€½¹ÍÐÉ••áÀ€ô¹•ÜI•áÀ¡I•½É‘A…ÑÑ•É¸¡ÑåÁ”¤¤ì(€™½È€¡½¹ÍÐ­•ä½˜Õ…É‘}•áÁ½ÉÑÌ¹-•åÌ¡•áÑ•É¥½È¤¤ì(€€€¥˜€ …É••áÀ¹Ñ•ÍÐ¡­•ä¤¤(€€€€€½¹Ñ¥¹Õ”ì(€€€•áÑ•É¥½Ém­•åt€ôÉ½µQåÁ”ÈÌ¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°I•½É‘Y…±Õ”¡ÑåÁ”¤°•áÑ•É¥½Ém­•åt¤ì(€ô(€É•ÑÕÉ¸•áÑ•É¥½Èì)ô)™Õ¹Ñ¥½¸É½µI•½ÉØ¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡‘¥É•Ñ¥½¸°€‰•½‘”ˆ¤€ü•½‘”Ü¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è¹½‘”Ø¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½‘•Œ½™É½µ}É•˜¹µ©Ì)™Õ¹Ñ¥½¸I•Í½±Ù•I•˜¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹!…ÍAÉ½Á•ÉÑå-•ä¡½¹Ñ•áÐ°ÑåÁ”¸‘É•˜¤€üÉ½µQåÁ”ÈÌ¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°½¹Ñ•áÑmÑåÁ”¸‘É•™t°Ù…±Õ”¤€èÙ…±Õ”ì)ô)™Õ¹Ñ¥½¸É½µI•˜à¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡‘¥É•Ñ¥½¸°€‰•½‘”ˆ¤€ü…±±‰…¬¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°I•Í½±Ù•I•˜¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤¤€èI•Í½±Ù•I•˜¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°…±±‰…¬¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½‘•Œ½™É½µ}ÑÕÁ±”¹µ©Ì)™Õ¹Ñ¥½¸•½‘”à¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€¥˜€ …Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡Ù…±Õ”¤¤(€€€É•ÑÕÉ¸Ù…±Õ”ì(€™½È€¡±•Ð¤€ô€Àì¤€ð5…Ñ ¹µ¥¸¡ÑåÁ”¹¥Ñ•µÌ¹±•¹Ñ °Ù…±Õ”¹±•¹Ñ ¤ì¤¬¬¤ì(€€€Ù…±Õ•m¥t€ôÉ½µQåÁ”ÈÌ¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”¹¥Ñ•µÍm¥t°Ù…±Õ•m¥t¤ì(€ô(€É•ÑÕÉ¸…±±‰…¬¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì)ô)™Õ¹Ñ¥½¸¹½‘”Ü¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐ•áÑ•É¥½È€ô…±±‰…¬¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€¥˜€ …Õ…É‘}•áÁ½ÉÑÌ¹%ÍÉÉ…ä¡•áÑ•É¥½È¤¤(€€€É•ÑÕÉ¸Ù…±Õ”ì(€™½È€¡±•Ð¤€ô€Àì¤€ð5…Ñ ¹µ¥¸¡ÑåÁ”¹¥Ñ•µÌ¹±•¹Ñ °•áÑ•É¥½È¹±•¹Ñ ¤ì¤¬¬¤ì(€€€•áÑ•É¥½Ém¥t€ôÉ½µQåÁ”ÈÌ¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”¹¥Ñ•µÍm¥t°•áÑ•É¥½Ém¥t¤ì(€ô(€É•ÑÕÉ¸•áÑ•É¥½Èì)ô)™Õ¹Ñ¥½¸É½µQÕÁ±”à¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡‘¥É•Ñ¥½¸°€‰•½‘”ˆ¤€ü•½‘”à¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è¹½‘”Ü¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½‘•Œ½™É½µ}Õ¹¥½¸¹µ©Ì)™Õ¹Ñ¥½¸•½‘”ä¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€™½È€¡½¹ÍÐÍ¡•µ„½˜ÑåÁ”¹…¹å=˜¤ì(€€€¥˜€ …¡•¬È¡½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤¤(€€€€€½¹Ñ¥¹Õ”ì(€€€½¹ÍÐÙ…É¥…¹Ð€ôÉ½µQåÁ”ÈÌ¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°Í¡•µ„°Ù…±Õ”¤ì(€€€É•ÑÕÉ¸…±±‰…¬¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…É¥…¹Ð¤ì(€ô(€É•ÑÕÉ¸Ù…±Õ”ì)ô)™Õ¹Ñ¥½¸¹½‘”à¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐ•áÑ•É¥½È€ô…±±‰…¬¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€™½È€¡½¹ÍÐÍ¡•µ„½˜ÑåÁ”¹…¹å=˜¤ì(€€€½¹ÍÐÙ…É¥…¹Ð€ôÉ½µQåÁ”ÈÌ¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°Í¡•µ„°±½¹”È¡•áÑ•É¥½È¤¤ì(€€€¥˜€ …¡•¬È¡½¹Ñ•áÐ°Í¡•µ„°Ù…É¥…¹Ð¤¤(€€€€€½¹Ñ¥¹Õ”ì(€€€É•ÑÕÉ¸Ù…É¥…¹Ðì(€ô(€É•ÑÕÉ¸•áÑ•É¥½Èì)ô)™Õ¹Ñ¥½¸É½µU¹¥½¸ÄÈ¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€É•ÑÕÉ¸Õ…É‘}•áÁ½ÉÑÌ¹%ÍÅÕ…°¡‘¥É•Ñ¥½¸°€‰•½‘”ˆ¤€ü•½‘”ä¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è¹½‘”à¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½‘•Œ½™É½µ}ÑåÁ”¹µ©Ì)™Õ¹Ñ¥½¸É½µQåÁ”ÈÌ¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€É•ÑÕÉ¸%ÍÉÉ…äÈ¡ÑåÁ”¤€üÉ½µÉÉ…äÄÀ¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%Íå±¥Œ¡ÑåÁ”¤€üÉ½µå±¥Œä¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%Í%¹Ñ•ÉÍ•Ð¡ÑåÁ”¤€üÉ½µ%¹Ñ•ÉÍ•Ðä¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%Í=‰©•ÐÈ¡ÑåÁ”¤€üÉ½µ=‰©•ÐÄÐ¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%ÍI•½É¡ÑåÁ”¤€üÉ½µI•½ÉØ¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%ÍI•˜¡ÑåÁ”¤€üÉ½µI•˜à¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%ÍQÕÁ±”¡ÑåÁ”¤€üÉ½µQÕÁ±”à¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è%ÍU¹¥½¸¡ÑåÁ”¤€üÉ½µU¹¥½¸ÄÈ¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€è…±±‰…¬¡‘¥É•Ñ¥½¸°½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì)ô((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½‘•Œ½‘•½‘”¹µ©Ì)Ù…È•½‘•ÉÉ½È€ô±…ÍÌ•áÑ•¹‘ÌÍÍ•ÉÑÉÉ½Èì(€½¹ÍÑÉÕÑ½È¡Ù…±Õ”°•ÉÉ½ÉÌ¤ì(€€€ÍÕÁ•È ‰•½‘”ˆ°Ù…±Õ”°•ÉÉ½ÉÌ¤ì(€ô)ôì)™Õ¹Ñ¥½¸ÍÍ•ÉÐ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€¥˜€ …¡•¬È¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤¤(€€€Ñ¡É½Ü¹•Ü•½‘•ÉÉ½È¡Ù…±Õ”°ÉÉ½ÉÌÈ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤¤ì(€É•ÑÕÉ¸Ù…±Õ”ì)ô)™Õ¹Ñ¥½¸•½‘•U¹Í…™”¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐÍ½ÉÑ•€ôÍ•ÑÑ¥¹Í}•áÁ½ÉÑÌ¹•Ð ¤¹Õ¹¥½¹AÉ¥½É¥ÑåM½ÉÐ€üU¹¥½¹AÉ¥½É¥ÑåM½ÉÐ¡ÑåÁ”¤€èÑåÁ”ì(€É•ÑÕÉ¸É½µQåÁ”ÈÌ ‰•½‘”ˆ°½¹Ñ•áÐ°Í½ÉÑ•°Ù…±Õ”¤ì)ô)Ù…È•½‘•È€ôA¥Á•±¥¹”¡l(€€¡}½¹Ñ•áÐ°}ÑåÁ”°Ù…±Õ”¤€ôø±½¹”È¡Ù…±Õ”¤°(€€¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€ôø•™…Õ±Ð¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤°(€€¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€ôø½¹Ù•ÉÐ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤°(€€¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€ôø±•…¸¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤°(€€¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€ôøÍÍ•ÉÐ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤°(€€¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€ôø•½‘•U¹Í…™”¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤)t¤ì((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½½‘•Œ½•¹½‘”¹µ©Ì)Ù…È¹½‘•ÉÉ½È€ô±…ÍÌ•áÑ•¹‘ÌÍÍ•ÉÑÉÉ½Èì(€½¹ÍÑÉÕÑ½È¡Ù…±Õ”°•ÉÉ½ÉÌ¤ì(€€€ÍÕÁ•È ‰¹½‘”ˆ°Ù…±Õ”°•ÉÉ½ÉÌ¤ì(€ô)ôì)™Õ¹Ñ¥½¸ÍÍ•ÉÐÈ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€¥˜€ …¡•¬È¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤¤(€€€Ñ¡É½Ü¹•Ü¹½‘•ÉÉ½È¡Ù…±Õ”°ÉÉ½ÉÌÈ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤¤ì(€É•ÑÕÉ¸Ù…±Õ”ì)ô)™Õ¹Ñ¥½¸¹½‘•U¹Í…™”¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€½¹ÍÐÍ½ÉÑ•€ôÍ•ÑÑ¥¹Í}•áÁ½ÉÑÌ¹•Ð ¤¹Õ¹¥½¹AÉ¥½É¥ÑåM½ÉÐ€üU¹¥½¹AÉ¥½É¥ÑåM½ÉÐ¡ÑåÁ”¤€èÑåÁ”ì(€É•ÑÕÉ¸É½µQåÁ”ÈÌ ‰¹½‘”ˆ°½¹Ñ•áÐ°Í½ÉÑ•°Ù…±Õ”¤ì)ô)Ù…È¹½‘•È€ôA¥Á•±¥¹”¡l(€€¡}½¹Ñ•áÐ°}ÑåÁ”°Ù…±Õ”¤€ôø±½¹”È¡Ù…±Õ”¤°(€€¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€ôø¹½‘•U¹Í…™”¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤°(€€¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€ôø•™…Õ±Ð¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤°(€€¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€ôø½¹Ù•ÉÐ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤°(€€¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€ôø±•…¸¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤°(€€¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€ôøÍÍ•ÉÐÈ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤)t¤ì((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½Á…ÉÍ”½Á…ÉÍ”¹µ©Ì)Ù…ÈA…ÉÍ•ÉÉ½ÈÈ€ô±…ÍÌ•áÑ•¹‘ÌÍÍ•ÉÑÉÉ½Èì(€½¹ÍÑÉÕÑ½È¡Ù…±Õ”°•ÉÉ½ÉÌ¤ì(€€€ÍÕÁ•È ‰A…ÉÍ”ˆ°Ù…±Õ”°•ÉÉ½ÉÌ¤ì(€ô)ôì)™Õ¹Ñ¥½¸ÍÍ•ÉÐÌ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤ì(€¥˜€ …¡•¬È¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤¤(€€€Ñ¡É½Ü¹•ÜA…ÉÍ•ÉÉ½ÈÈ¡Ù…±Õ”°ÉÉ½ÉÌÈ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤¤ì(€É•ÑÕÉ¸Ù…±Õ”ì)ô)Ù…ÈA…ÉÍ•È€ôA¥Á•±¥¹”¡l(€€¡}½¹Ñ•áÐ°}ÑåÁ”°Ù…±Õ”¤€ôø±½¹”È¡Ù…±Õ”¤°(€€¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€ôø•™…Õ±Ð¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤°(€€¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€ôø½¹Ù•ÉÐ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤°(€€¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€ôø±•…¸¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤°(€€¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤€ôøÍÍ•ÉÐÌ¡½¹Ñ•áÐ°ÑåÁ”°Ù…±Õ”¤)t¤ì((¼¼¹½‘•}µ½‘Õ±•Ì½ÑåÁ•‰½à½‰Õ¥±½Ù…±Õ”½‘•±Ñ„½•‘¥Ð¹µ©Ì)Ù…È%¹Í•ÉÐÈ€ô}=‰©•Ñ|¡ì(€ÑåÁ”è1¥Ñ•É…° ‰¥¹Í•ÉÐˆ¤°(€Á…Ñ èMÑÉ¥¹œÈ ¤°(€Ù…±Õ”èU¹­¹½Ý¸ ¤)ô¤ì)Ù…ÈUÁ‘…Ñ”È€ô=‰©•Ð¡ì(€ÑåÁ”è1¥Ñ•É…° ‰ÕÁ‘…Ñ”ˆ¤°(€Á…Ñ èMÑÉ¥¹œÈ ¤°(€Ù…±Õ”èU¹­¹½Ý¸ ¤)ô¤ì)Ù…È•±•Ñ”È€ô}=‰©•Ñ|¡ì(€ÑåÁ”è1¥Ñ•É…° ‰‘•±•Ñ”ˆ¤°(€Á…Ñ èMÑÉ¥¹œÈ ¤)ô¤ì)Ù…È‘¥Ð€ôU¹¥½¸¡m%¹Í•ÉÐÈ°UÁ‘…Ñ”È°•±•Ñ”Ét¤ì((¼¼Á…­…•Ì½½µÁÕÑ”½ÍÉŒ½…ÕÑ¡½É¥é…Ñ¥½¸¹ÑÌ)¥µÁ½ÉÐìÉ•…Ñ•!…Í …ÌÉ•…Ñ•!…Í Ìô™É½´€‰¹½‘”éÉåÁÑ¼ˆì((¼¼Á…­…•Ì½½µÁÕÑ”½ÍÉŒ½Ý½É­™±½Ü¹ÑÌ)™Õ¹Ñ¥½¸ÍÑ…‰±•)Í½¸¡Ù…±Õ”¤ì(€¥˜€¡Ù…±Õ”€ôôô¹Õ±°ñðÑåÁ•½˜Ù…±Õ”€„ôô€‰½‰©•Ðˆ¤É•ÑÕÉ¸)M=8¹ÍÑÉ¥¹¥™ä¡Ù…±Õ”¤€üü€‰¹Õ±°ˆì(€¥˜€¡ÉÉ…ä¹¥ÍÉÉ…ä¡Ù…±Õ”¤¤É•ÑÕÉ¸l‘íÙ…±Õ”¹µ…À¡ÍÑ…‰±•)Í½¸¤¹©½¥¸ ˆ°ˆ¥õu€ì(€½¹ÍÐ½‰©•Ð€ôÙ…±Õ”ì(€É•ÑÕÉ¸ì‘í=‰©•Ð¹­•åÌ¡½‰©•Ð¤¹Í½ÉÐ ¤¹µ…À ¡­•ä¤€ôø€‘í)M=8¹ÍÑÉ¥¹¥™ä¡­•ä¥ôè‘íÍÑ…‰±•)Í½¸¡½‰©•Ñm­•åt¥õ€¤¹©½¥¸ ˆ°ˆ¥õõ€ì)ô((¼¼Á…­…•Ì½½µÁÕÑ”½ÍÉŒ½…ÕÑ¡½É¥é…Ñ¥½¸¹ÑÌ)™Õ¹Ñ¥½¸½µÁÕÑ•½¹ÑÉ…Ñ!…Í ¡…ÕÑ¡½É¥é…Ñ¥½¸¤ì(€É•ÑÕÉ¸É•…Ñ•!…Í Ì ‰Í¡„ÈÔØˆ¤¹ÕÁ‘…Ñ”¡ÍÑ…‰±•)Í½¸¡…ÕÑ¡½É¥é…Ñ¥½¸¤¤¹‘¥•ÍÐ ‰¡•àˆ¤ì)ô)™Õ¹Ñ¥½¸½µÁÕÑ•)½‰½¹ÑÉ…Ñ!…Í ¡©½ˆ¤ì(€½¹ÍÐì½¹ÑÉ…Ñ!…Í è}¥¹½É•°€¸¸¹…ÕÑ¡½É¥é…Ñ¥½¸ô€ô©½ˆ¹…ÕÑ¡½É¥é…Ñ¥½¸ì(€É•ÑÕÉ¸É•…Ñ•!…Í Ì ‰Í¡„ÈÔØˆ¤¹ÕÁ‘…Ñ” (€€€ÍÑ…‰±•)Í½¸¡ì(€€€€€©½‰%è©½ˆ¹©½‰%°(€€€€€¡½ÍÐè©½ˆ¹¡½ÍÐ°(€€€€€…ÕÑ¡½É¥é…Ñ¥½¸°(€€€€€Ý½É­™±½ÝMÁ•M¡„ÈÔØè©½ˆ¹Ý½É­™±½Ü¹Ý½É­™±½ÝMÁ•M¡„ÈÔØ°(€€€€€•á•ÕÑ¥½¹5½‘”è©½ˆ¹Ý½É­™±½Ü¹•á•ÕÑ¥½¹5½‘”°(€€€€€µ½‘Õ±•½µµ¥ÑÌè©½ˆ¹Ý½É­™±½Ü¹µ½‘Õ±•½µµ¥ÑÌ°(€€€€€½¹Ñ…¥¹•É¥•ÍÑÌè©½ˆ¹Ý½É­™±½Ü¹½¹Ñ…¥¹•É¥•ÍÑÌ°(€€€€€•á•ÕÑ½Èè©½ˆ¹•á•ÕÑ½È°(€€€€€É•µ½Ñ•I•…è©½ˆ¹É•µ½Ñ•I•…°(€€€€€É•µ½Ñ•]É¥Ñ”è©½ˆ¹É•µ½Ñ•]É¥Ñ”(€€€ô¤(€€¤¹‘¥•ÍÐ ‰¡•àˆ¤ì)ô)™Õ¹Ñ¥½¸Ý¥Ñ¡¥¹I½½ÑÌ¡Á…Ñ °É½½ÑÌ¤ì(€É•ÑÕÉ¸É½½ÑÌ¹Í½µ” ¡É½½Ð¤€ôøì(€€€½¹ÍÐ¹½Éµ…±¥é•‘I½½Ð€ôÉ½½Ð¹É•Á±…” ½p¼¬¼°€ˆˆ¤ñð€ˆ¼ˆì(€€€É•ÑÕÉ¸Á…Ñ €ôôô¹½Éµ…±¥é•‘I½½ÐñðÁ…Ñ ¹ÍÑ…ÉÑÍ]¥Ñ ¡¹½Éµ…±¥é•‘I½½Ð€ôôô€ˆ¼ˆ€ü€ˆ¼ˆ€è€‘í¹½Éµ…±¥é•‘I½½Ñô½€¤ì(€ô¤ì)ô)™Õ¹Ñ¥½¸¡•­)½‰ÕÑ¡½É¥é…Ñ¥½¸¡©½ˆ°•áÁ•Ñ•‘½¹ÑÉ…Ñ!…Í ¤ì(€½¹ÍÐ…ÕÑ €ô©½ˆ¹…ÕÑ¡½É¥é…Ñ¥½¸ì(€¥˜€ ……ÕÑ ¹…ÁÁÉ½Ù•¤É•ÑÕÉ¸ì½¬è™…±Í”°É•…Í½¸è€‰½µÁÕÑ”…ÕÑ¡½É¥é…Ñ¥½¸¥Ì¹½Ð…ÁÁÉ½Ù•ˆôì(€½¹ÍÐì½¹ÑÉ…Ñ!…Í èÍÕÁÁ±¥•‘!…Í °€¸¸¹Õ¹Í¥¹•‘ÕÑ¡½É¥é…Ñ¥½¸ô€ô…ÕÑ ì(€¥˜€ …ÍÕÁÁ±¥•‘!…Í ñðÍÕÁÁ±¥•‘!…Í €„ôô½µÁÕÑ•½¹ÑÉ…Ñ!…Í ¡Õ¹Í¥¹•‘ÕÑ¡½É¥é…Ñ¥½¸¤¤ì(€€€É•ÑÕÉ¸ì½¬è™…±Í”°É•…Í½¸è€‰½µÁÕÑ”…ÕÑ¡½É¥é…Ñ¥½¸½¹ÑÉ…Ð¡…Í ¥Ì¥¹Ù…±¥ˆôì(€ô(€¥˜€¡•áÁ•Ñ•‘½¹ÑÉ…Ñ!…Í €˜˜ÍÕÁÁ±¥•‘!…Í €„ôô•áÁ•Ñ•‘½¹ÑÉ…Ñ!…Í ¤(€€€É•ÑÕÉ¸ì½¬è™…±Í”°É•…Í½¸è€‰½µÁÕÑ”…ÕÑ¡½É¥é…Ñ¥½¸‘½•Ì¹½Ðµ…Ñ Ñ¡”…ÁÁÉ½Ù•Ñ…Í¬½¹ÑÉ…Ðˆôì(€¥˜€¡©½ˆ¹½¹ÑÉ…Ñ!…Í €„ôô½µÁÕÑ•)½‰½¹ÑÉ…Ñ!…Í ¡©½ˆ¤¤(€€€É•ÑÕÉ¸ì½¬è™…±Í”°É•…Í½¸è€‰©½ˆ½¹ÑÉ…Ð¡…Í ¥Ì¥¹Ù…±¥ˆôì(€¥˜€¡©½ˆ¹Ý½É­™±½Ü¹•á•ÕÑ¥½¹5½‘”€„ôô€‰É•…‘äˆ¤(€€€É•ÑÕÉ¸ì½¬è™…±Í”°É•…Í½¸è€‰Ý½É­™±½Ü¥Ì„ÁÉ•Ù¥•Ü™¥áÑÕÉ”…¹…¹¹½Ð‰”ÍÕ‰µ¥ÑÑ•ˆôì(€¥˜€ ……ÕÑ ¹¡½ÍÑÌ¹¥¹±Õ‘•Ì¡©½ˆ¹¡½ÍÐ¤¤(€€€É•ÑÕÉ¸ì½¬è™…±Í”°É•…Í½¸è¡½ÍÐ€‘í©½ˆ¹¡½ÍÑô¥Ì½ÕÑÍ¥‘”Ñ¡”…ÁÁÉ½Ù•Í½Á•€ôì(€¥˜€ ……ÕÑ ¹Ý½É­™±½ÝÌ¹Í½µ” (€€€€¡Ý½É­™±½Ü¤€ôøÝ½É­™±½Ü€ôôô€ˆ¨ˆñð=‰©•Ð¹­•åÌ¡©½ˆ¹Ý½É­™±½Ü¹µ½‘Õ±•½µµ¥ÑÌ¤¹Í½µ” ¡µ½‘Õ±”¤€ôøµ½‘Õ±”€ôôôÝ½É­™±½Ü¤(€€¤¤ì(€€€É•ÑÕÉ¸ì½¬è™…±Í”°É•…Í½¸è€‰Ý½É­™±½Ü¥Ì½ÕÑÍ¥‘”Ñ¡”…ÁÁÉ½Ù•Í½Á”ˆôì(€ô(€¥˜€¡©½ˆ¹É•µ½Ñ•I•…¹Í½µ” ¡Á…Ñ ¤€ôø€…Ù…±¥‘I•µ½Ñ•A…Ñ ¡Á…Ñ ¤ñð€…Ý¥Ñ¡¥¹I½½ÑÌ¡Á…Ñ °…ÕÑ ¹É•µ½Ñ•I•…¤¤¤(€€€É•ÑÕÉ¸ì½¬è™…±Í”°É•…Í½¸è€‰É•µ½Ñ”É•…Á…Ñ ¥Ì½ÕÑÍ¥‘”Ñ¡”…ÁÁÉ½Ù•Í½Á”ˆôì(€¥˜€¡©½ˆ¹É•µ½Ñ•]É¥Ñ”¹Í½µ” ¡Á…Ñ ¤€ôø€…Ù…±¥‘I•µ½Ñ•A…Ñ ¡Á…Ñ ¤ñð€…Ý¥Ñ¡¥¹I½½ÑÌ¡Á…Ñ °…ÕÑ ¹É•µ½Ñ•]É¥Ñ”¤¤¤(€€€É•ÑÕÉ¸ì½¬è™…±Í”°É•…Í½¸è€‰É•µ½Ñ”ÝÉ¥Ñ”Á…Ñ ¥Ì½ÕÑÍ¥‘”Ñ¡”…ÁÁÉ½Ù•Í½Á”ˆôì(€½¹ÍÐ½É•!½ÕÉÌ€ô©½ˆ¹•á•ÕÑ½È¹ÁÕÌ€¨©½ˆ¹•á•ÕÑ½È¹Ý…±±Ñ¥µ•5¥¹ÕÑ•Ì€¼€ØÀì(€¥˜€¡½É•!½ÕÉÌ€ø…ÕÑ ¹‰Õ‘•Ð¹µ…á½É•!½ÕÉÌ¤(€€€É•ÑÕÉ¸ì½¬è™…±Í”°É•…Í½¸è€‰©½ˆ•á••‘ÌÑ¡”…ÁÁÉ½Ù•½É”µ¡½ÕÈ‰Õ‘•Ðˆôì(€¥˜€¡©½ˆ¹•á•ÕÑ½È¹Ý…±±Ñ¥µ•5¥¹ÕÑ•Ì€ø…ÕÑ ¹‰Õ‘•Ð¹µ…á]…±±Ñ¥µ•5¥¹ÕÑ•Ì¤(€€€É•ÑÕÉ¸ì½¬è™…±Í”°É•…Í½¸è€‰©½ˆ•á••‘ÌÑ¡”…ÁÁÉ½Ù•Ý…±°µÑ¥µ”‰Õ‘•Ðˆôì(€¥˜€¡=‰©•Ð¹­•åÌ¡©½ˆ¹Ý½É­™±½Ü¹µ½‘Õ±•½µµ¥ÑÌ¤¹Í½µ” ¡µ½‘Õ±”¤€ôøµ½‘Õ±”¹ÍÑ…ÉÑÍ]¥Ñ  ‰…•¹Ð¼ˆ¤€˜˜€……ÕÑ ¹…•¹Ñ½‘”¤¤(€€€É•ÑÕÉ¸ì½¬è™…±Í”°É•…Í½¸è€‰…•¹Ðµ½‘Õ±•ÌÉ•ÅÕ¥É”…•¹Ñ½‘”…ÕÑ¡½É¥é…Ñ¥½¸ˆôì(€É•ÑÕÉ¸ì½¬èÑÉÕ”ôì)ô)™Õ¹Ñ¥½¸Ù…±¥‘I•µ½Ñ•A…Ñ ¡Á…Ñ ¤ì(€É•ÑÕÉ¸	½½±•…¸¡Á…Ñ ¤€˜˜€…Á…Ñ ¹ÍÑ…ÉÑÍ]¥Ñ  ˆ´ˆ¤€˜˜€…Á…Ñ ¹¥¹±Õ‘•Ì ‰qpˆ¤€˜˜€…Á…Ñ ¹ÍÁ±¥Ð ˆ¼ˆ¤¹¥¹±Õ‘•Ì ˆ¸¸ˆ¤€˜˜€…Á…Ñ ¹¥¹±Õ‘•Ì ˆ¼¼ˆ¤ì)ô)™Õ¹Ñ¥½¸…ÍÍ•ÉÑ)½‰ÕÑ¡½É¥é•¡©½ˆ°•áÁ•Ñ•‘½¹ÑÉ…Ñ!…Í ¤ì(€½¹ÍÐÉ•ÍÕ±Ð€ô¡•­)½‰ÕÑ¡½É¥é…Ñ¥½¸¡©½ˆ°•áÁ•Ñ•‘½¹ÑÉ…Ñ!…Í ¤ì(€¥˜€ …É•ÍÕ±Ð¹½¬¤Ñ¡É½Ü¹•ÜÉÉ½È¡É•ÍÕ±Ð¹É•…Í½¸¤ì)ô((¼¼Á…­…•Ì½½µÁÕÑ”½ÍÉŒ½©½‰Ì¹ÑÌ)™Õ¹Ñ¥½¸Ý½É­™±½Ý‘…ÁÑ•È¡­¥¹¤ì(€É•ÑÕÉ¸ì(€€€­¥¹°(€€€ÁÉ•Á…É”è€¡©½ˆ°ÉÕ¹¹•È¤€ôøì(€€€€€…ÍÍ•ÉÑ)½‰ÕÑ¡½É¥é•¡©½ˆ¤ì(€€€€€É•ÑÕÉ¸ÉÕ¹¹•È¹É•ÅÕ•ÍÐ¡ì(€€€€€€€½Á•É…Ñ¥½¸è€‰ÁÉ•Á…É”ˆ°(€€€€€€€©½‰%è©½ˆ¹©½‰%°(€€€€€€€Á…å±½…èì•á•ÕÑ½Èè­¥¹°Ý½É­™±½ÝMÁ•M¡„ÈÔØè©½ˆ¹Ý½É­™±½Ü¹Ý½É­™±½ÝMÁ•M¡„ÈÔØô(€€€€€ô¤ì(€€€ô°(€€€ÍÑ…ÉÐè€¡©½ˆ°ÉÕ¹¹•È¤€ôøì(€€€€€…ÍÍ•ÉÑ)½‰ÕÑ¡½É¥é•¡©½ˆ¤ì(€€€€€É•ÑÕÉ¸ÉÕ¹¹•È¹É•ÅÕ•ÍÐ¡ì½Á•É…Ñ¥½¸è€‰ÍÑ…ÉÐˆ°©½‰%è©½ˆ¹©½‰%°Á…å±½…èì•á•ÕÑ½Èè­¥¹ôô¤ì(€€€ô°(€€€ÍÑ…ÑÕÌè€¡©½ˆ°ÉÕ¹¹•È¤€ôøÉÕ¹¹•È¹É•ÅÕ•ÍÐ¡ì½Á•É…Ñ¥½¸è€‰ÍÑ…ÑÕÌˆ°©½‰%è©½ˆ¹©½‰%ô¤°(€€€±½Ìè€¡©½ˆ°ÕÉÍ½È°ÉÕ¹¹•È¤€ôøÉÕ¹¹•È¹É•ÅÕ•ÍÐ¡ì½Á•É…Ñ¥½¸è€‰±½Ìˆ°©½‰%è©½ˆ¹©½‰%°ÕÉÍ½Èô¤°(€€€…¹•°è€¡©½ˆ°ÉÕ¹¹•È¤€ôøÉÕ¹¹•È¹É•ÅÕ•ÍÐ¡ì½Á•É…Ñ¥½¸è€‰…¹•°ˆ°©½‰%è©½ˆ¹©½‰%ô¤°(€€€½±±•Ðè€¡©½ˆ°ÉÕ¹¹•È¤€ôøÉÕ¹¹•È¹É•ÅÕ•ÍÐ¡ì½Á•É…Ñ¥½¸è€‰½±±•Ðˆ°©½‰%è©½ˆ¹©½‰%°Á…å±½…èìÉ•µ½Ñ•]É¥Ñ”è©½ˆ¹É•µ½Ñ•]É¥Ñ”ôô¤(€ôì)ô)Ù…È‘¥É•ÑM¡•‘Õ±•È€ôÝ½É­™±½Ý‘…ÁÑ•È ‰‘¥É•Ðˆ¤ì)Ù…ÈÍ±ÕÉµM¡•‘Õ±•È€ôÝ½É­™±½Ý‘…ÁÑ•È ‰Í±ÕÉ´ˆ¤ì((¼¼Á…­…•Ì½½µÁÕÑ”½ÍÉŒ½©½‰Ì½¥‘•µÁ½Ñ•¹ä¹ÑÌ)™Õ¹Ñ¥½¸•áÑ•É¹…±™™•Ñ-•ä¡¹…µ•ÍÁ…”°¥‘•¹Ñ¥Ñä¤ì(€¥˜€ …¹…µ•ÍÁ…”¹ÑÉ¥´ ¤¤Ñ¡É½Ü¹•ÜÉÉ½È ‰•áÑ•É¹…°•™™•Ð¹…µ•ÍÁ…”¥ÌÉ•ÅÕ¥É•ˆ¤ì(€½¹ÍÐÍÑ…‰±”€ô)M=8¹ÍÑÉ¥¹¥™ä (€€€¥‘•¹Ñ¥Ñä°(€€€€¡}­•ä°•¹ÑÉä¤€ôø•¹ÑÉä€˜˜ÑåÁ•½˜•¹ÑÉä€ôôô€‰½‰©•Ðˆ€˜˜€…ÉÉ…ä¹¥ÍÉÉ…ä¡•¹ÑÉä¤€ü=‰©•Ð¹™É½µ¹ÑÉ¥•Ì¡=‰©•Ð¹•¹ÑÉ¥•Ì¡•¹ÑÉä¤¹Í½ÉÐ ¡m…t°m‰t¤€ôø„¹±½…±•½µÁ…É”¡ˆ¤¤¤€è•¹ÑÉä(€€¤ì(€É•ÑÕÉ¸€‘í¹…µ•ÍÁ…”¹ÑÉ¥´ ¥ôè‘íÉ•…Ñ•!…Í Ð ‰Í¡„ÈÔØˆ¤¹ÕÁ‘…Ñ”¡ÍÑ…‰±”¤¹‘¥•ÍÐ ‰¡•àˆ¥õ€ì)ô((¼¼Á…­…•Ì½É•Í•…É ½ÍÉŒ½½Á•¸µ…•ÍÌ¹ÑÌ)Ù…È=}M=UIL€ô=‰©•Ð¹™É••é”¡l(€€‰•ÕÉ½Á•ÁµŒˆ°(€€‰ÁµŒµ±½Õˆ°(€€‰Õ¹Á…åÝ…±°ˆ°(€€‰½Á•¹…±•àˆ°(€€‰Í•µ…¹Ñ¥Í¡½±…Èˆ°(€€‰É½ÍÍÉ•˜ˆ)t¤ì)Ù…ÈA5}1=U}	M€ô€‰¡ÑÑÁÌè¼½ÁµŒµ½„µ½Á•¹‘…Ñ„¹ÌÌ¹…µ…é½¹…ÝÌ¹½´ˆì)Ù…ÈA5}1=U}5a}YIM%=9L€ô€Ìì)Ù…È=}U1Q}Q%5=UQ}5L€ô€ÄÉ”Ìì)Ù…È=}5a}9%QL€ô€àì)Ù…ÈU1Q}5%1}9X€ôl‰I=9}=9QQ}5%0ˆ°€‰U9Ae]11}5%0‰tì)™Õ¹Ñ¥½¸¹½Éµ…±¥é•Aµ¥¡Ù…±Õ”¤ì(€½¹ÍÐÉ…Ü€ôMÑÉ¥¹œ¡Ù…±Õ”ñð€ˆˆ¤¹ÑÉ¥´ ¤¹Ñ½UÁÁ•É…Í” ¤ì(€½¹ÍÐµ…Ñ €ôÉ…Ü¹µ…Ñ  ½x üéA5¤ü¡q‘ìÄ°åô¤¼¤ì(€É•ÑÕÉ¸µ…Ñ €üA5‘íµ…Ñ¡lÅuõ€€è¹Õ±°ì)ô)™Õ¹Ñ¥½¸¹½Éµ…±¥é•Aµ¥¡Ù…±Õ”¤ì(€½¹ÍÐÉ…Ü€ôMÑÉ¥¹œ¡Ù…±Õ”ñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€É•ÑÕÉ¸€½yq‘ìÄ°åô¼¹Ñ•ÍÐ¡É…Ü¤€üÉ…Ü€è¹Õ±°ì)ô)™Õ¹Ñ¥½¸½¹Ñ…Ñµ…¥°¡•áÁ±¥¥Ð°•¹Ø€ôÁÉ½•ÍÌ¹•¹Ø¤ì(€½¹ÍÐ…¹‘¥‘…Ñ•Ì€ôm•áÁ±¥¥Ð°€¸¸¹U1Q}5%1}9X¹µ…À ¡­•ä¤€ôø•¹Ùm­•åt¥tì(€™½È€¡½¹ÍÐÙ…±Õ”½˜…¹‘¥‘…Ñ•Ì¤ì(€€€½¹ÍÐ•µ…¥°€ôMÑÉ¥¹œ¡Ù…±Õ”ñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€¥˜€ ½ymyqÍt­myqÍt­p¹myqÍt¬¼¹Ñ•ÍÐ¡•µ…¥°¤¤É•ÑÕÉ¸•µ…¥°ì(€ô(€É•ÑÕÉ¸¹Õ±°ì)ô)Ù…È¡ÑÑÁÍUÉ°€ô€¡Ù…±Õ”¤€ôøì(€½¹ÍÐÑ•áÐÌ€ôMÑÉ¥¹œ¡Ù…±Õ”ñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€¥˜€ „½y¡ÑÑÁÌüép½p¼½¤¹Ñ•ÍÐ¡Ñ•áÐÌ¤¤É•ÑÕÉ¸¹Õ±°ì(€ÑÉäì(€€€½¹ÍÐÕÉ°€ô¹•ÜUI0¡Ñ•áÐÌ¤ì(€€€¥˜€¡ÕÉ°¹ÁÉ½Ñ½½°€ôôô€‰™ÑÀèˆ¤É•ÑÕÉ¸¹Õ±°ì(€€€É•ÑÕÉ¸ÕÉ°¹¡É•˜ì(€ô…Ñ ì(€€€É•ÑÕÉ¸¹Õ±°ì(€ô)ôì)Ù…ÈÁµ±½Õ‘!ÑÑÁÌ€ô€¡Ù…±Õ”¤€ôøì(€½¹ÍÐÑ•áÐÌ€ôMÑÉ¥¹œ¡Ù…±Õ”ñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€¥˜€ ½yÌÌép½p½ÁµŒµ½„µ½Á•¹‘…Ñ…p¼½¤¹Ñ•ÍÐ¡Ñ•áÐÌ¤¤(€€€É•ÑÕÉ¸€‘íA5}1=U}	Mô¼‘íÑ•áÐÌ¹É•Á±…” ½yÌÌép½p½ÁµŒµ½„µ½Á•¹‘…Ñ…p¼½¤°€ˆˆ¥õ€ì(€É•ÑÕÉ¸Ñ•áÐÌ¹ÍÑ…ÉÑÍ]¥Ñ ¡€‘íA5}1=U}	Mô½€¤€üÑ•áÐÌ€è¹Õ±°ì)ôì)…Íå¹Œ™Õ¹Ñ¥½¸™•Ñ¡)Í½¸¡™•Ñ¡%µÁ°°ÕÉ°°ì(€Ñ¥µ•½ÕÑ5Ì°(€Í¥¹…°°(€…•ÁÐ€ô€‰…ÁÁ±¥…Ñ¥½¸½©Í½¸ˆ)ô¤ì(€½¹ÍÐ½¹ÑÉ½±±•È€ô¹•Ü‰½ÉÑ½¹ÑÉ½±±•È ¤ì(€½¹ÍÐÑ¥µ•È€ôÍ•ÑQ¥µ•½ÕÐ  ¤€ôø½¹ÑÉ½±±•È¹…‰½ÉÐ ¤°Ñ¥µ•½ÕÑ5Ì¤ì(€½¹ÍÐ½¹‰½ÉÐ€ô€ ¤€ôø½¹ÑÉ½±±•È¹…‰½ÉÐ ¤ì(€Í¥¹…°ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰…‰½ÉÐˆ°½¹‰½ÉÐ°ì½¹”èÑÉÕ”ô¤ì(€ÑÉäì(€€€½¹ÍÐÉ•ÍÁ½¹Í”€ô…Ý…¥Ð™•Ñ¡%µÁ°¡ÕÉ°°ì(€€€€€Í¥¹…°è½¹ÑÉ½±±•È¹Í¥¹…°°(€€€€€¡•…‘•ÉÌèì…•ÁÐô°(€€€€€É•‘¥É•Ðè€‰™½±±½Üˆ(€€€ô¤ì(€€€½¹ÍÐÑ•áÐÌ€ô…Ý…¥ÐÉ•ÍÁ½¹Í”¹Ñ•áÐ ¤ì(€€€¥˜€ …É•ÍÁ½¹Í”¹½¬¤É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ…ÑÕÌèÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÌ°‘•Ñ…¥°è!QQ@€‘íÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÍõ€ôì(€€€¥˜€¡…•ÁÐ€ôôô€‰…ÁÁ±¥…Ñ¥½¸½©Í½¸ˆ¤ì(€€€€€ÑÉäì(€€€€€€€É•ÑÕÉ¸ì½¬èÑÉÕ”°ÍÑ…ÑÕÌèÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÌ°‰½‘äè)M=8¹Á…ÉÍ”¡Ñ•áÐÌ¤ôì(€€€€€ô…Ñ ì(€€€€€€€É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ…ÑÕÌèÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÌ°‘•Ñ…¥°è€‰¥¹Ù…±¥)M=8ˆôì(€€€€€ô(€€€ô(€€€É•ÑÕÉ¸ì½¬èÑÉÕ”°ÍÑ…ÑÕÌèÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÌ°‰½‘äèÑ•áÐÌôì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€½¹ÍÐ‘•Ñ…¥°€ô•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€ü•ÉÉ½È¹µ•ÍÍ…”€è€‰™•Ñ ™…¥±•ˆì(€€€É•ÑÕÉ¸ì(€€€€€½¬è™…±Í”°(€€€€€ÍÑ…ÑÕÌè€À°(€€€€€‘•Ñ…¥°è•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€˜˜•ÉÉ½È¹¹…µ”€ôôô€‰‰½ÉÑÉÉ½Èˆ€ü€‰Ñ¥µ•½ÕÐˆ€è‘•Ñ…¥°(€€€ôì(€ô™¥¹…±±äì(€€€±•…ÉQ¥µ•½ÕÐ¡Ñ¥µ•È¤ì(€€€Í¥¹…°ü¹É•µ½Ù•Ù•¹Ñ1¥ÍÑ•¹•È ‰…‰½ÉÐˆ°½¹‰½ÉÐ¤ì(€ô)ô)™Õ¹Ñ¥½¸µ…­•½±±•Ñ½È¡±¥µ¥Ð¤ì(€½¹ÍÐÍ••¸€ô€¼¨}}AUI}|€¨¼¹•ÜM•Ð ¤ì(€½¹ÍÐ…¹‘¥‘…Ñ•Ì€ômtì(€É•ÑÕÉ¸ì(€€€…¹‘¥‘…Ñ•Ì°(€€€…‘¡…¹‘¥‘…Ñ”¤ì(€€€€€½¹ÍÐÕÉ°€ô¡ÑÑÁÍUÉ°¡…¹‘¥‘…Ñ”ü¹ÕÉ°¤ì(€€€€€¥˜€ …ÕÉ°ñðÍ••¸¹¡…Ì¡ÕÉ°¤ñð…¹‘¥‘…Ñ•Ì¹±•¹Ñ €øô±¥µ¥Ð¤É•ÑÕÉ¸™…±Í”ì(€€€€€Í••¸¹…‘¡ÕÉ°¤ì(€€€€€…¹‘¥‘…Ñ•Ì¹ÁÕÍ ¡ì(€€€€€€€ÕÉ°°(€€€€€€€Í½ÕÉ”è…¹‘¥‘…Ñ”¹Í½ÕÉ”ñð€‰Õ¹­¹½Ý¸ˆ°(€€€€€€€­¥¹è…¹‘¥‘…Ñ”¹­¥¹ñð€‰Á‘˜ˆ°(€€€€€€€±¥•¹Í”è…¹‘¥‘…Ñ”¹±¥•¹Í”ñð¹Õ±°°(€€€€€€€Ù•ÉÍ¥½¸è…¹‘¥‘…Ñ”¹Ù•ÉÍ¥½¸ñð¹Õ±°°(€€€€€€€¡½ÍÑQåÁ”è…¹‘¥‘…Ñ”¹¡½ÍÑQåÁ”ñð¹Õ±°°(€€€€€€€¹½Ñ”è…¹‘¥‘…Ñ”¹¹½Ñ”ñð¹Õ±°(€€€€€ô¤ì(€€€€€É•ÑÕÉ¸ÑÉÕ”ì(€€€ô(€ôì)ô)…Íå¹Œ™Õ¹Ñ¥½¸É•Í½±Ù•=Á•¹•ÍÌ¡ì(€‘½¤°(€Áµ¥°(€Áµ¥°(€•µ…¥°°(€™•Ñ¡%µÁ°€ô±½‰…±Q¡¥Ì¹™•Ñ °(€Ñ¥µ•½ÕÑ5Ì€ô=}U1Q}Q%5=UQ}5L°(€Í¥¹…°°(€Í½ÕÉ•Ì€ô=}M=UIL°(€µ…á…¹‘¥‘…Ñ•Ì€ô=}5a}9%QL°(€•¹Ø€ôÁÉ½•ÍÌ¹•¹Ø)ô€ôíô¤ì(€¥˜€¡ÑåÁ•½˜™•Ñ¡%µÁ°€„ôô€‰™Õ¹Ñ¥½¸ˆ¤Ñ¡É½Ü¹•ÜÉÉ½È ‰™•Ñ ¥ÌÕ¹…Ù…¥±…‰±”ˆ¤ì(€½¹ÍÐ¥‘•¹Ñ¥Ñä€ôì‘½¤è¹½Éµ…±¥é•½¤¡‘½¤¤°Áµ¥è¹½Éµ…±¥é•Aµ¥¡Áµ¥¤°Áµ¥è¹½Éµ…±¥é•Aµ¥¡Áµ¥¤ôì(€¥˜€ …¥‘•¹Ñ¥Ñä¹‘½¤€˜˜€…¥‘•¹Ñ¥Ñä¹Áµ¥€˜˜€…¥‘•¹Ñ¥Ñä¹Áµ¥¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰½Á•¸µ…•ÍÌÉ•Í½±ÕÑ¥½¸¹••‘Ì„=$°A5%½ÈA5%ˆ¤ì(€½¹ÍÐ•¹…‰±•€ô¹•ÜM•Ð¡Í½ÕÉ•Ì¤ì(€½¹ÍÐµ…¥°€ô½¹Ñ…Ñµ…¥°¡•µ…¥°°•¹Ø¤ì(€½¹ÍÐ½±±•Ñ½È€ôµ…­•½±±•Ñ½È¡µ…á…¹‘¥‘…Ñ•Ì¤ì(€½¹ÍÐÅÕ•É¥•€ômtì(€½¹ÍÐµ•Ñ„€ôì½…MÑ…ÑÕÌè¹Õ±°°±¥•¹Í”è¹Õ±°°Ñ¥Ñ±”è¹Õ±°ôì(€½¹ÍÐ¹½Ñ”€ô€¡Í½ÕÉ”°ÍÑ…ÑÕÌÈ°‘•Ñ…¥°¤€ôøÅÕ•É¥•¹ÁÕÍ ¡ìÍ½ÕÉ”°ÍÑ…ÑÕÌèÍÑ…ÑÕÌÈ°‘•Ñ…¥°è‘•Ñ…¥°ñð¹Õ±°ô¤ì(€½¹ÍÐ½ÁÑÌ€ôìÑ¥µ•½ÕÑ5Ì°Í¥¹…°ôì(€±•Ð•ÁµŒ€ô¹Õ±°ì(€¥˜€¡•¹…‰±•¹¡…Ì ‰•ÕÉ½Á•ÁµŒˆ¤¤ì(€€€½¹ÍÐÅÕ•Éä€ô¥‘•¹Ñ¥Ñä¹‘½¤€ü=$èˆ‘í¥‘•¹Ñ¥Ñä¹‘½¥ô‰€€è¥‘•¹Ñ¥Ñä¹Áµ¥€üA5%è‘í¥‘•¹Ñ¥Ñä¹Áµ¥‘õ€€èaQ}%è‘í¥‘•¹Ñ¥Ñä¹Áµ¥‘ô9MIé5€ì(€€€½¹ÍÐÕÉ°€ô¡ÑÑÁÌè¼½ÝÝÜ¹•‰¤¹…Œ¹Õ¬½•ÕÉ½Á•ÁµŒ½Ý•‰Í•ÉÙ¥•Ì½É•ÍÐ½Í•…É ýÅÕ•Éäô‘í•¹½‘•UI%½µÁ½¹•¹Ð¡ÅÕ•Éä¥ô™™½Éµ…Ðõ©Í½¸™É•ÍÕ±ÑQåÁ”õ±¥Ñ”™Á…•M¥é”ôÕ€ì(€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥Ð™•Ñ¡)Í½¸¡™•Ñ¡%µÁ°°ÕÉ°°½ÁÑÌ¤ì(€€€¥˜€ …É•ÍÕ±Ð¹½¬¤¹½Ñ” ‰•ÕÉ½Á•ÁµŒˆ°€‰•ÉÉ½Èˆ°É•ÍÕ±Ð¹‘•Ñ…¥°¤ì(€€€•±Í”ì(€€€€€½¹ÍÐ¡¥ÑÌ€ôÉÉ…ä¹¥ÍÉÉ…ä¡É•ÍÕ±Ð¹‰½‘äü¹É•ÍÕ±Ñ1¥ÍÐü¹É•ÍÕ±Ð¤€üÉ•ÍÕ±Ð¹‰½‘ä¹É•ÍÕ±Ñ1¥ÍÐ¹É•ÍÕ±Ð€èmtì(€€€€€½¹ÍÐ¡¥Ð€ô¡¥ÑÌ¹™¥¹ ¡ ¤€ôø¥‘•¹Ñ¥Ñä¹‘½¤€˜˜¹½Éµ…±¥é•½¤¡ ¹‘½¤¤€ôôô¥‘•¹Ñ¥Ñä¹‘½¤¤ñð¡¥ÑÌ¹™¥¹ ¡ ¤€ôø¥‘•¹Ñ¥Ñä¹Áµ¥€˜˜¹½Éµ…±¥é•Aµ¥¡ ¹Áµ¥¤€ôôô¥‘•¹Ñ¥Ñä¹Áµ¥¤ñð¡¥ÑÌ¹™¥¹ ¡ ¤€ôø¥‘•¹Ñ¥Ñä¹Áµ¥€˜˜¹½Éµ…±¥é•Aµ¥¡ ¹Áµ¥¤€ôôô¥‘•¹Ñ¥Ñä¹Áµ¥¤ñð¹Õ±°ì(€€€€€¥˜€ …¡¥Ð¤¹½Ñ” ‰•ÕÉ½Á•ÁµŒˆ°€‰½¬ˆ°€‰¹¼É•½Éˆ¤ì(€€€€€•±Í”ì(€€€€€€€¥‘•¹Ñ¥Ñä¹Áµ¥€ô¥‘•¹Ñ¥Ñä¹Áµ¥ñð¹½Éµ…±¥é•Aµ¥¡¡¥Ð¹Áµ¥¤ì(€€€€€€€¥‘•¹Ñ¥Ñä¹Áµ¥€ô¥‘•¹Ñ¥Ñä¹Áµ¥ñð¹½Éµ…±¥é•Aµ¥¡¡¥Ð¹Áµ¥¤ì(€€€€€€€¥‘•¹Ñ¥Ñä¹‘½¤€ô¥‘•¹Ñ¥Ñä¹‘½¤ñð¹½Éµ…±¥é•½¤¡¡¥Ð¹‘½¤¤ì(€€€€€€€µ•Ñ„¹Ñ¥Ñ±”€ô¡¥Ð¹Ñ¥Ñ±”ñð¹Õ±°ì(€€€€€€€•ÁµŒ€ôì¥Í=„è¡¥Ð¹¥Í=Á•¹•ÍÌ€ôôô€‰dˆ°¥¹ÁµŒè¡¥Ð¹¥¹A5€ôôô€‰dˆôì(€€€€€€€¹½Ñ” (€€€€€€€€€€‰•ÕÉ½Á•ÁµŒˆ°(€€€€€€€€€€‰½¬ˆ°(€€€€€€€€€€‘í¥‘•¹Ñ¥Ñä¹Áµ¥ñð€‰¹¼A5%‰ôì¥Í=Á•¹•ÍÌô‘í¡¥Ð¹¥Í=Á•¹•ÍÌñð€ˆü‰ôì¥¹A5ô‘í¡¥Ð¹¥¹A5ñð€ˆü‰ôì¡…ÍAô‘í¡¥Ð¹¡…ÍAñð€ˆü‰õ€(€€€€€€€€¤ì(€€€€€ô(€€€ô(€ô(€±•ÐÁµ±½Õ‘EÕ•É¥•€ô¹Õ±°ì(€½¹ÍÐÁµ±½Õ€ô…Íå¹Œ€ ¤€ôøì(€€€¥˜€ …•¹…‰±•¹¡…Ì ‰ÁµŒµ±½Õˆ¤ñð€…¥‘•¹Ñ¥Ñä¹Áµ¥ñðÁµ±½Õ‘EÕ•É¥•€ôôô¥‘•¹Ñ¥Ñä¹Áµ¥¤É•ÑÕÉ¸ì(€€€Áµ±½Õ‘EÕ•É¥•€ô¥‘•¹Ñ¥Ñä¹Áµ¥ì(€€€½¹ÍÐÙ•ÉÍ¥½¹Ì€ômtì(€€€±•Ð•ÉÉ½ÉÌ€ô€Àì(€€€™½È€¡±•ÐØ€ô€ÄìØ€ðôA5}1=U}5a}YIM%=9LìØ€¬ô€Ä¤ì(€€€€€½¹ÍÐÕÉ°€ô€‘íA5}1=U}	Mô½µ•Ñ…‘…Ñ„¼‘í¥‘•¹Ñ¥Ñä¹Áµ¥‘ô¸‘íÙô¹©Í½¹€ì(€€€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥Ð™•Ñ¡)Í½¸¡™•Ñ¡%µÁ°°ÕÉ°°½ÁÑÌ¤ì(€€€€€¥˜€ …É•ÍÕ±Ð¹½¬¤ì(€€€€€€€¥˜€¡É•ÍÕ±Ð¹ÍÑ…ÑÕÌ€„ôô€ÐÀÐ€˜˜É•ÍÕ±Ð¹ÍÑ…ÑÕÌ€„ôô€ÐÀÌ¤•ÉÉ½ÉÌ€¬ô€Äì(€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€ô(€€€€€½¹ÍÐÉ•½ÉÈ€ôÉ•ÍÕ±Ð¹‰½‘äñðíôì(€€€€€Ù•ÉÍ¥½¹Ì¹ÁÕÍ ¡ì(€€€€€€€Ù•ÉÍ¥½¸èØ°(€€€€€€€µ…¹ÕÍÉ¥ÁÐèÉ•½ÉÈ¹¥Í}µ…¹ÕÍÉ¥ÁÐ€ôôôÑÉÕ”°(€€€€€€€½Á•¹•ÍÌèÉ•½ÉÈ¹¥Í}Áµ}½Á•¹…•ÍÌ€ôôôÑÉÕ”°(€€€€€€€±¥•¹Í”èÉ•½ÉÈ¹±¥•¹Í•}½‘”ñð¹Õ±°°(€€€€€€€Á‘˜èÁµ±½Õ‘!ÑÑÁÌ¡É•½ÉÈ¹Á‘™}ÕÉ°¤°(€€€€€€€‘½¤è¹½Éµ…±¥é•½¤¡É•½ÉÈ¹‘½¤¤(€€€€€ô¤ì(€€€ô(€€€¥˜€ …Ù•ÉÍ¥½¹Ì¹±•¹Ñ ¤ì(€€€€€¹½Ñ” (€€€€€€€€‰ÁµŒµ±½Õˆ°(€€€€€€€•ÉÉ½ÉÌ€ü€‰•ÉÉ½Èˆ€è€‰½¬ˆ°(€€€€€€€•ÉÉ½ÉÌ€ü€‘í•ÉÉ½ÉÍôµ•Ñ…‘…Ñ„É•ÅÕ•ÍÐ¡Ì¤™…¥±•‘€€è€‰¹½Ð¥¸A5…ÉÑ¥±”‘…Ñ…Í•ÑÌˆ(€€€€€€¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€Ù•ÉÍ¥½¹Ì¹Í½ÉÐ ¡„°ˆ¤€ôø9Õµ‰•È¡„¹µ…¹ÕÍÉ¥ÁÐ¤€´9Õµ‰•È¡ˆ¹µ…¹ÕÍÉ¥ÁÐ¤ñð„¹Ù•ÉÍ¥½¸€´ˆ¹Ù•ÉÍ¥½¸¤ì(€€€±•Ð…‘‘•€ô€Àì(€€€™½È€¡½¹ÍÐÉ•½ÉÈ½˜Ù•ÉÍ¥½¹Ì¤ì(€€€€€¥˜€¡¥‘•¹Ñ¥Ñä¹‘½¤€˜˜É•½ÉÈ¹‘½¤€˜˜É•½ÉÈ¹‘½¤€„ôô¥‘•¹Ñ¥Ñä¹‘½¤¤½¹Ñ¥¹Õ”ì(€€€€€¥˜€¡É•½ÉÈ¹Á‘˜€˜˜½±±•Ñ½È¹…‘¡ì(€€€€€€€ÕÉ°èÉ•½ÉÈ¹Á‘˜°(€€€€€€€Í½ÕÉ”è€‰ÁµŒµ±½Õˆ°(€€€€€€€­¥¹è€‰Á‘˜ˆ°(€€€€€€€±¥•¹Í”èÉ•½ÉÈ¹±¥•¹Í”°(€€€€€€€Ù•ÉÍ¥½¸èÉ•½ÉÈ¹µ…¹ÕÍÉ¥ÁÐ€ü€‰…•ÁÑ•‘Y•ÉÍ¥½¸ˆ€è€‰ÁÕ‰±¥Í¡•‘Y•ÉÍ¥½¸ˆ°(€€€€€€€¡½ÍÑQåÁ”è€‰É•Á½Í¥Ñ½Éäˆ°(€€€€€€€¹½Ñ”èA5…ÉÑ¥±”‘…Ñ…Í•ÑÌØ‘íÉ•½ÉÈ¹Ù•ÉÍ¥½¹õ€(€€€€€ô¤¤(€€€€€€€…‘‘•€¬ô€Äì(€€€€€µ•Ñ„¹±¥•¹Í”€ôµ•Ñ„¹±¥•¹Í”ñðÉ•½ÉÈ¹±¥•¹Í”ì(€€€ô(€€€¹½Ñ” ‰ÁµŒµ±½Õˆ°€‰½¬ˆ°€‘íÙ•ÉÍ¥½¹Ì¹±•¹Ñ¡ôÙ•ÉÍ¥½¸¡Ì¤ì€‘í…‘‘•‘ôÁ‘˜±¥¹¬¡Ì¥€¤ì(€ôì(€…Ý…¥ÐÁµ±½Õ ¤ì(€¥˜€¡•¹…‰±•¹¡…Ì ‰•ÕÉ½Á•ÁµŒˆ¤€˜˜¥‘•¹Ñ¥Ñä¹Áµ¥€˜˜•ÁµŒ€˜˜€¡•ÁµŒ¹¥Í=„ñð•ÁµŒ¹¥¹ÁµŒ¤¤ì(€€€½±±•Ñ½È¹…‘¡ì(€€€€€ÕÉ°è¡ÑÑÁÌè¼½•ÕÉ½Á•ÁµŒ¹½Éœ½…ÉÑ¥±•Ì¼‘í¥‘•¹Ñ¥Ñä¹Áµ¥‘ôýÁ‘˜õÉ•¹‘•É€°(€€€€€Í½ÕÉ”è€‰•ÕÉ½Á•ÁµŒˆ°(€€€€€­¥¹è€‰Á‘˜ˆ°(€€€€€±¥•¹Í”è•ÁµŒ¹¥Í=„€ü€‰½Á•¸µ…•ÍÌˆ€è¹Õ±°°(€€€€€¹½Ñ”è€‰ÕÉ½Á”A5É•¹‘•É•Aˆ(€€€ô¤ì(€€€½±±•Ñ½È¹…‘¡ì(€€€€€ÕÉ°è¡ÑÑÁÌè¼½•ÕÉ½Á•ÁµŒ¹½Éœ½‰…­•¹½ÁÑÁµÉ•¹‘•È¹™¤ý…¥ô‘í¥‘•¹Ñ¥Ñä¹Áµ¥‘ô™‰±½‰ÑåÁ”õÁ‘™€°(€€€€€Í½ÕÉ”è€‰•ÕÉ½Á•ÁµŒˆ°(€€€€€­¥¹è€‰Á‘˜ˆ°(€€€€€±¥•¹Í”è•ÁµŒ¹¥Í=„€ü€‰½Á•¸µ…•ÍÌˆ€è¹Õ±°°(€€€€€¹½Ñ”è€‰ÕÉ½Á”A5É•¹‘•È‰…­•¹ˆ(€€€ô¤ì(€ô(€¥˜€¡•¹…‰±•¹¡…Ì ‰Õ¹Á…åÝ…±°ˆ¤€˜˜¥‘•¹Ñ¥Ñä¹‘½¤¤ì(€€€¥˜€ …µ…¥°¤¹½Ñ” ‰Õ¹Á…åÝ…±°ˆ°€‰Í­¥ÁÁ•ˆ°€‰¹¼½¹Ñ…Ð•µ…¥°€¡Í•ÐI=9}=9QQ}5%0¤ˆ¤ì(€€€•±Í”ì(€€€€€½¹ÍÐÕÉ°€ô¡ÑÑÁÌè¼½…Á¤¹Õ¹Á…åÝ…±°¹½Éœ½ØÈ¼‘í•¹½‘•UI%½µÁ½¹•¹Ð¡¥‘•¹Ñ¥Ñä¹‘½¤¥ôý•µ…¥°ô‘í•¹½‘•UI%½µÁ½¹•¹Ð¡µ…¥°¥õ€ì(€€€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥Ð™•Ñ¡)Í½¸¡™•Ñ¡%µÁ°°ÕÉ°°½ÁÑÌ¤ì(€€€€€¥˜€ …É•ÍÕ±Ð¹½¬¤¹½Ñ” ‰Õ¹Á…åÝ…±°ˆ°É•ÍÕ±Ð¹ÍÑ…ÑÕÌ€ôôô€ÐÀÐ€ü€‰½¬ˆ€è€‰•ÉÉ½Èˆ°É•ÍÕ±Ð¹‘•Ñ…¥°¤ì(€€€€€•±Í”ì(€€€€€€€½¹ÍÐ‰½‘ä€ôÉ•ÍÕ±Ð¹‰½‘äñðíôì(€€€€€€€µ•Ñ„¹½…MÑ…ÑÕÌ€ô‰½‘ä¹½…}ÍÑ…ÑÕÌñðµ•Ñ„¹½…MÑ…ÑÕÌì(€€€€€€€½¹ÍÐ±½…Ñ¥½¹Ì€ôl(€€€€€€€€€‰½‘ä¹‰•ÍÑ}½…}±½…Ñ¥½¸°(€€€€€€€€€€¸¸¹ÉÉ…ä¹¥ÍÉÉ…ä¡‰½‘ä¹½…}±½…Ñ¥½¹Ì¤€ü‰½‘ä¹½…}±½…Ñ¥½¹Ì€èmt(€€€€€€€t¹™¥±Ñ•È¡	½½±•…¸¤ì(€€€€€€€±•Ð…‘‘•€ô€Àì(€€€€€€€™½È€¡½¹ÍÐ±½Œ½˜±½…Ñ¥½¹Ì¤ì(€€€€€€€€€¥˜€¡½±±•Ñ½È¹…‘¡ì(€€€€€€€€€€€ÕÉ°è±½Œ¹ÕÉ±}™½É}Á‘˜°(€€€€€€€€€€€Í½ÕÉ”è€‰Õ¹Á…åÝ…±°ˆ°(€€€€€€€€€€€­¥¹è€‰Á‘˜ˆ°(€€€€€€€€€€€±¥•¹Í”è±½Œ¹±¥•¹Í”ñð¹Õ±°°(€€€€€€€€€€€Ù•ÉÍ¥½¸è±½Œ¹Ù•ÉÍ¥½¸ñð¹Õ±°°(€€€€€€€€€€€¡½ÍÑQåÁ”è±½Œ¹¡½ÍÑ}ÑåÁ”ñð¹Õ±°(€€€€€€€€€ô¤¤(€€€€€€€€€€€…‘‘•€¬ô€Äì(€€€€€€€€€µ•Ñ„¹±¥•¹Í”€ôµ•Ñ„¹±¥•¹Í”ñð±½Œ¹±¥•¹Í”ñð¹Õ±°ì(€€€€€€€ô(€€€€€€€¹½Ñ” (€€€€€€€€€€‰Õ¹Á…åÝ…±°ˆ°(€€€€€€€€€€‰½¬ˆ°(€€€€€€€€€¥Í}½„ô‘í‰½‘ä¹¥Í}½„€ôôôÑÉÕ•ôì½…}ÍÑ…ÑÕÌô‘í‰½‘ä¹½…}ÍÑ…ÑÕÌñð€ˆü‰ôì€‘í…‘‘•‘ôÁ‘˜±¥¹¬¡Ì¥€(€€€€€€€€¤ì(€€€€€ô(€€€ô(€ô(€¥˜€¡•¹…‰±•¹¡…Ì ‰½Á•¹…±•àˆ¤€˜˜¥‘•¹Ñ¥Ñä¹‘½¤¤ì(€€€½¹ÍÐÕÉ°€ô¡ÑÑÁÌè¼½…Á¤¹½Á•¹…±•à¹½Éœ½Ý½É­Ì½‘½¤è‘í•¹½‘•UI%½µÁ½¹•¹Ð¡¥‘•¹Ñ¥Ñä¹‘½¤¥ô‘íµ…¥°€ü€ýµ…¥±Ñ¼ô‘í•¹½‘•UI%½µÁ½¹•¹Ð¡µ…¥°¥õ€€è€ˆ‰õ€ì(€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥Ð™•Ñ¡)Í½¸¡™•Ñ¡%µÁ°°ÕÉ°°½ÁÑÌ¤ì(€€€¥˜€ …É•ÍÕ±Ð¹½¬¤¹½Ñ” ‰½Á•¹…±•àˆ°É•ÍÕ±Ð¹ÍÑ…ÑÕÌ€ôôô€ÐÀÐ€ü€‰½¬ˆ€è€‰•ÉÉ½Èˆ°É•ÍÕ±Ð¹‘•Ñ…¥°¤ì(€€€•±Í”ì(€€€€€½¹ÍÐÝ½É¬€ôÉ•ÍÕ±Ð¹‰½‘äñðíôì(€€€€€µ•Ñ„¹½…MÑ…ÑÕÌ€ôµ•Ñ„¹½…MÑ…ÑÕÌñðÝ½É¬¹½Á•¹}…•ÍÌü¹½…}ÍÑ…ÑÕÌñð¹Õ±°ì(€€€€€½¹ÍÐ±½…Ñ¥½¹Ì€ôl(€€€€€€€Ý½É¬¹‰•ÍÑ}½…}±½…Ñ¥½¸°(€€€€€€€€¸¸¹ÉÉ…ä¹¥ÍÉÉ…ä¡Ý½É¬¹±½…Ñ¥½¹Ì¤€üÝ½É¬¹±½…Ñ¥½¹Ì€èmt(€€€€€t¹™¥±Ñ•È ¡±½Œ¤€ôø±½Œ€˜˜±½Œ¹¥Í}½„€„ôô™…±Í”¤ì(€€€€€±•Ð…‘‘•€ô€Àì(€€€€€™½È€¡½¹ÍÐ±½Œ½˜±½…Ñ¥½¹Ì¤ì(€€€€€€€¥˜€¡½±±•Ñ½È¹…‘¡ì(€€€€€€€€€ÕÉ°è±½Œ¹Á‘™}ÕÉ°°(€€€€€€€€€Í½ÕÉ”è€‰½Á•¹…±•àˆ°(€€€€€€€€€­¥¹è€‰Á‘˜ˆ°(€€€€€€€€€±¥•¹Í”è±½Œ¹±¥•¹Í”ñð¹Õ±°°(€€€€€€€€€Ù•ÉÍ¥½¸è±½Œ¹Ù•ÉÍ¥½¸ñð¹Õ±°°(€€€€€€€€€¡½ÍÑQåÁ”è±½Œ¹Í½ÕÉ”ü¹ÑåÁ”ñð¹Õ±°(€€€€€€€ô¤¤(€€€€€€€€€…‘‘•€¬ô€Äì(€€€€€ô(€€€€€¥˜€¡¥‘•¹Ñ¥Ñä¹Áµ¥€ôô¹Õ±°€˜˜Ý½É¬¹¥‘Ìü¹Áµ¥¤(€€€€€€€¥‘•¹Ñ¥Ñä¹Áµ¥€ô¹½Éµ…±¥é•Aµ¥¡MÑÉ¥¹œ¡Ý½É¬¹¥‘Ì¹Áµ¥¤¹ÍÁ±¥Ð ˆ¼ˆ¤¹Á½À ¤¤ì(€€€€€¹½Ñ” ‰½Á•¹…±•àˆ°€‰½¬ˆ°¥Í}½„ô‘íÝ½É¬¹½Á•¹}…•ÍÌü¹¥Í}½„€ôôôÑÉÕ•ôì€‘í…‘‘•‘ôÁ‘˜±¥¹¬¡Ì¥€¤ì(€€€ô(€ô(€¥˜€¡•¹…‰±•¹¡…Ì ‰Í•µ…¹Ñ¥Í¡½±…Èˆ¤€˜˜¥‘•¹Ñ¥Ñä¹‘½¤¤ì(€€€½¹ÍÐÕÉ°€ô¡ÑÑÁÌè¼½…Á¤¹Í•µ…¹Ñ¥Í¡½±…È¹½Éœ½É…Á ½ØÄ½Á…Á•È½=$è‘í•¹½‘•UI%½µÁ½¹•¹Ð¡¥‘•¹Ñ¥Ñä¹‘½¤¥ôý™¥•±‘Ìõ½Á•¹•ÍÍA‘˜±•áÑ•É¹…±%‘Ì±¥Í=Á•¹•ÍÍ€ì(€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥Ð™•Ñ¡)Í½¸¡™•Ñ¡%µÁ°°ÕÉ°°½ÁÑÌ¤ì(€€€¥˜€ …É•ÍÕ±Ð¹½¬¤¹½Ñ” ‰Í•µ…¹Ñ¥Í¡½±…Èˆ°É•ÍÕ±Ð¹ÍÑ…ÑÕÌ€ôôô€ÐÀÐ€ü€‰½¬ˆ€è€‰•ÉÉ½Èˆ°É•ÍÕ±Ð¹‘•Ñ…¥°¤ì(€€€•±Í”ì(€€€€€½¹ÍÐÁ…Á•È€ôÉ•ÍÕ±Ð¹‰½‘äñðíôì(€€€€€½¹ÍÐ…‘‘•€ô½±±•Ñ½È¹…‘¡ì(€€€€€€€ÕÉ°èÁ…Á•È¹½Á•¹•ÍÍA‘˜ü¹ÕÉ°°(€€€€€€€Í½ÕÉ”è€‰Í•µ…¹Ñ¥Í¡½±…Èˆ°(€€€€€€€­¥¹è€‰Á‘˜ˆ°(€€€€€€€±¥•¹Í”èÁ…Á•È¹½Á•¹•ÍÍA‘˜ü¹±¥•¹Í”ñð¹Õ±°°(€€€€€€€¹½Ñ”èÁ…Á•È¹½Á•¹•ÍÍA‘˜ü¹ÍÑ…ÑÕÌñð¹Õ±°(€€€€€ô¤ì(€€€€€¥˜€ …¥‘•¹Ñ¥Ñä¹Áµ¥€˜˜Á…Á•È¹•áÑ•É¹…±%‘Ìü¹AÕ‰5•‘•¹ÑÉ…°¤(€€€€€€€¥‘•¹Ñ¥Ñä¹Áµ¥€ô¹½Éµ…±¥é•Aµ¥¡Á…Á•È¹•áÑ•É¹…±%‘Ì¹AÕ‰5•‘•¹ÑÉ…°¤ì(€€€€€½¹ÍÐ…Éá¥Ø€ôÁ…Á•È¹•áÑ•É¹…±%‘Ìü¹Éa¥Øì(€€€€€¥˜€¡…Éá¥Ø€˜˜€½ylÀ´åuìÑõp¹lÀ´åuìÐ°Õô¡Ùq¬¤ü¼¹Ñ•ÍÐ¡MÑÉ¥¹œ¡…Éá¥Ø¤¤¤(€€€€€€€½±±•Ñ½È¹…‘¡ì(€€€€€€€€€ÕÉ°è¡ÑÑÁÌè¼½…Éá¥Ø¹½Éœ½Á‘˜¼‘í…Éá¥Ùõ€°(€€€€€€€€€Í½ÕÉ”è€‰Í•µ…¹Ñ¥Í¡½±…Èˆ°(€€€€€€€€€­¥¹è€‰Á‘˜ˆ°(€€€€€€€€€¹½Ñ”è€‰…Éa¥Øˆ(€€€€€€€ô¤ì(€€€€€¹½Ñ” (€€€€€€€€‰Í•µ…¹Ñ¥Í¡½±…Èˆ°(€€€€€€€€‰½¬ˆ°(€€€€€€€¥Í=Á•¹•ÍÌô‘íÁ…Á•È¹¥Í=Á•¹•ÍÌ€ôôôÑÉÕ•ôì€‘í…‘‘•€ü€Ä€è€ÁôÁ‘˜±¥¹¬¡Ì¥€(€€€€€€¤ì(€€€ô(€ô(€¥˜€¡•¹…‰±•¹¡…Ì ‰É½ÍÍÉ•˜ˆ¤€˜˜¥‘•¹Ñ¥Ñä¹‘½¤¤ì(€€€½¹ÍÐÕÉ°€ô¡ÑÑÁÌè¼½…Á¤¹É½ÍÍÉ•˜¹½Éœ½Ý½É­Ì¼‘í•¹½‘•UI%½µÁ½¹•¹Ð¡¥‘•¹Ñ¥Ñä¹‘½¤¥ô‘íµ…¥°€ü€ýµ…¥±Ñ¼ô‘í•¹½‘•UI%½µÁ½¹•¹Ð¡µ…¥°¥õ€€è€ˆ‰õ€ì(€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥Ð™•Ñ¡)Í½¸¡™•Ñ¡%µÁ°°ÕÉ°°½ÁÑÌ¤ì(€€€¥˜€ …É•ÍÕ±Ð¹½¬¤¹½Ñ” ‰É½ÍÍÉ•˜ˆ°É•ÍÕ±Ð¹ÍÑ…ÑÕÌ€ôôô€ÐÀÐ€ü€‰½¬ˆ€è€‰•ÉÉ½Èˆ°É•ÍÕ±Ð¹‘•Ñ…¥°¤ì(€€€•±Í”ì(€€€€€½¹ÍÐµ•ÍÍ…”€ôÉ•ÍÕ±Ð¹‰½‘äü¹µ•ÍÍ…”ñðíôì(€€€€€±•Ð…‘‘•€ô€Àì(€€€€€™½È€¡½¹ÍÐ±¥¹¬½˜ÉÉ…ä¹¥ÍÉÉ…ä¡µ•ÍÍ…”¹±¥¹¬¤€üµ•ÍÍ…”¹±¥¹¬€èmt¤ì(€€€€€€€¥˜€¡MÑÉ¥¹œ¡±¥¹­l‰½¹Ñ•¹ÐµÑåÁ”‰tñð€ˆˆ¤¹Ñ½1½Ý•É…Í” ¤€„ôô€‰…ÁÁ±¥…Ñ¥½¸½Á‘˜ˆ¤½¹Ñ¥¹Õ”ì(€€€€€€€¥˜€¡½±±•Ñ½È¹…‘¡ì(€€€€€€€€€ÕÉ°è±¥¹¬¹UI0°(€€€€€€€€€Í½ÕÉ”è€‰É½ÍÍÉ•˜ˆ°(€€€€€€€€€­¥¹è€‰Á‘˜ˆ°(€€€€€€€€€±¥•¹Í”èÉÉ…ä¹¥ÍÉÉ…ä¡µ•ÍÍ…”¹±¥•¹Í”¤€üµ•ÍÍ…”¹±¥•¹Í•lÁtü¹UI0ñð¹Õ±°€è¹Õ±°°(€€€€€€€€€¹½Ñ”è±¥¹­l‰¥¹Ñ•¹‘•µ…ÁÁ±¥…Ñ¥½¸‰tñð¹Õ±°(€€€€€€€ô¤¤(€€€€€€€€€…‘‘•€¬ô€Äì(€€€€€ô(€€€€€¹½Ñ” ‰É½ÍÍÉ•˜ˆ°€‰½¬ˆ°€‘í…‘‘•‘ôÁÕ‰±¥Í¡•ÈÁ‘˜±¥¹¬¡Ì¥€¤ì(€€€ô(€ô(€…Ý…¥ÐÁµ±½Õ ¤ì(€É•ÑÕÉ¸ì(€€€€¸¸¹¥‘•¹Ñ¥Ñä°(€€€Ñ¥Ñ±”èµ•Ñ„¹Ñ¥Ñ±”°(€€€½…MÑ…ÑÕÌèµ•Ñ„¹½…MÑ…ÑÕÌ°(€€€±¥•¹Í”èµ•Ñ„¹±¥•¹Í”°(€€€…¹‘¥‘…Ñ•Ìè½±±•Ñ½È¹…¹‘¥‘…Ñ•Ì°(€€€ÅÕ•É¥•(€ôì)ô((¼¼Á…­…•Ì½É•Í•…É ½ÍÉŒ½Í½ÕÉ”µ…É¡¥Ù”µÁ½±¥ä¹ÑÌ)¥µÁ½ÉÐì‰…Í•¹…µ”°¥Í‰Í½±ÕÑ”…Ì¥Í‰Í½±ÕÑ”Ì°É•±…Ñ¥Ù”…ÌÉ•±…Ñ¥Ù”Ì°É•Í½±Ù”…ÌÉ•Í½±Ù”Ì°Í•À…ÌÍ•ÀÌô™É½´€‰¹½‘”éÁ…Ñ ˆì)Ù…ÈM=UI}Q=I%L€ôl‰Á…Á•ÉÌˆ°€‰ÍÕÁÁ±•µ•¹Ñ…Éäˆ°€‰Í½™ÑÝ…É”ˆ°€‰µ…¹Õ…±Ì‰tì)Ù…ÈU1Q}5a}	eQL€ô€ÔÀ€¨€ÄÀÈÐ€¨€ÄÀÈÐì)Ù…ÈU1Q}Q%5=UQ}5L€ô€Í”Ðì)™Õ¹Ñ¥½¸¥Í]¥Ñ¡¥¸¡É½½Ð°¡¥±¤ì(€½¹ÍÐÉ•°€ôÉ•±…Ñ¥Ù”Ì¡É•Í½±Ù”Ì¡É½½Ð¤°É•Í½±Ù”Ì¡¡¥±¤¤ì(€É•ÑÕÉ¸É•°€ôôô€ˆˆñð€…¥Í‰Í½±ÕÑ”Ì¡É•°¤€˜˜€…É•°¹ÍÑ…ÉÑÍ]¥Ñ ¡€¸¸‘íÍ•ÀÍõ€¤€˜˜É•°€„ôô€ˆ¸¸ˆ€˜˜€…É•°¹¥¹±Õ‘•Ì¡€¸¸‘íÍ•ÀÍõ€¤ì)ô)™Õ¹Ñ¥½¸Ù…±¥‘…Ñ•IÕ¹¥È¡É•ÍÕ±ÑÍI½½Ð°…¹‘¥‘…Ñ”¤ì(€½¹ÍÐÉÕ¹¥È€ôÉ•Í½±Ù”Ì¡…¹‘¥‘…Ñ”¤ì(€½¹ÍÐÉ•°€ôÉ•±…Ñ¥Ù”Ì¡É•Í½±Ù”Ì¡É•ÍÕ±ÑÍI½½Ð¤°ÉÕ¹¥È¤ì(€½¹ÍÐÁ…ÉÑÌ€ôÉ•°¹ÍÁ±¥Ð¡Í•ÀÌ¤ì(€¥˜€ …É•°ñð€…¥Í]¥Ñ¡¥¸¡É•ÍÕ±ÑÍI½½Ð°ÉÕ¹¥È¤ñðÁ…ÉÑÌ¹±•¹Ñ €„ôô€Èñð€…Á…ÉÑÍlÅtü¹ÍÑ…ÉÑÍ]¥Ñ  ‰ÉÕ¸´ˆ¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰ÉÕ¹}‘¥ÈµÕÍÐÁ½¥¹ÐÑ¼„ÉÕ¸‘¥É•Ñ½Éä‘¥É•Ñ±ä¥¹Í¥‘”Ñ¡”½¹™¥ÕÉ•É•ÍÕ±ÑÌÉ½½Ðˆ¤ì(€É•ÑÕÉ¸ÉÕ¹¥Èì)ô)™Õ¹Ñ¥½¸Í…™•¥±•¹…µ”¡¥¹ÁÕÐ°™…±±‰…¬¤ì(€½¹ÍÐÙ…±Õ”€ôMÑÉ¥¹œ¡¥¹ÁÕÐñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€½¹ÍÐ…¹‘¥‘…Ñ”€ôl¸¸¹‰…Í•¹…µ”¡Ù…±Õ”¥t¹µ…À ¡¡…È¤€ôø¡…È¹¡…É½‘•Ð À¤€ð€ÌÈñð€œðøèˆ½qqðü¨œ¹¥¹±Õ‘•Ì¡¡…È¤€ü€ˆ´ˆ€è¡…È¤¹©½¥¸ ˆˆ¤¹É•Á±…” ½qÌ¬½œ°€ˆ€ˆ¤¹ÑÉ¥´ ¤ì(€¥˜€ ……¹‘¥‘…Ñ”ñð…¹‘¥‘…Ñ”€ôôô€ˆ¸ˆñð…¹‘¥‘…Ñ”€ôôô€ˆ¸¸ˆ¤É•ÑÕÉ¸™…±±‰…¬ì(€É•ÑÕÉ¸…¹‘¥‘…Ñ”¹Í±¥” À°€ÄàÀ¤ì)ô)™Õ¹Ñ¥½¸±½½­Í1¥­•¡…±±•¹”¡ÍÑ…ÑÕÌÈ°½¹Ñ•¹ÑQåÁ”°Í…µÁ±”¤ì(€¥˜€¡lÐÀÄ°€ÐÀÌ°€ÐÀÜ°€ÐÈåt¹¥¹±Õ‘•Ì¡ÍÑ…ÑÕÌÈ¤¤É•ÑÕÉ¸ÑÉÕ”ì(€¥˜€ …½¹Ñ•¹ÑQåÁ”¹Ñ½1½Ý•É…Í” ¤¹¥¹±Õ‘•Ì ‰Ñ•áÐ½¡Ñµ°ˆ¤¤É•ÑÕÉ¸™…±Í”ì(€É•ÑÕÉ¸€½˜µ¡±ñ±½Õ‘™±…É•ñ…ÁÑ¡…ñÙ•É¥™äå½Ô…É”¡Õµ…¹ñ…•ÍÌ‘•¹¥•‘ñÍ¥¸¥¹ñ±½œ¥¹ñ±½¥¸É•ÅÕ¥É•½¤¹Ñ•ÍÐ (€€€Í…µÁ±”(€€¤ì)ô)Ù…È1=U1I}	=d€ô€½˜µ¡±ñ¡…±±•¹”µÁ±…Ñ™½Éµñ©ÕÍÐ„µ½µ•¹Ññ¡•­¥¹œå½ÕÈ‰É½ÝÍ•È½¤ì)™Õ¹Ñ¥½¸±½½­Í1¥­•±½Õ‘™±…É”¡¡•…‘•ÉÌ°Í…µÁ±”¤ì(€¥˜€¡¡•…‘•ÉY…±Õ”¡¡•…‘•ÉÌ°€‰˜µµ¥Ñ¥…Ñ•ˆ¤¤É•ÑÕÉ¸ÑÉÕ”ì(€É•ÑÕÉ¸1=U1I}	=d¹Ñ•ÍÐ¡Í…µÁ±”€üü€ˆˆ¤ì)ô)™Õ¹Ñ¥½¸¡•…‘•ÉY…±Õ”¡¡•…‘•ÉÌ°¹…µ”¤ì(€¥˜€ …¡•…‘•ÉÌñðÑåÁ•½˜¡•…‘•ÉÌ€„ôô€‰½‰©•Ðˆ¤É•ÑÕÉ¸€ˆˆì(€½¹ÍÐÉ•…‘…‰±”€ô¡•…‘•ÉÌì(€¥˜€¡ÑåÁ•½˜É•…‘…‰±”¹•Ð€ôôô€‰™Õ¹Ñ¥½¸ˆ¤É•ÑÕÉ¸MÑÉ¥¹œ¡É•…‘…‰±”¹•Ð¡¹…µ”¤€üü€ˆˆ¤¹ÑÉ¥´ ¤ì(€™½È€¡½¹ÍÐm­•ä°Ù…±Õ•t½˜=‰©•Ð¹•¹ÑÉ¥•Ì¡¡•…‘•ÉÌ¤¤ì(€€€¥˜€¡­•ä¹Ñ½1½Ý•É…Í” ¤€ôôô¹…µ”¹Ñ½1½Ý•É…Í” ¤¤É•ÑÕÉ¸MÑÉ¥¹œ¡Ù…±Õ”€üü€ˆˆ¤¹ÑÉ¥´ ¤ì(€ô(€É•ÑÕÉ¸€ˆˆì)ô)™Õ¹Ñ¥½¸±½Õ‘™±…É•Í­½Áä ¤ì(€¥˜€¡MÑÉ¥¹œ¡ÁÉ½•ÍÌ¹•¹Ø¹I=9}IA1e}19Uñð€ˆˆ¤¹Ñ½1½Ý•É…Í” ¤¹ÍÑ…ÉÑÍ]¥Ñ  ‰é ˆ¤¤ì(€€€É•ÑÕÉ¸ì(€€€€€Ñ¥Ñ±”è€‰qÔäÜÀÁqÔàäàÅqÔÑØÁqÔÕáqÔØÈÄÁqÔÙÑqÔàåáqÔÔØØáqÔåáqÔá	Äˆ°(€€€€€‰½‘äè€‰qÔáåqÔØØÉ±½Õ‘™±…É”qÔÑ	qÔØÜÍqÔåáqÔá	ÅqÔÌÀÀÉqÔá	ÝqÔÔÜÈáqÔÕÉqÔÝqÔØÈÔÍqÔÕÀÁqÔÜØàÑqÔÝäÝqÔÔÍÍqÔäÅqÔÕáqÔØÈÄÁqÕÁqÔÝÁ	qÔÕáqÔÑÁqÔÑÅqÔÝÕqÔáÝqÔÌÀÀÈˆ°(€€€€€½¹Ñ¥¹Õ•1…‰•°è€‰qÔØÈÄÅqÔÕÉqÔÕáqÔØÈÄÁqÕÁqÔÝÝqÔÝˆ°(€€€€€Í­¥Á1…‰•°è€‰qÔáÍqÔáÝqÔáåqÔÑÉqÔØÜØÕqÔÙäÀˆ°(€€€€€É•ÑÉå9½Ñ”è€‰qÔá	ÝqÔäÅqÔØÕÁqÔá		qÔÔÍÙqÔÔÐÁqÔÑÀÁqÔäàÜÕqÔäÜØÉqÕÁqÔÑÁqÔàäàÅqÔÝÕqÔáÝqÕÁqÔÔÈÅqÔØÈÑqÔÜØàÑqÔØÌÄÅqÔØÈÄáqÔäàÜÕqÔÑÁqÔØØÉqÔá	ÅqÔØÌÙˆ°(€€€€€Í­¥Á9½Ñ”è€‰qÔÕÉqÔáÍqÔáÝqÔáåqÔÑÉqÔØÜØÕqÔÙäÁqÔÌÀÀÉqÔØÌÄÅqÔØÈÄáqÔäàÜÕqÔÑÁqÔØØÉqÔá	ÅqÔØÌÙqÕÁqÔÑÁqÔàäàÅqÔäÅqÔá	ÕqÕÁqÔÑÕqÔÑÁqÔàäàÅqÔÝÕqÔáÝqÔÌÀÀÈˆ(€€€ôì(€ô(€É•ÑÕÉ¸ì(€€€Ñ¥Ñ±”è€‰	É½ÝÍ•ÈÙ•É¥™¥…Ñ¥½¸¹••‘•ˆ°(€€€‰½‘äè€‰Q¡¥Ì¥Ì„±½Õ‘™±…É”¡Õµ…¸¡•¬¸¥¹¥Í ¥Ð¥¸Ñ¡”‰É½ÝÍ•ÈÝ¥¹‘½ÜÑ¡…Ð¥Ì…±É•…‘ä½Á•¸¸Q¡”ÁÉ½É…´Ý¥±°¹½Ð‰åÁ…ÍÌ¥Ð¸ˆ°(€€€½¹Ñ¥¹Õ•1…‰•°è€‰$Ù”™¥¹¥Í¡•°½¹Ñ¥¹Õ”ˆ°(€€€Í­¥Á1…‰•°è€‰M­¥ÀÑ¡¥ÌÍ½ÕÉ”ˆ°(€€€É•ÑÉå9½Ñ”è€‰I”µÉ•…Ñ¡”Í…µ”Á…”¸¼¹½Ð‰åÁ…ÍÌ¥Ð¸Q¡”¡…±±•¹”Á…”å½Ô©ÕÍÐÍ…Ü¥Ì¹½Ð•Ù¥‘•¹”¸ˆ°(€€€Í­¥Á9½Ñ”è€‰Q¡¥ÌÍ½ÕÉ”Ý…ÌÍ­¥ÁÁ•¸Q¡”¡…±±•¹”Á…”¥Ì¹½Ð•Ù¥‘•¹”¸¼¹½ÐÉ•ÑÉä…¹‘¼¹½Ð‰åÁ…ÍÌ¥Ð¸ˆ(€ôì)ô)™Õ¹Ñ¥½¸¡…Í5…¥Œ¡‰åÑ•Ì¤ì(€¥˜€¡‰åÑ•Ì¹±•¹Ñ €øô€Ô€˜˜¹•ÜQ•áÑ•½‘•È ¤¹‘•½‘”¡‰åÑ•Ì¹ÍÕ‰…ÉÉ…ä À°€Ô¤¤€ôôô€ˆ•A´ˆ¤É•ÑÕÉ¸ÑÉÕ”ì(€¥˜€¡‰åÑ•Ì¹±•¹Ñ €øô€Ð€˜˜‰åÑ•ÍlÁt€ôôô€àÀ€˜˜‰åÑ•ÍlÅt€ôôô€ÜÔ€˜˜€¡‰åÑ•ÍlÉt€ôôô€Ìñð‰åÑ•ÍlÉt€ôôô€Ôñð‰åÑ•ÍlÉt€ôôô€Ü¤¤(€€€É•ÑÕÉ¸ÑÉÕ”ì(€É•ÑÕÉ¸‰åÑ•Ì¹±•¹Ñ €øô€È€˜˜‰åÑ•ÍlÁt€ôôô€ÌÄ€˜˜‰åÑ•ÍlÅt€ôôô€ÄÌäì)ô)™Õ¹Ñ¥½¸Ù…±¥‘…Ñ•½¹Ñ•¹Ð¡…Ñ•½Éä°½¹Ñ•¹ÑQåÁ”°™¥±•¹…µ”°‰åÑ•Ì¤ì(€½¹ÍÐµ¥µ”€ô½¹Ñ•¹ÑQåÁ”¹Ñ½1½Ý•É…Í” ¤¹ÍÁ±¥Ð ˆìˆ°€Ä¥lÁtü¹ÑÉ¥´ ¤€üü€ˆˆì(€½¹ÍÐ¡•…€ô¹•ÜQ•áÑ•½‘•È ¤¹‘•½‘”¡‰åÑ•Ì¹ÍÕ‰…ÉÉ…ä À°€ÄØ¤¤ì(€½¹ÍÐ•á•ÕÑ…‰±”€ô€½p¸ üé•á•ñ‘±±ñµÍ¥ñ½µñ‰…Ññµ‘ñÁÌÅñÍ ¤½¤¹Ñ•ÍÐ¡™¥±•¹…µ”¤ñð€½…ÁÁ±¥…Ñ¥½¹p¼ üéàµµÍ‘½Ý¹±½…‘ñàµ‘½Í•á•Œ¤¼¹Ñ•ÍÐ¡µ¥µ”¤ì(€¥˜€¡•á•ÕÑ…‰±”¤É•ÑÕÉ¸ì½¬è™…±Í”°É•…Í½¸è€‰•á•ÕÑ…‰±”½¹Ñ•¹Ð¥Ì¹½Ð…É¡¥Ù•ˆôì(€¥˜€¡…Ñ•½Éä€ôôô€‰Á…Á•ÉÌˆ€˜˜€…¡•…¹ÍÑ…ÉÑÍ]¥Ñ  ˆ•A´ˆ¤¤(€€€É•ÑÕÉ¸ì½¬è™…±Í”°É•…Í½¸è€‰Á…Á•ÉÌµÕÍÐ‰”A½¹Ñ•¹Ðˆôì(€¥˜€¡…Ñ•½Éä€ôôô€‰ÍÕÁÁ±•µ•¹Ñ…Éäˆ€˜˜€„¡µ¥µ”¹¥¹±Õ‘•Ì ‰Á‘˜ˆ¤ñðµ¥µ”¹¥¹±Õ‘•Ì ‰é¥Àˆ¤ñðµ¥µ”¹¥¹±Õ‘•Ì ‰é¥Àˆ¤ñð¡…Í5…¥Œ¡‰åÑ•Ì¤¤¤(€€€É•ÑÕÉ¸ì½¬è™…±Í”°É•…Í½¸è€‰Õ¹ÍÕÁÁ½ÉÑ•ÍÕÁÁ±•µ•¹Ñ…Éä5%5½È™¥±”Í¥¹…ÑÕÉ”ˆôì(€¥˜€¡…Ñ•½Éä€ôôô€‰Í½™ÑÝ…É”ˆ€˜˜µ¥µ”€ôôô€‰Ñ•áÐ½¡Ñµ°ˆ¤(€€€É•ÑÕÉ¸ì½¬è™…±Í”°É•…Í½¸è€‰!Q50¥Ì¹½Ð„Í½™ÑÝ…É”…É¡¥Ù”ˆôì(€¥˜€¡…Ñ•½Éä€ôôô€‰µ…¹Õ…±Ìˆ€˜˜€…µ¥µ”€˜˜€…‰åÑ•Ì¹±•¹Ñ ¤É•ÑÕÉ¸ì½¬è™…±Í”°É•…Í½¸è€‰•µÁÑäµ…¹Õ…°½¹Ñ•¹Ðˆôì(€É•ÑÕÉ¸ì½¬èÑÉÕ”°µ¥µ”ôì)ô)™Õ¹Ñ¥½¸¹½Éµ…±¥é•5•Ñ…‘…Ñ„¡µ•Ñ…‘…Ñ„€ôíô¤ì(€½¹ÍÐ…±±½Ý•€ôl(€€€€‰‘½¤ˆ°(€€€€‰Áµ¥ˆ°(€€€€‰Áµ¥ˆ°(€€€€‰½µµ¥Ðˆ°(€€€€‰Ù•ÉÍ¥½¸ˆ°(€€€€‰±¥•¹Í”ˆ°(€€€€‰Ñ¥Ñ±”ˆ°(€€€€‰…ÕÑ¡½ÉÌˆ°(€€€€‰É•Á½Í¥Ñ½Éäˆ°(€€€€‰½Á•¹}…•ÍÌˆ(€tì(€É•ÑÕÉ¸=‰©•Ð¹™É½µ¹ÑÉ¥•Ì (€€€…±±½Ý•¹™¥±Ñ•È ¡­•ä¤€ôøµ•Ñ…‘…Ñ…m­•åt€„ô¹Õ±°€˜˜MÑÉ¥¹œ¡µ•Ñ…‘…Ñ…m­•åt¤¹ÑÉ¥´ ¤€„ôô€ˆˆ¤¹µ…À ¡­•ä¤€ôøm­•ä°µ•Ñ…‘…Ñ…m­•åut¤(€€¤ì)ô((¼¼Á…­…•Ì½É•Í•…É ½ÍÉŒ½Í½ÕÉ”µ‘•±¥Ù•Éä¹ÑÌ)™Õ¹Ñ¥½¸…ÍÍ•ÍÍ5…¹Õ…±A…”¡‰åÑ•Ì°½¹Ñ•¹ÑQåÁ”°ÕÉ°¤ì(€¥˜€ „½¡Ñµ°½¤¹Ñ•ÍÐ¡MÑÉ¥¹œ¡½¹Ñ•¹ÑQåÁ”ñð€ˆˆ¤¤¤ì(€€€É•ÑÕÉ¸ì(€€€€€ÍÑ…ÑÕÌè€‰‘½Õµ•¹ÐµÕ¹…ÍÍ•ÍÍ•ˆ°(€€€€€½µÁ±•Ñ”è™…±Í”°(€€€€€…¹‘¥‘…Ñ•Ìèmt°(€€€€€¹½Ñ”è€‰½¹Ñ•¹Ð½µÁ±•Ñ•¹•ÍÌ…¹Ù•ÉÍ¥½¸ÍÑ¥±°¹••¥¹ÍÁ•Ñ¥½¸¸ˆ(€€€ôì(€ô(€½¹ÍÐ¡Ñµ°€ô¹•ÜQ•áÑ•½‘•È ¤¹‘•½‘”¡‰åÑ•Ì¤¹Í±¥” À°€ÈÕ”Ð¤ì(€½¹ÍÐÑ•áÐÌ€ô¡Ñµ°¹É•Á±…” ¼ð¡ÍÉ¥ÁÑñÍÑå±”¥q‰mxùt¨ùmqÍqMt¨üñp½pÄø½¤°€ˆ€ˆ¤¹É•Á±…” ¼ñmxùt¨ø½œ°€ˆ€ˆ¤ì(€½¹ÍÐ™±…Ì€ôl¸¸¹¹•ÜM•Ð¡Ñ•áÐÌ¹µ…Ñ  ¼ üéyñqÌ¤µìÄ°Éõm„µéµium„µéµhÀ´å|µuìÈ±ô½œ¤ñðmt¥tì(€½¹ÍÐ…¹‘¥‘…Ñ•Ì€ômtì(€™½È€¡½¹ÍÐµ…Ñ ½˜¡Ñµ°¹µ…Ñ¡±° ¼ñ…q‰mxùt©¡É•˜õlˆt¡mxˆt¬¥lˆumxùt¨ø¡mqÍqMt¨ü¤ñp½„ø½¤¤¤ì(€€€ÑÉäì(€€€€€½¹ÍÐ¡É•˜€ôµ…Ñ¡lÅtì(€€€€€½¹ÍÐ±…‰•°È€ôµ…Ñ¡lÉtì(€€€€€¥˜€ …¡É•˜ñð±…‰•°È€ôôôÙ½¥€À¤½¹Ñ¥¹Õ”ì(€€€€€½¹ÍÐÉ•Í½±Ù•€ô¹•ÜUI0¡¡É•˜¹É•Á±…” ¼™…µÀì½œ°€ˆ˜ˆ¤°ÕÉ°¤ì(€€€€€½¹ÍÐ‰…Í”€ô¹•ÜUI0¡ÕÉ°¤ì(€€€€€É•Í½±Ù•¹¡…Í €ô€ˆˆì(€€€€€½¹ÍÐÑ¥Ñ±”€ô±…‰•°È¹É•Á±…” ¼ñmxùt¨ø½œ°€ˆ€ˆ¤¹É•Á±…” ½qÌ¬½œ°€ˆ€ˆ¤¹ÑÉ¥´ ¤¹Í±¥” À°€ÄØÀ¤ì(€€€€€¥˜€¡É•Í½±Ù•¹½É¥¥¸€„ôô‰…Í”¹½É¥¥¸ñð€„½y¡ÑÑÁÌüè¼¹Ñ•ÍÐ¡É•Í½±Ù•¹ÁÉ½Ñ½½°¤ñðÉ•Í½±Ù•¹ÕÍ•É¹…µ”ñðÉ•Í½±Ù•¹Á…ÍÍÝ½Éñð€„½µ…¹Õ…±ñ½ÁÑ¥½¹ñ½µµ…¹‘ñÁ…É…µ•Ñ•ÉñÕÍ…•ñ…±¥¹ñ¥¹ÍÑ…±±ñÉ•™•É•¹”½¤¹Ñ•ÍÐ (€€€€€€€€‘íÑ¥Ñ±•ô€‘íÉ•Í½±Ù•¹Á…Ñ¡¹…µ•õ€(€€€€€€¤ñðÉ•Í½±Ù•¹¡É•˜€ôôô‰…Í”¹¡É•˜ñð…¹‘¥‘…Ñ•Ì¹Í½µ” ¡…¹‘¥‘…Ñ”¤€ôø…¹‘¥‘…Ñ”¹ÕÉ°€ôôôÉ•Í½±Ù•¹¡É•˜¤¤(€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€…¹‘¥‘…Ñ•Ì¹ÁÕÍ ¡ìÕÉ°èÉ•Í½±Ù•¹¡É•˜°Ñ¥Ñ±”ô¤ì(€€€€€¥˜€¡…¹‘¥‘…Ñ•Ì¹±•¹Ñ €øô€ÄÈ¤‰É•…¬ì(€€€ô…Ñ ì(€€€ô(€ô(€É•ÑÕÉ¸ì(€€€ÍÑ…ÑÕÌè™±…Ì¹±•¹Ñ €øô€Ô€ü€‰É•™•É•¹”µÁ…”µ½¹±äˆ€è€‰±…¹‘¥¹œµ½Èµ½Ù•ÉÙ¥•ÜµÁ…”ˆ°(€€€½µÁ±•Ñ”è™…±Í”°(€€€½ÁÑ¥½¹½Õ¹Ðè™±…Ì¹±•¹Ñ °(€€€…¹‘¥‘…Ñ•Ì°(€€€¹½Ñ”è€‰!•ÕÉ¥ÍÑ¥ŒÁ…”±…ÍÍ¥™¥…Ñ¥½¸°¹½Ð„½µÁ±•Ñ•¹•ÍÌ½ÈÍ¥•¹Ñ¥™¥ŒÙ•É¥™¥…Ñ¥½¸É•ÍÕ±Ð¸ˆ(€ôì)ô((¼¼Á…­…•Ì½É•Í•…É ½ÍÉŒ½Í½ÕÉ”µ…É¡¥Ù”¹ÑÌ)™Õ¹Ñ¥½¸™¥±•¹…µ•É½µI•ÍÁ½¹Í”¡É•ÍÁ½¹Í”°ÕÉ°°…Ñ•½Éä¤ì(€½¹ÍÐ‘¥ÍÁ½Í¥Ñ¥½¸€ôÉ•ÍÁ½¹Í”¹¡•…‘•ÉÌ¹•Ð ‰½¹Ñ•¹Ðµ‘¥ÍÁ½Í¥Ñ¥½¸ˆ¤ñð€ˆˆì(€½¹ÍÐµ…Ñ €ô‘¥ÍÁ½Í¥Ñ¥½¸¹µ…Ñ  ½™¥±•¹…µ•p¨üô üéUQ´àœðˆ¤ü¡mxì‰t¬¤½¤¤ì(€±•Ð™¥±•¹…µ”€ôµ…Ñ €ü‘•½‘•UI%½µÁ½¹•¹Ð¡µ…Ñ¡lÅt¹ÑÉ¥´ ¤¤€è€ˆˆì(€¥˜€ …™¥±•¹…µ”¤ì(€€€ÑÉäì(€€€€€™¥±•¹…µ”€ô‰…Í•¹…µ”È¡¹•ÜUI0¡ÕÉ°¤¹Á…Ñ¡¹…µ”¤ì(€€€ô…Ñ ì(€€€ô(€ô(€½¹ÍÐ™…±±‰…¬€ô€‘í…Ñ•½Éåô´‘ì ¼¨}}AUI}|€¨¼¹•Ü…Ñ” ¤¤¹Ñ½%M=MÑÉ¥¹œ ¤¹É•Á±…” ½l´è¹Qit½œ°€ˆˆ¤¹Í±¥” À°€ÄÐ¥ô¹‰¥¹€ì(€É•ÑÕÉ¸Í…™•¥±•¹…µ”¡™¥±•¹…µ”°™…±±‰…¬¤ì)ô)…Íå¹Œ™Õ¹Ñ¥½¸…Ñ½µ¥)Í½¸¡™¥±”°Ù…±Õ”¤ì(€…Ý…¥Ðµ­‘¥È¡‘¥É¹…µ”¡™¥±”¤°ìÉ•ÕÉÍ¥Ù”èÑÉÕ”ô¤ì(€½¹ÍÐÑ•µÀ€ô€‘í™¥±•ô¸‘íÉ…¹‘½µUU%È ¥ô¹ÑµÁ€ì(€…Ý…¥ÐÝÉ¥Ñ•¥±”È¡Ñ•µÀ°€‘í)M=8¹ÍÑÉ¥¹¥™ä¡Ù…±Õ”°¹Õ±°°€È¥ô)€°€‰ÕÑ˜àˆ¤ì(€…Ý…¥ÐÉ•¹…µ”È¡Ñ•µÀ°™¥±”¤ì)ô)…Íå¹Œ™Õ¹Ñ¥½¸Ý¥Ñ¡IÕ¹1½¬¡Á½ÉÑÌ°­•ä°™¸¤ì(€É•ÑÕÉ¸Á½ÉÑÌ¹•á±ÕÍ¥Ù”¡­•ä°™¸¤ì)ô)…Íå¹Œ™Õ¹Ñ¥½¸É•…‘5…¹¥™•ÍÐ¡™¥±”°ÉÕ¹¥È¤ì(€ÑÉäì(€€€½¹ÍÐÁ…ÉÍ•€ô)M=8¹Á…ÉÍ”¡…Ý…¥ÐÉ•…‘¥±”Ì¡™¥±”°€‰ÕÑ˜àˆ¤¤ì(€€€¥˜€ …Á…ÉÍ•ñðÑåÁ•½˜Á…ÉÍ•€„ôô€‰½‰©•Ðˆñð€…ÉÉ…ä¹¥ÍÉÉ…ä¡Á…ÉÍ•¹¥Ñ•µÌ¤¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰¥¹Ù…±¥µ…¹¥™•ÍÐˆ¤ì(€€€É•ÑÕÉ¸Á…ÉÍ•ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€¥˜€¡•ÉÉ½È¹½‘”€„ôô€‰9=9Pˆ¤Ñ¡É½Ü•ÉÉ½Èì(€€€É•ÑÕÉ¸ìÙ•ÉÍ¥½¸è€Ä°ÉÕ¹}‘¥ÈèÉÕ¹¥È°ÕÁ‘…Ñ•‘}…Ðè¹Õ±°°¥Ñ•µÌèmtôì(€ô)ô)…Íå¹Œ™Õ¹Ñ¥½¸Ù•É¥™å5…¹¥™•ÍÑ%Ñ•µÌ¡µ…¹¥™•ÍÐ°ÉÕ¹¥È¤ì(€½¹ÍÐ‘½Ý¹±½…‘•€ôµ…¹¥™•ÍÐ¹¥Ñ•µÌ¹™¥±Ñ•È ¡•¹ÑÉä¤€ôø•¹ÑÉäü¹ÍÑ…ÑÕÌ€ôôô€‰‘½Ý¹±½…‘•ˆ¤ì(€¥˜€¡‘½Ý¹±½…‘•¹±•¹Ñ €ôôô€À¤É•ÑÕÉ¸ì½¬èÑÉÕ”°¥Ñ•µÌèmtôì(€±•ÐÍ½ÕÉ•ÍI½½Ðì(€ÑÉäì(€€€Í½ÕÉ•ÍI½½Ð€ô…Ý…¥ÐÉ•…±Á…Ñ Ì¡©½¥¸È¡ÉÕ¹¥È°€‰Í½ÕÉ•Ìˆ¤¤ì(€ô…Ñ ì(€€€É•ÑÕÉ¸ì(€€€€€½¬è™…±Í”°(€€€€€¥Ñ•µÌè‘½Ý¹±½…‘•¹µ…À ¡¥Ñ•´¤€ôø€¡ì(€€€€€€€¥è¥Ñ•´¹¥€üü¹Õ±°°(€€€€€€€Á…Ñ è¥Ñ•´¹Á…Ñ €üü¥Ñ•´¹±½…±}Á…Ñ €üü¹Õ±°°(€€€€€€€½¬è™…±Í”°(€€€€€€€É•…Í½¸è€‰Í½ÕÉ•Ì‘¥É•Ñ½Éä¥Ìµ¥ÍÍ¥¹œˆ(€€€€€ô¤¤(€€€ôì(€ô(€½¹ÍÐ¥Ñ•µÌÈ€ômtì(€™½È€¡½¹ÍÐ¥Ñ•´½˜‘½Ý¹±½…‘•¤ì(€€€½¹ÍÐÁ…Ñ €ôÑåÁ•½˜¥Ñ•´¹Á…Ñ €ôôô€‰ÍÑÉ¥¹œˆ€ü¥Ñ•´¹Á…Ñ €èÑåÁ•½˜¥Ñ•´¹±½…±}Á…Ñ €ôôô€‰ÍÑÉ¥¹œˆ€ü¥Ñ•´¹±½…±}Á…Ñ €è€ˆˆì(€€€¥˜€ …Á…Ñ ¤ì(€€€€€¥Ñ•µÌÈ¹ÁÕÍ ¡ì¥è¥Ñ•´¹¥€üü¹Õ±°°Á…Ñ è¹Õ±°°½¬è™…±Í”°É•…Í½¸è€‰µ¥ÍÍ¥¹œµ…¹¥™•ÍÐÁ…Ñ ˆô¤ì(€€€€€½¹Ñ¥¹Õ”ì(€€€ô(€€€ÑÉäì(€€€€€½¹ÍÐ…¹½¹¥…°È€ô…Ý…¥ÐÉ•…±Á…Ñ Ì¡¥Í‰Í½±ÕÑ”Ð¡Á…Ñ ¤€üÁ…Ñ €èÉ•Í½±Ù”Ð¡ÉÕ¹¥È°Á…Ñ ¤¤ì(€€€€€¥˜€ …¥Í]¥Ñ¡¥¸¡Í½ÕÉ•ÍI½½Ð°…¹½¹¥…°È¤¤Ñ¡É½Ü¹•ÜÉÉ½È ‰Á…Ñ •Í…Á•ÌÉÕ¸Í½ÕÉ•Ìˆ¤ì(€€€€€½¹ÍÐ‰åÑ•Ì€ô…Ý…¥ÐÉ•…‘¥±”Ì¡…¹½¹¥…°È¤ì(€€€€€½¹ÍÐÍ¡„ÈÔØÈ€ôÉ•…Ñ•!…Í Ô ‰Í¡„ÈÔØˆ¤¹ÕÁ‘…Ñ”¡‰åÑ•Ì¤¹‘¥•ÍÐ ‰¡•àˆ¤ì(€€€€€¥˜€¡Í¡„ÈÔØÈ€„ôôMÑÉ¥¹œ¡¥Ñ•´¹Í¡„ÈÔØñð€ˆˆ¤¹Ñ½1½Ý•É…Í” ¤¤Ñ¡É½Ü¹•ÜÉÉ½È ‰Í¡„ÈÔØµ¥Íµ…Ñ ˆ¤ì(€€€€€¥˜€¡¥Ñ•´¹Í¥é•}‰åÑ•Ì€„ôôÙ½¥€À€˜˜9Õµ‰•È¡¥Ñ•´¹Í¥é•}‰åÑ•Ì¤€„ôô‰åÑ•Ì¹‰åÑ•1•¹Ñ ¤(€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰Í¥é”µ¥Íµ…Ñ ˆ¤ì(€€€€€¥Ñ•µÌÈ¹ÁÕÍ ¡ì¥è¥Ñ•´¹¥€üü¹Õ±°°Á…Ñ è…¹½¹¥…°È°½¬èÑÉÕ”°Í¡„ÈÔØèÍ¡„ÈÔØÈ°Í¥é•}‰åÑ•Ìè‰åÑ•Ì¹‰åÑ•1•¹Ñ ô¤ì(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€¥Ñ•µÌÈ¹ÁÕÍ ¡ì¥è¥Ñ•´¹¥€üü¹Õ±°°Á…Ñ °½¬è™…±Í”°É•…Í½¸èMÑÉ¥¹œ¡•ÉÉ½Èü¹µ•ÍÍ…”ñð•ÉÉ½È¤ô¤ì(€€€ô(€ô(€É•ÑÕÉ¸ì½¬è¥Ñ•µÌÈ¹•Ù•Éä ¡¥Ñ•´¤€ôø¥Ñ•´¹½¬€ôôôÑÉÕ”¤°¥Ñ•µÌè¥Ñ•µÌÈôì)ô)…Íå¹Œ™Õ¹Ñ¥½¸…ÁÁ•¹‘…¥±ÕÉ”¡™¥±”°™…¥±ÕÉ”¤ì(€±•Ð½É¥¥¹…°€ô€ˆŒM½ÕÉ”‘½Ý¹±½…™…¥±ÕÉ•Íq¹q¸ˆì(€ÑÉäì(€€€½É¥¥¹…°€ô…Ý…¥ÐÉ•…‘¥±”Ì¡™¥±”°€‰ÕÑ˜àˆ¤ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€¥˜€¡•ÉÉ½È¹½‘”€„ôô€‰9=9Pˆ¤Ñ¡É½Ü•ÉÉ½Èì(€ô(€½¹ÍÐ±¥¹•Ì€ôl(€€€€ŒŒ€‘í™…¥±ÕÉ”¹™…¥±•‘}…ÑôqáÜ€‘í™…¥±ÕÉ”¹…Ñ•½Éåõ€°(€€€€´UI0è€‘í™…¥±ÕÉ”¹ÕÉ±õ€°(€€€€´I•…Í½¸è€‘í™…¥±ÕÉ”¹É•…Í½¹õ€°(€€€€´	É½ÝÍ•ÈÉ•ÅÕ¥É•è€‘í™…¥±ÕÉ”¹‰É½ÝÍ•É}É•ÅÕ¥É•€ü€‰å•Ìˆ€è€‰¹¼‰õ€(€tì(€¥˜€¡™…¥±ÕÉ”¹‰É½ÝÍ•É}¡…¹‘½™˜¤±¥¹•Ì¹ÁÕÍ ¡€´	É½ÝÍ•È¡…¹‘½™˜è€‘í™…¥±ÕÉ”¹‰É½ÝÍ•É}¡…¹‘½™˜¹ÕÉ±õ€¤ì(€¥˜€¡™…¥±ÕÉ”¹½Á•¹}…•ÍÌ¤ì(€€€½¹ÍÐ½„€ô™…¥±ÕÉ”¹½Á•¹}…•ÍÌì(€€€±¥¹•Ì¹ÁÕÍ  (€€€€€€´=Á•¸…•ÍÌè€‘í½„¹‘½¤ñð½„¹Áµ¥ñð€ˆü‰ôqáÜ½…}ÍÑ…ÑÕÌô‘í½„¹½…}ÍÑ…ÑÕÌñð€‰Õ¹­¹½Ý¸‰ôqáÜÍ½ÕÉ•Ìô‘ì¡½„¹ÅÕ•É¥•ñðmt¤¹µ…À ¡Ä¤€ôø€‘íÄ¹Í½ÕÉ•ôè‘íÄ¹ÍÑ…ÑÕÍõ€¤¹©½¥¸ ˆ°ˆ¥õ€(€€€€¤ì(€€€™½È€¡½¹ÍÐ…ÑÑ•µÁÐ½˜½„¹…ÑÑ•µÁÑÌñðmt¤(€€€€€±¥¹•Ì¹ÁÕÍ ¡€€€´ÑÉ¥•€‘í…ÑÑ•µÁÐ¹ÕÉ±ô€ ‘í…ÑÑ•µÁÐ¹Í½ÕÉ•ô¤è€‘í…ÑÑ•µÁÐ¹É•…Í½¹õ€¤ì(€€€¥˜€¡™…¥±ÕÉ”¹µ…¹Õ…±}¥µÁ½ÉÐ¤±¥¹•Ì¹ÁÕÍ ¡€´5…¹Õ…°¥µÁ½ÉÐè€‘í™…¥±ÕÉ”¹µ…¹Õ…±}¥µÁ½ÉÐ¹¡½Ýõ€¤ì(€ô(€½¹ÍÐÑ•µÀ€ô€‘í™¥±•ô¸‘íÉ…¹‘½µUU%È ¥ô¹ÑµÁ€ì(€…Ý…¥Ðµ­‘¥È¡‘¥É¹…µ”¡™¥±”¤°ìÉ•ÕÉÍ¥Ù”èÑÉÕ”ô¤ì(€…Ý…¥ÐÝÉ¥Ñ•¥±”È¡Ñ•µÀ°€‘í½É¥¥¹…°¹ÑÉ¥µ¹ ¥ô((‘í±¥¹•Ì¹©½¥¸ ‰q¸ˆ¥ô)€°€‰ÕÑ˜àˆ¤ì(€…Ý…¥ÐÉ•¹…µ”È¡Ñ•µÀ°™¥±”¤ì)ô)…Íå¹Œ™Õ¹Ñ¥½¸É•½É‘…¥±ÕÉ”¡Á½ÉÑÌ°µ…¹¥™•ÍÑA…Ñ °™…¥±ÕÉ•ÍA…Ñ °ÉÕ¹¥È°™…¥±ÕÉ”¤ì(€É•ÑÕÉ¸Ý¥Ñ¡IÕ¹1½¬¡Á½ÉÑÌ°µ…¹¥™•ÍÑA…Ñ °…Íå¹Œ€ ¤€ôøì(€€€½¹ÍÐµ…¹¥™•ÍÐ€ô…Ý…¥ÐÉ•…‘5…¹¥™•ÍÐ¡µ…¹¥™•ÍÑA…Ñ °ÉÕ¹¥È¤ì(€€€µ…¹¥™•ÍÐ¹ÕÁ‘…Ñ•‘}…Ð€ô™…¥±ÕÉ”¹™…¥±•‘}…Ðì(€€€µ…¹¥™•ÍÐ¹™…¥±ÕÉ•Ì€ôÉÉ…ä¹¥ÍÉÉ…ä¡µ…¹¥™•ÍÐ¹™…¥±ÕÉ•Ì¤€üµ…¹¥™•ÍÐ¹™…¥±ÕÉ•Ì€èmtì(€€€µ…¹¥™•ÍÐ¹™…¥±ÕÉ•Ì¹ÁÕÍ ¡™…¥±ÕÉ”¤ì(€€€…Ý…¥Ð…Ñ½µ¥)Í½¸¡µ…¹¥™•ÍÑA…Ñ °µ…¹¥™•ÍÐ¤ì(€€€…Ý…¥Ð…ÁÁ•¹‘…¥±ÕÉ”¡™…¥±ÕÉ•ÍA…Ñ °™…¥±ÕÉ”¤ì(€ô¤ì)ô)…Íå¹Œ™Õ¹Ñ¥½¸É•…‘	½‘ä¡É•ÍÁ½¹Í”°µ…á	åÑ•Ì¤ì(€½¹ÍÐ‘•±…É•€ô9Õµ‰•È¡É•ÍÁ½¹Í”¹¡•…‘•ÉÌ¹•Ð ‰½¹Ñ•¹Ðµ±•¹Ñ ˆ¤¤ì(€¥˜€¡9Õµ‰•È¹¥Í¥¹¥Ñ”¡‘•±…É•¤€˜˜‘•±…É•€øµ…á	åÑ•Ì¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È¡É•ÍÁ½¹Í”•á••‘Ìµ…á}‰åÑ•Ì€ ‘íµ…á	åÑ•Íô¥€¤ì(€¥˜€ …É•ÍÁ½¹Í”¹‰½‘ä¤ì(€€€½¹ÍÐ…ÉÉ…ä€ô¹•ÜU¥¹ÐáÉÉ…ä¡…Ý…¥ÐÉ•ÍÁ½¹Í”¹…ÉÉ…å	Õ™™•È ¤¤ì(€€€¥˜€¡…ÉÉ…ä¹‰åÑ•1•¹Ñ €øµ…á	åÑ•Ì¤Ñ¡É½Ü¹•ÜÉÉ½È¡É•ÍÁ½¹Í”•á••‘Ìµ…á}‰åÑ•Ì€ ‘íµ…á	åÑ•Íô¥€¤ì(€€€É•ÑÕÉ¸…ÉÉ…äì(€ô(€½¹ÍÐÉ•…‘•È€ôÉ•ÍÁ½¹Í”¹‰½‘ä¹•ÑI•…‘•È ¤ì(€½¹ÍÐ¡Õ¹­Ì€ômtì(€±•ÐÍ¥é”€ô€Àì(€Ý¡¥±”€¡ÑÉÕ”¤ì(€€€½¹ÍÐì‘½¹”°Ù…±Õ”ô€ô…Ý…¥ÐÉ•…‘•È¹É•… ¤ì(€€€¥˜€¡‘½¹”¤‰É•…¬ì(€€€Í¥é”€¬ôÙ…±Õ”¹‰åÑ•1•¹Ñ ì(€€€¥˜€¡Í¥é”€øµ…á	åÑ•Ì¤ì(€€€€€…Ý…¥ÐÉ•…‘•È¹…¹•° ¤ì(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È¡É•ÍÁ½¹Í”•á••‘Ìµ…á}‰åÑ•Ì€ ‘íµ…á	åÑ•Íô¥€¤ì(€€€ô(€€€¡Õ¹­Ì¹ÁÕÍ ¡Ù…±Õ”¤ì(€ô(€½¹ÍÐÉ•ÍÕ±Ð€ô¹•ÜU¥¹ÐáÉÉ…ä¡Í¥é”¤ì(€±•Ð½™™Í•Ð€ô€Àì(€™½È€¡½¹ÍÐ¡Õ¹¬½˜¡Õ¹­Ì¤ì(€€€É•ÍÕ±Ð¹Í•Ð¡¡Õ¹¬°½™™Í•Ð¤ì(€€€½™™Í•Ð€¬ô¡Õ¹¬¹‰åÑ•1•¹Ñ ì(€ô(€É•ÑÕÉ¸É•ÍÕ±Ðì)ô)…Íå¹Œ™Õ¹Ñ¥½¸É•…‘AÉ•™¥à¡É•ÍÁ½¹Í”°µ…á	åÑ•Ì¤ì(€¥˜€ …É•ÍÁ½¹Í”¹‰½‘äü¹•ÑI•…‘•È¤ì(€€€½¹ÍÐ…ÉÉ…ä€ô¹•ÜU¥¹ÐáÉÉ…ä¡…Ý…¥ÐÉ•ÍÁ½¹Í”¹…ÉÉ…å	Õ™™•È ¤¤ì(€€€É•ÑÕÉ¸…ÉÉ…ä¹ÍÕ‰…ÉÉ…ä À°µ…á	åÑ•Ì¤ì(€ô(€½¹ÍÐÉ•…‘•È€ôÉ•ÍÁ½¹Í”¹‰½‘ä¹•ÑI•…‘•È ¤ì(€½¹ÍÐ¡Õ¹­Ì€ômtì(€±•ÐÍ¥é”€ô€Àì(€ÑÉäì(€€€Ý¡¥±”€¡Í¥é”€ðµ…á	åÑ•Ì¤ì(€€€€€½¹ÍÐì‘½¹”°Ù…±Õ”ô€ô…Ý…¥ÐÉ•…‘•È¹É•… ¤ì(€€€€€¥˜€¡‘½¹”ñð€…Ù…±Õ”¤‰É•…¬ì(€€€€€½¹ÍÐÉ½½´€ôµ…á	åÑ•Ì€´Í¥é”ì(€€€€€½¹ÍÐÍ±¥”€ôÙ…±Õ”¹‰åÑ•1•¹Ñ €øÉ½½´€üÙ…±Õ”¹ÍÕ‰…ÉÉ…ä À°É½½´¤€èÙ…±Õ”ì(€€€€€¡Õ¹­Ì¹ÁÕÍ ¡Í±¥”¤ì(€€€€€Í¥é”€¬ôÍ±¥”¹‰åÑ•1•¹Ñ ì(€€€ô(€ô™¥¹…±±äì(€€€ÑÉäì(€€€€€…Ý…¥ÐÉ•…‘•È¹…¹•° ¤ì(€€€ô…Ñ ì(€€€ô(€ô(€½¹ÍÐÉ•ÍÕ±Ð€ô¹•ÜU¥¹ÐáÉÉ…ä¡Í¥é”¤ì(€±•Ð½™™Í•Ð€ô€Àì(€™½È€¡½¹ÍÐ¡Õ¹¬½˜¡Õ¹­Ì¤ì(€€€É•ÍÕ±Ð¹Í•Ð¡¡Õ¹¬°½™™Í•Ð¤ì(€€€½™™Í•Ð€¬ô¡Õ¹¬¹‰åÑ•1•¹Ñ ì(€ô(€É•ÑÕÉ¸É•ÍÕ±Ðì)ô)™Õ¹Ñ¥½¸¥¹ÍÑ¥ÑÕÑ¥½¹…±Q•áÐ¡¥¹ÍÐ¤ì(€½¹ÍÐ¡•…‘•ÉÌ€ô¥¹ÍÐü¹¡•…‘•ÉÌì(€±•Ð½¹Ñ•¹ÑQåÁ”€ô€ˆˆì(€¥˜€¡¡•…‘•ÉÌ€˜˜ÑåÁ•½˜¡•…‘•ÉÌ¹•Ð€ôôô€‰™Õ¹Ñ¥½¸ˆ¤½¹Ñ•¹ÑQåÁ”€ôMÑÉ¥¹œ¡¡•…‘•ÉÌ¹•Ð ‰½¹Ñ•¹ÐµÑåÁ”ˆ¤ñð€ˆˆ¤ì(€•±Í”¥˜€¡¡•…‘•ÉÌ€˜˜ÑåÁ•½˜¡•…‘•ÉÌ€ôôô€‰½‰©•Ðˆ¤ì(€€€½¹ÍÐ™½Õ¹€ô=‰©•Ð¹•¹ÑÉ¥•Ì¡¡•…‘•ÉÌ¤¹™¥¹ ¡m­•åt¤€ôø­•ä¹Ñ½1½Ý•É…Í” ¤€ôôô€‰½¹Ñ•¹ÐµÑåÁ”ˆ¤ì(€€€½¹Ñ•¹ÑQåÁ”€ô™½Õ¹€üMÑÉ¥¹œ¡™½Õ¹‘lÅt€üü€ˆˆ¤€è€ˆˆì(€ô(€±•ÐÍ¹¥ÁÁ•Ð€ô€ˆˆì(€ÑÉäì(€€€½¹ÍÐ‰½‘ä€ô¥¹ÍÐü¹‰½‘äì(€€€½¹ÍÐ‰åÑ•Ì€ô‰½‘ä¥¹ÍÑ…¹•½˜U¥¹ÐáÉÉ…ä€ü‰½‘ä€è‰½‘ä€ü¹•ÜU¥¹ÐáÉÉ…ä¡‰½‘ä¤€è¹•ÜU¥¹ÐáÉÉ…ä ¤ì(€€€Í¹¥ÁÁ•Ð€ô¹•ÜQ•áÑ•½‘•È ¤¹‘•½‘”¡‰åÑ•Ì¹ÍÕ‰…ÉÉ…ä À°€àÄäÈ¤¤ì(€ô…Ñ ì(€€€Í¹¥ÁÁ•Ð€ô€ˆˆì(€ô(€É•ÑÕÉ¸ì½¹Ñ•¹ÑQåÁ”°Í¹¥ÁÁ•Ðôì)ô)…Íå¹Œ™Õ¹Ñ¥½¸…É¡¥Ù•M½ÕÉ”¡½ÁÑ¥½¹Ì€ôíô°Á½ÉÑÌ¤ì(€¥˜€ …Á½ÉÑÌ¤Ñ¡É½Ü¹•ÜÉÉ½È ‰M½ÕÉ”…É¡¥Ù”¡½ÍÐÁ½ÉÑÌ…É”É•ÅÕ¥É•ˆ¤ì(€½¹ÍÐì(€€€Ý€ôÁÉ½•ÍÌ¹Ý ¤°(€€€ÉÕ¹}‘¥È°(€€€ÕÉ°°(€€€‘½¤°(€€€Áµ¥°(€€€Áµ¥°(€€€•µ…¥°°(€€€É•Í½±Ù•}½Á•¹}…•ÍÌ°(€€€µ…á}…¹‘¥‘…Ñ•Ì€ô=}5a}9%QL°(€€€…Ñ•½Éä€ô€‰Á…Á•ÉÌˆ°(€€€™¥±•¹…µ”°(€€€µ•Ñ…‘…Ñ„°(€€€±½…±}™¥±”°(€€€¡Õµ…¹}Ù•É¥™¥•€ô™…±Í”°(€€€½¹Ñ•¹Ñ}ÑåÁ”°(€€€µ…á}‰åÑ•Ì€ôU1Q}5a}	eQL°(€€€Ñ¥µ•½ÕÑ}µÌ€ôU1Q}Q%5=UQ}5L°(€€€™•Ñ¡%µÁ°€ô±½‰…±Q¡¥Ì¹™•Ñ °(€€€Í¥¹…°°(€€€•¹Ø€ôÁÉ½•ÍÌ¹•¹Ø(€ô€ô½ÁÑ¥½¹Ìì(€¥˜€ …M=UI}Q=I%L¹¥¹±Õ‘•Ì¡…Ñ•½Éä¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È¡…Ñ•½ÉäµÕÍÐ‰”½¹”½˜è€‘íM=UI}Q=I%L¹©½¥¸ ˆ°€ˆ¥õ€¤ì(€½¹ÍÐ¥‘•¹Ñ¥Ñä€ôì(€€€‘½¤è¹½Éµ…±¥é•½¤¡‘½¤ñðµ•Ñ…‘…Ñ„ü¹‘½¤¤°(€€€Áµ¥è¹½Éµ…±¥é•Aµ¥¡Áµ¥ñðµ•Ñ…‘…Ñ„ü¹Áµ¥¤°(€€€Áµ¥è¹½Éµ…±¥é•Aµ¥¡Áµ¥ñðµ•Ñ…‘…Ñ„ü¹Áµ¥¤(€ôì(€½¹ÍÐ¡…Í%‘•¹Ñ¥Ñä€ô	½½±•…¸¡¥‘•¹Ñ¥Ñä¹‘½¤ñð¥‘•¹Ñ¥Ñä¹Áµ¥ñð¥‘•¹Ñ¥Ñä¹Áµ¥¤ì(€¥˜€¡ÕÉ°€ôô¹Õ±°€˜˜€„¡…Ñ•½Éä€ôôô€‰Á…Á•ÉÌˆ€˜˜¡…Í%‘•¹Ñ¥Ñä¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰ÕÉ°¥ÌÉ•ÅÕ¥É•Õ¹±•ÍÌ…Ñ•½Éä¥ÌÁ…Á•ÉÌ…¹„‘½¤½Áµ¥½Áµ¥¥Ì¥Ù•¸ˆ¤ì(€¥˜€¡ÕÉ°€„ô¹Õ±°€˜˜€¡ÑåÁ•½˜ÕÉ°€„ôô€‰ÍÑÉ¥¹œˆñð€„½y¡ÑÑÁÌüép½p¼½¤¹Ñ•ÍÐ¡ÕÉ°¤¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰ÕÉ°µÕÍÐ‰”…¸¡ÑÑÀ¡Ì¤UI0ˆ¤ì(€¥˜€¡ÑåÁ•½˜™•Ñ¡%µÁ°€„ôô€‰™Õ¹Ñ¥½¸ˆ¤Ñ¡É½Ü¹•ÜÉÉ½È ‰™•Ñ ¥ÌÕ¹…Ù…¥±…‰±”ˆ¤ì(€½¹ÍÐ½Á•¹•ÍÍ]…¹Ñ•€ô…Ñ•½Éä€ôôô€‰Á…Á•ÉÌˆ€˜˜¡…Í%‘•¹Ñ¥Ñä€˜˜É•Í½±Ù•}½Á•¹}…•ÍÌ€„ôô™…±Í”ì(€½¹ÍÐ…¹‘¥‘…Ñ•1¥µ¥Ð€ô9Õµ‰•È¡µ…á}…¹‘¥‘…Ñ•Ì¤ì(€¥˜€ …9Õµ‰•È¹¥Í%¹Ñ••È¡…¹‘¥‘…Ñ•1¥µ¥Ð¤ñð…¹‘¥‘…Ñ•1¥µ¥Ð€ð€Äñð…¹‘¥‘…Ñ•1¥µ¥Ð€ø=}5a}9%QL¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È¡µ…á}…¹‘¥‘…Ñ•ÌµÕÍÐ‰”‰•ÑÝ••¸€Ä…¹€‘í=}5a}9%QMõ€¤ì(€½¹ÍÐ½¹™¥œ€ô…Ý…¥ÐÁ½ÉÑÌ¹Ý½É­ÍÁ…”¡Ý¤ì(€½¹ÍÐÉÕ¹¥È€ôÙ…±¥‘…Ñ•IÕ¹¥È¡½¹™¥œ¹É•ÍÕ±ÑÍI½½Ð°É•Í½±Ù”Ð¡Ý°ÉÕ¹}‘¥È¤¤ì(€…Ý…¥Ð…•ÍÌ¡ÉÕ¹¥È¤ì(€¥˜€ …¥Í]¥Ñ¡¥¸¡…Ý…¥ÐÉ•…±Á…Ñ Ì¡½¹™¥œ¹É•ÍÕ±ÑÍI½½Ð¤°…Ý…¥ÐÉ•…±Á…Ñ Ì¡ÉÕ¹¥È¤¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰ÉÕ¹}‘¥È•Í…Á•ÌÉ•ÍÕ±ÑÌÉ½½ÐÑ¡É½Õ „±¥¹¬ˆ¤ì(€½¹ÍÐ±¥µ¥Ð€ô9Õµ‰•È¡µ…á}‰åÑ•Ì¤ì(€½¹ÍÐÑ¥µ•½ÕÐ€ô9Õµ‰•È¡Ñ¥µ•½ÕÑ}µÌ¤ì(€¥˜€ …9Õµ‰•È¹¥Í%¹Ñ••È¡±¥µ¥Ð¤ñð±¥µ¥Ð€ð€Äñð±¥µ¥Ð€ø€ÔÀÀ€¨€ÄÀÈÐ€¨€ÄÀÈÐ¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰µ…á}‰åÑ•ÌµÕÍÐ‰”‰•ÑÝ••¸€Ä…¹€ÔÈÐÈààÀÀÀˆ¤ì(€¥˜€ …9Õµ‰•È¹¥Í%¹Ñ••È¡Ñ¥µ•½ÕÐ¤ñðÑ¥µ•½ÕÐ€ð€ÄÀÀñðÑ¥µ•½ÕÐ€ø€ÄÀ€¨€ØÀ€¨€Å”Ì¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰Ñ¥µ•½ÕÑ}µÌµÕÍÐ‰”‰•ÑÝ••¸€ÄÀÀ…¹€ØÀÀÀÀÀˆ¤ì(€½¹ÍÐÍ½ÕÉ•Í¥È€ô©½¥¸È¡ÉÕ¹¥È°€‰Í½ÕÉ•Ìˆ°…Ñ•½Éä¤ì(€½¹ÍÐµ…¹¥™•ÍÑA…Ñ €ô©½¥¸È¡ÉÕ¹¥È°€‰Í½ÕÉ•Ìˆ°€‰‘½Ý¹±½…µµ…¹¥™•ÍÐ¹©Í½¸ˆ¤ì(€½¹ÍÐ™…¥±ÕÉ•ÍA…Ñ €ô©½¥¸È¡ÉÕ¹¥È°€‰Í½ÕÉ•Ìˆ°€‰‘½Ý¹±½…µ™…¥±ÕÉ•Ì¹µˆ¤ì(€…Ý…¥Ðµ­‘¥È¡Í½ÕÉ•Í¥È°ìÉ•ÕÉÍ¥Ù”èÑÉÕ”ô¤ì(€¥˜€ …¥Í]¥Ñ¡¥¸¡…Ý…¥ÐÉ•…±Á…Ñ Ì¡ÉÕ¹¥È¤°…Ý…¥ÐÉ•…±Á…Ñ Ì¡Í½ÕÉ•Í¥È¤¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰Í½ÕÉ•Ì‘¥É•Ñ½Éä•Í…Á•ÌÑ¡”ÉÕ¸Ñ¡É½Õ „±¥¹¬ˆ¤ì(€½¹ÍÐÁ•ÉÍ¥ÍÐ€ô…Íå¹Œ€¡‰åÑ•Ì°ìÉ•Í½±Ù•‘UÉ°°½¹Ñ•¹ÑQåÁ”°½ÕÑÁÕÑ9…µ”°Ù•É¥™¥•€ô™…±Í”°½Á•¹•ÍÌ€ô¹Õ±°ô¤€ôøÝ¥Ñ¡IÕ¹1½¬¡Á½ÉÑÌ°µ…¹¥™•ÍÑA…Ñ °…Íå¹Œ€ ¤€ôøì(€€€½¹ÍÐÙ…±¥‘…Ñ¥½¸€ôÙ…±¥‘…Ñ•½¹Ñ•¹Ð¡…Ñ•½Éä°½¹Ñ•¹ÑQåÁ”°½ÕÑÁÕÑ9…µ”°‰åÑ•Ì¤ì(€€€¥˜€ …Ù…±¥‘…Ñ¥½¸¹½¬¤Ñ¡É½Ü¹•ÜÉÉ½È¡Ù…±¥‘…Ñ¥½¸¹É•…Í½¸¤ì(€€€½¹ÍÐÍ¡„ÈÔØÈ€ôÉ•…Ñ•!…Í Ô ‰Í¡„ÈÔØˆ¤¹ÕÁ‘…Ñ”¡‰åÑ•Ì¤¹‘¥•ÍÐ ‰¡•àˆ¤ì(€€€½¹ÍÐ¥‘•µÁ½Ñ•¹å-•ä€ô•áÑ•É¹…±™™•Ñ-•ä ‰É•Í•…É ¹‘½Ý¹±½…ˆ°ì(€€€€€…Ñ•½Éä°(€€€€€¥‘•¹Ñ¥Ñä°(€€€€€ÕÉ°èÕÉ°€üüÉ•Í½±Ù•‘UÉ°°(€€€€€½ÕÑÁÕÑ9…µ”(€€€ô¤ì(€€€±•Ð½ÕÑÁÕÑA…Ñ €ô©½¥¸È¡Í½ÕÉ•Í¥È°½ÕÑÁÕÑ9…µ”¤ì(€€€¥˜€ …¥Í]¥Ñ¡¥¸¡Í½ÕÉ•Í¥È°½ÕÑÁÕÑA…Ñ ¤¤Ñ¡É½Ü¹•ÜÉÉ½È ‰™¥±•¹…µ”•Í…Á•ÌÍ½ÕÉ”…Ñ•½Éä‘¥É•Ñ½Éäˆ¤ì(€€€ÑÉäì(€€€€€½¹ÍÐ•á¥ÍÑ¥¹œ€ô¹•ÜU¥¹ÐáÉÉ…ä¡…Ý…¥ÐÉ•…‘¥±”Ì¡½ÕÑÁÕÑA…Ñ ¤¤ì(€€€€€½¹ÍÐ•á¥ÍÑ¥¹!…Í €ôÉ•…Ñ•!…Í Ô ‰Í¡„ÈÔØˆ¤¹ÕÁ‘…Ñ”¡•á¥ÍÑ¥¹œ¤¹‘¥•ÍÐ ‰¡•àˆ¤ì(€€€€€¥˜€¡•á¥ÍÑ¥¹!…Í €„ôôÍ¡„ÈÔØÈ¤ì(€€€€€€€½¹ÍÐ•áÑ•¹Í¥½¸€ô•áÑ¹…µ”¡½ÕÑÁÕÑ9…µ”¤ì(€€€€€€€½¹ÍÐÍÑ•´€ô½ÕÑÁÕÑ9…µ”¹Í±¥” À°½ÕÑÁÕÑ9…µ”¹±•¹Ñ €´•áÑ•¹Í¥½¸¹±•¹Ñ ¤ì(€€€€€€€½ÕÑÁÕÑA…Ñ €ô©½¥¸È¡Í½ÕÉ•Í¥È°€‘íÍÑ•µô´‘íÍ¡„ÈÔØÈ¹Í±¥” À°€ÄÈ¥ô‘í•áÑ•¹Í¥½¹õ€¤ì(€€€€€ô(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€¥˜€¡•ÉÉ½È¹½‘”€„ôô€‰9=9Pˆ¤Ñ¡É½Ü•ÉÉ½Èì(€€€ô(€€€ÑÉäì(€€€€€½¹ÍÐ•á¥ÍÑ¥¹œ€ô…Ý…¥ÐÉ•…‘¥±”Ì¡½ÕÑÁÕÑA…Ñ ¤ì(€€€€€¥˜€¡É•…Ñ•!…Í Ô ‰Í¡„ÈÔØˆ¤¹ÕÁ‘…Ñ”¡•á¥ÍÑ¥¹œ¤¹‘¥•ÍÐ ‰¡•àˆ¤€„ôôÍ¡„ÈÔØÈ¤(€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰É¡¥Ù•Ù•ÉÍ¥½¸Á…Ñ ¡…Ì‘¥™™•É•¹Ð½¹Ñ•¹Ðˆ¤ì(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€¥˜€¡•ÉÉ½È¹½‘”€„ôô€‰9=9Pˆ¤Ñ¡É½Ü•ÉÉ½Èì(€€€€€½¹ÍÐÑ•µÁ½É…Éä€ô€‘í½ÕÑÁÕÑA…Ñ¡ô¸‘íÉ…¹‘½µUU%È ¥ô¹Á…ÉÑ€ì(€€€€€…Ý…¥ÐÝÉ¥Ñ•¥±”È¡Ñ•µÁ½É…Éä°‰åÑ•Ì¤ì(€€€€€…Ý…¥ÐÉ•¹…µ”È¡Ñ•µÁ½É…Éä°½ÕÑÁÕÑA…Ñ ¤ì(€€€ô(€€€½¹ÍÐ‘½Ý¹±½…‘•‘Ð€ô€ ¼¨}}AUI}|€¨¼¹•Ü…Ñ” ¤¤¹Ñ½%M=MÑÉ¥¹œ ¤ì(€€€½¹ÍÐ•¹ÑÉä€ôì(€€€€€€¸¸¹…Ñ•½Éä€ôôô€‰µ…¹Õ…±Ìˆ€üìµ…¹Õ…±½Ù•É…”è…ÍÍ•ÍÍ5…¹Õ…±A…”¡‰åÑ•Ì°½¹Ñ•¹ÑQåÁ”°É•Í½±Ù•‘UÉ°¤ô€èíô°(€€€€€¥èÉ…¹‘½µUU%È ¤°(€€€€€¥‘•µÁ½Ñ•¹å}­•äè¥‘•µÁ½Ñ•¹å-•ä°(€€€€€ÍÑ…ÑÕÌè€‰‘½Ý¹±½…‘•ˆ°(€€€€€…Ñ•½Éä°(€€€€€€¼¼ƒ’î–´=$ƒ–öKš†š^ÛšÊ‡šr'¢ÂžR£šZäUI3¾òk’î—–º{¦f–>[–ú_šZ’îÛžj–rÃ–v’ös’âëšv—šê@(€€€€€ÕÉ°èÕÉ°€üüÉ•Í½±Ù•‘UÉ°°(€€€€€™¥¹…±}ÕÉ°èÉ•Í½±Ù•‘UÉ°°(€€€€€‘½Ý¹±½…‘•‘}…Ðè‘½Ý¹±½…‘•‘Ð°(€€€€€Á…Ñ è½ÕÑÁÕÑA…Ñ °(€€€€€±½…±}Á…Ñ è½ÕÑÁÕÑA…Ñ °(€€€€€É•±…Ñ¥Ù•}Á…Ñ èÉ•±…Ñ¥Ù”Ð¡Ý°½ÕÑÁÕÑA…Ñ ¤¹É•Á±…•±°¡Í•ÀÐ°€ˆ¼ˆ¤°(€€€€€Í¥é•}‰åÑ•Ìè‰åÑ•Ì¹‰åÑ•1•¹Ñ °(€€€€€Í¡„ÈÔØèÍ¡„ÈÔØÈ°(€€€€€½¹Ñ•¹Ñ}ÑåÁ”è½¹Ñ•¹ÑQåÁ”°(€€€€€¡Õµ…¹}Ù•É¥™¥•è	½½±•…¸¡Ù•É¥™¥•¤°(€€€€€µ•Ñ…‘…Ñ„è¹½Éµ…±¥é•5•Ñ…‘…Ñ„¡ì(€€€€€€€€¸¸¹¥‘•¹Ñ¥Ñä°(€€€€€€€€¸¸¹µ•Ñ…‘…Ñ„ñðíô°(€€€€€€€€¸¸¹½Á•¹•ÍÌ€üì½Á•¹}…•ÍÌè½Á•¹•ÍÌô€èíô(€€€€€ô¤(€€€ôì(€€€½¹ÍÐµ…¹¥™•ÍÐ€ô…Ý…¥ÐÉ•…‘5…¹¥™•ÍÐ¡µ…¹¥™•ÍÑA…Ñ °ÉÕ¹¥È¤ì(€€€½¹ÍÐÁÉ¥½È€ôµ…¹¥™•ÍÐ¹¥Ñ•µÌ¹™¥¹ ¡¥Ñ•´¤€ôø¥Ñ•´ü¹¥‘•µÁ½Ñ•¹å}­•ä€ôôô¥‘•µÁ½Ñ•¹å-•ä¤ì(€€€¥˜€¡ÁÉ¥½È¤ì(€€€€€¥˜€¡ÁÉ¥½È¹Í¡„ÈÔØ€„ôôÍ¡„ÈÔØÈ¤(€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È (€€€€€€€€€€‰½Ý¹±½…¥‘•µÁ½Ñ•¹ä­•ä…±É•…‘ä•á¥ÍÑÌÝ¥Ñ ‘¥™™•É•¹Ð½¹Ñ•¹ÐìÉ•½¹¥±”Ñ¡”µ…¹¥™•ÍÐ™¥ÉÍÐˆ(€€€€€€€€¤ì(€€€€€É•ÑÕÉ¸ì€¸¸¹ÁÉ¥½È°µ…¹¥™•ÍÑ}Á…Ñ èµ…¹¥™•ÍÑA…Ñ °µ…¹¥™•ÍÑA…Ñ °¥‘•µÁ½Ñ•¹Ñ}É•Á±…äèÑÉÕ”ôì(€€€ô(€€€µ…¹¥™•ÍÐ¹ÕÁ‘…Ñ•‘}…Ð€ô‘½Ý¹±½…‘•‘Ðì(€€€µ…¹¥™•ÍÐ¹¥Ñ•µÌ€ôl¸¸¹µ…¹¥™•ÍÐ¹¥Ñ•µÌ°•¹ÑÉåtì(€€€…Ý…¥Ð…Ñ½µ¥)Í½¸¡µ…¹¥™•ÍÑA…Ñ °µ…¹¥™•ÍÐ¤ì(€€€±•Ð­¹½Ý±•‘”ì(€€€ÑÉäì(€€€€€­¹½Ý±•‘”€ô…Ý…¥ÐÁ½ÉÑÌ¹ÁÕ‰±¥Í¡M½ÕÉ•9½Ñ”¡ìÝ°ÉÕ¹¥È°•¹ÑÉäô¤ì(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€­¹½Ý±•‘”€ôì½‰Í¥‘¥…¹}¹½Ñ”è¹Õ±°°­¹½Ý±•‘•}ÍÑ…ÑÕÌè€‰™…¥±•ˆ°½‰Í¥‘¥…¹}•ÉÉ½Èè•ÉÉ½È¹µ•ÍÍ…”ôì(€€€ô(€€€É•ÑÕÉ¸ì(€€€€€€¸¸¹•¹ÑÉä°(€€€€€€¸¸¹­¹½Ý±•‘”°(€€€€€€¸¸¹½Á•¹•ÍÌ€üì½Á•¹}…•ÍÌè½Á•¹•ÍÌô€èíô°(€€€€€µ…¹¥™•ÍÑ}Á…Ñ èµ…¹¥™•ÍÑA…Ñ °(€€€€€µ…¹¥™•ÍÑA…Ñ °(€€€€€™…¥±ÕÉ•Í}Á…Ñ è…Ý…¥Ð…•ÍÌ¡™…¥±ÕÉ•ÍA…Ñ ¤¹Ñ¡•¸ (€€€€€€€€ ¤€ôø™…¥±ÕÉ•ÍA…Ñ °(€€€€€€€€ ¤€ôø¹Õ±°(€€€€€€¤(€€€ôì(€ô¤ì(€¥˜€¡±½…±}™¥±”€„ô¹Õ±°¤ì(€€€ÑÉäì(€€€€€¥˜€¡¡Õµ…¹}Ù•É¥™¥•€„ôôÑÉÕ”¤Ñ¡É½Ü¹•ÜÉÉ½È ‰±½…±}™¥±”¥µÁ½ÉÑÌÉ•ÅÕ¥É”•áÁ±¥¥Ð¡Õµ…¹}Ù•É¥™¥•õÑÉÕ”ˆ¤ì(€€€€€½¹ÍÐ‘½Ý¹±½…‘I½½Ð€ô…Ý…¥ÐÉ•…±Á…Ñ Ì¡É•Í½±Ù”Ð¡Ý°€ˆ¹Á¤ˆ°€‰‰É½ÝÍ•Èµ‘½Ý¹±½…‘Ìˆ¤¤ì(€€€€€½¹ÍÐ…¹½¹¥…°È€ô…Ý…¥ÐÉ•…±Á…Ñ Ì¡É•Í½±Ù”Ð¡Ý°±½…±}™¥±”¤¤ì(€€€€€¥˜€ …¥Í]¥Ñ¡¥¸¡‘½Ý¹±½…‘I½½Ð°…¹½¹¥…°È¤¤(€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰±½…±}™¥±”µÕÍÐ‰”¥¹Í¥‘”€¹Á¤½‰É½ÝÍ•Èµ‘½Ý¹±½…‘Ìˆ¤ì(€€€€€½¹ÍÐ‰åÑ•Ì€ô¹•ÜU¥¹ÐáÉÉ…ä¡…Ý…¥ÐÉ•…‘¥±”Ì¡…¹½¹¥…°È¤¤ì(€€€€€¥˜€¡‰åÑ•Ì¹‰åÑ•1•¹Ñ €ø±¥µ¥Ð¤Ñ¡É½Ü¹•ÜÉÉ½È¡±½…°™¥±”•á••‘Ìµ…á}‰åÑ•Ì€ ‘í±¥µ¥Ñô¥€¤ì(€€€€€½¹ÍÐ½ÕÑÁÕÑ9…µ”€ôÍ…™•¥±•¹…µ”¡™¥±•¹…µ”ñð‰…Í•¹…µ”È¡…¹½¹¥…°È¤°€‘í…Ñ•½Éåô´‘íÉ…¹‘½µUU%È ¥ô¹‰¥¹€¤ì(€€€€€É•ÑÕÉ¸…Ý…¥ÐÁ•ÉÍ¥ÍÐ¡‰åÑ•Ì°ì(€€€€€€€É•Í½±Ù•‘UÉ°èÕÉ°€üü€¡¥‘•¹Ñ¥Ñä¹‘½¤€ü¡ÑÑÁÌè¼½‘½¤¹½Éœ¼‘í¥‘•¹Ñ¥Ñä¹‘½¥õ€€è™¥±”è‘í‰…Í•¹…µ”È¡…¹½¹¥…°È¥õ€¤°(€€€€€€€½¹Ñ•¹ÑQåÁ”è½¹Ñ•¹Ñ}ÑåÁ”ñðµ•Ñ…‘…Ñ„ü¹½¹Ñ•¹Ñ}ÑåÁ”ñð€‰…ÁÁ±¥…Ñ¥½¸½½Ñ•ÐµÍÑÉ•…´ˆ°(€€€€€€€½ÕÑÁÕÑ9…µ”°(€€€€€€€Ù•É¥™¥•èÑÉÕ”(€€€€€ô¤ì(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€½¹ÍÐ™…¥±ÕÉ”È€ôì(€€€€€€€ÕÉ°°(€€€€€€€…Ñ•½Éä°(€€€€€€€™…¥±•‘}…Ðè€ ¼¨}}AUI}|€¨¼¹•Ü…Ñ” ¤¤¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€€€€€É•…Í½¸è•ÉÉ½È¹µ•ÍÍ…”°(€€€€€€€‰É½ÝÍ•É}É•ÅÕ¥É•è™…±Í”°(€€€€€€€±½…±}™¥±”(€€€€€ôì(€€€€€…Ý…¥ÐÉ•½É‘…¥±ÕÉ”¡Á½ÉÑÌ°µ…¹¥™•ÍÑA…Ñ °™…¥±ÕÉ•ÍA…Ñ °ÉÕ¹¥È°™…¥±ÕÉ”È¤ì(€€€€€É•ÑÕÉ¸ìÍÑ…ÑÕÌè€‰™…¥±•ˆ°€¸¸¹™…¥±ÕÉ”È°µ…¹¥™•ÍÑ}Á…Ñ èµ…¹¥™•ÍÑA…Ñ °™…¥±ÕÉ•Í}Á…Ñ è™…¥±ÕÉ•ÍA…Ñ ôì(€€€ô(€ô(€½¹ÍÐ¡…¹‘½™˜€ô€¡Ñ…É•Ð¤€ôø€¡ì(€€€ÕÉ°èÑ…É•Ð°(€€€…Ñ¥½¸è€‰=Á•¸Ñ¡¥ÌUI0¥¸½µÁÕÑ•ÈUÍ”‰É½ÝÍ•È°½µÁ±•Ñ”Ù•É¥™¥…Ñ¥½¸µ…¹Õ…±±ä°Ñ¡•¸É•ÑÉä…É¡¥Ù”ˆ(€ô¤ì(€…Íå¹Œ™Õ¹Ñ¥½¸…ÑÑ•µÁÑ½Ý¹±½…¡Ñ…É•Ð¤ì(€€€½¹ÍÐ½¹ÑÉ½±±•È€ô¹•Ü‰½ÉÑ½¹ÑÉ½±±•È ¤ì(€€€½¹ÍÐÑ¥µ•È€ôÍ•ÑQ¥µ•½ÕÐ  ¤€ôø½¹ÑÉ½±±•È¹…‰½ÉÐ ¤°Ñ¥µ•½ÕÐ¤ì(€€€½¹ÍÐ½¹‰½ÉÐ€ô€ ¤€ôø½¹ÑÉ½±±•È¹…‰½ÉÐ ¤ì(€€€Í¥¹…°ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰…‰½ÉÐˆ°½¹‰½ÉÐ°ì½¹”èÑÉÕ”ô¤ì(€€€ÑÉäì(€€€€€½¹ÍÐÉ•ÍÁ½¹Í”€ô…Ý…¥Ð™•Ñ¡%µÁ°¡Ñ…É•Ð°ì(€€€€€€€É•‘¥É•Ðè€‰™½±±½Üˆ°(€€€€€€€Í¥¹…°è½¹ÑÉ½±±•È¹Í¥¹…°°(€€€€€€€¡•…‘•ÉÌèì(€€€€€€€€€…•ÁÐè€‰…ÁÁ±¥…Ñ¥½¸½Á‘˜±…ÁÁ±¥…Ñ¥½¸½é¥À±…ÁÁ±¥…Ñ¥½¸½½Ñ•ÐµÍÑÉ•…´±Ñ•áÐ½Á±…¥¸±Ñ•áÐ½µ…É­‘½Ý¸±Ñ•áÐ½¡Ñµ°íÄôÀ¸à°¨¼¨íÄôÀ¸Äˆ(€€€€€€€ô(€€€€€ô¤ì(€€€€€½¹ÍÐ½¹Ñ•¹ÑQåÁ”€ôÉ•ÍÁ½¹Í”¹¡•…‘•ÉÌ¹•Ð ‰½¹Ñ•¹ÐµÑåÁ”ˆ¤ñð€‰…ÁÁ±¥…Ñ¥½¸½½Ñ•ÐµÍÑÉ•…´ˆì(€€€€€½¹ÍÐ¡•…‘•ÉÌ€ôÉ•ÍÁ½¹Í”¹¡•…‘•ÉÌì(€€€€€¥˜€¡±½½­Í1¥­•±½Õ‘™±…É”¡¡•…‘•ÉÌ°€ˆˆ¤¤(€€€€€€€É•ÑÕÉ¸ì­¥¹è€‰±½Õ‘™±…É”ˆ°É•…Í½¸è€‰±½Õ‘™±…É”‰É½ÝÍ•ÈÙ•É¥™¥…Ñ¥½¸ˆôì(€€€€€½¹ÍÐ¡…±±•¹•MÑ…ÑÕÌ€ôlÐÀÄ°€ÐÀÌ°€ÐÀÜ°€ÐÈåt¹¥¹±Õ‘•Ì¡É•ÍÁ½¹Í”¹ÍÑ…ÑÕÌ¤ì(€€€€€½¹ÍÐ¡Ñµ°€ô½¹Ñ•¹ÑQåÁ”¹Ñ½1½Ý•É…Í” ¤¹¥¹±Õ‘•Ì ‰Ñ•áÐ½¡Ñµ°ˆ¤ì(€€€€€¥˜€¡¡…±±•¹•MÑ…ÑÕÌ¤ì(€€€€€€€½¹ÍÐÍ…µÁ±”È€ô¹•ÜQ•áÑ•½‘•È ¤¹‘•½‘”¡…Ý…¥ÐÉ•…‘AÉ•™¥à¡É•ÍÁ½¹Í”°€àÄäÈ¤¤ì(€€€€€€€¥˜€¡±½½­Í1¥­•±½Õ‘™±…É”¡¡•…‘•ÉÌ°Í…µÁ±”È¤¤(€€€€€€€€€É•ÑÕÉ¸ì­¥¹è€‰±½Õ‘™±…É”ˆ°É•…Í½¸è€‰±½Õ‘™±…É”‰É½ÝÍ•ÈÙ•É¥™¥…Ñ¥½¸ˆôì(€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€­¥¹è€‰¡…±±•¹”ˆ°(€€€€€€€€€É•…Í½¸è!QQ@€‘íÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÍôÉ•ÅÕ¥É•Ì‰É½ÝÍ•ÈÙ•É¥™¥…Ñ¥½¸½È±½¥¹€(€€€€€€€ôì(€€€€€ô(€€€€€¥˜€ …É•ÍÁ½¹Í”¹½¬¤Ñ¡É½Ü¹•ÜÉÉ½È¡!QQ@€‘íÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÍõ€¤ì(€€€€€½¹ÍÐ‰åÑ•Ì€ô…Ý…¥ÐÉ•…‘	½‘ä¡É•ÍÁ½¹Í”°±¥µ¥Ð¤ì(€€€€€½¹ÍÐÉ•Í½±Ù•‘UÉ°€ôÉ•ÍÁ½¹Í”¹ÕÉ°ñðÑ…É•Ðì(€€€€€½¹ÍÐÍ…µÁ±”€ô¡Ñµ°€ü¹•ÜQ•áÑ•½‘•È ¤¹‘•½‘”¡‰åÑ•Ì¹ÍÕ‰…ÉÉ…ä À°€àÄäÈ¤¤€è€ˆˆì(€€€€€¥˜€¡±½½­Í1¥­•±½Õ‘™±…É”¡¡•…‘•ÉÌ°Í…µÁ±”¤¤(€€€€€€€É•ÑÕÉ¸ì­¥¹è€‰±½Õ‘™±…É”ˆ°É•…Í½¸è€‰±½Õ‘™±…É”‰É½ÝÍ•ÈÙ•É¥™¥…Ñ¥½¸ˆôì(€€€€€¥˜€¡±½½­Í1¥­•¡…±±•¹”¡É•ÍÁ½¹Í”¹ÍÑ…ÑÕÌ°½¹Ñ•¹ÑQåÁ”°Í…µÁ±”¤¤(€€€€€€€É•ÑÕÉ¸ì­¥¹è€‰¡…±±•¹”ˆ°É•…Í½¸è€‰I•ÍÁ½¹Í”É•ÅÕ¥É•Ì‰É½ÝÍ•ÈÙ•É¥™¥…Ñ¥½¸½È±½¥¸ˆôì(€€€€€É•ÑÕÉ¸ì­¥¹è€‰½¬ˆ°‰åÑ•Ì°É•Í½±Ù•‘UÉ°°½¹Ñ•¹ÑQåÁ”°É•ÍÁ½¹Í”ôì(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€½¹ÍÐ‰É½ÝÍ•ÉI•ÅÕ¥É•€ô•ÉÉ½È¹¹…µ”€ôôô€‰‰½ÉÑÉÉ½Èˆ€ü™…±Í”€è€½!QQ@€ ÐÀÅðÐÀÍðÐÀÝðÐÈä¥ñ±½Õ‘™±…É•ñ…ÁÑ¡…ñ±½¥¹ñÉ•ÅÕ¥É•½¤¹Ñ•ÍÐ¡•ÉÉ½È¹µ•ÍÍ…”¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€­¥¹è€‰•ÉÉ½Èˆ°(€€€€€€€É•…Í½¸è•ÉÉ½È¹¹…µ”€ôôô€‰‰½ÉÑÉÉ½Èˆ€˜˜Í¥¹…°ü¹…‰½ÉÑ•€ü€‰…‰½ÉÑ•ˆ€è•ÉÉ½È¹µ•ÍÍ…”°(€€€€€€€‰É½ÝÍ•ÉI•ÅÕ¥É•(€€€€€ôì(€€€ô™¥¹…±±äì(€€€€€±•…ÉQ¥µ•½ÕÐ¡Ñ¥µ•È¤ì(€€€€€Í¥¹…°ü¹É•µ½Ù•Ù•¹Ñ1¥ÍÑ•¹•È ‰…‰½ÉÐˆ°½¹‰½ÉÐ¤ì(€€€ô(€ô(€½¹ÍÐ¹••‘Í	É½ÝÍ•È€ô€¡…ÑÑ•µÁÐ¤€ôø…ÑÑ•µÁÐ¹­¥¹€ôôô€‰¡…±±•¹”ˆñð…ÑÑ•µÁÐ¹­¥¹€ôôô€‰±½Õ‘™±…É”ˆñð…ÑÑ•µÁÐ¹‰É½ÝÍ•ÉI•ÅÕ¥É•€ôôôÑÉÕ”ì(€½¹ÍÐ™…¥±ÕÉ•½È€ô€¡Ñ…É•Ð°…ÑÑ•µÁÐ¤€ôø€¡ì(€€€ÕÉ°èÑ…É•Ð°(€€€…Ñ•½Éä°(€€€™…¥±•‘}…Ðè€ ¼¨}}AUI}|€¨¼¹•Ü…Ñ” ¤¤¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€É•…Í½¸è…ÑÑ•µÁÐ¹É•…Í½¸°(€€€‰É½ÝÍ•É}É•ÅÕ¥É•è¹••‘Í	É½ÝÍ•È¡…ÑÑ•µÁÐ¤°(€€€€¸¸¹¹••‘Í	É½ÝÍ•È¡…ÑÑ•µÁÐ¤€üì‰É½ÝÍ•É}¡…¹‘½™˜è¡…¹‘½™˜¡Ñ…É•Ð¤ô€èíô(€ô¤ì(€±•Ð±½Õ‘™±…É•Í­•€ô™…±Í”ì(€…Íå¹Œ™Õ¹Ñ¥½¸…Í­±½Õ‘™±…É•=¹”¡Ñ…É•Ð¤ì(€€€¥˜€¡ÑåÁ•½˜Á½ÉÑÌ¹…Í­±½Õ‘™±…É”€„ôô€‰™Õ¹Ñ¥½¸ˆñð±½Õ‘™±…É•Í­•ñðÍ¥¹…°ü¹…‰½ÉÑ•¤É•ÑÕÉ¸€‰Õ¹…Ù…¥±…‰±”ˆì(€€€±½Õ‘™±…É•Í­•€ôÑÉÕ”ì(€€€ÑÉäì(€€€€€½¹ÍÐ…¹ÍÝ•È€ô…Ý…¥ÐÁ½ÉÑÌ¹…Í­±½Õ‘™±…É”¡Ñ…É•Ð°Í¥¹…°¤ì(€€€€€É•ÑÕÉ¸…¹ÍÝ•È€ôôô€‰½¹Ñ¥¹Õ”ˆ€ü€‰½¹Ñ¥¹Õ”ˆ€è€‰Í­¥Àˆì(€€€ô…Ñ ì(€€€€€É•ÑÕÉ¸€‰Í­¥Àˆì(€€€ô(€ô(€…Íå¹Œ™Õ¹Ñ¥½¸É•Í½±Ù•ÑÑ•µÁÐ¡Ñ…É•Ð¤ì(€€€½¹ÍÐ…ÑÑ•µÁÐ€ô…Ý…¥Ð…ÑÑ•µÁÑ½Ý¹±½…¡Ñ…É•Ð¤ì(€€€¥˜€¡…ÑÑ•µÁÐ¹­¥¹€„ôô€‰±½Õ‘™±…É”ˆ¤É•ÑÕÉ¸…ÑÑ•µÁÐì(€€€¥˜€¡…Ý…¥Ð…Í­±½Õ‘™±…É•=¹”¡Ñ…É•Ð¤€„ôô€‰½¹Ñ¥¹Õ”ˆ¤É•ÑÕÉ¸ì€¸¸¹…ÑÑ•µÁÐ°‰É½ÝÍ•ÉI•ÅÕ¥É•èÑÉÕ”ôì(€€€½¹ÍÐÉ•ÑÉä€ô…Ý…¥Ð…ÑÑ•µÁÑ½Ý¹±½…¡Ñ…É•Ð¤ì(€€€¥˜€¡É•ÑÉä¹­¥¹€ôôô€‰±½Õ‘™±…É”ˆñðÉ•ÑÉä¹­¥¹€ôôô€‰¡…±±•¹”ˆ¤É•ÑÕÉ¸ì€¸¸¹É•ÑÉä°‰É½ÝÍ•ÉI•ÅÕ¥É•èÑÉÕ”ôì(€€€É•ÑÕÉ¸É•ÑÉäì(€ô(€½¹ÍÐ±•…å…¥±ÕÉ”€ô…Íå¹Œ€¡™…¥±ÕÉ”È¤€ôøì(€€€…Ý…¥ÐÉ•½É‘…¥±ÕÉ”¡Á½ÉÑÌ°µ…¹¥™•ÍÑA…Ñ °™…¥±ÕÉ•ÍA…Ñ °ÉÕ¹¥È°™…¥±ÕÉ”È¤ì(€€€É•ÑÕÉ¸ì(€€€€€ÍÑ…ÑÕÌè™…¥±ÕÉ”È¹‰É½ÝÍ•É}É•ÅÕ¥É•€ü€‰‰É½ÝÍ•É}É•ÅÕ¥É•ˆ€è€‰™…¥±•ˆ°(€€€€€€¸¸¹™…¥±ÕÉ”È°(€€€€€µ…¹¥™•ÍÑ}Á…Ñ èµ…¹¥™•ÍÑA…Ñ °(€€€€€™…¥±ÕÉ•Í}Á…Ñ è™…¥±ÕÉ•ÍA…Ñ (€€€ôì(€ôì(€½¹ÍÐ…ÑÑ•µÁÑÌ€ômtì(€¥˜€¡ÕÉ°€„ô¹Õ±°¤ì(€€€½¹ÍÐ…ÑÑ•µÁÐ€ô…Ý…¥ÐÉ•Í½±Ù•ÑÑ•µÁÐ¡ÕÉ°¤ì(€€€±•Ð™…¥±ÕÉ”È€ô¹Õ±°ì(€€€¥˜€¡…ÑÑ•µÁÐ¹­¥¹€ôôô€‰½¬ˆ¤ì(€€€€€½¹ÍÐ½ÕÑÁÕÑ9…µ”€ôÍ…™•¥±•¹…µ” (€€€€€€€™¥±•¹…µ”ñð™¥±•¹…µ•É½µI•ÍÁ½¹Í”¡…ÑÑ•µÁÐ¹É•ÍÁ½¹Í”°…ÑÑ•µÁÐ¹É•Í½±Ù•‘UÉ°°…Ñ•½Éä¤°(€€€€€€€€‘í…Ñ•½Éåô´‘íÉ…¹‘½µUU%È ¥ô¹‰¥¹€(€€€€€€¤ì(€€€€€ÑÉäì(€€€€€€€É•ÑÕÉ¸…Ý…¥ÐÁ•ÉÍ¥ÍÐ¡…ÑÑ•µÁÐ¹‰åÑ•Ì°ì(€€€€€€€€€É•Í½±Ù•‘UÉ°è…ÑÑ•µÁÐ¹É•Í½±Ù•‘UÉ°°(€€€€€€€€€½¹Ñ•¹ÑQåÁ”è…ÑÑ•µÁÐ¹½¹Ñ•¹ÑQåÁ”°(€€€€€€€€€½ÕÑÁÕÑ9…µ”(€€€€€€€ô¤ì(€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€™…¥±ÕÉ”È€ô™…¥±ÕÉ•½È¡ÕÉ°°ì(€€€€€€€€€­¥¹è€‰•ÉÉ½Èˆ°(€€€€€€€€€É•…Í½¸è•ÉÉ½È¹µ•ÍÍ…”°(€€€€€€€€€‰É½ÝÍ•ÉI•ÅÕ¥É•è€½!QQ@€ ÐÀÅðÐÀÍðÐÀÝðÐÈä¥ñ±½Õ‘™±…É•ñ…ÁÑ¡…ñ±½¥¹ñÉ•ÅÕ¥É•½¤¹Ñ•ÍÐ¡•ÉÉ½È¹µ•ÍÍ…”¤(€€€€€€€ô¤ì(€€€€€ô(€€€ô•±Í”™…¥±ÕÉ”È€ô™…¥±ÕÉ•½È¡ÕÉ°°…ÑÑ•µÁÐ¤ì(€€€¥˜€ …½Á•¹•ÍÍ]…¹Ñ•¤É•ÑÕÉ¸±•…å…¥±ÕÉ”¡™…¥±ÕÉ”È¤ì(€€€…ÑÑ•µÁÑÌ¹ÁÕÍ ¡ì(€€€€€ÕÉ°°(€€€€€Í½ÕÉ”è€‰¥Ù•¸ˆ°(€€€€€É•…Í½¸è™…¥±ÕÉ”È¹É•…Í½¸°(€€€€€‰É½ÝÍ•É}É•ÅÕ¥É•è™…¥±ÕÉ”È¹‰É½ÝÍ•É}É•ÅÕ¥É•(€€€ô¤ì(€ô(€±•ÐÉ•Í½±ÕÑ¥½¸ì(€ÑÉäì(€€€É•Í½±ÕÑ¥½¸€ô…Ý…¥ÐÉ•Í½±Ù•=Á•¹•ÍÌ¡ì(€€€€€€¸¸¹¥‘•¹Ñ¥Ñä°(€€€€€•µ…¥°°(€€€€€™•Ñ¡%µÁ°°(€€€€€Í¥¹…°°(€€€€€•¹Ø°(€€€€€Ñ¥µ•½ÕÑ5Ìè5…Ñ ¹µ¥¸¡Ñ¥µ•½ÕÐ°€ÄÕ”Ì¤°(€€€€€µ…á…¹‘¥‘…Ñ•Ìè…¹‘¥‘…Ñ•1¥µ¥Ð(€€€ô¤ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€É•Í½±ÕÑ¥½¸€ôì(€€€€€€¸¸¹¥‘•¹Ñ¥Ñä°(€€€€€…¹‘¥‘…Ñ•Ìèmt°(€€€€€ÅÕ•É¥•èmìÍ½ÕÉ”è€‰É•Í½±Ù•Èˆ°ÍÑ…ÑÕÌè€‰•ÉÉ½Èˆ°‘•Ñ…¥°è•ÉÉ½È¹µ•ÍÍ…”õt(€€€ôì(€ô(€™½È€¡½¹ÍÐ­•ä½˜l‰‘½¤ˆ°€‰Áµ¥ˆ°€‰Áµ¥‰t¤¥‘•¹Ñ¥Ñåm­•åt€ô¥‘•¹Ñ¥Ñåm­•åtñðÉ•Í½±ÕÑ¥½¹m­•åtñð¹Õ±°ì(€™½È€¡½¹ÍÐ…¹‘¥‘…Ñ”½˜É•Í½±ÕÑ¥½¸¹…¹‘¥‘…Ñ•Ì¹Í±¥” À°…¹‘¥‘…Ñ•1¥µ¥Ð¤¤ì(€€€¥˜€¡Í¥¹…°ü¹…‰½ÉÑ•¤‰É•…¬ì(€€€½¹ÍÐ…ÑÑ•µÁÐ€ô…Ý…¥ÐÉ•Í½±Ù•ÑÑ•µÁÐ¡…¹‘¥‘…Ñ”¹ÕÉ°¤ì(€€€¥˜€¡…ÑÑ•µÁÐ¹­¥¹€„ôô€‰½¬ˆ¤ì(€€€€€…ÑÑ•µÁÑÌ¹ÁÕÍ ¡ì(€€€€€€€ÕÉ°è…¹‘¥‘…Ñ”¹ÕÉ°°(€€€€€€€Í½ÕÉ”è…¹‘¥‘…Ñ”¹Í½ÕÉ”°(€€€€€€€É•…Í½¸è…ÑÑ•µÁÐ¹É•…Í½¸°(€€€€€€€‰É½ÝÍ•É}É•ÅÕ¥É•è¹••‘Í	É½ÝÍ•È¡…ÑÑ•µÁÐ¤(€€€€€ô¤ì(€€€€€½¹Ñ¥¹Õ”ì(€€€ô(€€€½¹ÍÐ½ÕÑÁÕÑ9…µ”€ôÍ…™•¥±•¹…µ” (€€€€€™¥±•¹…µ”ñð™¥±•¹…µ•É½µI•ÍÁ½¹Í”¡…ÑÑ•µÁÐ¹É•ÍÁ½¹Í”°…ÑÑ•µÁÐ¹É•Í½±Ù•‘UÉ°°…Ñ•½Éä¤°(€€€€€€‘í…Ñ•½Éåô´‘íÉ…¹‘½µUU%È ¥ô¹‰¥¹€(€€€€¤ì(€€€ÑÉäì(€€€€€É•ÑÕÉ¸…Ý…¥ÐÁ•ÉÍ¥ÍÐ¡…ÑÑ•µÁÐ¹‰åÑ•Ì°ì(€€€€€€€É•Í½±Ù•‘UÉ°è…ÑÑ•µÁÐ¹É•Í½±Ù•‘UÉ°°(€€€€€€€½¹Ñ•¹ÑQåÁ”è…ÑÑ•µÁÐ¹½¹Ñ•¹ÑQåÁ”°(€€€€€€€½ÕÑÁÕÑ9…µ”è€½p¹Á‘˜½¤¹Ñ•ÍÐ¡½ÕÑÁÕÑ9…µ”¤€ü½ÕÑÁÕÑ9…µ”€è€‘í½ÕÑÁÕÑ9…µ”¹É•Á±…” ½p¹m„µèÀ´åuìÄ°Õô½¤°€ˆˆ¥ô¹Á‘™€°(€€€€€€€½Á•¹•ÍÌèì(€€€€€€€€€Í½ÕÉ”è…¹‘¥‘…Ñ”¹Í½ÕÉ”°(€€€€€€€€€ÕÉ°è…¹‘¥‘…Ñ”¹ÕÉ°°(€€€€€€€€€±¥•¹Í”è…¹‘¥‘…Ñ”¹±¥•¹Í”ñðÉ•Í½±ÕÑ¥½¸¹±¥•¹Í”ñð¹Õ±°°(€€€€€€€€€Ù•ÉÍ¥½¸è…¹‘¥‘…Ñ”¹Ù•ÉÍ¥½¸ñð¹Õ±°°(€€€€€€€€€½…}ÍÑ…ÑÕÌèÉ•Í½±ÕÑ¥½¸¹½…MÑ…ÑÕÌñð¹Õ±°°(€€€€€€€€€…¹‘¥‘…Ñ•Í}ÑÉ¥•è…ÑÑ•µÁÑÌ¹±•¹Ñ €¬€Ä(€€€€€€€ô(€€€€€ô¤ì(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€…ÑÑ•µÁÑÌ¹ÁÕÍ ¡ì(€€€€€€€ÕÉ°è…¹‘¥‘…Ñ”¹ÕÉ°°(€€€€€€€Í½ÕÉ”è…¹‘¥‘…Ñ”¹Í½ÕÉ”°(€€€€€€€É•…Í½¸è•ÉÉ½È¹µ•ÍÍ…”°(€€€€€€€‰É½ÝÍ•É}É•ÅÕ¥É•è™…±Í”(€€€€€ô¤ì(€€€ô(€ô(€½¹ÍÐ}¥¹ÍÑ¥ÑÕÑ¥½¹…±I•ÍÕ±Ð€ô¹Õ±°ì(€±•Ð¥¹ÍÑ¥ÑÕÑ¥½¹…±½¹™¥œ€ô¹Õ±°ì(€ÑÉäì(€€€¥¹ÍÑ¥ÑÕÑ¥½¹…±½¹™¥œ€ô…Ý…¥ÐÁ½ÉÑÌ¹±½…‘%¹ÍÑ¥ÑÕÑ¥½¹…±½¹™¥œü¸ ¤ñð¹Õ±°ì(€ô…Ñ ì(€€€¥¹ÍÑ¥ÑÕÑ¥½¹…±½¹™¥œ€ô¹Õ±°ì(€ô(€½¹ÍÐ¥¹ÍÑ¥ÑÕÑ¥½¹…±¹…‰±•€ô¥¹ÍÑ¥ÑÕÑ¥½¹…±½¹™¥œü¹…ÕÑ½½Ý¹±½…‘¹…‰±•€„ôô™…±Í”€˜˜¥¹ÍÑ¥ÑÕÑ¥½¹…±½¹™¥œü¹½¹™¥ÕÉ•ì(€¥˜€¡¥¹ÍÑ¥ÑÕÑ¥½¹…±¹…‰±•€˜˜€¡Á½ÉÑÌ¹¥Í±•ÑÉ½¹Ù…¥±…‰±”ü¸ ¤€üü™…±Í”¤€˜˜Á½ÉÑÌ¹¥¹ÍÑ¥ÑÕÑ¥½¹…±•Ñ ¤ì(€€€½¹ÍÐ±¥µ¥ÐÈ€ô¥¹ÍÑ¥ÑÕÑ¥½¹…±½¹™¥œü¹Á•ÉQ…Í­1¥µ¥Ð€üü€ÈÀì(€€€±•ÐÕÍ•€ô€Àì(€€€ÑÉäì(€€€€€½¹ÍÐµ…¹¥™•ÍÐ€ô…Ý…¥ÐÉ•…‘5…¹¥™•ÍÐ¡µ…¹¥™•ÍÑA…Ñ °ÉÕ¹¥È¤ì(€€€€€ÕÍ•€ôµ…¹¥™•ÍÐ¹¥Ñ•µÌ¹™¥±Ñ•È ¡¥Ð¤€ôø¥Ð¹½Á•¹}…•ÍÌü¹Í½ÕÉ”€ôôô€‰¥¹ÍÑ¥ÑÕÑ¥½¹…°ˆ¤¹±•¹Ñ ì(€€€ô…Ñ ì(€€€€€ÕÍ•€ô€Àì(€€€ô(€€€¥˜€¡ÕÍ•€øô±¥µ¥ÐÈ¤ì(€€€€€½¹ÍÐ™…¥±ÕÉ•1¥µ¥Ð€ôì(€€€€€€€ÕÉ°èÕÉ°ñð¡ÑÑÁÌè¼½‘½¤¹½Éœ¼‘í¥‘•¹Ñ¥Ñä¹‘½¤ñð€ˆ‰õ€¹É•Á±…” ½p¼¼°€ˆˆ¤°(€€€€€€€…Ñ•½Éä°(€€€€€€€™…¥±•‘}…Ðè€ ¼¨}}AUI}|€¨¼¹•Ü…Ñ” ¤¤¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€€€€€É•…Í½¸è¥¹ÍÑ¥ÑÕÑ¥½¹…°±¥µ¥ÐÉ•…¡•è€‘íÕÍ•‘ô¼‘í±¥µ¥ÐÉô™¥±•Ì…±É•…‘ä™•Ñ¡•Ù¥„¥¹ÍÑ¥ÑÕÑ¥½¹…°…•ÍÌ¥¸Ñ¡¥ÌÉÕ¹€°(€€€€€€€‰É½ÝÍ•É}É•ÅÕ¥É•è™…±Í”°(€€€€€€€½Á•¹}…•ÍÌèì(€€€€€€€€€‘½¤è¥‘•¹Ñ¥Ñä¹‘½¤°(€€€€€€€€€Áµ¥èÉ•Í½±ÕÑ¥½¸¹Áµ¥ñð¥‘•¹Ñ¥Ñä¹Áµ¥°(€€€€€€€€€Áµ¥èÉ•Í½±ÕÑ¥½¸¹Áµ¥ñð¥‘•¹Ñ¥Ñä¹Áµ¥°(€€€€€€€€€½…}ÍÑ…ÑÕÌèÉ•Í½±ÕÑ¥½¸¹½…MÑ…ÑÕÌñð¹Õ±°°(€€€€€€€€€±¥•¹Í”èÉ•Í½±ÕÑ¥½¸¹±¥•¹Í”ñð¹Õ±°°(€€€€€€€€€ÅÕ•É¥•èÉ•Í½±ÕÑ¥½¸¹ÅÕ•É¥•°(€€€€€€€€€…ÑÑ•µÁÑÌ(€€€€€€€ô°(€€€€€€€¥¹ÍÑ¥ÑÕÑ¥½¹…°èì(€€€€€€€€€±¥µ¥Ðè±¥µ¥ÐÈ°(€€€€€€€€€ÕÍ•°(€€€€€€€€€ÍÑ…ÑÕÌè€‰±¥µ¥Ñ}É•…¡•ˆ(€€€€€€€ô(€€€€€ôì(€€€€€…Ý…¥ÐÉ•½É‘…¥±ÕÉ”¡Á½ÉÑÌ°µ…¹¥™•ÍÑA…Ñ °™…¥±ÕÉ•ÍA…Ñ °ÉÕ¹¥È°™…¥±ÕÉ•1¥µ¥Ð¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€ÍÑ…ÑÕÌè€‰¥¹ÍÑ¥ÑÕÑ¥½¹…±}±¥µ¥Ñ}É•…¡•ˆ°(€€€€€€€€¸¸¹™…¥±ÕÉ•1¥µ¥Ð°(€€€€€€€µ…¹¥™•ÍÑ}Á…Ñ èµ…¹¥™•ÍÑA…Ñ °(€€€€€€€™…¥±ÕÉ•Í}Á…Ñ è™…¥±ÕÉ•ÍA…Ñ (€€€€€ôì(€€€ô(€€€½¹ÍÐ…¹‘¥‘…Ñ•Ì€ômtì(€€€½¹ÍÐ½É¥¥¹…±½ÉAÉ½áä€ôÕÉ°ñð€¡¥‘•¹Ñ¥Ñä¹‘½¤€ü¡ÑÑÁÌè¼½‘½¤¹½Éœ¼‘í¥‘•¹Ñ¥Ñä¹‘½¥õ€€è¹Õ±°¤ì(€€€½¹ÍÐÕÉ±ÍQ½QÉä€ômtì(€€€¥˜€¡½É¥¥¹…±½ÉAÉ½áä¤ÕÉ±ÍQ½QÉä¹ÁÕÍ ¡½É¥¥¹…±½ÉAÉ½áä¤ì(€€€™½È€¡½¹ÍÐŒ½˜É•Í½±ÕÑ¥½¸¹…¹‘¥‘…Ñ•Ì¹Í±¥” À°…¹‘¥‘…Ñ•1¥µ¥Ð¤¤ì(€€€€€¥˜€¡Œ¹ÕÉ°€˜˜€…ÕÉ±ÍQ½QÉä¹¥¹±Õ‘•Ì¡Œ¹ÕÉ°¤¤ÕÉ±ÍQ½QÉä¹ÁÕÍ ¡Œ¹ÕÉ°¤ì(€€€ô(€€€¥˜€¡¥‘•¹Ñ¥Ñä¹‘½¤¤ì(€€€€€½¹ÍÐ‘½¥UÉ°€ô¡ÑÑÁÌè¼½‘½¤¹½Éœ¼‘í¥‘•¹Ñ¥Ñä¹‘½¥õ€ì(€€€€€¥˜€ …ÕÉ±ÍQ½QÉä¹¥¹±Õ‘•Ì¡‘½¥UÉ°¤¤ÕÉ±ÍQ½QÉä¹ÁÕÍ ¡‘½¥UÉ°¤ì(€€€ô(€€€™½È€¡½¹ÍÐÔ½˜ÕÉ±ÍQ½QÉä¤ì(€€€€€½¹ÍÐÁÉ½á¥•€ô¥¹ÍÑ¥ÑÕÑ¥½¹…±½¹™¥œ¹•éÁÉ½áåQ•µÁ±…Ñ”€˜˜Á½ÉÑÌ¹‰Õ¥±‘AÉ½á¥•‘UÉ°€üÁ½ÉÑÌ¹‰Õ¥±‘AÉ½á¥•‘UÉ°¡Ô°MÑÉ¥¹œ¡¥¹ÍÑ¥ÑÕÑ¥½¹…±½¹™¥œ¹•éÁÉ½áåQ•µÁ±…Ñ”¤¤€è¹Õ±°ì(€€€€€¥˜€¡ÁÉ½á¥•¤…¹‘¥‘…Ñ•Ì¹ÁÕÍ ¡ìÕÉ°èÁÉ½á¥•°Ù¥„è€‰•éÁÉ½áäˆ°½É¥¥¹…°èÔô¤ì(€€€€€…¹‘¥‘…Ñ•Ì¹ÁÕÍ ¡ìÕÉ°èÔ°Ù¥„è€‰¥¹ÍÑ¥ÑÕÑ¥½¹…±}Í•ÍÍ¥½¸ˆ°½É¥¥¹…°èÔô¤ì(€€€ô(€€€™½È€¡½¹ÍÐ…¹½˜…¹‘¥‘…Ñ•Ì¤ì(€€€€€¥˜€¡Í¥¹…°ü¹…‰½ÉÑ•¤‰É•…¬ì(€€€€€ÑÉäì(€€€€€€€±•Ð¥¹ÍÐ€ô…Ý…¥ÐÁ½ÉÑÌ¹¥¹ÍÑ¥ÑÕÑ¥½¹…±•Ñ ¡…¹¹ÕÉ°°ìÑ¥µ•½ÕÑ5Ìè5…Ñ ¹µ¥¸¡Ñ¥µ•½ÕÐ°€É”Ð¤ô¤ì(€€€€€€€±•ÐÙ¥•Ý•€ô¥¹ÍÑ¥ÑÕÑ¥½¹…±Q•áÐ¡¥¹ÍÐ¤ì(€€€€€€€¥˜€¡±½½­Í1¥­•±½Õ‘™±…É”¡¥¹ÍÐ¹¡•…‘•ÉÌ°Ù¥•Ý•¹Í¹¥ÁÁ•Ð¤¤ì(€€€€€€€€€½¹ÍÐ¡½¥”€ô…Ý…¥Ð…Í­±½Õ‘™±…É•=¹”¡…¹¹ÕÉ°¤ì(€€€€€€€€€±•ÐÍÑ¥±±±½Õ‘™±…É”€ôÑÉÕ”ì(€€€€€€€€€¥˜€¡¡½¥”€ôôô€‰½¹Ñ¥¹Õ”ˆ¤ì(€€€€€€€€€€€¥¹ÍÐ€ô…Ý…¥ÐÁ½ÉÑÌ¹¥¹ÍÑ¥ÑÕÑ¥½¹…±•Ñ ¡…¹¹ÕÉ°°ìÑ¥µ•½ÕÑ5Ìè5…Ñ ¹µ¥¸¡Ñ¥µ•½ÕÐ°€É”Ð¤ô¤ì(€€€€€€€€€€€Ù¥•Ý•€ô¥¹ÍÑ¥ÑÕÑ¥½¹…±Q•áÐ¡¥¹ÍÐ¤ì(€€€€€€€€€€€ÍÑ¥±±±½Õ‘™±…É”€ô±½½­Í1¥­•±½Õ‘™±…É”¡¥¹ÍÐ¹¡•…‘•ÉÌ°Ù¥•Ý•¹Í¹¥ÁÁ•Ð¤ì(€€€€€€€€€ô(€€€€€€€€€¥˜€¡ÍÑ¥±±±½Õ‘™±…É”¤ì(€€€€€€€€€€€…ÑÑ•µÁÑÌ¹ÁÕÍ ¡ì(€€€€€€€€€€€€€ÕÉ°è…¹¹ÕÉ°°(€€€€€€€€€€€€€Í½ÕÉ”è…¹¹Ù¥„€ôôô€‰•éÁÉ½áäˆ€ü€‰•éÁÉ½áäˆ€è€‰¥¹ÍÑ¥ÑÕÑ¥½¹…±}Í•ÍÍ¥½¸ˆ°(€€€€€€€€€€€€€É•…Í½¸è€‰±½Õ‘™±…É”‰É½ÝÍ•ÈÙ•É¥™¥…Ñ¥½¸ˆ°(€€€€€€€€€€€€€‰É½ÝÍ•É}É•ÅÕ¥É•èÑÉÕ”°(€€€€€€€€€€€€€±½Õ‘™±…É”èÑÉÕ”(€€€€€€€€€€€ô¤ì(€€€€€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€€€€€ô(€€€€€€€ô(€€€€€€€¥˜€¡¥¹ÍÐ¹ÍÑ…ÑÕÌ€øô€ÈÀÀ€˜˜¥¹ÍÐ¹ÍÑ…ÑÕÌ€ð€ÐÀÀ¤ì(€€€€€€€€€½¹ÍÐÐ€ôÙ¥•Ý•¹½¹Ñ•¹ÑQåÁ”ñð¥¹ÍÐ¹¡•…‘•ÉÌü¹l‰½¹Ñ•¹ÐµÑåÁ”‰tñð€ˆˆì(€€€€€€€€€½¹ÍÐ}¥ÍA‘˜€ôÐ¹¥¹±Õ‘•Ì ‰Á‘˜ˆ¤ñð…¹¹ÕÉ°¹Ñ½1½Ý•É…Í” ¤¹¥¹±Õ‘•Ì ˆ¹Á‘˜ˆ¤ì(€€€€€€€€€½¹ÍÐ¥Í!Ñµ±1½¥¸€ôÐ¹¥¹±Õ‘•Ì ‰Ñ•áÐ½¡Ñµ°ˆ¤€˜˜¥¹ÍÐ¹‰½‘äü¹‰åÑ•1•¹Ñ €ð€Å”Ô€˜˜€  ¤€ôøì(€€€€€€€€€€€ÑÉäì(€€€€€€€€€€€€€½¹ÍÐÍ¹¥ÁÁ•Ð€ô¹•ÜQ•áÑ•½‘•È ¤¹‘•½‘”¡¥¹ÍÐ¹‰½‘ä¹Í±¥” À°€Ñ”Ì¤¤¹Ñ½1½Ý•É…Í” ¤ì(€€€€€€€€€€€€€É•ÑÕÉ¸Í¹¥ÁÁ•Ð¹¥¹±Õ‘•Ì ‰Í¡¥‰‰½±•Ñ ˆ¤ñðÍ¹¥ÁÁ•Ð¹¥¹±Õ‘•Ì ‰±½¥¸ˆ¤€˜˜Í¹¥ÁÁ•Ð¹¥¹±Õ‘•Ì ‰Á…ÍÍÝ½Éˆ¤ñðÍ¹¥ÁÁ•Ð¹¥¹±Õ‘•Ì ‰½Á•¹…Ñ¡•¹Ìˆ¤€˜˜Í¹¥ÁÁ•Ð¹¥¹±Õ‘•Ì ‰Í¥¸¥¸ˆ¤ñðÍ¹¥ÁÁ•Ð¹¥¹±Õ‘•Ì ‰•éÁÉ½áäˆ¤€˜˜Í¹¥ÁÁ•Ð¹¥¹±Õ‘•Ì ‰±½¥¸ˆ¤ì(€€€€€€€€€€€ô…Ñ ì(€€€€€€€€€€€€€É•ÑÕÉ¸™…±Í”ì(€€€€€€€€€€€ô(€€€€€€€€€ô¤ ¤ì(€€€€€€€€€¥˜€¡¥Í!Ñµ±1½¥¸¤ì(€€€€€€€€€€€…ÑÑ•µÁÑÌ¹ÁÕÍ ¡ì(€€€€€€€€€€€€€ÕÉ°è…¹¹ÕÉ°°(€€€€€€€€€€€€€Í½ÕÉ”è…¹¹Ù¥„€ôôô€‰•éÁÉ½áäˆ€ü€‰•éÁÉ½áäˆ€è€‰¥¹ÍÑ¥ÑÕÑ¥½¹…±}Í•ÍÍ¥½¸ˆ°(€€€€€€€€€€€€€É•…Í½¸è¥¹ÍÑ¥ÑÕÑ¥½¹…°…ÕÑ É•ÅÕ¥É•€¡±½¥¸Á…”‘•Ñ•Ñ•…Ð€‘í…¹¹ÕÉ°¹Í±¥” À°€ÄÈÀ¥ô¥€°(€€€€€€€€€€€€€‰É½ÝÍ•É}É•ÅÕ¥É•èÑÉÕ”(€€€€€€€€€€€ô¤ì(€€€€€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€€€€€ô(€€€€€€€€€½¹ÍÐ½ÕÑÁÕÑ9…µ”€ôÍ…™•¥±•¹…µ” (€€€€€€€€€€€™¥±•¹…µ”ñð™¥±•¹…µ•É½µI•ÍÁ½¹Í” (€€€€€€€€€€€€€ì¡•…‘•ÉÌèì•Ðè€¡¬¤€ôø¥¹ÍÐ¹¡•…‘•ÉÍm¬¹Ñ½1½Ý•É…Í” ¥tñð€ˆˆôô°(€€€€€€€€€€€€€¥¹ÍÐ¹™¥¹…±UÉ°°(€€€€€€€€€€€€€…Ñ•½Éä(€€€€€€€€€€€€¤°(€€€€€€€€€€€€‘í…Ñ•½Éåô´‘íÉ…¹‘½µUU%È ¥ô¹‰¥¹€(€€€€€€€€€€¤ì(€€€€€€€€€ÑÉäì(€€€€€€€€€€€É•ÑÕÉ¸…Ý…¥ÐÁ•ÉÍ¥ÍÐ¡¥¹ÍÐ¹‰½‘ä°ì(€€€€€€€€€€€€€É•Í½±Ù•‘UÉ°è¥¹ÍÐ¹™¥¹…±UÉ°°(€€€€€€€€€€€€€½¹Ñ•¹ÑQåÁ”èÐñð€‰…ÁÁ±¥…Ñ¥½¸½Á‘˜ˆ°(€€€€€€€€€€€€€½ÕÑÁÕÑ9…µ”è€½p¹Á‘˜½¤¹Ñ•ÍÐ¡½ÕÑÁÕÑ9…µ”¤€ü½ÕÑÁÕÑ9…µ”€è€‘í½ÕÑÁÕÑ9…µ”¹É•Á±…” ½p¹m„µèÀ´åuìÄ°Õô½¤°€ˆˆ¥ô¹Á‘™€°(€€€€€€€€€€€€€½Á•¹•ÍÌèì(€€€€€€€€€€€€€€€Í½ÕÉ”è€‰¥¹ÍÑ¥ÑÕÑ¥½¹…°ˆ°(€€€€€€€€€€€€€€€ÕÉ°è…¹¹ÕÉ°°(€€€€€€€€€€€€€€€½É¥¥¹…±}ÕÉ°è…¹¹½É¥¥¹…°°(€€€€€€€€€€€€€€€Ù¥„è…¹¹Ù¥„°(€€€€€€€€€€€€€€€…¹‘¥‘…Ñ•Í}ÑÉ¥•è…ÑÑ•µÁÑÌ¹±•¹Ñ €¬€Ä(€€€€€€€€€€€€€ô(€€€€€€€€€€€ô¤ì(€€€€€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€€€€€…ÑÑ•µÁÑÌ¹ÁÕÍ ¡ì(€€€€€€€€€€€€€ÕÉ°è…¹¹ÕÉ°°(€€€€€€€€€€€€€Í½ÕÉ”è…¹¹Ù¥„€ôôô€‰•éÁÉ½áäˆ€ü€‰•éÁÉ½áäˆ€è€‰¥¹ÍÑ¥ÑÕÑ¥½¹…±}Í•ÍÍ¥½¸ˆ°(€€€€€€€€€€€€€É•…Í½¸è•ÉÉ½È¹µ•ÍÍ…”°(€€€€€€€€€€€€€‰É½ÝÍ•É}É•ÅÕ¥É•è™…±Í”(€€€€€€€€€€€ô¤ì(€€€€€€€€€ô(€€€€€€€ô(€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€…ÑÑ•µÁÑÌ¹ÁÕÍ ¡ì(€€€€€€€€€ÕÉ°è…¹¹ÕÉ°°(€€€€€€€€€Í½ÕÉ”è…¹¹Ù¥„€ôôô€‰•éÁÉ½áäˆ€ü€‰•éÁÉ½áäˆ€è€‰¥¹ÍÑ¥ÑÕÑ¥½¹…±}Í•ÍÍ¥½¸ˆ°(€€€€€€€€€É•…Í½¸è•ÉÉ½È¹µ•ÍÍ…”°(€€€€€€€€€‰É½ÝÍ•É}É•ÅÕ¥É•è€½!QQ@€ ÐÀÅðÐÀÍðÐÀÝðÐÈä¥ñ±½¥¹ñ…ÕÑ¡ñÍ¡¥‰‰½±•Ñ¡ñ…ÁÑ¡„½¤¹Ñ•ÍÐ¡•ÉÉ½È¹µ•ÍÍ…”¤(€€€€€€€ô¤ì(€€€€€ô(€€€ô(€ô(€½¹ÍÐ¡…±±•¹•€ô…ÑÑ•µÁÑÌ¹™¥¹ ¡„¤€ôø„¹‰É½ÝÍ•É}É•ÅÕ¥É•¤ì(€½¹ÍÐ±…‰•°È€ô¥‘•¹Ñ¥Ñä¹‘½¤€ü‘½¤è‘í¥‘•¹Ñ¥Ñä¹‘½¥õ€€è¥‘•¹Ñ¥Ñä¹Áµ¥ñðÁµ¥è‘í¥‘•¹Ñ¥Ñä¹Áµ¥‘õ€ì(€½¹ÍÐ¥¹ÍÑ¥ÑÕÑ¥½¹…±ÑÑ•µÁÐ€ô…ÑÑ•µÁÑÌ¹™¥¹ (€€€€¡„¤€ôø€¡„¹Í½ÕÉ”€ôôô€‰•éÁÉ½áäˆñð„¹Í½ÕÉ”€ôôô€‰¥¹ÍÑ¥ÑÕÑ¥½¹…±}Í•ÍÍ¥½¸ˆ¤€˜˜„¹±½Õ‘™±…É”€„ôôÑÉÕ”(€€¤ì(€½¹ÍÐ™…¥±ÕÉ”€ôì(€€€ÕÉ°èÕÉ°ñð¡ÑÑÁÌè¼½‘½¤¹½Éœ¼‘í¥‘•¹Ñ¥Ñä¹‘½¤ñð€ˆ‰õ€¹É•Á±…” ½p¼¼°€ˆˆ¤°(€€€…Ñ•½Éä°(€€€™…¥±•‘}…Ðè€ ¼¨}}AUI}|€¨¼¹•Ü…Ñ” ¤¤¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€É•…Í½¸èÉ•Í½±ÕÑ¥½¸¹…¹‘¥‘…Ñ•Ì¹±•¹Ñ €ü¹¼½Á•¸µ…•ÍÌA½Õ±‰”…É¡¥Ù•™½È€‘í±…‰•°Éôè€‘í…ÑÑ•µÁÑÌ¹±•¹Ñ¡ô…¹‘¥‘…Ñ”¡Ì¤™…¥±•‘€€è¹¼½Á•¸µ…•ÍÌ±½…Ñ¥½¸™½Õ¹™½È€‘í±…‰•°Éô€ ‘íÉ•Í½±ÕÑ¥½¸¹ÅÕ•É¥•¹µ…À ¡Ä¤€ôø€‘íÄ¹Í½ÕÉ•ôè‘íÄ¹ÍÑ…ÑÕÍõ€¤¹©½¥¸ ˆ°€ˆ¤ñð€‰¹¼Í½ÕÉ”…¹ÍÝ•É•‰ô¥€°(€€€‰É½ÝÍ•É}É•ÅÕ¥É•è	½½±•…¸¡¡…±±•¹•¤°(€€€€¸¸¹¡…±±•¹•€üì‰É½ÝÍ•É}¡…¹‘½™˜è¡…¹‘½™˜¡¡…±±•¹•¹ÕÉ°¤ô€èíô°(€€€½Á•¹}…•ÍÌèì(€€€€€‘½¤è¥‘•¹Ñ¥Ñä¹‘½¤°(€€€€€Áµ¥èÉ•Í½±ÕÑ¥½¸¹Áµ¥ñð¥‘•¹Ñ¥Ñä¹Áµ¥°(€€€€€Áµ¥èÉ•Í½±ÕÑ¥½¸¹Áµ¥ñð¥‘•¹Ñ¥Ñä¹Áµ¥°(€€€€€½…}ÍÑ…ÑÕÌèÉ•Í½±ÕÑ¥½¸¹½…MÑ…ÑÕÌñð¹Õ±°°(€€€€€±¥•¹Í”èÉ•Í½±ÕÑ¥½¸¹±¥•¹Í”ñð¹Õ±°°(€€€€€ÅÕ•É¥•èÉ•Í½±ÕÑ¥½¸¹ÅÕ•É¥•°(€€€€€…ÑÑ•µÁÑÌ(€€€ô°(€€€¥¹ÍÑ¥ÑÕÑ¥½¹…°è¥¹ÍÑ¥ÑÕÑ¥½¹…±½¹™¥œ€üì(€€€€€½¹™¥ÕÉ•è	½½±•…¸¡¥¹ÍÑ¥ÑÕÑ¥½¹…±½¹™¥œ¹½¹™¥ÕÉ•¤°(€€€€€…ÕÑ½}•¹…‰±•è¥¹ÍÑ¥ÑÕÑ¥½¹…±½¹™¥œ¹…ÕÑ½½Ý¹±½…‘¹…‰±•°(€€€€€•éÁÉ½áå}Ñ•µÁ±…Ñ”è¥¹ÍÑ¥ÑÕÑ¥½¹…±½¹™¥œ¹•éÁÉ½áåQ•µÁ±…Ñ”€ü€‰Í•Ðˆ€è€‰¹½Ñ}Í•Ðˆ°(€€€€€…ÑÑ•µÁÑ•è	½½±•…¸¡¥¹ÍÑ¥ÑÕÑ¥½¹…±ÑÑ•µÁÐ¤°(€€€€€±…ÍÑ}±½¥¹}…Ðè¥¹ÍÑ¥ÑÕÑ¥½¹…±½¹™¥œ¹±…ÍÑ1½¥¹Ðñð¹Õ±°(€€€ô€èì½¹™¥ÕÉ•è™…±Í”ô°(€€€µ…¹Õ…±}¥µÁ½ÉÐèì(€€€€€¡½Üè€‰%˜å½Ô¡…Ù”±•¥Ñ¥µ…Ñ”…•ÍÌ€¡¥¹ÍÑ¥ÑÕÑ¥½¹…°±½¥¸°ÁÕÉ¡…Í”½ÈÑ¡”…ÕÑ¡½ÈÌ½Áä¤°‘½Ý¹±½…Ñ¡”A¥¸å½ÕÈ½Ý¸‰É½ÝÍ•È°Á±…”¥ÐÕ¹‘•È€¹Á¤½‰É½ÝÍ•Èµ‘½Ý¹±½…‘Ì°Ñ¡•¸…±°É•Í•…É¡}…É¡¥Ù•}Í½ÕÉ”Ý¥Ñ ±½…±}™¥±”…¹¡Õµ…¹}Ù•É¥™¥•õÑÉÕ”¸=È½¹™¥ÕÉ”¥¹ÍÑ¥ÑÕÑ¥½¹…°…•ÍÌ¥¸M•ÑÑ¥¹ÌqÔÈÄäÈi½Ñ•É¼Á…¹•°qÔÈÄäÈ%¹ÍÑ¥ÑÕÑ¥½¹…°•ÍÌ…¹±½œ¥¸½¹”¸¼¹½ÐÕÍ”Á¥É…Ñ”µ¥ÉÉ½ÉÌ¸ˆ°(€€€€€Ñ…Í­}Ý…¥Ðèì­¥¹è€‰‘½Ý¹±½…ˆ°‘½¤è¥‘•¹Ñ¥Ñä¹‘½¤°Ñ¥Ñ±”èÉ•Í½±ÕÑ¥½¸¹Ñ¥Ñ±”ñð¹Õ±°ô°(€€€€€¥¹ÍÑ¥ÑÕÑ¥½¹…±}±½¥¸è¥¹ÍÑ¥ÑÕÑ¥½¹…±½¹™¥œü¹½¹™¥ÕÉ•€üì(€€€€€€€…Ñ¥½¸è€‰½Á•¹}±½¥¸ˆ°(€€€€€€€¡¥¹Ðè€‰%¹ÍÑ¥ÑÕÑ¥½¹…°Í•ÍÍ¥½¸µ…ä¡…Ù”•áÁ¥É•ì½Á•¸M•ÑÑ¥¹ÌqÔÈÄäÈi½Ñ•É¼qÔÈÄäÈ%¹ÍÑ¥ÑÕÑ¥½¹…°•ÍÌqÔÈÄäÈ1½¥¸ˆ(€€€€€ô€èì(€€€€€€€…Ñ¥½¸è€‰½¹™¥ÕÉ”ˆ°(€€€€€€€¡¥¹Ðè€‰M•ÐiÁÉ½áäÑ•µÁ±…Ñ”½È±½œ¥¸Ù¥„¥¹ÍÑ¥ÑÕÑ¥½¹…°‰É½ÝÍ•È¥¸M•ÑÑ¥¹Ìˆ(€€€€€ô(€€€ô(€ôì(€…Ý…¥ÐÉ•½É‘…¥±ÕÉ”¡Á½ÉÑÌ°µ…¹¥™•ÍÑA…Ñ °™…¥±ÕÉ•ÍA…Ñ °ÉÕ¹¥È°™…¥±ÕÉ”¤ì(€¥˜€¡¥¹ÍÑ¥ÑÕÑ¥½¹…±½¹™¥œü¹½¹™¥ÕÉ•€˜˜¥¹ÍÑ¥ÑÕÑ¥½¹…±ÑÑ•µÁÐ€˜˜¡…±±•¹•¤ì(€€€É•ÑÕÉ¸ì(€€€€€ÍÑ…ÑÕÌè€‰¥¹ÍÑ¥ÑÕÑ¥½¹…±}…ÕÑ¡}É•ÅÕ¥É•ˆ°(€€€€€€¸¸¹™…¥±ÕÉ”°(€€€€€µ…¹¥™•ÍÑ}Á…Ñ èµ…¹¥™•ÍÑA…Ñ °(€€€€€™…¥±ÕÉ•Í}Á…Ñ è™…¥±ÕÉ•ÍA…Ñ (€€€ôì(€ô(€É•ÑÕÉ¸ìÍÑ…ÑÕÌè€‰¹½}½Á•¹}…•ÍÌˆ°€¸¸¹™…¥±ÕÉ”°µ…¹¥™•ÍÑ}Á…Ñ èµ…¹¥™•ÍÑA…Ñ °™…¥±ÕÉ•Í}Á…Ñ è™…¥±ÕÉ•ÍA…Ñ ôì)ô)…Íå¹Œ™Õ¹Ñ¥½¸Í½ÕÉ•MÑ…ÑÕÌ¡½ÁÑ¥½¹Ì€ôíô°Á½ÉÑÌ¤ì(€¥˜€ …Á½ÉÑÌ¤Ñ¡É½Ü¹•ÜÉÉ½È ‰M½ÕÉ”…É¡¥Ù”¡½ÍÐÁ½ÉÑÌ…É”É•ÅÕ¥É•ˆ¤ì(€½¹ÍÐìÝ€ôÁÉ½•ÍÌ¹Ý ¤°ÉÕ¹}‘¥Èô€ô½ÁÑ¥½¹Ìì(€½¹ÍÐ½¹™¥œ€ô…Ý…¥ÐÁ½ÉÑÌ¹Ý½É­ÍÁ…”¡Ý¤ì(€½¹ÍÐÉÕ¹¥È€ôÉÕ¹}‘¥È€üÙ…±¥‘…Ñ•IÕ¹¥È¡½¹™¥œ¹É•ÍÕ±ÑÍI½½Ð°É•Í½±Ù”Ð¡Ý°ÉÕ¹}‘¥È¤¤€è¹Õ±°ì(€¥˜€ …ÉÕ¹¥È¤É•ÑÕÉ¸ìÉ•ÍÕ±ÑÍ}É½½Ðè½¹™¥œ¹É•ÍÕ±ÑÍI½½Ð°…Ñ•½É¥•ÌèM=UI}Q=I%L°ÉÕ¹}‘¥Èè¹Õ±°ôì(€½¹ÍÐµ…¹¥™•ÍÑA…Ñ €ô©½¥¸È¡ÉÕ¹¥È°€‰Í½ÕÉ•Ìˆ°€‰‘½Ý¹±½…µµ…¹¥™•ÍÐ¹©Í½¸ˆ¤ì(€½¹ÍÐ™…¥±ÕÉ•ÍA…Ñ €ô©½¥¸È¡ÉÕ¹¥È°€‰Í½ÕÉ•Ìˆ°€‰‘½Ý¹±½…µ™…¥±ÕÉ•Ì¹µˆ¤ì(€½¹ÍÐµ…¹¥™•ÍÐ€ô…Ý…¥ÐÉ•…‘5…¹¥™•ÍÐ¡µ…¹¥™•ÍÑA…Ñ °ÉÕ¹¥È¤ì(€±•Ð™…¥±ÕÉ•Ì€ô€ˆˆì(€ÑÉäì(€€€™…¥±ÕÉ•Ì€ô…Ý…¥ÐÉ•…‘¥±”Ì¡™…¥±ÕÉ•ÍA…Ñ °€‰ÕÑ˜àˆ¤ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€¥˜€¡•ÉÉ½È¹½‘”€„ôô€‰9=9Pˆ¤Ñ¡É½Ü•ÉÉ½Èì(€ô(€½¹ÍÐµ…¹¥™•ÍÑá¥ÍÑÌ€ô…Ý…¥Ð…•ÍÌ¡µ…¹¥™•ÍÑA…Ñ ¤¹Ñ¡•¸ (€€€€ ¤€ôøÑÉÕ”°(€€€€ ¤€ôø™…±Í”(€€¤ì(€½¹ÍÐ™…¥±ÕÉ•Íá¥ÍÑÌ€ô…Ý…¥Ð…•ÍÌ¡™…¥±ÕÉ•ÍA…Ñ ¤¹Ñ¡•¸ (€€€€ ¤€ôøÑÉÕ”°(€€€€ ¤€ôø™…±Í”(€€¤ì(€É•ÑÕÉ¸ì(€€€ÉÕ¹}‘¥ÈèÉÕ¹¥È°(€€€µ…¹¥™•ÍÑ}Á…Ñ èµ…¹¥™•ÍÑá¥ÍÑÌ€üµ…¹¥™•ÍÑA…Ñ €è¹Õ±°°(€€€™…¥±ÕÉ•Í}Á…Ñ è™…¥±ÕÉ•Íá¥ÍÑÌ€ü™…¥±ÕÉ•ÍA…Ñ €è¹Õ±°°(€€€µ…¹¥™•ÍÐ°(€€€™…¥±ÕÉ•}½Õ¹Ðèµ…¹¥™•ÍÐ¹™…¥±ÕÉ•Ìü¹±•¹Ñ €üü5…Ñ ¹µ…à À°€¡™…¥±ÕÉ•Ì¹µ…Ñ  ½xŒŒ€½´¤ñðmt¤¹±•¹Ñ ¤°(€€€€¸¸¹½ÁÑ¥½¹Ì¹Ù•É¥™ä€üìÙ•É¥™¥…Ñ¥½¸è…Ý…¥ÐÙ•É¥™å5…¹¥™•ÍÑ%Ñ•µÌ¡µ…¹¥™•ÍÐ°ÉÕ¹¥È¤ô€èíô(€ôì)ô((¼¼Á…­…•Ì½Ñ…Í­Ì½ÍÉŒ½ÉÕ¹Ñ¥µ”µ½µÁ¥±•½ÁÉ½•ÍÌµ•Ù•¹ÑÌ¹µ©Ì)™Õ¹Ñ¥½¸•µ¥ÑAÉ½•ÍÍÙ•¹Ð¡•Ù•¹Ð°€¸¸¹…ÉÌ¤ì(€ÁÉ½•ÍÌ¹•µ¥Ð¡•Ù•¹Ð°€¸¸¹…ÉÌ¤ì)ô((¼¼Á…­…•Ì½Ñ…Í­Ì½ÍÉŒ½ÉÕ¹Ñ¥µ”µ½µÁ¥±•½ÉÕ¹Ñ¥µ”µ‰É¥‘”¹µ©Ì)¥µÁ½ÉÐìÍå¹1½…±MÑ½É…”ô™É½´€‰¹½‘”é…Íå¹}¡½½­Ìˆì)Ù…È½¹Ñ•áÑÌ€ô¹•ÜÍå¹1½…±MÑ½É…” ¤ì)Ù…È¥¹ÍÑ…±±•‘IÕ¹Ñ¥µ”€ô¹Õ±°ì)Ù…ÈÍÑ…¹‘…±½¹•IÕ¹Ñ¥µ”€ô¹Õ±°ì)Ù…ÈÉÕ¹Ñ¥µ•	¥¹‘¥¹Ì€ô€¼¨}}AUI}|€¨¼¹•Ü]•…­M•Ð ¤ì)Ù…È¡½ÍÑIÕ¹Ñ¥µ•Ì€ô€¼¨}}AUI}|€¨¼¹•Ü]•…­5…À ¤ì)Ù…È-•å•‘M¡•‘Õ±•È€ô±…ÍÌì(€€Ñ…¥±Ì€ô€¼¨}}AUI}|€¨¼¹•Ü5…À ¤ì(€€‘¥ÍÁ½Í•€ô™…±Í”ì(€…Íå¹Œ…ÅÕ¥É”¡­•ä¤ì(€€€¥˜€¡Ñ¡¥Ì¸‘¥ÍÁ½Í•¤Ñ¡É½Ü¹•ÜÉÉ½È ‰IÕ¹Ñ¥µ”Í¡•‘Õ±•È¡…Ì‰••¸‘¥ÍÁ½Í•ˆ¤ì(€€€½¹ÍÐÁÉ•Ù¥½ÕÌ€ôÑ¡¥Ì¸Ñ…¥±Ì¹•Ð¡­•ä¤ñðAÉ½µ¥Í”¹É•Í½±Ù” ¤ì(€€€±•ÐÕ¹±½¬ì(€€€½¹ÍÐ…Ñ”€ô¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”ÄÔ¤€ôøì(€€€€€Õ¹±½¬€ôÉ•Í½±Ù”ÄÔì(€€€ô¤ì(€€€½¹ÍÐÑ…¥°€ôÁÉ•Ù¥½ÕÌ¹Ñ¡•¸  ¤€ôø…Ñ”¤ì(€€€Ñ¡¥Ì¸Ñ…¥±Ì¹Í•Ð¡­•ä°Ñ…¥°¤ì(€€€…Ý…¥ÐÁÉ•Ù¥½ÕÌì(€€€±•ÐÉ•±•…Í•€ô™…±Í”ì(€€€É•ÑÕÉ¸€ ¤€ôøì(€€€€€¥˜€¡É•±•…Í•¤É•ÑÕÉ¸ì(€€€€€É•±•…Í•€ôÑÉÕ”ì(€€€€€Õ¹±½¬ ¤ì(€€€€€¥˜€¡Ñ¡¥Ì¸Ñ…¥±Ì¹•Ð¡­•ä¤€ôôôÑ…¥°¤Ñ¡¥Ì¸Ñ…¥±Ì¹‘•±•Ñ”¡­•ä¤ì(€€€ôì(€ô(€…Íå¹ŒÉÕ¸¡­•ä°Ñ…Í¬È¤ì(€€€½¹ÍÐÉ•±•…Í”€ô…Ý…¥ÐÑ¡¥Ì¹…ÅÕ¥É”¡­•ä¤ì(€€€ÑÉäì(€€€€€É•ÑÕÉ¸…Ý…¥ÐÑ…Í¬È ¤ì(€€€ô™¥¹…±±äì(€€€€€É•±•…Í” ¤ì(€€€ô(€ô(€…Íå¹Œ‘¥ÍÁ½Í” ¤ì(€€€¥˜€¡Ñ¡¥Ì¸‘¥ÍÁ½Í•¤É•ÑÕÉ¸ì(€€€Ñ¡¥Ì¸‘¥ÍÁ½Í•€ôÑÉÕ”ì(€€€Ñ¡¥Ì¸Ñ…¥±Ì¹±•…È ¤ì(€ô)ôì)™Õ¹Ñ¥½¸É•…Ñ•MÑ…¹‘…±½¹•IÕ¹Ñ¥µ”¡±½œ€ôíô¤ì(€½¹ÍÐ‘¥ÍÁ½Í…‰±•Ì€ô€¼¨}}AUI}|€¨¼¹•ÜM•Ð ¤ì(€±•Ð‘¥ÍÁ½Í•€ô™…±Í”ì(€±•Ð‘¥ÍÁ½Í…°ì(€½¹ÍÐÉ•¥ÍÑ•É¥ÍÁ½Í…‰±”€ô€¡É•Í½ÕÉ”¤€ôøì(€€€¥˜€ …É•Í½ÕÉ”ñðÑåÁ•½˜É•Í½ÕÉ”¹‘¥ÍÁ½Í”€„ôô€‰™Õ¹Ñ¥½¸ˆ€˜˜ÑåÁ•½˜É•Í½ÕÉ”¹±½Í”€„ôô€‰™Õ¹Ñ¥½¸ˆ¤(€€€€€É•ÑÕÉ¸€ ¤€ôøì(€€€€€ôì(€€€¥˜€¡‘¥ÍÁ½Í•¤ì(€€€€€Ù½¥€¡É•Í½ÕÉ”¹‘¥ÍÁ½Í”ü¸ ¤€üüÉ•Í½ÕÉ”¹±½Í”ü¸ ¤¤ì(€€€€€É•ÑÕÉ¸€ ¤€ôøì(€€€€€ôì(€€€ô(€€€‘¥ÍÁ½Í…‰±•Ì¹…‘¡É•Í½ÕÉ”¤ì(€€€É•ÑÕÉ¸€ ¤€ôø‘¥ÍÁ½Í…‰±•Ì¹‘•±•Ñ”¡É•Í½ÕÉ”¤ì(€ôì(€½¹ÍÐÉÕ¹Ñ¥µ”€ôì(€€€­¹½Ý±•‘”èíô°(€€€Ñ…Í­Ìèíô°(€€€Ñ½½±ÌèìÑ½½±Ìè€¼¨}}AUI}|€¨¼¹•Ü5…À ¤°™…µ¥±¥•Ìè€¼¨}}AUI}|€¨¼¹•Ü5…À ¤ô°(€€€Í¡•‘Õ±•Èè¹•Ü-•å•‘M¡•‘Õ±•È ¤°(€€€±½œ°(€€€É•¥ÍÑ•É¥ÍÁ½Í…‰±”°(€€€‘¥ÍÁ½Í” ¤ì(€€€€€¥˜€¡‘¥ÍÁ½Í…°¤É•ÑÕÉ¸‘¥ÍÁ½Í…°ì(€€€€€‘¥ÍÁ½Í•€ôÑÉÕ”ì(€€€€€‘¥ÍÁ½Í…°€ô€¡…Íå¹Œ€ ¤€ôøì(€€€€€€€½¹ÍÐÉ•Í½ÕÉ•Ì€ôl¸¸¹‘¥ÍÁ½Í…‰±•Ítì(€€€€€€€‘¥ÍÁ½Í…‰±•Ì¹±•…È ¤ì(€€€€€€€…Ý…¥ÐAÉ½µ¥Í”¹…±±M•ÑÑ±• (€€€€€€€€€É•Í½ÕÉ•Ì¹µ…À ¡É•Í½ÕÉ”¤€ôøì(€€€€€€€€€€€ÑÉäì(€€€€€€€€€€€€€É•ÑÕÉ¸É•Í½ÕÉ”¹‘¥ÍÁ½Í”ü¸ ¤€üüÉ•Í½ÕÉ”¹±½Í”ü¸ ¤ì(€€€€€€€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€€€€€€€É•ÑÕÉ¸AÉ½µ¥Í”¹É•©•Ð¡•ÉÉ½È¤ì(€€€€€€€€€€€ô(€€€€€€€€€ô¤(€€€€€€€€¤ì(€€€€€€€…Ý…¥ÐÉÕ¹Ñ¥µ”¹Í¡•‘Õ±•È¹‘¥ÍÁ½Í” ¤ì(€€€€€ô¤ ¤ì(€€€€€É•ÑÕÉ¸‘¥ÍÁ½Í…°ì(€€€ô(€ôì(€É•ÑÕÉ¸ÉÕ¹Ñ¥µ”ì)ô)™Õ¹Ñ¥½¸Ý¥Ñ¡IÕ¹Ñ¥µ”¡ÉÕ¹Ñ¥µ”°½Á•É…Ñ¥½¸¤ì(€¥˜€ …ÉÕ¹Ñ¥µ”ñðÑåÁ•½˜ÉÕ¹Ñ¥µ”€„ôô€‰½‰©•Ðˆñð€…ÉÕ¹Ñ¥µ”¹Í¡•‘Õ±•È¤(€€€Ñ¡É½Ü¹•ÜQåÁ•ÉÉ½È ‰É½¹•IÕ¹Ñ¥µ”Ý¥Ñ „Í¡•‘Õ±•È¥ÌÉ•ÅÕ¥É•ˆ¤ì(€É•ÑÕÉ¸½¹Ñ•áÑÌ¹ÉÕ¸¡ÉÕ¹Ñ¥µ”°½Á•É…Ñ¥½¸¤ì)ô)™Õ¹Ñ¥½¸‰¥¹‘IÕ¹Ñ¥µ”¡Á¤¤ì(€¥˜€ …Á¤ñðÑåÁ•½˜Á¤€„ôô€‰½‰©•Ðˆ€˜˜ÑåÁ•½˜Á¤€„ôô€‰™Õ¹Ñ¥½¸ˆ¤É•ÑÕÉ¸€ ¤€ôøì(€ôì(€¥˜€¡ÉÕ¹Ñ¥µ•	¥¹‘¥¹Ì¹¡…Ì¡Á¤¤¤É•ÑÕÉ¸€ ¤€ôøì(€ôì(€ÉÕ¹Ñ¥µ•	¥¹‘¥¹Ì¹…‘¡Á¤¤ì(€½¹ÍÐ¥¹¡•É¥Ñ•€ôÕÉÉ•¹ÑIÕ¹Ñ¥µ” ¤ì(€½¹ÍÐ™…±±‰…¬€ôÉ•…Ñ•MÑ…¹‘…±½¹•IÕ¹Ñ¥µ” ¤ì(€…‘½ÁÑIÕ¹Ñ¥µ•MÑ…Ñ”¡¥¹¡•É¥Ñ•°™…±±‰…¬¤ì(€¡½ÍÑIÕ¹Ñ¥µ•Ì¹Í•Ð¡Á¤°™…±±‰…¬¤ì(€¥˜€ …Á¤¹•Ù•¹ÑÌü¹½¸ñð€…Á¤¹•Ù•¹ÑÌü¹•µ¥Ð¤ì(€€€É•ÑÕÉ¸€ ¤€ôøì(€€€€€¥˜€¡¡½ÍÑIÕ¹Ñ¥µ•Ì¹•Ð¡Á¤¤€„ôô™…±±‰…¬¤É•ÑÕÉ¸ì(€€€€€ÉÕ¹Ñ¥µ•	¥¹‘¥¹Ì¹‘•±•Ñ”¡Á¤¤ì(€€€€€¡½ÍÑIÕ¹Ñ¥µ•Ì¹‘•±•Ñ”¡Á¤¤ì(€€€€€Ù½¥™…±±‰…¬¹‘¥ÍÁ½Í” ¤ì(€€€ôì(€ô(€½¹ÍÐÉ••¥Ù”€ô€¡Á…å±½…¤€ôøì(€€€¥˜€¡Á…å±½…ü¹Ù•ÉÍ¥½¸€„ôôIU9Q%5}	I%}YIM%=8¤É•ÑÕÉ¸ì(€€€½¹ÍÐÉÕ¹Ñ¥µ”€ôÁ…å±½…ü¹ÉÕ¹Ñ¥µ”ì(€€€¥˜€ …ÉÕ¹Ñ¥µ”ñðÑåÁ•½˜ÉÕ¹Ñ¥µ”€„ôô€‰½‰©•Ðˆñð€…ÉÕ¹Ñ¥µ”¹Í¡•‘Õ±•È¤É•ÑÕÉ¸ì(€€€½¹ÍÐÁÉ•Ù¥½ÕÌ€ô¡½ÍÑIÕ¹Ñ¥µ•Ì¹•Ð¡Á¤¤ì(€€€¥˜€¡ÁÉ•Ù¥½ÕÌ€˜˜ÁÉ•Ù¥½ÕÌ€„ôôÉÕ¹Ñ¥µ”¤…‘½ÁÑIÕ¹Ñ¥µ•MÑ…Ñ”¡ÁÉ•Ù¥½ÕÌ°ÉÕ¹Ñ¥µ”¤ì(€€€¡½ÍÑIÕ¹Ñ¥µ•Ì¹Í•Ð¡Á¤°ÉÕ¹Ñ¥µ”¤ì(€€€¥˜€¡ÁÉ•Ù¥½ÕÌ€˜˜ÁÉ•Ù¥½ÕÌ€„ôôÉÕ¹Ñ¥µ”¤Ù½¥ÁÉ•Ù¥½ÕÌ¹‘¥ÍÁ½Í” ¤ì(€ôì(€Á¤¹•Ù•¹ÑÌ¹½¸ ‰‘É½¹”éÉÕ¹Ñ¥µ”½ØÄˆ°É••¥Ù”¤ì(€Ù½¥Á¤¹•Ù•¹ÑÌ¹•µ¥Ðü¸ ‰‘É½¹”éÉÕ¹Ñ¥µ”½É•ÅÕ•ÍÐ½ØÄˆ°ìÙ•ÉÍ¥½¸èIU9Q%5}	I%}YIM%=8ô¤ì(€É•ÑÕÉ¸€ ¤€ôøì(€€€ÉÕ¹Ñ¥µ•	¥¹‘¥¹Ì¹‘•±•Ñ”¡Á¤¤ì(€€€¥˜€¡¡½ÍÑIÕ¹Ñ¥µ•Ì¹•Ð¡Á¤¤€ôôô™…±±‰…¬¤ì(€€€€€¡½ÍÑIÕ¹Ñ¥µ•Ì¹‘•±•Ñ”¡Á¤¤ì(€€€€€Ù½¥™…±±‰…¬¹‘¥ÍÁ½Í” ¤ì(€€€ô•±Í”¡½ÍÑIÕ¹Ñ¥µ•Ì¹‘•±•Ñ”¡Á¤¤ì(€ôì)ô)™Õ¹Ñ¥½¸…‘½ÁÑIÕ¹Ñ¥µ•MÑ…Ñ”¡ÁÉ•Ù¥½ÕÌ°ÉÕ¹Ñ¥µ”¤ì(€½¹ÍÐÍ½ÕÉ•Q½½±Ì€ôÁÉ•Ù¥½ÕÌü¹Ñ½½±Ìü¹µ…¹¥™•ÍÐì(€¥˜€¡Í½ÕÉ•Q½½±Ì¤ì(€€€¥˜€ …ÉÕ¹Ñ¥µ”¹Ñ½½±Ì¤ÉÕ¹Ñ¥µ”¹Ñ½½±Ì€ôíôì(€€€½¹ÍÐÑ…É•ÑQ½½±Ì€ôÉÕ¹Ñ¥µ”¹Ñ½½±Ì¹µ…¹¥™•ÍÐ€üüìÑ½½±Ìè€¼¨}}AUI}|€¨¼¹•Ü5…À ¤°™…µ¥±¥•Ìè€¼¨}}AUI}|€¨¼¹•Ü5…À ¤ôì(€€€ÉÕ¹Ñ¥µ”¹Ñ½½±Ì¹µ…¹¥™•ÍÐ€ôÑ…É•ÑQ½½±Ìì(€€€¥˜€ …Ñ…É•ÑQ½½±Ì¹Ñ½½±Ì¤Ñ…É•ÑQ½½±Ì¹Ñ½½±Ì€ô€¼¨}}AUI}|€¨¼¹•Ü5…À ¤ì(€€€™½È€¡½¹ÍÐm¹…µ”°µ•Ñ…t½˜Í½ÕÉ•Q½½±Ì¹Ñ½½±Ìñðmt¤ì(€€€€€¥˜€ …Ñ…É•ÑQ½½±Ì¹Ñ½½±Ì¹¡…Ì¡¹…µ”¤¤Ñ…É•ÑQ½½±Ì¹Ñ½½±Ì¹Í•Ð¡¹…µ”°µ•Ñ„¤ì(€€€ô(€€€¥˜€ …Ñ…É•ÑQ½½±Ì¹™…µ¥±¥•Ì¤Ñ…É•ÑQ½½±Ì¹™…µ¥±¥•Ì€ô€¼¨}}AUI}|€¨¼¹•Ü5…À ¤ì(€€€™½È€¡½¹ÍÐm¹…µ”°µ•Ñ…t½˜Í½ÕÉ•Q½½±Ì¹™…µ¥±¥•Ìñðmt¤ì(€€€€€¥˜€ …Ñ…É•ÑQ½½±Ì¹™…µ¥±¥•Ì¹¡…Ì¡¹…µ”¤¤Ñ…É•ÑQ½½±Ì¹™…µ¥±¥•Ì¹Í•Ð¡¹…µ”°µ•Ñ„¤ì(€€€ô(€ô(€½¹ÍÐÍ½ÕÉ••ÁÑ…¹”€ôÁÉ•Ù¥½ÕÌü¹Ñ…Í­Ìü¹…•ÁÑ…¹”ì(€¥˜€¡Í½ÕÉ••ÁÑ…¹”¤ì(€€€¥˜€ …ÉÕ¹Ñ¥µ”¹Ñ…Í­Ì¤ÉÕ¹Ñ¥µ”¹Ñ…Í­Ì€ôíôì(€€€½¹ÍÐÑ…É•Ñ•ÁÑ…¹”€ôÉÕ¹Ñ¥µ”¹Ñ…Í­Ì¹…•ÁÑ…¹”€üüì(€€€€€Ù•É¥™¥•ÉÌè€¼¨}}AUI}|€¨¼¹•Ü5…À ¤°(€€€€€­¥¹‘Ìèmt°(€€€€€ÁÉ½Á•ÉÑ¥•Ìèíô(€€€ôì(€€€ÉÕ¹Ñ¥µ”¹Ñ…Í­Ì¹…•ÁÑ…¹”€ôÑ…É•Ñ•ÁÑ…¹”ì(€€€¥˜€ …Ñ…É•Ñ•ÁÑ…¹”¹Ù•É¥™¥•ÉÌ¤Ñ…É•Ñ•ÁÑ…¹”¹Ù•É¥™¥•ÉÌ€ô€¼¨}}AUI}|€¨¼¹•Ü5…À ¤ì(€€€™½È€¡½¹ÍÐm­¥¹°Ù•É¥™¥•Ét½˜Í½ÕÉ••ÁÑ…¹”¹Ù•É¥™¥•ÉÌñðmt¤ì(€€€€€¥˜€ …Ñ…É•Ñ•ÁÑ…¹”¹Ù•É¥™¥•ÉÌ¹¡…Ì¡­¥¹¤¤Ñ…É•Ñ•ÁÑ…¹”¹Ù•É¥™¥•ÉÌ¹Í•Ð¡­¥¹°Ù•É¥™¥•È¤ì(€€€ô(€€€¥˜€¡ÉÉ…ä¹¥ÍÉÉ…ä¡Í½ÕÉ••ÁÑ…¹”¹­¥¹‘Ì¤¤ì(€€€€€Ñ…É•Ñ•ÁÑ…¹”¹­¥¹‘Ì€üüômtì(€€€€€™½È€¡½¹ÍÐ­¥¹½˜Í½ÕÉ••ÁÑ…¹”¹­¥¹‘Ì¤(€€€€€€€¥˜€ …Ñ…É•Ñ•ÁÑ…¹”¹­¥¹‘Ì¹¥¹±Õ‘•Ì¡­¥¹¤¤Ñ…É•Ñ•ÁÑ…¹”¹­¥¹‘Ì¹ÁÕÍ ¡­¥¹¤ì(€€€ô(€€€Ñ…É•Ñ•ÁÑ…¹”¹ÁÉ½Á•ÉÑ¥•Ì€üüôíôì(€€€™½È€¡½¹ÍÐm­•ä°Ù…±Õ•t½˜=‰©•Ð¹•¹ÑÉ¥•Ì¡Í½ÕÉ••ÁÑ…¹”¹ÁÉ½Á•ÉÑ¥•Ìñðíô¤¤(€€€€€¥˜€ „¡­•ä¥¸Ñ…É•Ñ•ÁÑ…¹”¹ÁÉ½Á•ÉÑ¥•Ì¤¤Ñ…É•Ñ•ÁÑ…¹”¹ÁÉ½Á•ÉÑ¥•Ím­•åt€ôÙ…±Õ”ì(€ô(€™½È€¡½¹ÍÐ‘½µ…¥¸½˜l‰­¹½Ý±•‘”ˆ°€‰Ñ…Í­Ìˆ°€‰Ñ½½±Ì‰t¤ì(€€€½¹ÍÐÍ½ÕÉ”€ôÁÉ•Ù¥½ÕÌü¹m‘½µ…¥¹tì(€€€¥˜€ …Í½ÕÉ”ñðÑåÁ•½˜Í½ÕÉ”€„ôô€‰½‰©•Ðˆ¤½¹Ñ¥¹Õ”ì(€€€±•ÐÑ…É•Ð€ôÉÕ¹Ñ¥µ•m‘½µ…¥¹tì(€€€¥˜€ …Ñ…É•Ð¤ì(€€€€€Ñ…É•Ð€ôíôì(€€€€€ÉÕ¹Ñ¥µ•m‘½µ…¥¹t€ôÑ…É•Ðì(€€€ô(€€€™½È€¡½¹ÍÐ­•ä½˜I•™±•Ð¹½Ý¹-•åÌ¡Í½ÕÉ”¤¤¥˜€ „¡­•ä¥¸Ñ…É•Ð¤¤Ñ…É•Ñm­•åt€ôÍ½ÕÉ•m­•åtì(€ô)ô)™Õ¹Ñ¥½¸ÉÕ¹Ñ¥µ•½É!½ÍÐ¡Á¤¤ì(€É•ÑÕÉ¸¡½ÍÑIÕ¹Ñ¥µ•Ì¹•Ð¡Á¤¤ñðÕÉÉ•¹ÑIÕ¹Ñ¥µ” ¤ì)ô)™Õ¹Ñ¥½¸Ý¥Ñ¡!½ÍÑIÕ¹Ñ¥µ”¡Á¤°½Á•É…Ñ¥½¸¤ì(€É•ÑÕÉ¸Ý¥Ñ¡IÕ¹Ñ¥µ”¡ÉÕ¹Ñ¥µ•½É!½ÍÐ¡Á¤¤°½Á•É…Ñ¥½¸¤ì)ô)™Õ¹Ñ¥½¸ÕÉÉ•¹ÑIÕ¹Ñ¥µ” ¤ì(€¥˜€¡½¹Ñ•áÑÌ¹•ÑMÑ½É” ¤¤É•ÑÕÉ¸½¹Ñ•áÑÌ¹•ÑMÑ½É” ¤ì(€¥˜€¡¥¹ÍÑ…±±•‘IÕ¹Ñ¥µ”¤É•ÑÕÉ¸¥¹ÍÑ…±±•‘IÕ¹Ñ¥µ”ì(€¥˜€ …ÍÑ…¹‘…±½¹•IÕ¹Ñ¥µ”¤ÍÑ…¹‘…±½¹•IÕ¹Ñ¥µ”€ôÉ•…Ñ•MÑ…¹‘…±½¹•IÕ¹Ñ¥µ” ¤ì(€É•ÑÕÉ¸ÍÑ…¹‘…±½¹•IÕ¹Ñ¥µ”ì)ô)™Õ¹Ñ¥½¸¡…ÍIÕ¹Ñ¥µ•½¹Ñ•áÐ ¤ì(€É•ÑÕÉ¸	½½±•…¸¡½¹Ñ•áÑÌ¹•ÑMÑ½É” ¤ñð¥¹ÍÑ…±±•‘IÕ¹Ñ¥µ”¤ì)ô)™Õ¹Ñ¥½¸É•Í½±Ù•M±½Ð¡‘½µ…¥¸°Í±½Ð°É•…Ñ”¤ì(€½¹ÍÐÉÕ¹Ñ¥µ”€ôÕÉÉ•¹ÑIÕ¹Ñ¥µ” ¤ì(€±•ÐÉ½ÕÀ€ôÉÕ¹Ñ¥µ•m‘½µ…¥¹tì(€¥˜€ …É½ÕÀ¤ì(€€€É½ÕÀ€ôíôì(€€€ÉÕ¹Ñ¥µ•m‘½µ…¥¹t€ôÉ½ÕÀì(€ô(€¥˜€ …É½ÕÁmÍ±½Ñt¤ì(€€€É½ÕÁmÍ±½Ñt€ôÉ•…Ñ” ¤ì(€€€ÉÕ¹Ñ¥µ”¹É•¥ÍÑ•É¥ÍÁ½Í…‰±”ü¸¡É½ÕÁmÍ±½Ñt¤ì(€ô(€É•ÑÕÉ¸É½ÕÁmÍ±½Ñtì)ô)™Õ¹Ñ¥½¸ÉÕ¹Ñ¥µ•M±½Ð¡‘½µ…¥¸°Í±½Ð°É•…Ñ”¤ì(€¥˜€¡ÑåÁ•½˜É•…Ñ”€„ôô€‰™Õ¹Ñ¥½¸ˆ¤Ñ¡É½Ü¹•ÜQåÁ•ÉÉ½È ‰ÉÕ¹Ñ¥µ•M±½ÐÉ•ÅÕ¥É•Ì„™…Ñ½Éäˆ¤ì(€½¹ÍÐÁÉ½áä€ô¹•ÜAÉ½áä (€€€íô°(€€€ì(€€€€€•Ð¡}Ñ…É•Ð°ÁÉ½Á•ÉÑä¤ì(€€€€€€€½¹ÍÐÙ…±Õ”€ôÉ•Í½±Ù•M±½Ð¡‘½µ…¥¸°Í±½Ð°É•…Ñ”¥mÁÉ½Á•ÉÑåtì(€€€€€€€É•ÑÕÉ¸ÑåÁ•½˜Ù…±Õ”€ôôô€‰™Õ¹Ñ¥½¸ˆ€üÙ…±Õ”¹‰¥¹¡É•Í½±Ù•M±½Ð¡‘½µ…¥¸°Í±½Ð°É•…Ñ”¤¤€èÙ…±Õ”ì(€€€€€ô°(€€€€€Í•Ð¡}Ñ…É•Ð°ÁÉ½Á•ÉÑä°Ù…±Õ”¤ì(€€€€€€€É•Í½±Ù•M±½Ð¡‘½µ…¥¸°Í±½Ð°É•…Ñ”¥mÁÉ½Á•ÉÑåt€ôÙ…±Õ”ì(€€€€€€€É•ÑÕÉ¸ÑÉÕ”ì(€€€€€ô°(€€€€€½Ý¹-•åÌ ¤ì(€€€€€€€É•ÑÕÉ¸I•™±•Ð¹½Ý¹-•åÌ¡É•Í½±Ù•M±½Ð¡‘½µ…¥¸°Í±½Ð°É•…Ñ”¤¤ì(€€€€€ô°(€€€€€•Ñ=Ý¹AÉ½Á•ÉÑå•ÍÉ¥ÁÑ½È¡}Ñ…É•Ð°ÁÉ½Á•ÉÑä¤ì(€€€€€€€½¹ÍÐ‘•ÍÉ¥ÁÑ½È€ô=‰©•Ð¹•Ñ=Ý¹AÉ½Á•ÉÑå•ÍÉ¥ÁÑ½È¡É•Í½±Ù•M±½Ð¡‘½µ…¥¸°Í±½Ð°É•…Ñ”¤°ÁÉ½Á•ÉÑä¤ì(€€€€€€€É•ÑÕÉ¸‘•ÍÉ¥ÁÑ½È€üì€¸¸¹‘•ÍÉ¥ÁÑ½È°½¹™¥ÕÉ…‰±”èÑÉÕ”ô€èÙ½¥€Àì(€€€€€ô(€€€ô(€€¤ì(€É•ÑÕÉ¸€ (€€€€¼¨¨ÑåÁ”íQô€¨¼(€€€ÁÉ½áä(€€¤ì)ô)™Õ¹Ñ¥½¸ÉÕ¹IÕ¹Ñ¥µ•á±ÕÍ¥Ù”¡¹…µ•ÍÁ…”°­•ä°½Á•É…Ñ¥½¸¤ì(€É•ÑÕÉ¸ÕÉÉ•¹ÑIÕ¹Ñ¥µ” ¤¹Í¡•‘Õ±•È¹ÉÕ¸¡€‘í¹…µ•ÍÁ…•ôè‘í­•åõ€°½Á•É…Ñ¥½¸¤ì)ô)Ù…ÈIU9Q%5}	I%}YIM%=8€ô€Äì((¼¼Á…­…•Ì½Ñ…Í­Ì½ÍÉŒ½ÉÕ¹Ñ¥µ”µ½µÁ¥±•½Ñ½½°µµ…¹¥™•ÍÐ¹µ©Ì)Ù…ÈÉ•¥ÍÑÉä€ôÉÕ¹Ñ¥µ•M±½Ð ‰Ñ½½±Ìˆ°€‰µ…¹¥™•ÍÐˆ°€ ¤€ôø€¡ìÑ½½±Ìè€¼¨}}AUI}|€¨¼¹•Ü5…À ¤°™…µ¥±¥•Ìè€¼¨}}AUI}|€¨¼¹•Ü5…À ¤ô¤¤ì)Ù…È½µÁ…Ñ¥‰¥±¥ÑåQ½½±Ì€ô€¼¨}}AUI}|€¨¼¹•Ü5…À ¤ì)Ù…È½µÁ…Ñ¥‰¥±¥Ñå…µ¥±¥•Ì€ô€¼¨}}AUI}|€¨¼¹•Ü5…À ¤ì)Ù…ÈQ==1}59%MQ}Y9P€ô€‰‘É½¹”éÑ½½°µµ…¹¥™•ÍÐ½ØÄˆì)Ù…ÈQ==1}59%MQ}IEUMQ}Y9P€ô€‰‘É½¹”éÑ½½°µµ…¹¥™•ÍÐ½É•ÅÕ•ÍÐ½ØÄˆì)Ù…È•Ù•¹Ñ	É¥‘•Ì€ôÉÕ¹Ñ¥µ•M±½Ð ‰Ñ½½±Ìˆ°€‰µ…¹¥™•ÍÑÙ•¹Ñ	É¥‘•Ìˆ°€ ¤€ôø€¼¨}}AUI}|€¨¼¹•Ü]•…­M•Ð ¤¤ì)Ù…ÈMU	9Q}5=L€ô€¼¨}}AUI}|€¨¼¹•ÜM•Ð¡l‰•á±Õ‘”ˆ°€‰¥¹¡•É¥Ð‰t¤ì)™Õ¹Ñ¥½¸…ÍÍ•ÉÑ5•Ñ„¡¹…µ”°µ•Ñ„¤ì(€¥˜€ …µ•Ñ„ñðÑåÁ•½˜µ•Ñ„€„ôô€‰½‰©•Ðˆ¤Ñ¡É½Ü¹•ÜÉÉ½È¡Q½½°€‘í¹…µ•ôè‘É½¹”µ•Ñ…‘…Ñ„µÕÍÐ‰”…¸½‰©•Ñ€¤ì(€¥˜€¡µ•Ñ„¹ÍÕ‰…•¹Ð€„ôôÙ½¥€À€˜˜€…MU	9Q}5=L¹¡…Ì¡µ•Ñ„¹ÍÕ‰…•¹Ð¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È¡Q½½°€‘í¹…µ•ôè‘É½¹”¹ÍÕ‰…•¹ÐµÕÍÐ‰”€‰•á±Õ‘”ˆ½È€‰¥¹¡•É¥Ð‰€¤ì(€¥˜€¡µ•Ñ„¹…Á…‰¥±¥Ñ¥•Ì€„ôôÙ½¥€À€˜˜€…ÉÉ…ä¹¥ÍÉÉ…ä¡µ•Ñ„¹…Á…‰¥±¥Ñ¥•Ì¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È¡Q½½°€‘í¹…µ•ôè‘É½¹”¹…Á…‰¥±¥Ñ¥•ÌµÕÍÐ‰”…¸…ÉÉ…å€¤ì(€¥˜€¡µ•Ñ„¹…Ñ¥Ù¥Ñä€„ôôÙ½¥€À€˜˜€¡ÑåÁ•½˜µ•Ñ„¹…Ñ¥Ù¥Ñäü¹Ñ•áÐ€„ôô€‰ÍÑÉ¥¹œˆñðÑåÁ•½˜µ•Ñ„¹…Ñ¥Ù¥Ñäü¹Á¡…Í”€„ôô€‰ÍÑÉ¥¹œˆ¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È¡Q½½°€‘í¹…µ•ôè‘É½¹”¹…Ñ¥Ù¥Ñä¹••‘ÌÑ•áÐ…¹Á¡…Í•€¤ì(€¥˜€¡µ•Ñ„¹™±½Ý…É‘Ì€„ôôÙ½¥€À€˜˜ÑåÁ•½˜µ•Ñ„¹™±½Ý…É‘Ì€„ôô€‰™Õ¹Ñ¥½¸ˆ¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È¡Q½½°€‘í¹…µ•ôè‘É½¹”¹™±½Ý…É‘ÌµÕÍÐ‰”„™Õ¹Ñ¥½¹€¤ì(€™½È€¡½¹ÍÐ™…µ¥±ä½˜µ•Ñ„¹™…µ¥±¥•Ìñðmt¤(€€€¥˜€¡ÑåÁ•½˜™…µ¥±äü¹µ…Ñ €„ôô€‰ÍÑÉ¥¹œˆñð€…™…µ¥±ä¹µ…Ñ ¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È¡Q½½°€‘í¹…µ•ôè™…µ¥±ä¹µ…Ñ É•ÅÕ¥É•‘€¤ì)ô)™Õ¹Ñ¥½¸É•¥ÍÑÉ…Ñ¥½¸¡¹…µ”°µ•Ñ„¤ì(€É•ÑÕÉ¸ìÙ•ÉÍ¥½¸è€Ä°¹…µ”°µ•Ñ„ôì)ô)™Õ¹Ñ¥½¸É•Á±…åI•¥ÍÑÉ…Ñ¥½¹Ì¡Á¤¤ì(€¥˜€ …Á¤ü¹•Ù•¹ÑÌü¹•µ¥Ð¤É•ÑÕÉ¸ì(€Ý¥Ñ¡!½ÍÑIÕ¹Ñ¥µ”¡Á¤°€ ¤€ôøì(€€€™½È€¡½¹ÍÐm¹…µ”°µ•Ñ…t½˜É•¥ÍÑÉä¹Ñ½½±Ì¤ì(€€€€€Ù½¥Á¤¹•Ù•¹ÑÌ¹•µ¥Ð¡Q==1}59%MQ}Y9P°É•¥ÍÑÉ…Ñ¥½¸¡¹…µ”°µ•Ñ„¤¤ì(€€€ô(€ô¤ì)ô)™Õ¹Ñ¥½¸¥¹ÍÑ…±±Ù•¹Ñ	É¥‘”¡Á¤¤ì(€¥˜€ …Á¤ü¹•Ù•¹ÑÌü¹½¸ñð•Ù•¹Ñ	É¥‘•Ì¹¡…Ì¡Á¤¤¤É•ÑÕÉ¸ì(€•Ù•¹Ñ	É¥‘•Ì¹…‘¡Á¤¤ì(€Á¤¹•Ù•¹ÑÌ¹½¸¡Q==1}59%MQ}IEUMQ}Y9P°€¡Á…å±½…¤€ôøì(€€€¥˜€¡Á…å±½…ü¹Ù•ÉÍ¥½¸€ôôô€Ä¤É•Á±…åI•¥ÍÑÉ…Ñ¥½¹Ì¡Á¤¤ì(€ô¤ì)ô)™Õ¹Ñ¥½¸‰¥¹‘Q½½±IÕ¹Ñ¥µ”¡Á¤°‘•™¥¹¥Ñ¥½¸¤ì(€¥˜€¡ÑåÁ•½˜‘•™¥¹¥Ñ¥½¸ü¹•á•ÕÑ”€„ôô€‰™Õ¹Ñ¥½¸ˆ¤É•ÑÕÉ¸‘•™¥¹¥Ñ¥½¸ì(€½¹ÍÐ•á•ÕÑ”€ô‘•™¥¹¥Ñ¥½¸¹•á•ÕÑ”ì(€É•ÑÕÉ¸ì(€€€€¸¸¹‘•™¥¹¥Ñ¥½¸°(€€€•á•ÕÑ” ¸¸¹…ÉÌ¤ì(€€€€€É•ÑÕÉ¸Ý¥Ñ¡!½ÍÑIÕ¹Ñ¥µ”¡Á¤°€ ¤€ôø•á•ÕÑ”¹…ÁÁ±ä¡Ñ¡¥Ì°…ÉÌ¤¤ì(€€€ô(€ôì)ô)™Õ¹Ñ¥½¸ÁÕ‰±¥Í¡I•¥ÍÑÉ…Ñ¥½¸¡Á¤°¹…µ”°µ•Ñ„¤ì(€½¹ÍÐÁ…å±½…€ôÉ•¥ÍÑÉ…Ñ¥½¸¡¹…µ”°µ•Ñ„¤ì(€Ù½¥Á¤ü¹•Ù•¹ÑÌü¹•µ¥Ðü¸¡Q==1}59%MQ}Y9P°Á…å±½…¤ì(€•µ¥ÑAÉ½•ÍÍÙ•¹Ð¡Q==1}59%MQ}Y9P°Á…å±½…¤ì)ô)™Õ¹Ñ¥½¸‘•™¥¹•Q½½°¡‘•™¥¹¥Ñ¥½¸¤ì(€½¹ÍÐ¹…µ”€ô‘•™¥¹¥Ñ¥½¸ü¹¹…µ”ì(€¥˜€¡ÑåÁ•½˜¹…µ”€„ôô€‰ÍÑÉ¥¹œˆñð€…¹…µ”¤Ñ¡É½Ü¹•ÜÉÉ½È ‰‘•™¥¹•Q½½°è¹…µ”É•ÅÕ¥É•ˆ¤ì(€½¹ÍÐµ•Ñ„€ô‘•™¥¹¥Ñ¥½¸¹‘É½¹”ñðíôì(€…ÍÍ•ÉÑ5•Ñ„¡¹…µ”°µ•Ñ„¤ì(€É•¥ÍÑÉä¹Ñ½½±Ì¹Í•Ð¡¹…µ”°µ•Ñ„¤ì(€™½È€¡½¹ÍÐ™…µ¥±ä½˜µ•Ñ„¹™…µ¥±¥•Ìñðmt¤(€€€É•¥ÍÑÉä¹™…µ¥±¥•Ì¹Í•Ð¡™…µ¥±ä¹µ…Ñ ¹Ñ½1½Ý•É…Í” ¤°ì€¸¸¹™…µ¥±ä°½Ý¹•Èè¹…µ”ô¤ì(€¥˜€ …½µÁ…Ñ¥‰¥±¥ÑåQ½½±Ì¹¡…Ì¡¹…µ”¤¤½µÁ…Ñ¥‰¥±¥ÑåQ½½±Ì¹Í•Ð¡¹…µ”°µ•Ñ„¤ì(€™½È€¡½¹ÍÐ™…µ¥±ä½˜µ•Ñ„¹™…µ¥±¥•Ìñðmt¤ì(€€€½¹ÍÐ­•ä€ô™…µ¥±ä¹µ…Ñ ¹Ñ½1½Ý•É…Í” ¤ì(€€€¥˜€ …½µÁ…Ñ¥‰¥±¥Ñå…µ¥±¥•Ì¹¡…Ì¡­•ä¤¤½µÁ…Ñ¥‰¥±¥Ñå…µ¥±¥•Ì¹Í•Ð¡­•ä°ì€¸¸¹™…µ¥±ä°½Ý¹•Èè¹…µ”ô¤ì(€ô(€É•ÑÕÉ¸‘•™¥¹¥Ñ¥½¸ì)ô)™Õ¹Ñ¥½¸É•¥ÍÑ•ÉQ½½±Ì¡Á¤°‘•™¥¹¥Ñ¥½¹Ì¤ì(€‰¥¹‘IÕ¹Ñ¥µ”¡Á¤¤ì(€É•ÑÕÉ¸Ý¥Ñ¡!½ÍÑIÕ¹Ñ¥µ”¡Á¤°€ ¤€ôøì(€€€¥¹ÍÑ…±±Ù•¹Ñ	É¥‘”¡Á¤¤ì(€€€½¹ÍÐÉ•¥ÍÑ•É•€ômtì(€€€™½È€¡½¹ÍÐ‘•™¥¹¥Ñ¥½¸½˜‘•™¥¹¥Ñ¥½¹Ì¤ì(€€€€€½¹ÍÐ‘•™¥¹•€ô‘•™¥¹•Q½½°¡‘•™¥¹¥Ñ¥½¸¤ì(€€€€€ÁÕ‰±¥Í¡I•¥ÍÑÉ…Ñ¥½¸¡Á¤°‘•™¥¹•¹¹…µ”°‘•™¥¹•¹‘É½¹”ñðíô¤ì(€€€€€¥˜€¡ÁÉ½•ÍÌ¹•¹Ø¹A%}MU	9Q}!%1€˜˜‘•™¥¹•¹‘É½¹”ü¹ÍÕ‰…•¹Ð€ôôô€‰•á±Õ‘”ˆ¤½¹Ñ¥¹Õ”ì(€€€€€Á¤¹É•¥ÍÑ•ÉQ½½°¡‰¥¹‘Q½½±IÕ¹Ñ¥µ”¡Á¤°‘•™¥¹•¤¤ì(€€€€€É•¥ÍÑ•É•¹ÁÕÍ ¡‘•™¥¹•¹¹…µ”¤ì(€€€ô(€€€É•ÑÕÉ¸É•¥ÍÑ•É•ì(€ô¤ì)ô)™Õ¹Ñ¥½¸É•¥ÍÑ•ÉQ½½°¡Á¤°‘•™¥¹¥Ñ¥½¸¤ì(€É•ÑÕÉ¸É•¥ÍÑ•ÉQ½½±Ì¡Á¤°m‘•™¥¹¥Ñ¥½¹t¥lÁt€üü¹Õ±°ì)ô)™Õ¹Ñ¥½¸Ñ½½±5•Ñ„¡¹…µ”¤ì(€É•ÑÕÉ¸É•¥ÍÑÉä¹Ñ½½±Ì¹•Ð¡¹…µ”¤ñð€¡¡…ÍIÕ¹Ñ¥µ•½¹Ñ•áÐ ¤€ü¹Õ±°€è½µÁ…Ñ¥‰¥±¥ÑåQ½½±Ì¹•Ð¡¹…µ”¤¤ñð¹Õ±°ì)ô)™Õ¹Ñ¥½¸™±½Ý…É‘	Õ¥±‘•È¡¹…µ”¤ì(€½¹ÍÐ‰Õ¥±‘•È€ôÑ½½±5•Ñ„¡¹…µ”¤ü¹™±½Ý…É‘Ìì(€É•ÑÕÉ¸ÑåÁ•½˜‰Õ¥±‘•È€ôôô€‰™Õ¹Ñ¥½¸ˆ€ü‰Õ¥±‘•È€è¹Õ±°ì)ô((¼¼Á…­…•Ì½•áÑ•¹Í¥½¹Ì½ÍÉŒ½¥¹Ñ•É¹…°½É•Á±äµ™½ÕÌ¹ÑÌ)Ù…ÈUMI}EUMQ%=9}=UL€ô€‰¹ÍÝ•ÈÑ¡”ÕÍ•ÈÌÕÉÉ•¹ÐÅÕ•ÍÑ¥½¸¸UÍ”•Ù¥‘•¹”™½È™…ÑÕ…°É•Í•…É ±…¥µÌ°¹½ÐÕ¹É•±…Ñ•¥Ñ…Ñ¥½¹Ì™½È½É‘¥¹…Éä¡…Ð¸½ÈÍÕ‰ÍÑ…¹Ñ¥…°Ñ…Í­Ì°‘¼‰½Õ¹‘•É•…µ½¹±äÁÉ•Á…É…Ñ¥½¸…¹½¹Í½±¥‘…Ñ”Í½Á”°…ÍÍÕµÁÑ¥½¹Ì°¹••‘•Á•Éµ¥ÍÍ¥½¹Ì…¹‘•±¥Ù•É…‰±•Ì¥¹Ñ¼½¹”Ñ…Í­}Á±…¸™½È½¹”ÕÍ•È…ÕÑ¡½É¥é…Ñ¥½¸¸™Ñ•È…ÕÑ¡½É¥é…Ñ¥½¸°…ÉÉä½ÕÐÉ½ÕÑ¥¹”ÍÑ•ÁÌ…¹É•½Ù•É…‰±”¡•­ÌÝ¥Ñ¡¥¸Ñ¡…ÐÍ½Á”Ý¥Ñ¡½ÕÐÉ•Á•…Ñ•‘±ä…Í­¥¹œÝ¡•Ñ¡•ÈÑ¼½¹Ñ¥¹Õ”¸I•ÍÁ•ÐÁÉ¥½È‘•¥Í¥½¹Ì°•ÍÁ•¥…±±ä‘•±¥¹•¥¹ÍÑ…±±Ì¸9•ÜÉ¥Í­Ì½ÈÍ½Á”°µ¥ÍÍ¥¹œÉ•‘•¹Ñ¥…±Ì…¹•¹Õ¥¹•±äÕ¹…Ù…¥±…‰±”ÕÍ•È‘…Ñ„ÍÑ¥±°É•ÅÕ¥É”„ÍÁ•¥™¥ŒÉ•ÅÕ•ÍÐì¹•Ù•È¥¹™•È½¹Í•¹Ð¸Ð½µÁ±•Ñ¥½¸°•áÁ±…¥¸Ý¡…Ð¡…¹•°±¥¹¬…ÑÕ…°½ÕÑÁÕÑÌ½ÈÍ¡½Ü­•ä™¥ÕÉ•Ì°Í•Á…É…Ñ”•á•ÕÑ¥½¸™É½´Ù…±¥‘…Ñ¥½¸°…¹¥Ù”½¹”¹•áÐÍÑ•À½¹±ä¥˜¹••‘•¸-••À¥¹Ñ•É¹…°½Õ¹Ñ•ÉÌ…¹Ñ½½°±½Ì½ÕÐ½˜Ñ¡”µ…¥¸…¹ÍÝ•È¸ˆì((¼¼Á…­…•Ì½•áÑ•¹Í¥½¹Ì½ÍÉŒ½¥¹Ñ•É¹…°½É•Í•…É µ¡½ÍÐ¹ÑÌ)¥µÁ½ÉÐìÉ…¹‘½µUU%…ÌÉ…¹‘½µUU%ÄÀô™É½´€‰¹½‘”éÉåÁÑ¼ˆì)¥µÁ½ÉÐìÉ•…‘¥±”…ÌÉ•…‘¥±”ÄÈ°É•…±Á…Ñ …ÌÉ•…±Á…Ñ ä°É•¹…µ”…ÌÉ•¹…µ”ä°ÝÉ¥Ñ•¥±”…ÌÝÉ¥Ñ•¥±”ÄÀô™É½´€‰¹½‘”é™Ì½ÁÉ½µ¥Í•Ìˆì)¥µÁ½ÉÐì¥Í‰Í½±ÕÑ”…Ì¥Í‰Í½±ÕÑ”ÄÈ°©½¥¸…Ì©½¥¸ÄØ°É•±…Ñ¥Ù”…ÌÉ•±…Ñ¥Ù”ÄÄ°É•Í½±Ù”…ÌÉ•Í½±Ù”ÄÐ°Í•À…ÌÍ•ÀÄÀô™É½´€‰¹½‘”éÁ…Ñ ˆì((¼¼Á…­…•Ì½É•Í•…É ½ÍÉŒ½±¥Ñ•É…ÑÕÉ”µ½Á•É…Ñ¥½¹Ì¹ÑÌ)¥µÁ½ÉÐìÉ•…Ñ•!…Í …ÌÉ•…Ñ•!…Í Ø°É…¹‘½µUU%…ÌÉ…¹‘½µUU%Ìô™É½´€‰¹½‘”éÉåÁÑ¼ˆì)™Õ¹Ñ¥½¸‘•ÍÑ¥¹…Ñ¥½¹I•½Ù•Éä¡É••¥ÁÐ€ôíô¤ì(€½¹ÍÐé½Ñ•É¼€ôÉ••¥ÁÐ¹é½Ñ•É¼ü¹ÍÑ…ÑÕÌñð€‰Õ¹…Ù…¥±…‰±”ˆì(€½¹ÍÐ½‰Í¥‘¥…¸€ôÉ••¥ÁÐ¹½‰Í¥‘¥…¸ü¹ÍÑ…ÑÕÌñð€‰Õ¹…Ù…¥±…‰±”ˆì(€É•ÑÕÉ¸ì(€€€é½Ñ•É¼èì(€€€€€ÍÑ…ÑÕÌèé½Ñ•É¼°(€€€€€…Ñ¥½¸èé½Ñ•É¼€ôôô€‰Ù•É¥™¥•ˆ€ü€‰É•ÕÍ”µ•á¥ÍÑ¥¹œµ¥Ñ•´ˆ€èé½Ñ•É¼€ôôô€‰¥‘•¹Ñ¥Ñäµµ¥Íµ…Ñ ˆ€ü€‰É•Í½±Ù”µ¥‘•¹Ñ¥Ñäµ½¹™±¥Ðˆ€è€‰É•…µ‰…¬µ‰•™½É”µ…¹äµ¥µÁ½ÉÐˆ°(€€€€€…ÕÑ½]É¥Ñ”è™…±Í”(€€€ô°(€€€½‰Í¥‘¥…¸èì(€€€€€ÍÑ…ÑÕÌè½‰Í¥‘¥…¸°(€€€€€…Ñ¥½¸è½‰Í¥‘¥…¸€ôôô€‰Ù•É¥™¥•ˆ€ü€‰ÁÉ•Í•ÉÙ”µ•á¥ÍÑ¥¹œµ¹½Ñ”ˆ€è½‰Í¥‘¥…¸€ôôô€‰µ¥ÍÍ¥¹œˆ€ü€‰‘•Á½Í¥Ðµµ¥ÍÍ¥¹œµ¹½Ñ”µÝ¥Ñ µ…ÕÑ¡½É¥é…Ñ¥½¸ˆ€è½‰Í¥‘¥…¸€ôôô€‰¥‘•¹Ñ¥Ñäµµ¥Íµ…Ñ ˆ€ü€‰É•Ù¥•Üµ¹½Ñ”µ½¹™±¥ÐµÁÉ•Í•ÉÙ”µ¡Õµ…¸µ½¹Ñ•¹Ðˆ€è€‰Ý…¥Ðµ…¹µÉ•¡•¬µÙ…Õ±Ðˆ°(€€€€€…ÕÑ½]É¥Ñ”è™…±Í”(€€€ô°(€€€½µÁ±•Ñ•èé½Ñ•É¼€ôôô€‰Ù•É¥™¥•ˆ€˜˜½‰Í¥‘¥…¸€ôôô€‰Ù•É¥™¥•ˆ°(€€€Í¥•¹Ñ¥™¥…±±åY•É¥™¥•è™…±Í”(€ôì)ô)™Õ¹Ñ¥½¸±¥Ñ•É…ÑÕÉ•=Á•É…Ñ¥½¹%¡Ù…Õ±Ð°É•Ù¥Í¥½¸°‘½¤¤ì(€½¹ÍÐ¹½Éµ…±¥é•€ô¹½Éµ…±¥é•½¤¡‘½¤¤ì(€¥˜€ …¹½Éµ…±¥é•¤Ñ¡É½Ü¹•ÜÉÉ½È ‰Y…±¥=$É•ÅÕ¥É•ˆ¤ì(€É•ÑÕÉ¸É•…Ñ•!…Í Ø ‰Í¡„ÈÔØˆ¤¹ÕÁ‘…Ñ”¡)M=8¹ÍÑÉ¥¹¥™ä¡mÙ…Õ±Ð°É•Ù¥Í¥½¸°¹½Éµ…±¥é•‘t¤¤¹‘¥•ÍÐ ‰¡•àˆ¤ì)ô)™Õ¹Ñ¥½¸É•…Ñ•1¥Ñ•É…ÑÕÉ•=Á•É…Ñ¥½¹Ì¡Á½ÉÑÌ¤ì(€½¹ÍÐ¹½Ü€ôÁ½ÉÑÌ¹¹½Üñð€  ¤€ôø€ ¼¨}}AUI}|€¨¼¹•Ü…Ñ” ¤¤¹Ñ½%M=MÑÉ¥¹œ ¤¤ì(€½¹ÍÐÉ•…Ñ•%€ôÁ½ÉÑÌ¹É•…Ñ•%ñðÉ…¹‘½µUU%Ìì(€É•ÑÕÉ¸ì(€€€…Íå¹ŒÉ•½¹¥±•1¥Ñ•É…ÑÕÉ•=Á•É…Ñ¥½¸¡ìÝ€ôÁÉ½•ÍÌ¹Ý ¤°ÉÕ¹¥È°‘½¤°é½Ñ•É½-•ä°¹½Ñ•A…Ñ ô°ìÙ•É¥™ä€ôÁ½ÉÑÌ¹Ù•É¥™äô€ôíô¤ì(€€€€€½¹ÍÐ¹½Éµ…±¥é•€ô¹½Éµ…±¥é•½¤¡‘½¤¤ì(€€€€€¥˜€ …¹½Éµ…±¥é•¤Ñ¡É½Ü¹•ÜÉÉ½È ‰Y…±¥=$É•ÅÕ¥É•ˆ¤ì(€€€€€½¹ÍÐì™¥±”°Ù…Õ±Ð°É•Ù¥Í¥½¸ô€ô…Ý…¥ÐÁ½ÉÑÌ¹É•Í½±Ù•IÕ¹)½ÕÉ¹…°¡Ý°ÉÕ¹¥È¤ì(€€€€€¥˜€ …Ù…Õ±Ð¤Ñ¡É½Ü¹•ÜÉÉ½È ‰9¼‰½Õ¹Y…Õ±Ðˆ¤ì(€€€€€½¹ÍÐ¥€ô±¥Ñ•É…ÑÕÉ•=Á•É…Ñ¥½¹%¡Ù…Õ±Ð°É•Ù¥Í¥½¸°¹½Éµ…±¥é•¤ì(€€€€€É•ÑÕÉ¸Á½ÉÑÌ¹•á±ÕÍ¥Ù”¡™¥±”°…Íå¹Œ€ ¤€ôøì(€€€€€€€½¹ÍÐ©½ÕÉ¹…°€ô…Ý…¥ÐÁ½ÉÑÌ¹É•…‘)½ÕÉ¹…°¡™¥±”¤ì(€€€€€€€½¹ÍÐÁÉ•Ù¥½ÕÌ€ô©½ÕÉ¹…°¹½Á•É…Ñ¥½¹Ím¥‘tì(€€€€€€€¥˜€¡ÁÉ•Ù¥½ÕÌ€˜˜€¡ÁÉ•Ù¥½ÕÌ¹é½Ñ•É½-•ä€„ôôé½Ñ•É½-•äñðÁÉ•Ù¥½ÕÌ¹¹½Ñ•A…Ñ €„ôô¹½Ñ•A…Ñ ¤¤(€€€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È (€€€€€€€€€€€€‰=Á•É…Ñ¥½¸¥‘•¹Ñ¥Ñä¡…¹•ìÉ•Í½±Ù”Ñ¡”•á¥ÍÑ¥¹œ=$½­•ä½Á…Ñ µ…ÁÁ¥¹œ‰•™½É”É•ÑÉäˆ(€€€€€€€€€€¤ì(€€€€€€€½¹ÍÐÉ••¥ÁÐ€ô…Ý…¥ÐÙ•É¥™ä¡ì‘½¤è¹½Éµ…±¥é•°é½Ñ•É½}­•äèé½Ñ•É½-•ä°¹½Ñ•}Á…Ñ è¹½Ñ•A…Ñ °Ù…Õ±Ðô¤ì(€€€€€€€½¹ÍÐ‘•ÍÑ¥¹…Ñ¥½¹Ì€ô‘•ÍÑ¥¹…Ñ¥½¹I•½Ù•Éä¡É••¥ÁÐ¤ì(€€€€€€€½¹ÍÐ¡•­•‘Ð€ô¹½Ü ¤ì(€€€€€€€½¹ÍÐ½Á•É…Ñ¥½¸€ôì(€€€€€€€€€¥°(€€€€€€€€€‘½¤è¹½Éµ…±¥é•°(€€€€€€€€€é½Ñ•É½-•ä°(€€€€€€€€€¹½Ñ•A…Ñ °(€€€€€€€€€Ù…Õ±Ð°(€€€€€€€€€É•Ù¥Í¥½¸°(€€€€€€€€€ÍÑ…ÑÕÌè‘•ÍÑ¥¹…Ñ¥½¹Ì¹½µÁ±•Ñ•€ü€‰‰½Ñ µ¥‘•¹Ñ¥Ñ¥•ÌµÙ•É¥™¥•ˆ€è€‰Á…ÉÑ¥…°µ½ÈµÕ¹…Ù…¥±…‰±”ˆ°(€€€€€€€€€…ÑÑ•µÁÑÌè€¡ÁÉ•Ù¥½ÕÌü¹…ÑÑ•µÁÑÌñð€À¤€¬€Ä°(€€€€€€€€€É•…Ñ•‘ÐèÁÉ•Ù¥½ÕÌü¹É•…Ñ•‘Ðñð¡•­•‘Ð°(€€€€€€€€€¡•­•‘Ð°(€€€€€€€€€‘•ÍÑ¥¹…Ñ¥½¹Ì°(€€€€€€€€€É••¥ÁÐ°(€€€€€€€€€¡¥ÍÑ½Éäèl(€€€€€€€€€€€€¸¸¹ÁÉ•Ù¥½ÕÌü¹¡¥ÍÑ½Éäñðmt°(€€€€€€€€€€€ì…Ðè¡•­•‘Ð°é½Ñ•É¼èÉ••¥ÁÐ¹é½Ñ•É¼ü¹ÍÑ…ÑÕÌ°½‰Í¥‘¥…¸èÉ••¥ÁÐ¹½‰Í¥‘¥…¸ü¹ÍÑ…ÑÕÌô(€€€€€€€€€t¹Í±¥” ´ÌÈ¤(€€€€€€€ôì(€€€€€€€©½ÕÉ¹…°¹½Á•É…Ñ¥½¹Ím¥‘t€ô½Á•É…Ñ¥½¸ì(€€€€€€€…Ý…¥ÐÁ½ÉÑÌ¹ÝÉ¥Ñ•)½ÕÉ¹…°¡™¥±”°©½ÕÉ¹…°¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€½Á•É…Ñ¥½¹}¥è¥°(€€€€€€€€€±½}Á…Ñ è™¥±”°(€€€€€€€€€ÍÑ…ÑÕÌè½Á•É…Ñ¥½¸¹ÍÑ…ÑÕÌ°(€€€€€€€€€‘•ÍÑ¥¹…Ñ¥½¹Ì°(€€€€€€€€€É••¥ÁÐ°(€€€€€€€€€…ÑÑ•µÁÑÌè½Á•É…Ñ¥½¸¹…ÑÑ•µÁÑÌ°(€€€€€€€€€ÝÉ¥Ñ•ÍQ½1¥‰É…É¥•Ìè€À(€€€€€€€ôì(€€€€€ô¤ì(€€€ô°(€€€€¼¨¨ÁÁ•¹…¸½‰Í•ÉÙ•ÝÉ¥Ñ”É••¥ÁÐìÑ¡”©½ÕÉ¹…°¹•Ù•È…ÕÑ¡½É¥é•Ì½È‘É¥Ù•Ì„É•ÑÉä¸€¨¼(€€€…Íå¹ŒÉ•½É‘i½Ñ•É½]É¥Ñ”¡ì(€€€€€Ý€ôÁÉ½•ÍÌ¹Ý ¤°(€€€€€ÉÕ¹¥È°(€€€€€É••¥ÁÐ(€€€ô¤ì(€€€€€½¹ÍÐ‘½¤€ô¹½Éµ…±¥é•½¤¡É••¥ÁÐü¹‘½¤¤ì(€€€€€¥˜€ …‘½¤¤Ñ¡É½Ü¹•ÜÉÉ½È ‰Y…±¥=$É•ÅÕ¥É•ˆ¤ì(€€€€€½¹ÍÐì™¥±”ô€ô…Ý…¥ÐÁ½ÉÑÌ¹É•Í½±Ù•IÕ¹)½ÕÉ¹…°¡Ý°ÉÕ¹¥È¤ì(€€€€€É•ÑÕÉ¸Á½ÉÑÌ¹•á±ÕÍ¥Ù”¡™¥±”°…Íå¹Œ€ ¤€ôøì(€€€€€€€½¹ÍÐ©½ÕÉ¹…°€ô…Ý…¥ÐÁ½ÉÑÌ¹É•…‘)½ÕÉ¹…°¡™¥±”¤ì(€€€€€€€½¹ÍÐ•¹ÑÉä€ôì(€€€€€€€€€¥èÉ•…Ñ•% ¤°(€€€€€€€€€‘½¤°(€€€€€€€€€ÍÑ…ÑÕÌèMÑÉ¥¹œ¡É••¥ÁÐ¹ÍÑ…ÑÕÌñð€‰Õ¹­¹½Ý¸ˆ¤°(€€€€€€€€€É•…Í½¸èÉ••¥ÁÐ¹É•…Í½¸ñð¹Õ±°°(€€€€€€€€€¡…¹¹•°èÉ••¥ÁÐ¹¡…¹¹•°ñð¹Õ±°°(€€€€€€€€€é½Ñ•É½-•äèÉ••¥ÁÐ¹é½Ñ•É½-•äñð¹Õ±°°(€€€€€€€€€±¥‰É…ÉäèÉ••¥ÁÐ¹±¥‰É…Éäñð¹Õ±°°(€€€€€€€€€½±±•Ñ¥½¸èÉ••¥ÁÐ¹½±±•Ñ¥½¸ñð¹Õ±°°(€€€€€€€€€…ÑÑ…¡µ•¹ÐèÉ••¥ÁÐ¹…ÑÑ…¡µ•¹Ðñð¹Õ±°°(€€€€€€€€€™Õ±±Ñ•áÑMÑ…ÑÕÌèÉ••¥ÁÐ¹™Õ±±Ñ•áÑMÑ…ÑÕÌñð¹Õ±°°(€€€€€€€€€É•…‘	…¬èÉ••¥ÁÐ¹É•…‘	…¬ñð¹Õ±°°(€€€€€€€€€½¹Í•¹ÐèÉ••¥ÁÐ¹½¹Í•¹Ðñð¹Õ±°°(€€€€€€€€€ÝÉ¥Ñ•ÍQ½1¥‰É…É¥•ÌèÉ••¥ÁÐ¹ÝÉ¥Ñ•ÍQ½1¥‰É…É¥•Ìñð€À°(€€€€€€€€€…ÐèÉ••¥ÁÐ¹ÝÉ¥Ñ”ü¹…Ðñð¹½Ü ¤(€€€€€€€ôì(€€€€€€€©½ÕÉ¹…°¹ÝÉ¥Ñ•Ì€ôl¸¸¹ÉÉ…ä¹¥ÍÉÉ…ä¡©½ÕÉ¹…°¹ÝÉ¥Ñ•Ì¤€ü©½ÕÉ¹…°¹ÝÉ¥Ñ•Ì€èmt°•¹ÑÉåt¹Í±¥” ´ØÐ¤ì(€€€€€€€…Ý…¥ÐÁ½ÉÑÌ¹ÝÉ¥Ñ•)½ÕÉ¹…°¡™¥±”°©½ÕÉ¹…°¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€ÝÉ¥Ñ•}¥è•¹ÑÉä¹¥°(€€€€€€€€€±½}Á…Ñ è™¥±”°(€€€€€€€€€ÝÉ¥Ñ•Ìè©½ÕÉ¹…°¹ÝÉ¥Ñ•Ì¹±•¹Ñ °(€€€€€€€€€…ÕÑ½I•ÑÉäè™…±Í”(€€€€€€€ôì(€€€€€ô¤ì(€€€ô(€ôì)ô((¼¼Á…­…•Ì½É•Í•…É ½ÍÉŒ½É•Í•…É µ±½½À¹ÑÌ)¥µÁ½ÉÐìÉ•…Ñ•!…Í …ÌÉ•…Ñ•!…Í à°É…¹‘½µUU%…ÌÉ…¹‘½µUU%Ôô™É½´€‰¹½‘”éÉåÁÑ¼ˆì)¥µÁ½ÉÐì…•ÍÌ…Ì…•ÍÌÈ°µ­‘¥È…Ìµ­‘¥ÈÌ°É•…‘¥±”…ÌÉ•…‘¥±”Ø°É•…±Á…Ñ …ÌÉ•…±Á…Ñ Ô°É•¹…µ”…ÌÉ•¹…µ”Ð°ÝÉ¥Ñ•¥±”…ÌÝÉ¥Ñ•¥±”Ðô™É½´€‰¹½‘”é™Ì½ÁÉ½µ¥Í•Ìˆì)¥µÁ½ÉÐì‘¥É¹…µ”…Ì‘¥É¹…µ”È°¥Í‰Í½±ÕÑ”…Ì¥Í‰Í½±ÕÑ”Ø°©½¥¸…Ì©½¥¸Ô°É•±…Ñ¥Ù”…ÌÉ•±…Ñ¥Ù”Ô°É•Í½±Ù”…ÌÉ•Í½±Ù”Ü°Í•À…ÌÍ•ÀÔô™É½´€‰¹½‘”éÁ…Ñ ˆì((¼¼Á…­…•Ì½­¹½Ý±•‘”½ÍÉŒ½ÁÉ½©•Ðµ¥‘•¹Ñ¥Ñä¹ÑÌ)¥¹¥Ñ}½¹™¥œ ¤ì)¥µÁ½ÉÐìÉ•…‘¥±”…ÌÉ•…‘¥±”Ôô™É½´€‰¹½‘”é™Ì½ÁÉ½µ¥Í•Ìˆì)¥µÁ½ÉÐì¡½µ•‘¥Èô™É½´€‰¹½‘”é½Ìˆì)¥µÁ½ÉÐì©½¥¸…Ì©½¥¸Ð°É•Í½±Ù”…ÌÉ•Í½±Ù”Øô™É½´€‰¹½‘”éÁ…Ñ ˆì)Ù…ÈMMM%=9}AI=)Q}9QId€ô€‰‘É½¹”µÍ•ÍÍ¥½¸µÁÉ½©•ÐµØÄˆì)Ù…È1e}U1Q}AI=)P€ô€‰É•Í•…É µÝ½É­‰•¹ ˆì)Ù…ÈM1U€ô€½ym„µèÀ´åt¬ üèµm„µèÀ´åt¬¤¨¼ì)Ù…ÈIMIY€ô€½x üé½¹ñÁÉ¹ñ…Õáñ¹Õ±ñ½µlÄ´åuñ±ÁÑlÄ´åuñÍ¡…É•¤¼ì)™Õ¹Ñ¥½¸¥ÍAÉ½©•ÑM±Õœ¡Ù…±Õ”¤ì(€É•ÑÕÉ¸ÑåÁ•½˜Ù…±Õ”€ôôô€‰ÍÑÉ¥¹œˆ€˜˜Ù…±Õ”¹±•¹Ñ €ðô€äØ€˜˜M1U¹Ñ•ÍÐ¡Ù…±Õ”¤€˜˜€…IMIY¹Ñ•ÍÐ¡Ù…±Õ”¤ì)ô)™Õ¹Ñ¥½¸¹½Éµ…±¥é•AÉ½©•ÑM±Õœ¡¥¹ÁÕÐ¤ì(€¥˜€¡ÑåÁ•½˜¥¹ÁÕÐ€„ôô€‰ÍÑÉ¥¹œˆ¤É•ÑÕÉ¸¹Õ±°ì(€½¹ÍÐÍ±Õœ€ô¥¹ÁÕÐ¹¹½Éµ…±¥é” ‰9-ˆ¤¹Ñ½1½Ý•É…Í” ¤¹É•Á±…” ½my„µèÀ´åt¬½œ°€ˆ´ˆ¤¹É•Á±…” ½x´­ð´¬½œ°€ˆˆ¤¹Í±¥” À°€äØ¤¹É•Á±…” ¼´¬½œ°€ˆˆ¤ì(€É•ÑÕÉ¸¥ÍAÉ½©•ÑM±Õœ¡Í±Õœ¤€üÍ±Õœ€è¹Õ±°ì)ô)™Õ¹Ñ¥½¸Ý½É­ÍÁ…•AÉ½©•Ñ%¡Ý°½¹™¥ÕÉ•È¤ì(€É•ÑÕÉ¸ÁÉ½©•Ñ%‘•¹Ñ¥Ñä¡Ý°¥ÍAÉ½©•ÑM±Õœ¡½¹™¥ÕÉ•È¤€ü½¹™¥ÕÉ•È€èÙ½¥€À¤ì)ô)™Õ¹Ñ¥½¸‘…¥±å]½É­ÍÁ…•¥È¡¡½µ”€ô¡½µ•‘¥È ¤¤ì(€É•ÑÕÉ¸©½¥¸Ð¡¡½µ”°€ˆ¹‘É½¹”ˆ°€‰‘…¥±äˆ¤ì)ô)™Õ¹Ñ¥½¸Í…µ•A…Ñ ¡„°ˆ¤ì(€½¹ÍÐ±•™Ð€ôÉ•Í½±Ù”Ø¡„¤¹É•Á±…” ½mqp½t¬¼°€ˆˆ¤ì(€½¹ÍÐÉ¥¡Ð€ôÉ•Í½±Ù”Ø¡ˆ¤¹É•Á±…” ½mqp½t¬¼°€ˆˆ¤ì(€É•ÑÕÉ¸ÁÉ½•ÍÌ¹Á±…Ñ™½É´€ôôô€‰Ý¥¸ÌÈˆ€ü±•™Ð¹Ñ½1½Ý•É…Í” ¤€ôôôÉ¥¡Ð¹Ñ½1½Ý•É…Í” ¤€è±•™Ð€ôôôÉ¥¡Ðì)ô)™Õ¹Ñ¥½¸¥Í…¥±å]½É­ÍÁ…”¡Ý°¡½µ”¤ì(€É•ÑÕÉ¸Í…µ•A…Ñ ¡Ý°‘…¥±å]½É­ÍÁ…•¥È¡¡½µ”¤¤ì)ô)™Õ¹Ñ¥½¸Í•ÍÍ¥½¹AÉ½©•ÑÉ½µ¹ÑÉ¥•Ì¡•¹ÑÉ¥•Ì¤ì(€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡•¹ÑÉ¥•Ì¤¤É•ÑÕÉ¸¹Õ±°ì(€±•ÐÁÉ½©•Ð€ô¹Õ±°ì(€™½È€¡½¹ÍÐ•¹ÑÉä½˜•¹ÑÉ¥•Ì¤ì(€€€¥˜€ …•¹ÑÉäñðÑåÁ•½˜•¹ÑÉä€„ôô€‰½‰©•Ðˆñð•¹ÑÉä¹ÕÍÑ½µQåÁ”€„ôôMMM%=9}AI=)Q}9QId¤½¹Ñ¥¹Õ”ì(€€€¥˜€¡•¹ÑÉä¹ÑåÁ”€„ôôÙ½¥€À€˜˜•¹ÑÉä¹ÑåÁ”€„ôô€‰ÕÍÑ½´ˆ¤½¹Ñ¥¹Õ”ì(€€€½¹ÍÐÙ…±Õ”€ô•¹ÑÉä¹‘…Ñ„ü¹ÁÉ½©•Ðì(€€€¥˜€¡Ù…±Õ”€ôôô¹Õ±°¤ÁÉ½©•Ð€ô¹Õ±°ì(€€€•±Í”¥˜€¡¥ÍAÉ½©•ÑM±Õœ¡Ù…±Õ”¤¤ÁÉ½©•Ð€ôÙ…±Õ”ì(€ô(€É•ÑÕÉ¸ÁÉ½©•Ðì)ô)™Õ¹Ñ¥½¸É•Í½±Ù•AÉ½©•Ñ%‘•¹Ñ¥Ñä¡¥¹ÁÕÐ¤ì(€½¹ÍÐ‘…¥±ä€ô¥Í…¥±å]½É­ÍÁ…”¡¥¹ÁÕÐ¹Ý°¥¹ÁÕÐ¹¡½µ”¤ì(€½¹ÍÐÉ•ÅÕ•ÍÑ•‘Q•áÐ€ôÑåÁ•½˜¥¹ÁÕÐ¹É•ÅÕ•ÍÑ•€ôôô€‰ÍÑÉ¥¹œˆ€ü¥¹ÁÕÐ¹É•ÅÕ•ÍÑ•¹ÑÉ¥´ ¤€è€ˆˆì(€½¹ÍÐÉ•ÅÕ•ÍÑ•€ôÉ•ÅÕ•ÍÑ•‘Q•áÐñð¹Õ±°ì(€±•ÐÁÉ½©•Ðì(€±•ÐÍ½ÕÉ”ì(€½¹ÍÐÍ•ÍÍ¥½¸È€ô‘…¥±ä€üÍ•ÍÍ¥½¹AÉ½©•ÑÉ½µ¹ÑÉ¥•Ì¡¥¹ÁÕÐ¹Í•ÍÍ¥½¹¹ÑÉ¥•Ì¤€è¹Õ±°ì(€¥˜€¡Í•ÍÍ¥½¸È¤ì(€€€ÁÉ½©•Ð€ôÍ•ÍÍ¥½¸Èì(€€€Í½ÕÉ”€ô€‰Í•ÍÍ¥½¸ˆì(€ô•±Í”¥˜€¡¥ÍAÉ½©•ÑM±Õœ¡¥¹ÁÕÐ¹½¹™¥ÕÉ•¤¤ì(€€€ÁÉ½©•Ð€ô¥¹ÁÕÐ¹½¹™¥ÕÉ•ì(€€€Í½ÕÉ”€ô€‰Ý½É­ÍÁ…”µ½¹™¥œˆì(€ô•±Í”ì(€€€ÁÉ½©•Ð€ôÝ½É­ÍÁ…•AÉ½©•Ñ%¡¥¹ÁÕÐ¹Ý¤ì(€€€Í½ÕÉ”€ô€‰Ý½É­ÍÁ…”ˆì(€ô(€½¹ÍÐ¥¹½É•‘I•ÅÕ•ÍÐ€ôÉ•ÅÕ•ÍÑ•€„ôô¹Õ±°€˜˜¹½Éµ…±¥é•AÉ½©•ÑM±Õœ¡É•ÅÕ•ÍÑ•¤€„ôôÁÉ½©•Ðì(€É•ÑÕÉ¸ìÁÉ½©•Ð°Í½ÕÉ”°‘…¥±ä°É•ÅÕ•ÍÑ•°¥¹½É•‘I•ÅÕ•ÍÐôì)ô)…Íå¹Œ™Õ¹Ñ¥½¸É•…‘½¹™¥ÕÉ•‘AÉ½©•Ð¡Ý¤ì(€ÑÉäì(€€€½¹ÍÐÁ…ÉÍ•€ô)M=8¹Á…ÉÍ”¡…Ý…¥ÐÉ•…‘¥±”Ô¡©½¥¸Ð¡Ý°€ˆ¹Á¤ˆ°€‰É•Í•…É µÝ½É­ÍÁ…”¹©Í½¸ˆ¤°€‰ÕÑ˜àˆ¤¤ì(€€€¥˜€¡Á…ÉÍ•€˜˜ÑåÁ•½˜Á…ÉÍ•€ôôô€‰½‰©•Ðˆ€˜˜€‰­¹½Ý±•‘•AÉ½©•Ñ%ˆ¥¸Á…ÉÍ•¤(€€€€€É•ÑÕÉ¸Á…ÉÍ•¹­¹½Ý±•‘•AÉ½©•Ñ%ì(€ô…Ñ ì(€ô(€É•ÑÕÉ¸Ù½¥€Àì)ô)…Íå¹Œ™Õ¹Ñ¥½¸É•Í½±Ù•]½É­ÍÁ…•AÉ½©•Ð¡¥¹ÁÕÐ¤ì(€É•ÑÕÉ¸É•Í½±Ù•AÉ½©•Ñ%‘•¹Ñ¥Ñä¡ì€¸¸¹¥¹ÁÕÐ°½¹™¥ÕÉ•è…Ý…¥ÐÉ•…‘½¹™¥ÕÉ•‘AÉ½©•Ð¡¥¹ÁÕÐ¹Ý¤ô¤ì)ô)™Õ¹Ñ¥½¸ÉÕ¹AÉ½©•Ð¡µ•Ñ…‘…Ñ…AÉ½©•Ð°É•Í½±ÕÑ¥½¸¤ì(€¥˜€¡¥ÍAÉ½©•ÑM±Õœ¡µ•Ñ…‘…Ñ…AÉ½©•Ð¤€˜˜µ•Ñ…‘…Ñ…AÉ½©•Ð€„ôô1e}U1Q}AI=)P¤É•ÑÕÉ¸µ•Ñ…‘…Ñ…AÉ½©•Ðì(€É•ÑÕÉ¸É•Í½±ÕÑ¥½¸¹ÁÉ½©•Ðì)ô((¼¼Á…­…•Ì½É•Í•…É ½ÍÉŒ½±…¥´µ‰¥¹‘¥¹Ì¹ÑÌ)Ù…ÈI1Q%=9M!%AL€ôl‰‘¥É•Ðˆ°€‰¥¹‘¥É•Ðˆ°€‰¡åÁ½Ñ¡•Í¥Ìˆ°€‰Õ¹ÍÕÁÁ½ÉÑ•‰tì)™Õ¹Ñ¥½¸Ñ•áÐÈ¡Ù…±Õ”°±…‰•°È°µ…à€ô€Ñ”Ì¤ì(€¥˜€¡ÑåÁ•½˜Ù…±Õ”€„ôô€‰ÍÑÉ¥¹œˆñð€…Ù…±Õ”¹ÑÉ¥´ ¤ñðÙ…±Õ”¹±•¹Ñ €øµ…à¤Ñ¡É½Ü¹•ÜÉÉ½È¡%¹Ù…±¥€‘í±…‰•°Éõ€¤ì(€É•ÑÕÉ¸Ù…±Õ”¹ÑÉ¥´ ¤ì)ô)™Õ¹Ñ¥½¸Ù…±¥‘…Ñ•±…¥µ	¥¹‘¥¹Ì¡‰¥¹‘¥¹Ì°Í½ÕÉ•Ì°É•…‘Ì¤ì(€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡‰¥¹‘¥¹Ì¤ñð‰¥¹‘¥¹Ì¹±•¹Ñ €ð€Äñð‰¥¹‘¥¹Ì¹±•¹Ñ €ø€ØÐ¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰AÉ½Ù¥‘”€Ä´ØÐÍÑÉÕÑÕÉ•±…¥µ}‰¥¹‘¥¹Ìˆ¤ì(€½¹ÍÐÍ••¸€ô€¼¨}}AUI}|€¨¼¹•ÜM•Ð ¤ì(€É•ÑÕÉ¸‰¥¹‘¥¹Ì¹µ…À ¡É…Ü°¥¹‘•à¤€ôøì(€€€¥˜€ …É…ÜñðÑåÁ•½˜É…Ü€„ôô€‰½‰©•ÐˆñðÉÉ…ä¹¥ÍÉÉ…ä¡É…Ü¤¤Ñ¡É½Ü¹•ÜÉÉ½È ‰%¹Ù…±¥±…¥´‰¥¹‘¥¹œˆ¤ì(€€€½¹ÍÐ‰¥¹‘¥¹œ€ôÉ…Üì(€€€½¹ÍÐ±…¥´€ôÑ•áÐÈ¡‰¥¹‘¥¹œ¹±…¥´°€‰±…¥´ˆ¤ì(€€€½¹ÍÐ±¥µ¥Ñ…Ñ¥½¹Ì€ôÑ•áÐÈ¡‰¥¹‘¥¹œ¹±¥µ¥Ñ…Ñ¥½¹Ì°€‰±¥µ¥Ñ…Ñ¥½¹Ìˆ¤ì(€€€¥˜€¡Í••¸¹¡…Ì¡±…¥´¤¤Ñ¡É½Ü¹•ÜÉÉ½È ‰ÕÁ±¥…Ñ”±…¥´‰¥¹‘¥¹œˆ¤ì(€€€Í••¸¹…‘¡±…¥´¤ì(€€€½¹ÍÐÉ•±…Ñ¥½¹Í¡¥À€ô‰¥¹‘¥¹œ¹É•±…Ñ¥½¹Í¡¥Àì(€€€¥˜€ …I1Q%=9M!%AL¹¥¹±Õ‘•Ì¡É•±…Ñ¥½¹Í¡¥À¤¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰%¹Ù…±¥ÍÕÁÁ½ÉÐÉ•±…Ñ¥½¹Í¡¥Àˆ¤ì(€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡‰¥¹‘¥¹œ¹Í½ÕÉ•Ì¤ñð‰¥¹‘¥¹œ¹Í½ÕÉ•Ì¹±•¹Ñ €ø€ÄÈ¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰%¹Ù…±¥±…¥´Í½ÕÉ•Ìˆ¤ì(€€€¥˜€¡l‰‘¥É•Ðˆ°€‰¥¹‘¥É•Ð‰t¹¥¹±Õ‘•Ì¡MÑÉ¥¹œ¡É•±…Ñ¥½¹Í¡¥À¤¤€˜˜‰¥¹‘¥¹œ¹Í½ÕÉ•Ì¹±•¹Ñ €ôôô€À¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰MÕÁÁ½ÉÑ•±…¥µÌÉ•ÅÕ¥É”½‰Í•ÉÙ•Í½ÕÉ”•á•ÉÁÑÌˆ¤ì(€€€½¹ÍÐÉ•™Ì€ô‰¥¹‘¥¹œ¹Í½ÕÉ•Ì¹µ…À ¡É…ÝI•˜¤€ôøì(€€€€€¥˜€ …É…ÝI•˜ñðÑåÁ•½˜É…ÝI•˜€„ôô€‰½‰©•ÐˆñðÉÉ…ä¹¥ÍÉÉ…ä¡É…ÝI•˜¤¤(€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰%¹Ù…±¥±…¥´Í½ÕÉ”ˆ¤ì(€€€€€½¹ÍÐÉ•˜€ôÉ…ÝI•˜ì(€€€€€½¹ÍÐÁ…Ñ €ôÑåÁ•½˜É•˜¹Á…Ñ €ôôô€‰ÍÑÉ¥¹œˆ€üÉ•˜¹Á…Ñ €è€ˆˆì(€€€€€½¹ÍÐÍ½ÕÉ”€ôÍ½ÕÉ•Ì¹™¥¹ ¡…¹‘¥‘…Ñ”¤€ôø…¹‘¥‘…Ñ”¹Á…Ñ €ôôôÁ…Ñ ¤ì(€€€€€½¹ÍÐÉ•…€ôÉ•…‘Ì¹•Ð¡Á…Ñ ¤ì(€€€€€¥˜€ …Í½ÕÉ”ñð€…É•…ñðÉ•…¹¡…Í €„ôôÍ½ÕÉ”¹¡…Í ¤(€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰±…¥´Í½ÕÉ”Ý…Ì¹½ÐÉ•……¹¥‘•¹Ñ¥ÑäµÙ•É¥™¥•¥¸Ñ¡¥ÌÍ½Á”ˆ¤ì(€€€€€½¹ÍÐ™¥ÉÍÐ€ôÉ•˜¹ÍÑ…ÉÑ}±¥¹”ì(€€€€€½¹ÍÐ±…ÍÐ€ôÉ•˜¹•¹‘}±¥¹”ì(€€€€€¥˜€ …9Õµ‰•È¹¥Í%¹Ñ••È¡™¥ÉÍÐ¤ñð€…9Õµ‰•È¹¥Í%¹Ñ••È¡±…ÍÐ¤ñð™¥ÉÍÐ€ðÉ•…¹ÍÑ…ÉÑ1¥¹”ñð±…ÍÐ€ð™¥ÉÍÐñð±…ÍÐ€øÉ•…¹•¹‘1¥¹”¤(€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰±…¥´Í½ÕÉ”É…¹”¥Ì½ÕÑÍ¥‘”Ñ¡”½‰Í•ÉÙ•É•…ˆ¤ì(€€€€€½¹ÍÐÅÕ½Ñ”€ôÑ•áÐÈ¡É•˜¹ÅÕ½Ñ”°€‰Í½ÕÉ”ÅÕ½Ñ”ˆ°€Ù”Ì¤ì(€€€€€½¹ÍÐ•á•ÉÁÐ€ôÉ•…¹Ñ•áÐ¹ÍÁ±¥Ð ½qÈýq¸¼¤¹Í±¥”¡™¥ÉÍÐ€´É•…¹ÍÑ…ÉÑ1¥¹”°±…ÍÐ€´É•…¹ÍÑ…ÉÑ1¥¹”€¬€Ä¤¹©½¥¸ ‰q¸ˆ¤ì(€€€€€¥˜€ …•á•ÉÁÐ¹¥¹±Õ‘•Ì¡ÅÕ½Ñ”¤¤Ñ¡É½Ü¹•ÜÉÉ½È ‰±…¥´ÅÕ½Ñ”‘½•Ì¹½Ðµ…Ñ Ñ¡”½‰Í•ÉÙ•¹½Ñ”É…¹”ˆ¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€Á…Ñ èÍ½ÕÉ”¹Á…Ñ °(€€€€€€€‘½¤èÍ½ÕÉ”¹‘½¤°(€€€€€€€é½Ñ•É½}­•äèÍ½ÕÉ”¹é½Ñ•É½}­•ä°(€€€€€€€¡…Í èÍ½ÕÉ”¹¡…Í °(€€€€€€€ÍÑ…ÉÑ}±¥¹”è™¥ÉÍÐ°(€€€€€€€•¹‘}±¥¹”è±…ÍÐ°(€€€€€€€ÅÕ½Ñ”°(€€€€€€€€¸¸¹É•˜¹½É¥¥¹…±}±½…Ñ¥½¸€üì½É¥¥¹…±}±½…Ñ¥½¸èÑ•áÐÈ¡É•˜¹½É¥¥¹…±}±½…Ñ¥½¸°€‰¡¥ÍÑ½É¥…°½É¥¥¹…°±½…Ñ¥½¸ˆ°€ØÀÀ¤ô€èíô°(€€€€€€€É•…‘¥¹}‰…Í¥Ìè€‰ÕÉÉ•¹ÐµÍ½Á”µ±¥Ñ•É…ÑÕÉ”µ¹½Ñ”ˆ°(€€€€€€€½É¥¥¹…±Õ±±Ñ•áÑI•…‘Q¡¥ÍQÕÉ¸è™…±Í”(€€€€€ôì(€€€ô¤ì(€€€É•ÑÕÉ¸ì(€€€€€¥è±…¥´´‘í¥¹‘•à€¬€Åõ€°(€€€€€±…¥´°(€€€€€É•±…Ñ¥½¹Í¡¥À°(€€€€€±¥µ¥Ñ…Ñ¥½¹Ì°(€€€€€€¸¸¹‰¥¹‘¥¹œ¹½É…¹¥Í´€üì½É…¹¥Í´èÑ•áÐÈ¡‰¥¹‘¥¹œ¹½É…¹¥Í´°€‰½É…¹¥Í´ˆ°€ØÀÀ¤ô€èíô°(€€€€€€¸¸¹‰¥¹‘¥¹œ¹µ•Ñ¡½€üìµ•Ñ¡½èÑ•áÐÈ¡‰¥¹‘¥¹œ¹µ•Ñ¡½°€‰µ•Ñ¡½ˆ°€Å”Ì¤ô€èíô°(€€€€€Í½ÕÉ•ÌèÉ•™Ì°(€€€€€ÍÕÁÁ½ÉÑÍÍ•ÍÍµ•¹Ðè€‰µ½‘•°µ…ÍÍ•ÉÑ•µÕ¹É•Ù¥•Ý•ˆ°(€€€€€ÁÉ½Ù•¹…¹•¡•­•èÑÉÕ”°(€€€€€Í¥•¹Ñ¥™¥…±±åY•É¥™¥•è™…±Í”(€€€ôì(€ô¤ì)ô)™Õ¹Ñ¥½¸±…¥µ	¥¹‘¥¹I•™Ì¡‰¥¹‘¥¹Ì¤ì(€É•ÑÕÉ¸‰¥¹‘¥¹Ì¹µ…À (€€€€¡‰¥¹‘¥¹œ¤€ôø€‘í‰¥¹‘¥¹œ¹±…¥µôl‘í‰¥¹‘¥¹œ¹É•±…Ñ¥½¹Í¡¥Áõt€´ø€‘í‰¥¹‘¥¹œ¹Í½ÕÉ•Ì¹µ…À ¡Í½ÕÉ”¤€ôø€‘íÍ½ÕÉ”¹Á…Ñ¡ôè‘íÍ½ÕÉ”¹ÍÑ…ÉÑ}±¥¹•ô´‘íÍ½ÕÉ”¹•¹‘}±¥¹•õ€¤¹©½¥¸ ˆ°€ˆ¤ñð€‰¹¼ÍÕÁÁ½ÉÑ¥¹œÍ½ÕÉ”‰ôì±¥µ¥Ñ…Ñ¥½¸è€‘í‰¥¹‘¥¹œ¹±¥µ¥Ñ…Ñ¥½¹Íõ€(€€¤ì)ô)Ù…È1%5}	%9%9}M!5€ôì(€ÑåÁ”è€‰…ÉÉ…äˆ°(€µ¥¹%Ñ•µÌè€Ä°(€µ…á%Ñ•µÌè€ØÐ°(€¥Ñ•µÌèì(€€€ÑåÁ”è€‰½‰©•Ðˆ°(€€€ÁÉ½Á•ÉÑ¥•Ìèì(€€€€€±…¥´èìÑåÁ”è€‰ÍÑÉ¥¹œˆô°(€€€€€É•±…Ñ¥½¹Í¡¥ÀèìÑåÁ”è€‰ÍÑÉ¥¹œˆ°•¹Õ´èl¸¸¹I1Q%=9M!%AMtô°(€€€€€½É…¹¥Í´èìÑåÁ”è€‰ÍÑÉ¥¹œˆô°(€€€€€µ•Ñ¡½èìÑåÁ”è€‰ÍÑÉ¥¹œˆô°(€€€€€±¥µ¥Ñ…Ñ¥½¹ÌèìÑåÁ”è€‰ÍÑÉ¥¹œˆô°(€€€€€Í½ÕÉ•Ìèì(€€€€€€€ÑåÁ”è€‰…ÉÉ…äˆ°(€€€€€€€µ…á%Ñ•µÌè€ÄÈ°(€€€€€€€¥Ñ•µÌèì(€€€€€€€€€ÑåÁ”è€‰½‰©•Ðˆ°(€€€€€€€€€ÁÉ½Á•ÉÑ¥•Ìèì(€€€€€€€€€€€Á…Ñ èìÑåÁ”è€‰ÍÑÉ¥¹œˆô°(€€€€€€€€€€€ÍÑ…ÉÑ}±¥¹”èìÑåÁ”è€‰¥¹Ñ••Èˆ°µ¥¹¥µÕ´è€Äô°(€€€€€€€€€€€•¹‘}±¥¹”èìÑåÁ”è€‰¥¹Ñ••Èˆ°µ¥¹¥µÕ´è€Äô°(€€€€€€€€€€€ÅÕ½Ñ”èìÑåÁ”è€‰ÍÑÉ¥¹œˆô°(€€€€€€€€€€€½É¥¥¹…±}±½…Ñ¥½¸èìÑåÁ”è€‰ÍÑÉ¥¹œˆô(€€€€€€€€€ô°(€€€€€€€€€É•ÅÕ¥É•èl‰Á…Ñ ˆ°€‰ÍÑ…ÉÑ}±¥¹”ˆ°€‰•¹‘}±¥¹”ˆ°€‰ÅÕ½Ñ”‰t(€€€€€€€ô(€€€€€ô(€€€ô°(€€€É•ÅÕ¥É•èl‰±…¥´ˆ°€‰É•±…Ñ¥½¹Í¡¥Àˆ°€‰±¥µ¥Ñ…Ñ¥½¹Ìˆ°€‰Í½ÕÉ•Ì‰t(€ô)ôì((¼¼Á…­…•Ì½É•Í•…É ½ÍÉŒ½É•Í•…É µ±½½À¹ÑÌ)Ù…ÈIMI!}MQL€ô=‰©•Ð¹™É••é”¡l(€€‰É•…Ñ•ˆ°(€€‰±½…±}ÅÕ•Éå}É•½É‘•ˆ°(€€‰•áÑ•É¹…±}Í•…É¡}É•½É‘•ˆ°(€€‰Í½ÕÉ•Í}¥¹ÍÁ•Ñ•ˆ°(€€‰Í½ÕÉ•Í}…É¡¥Ù•ˆ°(€€‰Í½ÕÉ•Í}É•ÕÍ•ˆ°(€€‰±…¥µÍ}‰½Õ¹ˆ°(€€‰…¹ÍÝ•É…‰±”ˆ)t¤ì)Ù…ÈIMI!}=U59Q}-%9€ô€‰‘É½¹”¹É•Í•…É ¹ÉÕ¸ˆì)™Õ¹Ñ¥½¸É•…Ñ•I•Í•…É¡1½½À¡Á½ÉÑÌ¤ì(€½¹ÍÐ±½…‘]½É­ÍÁ…•½¹™¥œÌ€ôÁ½ÉÑÌ¹Ý½É­ÍÁ…”ì(€½¹ÍÐÙ•É¥™å1¥Ñ•É…ÑÕÉ•I••¥ÁÐÈ€ôÁ½ÉÑÌ¹Ù•É¥™å1¥Ñ•É…ÑÕÉ•I••¥ÁÐì(€½¹ÍÐÍ½ÕÉ•MÑ…ÑÕÌÈ€ôÁ½ÉÑÌ¹Í½ÕÉ•MÑ…ÑÕÌì(€½¹ÍÐÉÕ¹Ñ¥µ•MÑ…Ñ”Ì€ôì(€€€É••¥ÁÑ1•‘•Èè€¼¨}}AUI}|€¨¼¹•Ü5…À ¤°(€€€É••¥ÁÑEÕ•Õ•Ìè€¼¨}}AUI}|€¨¼¹•Ü5…À ¤°(€€€‘¥ÍÁ½Í” ¤ì(€€€€€Ñ¡¥Ì¹É••¥ÁÑ1•‘•È¹±•…È ¤ì(€€€€€Ñ¡¥Ì¹É••¥ÁÑEÕ•Õ•Ì¹±•…È ¤ì(€€€ô(€ôì(€½¹ÍÐÉÕ¹-•ä€ô€¡Ý°ÉÕ¹¥È¤€ôøÉ•Í½±Ù”Ü¡Ý°ÉÕ¹¥È¤ì(€™Õ¹Ñ¥½¸±•‘•È¡Ý°ÉÕ¹¥È¤ì(€€€½¹ÍÐ­•ä€ôÉÕ¹-•ä¡Ý°ÉÕ¹¥È¤ì(€€€¥˜€ …ÉÕ¹Ñ¥µ•MÑ…Ñ”Ì¹É••¥ÁÑ1•‘•È¹¡…Ì¡­•ä¤¤ì(€€€€€¥˜€¡ÉÕ¹Ñ¥µ•MÑ…Ñ”Ì¹É••¥ÁÑ1•‘•È¹Í¥é”€øô€ÄÈà¤(€€€€€€€ÉÕ¹Ñ¥µ•MÑ…Ñ”Ì¹É••¥ÁÑ1•‘•È¹‘•±•Ñ”¡ÉÕ¹Ñ¥µ•MÑ…Ñ”Ì¹É••¥ÁÑ1•‘•È¹­•åÌ ¤¹¹•áÐ ¤¹Ù…±Õ”¤ì(€€€€€ÉÕ¹Ñ¥µ•MÑ…Ñ”Ì¹É••¥ÁÑ1•‘•È¹Í•Ð¡­•ä°ìÉ•…‘Ìè€¼¨}}AUI}|€¨¼¹•Ü5…À ¤°Ù•É¥™¥•è€¼¨}}AUI}|€¨¼¹•Ü5…À ¤ô¤ì(€€€ô(€€€É•ÑÕÉ¸ÉÕ¹Ñ¥µ•MÑ…Ñ”Ì¹É••¥ÁÑ1•‘•È¹•Ð¡­•ä¤ì(€ô(€…Íå¹Œ™Õ¹Ñ¥½¸™±ÕÍ¡I•Í•…É¡I••¥ÁÑÌ¡ìÝ€ôÁÉ½•ÍÌ¹Ý ¤°ÉÕ¹¥Èô€ôíô¤ì(€€€…Ý…¥ÐÉÕ¹Ñ¥µ•MÑ…Ñ”Ì¹É••¥ÁÑEÕ•Õ•Ì¹•Ð¡ÉÕ¹-•ä¡Ý°ÉÕ¹¥È¤¤ì(€ô(€™Õ¹Ñ¥½¸É•Í•ÑI•Í•…É¡I••¥ÁÑÌ¡ìÝ€ôÁÉ½•ÍÌ¹Ý ¤°ÉÕ¹¥Èô€ôíô¤ì(€€€¥˜€¡ÉÕ¹¥È¤ÉÕ¹Ñ¥µ•MÑ…Ñ”Ì¹É••¥ÁÑ1•‘•È¹‘•±•Ñ”¡ÉÕ¹-•ä¡Ý°ÉÕ¹¥È¤¤ì(€ô(€…Íå¹Œ™Õ¹Ñ¥½¸É•ÕÍ…‰±•M½ÕÉ•Ì¡Ý°ÉÕ¹¥È¤ì(€€€½¹ÍÐ½¹™¥œ€ô…Ý…¥Ð±½…‘]½É­ÍÁ…•½¹™¥œÌ¡Ý¤ì(€€€¥˜€ …½¹™¥œ¹½‰Í¥‘¥…¹Y…Õ±Ð¤É•ÑÕÉ¸mtì(€€€½¹ÍÐÉ½½Ð€ô…Ý…¥ÐÉ•…±Á…Ñ Ô¡½¹™¥œ¹½‰Í¥‘¥…¹Y…Õ±Ð¤ì(€€€½¹ÍÐÍÑ…Ñ”Ì€ô±•‘•È¡Ý°ÉÕ¹¥È¤°É•ÍÕ±Ð€ômtì(€€€™½È€¡½¹ÍÐmÁ…Ñ °ÁÉ½½™t½˜ÍÑ…Ñ”Ì¹Ù•É¥™¥•¤ì(€€€€€½¹ÍÐÉ•…€ôÍÑ…Ñ”Ì¹É•…‘Ì¹•Ð¡Á…Ñ ¤ì(€€€€€¥˜€ …É•…ñðÉ•…¹¡…Í €„ôôÁÉ½½˜¹½‰Í¥‘¥…¸ü¹¡…Í ñðÉ•…¹Ù…Õ±Ð€„ôôÉ½½ÐñðÉ•…¹É•Ù¥Í¥½¸€„ôô€¡½¹™¥œ¹­¹½Ý±•‘•	¥¹‘¥¹I•Ù¥Í¥½¸ñð€À¤ñðÁÉ½½˜¹½‰Í¥‘¥…¸ü¹Ù…Õ±Ð€„ôôÉ½½Ð¤(€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€½¹ÍÐÕÉÉ•¹Ð€ô…Ý…¥ÐÙ•É¥™å1¥Ñ•É…ÑÕÉ•I••¥ÁÐÈ¡ì(€€€€€€€‘½¤èÁÉ½½˜¹‘½¤°(€€€€€€€é½Ñ•É½}­•äèÁÉ½½˜¹é½Ñ•É½-•ä°(€€€€€€€¹½Ñ•}Á…Ñ èÁ…Ñ °(€€€€€€€Ù…Õ±ÐèÉ½½Ð(€€€€€ô¤ì(€€€€€¥˜€¡ÕÉÉ•¹Ð¹ÍÑ…ÑÕÌ€„ôô€‰‰½Ñ µÙ•É¥™¥•ˆñðÕÉÉ•¹Ð¹½‰Í¥‘¥…¸¹¡…Í €„ôôÉ•…¹¡…Í ¤½¹Ñ¥¹Õ”ì(€€€€€É•ÍÕ±Ð¹ÁÕÍ ¡ì(€€€€€€€Á…Ñ °(€€€€€€€¡…Í èÉ•…¹¡…Í °(€€€€€€€‘½¤èÕÉÉ•¹Ð¹‘½¤°(€€€€€€€é½Ñ•É½}­•äèÕÉÉ•¹Ð¹é½Ñ•É½-•ä°(€€€€€€€ÍÑ…ÉÑ1¥¹”èÉ•…¹ÍÑ…ÉÑ1¥¹”°(€€€€€€€•¹‘1¥¹”èÉ•…¹•¹‘1¥¹”°(€€€€€€€‰…Í¥Ìè€‰ÕÉÉ•¹ÐµÑÕÉ¸µ±¥Ñ•É…ÑÕÉ”µ¹½Ñ”µÉ•…µ…¹µ¥‘•¹Ñ¥Ñäµ¡•¬ˆ°(€€€€€€€™Õ±±Ñ•áÑ}ÍÑ…ÑÕÌèÕÉÉ•¹Ð¹é½Ñ•É¼¹™Õ±±Ñ•áÑMÑ…ÑÕÌ°(€€€€€€€½É¥¥¹…±Õ±±Ñ•áÑI•…‘Q¡¥ÍQÕÉ¸è™…±Í”°(€€€€€€€•Ù¥‘•¹•}ÁÉ½™¥±”èì(€€€€€€€€€¥‘•¹Ñ¥Ñäè€‰‰½Ñ µÙ•É¥™¥•ˆ°(€€€€€€€€€…ÅÕ¥Í¥Ñ¥½¸èÕÉÉ•¹Ð¹é½Ñ•É¼¹™Õ±±Ñ•áÑMÑ…ÑÕÌ°(€€€€€€€€€É•…‘¥¹œèì(€€€€€€€€€€€­¥¹è€‰±¥Ñ•É…ÑÕÉ”µ¹½Ñ”ˆ°(€€€€€€€€€€€Í½Á”è€‰ÕÉÉ•¹ÐµÑÕÉ¸ˆ°(€€€€€€€€€€€ÍÑ…ÉÑ1¥¹”èÉ•…¹ÍÑ…ÉÑ1¥¹”°(€€€€€€€€€€€•¹‘1¥¹”èÉ•…¹•¹‘1¥¹”(€€€€€€€€€ô°(€€€€€€€€€±…¥µMÕÁÁ½ÉÐè€‰¹½Ðµ…ÍÍ•ÍÍ•ˆ(€€€€€€€ô(€€€€€ô¤ì(€€€ô(€€€É•ÑÕÉ¸É•ÍÕ±Ðì(€ô(€…Íå¹Œ™Õ¹Ñ¥½¸Ù…±¥‘…Ñ•I•ÕÍ”¡Ý°ÉÕ¹¥È°…Ñ”¤ì(€€€¥˜€ ……Ñ”¹É•ÕÍ•}½Õ¹Ð¤É•ÑÕÉ¸ì(€€€½¹ÍÐ™É•Í €ô…Ý…¥ÐÉ•ÕÍ…‰±•M½ÕÉ•Ì¡Ý°ÉÕ¹¥È¤ì(€€€¥˜€¡…Ñ”¹É•ÕÍ•‘}Í½ÕÉ•Ì¹±•¹Ñ €„ôô…Ñ”¹É•ÕÍ•}½Õ¹Ðñð…Ñ”¹É•ÕÍ•‘}Í½ÕÉ•Ì¹Í½µ” (€€€€€€¡½±¤€ôø€…™É•Í ¹Í½µ” (€€€€€€€€¡¹½Ü¤€ôø¹½Ü¹Á…Ñ €ôôô½±¹Á…Ñ €˜˜¹½Ü¹¡…Í €ôôô½±¹¡…Í €˜˜¹½Ü¹‘½¤€ôôô½±¹‘½¤€˜˜¹½Ü¹é½Ñ•É½}­•ä€ôôô½±¹é½Ñ•É½}­•ä(€€€€€€¤(€€€€¤¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È (€€€€€€€€‰I•ÕÍ•Í½ÕÉ”¡…¹•½ÈÕÉÉ•¹ÐµÑÕÉ¸É••¥ÁÐ¥Ìµ¥ÍÍ¥¹œìÉ”µÉ•……¹Ù•É¥™äÑ¡”•á¥ÍÑ¥¹œ¹½Ñ”°‘¼¹½ÐÉ”µ¥µÁ½ÉÐ¥Ðˆ(€€€€€€¤ì(€ô(€…Íå¹Œ™Õ¹Ñ¥½¸Ù…±¥‘…Ñ•MÑ½É•‘±…¥µ	¥¹‘¥¹Ì¡Ý°ÉÕ¹¥È°…Ñ”¤ì(€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡…Ñ”¹±…¥µ}‰¥¹‘¥¹Ì¤ñð…Ñ”¹±…¥µ}‰¥¹‘¥¹Ì¹±•¹Ñ €ôôô€À¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰MÑÉÕÑÕÉ•±…¥µ}‰¥¹‘¥¹Ì…É”É•ÅÕ¥É•‰•™½É”…¹ÍÝ•É…‰±”ˆ¤ì(€€€É•ÑÕÉ¸Ù…±¥‘…Ñ•±…¥µ	¥¹‘¥¹Ì (€€€€€…Ñ”¹±…¥µ}‰¥¹‘¥¹Ì°(€€€€€l¸¸¹…Ý…¥ÐÉ•ÕÍ…‰±•M½ÕÉ•Ì¡Ý°ÉÕ¹¥È¤°€¸¸¹…Ý…¥Ð…É¡¥Ù•‘M½ÕÉ•I•½É‘Ì¡Ý°ÉÕ¹¥È¥t°(€€€€€±•‘•È¡Ý°ÉÕ¹¥È¤¹É•…‘Ì(€€€€¤ì(€ô(€™Õ¹Ñ¥½¸Í…™•M±Õœ¡Ù…±Õ”°±…‰•°È¤ì(€€€½¹ÍÐÑ•áÐÌ€ôMÑÉ¥¹œ¡Ù…±Õ”€üü€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€¥˜€ „½ym„µèÀ´åt¬ üèµm„µèÀ´åt¬¤¨¼¹Ñ•ÍÐ¡Ñ•áÐÌ¤¤Ñ¡É½Ü¹•ÜÉÉ½È¡€‘í±…‰•°ÉôµÕÍÐ‰”±½Ý•É…Í”­•‰…ˆµ…Í•€¤ì(€€€É•ÑÕÉ¸Ñ•áÐÌì(€ô(€™Õ¹Ñ¥½¸Ñ½Á¥%‘É½µI•ÍÕ±ÑM±Õœ¡Ù…±Õ”¤ì(€€€½¹ÍÐÍ±Õœ€ôÍ…™•M±Õœ¡Ù…±Õ”ñð€‰É•Í•…É µÅÕ•ÍÑ¥½¸ˆ°€‰É•ÍÕ±Ñ}Í±Õœˆ¤ì(€€€½¹ÍÐÍÑ…‰±”€ôÍ±Õœ¹É•Á±…” ¼´ÈÁq‘ìÙô üéq‘ìÙô¤ü¼°€ˆˆ¤¹É•Á±…” ¼µÉÕ¸µq¬¼°€ˆˆ¤ì(€€€É•ÑÕÉ¸ÍÑ…‰±”ñðÍ±Õœì(€ô(€™Õ¹Ñ¥½¸Ý¥Ñ¡¥¸È¡É½½Ð°Ñ…É•Ð¤ì(€€€½¹ÍÐÉ•°€ôÉ•±…Ñ¥Ù”Ô¡É•Í½±Ù”Ü¡É½½Ð¤°É•Í½±Ù”Ü¡Ñ…É•Ð¤¤ì(€€€É•ÑÕÉ¸É•°€ôôô€ˆˆñð€…¥Í‰Í½±ÕÑ”Ø¡É•°¤€˜˜É•°€„ôô€ˆ¸¸ˆ€˜˜€…É•°¹ÍÑ…ÉÑÍ]¥Ñ ¡€¸¸‘íÍ•ÀÕõ€¤ì(€ô(€™Õ¹Ñ¥½¸™¥±•!…Í ¡‰åÑ•Ì¤ì(€€€É•ÑÕÉ¸É•…Ñ•!…Í à ‰Í¡„ÈÔØˆ¤¹ÕÁ‘…Ñ”¡‰åÑ•Ì¤¹‘¥•ÍÐ ‰¡•àˆ¤ì(€ô(€…Íå¹Œ™Õ¹Ñ¥½¸…É¡¥Ù•‘M½ÕÉ•I•½É‘Ì¡Ý°ÉÕ¹¥È¤ì(€€€½¹ÍÐ…É¡¥Ù”€ô…Ý…¥ÐÍ½ÕÉ•MÑ…ÑÕÌÈ¡ìÝ°ÉÕ¹}‘¥ÈèÉ•Í½±Ù”Ü¡Ý°ÉÕ¹¥È¤ô¤ì(€€€½¹ÍÐÉ•½É‘Ì€ômtì(€€€™½È€¡½¹ÍÐ¥Ñ•´½˜…É¡¥Ù”¹µ…¹¥™•ÍÐü¹¥Ñ•µÌñðmt¤ì(€€€€€¥˜€¡¥Ñ•´¹ÍÑ…ÑÕÌ€„ôô€‰‘½Ý¹±½…‘•ˆñð€…¥Ñ•´¹Á…Ñ ñð€…¥Ñ•´¹Í¡„ÈÔØ¤½¹Ñ¥¹Õ”ì(€€€€€½¹ÍÐ…‰Í½±ÕÑ”€ôÉ•Í½±Ù”Ü¡Ý°¥Ñ•´¹Á…Ñ ¤ì(€€€€€¥˜€ …Ý¥Ñ¡¥¸È¡©½¥¸Ô¡É•Í½±Ù”Ü¡Ý°ÉÕ¹¥È¤°€‰Í½ÕÉ•Ìˆ¤°…‰Í½±ÕÑ”¤¤½¹Ñ¥¹Õ”ì(€€€€€ÑÉäì(€€€€€€€¥˜€ …Ý¥Ñ¡¥¸È¡…Ý…¥ÐÉ•…±Á…Ñ Ô¡©½¥¸Ô¡É•Í½±Ù”Ü¡Ý°ÉÕ¹¥È¤°€‰Í½ÕÉ•Ìˆ¤¤°…Ý…¥ÐÉ•…±Á…Ñ Ô¡…‰Í½±ÕÑ”¤¤¤(€€€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€€€¥˜€¡™¥±•!…Í ¡…Ý…¥ÐÉ•…‘¥±”Ø¡…‰Í½±ÕÑ”¤¤€„ôô¥Ñ•´¹Í¡„ÈÔØ¤½¹Ñ¥¹Õ”ì(€€€€€ô…Ñ ì(€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€ô(€€€€€½¹ÍÐ…±¥…Í•Ì€ô€¼¨}}AUI}|€¨¼¹•ÜM•Ð¡l(€€€€€€€MÑÉ¥¹œ¡¥Ñ•´¹Á…Ñ ¤°(€€€€€€€…‰Í½±ÕÑ”°(€€€€€€€É•±…Ñ¥Ù”Ô¡Ý°…‰Í½±ÕÑ”¤°(€€€€€€€É•±…Ñ¥Ù”Ô¡É•Í½±Ù”Ü¡Ý°ÉÕ¹¥È¤°…‰Í½±ÕÑ”¤(€€€€€t¤ì(€€€€€™½È€¡½¹ÍÐÁ…Ñ ½˜…±¥…Í•Ì¤(€€€€€€€É•½É‘Ì¹ÁÕÍ ¡ì(€€€€€€€€€Á…Ñ °(€€€€€€€€€¡…Í èMÑÉ¥¹œ¡¥Ñ•´¹Í¡„ÈÔØ¤°(€€€€€€€€€‘½¤è¥Ñ•´¹µ•Ñ…‘…Ñ„ü¹‘½¤ñð¥Ñ•´¹‘½¤°(€€€€€€€€€é½Ñ•É½}­•äè¥Ñ•´¹µ•Ñ…‘…Ñ„ü¹é½Ñ•É½}­•äñð¥Ñ•´¹é½Ñ•É½}­•ä(€€€€€€€ô¤ì(€€€ô(€€€É•ÑÕÉ¸É•½É‘Ìì(€ô(€…Íå¹Œ™Õ¹Ñ¥½¸É•½É‘É¡¥Ù•‘I•…¡Ý°ÉÕ¹¥È°Á…Ñ °…ÉÌ°‘•Ñ…¥±Ì°½¹Ñ•¹Ð¤ì(€€€½¹ÍÐ…‰Í½±ÕÑ”€ôÉ•Í½±Ù”Ü¡Ý°Á…Ñ ¤ì(€€€½¹ÍÐÍ½ÕÉ•ÍI½½Ð€ô©½¥¸Ô¡É•Í½±Ù”Ü¡Ý°ÉÕ¹¥È¤°€‰Í½ÕÉ•Ìˆ¤ì(€€€¥˜€ …Ý¥Ñ¡¥¸È¡Í½ÕÉ•ÍI½½Ð°…‰Í½±ÕÑ”¤¤É•ÑÕÉ¸™…±Í”ì(€€€¥˜€ …Ý¥Ñ¡¥¸È¡…Ý…¥ÐÉ•…±Á…Ñ Ô¡Í½ÕÉ•ÍI½½Ð¤°…Ý…¥ÐÉ•…±Á…Ñ Ô¡…‰Í½±ÕÑ”¤¤¤É•ÑÕÉ¸™…±Í”ì(€€€¥˜€¡‘•Ñ…¥±Ì¹ÑÉÕ¹…Ñ¥½¸ü¹™¥ÉÍÑ1¥¹•á••‘Í1¥µ¥Ð¤É•ÑÕÉ¸™…±Í”ì(€€€½¹ÍÐÉ•ÑÕÉ¹•€ô‘•Ñ…¥±Ì¹ÑÉÕ¹…Ñ¥½¸ü¹½¹Ñ•¹Ð€üü½¹Ñ•¹Ðü¹™¥¹ ¡Á…ÉÐ¤€ôøÁ…ÉÐ¹ÑåÁ”€ôôô€‰Ñ•áÐˆ¤ü¹Ñ•áÐì(€€€¥˜€¡ÑåÁ•½˜É•ÑÕÉ¹•€„ôô€‰ÍÑÉ¥¹œˆñð€…É•ÑÕÉ¹•¹ÑÉ¥´ ¤¤É•ÑÕÉ¸™…±Í”ì(€€€½¹ÍÐ‰åÑ•Ì€ô…Ý…¥ÐÉ•…‘¥±”Ø¡…‰Í½±ÕÑ”¤ì(€€€½¹ÍÐÍ½ÕÉ•Q•áÐ€ô‰åÑ•Ì¹Ñ½MÑÉ¥¹œ ‰ÕÑ˜àˆ¤ì(€€€¥˜€¡Í½ÕÉ•Q•áÐ¹¥¹±Õ‘•Ì ‰pÀˆ¤ñðÍ½ÕÉ•Q•áÐ¹ÍÑ…ÉÑÍ]¥Ñ  ˆ•A´ˆ¤¤É•ÑÕÉ¸™…±Í”ì(€€€½¹ÍÐÍÑ…ÉÑ1¥¹”€ô9Õµ‰•È¹¥Í%¹Ñ••È¡…ÉÌ¹½™™Í•Ð¤€˜˜…ÉÌ¹½™™Í•Ð€ø€À€ü…ÉÌ¹½™™Í•Ð€è€Äì(€€€½¹ÍÐÍ•±•Ñ•€ôÍ½ÕÉ•Q•áÐ¹ÍÁ±¥Ð ‰q¸ˆ¤¹Í±¥”¡ÍÑ…ÉÑ1¥¹”€´€Ä°…ÉÌ¹±¥µ¥Ð€üÍÑ…ÉÑ1¥¹”€´€Ä€¬…ÉÌ¹±¥µ¥Ð€èÙ½¥€À¤ì(€€€½¹ÍÐÙ¥Í¥‰±”€ôÉ•ÑÕÉ¹•¹ÍÁ±¥Ð ‰q¸ˆ¤ì(€€€½¹ÍÐ±¥¹•Ì€ômtì(€€€™½È€¡±•Ð¥¹‘•à€ô€Àì¥¹‘•à€ð5…Ñ ¹µ¥¸¡Í•±•Ñ•¹±•¹Ñ °Ù¥Í¥‰±”¹±•¹Ñ °€É”Ì¤ì¥¹‘•à¬¬¤ì(€€€€€½¹ÍÐÍ¡½Ý¸€ôÙ¥Í¥‰±•m¥¹‘•át€üü€ˆˆì(€€€€€¥˜€¡Í•±•Ñ•‘m¥¹‘•át€„ôôÍ¡½Ý¸ñð±¥¹•Ì¹©½¥¸ ‰q¸ˆ¤¹±•¹Ñ €¬Í¡½Ý¸¹±•¹Ñ €ø€å”Ð¤‰É•…¬ì(€€€€€±¥¹•Ì¹ÁÕÍ ¡Í¡½Ý¸¤ì(€€€ô(€€€½¹ÍÐÑ•áÐÌ€ô±¥¹•Ì¹©½¥¸ ‰q¸ˆ¤ì(€€€¥˜€ …Ñ•áÐÌ¹ÑÉ¥´ ¤¤É•ÑÕÉ¸™…±Í”ì(€€€½¹ÍÐÉ•…€ôì¡…Í è™¥±•!…Í ¡‰åÑ•Ì¤°Ñ•áÐèÑ•áÐÌ°ÍÑ…ÉÑ1¥¹”°•¹‘1¥¹”èÍÑ…ÉÑ1¥¹”€¬±¥¹•Ì¹±•¹Ñ €´€Äôì(€€€½¹ÍÐ…±¥…Í•Ì€ô€¼¨}}AUI}|€¨¼¹•ÜM•Ð¡l(€€€€€MÑÉ¥¹œ¡Á…Ñ ¤°(€€€€€…‰Í½±ÕÑ”°(€€€€€É•±…Ñ¥Ù”Ô¡Ý°…‰Í½±ÕÑ”¤°(€€€€€É•±…Ñ¥Ù”Ô¡É•Í½±Ù”Ü¡Ý°ÉÕ¹¥È¤°…‰Í½±ÕÑ”¤(€€€t¤ì(€€€™½È€¡½¹ÍÐ…±¥…Ì½˜…±¥…Í•Ì¤±•‘•È¡Ý°ÉÕ¹¥È¤¹É•…‘Ì¹Í•Ð¡…±¥…Ì°É•…¤ì(€€€É•ÑÕÉ¸ÑÉÕ”ì(€ô(€…Íå¹Œ™Õ¹Ñ¥½¸É•…‘)Í½¸Ì¡Á…Ñ ¤ì(€€€½¹ÍÐÙ…±Õ”€ô)M=8¹Á…ÉÍ”¡…Ý…¥ÐÉ•…‘¥±”Ø¡Á…Ñ °€‰ÕÑ˜àˆ¤¤ì(€€€¥˜€ …Ù…±Õ”ñðÑåÁ•½˜Ù…±Õ”€„ôô€‰½‰©•ÐˆñðÉÉ…ä¹¥ÍÉÉ…ä¡Ù…±Õ”¤¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È¡%¹Ù…±¥)M=8½‰©•Ðè€‘íÁ…Ñ¡õ€¤ì(€€€¥˜€¡Á…Ñ ¹•¹‘Í]¥Ñ  ‰µ•Ñ…‘…Ñ„¹©Í½¸ˆ¤€˜˜€…Ù…±Õ”¹­¥¹¤ì(€€€€€É•ÑÕÉ¸ì€¸¸¹Ù…±Õ”°­¥¹èIMI!}=U59Q}-%9°Ù•ÉÍ¥½¸è€Äôì(€€€ô(€€€¥˜€¡Á…Ñ ¹•¹‘Í]¥Ñ  ‰µ•Ñ…‘…Ñ„¹©Í½¸ˆ¤€˜˜€¡Ù…±Õ”¹­¥¹€„ôôIMI!}=U59Q}-%9ñðÙ…±Õ”¹Ù•ÉÍ¥½¸€„ôô€Ä¤¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È¡U¹ÍÕÁÁ½ÉÑ•É•Í•…É µ•Ñ…‘…Ñ„‘½Õµ•¹Ðè€‘íÁ…Ñ¡õ€¤ì(€€€É•ÑÕÉ¸Ù…±Õ”ì(€ô(€…Íå¹Œ™Õ¹Ñ¥½¸…Ñ½µ¥)Í½¸È¡Á…Ñ °Ù…±Õ”¤ì(€€€…Ý…¥Ðµ­‘¥ÈÌ¡‘¥É¹…µ”È¡Á…Ñ ¤°ìÉ•ÕÉÍ¥Ù”èÑÉÕ”ô¤ì(€€€½¹ÍÐÑ•µÀ€ô€‘íÁ…Ñ¡ô¸‘íÉ…¹‘½µUU%Ô ¥ô¹ÑµÁ€ì(€€€…Ý…¥ÐÝÉ¥Ñ•¥±”Ð¡Ñ•µÀ°€‘í)M=8¹ÍÑÉ¥¹¥™ä¡Ù…±Õ”°¹Õ±°°€È¥ô)€°€‰ÕÑ˜àˆ¤ì(€€€…Ý…¥ÐÉ•¹…µ”Ð¡Ñ•µÀ°Á…Ñ ¤ì(€ô(€™Õ¹Ñ¥½¸…Ñ•=˜¡µ•Ñ…‘…Ñ„¤ì(€€€½¹ÍÐ…Ñ”€ôµ•Ñ…‘…Ñ„¹•Ù¥‘•¹•}…Ñ”€˜˜ÑåÁ•½˜µ•Ñ…‘…Ñ„¹•Ù¥‘•¹•}…Ñ”€ôôô€‰½‰©•Ðˆ€üµ•Ñ…‘…Ñ„¹•Ù¥‘•¹•}…Ñ”€èíôì(€€€É•ÑÕÉ¸ì(€€€€€ÍÑ…”èIMI!}MQL¹¥¹±Õ‘•Ì¡…Ñ”¹ÍÑ…”¤€ü…Ñ”¹ÍÑ…”€è€‰É•…Ñ•ˆ°(€€€€€ÍÑ…ÑÕÌè…Ñ”¹ÍÑ…ÑÕÌ€ôôô€‰™…¥±•ˆ€ü€‰™…¥±•ˆ€è€‰½¬ˆ°(€€€€€…¹ÍÝ•É…‰±”è…Ñ”¹…¹ÍÝ•É…‰±”€ôôôÑÉÕ”°(€€€€€•Ù•¹ÑÌèÉÉ…ä¹¥ÍÉÉ…ä¡…Ñ”¹•Ù•¹ÑÌ¤€ü…Ñ”¹•Ù•¹ÑÌ€èmt°(€€€€€±…¥µ}É•™ÌèÉÉ…ä¹¥ÍÉÉ…ä¡…Ñ”¹±…¥µ}É•™Ì¤€ü…Ñ”¹±…¥µ}É•™Ì€èmt°(€€€€€±…¥µ}‰¥¹‘¥¹ÌèÉÉ…ä¹¥ÍÉÉ…ä¡…Ñ”¹±…¥µ}‰¥¹‘¥¹Ì¤€ü…Ñ”¹±…¥µ}‰¥¹‘¥¹Ì€èmt°(€€€€€Ý…É¹¥¹Ìè…Ñ”¹±…¥µ}É•™Ìü¹±•¹Ñ €˜˜€……Ñ”¹±…¥µ}‰¥¹‘¥¹Ìü¹±•¹Ñ €ül‰±•…äµÕ¹ÍÑÉÕÑÕÉ•µ±…¥µÌèÍÕÁÁ½ÉÐ¹½Ð…ÍÍ•ÍÍ•‰t€èmt°(€€€€€Í½ÕÉ•}É•™ÌèÉÉ…ä¹¥ÍÉÉ…ä¡…Ñ”¹Í½ÕÉ•}É•™Ì¤€ü…Ñ”¹Í½ÕÉ•}É•™Ì€èmt°(€€€€€…É¡¥Ù•}½Õ¹Ðè9Õµ‰•È¡…Ñ”¹…É¡¥Ù•}½Õ¹Ð¤ñð€À°(€€€€€É•ÕÍ•}½Õ¹Ðè9Õµ‰•È¡…Ñ”¹É•ÕÍ•}½Õ¹Ð¤ñð€À°(€€€€€É•ÕÍ•‘}Í½ÕÉ•ÌèÉÉ…ä¹¥ÍÉÉ…ä¡…Ñ”¹É•ÕÍ•‘}Í½ÕÉ•Ì¤€ü…Ñ”¹É•ÕÍ•‘}Í½ÕÉ•Ì€èmt°(€€€€€Í¥•¹Ñ¥™¥…±±åY•É¥™¥•è™…±Í”(€€€ôì(€ô(€™Õ¹Ñ¥½¸É•Í•…É¡9½‘•Ì¡…Ñ”¤ì(€€€½¹ÍÐÕÉÉ•¹Ð€ôIMI!}MQL¹¥¹‘•á=˜¡…Ñ”¹ÍÑ…”¤ì(€€€É•ÑÕÉ¸IMI!}MQL¹µ…À ¡¥°¥¹‘•à¤€ôø€¡ì(€€€€€¥°(€€€€€ÍÑ…Ñ”è…Ñ”¹…¹ÍÝ•É…‰±”ñð¥¹‘•à€ðÕÉÉ•¹Ð€ü€‰½µÁ±•Ñ•ˆ€è¥¹‘•à€ôôôÕÉÉ•¹Ð€ü€‰ÕÉÉ•¹Ðˆ€è€‰Á•¹‘¥¹œˆ°(€€€€€½‰Í•ÉÙ•è€¡…Ñ”¹•Ù•¹ÑÌñðmt¤¹Í½µ” ¡•Ù•¹Ð¤€ôø•Ù•¹Ð¹ÑåÁ”€ôôô¥€˜˜€…•Ù•¹Ð¹Í­¥ÁÁ•¤(€€€ô¤¤ì(€ô(€™Õ¹Ñ¥½¸ÁÉ½Ù•¹…¹•½È¡…Ñ”°ÍÑ…ÑÕÌÈ€ô€‰Á•¹‘¥¹œˆ¤ì(€€€É•ÑÕÉ¸ì(€€€€€ÍÑ…ÑÕÌèÍÑ…ÑÕÌÈ°(€€€€€Í½ÕÉ•}É•™Ìèl¸¸¹…Ñ”¹Í½ÕÉ•}É•™Ít°(€€€€€±…¥µ}‰¥¹‘¥¹ÌèÍÑÉÕÑÕÉ•‘±½¹”¡…Ñ”¹±…¥µ}‰¥¹‘¥¹Ì¤°(€€€€€ÕÁ‘…Ñ•‘}…Ðè€ ¼¨}}AUI}|€¨¼¹•Ü…Ñ” ¤¤¹Ñ½%M=MÑÉ¥¹œ ¤(€€€ôì(€ô(€™Õ¹Ñ¥½¸…‘Ù…¹”¡…Ñ”°ÍÑ…”°‘•Ñ…¥±Ì€ôíô¤ì(€€€½¹ÍÐÕÉÉ•¹Ð€ôIMI!}MQL¹¥¹‘•á=˜¡…Ñ”¹ÍÑ…”¤ì(€€€½¹ÍÐÑ…É•Ð€ôIMI!}MQL¹¥¹‘•á=˜¡ÍÑ…”¤ì(€€€¥˜€¡Ñ…É•Ð€ð€À¤Ñ¡É½Ü¹•ÜÉÉ½È¡U¹­¹½Ý¸É•Í•…É ÍÑ…”è€‘íÍÑ…•õ€¤ì(€€€¥˜€¡Ñ…É•Ð€ðÕÉÉ•¹Ð¤(€€€€€É•ÑÕÉ¸ì(€€€€€€€€¸¸¹…Ñ”°(€€€€€€€•Ù•¹ÑÌèl¸¸¹…Ñ”¹•Ù•¹ÑÌ°ìÑåÁ”èÍÑ…”°…Ðè€ ¼¨}}AUI}|€¨¼¹•Ü…Ñ” ¤¤¹Ñ½%M=MÑÉ¥¹œ ¤°É•Á•…Ñ•èÑÉÕ”°€¸¸¹‘•Ñ…¥±Ìõt(€€€€€ôì(€€€É•ÑÕÉ¸ì(€€€€€€¸¸¹…Ñ”°(€€€€€ÍÑ…”°(€€€€€•Ù•¹ÑÌèl¸¸¹…Ñ”¹•Ù•¹ÑÌ°ìÑåÁ”èÍÑ…”°…Ðè€ ¼¨}}AUI}|€¨¼¹•Ü…Ñ” ¤¤¹Ñ½%M=MÑÉ¥¹œ ¤°€¸¸¹‘•Ñ…¥±Ìõt(€€€ôì(€ô(€…Íå¹Œ™Õ¹Ñ¥½¸É•Í½±Ù•IÕ¸¡Ý°ÉÕ¹¥È¤ì(€€€½¹ÍÐ½¹™¥œ€ô…Ý…¥Ð±½…‘]½É­ÍÁ…•½¹™¥œÌ¡Ý¤ì(€€€¥˜€ …ÉÕ¹¥È¤Ñ¡É½Ü¹•ÜÉÉ½È ‰ÉÕ¹}‘¥È¥ÌÉ•ÅÕ¥É•™½ÈÑ¡¥Ì…Ñ¥½¸ˆ¤ì(€€€½¹ÍÐÁ…Ñ €ôÉ•Í½±Ù”Ü¡Ý°ÉÕ¹¥È¤ì(€€€¥˜€ …Ý¥Ñ¡¥¸È¡½¹™¥œ¹É•ÍÕ±ÑÍI½½Ð°Á…Ñ ¤¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰ÉÕ¹}‘¥ÈµÕÍÐÍÑ…ä¥¹Í¥‘”Ñ¡”½¹™¥ÕÉ•É•ÍÕ±ÑÌÉ½½Ðˆ¤ì(€€€½¹ÍÐÉ•°€ôÉ•±…Ñ¥Ù”Ô¡½¹™¥œ¹É•ÍÕ±ÑÍI½½Ð°Á…Ñ ¤¹ÍÁ±¥Ð¡Í•ÀÔ¤ì(€€€¥˜€¡É•°¹±•¹Ñ €„ôô€Èñð€…É•±lÅtü¹ÍÑ…ÉÑÍ]¥Ñ  ‰ÉÕ¸´ˆ¤¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰ÉÕ¹}‘¥ÈµÕÍÐ‰”‘¥É•Ñ±ä¥¹Í¥‘”„É•ÍÕ±ÐÍ±Õœˆ¤ì(€€€…Ý…¥Ð…•ÍÌÈ¡©½¥¸Ô¡Á…Ñ °€‰µ•Ñ…‘…Ñ„¹©Í½¸ˆ¤¤ì(€€€É•ÑÕÉ¸ì½¹™¥œ°Á…Ñ °µ•Ñ…‘…Ñ…A…Ñ è©½¥¸Ô¡Á…Ñ °€‰µ•Ñ…‘…Ñ„¹©Í½¸ˆ¤ôì(€ô(€…Íå¹Œ™Õ¹Ñ¥½¸ÍÑ…ÉÑI•Í•…É¡IÕ¸¡ì(€€€Ý€ôÁÉ½•ÍÌ¹Ý ¤°(€€€ÁÉ½©•Ð°(€€€É•ÍÕ±ÑM±Õœ°(€€€ÅÕ•Éä°(€€€É•ÅÕ¥É•ÍAÉ½Ù•¹…¹”€ô™…±Í”(€ô€ôíô¤ì(€€€½¹ÍÐ½¹™¥œ€ô…Ý…¥Ð±½…‘]½É­ÍÁ…•½¹™¥œÌ¡Ý¤ì(€€€ÁÉ½©•Ð€ôÍ…™•M±Õœ¡ÁÉ½©•Ðñð€¡…Ý…¥ÐÉ•Í½±Ù•]½É­ÍÁ…•AÉ½©•Ð¡ìÝô¤¤¹ÁÉ½©•Ð°€‰ÁÉ½©•Ðˆ¤ì(€€€É•ÍÕ±ÑM±Õœ€ôÍ…™•M±Õœ¡É•ÍÕ±ÑM±Õœñð€‰É•Í•…É µÅÕ•ÍÑ¥½¸ˆ°€‰É•ÍÕ±Ñ}Í±Õœˆ¤ì(€€€¥˜€¡ÑåÁ•½˜ÅÕ•Éä€„ôô€‰ÍÑÉ¥¹œˆñð€…ÅÕ•Éä¹ÑÉ¥´ ¤¤Ñ¡É½Ü¹•ÜÉÉ½È ‰ÅÕ•Éä¥ÌÉ•ÅÕ¥É•ˆ¤ì(€€€½¹ÍÐÍÑ…µÀ€ô€ ¼¨}}AUI}|€¨¼¹•Ü…Ñ” ¤¤¹Ñ½%M=MÑÉ¥¹œ ¤¹É•Á±…” ½l´è¹Qit½œ°€ˆˆ¤¹Í±¥” À°€ÄÐ¤ì(€€€½¹ÍÐÉÕ¹%€ôÉÕ¸´‘íÍÑ…µÁô´‘íÉ…¹‘½µUU%Ô ¤¹Í±¥” À°€à¥õ€ì(€€€½¹ÍÐÉÕ¹¥È€ô©½¥¸Ô¡½¹™¥œ¹É•ÍÕ±ÑÍI½½Ð°É•ÍÕ±ÑM±Õœ°ÉÕ¹%¤ì(€€€½¹ÍÐ¹½Ü€ô€ ¼¨}}AUI}|€¨¼¹•Ü…Ñ” ¤¤¹Ñ½%M=MÑÉ¥¹œ ¤ì(€€€½¹ÍÐµ•Ñ…‘…Ñ„€ôì(€€€€€­¥¹èIMI!}=U59Q}-%9°(€€€€€Ù•ÉÍ¥½¸è€Ä°(€€€€€ÉÕ¹}¥èÉÕ¹%°(€€€€€ÁÉ½©•Ð°(€€€€€É•ÍÕ±Ñ}Í±ÕœèÉ•ÍÕ±ÑM±Õœ°(€€€€€Ñ½Á¥}¥èÑ½Á¥%‘É½µI•ÍÕ±ÑM±Õœ¡É•ÍÕ±ÑM±Õœ¤°(€€€€€ÅÕ•ÉäèÅÕ•Éä¹ÑÉ¥´ ¤°(€€€€€ÍÑ…ÑÕÌè€‰ÉÕ¹¹¥¹œˆ°(€€€€€É•Ù¥Í¥½¸è€À°(€€€€€É•ÅÕ¥É•Í}ÁÉ½Ù•¹…¹”èÉ•ÅÕ¥É•ÍAÉ½Ù•¹…¹”€ôôôÑÉÕ”°(€€€€€ÍÑ…ÉÑ•‘}…Ðè¹½Ü°(€€€€€•Ù¥‘•¹•}…Ñ”èì(€€€€€€€ÍÑ…”è€‰É•…Ñ•ˆ°(€€€€€€€ÍÑ…ÑÕÌè€‰½¬ˆ°(€€€€€€€…¹ÍÝ•É…‰±”è™…±Í”°(€€€€€€€•Ù•¹ÑÌèmìÑåÁ”è€‰É•…Ñ•ˆ°…Ðè¹½Üõt°(€€€€€€€±…¥µ}É•™Ìèmt°(€€€€€€€Í½ÕÉ•}É•™Ìèmt°(€€€€€€€…É¡¥Ù•}½Õ¹Ðè€À(€€€€€ô°(€€€€€É•Í•…É¡}¹½‘•ÌèÉ•Í•…É¡9½‘•Ì¡ìÍÑ…”è€‰É•…Ñ•ˆ°…¹ÍÝ•É…‰±”è™…±Í”°•Ù•¹ÑÌèmìÑåÁ”è€‰É•…Ñ•ˆõtô¤°(€€€€€ÁÉ½Ù•¹…¹”èÁÉ½Ù•¹…¹•½È¡ìÍ½ÕÉ•}É•™Ìèmt°±…¥µ}‰¥¹‘¥¹Ìèmtô¤(€€€ôì(€€€…Ý…¥Ðµ­‘¥ÈÌ¡ÉÕ¹¥È°ìÉ•ÕÉÍ¥Ù”èÑÉÕ”ô¤ì(€€€…Ý…¥Ð…Ñ½µ¥)Í½¸È¡©½¥¸Ô¡ÉÕ¹¥È°€‰µ•Ñ…‘…Ñ„¹©Í½¸ˆ¤°µ•Ñ…‘…Ñ„¤ì(€€€É•ÑÕÉ¸ìÉÕ¹}‘¥ÈèÉÕ¹¥È°µ•Ñ…‘…Ñ„ôì(€ô(€…Íå¹Œ™Õ¹Ñ¥½¸ÕÁ‘…Ñ•I•Í•…É¡1½½ÁU¹±½­•¡ì(€€€Ý€ôÁÉ½•ÍÌ¹Ý ¤°(€€€ÉÕ¹¥È°(€€€…Ñ¥½¸°(€€€ÅÕ•Éä°(€€€Í½ÕÉ•I•™Ì€ômt°(€€€±…¥µI•™Ì€ômt°(€€€±…¥µ	¥¹‘¥¹Ì€ômt°(€€€½ÕÑ½µ”°(€€€¹½Ñ•Ì°(€€€•áÁ•Ñ•‘I•Ù¥Í¥½¸(€ô€ôíô¤ì(€€€½¹ÍÐìÁ…Ñ °µ•Ñ…‘…Ñ…A…Ñ ô€ô…Ý…¥ÐÉ•Í½±Ù•IÕ¸¡Ý°ÉÕ¹¥È¤ì(€€€½¹ÍÐµ•Ñ…‘…Ñ„€ô…Ý…¥ÐÉ•…‘)Í½¸Ì¡µ•Ñ…‘…Ñ…A…Ñ ¤ì(€€€½¹ÍÐÉ•Ù¥Í¥½¸€ô9Õµ‰•È¹¥Í%¹Ñ••È¡µ•Ñ…‘…Ñ„¹É•Ù¥Í¥½¸¤€üµ•Ñ…‘…Ñ„¹É•Ù¥Í¥½¸€è€Àì(€€€¥˜€¡•áÁ•Ñ•‘I•Ù¥Í¥½¸€„ô¹Õ±°€˜˜9Õµ‰•È¡•áÁ•Ñ•‘I•Ù¥Í¥½¸¤€„ôôÉ•Ù¥Í¥½¸¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È¡É•Í•…É ÉÕ¸¡…¹•ì•áÁ•Ñ•É•Ù¥Í¥½¸€‘í•áÁ•Ñ•‘I•Ù¥Í¥½¹ô°™½Õ¹€‘íÉ•Ù¥Í¥½¹õ€¤ì(€€€±•Ð…Ñ”€ô…Ñ•=˜¡µ•Ñ…‘…Ñ„¤ì(€€€½¹ÍÐ‘•Ñ…¥°€ôì(€€€€€€¸¸¹ÅÕ•Éä€üìÅÕ•ÉäèMÑÉ¥¹œ¡ÅÕ•Éä¤¹ÑÉ¥´ ¤ô€èíô°(€€€€€€¸¸¹½ÕÑ½µ”€üì½ÕÑ½µ”ô€èíô°(€€€€€€¸¸¹¹½Ñ•Ì€üì¹½Ñ•Ìô€èíô(€€€ôì(€€€½¹ÍÐÉ•ÅÕ¥É•MÑ…”€ô€¡ÍÑ…”¤€ôøì(€€€€€¥˜€¡IMI!}MQL¹¥¹‘•á=˜¡…Ñ”¹ÍÑ…”¤€ðIMI!}MQL¹¥¹‘•á=˜¡ÍÑ…”¤¤(€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È¡É•Í•…É ±½½ÀµÕÍÐÉ•… €‘íÍÑ…•ô‰•™½É”€‘í…Ñ¥½¹õ€¤ì(€€€ôì(€€€¥˜€¡…Ñ¥½¸€ôôô€‰ÍÑ…ÑÕÌˆ¤É•ÑÕÉ¸ìÉÕ¹}‘¥ÈèÁ…Ñ °µ•Ñ…‘…Ñ„°•Ù¥‘•¹•}…Ñ”è…Ñ”°É•Ù¥Í¥½¸ôì(€€€¥˜€¡…Ñ¥½¸€ôôô€‰É•½É‘}±½…°ˆ¤ì(€€€€€¥˜€ …ÅÕ•Éäü¹ÑÉ¥´ ¤¤Ñ¡É½Ü¹•ÜÉÉ½È ‰ÅÕ•Éä¥ÌÉ•ÅÕ¥É•ˆ¤ì(€€€€€…Ñ”€ô…‘Ù…¹”¡…Ñ”°€‰±½…±}ÅÕ•Éå}É•½É‘•ˆ°‘•Ñ…¥°¤ì(€€€ô•±Í”¥˜€¡…Ñ¥½¸€ôôô€‰É•½É‘}•áÑ•É¹…°ˆ¤ì(€€€€€É•ÅÕ¥É•MÑ…” ‰±½…±}ÅÕ•Éå}É•½É‘•ˆ¤ì(€€€€€¥˜€ …ÅÕ•Éäü¹ÑÉ¥´ ¤€˜˜€…¹½Ñ•Ìü¹ÑÉ¥´ ¤¤(€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰É•½ÉÑ¡”•áÑ•É¹…°ÅÕ•Éä½ÈÝ¡ä•áÑ•É¹…°Í•…É Ý…ÌÍ­¥ÁÁ•ˆ¤ì(€€€€€…Ñ”€ô…‘Ù…¹”¡…Ñ”°€‰•áÑ•É¹…±}Í•…É¡}É•½É‘•ˆ°‘•Ñ…¥°¤ì(€€€ô•±Í”¥˜€¡…Ñ¥½¸€ôôô€‰¥¹ÍÁ•Ñ}Í½ÕÉ•Ìˆ¤ì(€€€€€É•ÅÕ¥É•MÑ…” ‰•áÑ•É¹…±}Í•…É¡}É•½É‘•ˆ¤ì(€€€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡Í½ÕÉ•I•™Ì¤ñðÍ½ÕÉ•I•™Ì¹±•¹Ñ €ôôô€À¤(€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰Í½ÕÉ•}É•™ÌµÕÍÐ±¥ÍÐ¥¹ÍÁ•Ñ•½É¥¥¹…°Í½ÕÉ•Ìˆ¤ì(€€€€€…Ñ”€ô…‘Ù…¹” (€€€€€€€ì€¸¸¹…Ñ”°Í½ÕÉ•}É•™Ìèl¸¸¸¼¨}}AUI}|€¨¼¹•ÜM•Ð¡l¸¸¹…Ñ”¹Í½ÕÉ•}É•™Ì°€¸¸¹Í½ÕÉ•I•™Ì¹µ…À¡MÑÉ¥¹œ¥t¥tô°(€€€€€€€€‰Í½ÕÉ•Í}¥¹ÍÁ•Ñ•ˆ°(€€€€€€€ì€¸¸¹‘•Ñ…¥°°Í½ÕÉ•}É•™ÌèÍ½ÕÉ•I•™Ìô(€€€€€€¤ì(€€€ô•±Í”¥˜€¡…Ñ¥½¸€ôôô€‰Ù•É¥™å}…É¡¥Ù”ˆ¤ì(€€€€€É•ÅÕ¥É•MÑ…” ‰Í½ÕÉ•Í}¥¹ÍÁ•Ñ•ˆ¤ì(€€€€€½¹ÍÐ…É¡¥Ù”€ô…Ý…¥ÐÍ½ÕÉ•MÑ…ÑÕÌÈ¡ìÝ°ÉÕ¹}‘¥ÈèÁ…Ñ °Ù•É¥™äèÑÉÕ”ô¤ì(€€€€€¥˜€¡…É¡¥Ù”¹Ù•É¥™¥…Ñ¥½¸€˜˜…É¡¥Ù”¹Ù•É¥™¥…Ñ¥½¸¹½¬€„ôôÑÉÕ”¤ì(€€€€€€€½¹ÍÐ™…¥±•€ô…É¡¥Ù”¹Ù•É¥™¥…Ñ¥½¸¹¥Ñ•µÌü¹™¥±Ñ•È ¡¥Ñ•´¤€ôø¥Ñ•´¹½¬€„ôôÑÉÕ”¤ñðmtì(€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È (€€€€€€€€€É¡¥Ù•Í½ÕÉ”Ù•É¥™¥…Ñ¥½¸™…¥±•è€‘í™…¥±•¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹É•…Í½¸ñð¥Ñ•´¹Á…Ñ ¤¹©½¥¸ ˆ°€ˆ¤ñð€‰Õ¹­¹½Ý¸‰õ€(€€€€€€€€¤ì(€€€€€ô(€€€€€½¹ÍÐ‘½Ý¹±½…‘•€ô€¡…É¡¥Ù”¹µ…¹¥™•ÍÐü¹¥Ñ•µÌñðmt¤¹™¥±Ñ•È ¡¥Ñ•´¤€ôø¥Ñ•´¹ÍÑ…ÑÕÌ€ôôô€‰‘½Ý¹±½…‘•ˆ¤ì(€€€€€½¹ÍÐÉ•ÕÍ•€ô…Ý…¥ÐÉ•ÕÍ…‰±•M½ÕÉ•Ì¡Ý°ÉÕ¹¥È¤ì(€€€€€¥˜€ …‘½Ý¹±½…‘•¹±•¹Ñ €˜˜€…É•ÕÍ•¹±•¹Ñ ¤(€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È (€€€€€€€€€€‰9¼…Ù…¥±…‰±”Í½ÕÉ”èÉ•……¸•á¥ÍÑ¥¹œ1¥‰É…Éä½A…Á•ÉÌ¹½Ñ”Ñ¡¥ÌÑÕÉ¸…¹Ù•É¥™ä¥ÑÌ=$½­•äÝ¥Ñ É•Í•…É¡}Ù•É¥™å}±¥Ñ•É…ÑÕÉ”°½È…É¡¥Ù”…¸…ÕÑ¡½É¥é•¹•ÜÍ½ÕÉ”¸¼¹½ÐÉ•Á•…Ð¥µÁ½ÉÑÌÑ¼±•…ÈÑ¡¥Ì…Ñ”¸ˆ(€€€€€€€€¤ì(€€€€€…Ñ”€ô…‘Ù…¹” (€€€€€€€ì€¸¸¹…Ñ”°…É¡¥Ù•}½Õ¹Ðè‘½Ý¹±½…‘•¹±•¹Ñ °É•ÕÍ•}½Õ¹ÐèÉ•ÕÍ•¹±•¹Ñ °É•ÕÍ•‘}Í½ÕÉ•ÌèÉ•ÕÍ•ô°(€€€€€€€‘½Ý¹±½…‘•¹±•¹Ñ €ü€‰Í½ÕÉ•Í}…É¡¥Ù•ˆ€è€‰Í½ÕÉ•Í}É•ÕÍ•ˆ°(€€€€€€€ì(€€€€€€€€€…É¡¥Ù•è‘½Ý¹±½…‘•¹µ…À ¡¥Ñ•´¤€ôø€¡ì¥è¥Ñ•´¹¥°Í¡„ÈÔØè¥Ñ•´¹Í¡„ÈÔØ°Á…Ñ è¥Ñ•´¹Á…Ñ ô¤¤°(€€€€€€€€€É•ÕÍ•‘}Í½ÕÉ•ÌèÉ•ÕÍ•°(€€€€€€€€€Í¥•¹Ñ¥™¥…±±åY•É¥™¥•è™…±Í”(€€€€€€€ô(€€€€€€¤ì(€€€ô•±Í”¥˜€¡…Ñ¥½¸€ôôô€‰‰¥¹‘}±…¥µÌˆ¤ì(€€€€€¥˜€¡…Ñ”¹ÍÑ…”€ôôô€‰Í½ÕÉ•Í}¥¹ÍÁ•Ñ•ˆ¤ì(€€€€€€€½¹ÍÐ…Ù…¥±…‰±”€ô…Ý…¥ÐÕÁ‘…Ñ•I•Í•…É¡1½½ÁU¹±½­•¡ìÝ°ÉÕ¹¥È°…Ñ¥½¸è€‰Ù•É¥™å}…É¡¥Ù”ˆô¤ì(€€€€€€€…Ñ”€ô…Ù…¥±…‰±”¹•Ù¥‘•¹•}…Ñ”ì(€€€€€ô(€€€€€É•ÅÕ¥É•MÑ…” ‰Í½ÕÉ•Í}…É¡¥Ù•ˆ¤ì(€€€€€…Ý…¥ÐÙ…±¥‘…Ñ•I•ÕÍ”¡Ý°ÉÕ¹¥È°…Ñ”¤ì(€€€€€¥˜€¡±…¥µ	¥¹‘¥¹Ì¹±•¹Ñ ¤ì(€€€€€€€½¹ÍÐ¡•­•€ôÙ…±¥‘…Ñ•±…¥µ	¥¹‘¥¹Ì (€€€€€€€€€±…¥µ	¥¹‘¥¹Ì°(€€€€€€€€€l¸¸¹…Ý…¥ÐÉ•ÕÍ…‰±•M½ÕÉ•Ì¡Ý°ÉÕ¹¥È¤°€¸¸¹…Ý…¥Ð…É¡¥Ù•‘M½ÕÉ•I•½É‘Ì¡Ý°ÉÕ¹¥È¥t°(€€€€€€€€€±•‘•È¡Ý°ÉÕ¹¥È¤¹É•…‘Ì(€€€€€€€€¤ì(€€€€€€€…Ñ”€ôì€¸¸¹…Ñ”°±…¥µ}‰¥¹‘¥¹Ìè¡•­•°Ý…É¹¥¹Ìèmtôì(€€€€€€€±…¥µI•™Ì€ô±…¥µ	¥¹‘¥¹I•™Ì¡¡•­•¤ì(€€€€€ô•±Í”¥˜€¡…Ñ”¹±…¥µ}‰¥¹‘¥¹Ì¹±•¹Ñ ¤ì(€€€€€€€½¹ÍÐ¡•­•€ô…Ý…¥ÐÙ…±¥‘…Ñ•MÑ½É•‘±…¥µ	¥¹‘¥¹Ì¡Ý°ÉÕ¹¥È°…Ñ”¤ì(€€€€€€€…Ñ”€ôì€¸¸¹…Ñ”°±…¥µ}‰¥¹‘¥¹Ìè¡•­•°±…¥µ}É•™Ìè±…¥µ	¥¹‘¥¹I•™Ì¡¡•­•¤°Ý…É¹¥¹Ìèmtôì(€€€€€€€±…¥µI•™Ì€ô±…¥µ	¥¹‘¥¹I•™Ì¡¡•­•¤ì(€€€€€ô•±Í”¥˜€¡±…¥µI•™Ì¹±•¹Ñ ¤ì(€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È (€€€€€€€€€€‰MÑÉÕÑÕÉ•±…¥µ}‰¥¹‘¥¹Ì…É”É•ÅÕ¥É•ì±•…ä±…¥µ}É•™Ì…¹¹½Ðµ…­”„ÉÕ¸…¹ÍÝ•É…‰±”ˆ(€€€€€€€€¤ì(€€€€€ô(€€€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡…Ñ”¹±…¥µ}‰¥¹‘¥¹Ì¤ñð…Ñ”¹±…¥µ}‰¥¹‘¥¹Ì¹±•¹Ñ €ôôô€À¤(€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰MÑÉÕÑÕÉ•±…¥µ}‰¥¹‘¥¹ÌµÕÍÐ½¹Ñ…¥¸…Ð±•…ÍÐ½¹”Ù…±¥‘…Ñ•±…¥´ˆ¤ì(€€€€€…Ñ”€ô…‘Ù…¹”¡ì€¸¸¹…Ñ”°±…¥µ}É•™Ìèl¸¸¹¹•ÜM•Ð¡±…¥µI•™Ì¹µ…À¡MÑÉ¥¹œ¤¥tô°€‰±…¥µÍ}‰½Õ¹ˆ°ì(€€€€€€€±…¥µ}É•™Ìè±…¥µI•™Ì(€€€€€ô¤ì(€€€ô•±Í”¥˜€¡…Ñ¥½¸€ôôô€‰™¥¹…±¥é”ˆ¤ì(€€€€€É•ÅÕ¥É•MÑ…” ‰±…¥µÍ}‰½Õ¹ˆ¤ì(€€€€€…Ý…¥ÐÙ…±¥‘…Ñ•I•ÕÍ”¡Ý°ÉÕ¹¥È°…Ñ”¤ì(€€€€€½¹ÍÐ¡•­•€ô…Ý…¥ÐÙ…±¥‘…Ñ•MÑ½É•‘±…¥µ	¥¹‘¥¹Ì¡Ý°ÉÕ¹¥È°…Ñ”¤ì(€€€€€½¹ÍÐÉ•™Ì€ô±…¥µ	¥¹‘¥¹I•™Ì¡¡•­•¤ì(€€€€€¥˜€¡…Ñ”¹…É¡¥Ù•}½Õ¹Ð€¬…Ñ”¹É•ÕÍ•}½Õ¹Ð€ð€Äñð€…É•™Ì¹±•¹Ñ ¤(€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰…É¡¥Ù”Ù•É¥™¥…Ñ¥½¸…¹ÍÑÉÕÑÕÉ•±…¥´‰¥¹‘¥¹Ì…É”É•ÅÕ¥É•‰•™½É”…¹ÍÝ•É…‰±”ˆ¤ì(€€€€€¥˜€¡µ•Ñ…‘…Ñ„¹É•ÅÕ¥É•Í}ÁÉ½Ù•¹…¹”€ôôôÑÉÕ”¤ì(€€€€€€€½¹ÍÐÁÉ½Ù•¹…¹”€ô…Ý…¥ÐÉ•…‘)Í½¸Ì¡©½¥¸Ô¡Á…Ñ °€‰É•ÁÉ½‘Õ¥‰¥±¥Ñäµµ…¹¥™•ÍÐ¹©Í½¸ˆ¤¤ì(€€€€€€€¥˜€¡ÁÉ½Ù•¹…¹”ü¹Ù•ÉÍ¥½¸€„ôô€Ä¤(€€€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰Q¡¥ÌÉÕ¸É•ÅÕ¥É•Ì„É•ÁÉ½‘Õ¥‰¥±¥Ñäµ…¹¥™•ÍÐ‰•™½É”¥Ð…¸‰•½µ”…¹ÍÝ•É…‰±”ˆ¤ì(€€€€€ô(€€€€€…Ñ”€ô…‘Ù…¹” (€€€€€€€ì€¸¸¹…Ñ”°±…¥µ}‰¥¹‘¥¹Ìè¡•­•°±…¥µ}É•™ÌèÉ•™Ì°Ý…É¹¥¹Ìèmt°ÍÑ…ÑÕÌè€‰½¬ˆ°…¹ÍÝ•É…‰±”èÑÉÕ”ô°(€€€€€€€€‰…¹ÍÝ•É…‰±”ˆ°(€€€€€€€‘•Ñ…¥°(€€€€€€¤ì(€€€ô•±Í”¥˜€¡…Ñ¥½¸€ôôô€‰½µÁ±•Ñ”ˆ¤ì(€€€€€É•ÑÕÉ¸½µÁ±•Ñ•I•Í•…É¡…Ñ”¡ìÝ°ÉÕ¹¥È°±…¥µI•™Ì°±…¥µ	¥¹‘¥¹Ìô¤ì(€€€ô•±Í”ì(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È¡Õ¹­¹½Ý¸É•Í•…É¡}±½½À…Ñ¥½¸è€‘í…Ñ¥½¹õ€¤ì(€€€ô(€€€µ•Ñ…‘…Ñ„¹•Ù¥‘•¹•}…Ñ”€ô…Ñ”ì(€€€µ•Ñ…‘…Ñ„¹É•Í•…É¡}¹½‘•Ì€ôÉ•Í•…É¡9½‘•Ì¡…Ñ”¤ì(€€€µ•Ñ…‘…Ñ„¹ÁÉ½Ù•¹…¹”€ôÁÉ½Ù•¹…¹•½È¡…Ñ”°…Ñ”¹…¹ÍÝ•É…‰±”€ü€‰¡½ÍÐµÙ•É¥™¥•ˆ€è€‰Á•¹‘¥¹œˆ¤ì(€€€¥˜€¡…Ñ”¹…¹ÍÝ•É…‰±”¤ì(€€€€€µ•Ñ…‘…Ñ„¹ÍÑ…ÑÕÌ€ô€‰½µÁ±•Ñ•ˆì(€€€€€µ•Ñ…‘…Ñ„¹™¥¹…±¥é•‘}…Ð€ôµ•Ñ…‘…Ñ„¹™¥¹…±¥é•‘}…Ðñð€ ¼¨}}AUI}|€¨¼¹•Ü…Ñ” ¤¤¹Ñ½%M=MÑÉ¥¹œ ¤ì(€€€ô(€€€µ•Ñ…‘…Ñ„¹ÕÁ‘…Ñ•‘}…Ð€ô€ ¼¨}}AUI}|€¨¼¹•Ü…Ñ” ¤¤¹Ñ½%M=MÑÉ¥¹œ ¤ì(€€€µ•Ñ…‘…Ñ„¹É•Ù¥Í¥½¸€ôÉ•Ù¥Í¥½¸€¬€Äì(€€€…Ý…¥Ð…Ñ½µ¥)Í½¸È¡µ•Ñ…‘…Ñ…A…Ñ °µ•Ñ…‘…Ñ„¤ì(€€€É•ÑÕÉ¸ìÉÕ¹}‘¥ÈèÁ…Ñ °•Ù¥‘•¹•}…Ñ”è…Ñ”°É•Ù¥Í¥½¸èµ•Ñ…‘…Ñ„¹É•Ù¥Í¥½¸ôì(€ô(€…Íå¹Œ™Õ¹Ñ¥½¸ÕÁ‘…Ñ•I•Í•…É¡1½½À¡¥¹ÁÕÐ€ôíô¤ì(€€€½¹ÍÐÝ€ô¥¹ÁÕÐ¹ÝñðÁÉ½•ÍÌ¹Ý ¤ì(€€€½¹ÍÐ­•ä€ôÉÕ¹-•ä¡Ý°¥¹ÁÕÐ¹ÉÕ¹¥È¤ì(€€€½¹ÍÐÝ½É¬€ô€ ¤€ôøÕÁ‘…Ñ•I•Í•…É¡1½½ÁU¹±½­•¡¥¹ÁÕÐ¤ì(€€€¥˜€¡¥¹ÁÕÐ¹…Ñ¥½¸€ôôô€‰½µÁ±•Ñ”ˆñð€…Á½ÉÑÌ¹•á±ÕÍ¥Ù”¤É•ÑÕÉ¸Ý½É¬ ¤ì(€€€É•ÑÕÉ¸Á½ÉÑÌ¹•á±ÕÍ¥Ù”¡­•ä°Ý½É¬¤ì(€ô(€™Õ¹Ñ¥½¸¥Í]¥­¥A…Ñ ¡Á…Ñ ¤ì(€€€É•ÑÕÉ¸€¼ üéyñmqp½t¥]¥­¥mqp½t½¤¹Ñ•ÍÐ¡MÑÉ¥¹œ¡Á…Ñ ñð€ˆˆ¤¤ì(€ô(€…Íå¹Œ™Õ¹Ñ¥½¸•¹ÍÕÉ•MÑ…”¡Ý°ÉÕ¹¥È°ÍÑ…”°™¥±°¤ì(€€€½¹ÍÐÕÉÉ•¹Ð€ô…Ý…¥ÐÕÁ‘…Ñ•I•Í•…É¡1½½À¡ìÝ°ÉÕ¹¥È°…Ñ¥½¸è€‰ÍÑ…ÑÕÌˆô¤ì(€€€¥˜€¡IMI!}MQL¹¥¹‘•á=˜¡ÕÉÉ•¹Ð¹•Ù¥‘•¹•}…Ñ”¹ÍÑ…”¤€øôIMI!}MQL¹¥¹‘•á=˜¡ÍÑ…”¤¤(€€€€€É•ÑÕÉ¸ÕÉÉ•¹Ðì(€€€É•ÑÕÉ¸™¥±° ¤ì(€ô(€…Íå¹Œ™Õ¹Ñ¥½¸½µÁ±•Ñ•I•Í•…É¡…Ñ”¡ì(€€€Ý€ôÁÉ½•ÍÌ¹Ý ¤°(€€€ÉÕ¹¥È°(€€€±…¥µI•™Ì€ômt°(€€€±…¥µ	¥¹‘¥¹Ì€ômt(€ô€ôíô¤ì(€€€±•ÐÍÑ…ÑÕÌÈ€ô…Ý…¥ÐÕÁ‘…Ñ•I•Í•…É¡1½½À¡ìÝ°ÉÕ¹¥È°…Ñ¥½¸è€‰ÍÑ…ÑÕÌˆô¤ì(€€€±•Ð…Ñ”€ôÍÑ…ÑÕÌÈ¹•Ù¥‘•¹•}…Ñ”ì(€€€…Ý…¥ÐÙ…±¥‘…Ñ•I•ÕÍ”¡Ý°ÉÕ¹¥È°…Ñ”¤ì(€€€¥˜€¡IMI!}MQL¹¥¹‘•á=˜¡…Ñ”¹ÍÑ…”¤€ðIMI!}MQL¹¥¹‘•á=˜ ‰Í½ÕÉ•Í}¥¹ÍÁ•Ñ•ˆ¤¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰É•Í•…É ±½½ÀµÕÍÐ¥¹ÍÁ•ÐÍ½ÕÉ•Ì‰•™½É”½µÁ±•Ñ”ˆ¤ì(€€€¥˜€¡IMI!}MQL¹¥¹‘•á=˜¡…Ñ”¹ÍÑ…”¤€ðIMI!}MQL¹¥¹‘•á=˜ ‰Í½ÕÉ•Í}…É¡¥Ù•ˆ¤¤(€€€€€ÍÑ…ÑÕÌÈ€ô…Ý…¥ÐÕÁ‘…Ñ•I•Í•…É¡1½½À¡ìÝ°ÉÕ¹¥È°…Ñ¥½¸è€‰Ù•É¥™å}…É¡¥Ù”ˆô¤ì(€€€…Ñ”€ôÍÑ…ÑÕÌÈ¹•Ù¥‘•¹•}…Ñ”ì(€€€¥˜€ …±…¥µ	¥¹‘¥¹Ì¹±•¹Ñ €˜˜€……Ñ”¹±…¥µ}‰¥¹‘¥¹Ì¹±•¹Ñ ¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È (€€€€€€€€‰AÉ½Ù¥‘”ÍÑÉÕÑÕÉ•±…¥µ}‰¥¹‘¥¹Ìì±•…ä±…¥µ}É•™Ì…¹¹½Ðµ…­”„É•Í•…É ÉÕ¸…¹ÍÝ•É…‰±”ˆ(€€€€€€¤ì(€€€¥˜€¡±…¥µ	¥¹‘¥¹Ì¹±•¹Ñ ñðIMI!}MQL¹¥¹‘•á=˜¡…Ñ”¹ÍÑ…”¤€ðIMI!}MQL¹¥¹‘•á=˜ ‰±…¥µÍ}‰½Õ¹ˆ¤¤(€€€€€ÍÑ…ÑÕÌÈ€ô…Ý…¥ÐÕÁ‘…Ñ•I•Í•…É¡1½½À¡ì(€€€€€€€Ý°(€€€€€€€ÉÕ¹¥È°(€€€€€€€…Ñ¥½¸è€‰‰¥¹‘}±…¥µÌˆ°(€€€€€€€±…¥µI•™Ì°(€€€€€€€±…¥µ	¥¹‘¥¹Ì(€€€€€ô¤ì(€€€…Ñ”€ôÍÑ…ÑÕÌÈ¹•Ù¥‘•¹•}…Ñ”ì(€€€ÍÑ…ÑÕÌÈ€ô…Ý…¥ÐÕÁ‘…Ñ•I•Í•…É¡1½½À¡ìÝ°ÉÕ¹¥È°…Ñ¥½¸è€‰™¥¹…±¥é”ˆô¤ì(€€€É•ÑÕÉ¸ÍÑ…ÑÕÌÈì(€ô(€™Õ¹Ñ¥½¸½‰Í•ÉÙ•I•Í•…É¡I••¥ÁÐ¡½ÁÑ¥½¹Ì€ôíô¤ì(€€€¥˜€ …½ÁÑ¥½¹Ì¹ÉÕ¹¥È¤É•ÑÕÉ¸AÉ½µ¥Í”¹É•Í½±Ù”¡¹Õ±°¤ì(€€€½¹ÍÐ­•ä€ôÉÕ¹-•ä¡½ÁÑ¥½¹Ì¹ÝñðÁÉ½•ÍÌ¹Ý ¤°½ÁÑ¥½¹Ì¹ÉÕ¹¥È¤ì(€€€½¹ÍÐÝ½É¬€ô€¡ÉÕ¹Ñ¥µ•MÑ…Ñ”Ì¹É••¥ÁÑEÕ•Õ•Ì¹•Ð¡­•ä¤ñðAÉ½µ¥Í”¹É•Í½±Ù” ¤¤¹…Ñ   ¤€ôøì(€€€ô¤¹Ñ¡•¸  ¤€ôø½‰Í•ÉÙ•I••¥ÁÐ¡½ÁÑ¥½¹Ì¤¤ì(€€€ÉÕ¹Ñ¥µ•MÑ…Ñ”Ì¹É••¥ÁÑEÕ•Õ•Ì¹Í•Ð¡­•ä°Ý½É¬¤ì(€€€Ù½¥Ý½É¬¹™¥¹…±±ä  ¤€ôøì(€€€€€¥˜€¡ÉÕ¹Ñ¥µ•MÑ…Ñ”Ì¹É••¥ÁÑEÕ•Õ•Ì¹•Ð¡­•ä¤€ôôôÝ½É¬¤ÉÕ¹Ñ¥µ•MÑ…Ñ”Ì¹É••¥ÁÑEÕ•Õ•Ì¹‘•±•Ñ”¡­•ä¤ì(€€€ô¤¹…Ñ   ¤€ôøì(€€€ô¤ì(€€€É•ÑÕÉ¸Ý½É¬ì(€ô(€…Íå¹Œ™Õ¹Ñ¥½¸½‰Í•ÉÙ•I••¥ÁÐ¡ì(€€€Ý€ôÁÉ½•ÍÌ¹Ý ¤°(€€€ÉÕ¹¥È°(€€€Ñ½½±9…µ”°(€€€…ÉÌ€ôíô°(€€€‘•Ñ…¥±Ì€ôíô°(€€€½¹Ñ•¹Ð€ômt°(€€€¥ÍÉÉ½È€ô™…±Í”°(€€€É•…‘	¥¹‘¥¹œ(€ô€ôíô¤ì(€€€¥˜€¡¥ÍÉÉ½Èñð€…ÉÕ¹¥Èñð€…Ñ½½±9…µ”¤É•ÑÕÉ¸¹Õ±°ì(€€€ÑÉäì(€€€€€¥˜€¡Ñ½½±9…µ”€ôôô€‰É•Í•…É¡}É•½¹¥±•}±¥Ñ•É…ÑÕÉ”ˆ¤(€€€€€€€É•ÑÕÉ¸½‰Í•ÉÙ•I••¥ÁÐ¡ì(€€€€€€€€€Ý°(€€€€€€€€€ÉÕ¹¥È°(€€€€€€€€€Ñ½½±9…µ”è€‰É•Í•…É¡}Ù•É¥™å}±¥Ñ•É…ÑÕÉ”ˆ°(€€€€€€€€€…ÉÌ°(€€€€€€€€€‘•Ñ…¥±Ìè‘•Ñ…¥±Ì¹É••¥ÁÐñðíô°(€€€€€€€€€¥ÍÉÉ½È(€€€€€€€ô¤ì(€€€€€½¹ÍÐÅÕ•Éä€ôMÑÉ¥¹œ¡…ÉÌ¹ÅÕ•Éäñð‘•Ñ…¥±Ì¹ÅÕ•Éäñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€€€¥˜€¡Ñ½½±9…µ”€ôôô€‰É•Í•…É¡}Í•…É¡}­¹½Ý±•‘”ˆ€˜˜ÅÕ•Éä€˜˜‘•Ñ…¥±Ì¹½µÁ±•Ñ”€„ôô™…±Í”¤(€€€€€€€É•ÑÕÉ¸…Ý…¥ÐÕÁ‘…Ñ•I•Í•…É¡1½½À¡ìÝ°ÉÕ¹¥È°…Ñ¥½¸è€‰É•½É‘}±½…°ˆ°ÅÕ•Éäô¤ì(€€€€€¥˜€¡l‰Ý•‰™•Ñ ˆ°€‰™•Ñ¡}½¹Ñ•¹Ðˆ°€‰Ý•‰}Í•…É ‰t¹¥¹±Õ‘•Ì¡Ñ½½±9…µ”¤¤ì(€€€€€€€½¹ÍÐÕÉ°€ôMÑÉ¥¹œ¡…ÉÌ¹ÕÉ°ñð‘•Ñ…¥±Ì¹ÕÉ°ñðÅÕ•Éä¤¹ÑÉ¥´ ¤ì(€€€€€€€¥˜€ …ÕÉ°¤É•ÑÕÉ¸¹Õ±°ì(€€€€€€€…Ý…¥Ð•¹ÍÕÉ•MÑ…” (€€€€€€€€€Ý°(€€€€€€€€€ÉÕ¹¥È°(€€€€€€€€€€‰±½…±}ÅÕ•Éå}É•½É‘•ˆ°(€€€€€€€€€€ ¤€ôøÕÁ‘…Ñ•I•Í•…É¡1½½À¡ìÝ°ÉÕ¹¥È°…Ñ¥½¸è€‰É•½É‘}±½…°ˆ°ÅÕ•ÉäèÕÉ°ô¤(€€€€€€€€¤ì(€€€€€€€É•ÑÕÉ¸…Ý…¥ÐÕÁ‘…Ñ•I•Í•…É¡1½½À¡ì(€€€€€€€€€Ý°(€€€€€€€€€ÉÕ¹¥È°(€€€€€€€€€…Ñ¥½¸è€‰É•½É‘}•áÑ•É¹…°ˆ°(€€€€€€€€€ÅÕ•ÉäèÕÉ°°(€€€€€€€€€¹½Ñ•ÌèMÑÉ¥¹œ¡‘•Ñ…¥±Ì¹Ñ¥Ñ±”ñð€ˆˆ¤(€€€€€€€ô¤ì(€€€€€ô(€€€€€¥˜€¡Ñ½½±9…µ”€ôôô€‰É•Í•…É¡}É•…‘}­¹½Ý±•‘”ˆ¤ì(€€€€€€€½¹ÍÐÁ…Ñ €ôMÑÉ¥¹œ¡…ÉÌ¹Á…Ñ ñð‘•Ñ…¥±Ì¹Á…Ñ ñð€ˆˆ¤ì(€€€€€€€¥˜€ …Á…Ñ ñð¥Í]¥­¥A…Ñ ¡Á…Ñ ¤ñð‘•Ñ…¥±Ì¹µ¥ÍÍ¥¹œ€ôôôÑÉÕ”¤É•ÑÕÉ¸¹Õ±°ì(€€€€€€€…Ý…¥Ð•¹ÍÕÉ•MÑ…” (€€€€€€€€€Ý°(€€€€€€€€€ÉÕ¹¥È°(€€€€€€€€€€‰±½…±}ÅÕ•Éå}É•½É‘•ˆ°(€€€€€€€€€€ ¤€ôøÕÁ‘…Ñ•I•Í•…É¡1½½À¡ìÝ°ÉÕ¹¥È°…Ñ¥½¸è€‰É•½É‘}±½…°ˆ°ÅÕ•ÉäèÁ…Ñ ô¤(€€€€€€€€¤ì(€€€€€€€…Ý…¥Ð•¹ÍÕÉ•MÑ…” (€€€€€€€€€Ý°(€€€€€€€€€ÉÕ¹¥È°(€€€€€€€€€€‰•áÑ•É¹…±}Í•…É¡}É•½É‘•ˆ°(€€€€€€€€€€ ¤€ôøÕÁ‘…Ñ•I•Í•…É¡1½½À¡ì(€€€€€€€€€€€Ý°(€€€€€€€€€€€ÉÕ¹¥È°(€€€€€€€€€€€…Ñ¥½¸è€‰É•½É‘}•áÑ•É¹…°ˆ°(€€€€€€€€€€€¹½Ñ•Ìè€‰!½ÍÐè¹¼•áÑÉ„Ý•ˆÍ•…É ‰•™½É”¥¹ÍÁ•Ñ¥¹œÕÉÉ•¹ÐÍ½ÕÉ•Ì¸ˆ(€€€€€€€€€ô¤(€€€€€€€€¤ì(€€€€€€€¥˜€ ½y1¥‰É…Éåp½A…Á•ÉÍp¼¸­p¹µ¼¹Ñ•ÍÐ¡Á…Ñ ¤€˜˜€½ym„µ˜À´åuìØÑô½¤¹Ñ•ÍÐ¡‘•Ñ…¥±Ì¹¡…Í ñð€ˆˆ¤€˜˜ÑåÁ•½˜‘•Ñ…¥±Ì¹Ñ•áÐ€ôôô€‰ÍÑÉ¥¹œˆ€˜˜‘•Ñ…¥±Ì¹Ñ•áÐ¹ÑÉ¥´ ¤€˜˜9Õµ‰•È¹¥Í%¹Ñ••È¡‘•Ñ…¥±Ì¹ÍÑ…ÉÑ1¥¹”¤€˜˜‘•Ñ…¥±Ì¹•¹‘1¥¹”€øô‘•Ñ…¥±Ì¹ÍÑ…ÉÑ1¥¹”¤ì(€€€€€€€€€½¹ÍÐ½¹™¥œ€ô…Ý…¥Ð±½…‘]½É­ÍÁ…•½¹™¥œÌ¡Ý¤ì(€€€€€€€€€¥˜€¡½¹™¥œ¹½‰Í¥‘¥…¹Y…Õ±Ð¤(€€€€€€€€€€€±•‘•È¡Ý°ÉÕ¹¥È¤¹É•…‘Ì¹Í•Ð¡Á…Ñ °ì(€€€€€€€€€€€€€¡…Í è‘•Ñ…¥±Ì¹¡…Í °(€€€€€€€€€€€€€Ñ•áÐè‘•Ñ…¥±Ì¹Ñ•áÐ°(€€€€€€€€€€€€€Ù…Õ±ÐèÉ•…‘	¥¹‘¥¹œ€üÉ•…‘	¥¹‘¥¹œ¹Ù…Õ±Ð€è…Ý…¥ÐÉ•…±Á…Ñ Ô¡½¹™¥œ¹½‰Í¥‘¥…¹Y…Õ±Ð¤°(€€€€€€€€€€€€€É•Ù¥Í¥½¸èÉ•…‘	¥¹‘¥¹œ€üÉ•…‘	¥¹‘¥¹œ¹É•Ù¥Í¥½¸€è½¹™¥œ¹­¹½Ý±•‘•	¥¹‘¥¹I•Ù¥Í¥½¸ñð€À°(€€€€€€€€€€€€€ÍÑ…ÉÑ1¥¹”è‘•Ñ…¥±Ì¹ÍÑ…ÉÑ1¥¹”°(€€€€€€€€€€€€€•¹‘1¥¹”è‘•Ñ…¥±Ì¹•¹‘1¥¹”(€€€€€€€€€€€ô¤ì(€€€€€€€ô(€€€€€€€½¹ÍÐ¥¹ÍÁ•Ñ•€ô…Ý…¥ÐÕÁ‘…Ñ•I•Í•…É¡1½½À¡ì(€€€€€€€€€Ý°(€€€€€€€€€ÉÕ¹¥È°(€€€€€€€€€…Ñ¥½¸è€‰¥¹ÍÁ•Ñ}Í½ÕÉ•Ìˆ°(€€€€€€€€€Í½ÕÉ•I•™ÌèmÁ…Ñ¡t(€€€€€€€ô¤ì(€€€€€€€¥˜€ ¡…Ý…¥ÐÉ•ÕÍ…‰±•M½ÕÉ•Ì¡Ý°ÉÕ¹¥È¤¤¹±•¹Ñ ¤(€€€€€€€€€É•ÑÕÉ¸…Ý…¥ÐÕÁ‘…Ñ•I•Í•…É¡1½½À¡ìÝ°ÉÕ¹¥È°…Ñ¥½¸è€‰Ù•É¥™å}…É¡¥Ù”ˆô¤ì(€€€€€€€É•ÑÕÉ¸¥¹ÍÁ•Ñ•ì(€€€€€ô(€€€€€¥˜€¡Ñ½½±9…µ”€ôôô€‰É•…ˆ¤ì(€€€€€€€½¹ÍÐÁ…Ñ €ôMÑÉ¥¹œ¡…ÉÌ¹Á…Ñ ñð‘•Ñ…¥±Ì¹Á…Ñ ñð€ˆˆ¤ì(€€€€€€€¥˜€ …Á…Ñ ñð‘•Ñ…¥±Ì¹µ¥ÍÍ¥¹œ€ôôôÑÉÕ”¤É•ÑÕÉ¸¹Õ±°ì(€€€€€€€½¹ÍÐ…É¡¥Ù•€ô…Ý…¥ÐÉ•½É‘É¡¥Ù•‘I•…¡Ý°ÉÕ¹¥È°Á…Ñ °…ÉÌ°‘•Ñ…¥±Ì°½¹Ñ•¹Ð¤ì(€€€€€€€¥˜€ ……É¡¥Ù•¤É•ÑÕÉ¸¹Õ±°ì(€€€€€€€…Ý…¥Ð•¹ÍÕÉ•MÑ…” (€€€€€€€€€Ý°(€€€€€€€€€ÉÕ¹¥È°(€€€€€€€€€€‰±½…±}ÅÕ•Éå}É•½É‘•ˆ°(€€€€€€€€€€ ¤€ôøÕÁ‘…Ñ•I•Í•…É¡1½½À¡ìÝ°ÉÕ¹¥È°…Ñ¥½¸è€‰É•½É‘}±½…°ˆ°ÅÕ•ÉäèÁ…Ñ ô¤(€€€€€€€€¤ì(€€€€€€€…Ý…¥Ð•¹ÍÕÉ•MÑ…” (€€€€€€€€€Ý°(€€€€€€€€€ÉÕ¹¥È°(€€€€€€€€€€‰•áÑ•É¹…±}Í•…É¡}É•½É‘•ˆ°(€€€€€€€€€€ ¤€ôøÕÁ‘…Ñ•I•Í•…É¡1½½À¡ì(€€€€€€€€€€€Ý°(€€€€€€€€€€€ÉÕ¹¥È°(€€€€€€€€€€€…Ñ¥½¸è€‰É•½É‘}•áÑ•É¹…°ˆ°(€€€€€€€€€€€¹½Ñ•Ìè€‰!½ÍÐÉ•½É‘•„É•…½˜Ñ¡”…É¡¥Ù•ÉÕ¸Í½ÕÉ”¸ˆ(€€€€€€€€€ô¤(€€€€€€€€¤ì(€€€€€€€É•ÑÕÉ¸ÕÁ‘…Ñ•I•Í•…É¡1½½À¡ìÝ°ÉÕ¹¥È°…Ñ¥½¸è€‰¥¹ÍÁ•Ñ}Í½ÕÉ•Ìˆ°Í½ÕÉ•I•™ÌèmÁ…Ñ¡tô¤ì(€€€€€ô(€€€€€¥˜€¡Ñ½½±9…µ”€ôôô€‰É•Í•…É¡}Ù•É¥™å}±¥Ñ•É…ÑÕÉ”ˆ€˜˜‘•Ñ…¥±Ì¹ÍÑ…ÑÕÌ€ôôô€‰‰½Ñ µÙ•É¥™¥•ˆ€˜˜‘•Ñ…¥±Ì¹½‰Í¥‘¥…¸ü¹ÍÑ…ÑÕÌ€ôôô€‰Ù•É¥™¥•ˆ€˜˜‘•Ñ…¥±Ì¹é½Ñ•É¼ü¹ÍÑ…ÑÕÌ€ôôô€‰Ù•É¥™¥•ˆ¤ì(€€€€€€€½¹ÍÐÁ…Ñ €ô‘•Ñ…¥±Ì¹½‰Í¥‘¥…¸¹Á…Ñ ì(€€€€€€€¥˜€ „½y1¥‰É…Éåp½A…Á•ÉÍp¼¸­p¹µ¼¹Ñ•ÍÐ¡Á…Ñ ñð€ˆˆ¤¤É•ÑÕÉ¸¹Õ±°ì(€€€€€€€±•‘•È¡Ý°ÉÕ¹¥È¤¹Ù•É¥™¥•¹Í•Ð¡Á…Ñ °ÍÑÉÕÑÕÉ•‘±½¹”¡‘•Ñ…¥±Ì¤¤ì(€€€€€€€¥˜€ ¡…Ý…¥ÐÉ•ÕÍ…‰±•M½ÕÉ•Ì¡Ý°ÉÕ¹¥È¤¤¹±•¹Ñ ¤(€€€€€€€€€É•ÑÕÉ¸…Ý…¥ÐÕÁ‘…Ñ•I•Í•…É¡1½½À¡ìÝ°ÉÕ¹¥È°…Ñ¥½¸è€‰Ù•É¥™å}…É¡¥Ù”ˆô¤ì(€€€€€€€É•ÑÕÉ¸¹Õ±°ì(€€€€€ô(€€€€€¥˜€¡Ñ½½±9…µ”€ôôô€‰É•Í•…É¡}…É¡¥Ù•}Í½ÕÉ”ˆ€˜˜‘•Ñ…¥±Ì¹ÍÑ…ÑÕÌ€ôôô€‰‘½Ý¹±½…‘•ˆ¤ì(€€€€€€€½¹ÍÐÉ•˜€ôMÑÉ¥¹œ¡‘•Ñ…¥±Ì¹Á…Ñ ñð‘•Ñ…¥±Ì¹ÕÉ°ñð…ÉÌ¹ÕÉ°ñð€ˆˆ¤ì(€€€€€€€¥˜€ …É•˜¤É•ÑÕÉ¸¹Õ±°ì(€€€€€€€…Ý…¥Ð•¹ÍÕÉ•MÑ…” (€€€€€€€€€Ý°(€€€€€€€€€ÉÕ¹¥È°(€€€€€€€€€€‰±½…±}ÅÕ•Éå}É•½É‘•ˆ°(€€€€€€€€€€ ¤€ôøÕÁ‘…Ñ•I•Í•…É¡1½½À¡ìÝ°ÉÕ¹¥È°…Ñ¥½¸è€‰É•½É‘}±½…°ˆ°ÅÕ•ÉäèÉ•˜ô¤(€€€€€€€€¤ì(€€€€€€€…Ý…¥Ð•¹ÍÕÉ•MÑ…” (€€€€€€€€€Ý°(€€€€€€€€€ÉÕ¹¥È°(€€€€€€€€€€‰•áÑ•É¹…±}Í•…É¡}É•½É‘•ˆ°(€€€€€€€€€€ ¤€ôøÕÁ‘…Ñ•I•Í•…É¡1½½À¡ì(€€€€€€€€€€€Ý°(€€€€€€€€€€€ÉÕ¹¥È°(€€€€€€€€€€€…Ñ¥½¸è€‰É•½É‘}•áÑ•É¹…°ˆ°(€€€€€€€€€€€ÅÕ•ÉäèMÑÉ¥¹œ¡…ÉÌ¹ÕÉ°ñð‘•Ñ…¥±Ì¹ÕÉ°ñðÉ•˜¤°(€€€€€€€€€€€¹½Ñ•Ìè€‰!½ÍÐÉ•½É‘•Ñ¡”…É¡¥Ù•Í½ÕÉ”UI0…ÌÑ¡”•áÑ•É¹…°±½½­ÕÀ¸ˆ(€€€€€€€€€ô¤(€€€€€€€€¤ì(€€€€€€€…Ý…¥ÐÕÁ‘…Ñ•I•Í•…É¡1½½À¡ìÝ°ÉÕ¹¥È°…Ñ¥½¸è€‰¥¹ÍÁ•Ñ}Í½ÕÉ•Ìˆ°Í½ÕÉ•I•™ÌèmÉ•™tô¤ì(€€€€€€€½¹ÍÐ…É¡¥Ù•€ô…Ý…¥ÐÕÁ‘…Ñ•I•Í•…É¡1½½À¡ìÝ°ÉÕ¹¥È°…Ñ¥½¸è€‰Ù•É¥™å}…É¡¥Ù”ˆô¤ì(€€€€€€€É•ÑÕÉ¸…É¡¥Ù•ì(€€€€€ô(€€€€€¥˜€¡Ñ½½±9…µ”€ôôô€‰É•Í•…É¡}‘•Á½Í¥Ñ}­¹½Ý±•‘”ˆ€˜˜‘•Ñ…¥±Ì¹ÑåÁ”€ôôô€‰±…¥´ˆ€˜˜‘•Ñ…¥±Ì¹¹½Ñ”¤É•ÑÕÉ¸¹Õ±°ì(€€€€€É•ÑÕÉ¸¹Õ±°ì(€€€ô…Ñ ì(€€€€€É•ÑÕÉ¸¹Õ±°ì(€€€ô(€ô(€É•ÑÕÉ¸ì(€€€ÍÑ…ÉÑI•Í•…É¡IÕ¸°(€€€ÕÁ‘…Ñ•I•Í•…É¡1½½À°(€€€½µÁ±•Ñ•I•Í•…É¡…Ñ”°(€€€½‰Í•ÉÙ•I•Í•…É¡I••¥ÁÐ°(€€€™±ÕÍ¡I•Í•…É¡I••¥ÁÑÌ°(€€€É•Í•ÑI•Í•…É¡I••¥ÁÑÌ°(€€€Ñ½Á¥%‘É½µI•ÍÕ±ÑM±Õœ°(€€€‘¥ÍÁ½Í”è€ ¤€ôøÉÕ¹Ñ¥µ•MÑ…Ñ”Ì¹‘¥ÍÁ½Í” ¤(€ôì)ô((¼¼Á…­…•Ì½•áÑ•¹Í¥½¹Ì½ÍÉŒ½¥¹Ñ•É¹…°½½‰Í¥‘¥…¸µÝ½É­‰•¹ ¹ÑÌ)¥µÁ½ÉÐìÉ•…Ñ•!…Í …ÌÉ•…Ñ•!…Í ÄÀ°É…¹‘½µUU%…ÌÉ…¹‘½µUU%äô™É½´€‰¹½‘”éÉåÁÑ¼ˆì)¥µÁ½ÉÐì…•ÍÌ…Ì…•ÍÌÐ°µ­‘¥È…Ìµ­‘¥ÈÜ°É•…‘‘¥È…ÌÉ•…‘‘¥ÈÌ°É•…‘¥±”…ÌÉ•…‘¥±”ÄÀ°É•…±Á…Ñ …ÌÉ•…±Á…Ñ à°É•¹…µ”…ÌÉ•¹…µ”à°ÍÑ…Ð…ÌÍÑ…ÐÐ°ÝÉ¥Ñ•¥±”…ÌÝÉ¥Ñ•¥±”àô™É½´€‰¹½‘”é™Ì½ÁÉ½µ¥Í•Ìˆì)¥µÁ½ÉÐì‰…Í•¹…µ”…Ì‰…Í•¹…µ”Ô°‘¥É¹…µ”…Ì‘¥É¹…µ”Ü°¥Í‰Í½±ÕÑ”…Ì¥Í‰Í½±ÕÑ”ÄÄ°©½¥¸…Ì©½¥¸ÄÐ°É•±…Ñ¥Ù”…ÌÉ•±…Ñ¥Ù”ÄÀ°É•Í½±Ù”…ÌÉ•Í½±Ù”ÄÌ°Í•À…ÌÍ•Àäô™É½´€‰¹½‘”éÁ…Ñ ˆì)¥µÁ½ÉÐì™¥±•UI1Q½A…Ñ …Ì™¥±•UI1Q½A…Ñ È°Á…Ñ¡Q½¥±•UI0…ÌÁ…Ñ¡Q½¥±•UI0Èô™É½´€‰¹½‘”éÕÉ°ˆì((¼¼Á…­…•Ì½•áÑ•¹Í¥½¹Ì½ÍÉŒ½Ý½É­ÍÁ…”µ½¹™¥œ¹ÑÌ)¥µÁ½ÉÐì…•ÍÌ…Ì…•ÍÌÌ°µ­‘¥È…Ìµ­‘¥ÈÐ°É•…‘¥±”…ÌÉ•…‘¥±”Ü°É•…±Á…Ñ …ÌÉ•…±Á…Ñ Ø°É•¹…µ”…ÌÉ•¹…µ”Ô°ÝÉ¥Ñ•¥±”…ÌÝÉ¥Ñ•¥±”Ôô™É½´€‰¹½‘”é™Ì½ÁÉ½µ¥Í•Ìˆì)¥µÁ½ÉÐì‘¥É¹…µ”…Ì‘¥É¹…µ”Ì°¥Í‰Í½±ÕÑ”…Ì¥Í‰Í½±ÕÑ”Ü°©½¥¸…Ì©½¥¸Ø°É•±…Ñ¥Ù”…ÌÉ•±…Ñ¥Ù”Ø°É•Í½±Ù”…ÌÉ•Í½±Ù”à°Í•À…ÌÍ•ÀØô™É½´€‰¹½‘”éÁ…Ñ ˆì)¥¹¥Ñ}½¹™¥œ ¤ì)¥¹¥Ñ}™±½Ý}…É‘Ì ¤ì((¼¼Á…­…•Ì½•áÑ•¹Í¥½¹Ì½ÍÉŒ½¥¹Ñ•É¹…°½Ù…Õ±Ð¹ÑÌ)Ù…ÈYU1Q}AI=%1L€ôì(€ÁÉ½©•Ðèì(€€€¥è€‰ÁÉ½©•Ðˆ°(€€€ÁÉ½©•ÑQåÁ•Ìèl(€€€€€€‰EÕ•ÍÑ¥½¹Ìˆ°(€€€€€€‰½¹•ÁÑÌˆ°(€€€€€€‰¹Ñ¥Ñ¥•Ìˆ°(€€€€€€‰A…Á•ÉÌˆ°(€€€€€€‰M½ÕÉ•Ìˆ°(€€€€€€‰Ù¥‘•¹”ˆ°(€€€€€€‰±…¥µÌˆ°(€€€€€€‰•¥Í¥½¹Ìˆ°(€€€€€€‰IÕ¹Ìˆ°(€€€€€€‰ÉÑ¥™…ÑÌˆ°(€€€€€€‰]¥­¤ˆ(€€€t°(€€€±¥‰É…ÉåQåÁ•Ìèl‰A…Á•ÉÌˆ°€‰5•Ñ¡½‘Ìˆ°€‰M½™ÑÝ…É”ˆ°€‰%‘•…Ìˆ°€‰…Ñ…Í•ÑÌˆ°€‰áÁ±…¥¹•ÉÌ‰t(€ô°(€±¥Ñ•É…ÑÕÉ”èì(€€€¥è€‰±¥Ñ•É…ÑÕÉ”ˆ°(€€€ÁÉ½©•ÑQåÁ•Ìèl‰EÕ•ÍÑ¥½¹Ìˆ°€‰A…Á•ÉÌˆ°€‰Ù¥‘•¹”ˆ°€‰±…¥µÌˆ°€‰IÕ¹Ìˆ°€‰]¥­¤‰t°(€€€±¥‰É…ÉåQåÁ•Ìèl‰A…Á•ÉÌˆ°€‰5•Ñ¡½‘Ìˆ°€‰½¹•ÁÑÌˆ°€‰M½™ÑÝ…É”ˆ°€‰¹Ñ¥Ñ¥•Ìˆ°€‰%‘•…Ìˆ°€‰…Ñ…Í•ÑÌˆ°€‰áÁ±…¥¹•ÉÌ‰t(€ô°(€¡å‰É¥èì(€€€¥è€‰¡å‰É¥ˆ°(€€€ÁÉ½©•ÑQåÁ•Ìèl(€€€€€€‰EÕ•ÍÑ¥½¹Ìˆ°(€€€€€€‰½¹•ÁÑÌˆ°(€€€€€€‰¹Ñ¥Ñ¥•Ìˆ°(€€€€€€‰A…Á•ÉÌˆ°(€€€€€€‰M½ÕÉ•Ìˆ°(€€€€€€‰Ù¥‘•¹”ˆ°(€€€€€€‰±…¥µÌˆ°(€€€€€€‰•¥Í¥½¹Ìˆ°(€€€€€€‰IÕ¹Ìˆ°(€€€€€€‰ÉÑ¥™…ÑÌˆ°(€€€€€€‰]¥­¤ˆ(€€€t°(€€€±¥‰É…ÉåQåÁ•Ìèl‰A…Á•ÉÌˆ°€‰5•Ñ¡½‘Ìˆ°€‰½¹•ÁÑÌˆ°€‰M½™ÑÝ…É”ˆ°€‰¹Ñ¥Ñ¥•Ìˆ°€‰%‘•…Ìˆ°€‰…Ñ…Í•ÑÌˆ°€‰áÁ±…¥¹•ÉÌ‰t(€ô)ôì)Ù…ÈU1Q}YU1Q}AI=%1€ô€‰¡å‰É¥ˆì)Ù…ÈMU	9Q}5A}A=1%%L€ôl‰¹½¹”ˆ°€‰É•…µ±½…°‰tì)™Õ¹Ñ¥½¸•ÑY…Õ±ÑAÉ½™¥±”¡¥€ôU1Q}YU1Q}AI=%1¤ì(€¥˜€¡ÑåÁ•½˜¥€„ôô€‰ÍÑÉ¥¹œˆñð€„¡¥¥¸YU1Q}AI=%1L¤¤Ñ¡É½Ü¹•ÜÉÉ½È¡U¹­¹½Ý¸­¹½Ý±•‘”ÁÉ½™¥±”è€‘í¥‘õ€¤ì(€É•ÑÕÉ¸YU1Q}AI=%1Mm¥‘tì)ô((¼¼Á…­…•Ì½•áÑ•¹Í¥½¹Ì½ÍÉŒ½É•Í•…É µÁ½±¥ä¹ÑÌ)Ù…È5a}=9UII9Q}IMI!}MU	9QL€ô€Ìì((¼¼Á…­…•Ì½•áÑ•¹Í¥½¹Ì½ÍÉŒ½Ý½É­ÍÁ…”µ½¹™¥œ¹ÑÌ)Ù…ÈU1Q}]=I-MA}=9%€ô=‰©•Ð¹™É••é”¡ì(€É•ÍÕ±ÑÍI½½Ðè€ˆ¸½É•ÍÕ±ÑÌˆ°(€½‰Í¥‘¥…¹Y…Õ±Ðè¹Õ±°°(€€¼¼-••ÀÑ¡”½µÁ…Ñ¥‰¥±¥Ñä™¥•±‘ÌÁÉ•Í•¹Ð¥¸•Ù•ÉäÉ•ÑÕÉ¹•Í¡…Á”¸Q¡”(€€¼¼±•…ä=‰Í¥‘¥…¸…‘…ÁÑ•ÈÉ•…‘ÌÑ¡•Í”™¥•±‘Ì•Ù•¸Ý¡•¸¹¼‘•Í­Ñ½À‰¥¹‘¥¹œ(€€¼¼¡…Ì‰••¸•ÍÑ…‰±¥Í¡•å•Ð¸(€Ù…Õ±Ñ]É¥Ñ•A½±¥äè¹Õ±°°(€µÁMÑ…ÑÕÌè¹Õ±°°(€­¹½Ý±•‘•M½Á”è€‰ÁÉ½©•Ðˆ°(€­¹½Ý±•‘•AÉ½©•Ñ%è¹Õ±°°(€­¹½Ý±•‘•	¥¹‘¥¹I•Ù¥Í¥½¸è€À°(€±•…åAÉ½©•ÑY…Õ±Ðè¹Õ±°°(€µ…á½¹ÕÉÉ•¹ÑMÕ‰…•¹ÑÌè5a}=9UII9Q}IMI!}MU	9QL°(€Ñ¥µ•é½¹”è€‰Í¥„½M¡…¹¡…¤ˆ°(€­¹½Ý±•‘•AÉ½™¥±”èU1Q}YU1Q}AI=%1°(€­¹½Ý±•‘••Á½Í¥Ñ5½‘”è€‰Ù•É¥™¥•ˆ°(€ÍÕ‰…•¹Ñ5ÁA½±¥äè€‰É•…µ±½…°ˆ)ô¤ì)Ù…È=9%}95€ô€ˆ¹Á¤½É•Í•…É µÝ½É­ÍÁ…”¹©Í½¸ˆì)™Õ¹Ñ¥½¸½¹™¥A…Ñ ¡Ý¤ì(€É•ÑÕÉ¸©½¥¸Ø¡Ý°=9%}95¤ì)ô)™Õ¹Ñ¥½¸É•Í½±Ù•½¹™¥ÕÉ•‘A…Ñ ¡Ý°Ù…±Õ”¤ì(€¥˜€¡Ù…±Õ”€ôô¹Õ±°ñðÙ…±Õ”€ôôô€ˆˆ¤É•ÑÕÉ¸¹Õ±°ì(€É•ÑÕÉ¸É•Í½±Ù”à¡Ý°Ù…±Õ”¤ì)ô)™Õ¹Ñ¥½¸Ù…±¥‘…Ñ•A…Ñ ¡½¹™¥œ¤ì(€½¹ÍÐµ…à€ô9Õµ‰•È¡½¹™¥œ¹µ…á½¹ÕÉÉ•¹ÑMÕ‰…•¹ÑÌ¤ì(€¥˜€ …9Õµ‰•È¹¥Í%¹Ñ••È¡µ…à¤ñðµ…à€ð€Äñðµ…à€ø5a}=9UII9Q}IMI!}MU	9QL¤ì(€€€Ñ¡É½Ü¹•ÜÉÉ½È (€€€€€µ…á½¹ÕÉÉ•¹ÑMÕ‰…•¹ÑÌµÕÍÐ‰”…¸¥¹Ñ••È‰•ÑÝ••¸€Ä…¹€‘í5a}=9UII9Q}IMI!}MU	9QMõ€(€€€€¤ì(€ô(€¥˜€¡ÑåÁ•½˜½¹™¥œ¹Ñ¥µ•é½¹”€„ôô€‰ÍÑÉ¥¹œˆñð€…½¹™¥œ¹Ñ¥µ•é½¹”¹ÑÉ¥´ ¤¤ì(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰Ñ¥µ•é½¹”µÕÍÐ‰”„¹½¸µ•µÁÑäÍÑÉ¥¹œˆ¤ì(€ô(€¥˜€¡ÑåÁ•½˜½¹™¥œ¹É•ÍÕ±ÑÍI½½Ð€„ôô€‰ÍÑÉ¥¹œˆñð€…½¹™¥œ¹É•ÍÕ±ÑÍI½½Ð¹ÑÉ¥´ ¤¤ì(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰É•ÍÕ±ÑÍI½½ÐµÕÍÐ‰”„¹½¸µ•µÁÑäÁ…Ñ ˆ¤ì(€ô(€•ÑY…Õ±ÑAÉ½™¥±”¡½¹™¥œ¹­¹½Ý±•‘•AÉ½™¥±”¤ì(€¥˜€ …l‰ÉÕ¸µ½¹±äˆ°€‰Ù•É¥™¥•ˆ°€‰É¥ ‰t¹¥¹±Õ‘•Ì¡½¹™¥œ¹­¹½Ý±•‘••Á½Í¥Ñ5½‘”¤¤ì(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰­¹½Ý±•‘••Á½Í¥Ñ5½‘”µÕÍÐ‰”ÉÕ¸µ½¹±ä°Ù•É¥™¥•°½ÈÉ¥ ˆ¤ì(€ô(€¥˜€ …MU	9Q}5A}A=1%%L¹¥¹±Õ‘•Ì¡½¹™¥œ¹ÍÕ‰…•¹Ñ5ÁA½±¥ä¤¤ì(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰ÍÕ‰…•¹Ñ5ÁA½±¥äµÕÍÐ‰”¹½¹”½ÈÉ•…µ±½…°ˆ¤ì(€ô)ô)…Íå¹Œ™Õ¹Ñ¥½¸±½…‘]½É­ÍÁ…•½¹™¥œ¡Ý€ôÁÉ½•ÍÌ¹Ý ¤¤ì(€¥˜€¡ÁÉ½•ÍÌ¹•¹Ø¹A%}IMI!}M-Q=A}=9%¤ì(€€€½¹ÍÐ‘•Í­Ñ½À€ô)M=8¹Á…ÉÍ”¡…Ý…¥ÐÉ•…‘¥±”Ü¡ÁÉ½•ÍÌ¹•¹Ø¹A%}IMI!}M-Q=A}=9%°€‰ÕÑ˜àˆ¤¤ì(€€€É•ÑÕÉ¸ì(€€€€€€¸¸¹U1Q}]=I-MA}=9%°(€€€€€É•ÍÕ±ÑÍI½½Ðè‘•Í­Ñ½À¹É•ÍÕ±ÑÍI½½Ð°(€€€€€½‰Í¥‘¥…¹Y…Õ±Ðè‘•Í­Ñ½À¹Ù…Õ±ÑMÑ…ÑÕÌ€ôôô€‰‰½Õ¹ˆ€ü‘•Í­Ñ½À¹½‰Í¥‘¥…¹Y…Õ±Ð€è¹Õ±°°(€€€€€Ù…Õ±Ñ]É¥Ñ•A½±¥äè‘•Í­Ñ½À¹Ù…Õ±Ñ]É¥Ñ•A½±¥ä°(€€€€€µÁMÑ…ÑÕÌè‘•Í­Ñ½À¹µÁMÑ…ÑÕÌ(€€€ôì(€ô(€½¹ÍÐÁÉ½©•ÑI½½Ð€ôÉ•Í½±Ù”à¡Ý¤ì(€±•ÐÉ…Ü€ôíôì(€ÑÉäì(€€€É…Ü€ô)M=8¹Á…ÉÍ”¡…Ý…¥ÐÉ•…‘¥±”Ü¡½¹™¥A…Ñ ¡ÁÉ½©•ÑI½½Ð¤°€‰ÕÑ˜àˆ¤¤ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€¥˜€¡•ÉÉ½È¹½‘”€„ôô€‰9=9Pˆ¤É…Ü€ôíôì(€ô(€½¹ÍÐµ•É•€ôì€¸¸¹U1Q}]=I-MA}=9%°€¸¸¹É…Üôì(€¥˜€¡­¹½Ý±•‘•¥É•Ñ½Éä ¤¤ì(€€€½¹ÍÐ‰¥¹‘¥¹œ€ô…Ý…¥ÐÉ•…‘-¹½Ý±•‘•	¥¹‘¥¹œ ¤ì(€€€É•ÑÕÉ¸ì(€€€€€€¸¸¹U1Q}]=I-MA}=9%°(€€€€€É•ÍÕ±ÑÍI½½ÐèÉ•Í½±Ù•½¹™¥ÕÉ•‘A…Ñ  (€€€€€€€ÁÉ½©•ÑI½½Ð°(€€€€€€€ÑåÁ•½˜É…Ü¹É•ÍÕ±ÑÍI½½Ð€ôôô€‰ÍÑÉ¥¹œˆ€˜˜É…Ü¹É•ÍÕ±ÑÍI½½Ð¹ÑÉ¥´ ¤€üÉ…Ü¹É•ÍÕ±ÑÍI½½Ð€èU1Q}]=I-MA}=9%¹É•ÍÕ±ÑÍI½½Ð(€€€€€€¤°(€€€€€½‰Í¥‘¥…¹Y…Õ±Ðè‰¥¹‘¥¹œü¹Ù…Õ±Ðñð¹Õ±°°(€€€€€­¹½Ý±•‘•AÉ½™¥±”è‰¥¹‘¥¹œü¹ÁÉ½™¥±”ñð€‰¡å‰É¥ˆ°(€€€€€­¹½Ý±•‘••Á½Í¥Ñ5½‘”è‰¥¹‘¥¹œü¹‘•Á½Í¥Ñ5½‘”ñð€‰Ù•É¥™¥•ˆ°(€€€€€ÍÕ‰…•¹Ñ5ÁA½±¥äè‰¥¹‘¥¹œü¹ÍÕ‰…•¹ÑA½±¥äñð€‰¹½¹”ˆ°(€€€€€­¹½Ý±•‘•M½Á”è€‰…ÁÁ±¥…Ñ¥½¸ˆ°(€€€€€­¹½Ý±•‘•AÉ½©•Ñ%èÁÉ½©•Ñ%‘•¹Ñ¥Ñä¡ÁÉ½©•ÑI½½Ð°É…Ü¹­¹½Ý±•‘•AÉ½©•Ñ%¤°(€€€€€­¹½Ý±•‘•	¥¹‘¥¹I•Ù¥Í¥½¸è‰¥¹‘¥¹œü¹É•Ù¥Í¥½¸ñð€À°(€€€€€±•…åAÉ½©•ÑY…Õ±ÐèÉ…Ü¹½‰Í¥‘¥…¹Y…Õ±Ðñð¹Õ±°°(€€€€€µ…á½¹ÕÉÉ•¹ÑMÕ‰…•¹ÑÌèlÄ°€È°€Ít¹¥¹±Õ‘•Ì¡É…Ü¹µ…á½¹ÕÉÉ•¹ÑMÕ‰…•¹ÑÌ¤€üÉ…Ü¹µ…á½¹ÕÉÉ•¹ÑMÕ‰…•¹ÑÌ€èU1Q}]=I-MA}=9%¹µ…á½¹ÕÉÉ•¹ÑMÕ‰…•¹ÑÌ(€€€ôì(€ô(€ÑÉäì(€€€Ù…±¥‘…Ñ•A…Ñ ¡µ•É•¤ì(€ô…Ñ ì(€€€É•ÑÕÉ¸ì(€€€€€€¸¸¹U1Q}]=I-MA}=9%°(€€€€€É•ÍÕ±ÑÍI½½ÐèÉ•Í½±Ù•½¹™¥ÕÉ•‘A…Ñ ¡ÁÉ½©•ÑI½½Ð°U1Q}]=I-MA}=9%¹É•ÍÕ±ÑÍI½½Ð¤°(€€€€€½‰Í¥‘¥…¹Y…Õ±Ðè¹Õ±°(€€€ôì(€ô(€É•ÑÕÉ¸ì(€€€€¸¸¹µ•É•°(€€€É•ÍÕ±ÑÍI½½ÐèÉ•Í½±Ù•½¹™¥ÕÉ•‘A…Ñ ¡ÁÉ½©•ÑI½½Ð°µ•É•¹É•ÍÕ±ÑÍI½½Ð¤°(€€€½‰Í¥‘¥…¹Y…Õ±ÐèÉ•Í½±Ù•½¹™¥ÕÉ•‘A…Ñ ¡ÁÉ½©•ÑI½½Ð°µ•É•¹½‰Í¥‘¥…¹Y…Õ±Ð¤(€ôì)ô((¼¼Á…­…•Ì½•áÑ•¹Í¥½¹Ì½ÍÉŒ½¥¹Ñ•É¹…°½­¹½Ý±•‘”µÉÕ¹Ñ¥µ”¹ÑÌ)¥¹¥Ñ}ÉÕ¹Ñ¥µ•}¡½ÍÐ ¤ì)¥µÁ½ÉÐì]½É­•Èô™É½´€‰¹½‘”éÝ½É­•É}Ñ¡É•…‘Ìˆì)¥µÁ½ÉÐì•á¥ÍÑÍMå¹Œô™É½´€‰¹½‘”é™Ìˆì)¥µÁ½ÉÐì™¥±•UI1Q½A…Ñ °Á…Ñ¡Q½¥±•UI0ô™É½´€‰¹½‘”éÕÉ°ˆì)¥µÁ½ÉÐì‘¥É¹…µ”…Ì‘¥É¹…µ”Ð°É•Í½±Ù”…ÌÉ•Í½±Ù”äô™É½´€‰¹½‘”éÁ…Ñ ˆì)Ù…È½¹™¥ÕÉ•€ô™…±Í”ì)™Õ¹Ñ¥½¸½¹™¥ÕÉ•-¹½Ý±•‘•áÑ•¹Í¥½¹IÕ¹Ñ¥µ” ¤ì(€¥˜€¡½¹™¥ÕÉ•¤É•ÑÕÉ¸ì(€½¹™¥ÕÉ•€ôÑÉÕ”ì(€½¹™¥ÕÉ•-¹½Ý±•‘•IÕ¹Ñ¥µ”¡ì(€€€ÉÕ¹IÕ¹Ñ¥µ•á±ÕÍ¥Ù”°(€€€ÉÕ¹Ñ¥µ•M±½Ð°(€€€Ñ½½±5•Ñ„°(€€€™±½Ý…É‘	Õ¥±‘•È°(€€€•µ¥ÑAÉ½•ÍÍÙ•¹Ðè€¡•Ù•¹Ð°Á…å±½…¤€ôøÁÉ½•ÍÌ¹•µ¥Ð¡•Ù•¹Ð°Á…å±½…¤(€ô¤ì(€½¹™¥ÕÉ•-¹½Ý±•‘•]½É­•È ¡}ÕÉ°°½ÁÑ¥½¹Ì¤€ôøì(€€€½¹ÍÐÍ¥‰±¥¹œ€ô¹•ÜUI0 ˆ¸¸½±¥ˆ½­¹½Ý±•‘”½ÉÕ¹Ñ¥µ”½Ý½É­•È¹µ©Ìˆ°¥µÁ½ÉÐ¹µ•Ñ„¹ÕÉ°¤ì(€€€½¹ÍÐÝ½É­•ÉUÉ°€ôÍ¥‰±¥¹œ¹ÁÉ½Ñ½½°€ôôô€‰™¥±”èˆ€˜˜€…•á¥ÍÑÍMå¹Œ¡™¥±•UI1Q½A…Ñ ¡Í¥‰±¥¹œ¤¤€üÁ…Ñ¡Q½¥±•UI0¡É•Í½±Ù”ä¡‘¥É¹…µ”Ð¡™¥±•UI1Q½A…Ñ ¡¥µÁ½ÉÐ¹µ•Ñ„¹ÕÉ°¤¤°€ˆ¸¸¼¸¸¼¸¸¼¸¸¼¹Á¤½±¥ˆ½­¹½Ý±•‘”½ÉÕ¹Ñ¥µ”½Ý½É­•È¹µ©Ìˆ¤¤€èÍ¥‰±¥¹œì(€€€É•ÑÕÉ¸¹•Ü]½É­•È¡Ý½É­•ÉUÉ°°½ÁÑ¥½¹Ì¤ì(€ô¤ì)ô((¼¼Á…­…•Ì½•áÑ•¹Í¥½¹Ì½ÍÉŒ½¥¹Ñ•É¹…°½½‰Í¥‘¥…¸µÍ•ÑÕÀ¹ÑÌ)¥µÁ½ÉÐìÉ•…‘‘¥È°É•…±Á…Ñ …ÌÉ•…±Á…Ñ Ü°ÍÑ…Ð…ÌÍÑ…ÐÌô™É½´€‰¹½‘”é™Ì½ÁÉ½µ¥Í•Ìˆì)¥µÁ½ÉÐì¡½µ•‘¥È…Ì¡½µ•‘¥ÈÈô™É½´€‰¹½‘”é½Ìˆì)¥µÁ½ÉÐì‰…Í•¹…µ”…Ì‰…Í•¹…µ”Ð°¥Í‰Í½±ÕÑ”…Ì¥Í‰Í½±ÕÑ”à°©½¥¸…Ì©½¥¸Ü°É•Í½±Ù”…ÌÉ•Í½±Ù”ÄÀô™É½´€‰¹½‘”éÁ…Ñ ˆì)Ù…È=	M%%9}MQUA}	%9%9€ô=‰©•Ð¹™É••é”¡ì(€½µµ…¹è€‰½‰Í¥‘¥…¸µÍ•ÑÕÀˆ°(€Í­¥±°è€‰É•Í•…É µÙ…Õ±Ðˆ°(€µÁM•ÉÙ•Èè€‰É•Í•…É µ½‰Í¥‘¥…¸ˆ°(€…±¥…Í•Ìè=‰©•Ð¹™É••é”¡l‰Í•ÑÕÀˆ°€‰É•Í•…É µÍ•ÑÕÀ‰t¤)ô¤ì)Ù…ÈM-%@€ô€¼¨}}AUI}|€¨¼¹•ÜM•Ð¡l‰¹½‘•}µ½‘Õ±•Ìˆ°€‰‘¥ÍÐˆ°€‰‰Õ¥±ˆ°€‰½ÕÐˆ°€‰½Ù•É…”ˆ°€‰Ù•¹‘½Èˆ°€‰Ù•¹Øˆ°€‰}}Áå…¡•}|‰t¤ì)Ù…ÈAI%YQ€ô€½x üéÍ•É•ÑÌýñÉ•‘•¹Ñ¥…±Ìýñ¥‘}ÉÍ…ñ¥‘}•ÈÔÔÄä¤ üél¹pµ}uð¤½¤ì)Ù…ÈII9€ô€½x üéÉ•…‘µ” üép¹mx¹t¬¤ýñ…•¹ÑÍp¹µ‘ñÁÉ½©•Ñp¹µ‘ñÁ…­…•p¹©Í½¹ñÁåÁÉ½©•Ñp¹Ñ½µ±ñ•¹Ù¥É½¹µ•¹Ñp¹å„ýµ±ñ‘•ÍÉ¥ÁÑ¥½¸¤½¤ì)™Õ¹Ñ¥½¸É•Í½±Ù•M•ÑÕÁY…Õ±Ð¡Ù…±Õ”°}Ý¤ì(€¥˜€¡ÑåÁ•½˜Ù…±Õ”€„ôô€‰ÍÑÉ¥¹œˆñð€…Ù…±Õ”¹ÑÉ¥´ ¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰Y…Õ±ÐÁ…Ñ ¥ÌÉ•ÅÕ¥É•ˆ¤ì(€½¹ÍÐÑ•áÐÌ€ôÙ…±Õ”¹ÑÉ¥´ ¤ì(€½¹ÍÐ•áÁ…¹‘•€ôÑ•áÐÌ€ôôô€‰øˆ€ü¡½µ•‘¥ÈÈ ¤€è€½yùl½qqt¼¹Ñ•ÍÐ¡Ñ•áÐÌ¤€ü©½¥¸Ü¡¡½µ•‘¥ÈÈ ¤°Ñ•áÐÌ¹Í±¥” È¤¤€èÑ•áÐÌì(€¥˜€¡¥Í‰Í½±ÕÑ”à¡•áÁ…¹‘•¤¤(€€€É•ÑÕÉ¸É•Í½±Ù”ÄÀ¡•áÁ…¹‘•¤ì(€½¹ÍÐ¹…ÑÕÉ…°€ôÑ•áÐÌ¹µ…Ñ  ¼ üë–r ¤ü üëš"Gžj¤ÿšZš†Œ üëšZ’îÛ–’ä¤ü üë’â/¦v‰ó’â-ó’â´¤ü üë–"o–îéóšZÃ–îè¤ü üë’â’â¨¤ü üë–>­ó–B7’âéó–B7žžÃ’âè¥qÌ©oŠpˆtü¡m{Štˆt¬ü¥oŠtˆtü üëžjžn»–öUóšZ’îÛ–’ä¤ýqÌ¨½¤¤ì(€¥˜€¡¹…ÑÕÉ…°ü¹lÅtü¹ÑÉ¥´ ¤¤(€€€É•ÑÕÉ¸É•Í½±Ù”ÄÀ¡©½¥¸Ü¡¡½µ•‘¥ÈÈ ¤°€‰½Õµ•¹ÑÌˆ°¹…ÑÕÉ…±lÅt¹ÑÉ¥´ ¤¤¤ì(€½¹ÍÐ•¹±¥Í €ôÑ•áÐÌ¹µ…Ñ  ¼ üéÉ•…Ñ•ñµ…­”¥qÌ¬ üé…qÌ¬¤ü üé™½±‘•Éñ‘¥É•Ñ½Éä¥qÌ¬ üé¹…µ•‘ñ…±±•¥qÌ­lˆtü¡mxˆt¬ü¥lˆtýqÌ¨½¤¤ì(€¥˜€¡•¹±¥Í ü¹lÅtü¹ÑÉ¥´ ¤¤(€€€É•ÑÕÉ¸É•Í½±Ù”ÄÀ¡©½¥¸Ü¡¡½µ•‘¥ÈÈ ¤°€‰½Õµ•¹ÑÌˆ°•¹±¥Í¡lÅt¹ÑÉ¥´ ¤¤¤ì(€Ñ¡É½Ü¹•ÜÉÉ½È ‰A±•…Í”ÁÉ½Ù¥‘”…¸…‰Í½±ÕÑ”Y…Õ±ÐÁ…Ñ €¡½Èø¼¸¸¸¤°½ÈÍ…äÑ¼É•…Ñ”„™½±‘•ÈÕ¹‘•È½Õµ•¹ÑÌˆ¤ì)ô)…Íå¹Œ™Õ¹Ñ¥½¸¥¹ÍÁ•ÑM•ÑÕÁ¥É•Ñ½Éä¡Á…Ñ °ìµ…á¹ÑÉ¥•Ì€ô€ÄÈÀ°µ…á•ÁÑ €ô€Èô€ôíô¤ì(€½¹ÍÐÉ•ÅÕ•ÍÑ•€ôÉ•Í½±Ù”ÄÀ¡Á…Ñ ¤ì(€±•ÐÉ½½Ðì(€ÑÉäì(€€€É½½Ð€ô…Ý…¥ÐÉ•…±Á…Ñ Ü¡É•ÅÕ•ÍÑ•¤ì(€€€¥˜€ „¡…Ý…¥ÐÍÑ…ÐÌ¡É½½Ð¤¤¹¥Í¥É•Ñ½Éä ¤¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È¡9½Ð„‘¥É•Ñ½Éäè€‘íÉ•ÅÕ•ÍÑ•‘õ€¤ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€¥˜€¡•ÉÉ½È¹½‘”€ôôô€‰9=9Pˆ¤(€€€€€É•ÑÕÉ¸ìÁ…Ñ èÉ•ÅÕ•ÍÑ•°•á¥ÍÑÌè™…±Í”°•¹ÑÉ¥•Ìèmt°É•™•É•¹•¥±•Ìèmt°ÑÉÕ¹…Ñ•è™…±Í”ôì(€€€Ñ¡É½Ü•ÉÉ½Èì(€ô(€½¹ÍÐ•¹ÑÉ¥•Ì€ômtì(€½¹ÍÐÅÕ•Õ”€ômìÁ…Ñ èÉ½½Ð°ÁÉ•™¥àè€ˆˆ°‘•ÁÑ è€Àõtì(€±•ÐÑÉÕ¹…Ñ•€ô™…±Í”ì(€Ý¡¥±”€¡ÅÕ•Õ”¹±•¹Ñ ¤ì(€€€½¹ÍÐÕÉÉ•¹Ð€ôÅÕ•Õ”¹Í¡¥™Ð ¤ì(€€€¥˜€¡•¹ÑÉ¥•Ì¹±•¹Ñ €øôµ…á¹ÑÉ¥•Ì¤ì(€€€€€ÑÉÕ¹…Ñ•€ôÑÉÕ”ì(€€€€€‰É•…¬ì(€€€ô(€€€½¹ÍÐ¡¥±‘É•¸€ô€¡…Ý…¥ÐÉ•…‘‘¥È¡ÕÉÉ•¹Ð¹Á…Ñ °ìÝ¥Ñ¡¥±•QåÁ•ÌèÑÉÕ”ô¤¤¹Í½ÉÐ ¡„°ˆ¤€ôø„¹¹…µ”¹±½…±•½µÁ…É”¡ˆ¹¹…µ”¤¤ì(€€€™½È€¡½¹ÍÐ¡¥±½˜¡¥±‘É•¸¤ì(€€€€€¥˜€¡¡¥±¹¹…µ”¹ÍÑ…ÉÑÍ]¥Ñ  ˆ¸ˆ¤ñðM-%@¹¡…Ì¡¡¥±¹¹…µ”¤ñðAI%YQ¹Ñ•ÍÐ¡¡¥±¹¹…µ”¤ñð¡¥±¹¥ÍMåµ‰½±¥1¥¹¬ ¤¤(€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€¥˜€ …¡¥±¹¥Í¥±” ¤€˜˜€…¡¥±¹¥Í¥É•Ñ½Éä ¤¤(€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€¥˜€¡•¹ÑÉ¥•Ì¹±•¹Ñ €øôµ…á¹ÑÉ¥•Ì¤ì(€€€€€€€ÑÉÕ¹…Ñ•€ôÑÉÕ”ì(€€€€€€€‰É•…¬ì(€€€€€ô(€€€€€½¹ÍÐÉ•±…Ñ¥Ù”ÄÈ€ôÕÉÉ•¹Ð¹ÁÉ•™¥à€ü€‘íÕÉÉ•¹Ð¹ÁÉ•™¥áô¼‘í¡¥±¹¹…µ•õ€€è¡¥±¹¹…µ”ì(€€€€€•¹ÑÉ¥•Ì¹ÁÕÍ ¡ìÁ…Ñ èÉ•±…Ñ¥Ù”ÄÈ°ÑåÁ”è¡¥±¹¥Í¥É•Ñ½Éä ¤€ü€‰‘¥É•Ñ½Éäˆ€è€‰™¥±”ˆô¤ì(€€€€€¥˜€¡¡¥±¹¥Í¥É•Ñ½Éä ¤¤ì(€€€€€€€¥˜€¡ÕÉÉ•¹Ð¹‘•ÁÑ €¬€Ä€ðµ…á•ÁÑ ¤(€€€€€€€€€ÅÕ•Õ”¹ÁÕÍ ¡ìÁ…Ñ è©½¥¸Ü¡ÕÉÉ•¹Ð¹Á…Ñ °¡¥±¹¹…µ”¤°ÁÉ•™¥àèÉ•±…Ñ¥Ù”ÄÈ°‘•ÁÑ èÕÉÉ•¹Ð¹‘•ÁÑ €¬€Äô¤ì(€€€€€€€•±Í”(€€€€€€€€€ÑÉÕ¹…Ñ•€ôÑÉÕ”ì(€€€€€ô(€€€ô(€ô(€É•ÑÕÉ¸ì(€€€Á…Ñ èÉ½½Ð°(€€€¹…µ”è‰…Í•¹…µ”Ð¡É½½Ð¤°(€€€•á¥ÍÑÌèÑÉÕ”°(€€€•¹ÑÉ¥•Ì°(€€€ÑÉÕ¹…Ñ•°(€€€É•™•É•¹•¥±•Ìè•¹ÑÉ¥•Ì¹™¥±Ñ•È ¡•¹ÑÉä¤€ôø•¹ÑÉä¹ÑåÁ”€ôôô€‰™¥±”ˆ€˜˜II9¹Ñ•ÍÐ¡‰…Í•¹…µ”Ð¡•¹ÑÉä¹Á…Ñ ¤¤¤¹µ…À ¡•¹ÑÉä¤€ôø•¹ÑÉä¹Á…Ñ ¤°(€€€¥¹ÍÁ•Ñ¥½¸è€‰9…µ•Ì…¹ÑåÁ•Ì½¹±äì¡¥‘‘•¸½ÁÉ¥Ù…Ñ”¹…µ•Ì°‘•Á•¹‘•¹ä½‰Õ¥±™½±‘•ÉÌ°…¹¡¥±Íåµ±¥¹­Ì•á±Õ‘•¸9½Ð„½µÁ±•Ñ”¥¹Ù•¹Ñ½Éä¸ˆ(€ôì)ô)…Íå¹Œ™Õ¹Ñ¥½¸¥¹ÍÁ•Ñ=‰Í¥‘¥…¹M•ÑÕÀ¡ìÝ°Ù…Õ±Ð€ô¹Õ±°ô¤ì(€½¹ÍÐÝ½É­ÍÁ…”€ô…Ý…¥Ð¥¹ÍÁ•ÑM•ÑÕÁ¥É•Ñ½Éä¡Ý¤ì(€¥˜€ …Ý½É­ÍÁ…”¹•á¥ÍÑÌ¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È¡AÉ½©•Ð‘¥É•Ñ½Éä‘½•Ì¹½Ð•á¥ÍÐè€‘íÝ‘õ€¤ì(€É•ÑÕÉ¸ìÝ½É­ÍÁ…”°Ù…Õ±ÐèÙ…Õ±Ð€ü…Ý…¥Ð¥¹ÍÁ•ÑM•ÑÕÁ¥É•Ñ½Éä¡É•Í½±Ù•M•ÑÕÁY…Õ±Ð¡Ù…Õ±Ð°Ý¤¤€è¹Õ±°ôì)ô((¼¼Á…­…•Ì½•áÑ•¹Í¥½¹Ì½ÍÉŒ½¥¹Ñ•É¹…°½½‰Í¥‘¥…¸µÝ½É­‰•¹ ¹ÑÌ)¥¹¥Ñ}ÉÕ¹Ñ¥µ•}¡½ÍÐ ¤ì((¼¼Á…­…•Ì½­¹½Ý±•‘”½ÍÉŒ½Õ¤µÍ•ÉÙ¥”¹ÑÌ)¥µÁ½ÉÐì‘¥É¹…µ”…Ì‘¥É¹…µ”Ø°¥Í‰Í½±ÕÑ”…Ì¥Í‰Í½±ÕÑ”ÄÀ°©½¥¸…Ì©½¥¸ÄÌ°É•±…Ñ¥Ù”…ÌÉ•±…Ñ¥Ù”ä°É•Í½±Ù”…ÌÉ•Í½±Ù”ÄÈô™É½´€‰¹½‘”éÁ…Ñ ˆì)¥¹¥Ñ}ÉÕ¹Ñ¥µ•}¡½ÍÐ ¤ì)¥¹¥Ñ}ÉÕ¹Ñ¥µ•}¡½ÍÐ ¤ì)¥¹¥Ñ}ÉÕ¹Ñ¥µ•}¡½ÍÐ ¤ì)¥¹¥Ñ}ÉÕ¹Ñ¥µ•}¡½ÍÐ ¤ì)¥¹¥Ñ}ÉÕ¹Ñ¥µ•}¡½ÍÐ ¤ì)¥¹¥Ñ}½¹™¥œ ¤ì((¼¼Á…­…•Ì½­¹½Ý±•‘”½ÍÉŒ½‘…¥±äµ‘¥Í½Ù•Éä¹ÑÌ)Ù…È%1e}%M=YIe}1%5%QL€ôì(€µ…áM…¹¹•‘¥±•Ìè€Ñ”Ì°(€µ…á9½Ñ•	åÑ•Ìè€ÈÔØ€¨€ÄÀÈÐ°(€µ…á9•Ý9½Ñ•Ìè€à°(€µ…áI•±…Ñ•‘9½Ñ•Ìè€ÄÀ°(€µ…á9½Ñ•¡…ÉÌè€ÈÐÀÀ°(€µ…á%‘•…Ìè€Ì)ôì((¼¼Á…­…•Ì½­¹½Ý±•‘”½ÍÉŒ½Õ¤µÍ•ÉÙ¥”¹ÑÌ)¥¹¥Ñ}™¥±•Ì ¤ì((¼¼Á…­…•Ì½­¹½Ý±•‘”½ÍÉŒ½±…å½ÕÐ¹ÑÌ)¥¹¥Ñ}™¥±•Ì ¤ì((¼¼Á…­…•Ì½­¹½Ý±•‘”½ÍÉŒ½µ…¥¹Ñ•¹…¹”¹ÑÌ)¥¹¥Ñ}™¥±•Ì ¤ì((¼¼Á…­…•Ì½­¹½Ý±•‘”½ÍÉŒ½Õ¤µÍ•ÉÙ¥”¹ÑÌ)¥¹¥Ñ}É•Ù¥•Ý}Á½±¥ä ¤ì((¼¼Á…­…•Ì½­¹½Ý±•‘”½ÍÉŒ½É…Á µÉ•ÑÉ¥•Ù…°¹ÑÌ)Ù…ÈIA!}IQI%Y1}U1QL€ôì(€Í••‘Ìè€Ì°(€‘•…äè€À¸Ô°(€•¹ÑÉ…±¥Ñå]•¥¡Ðè€É”´Ì°(€•¹ÑÉ…±¥Ñå…Àè€Ñ”´Ì°(€µ…á9•¥¡‰½ÉÍA•ÉM••è€Ð)ôì)™Õ¹Ñ¥½¸•¹ÑÉ…±¥Ñå	½½ÍÐ¡‘•É•”°Ý•¥¡Ð°…À¤ì(€¥˜€ „¡‘•É•”€ø€À¤¤É•ÑÕÉ¸€Àì(€É•ÑÕÉ¸5…Ñ ¹µ¥¸¡…À°Ý•¥¡Ð€¨5…Ñ ¹±½œÈ Ä€¬‘•É•”¤¤ì)ô)™Õ¹Ñ¥½¸‰…Í•M½É”¡¡¥Ð°¥¹‘•à¤ì(€É•ÑÕÉ¸ÑåÁ•½˜¡¥Ð¹™ÕÍ¥½¹M½É”€ôôô€‰¹Õµ‰•Èˆ€˜˜9Õµ‰•È¹¥Í¥¹¥Ñ”¡¡¥Ð¹™ÕÍ¥½¹M½É”¤€ü¡¥Ð¹™ÕÍ¥½¹M½É”€è€Ä€¼€ ØÀ€¬¥¹‘•à€¬€Ä¤ì)ô)™Õ¹Ñ¥½¸•áÁ…¹‘]¥Ñ¡É…Á ¡¡¥ÑÌ°¹•¥¡‰½ÉÌ°½ÁÑ¥½¹Ì¤ì(€½¹ÍÐ¼€ôì€¸¸¹IA!}IQI%Y1}U1QL°€¸¸¹½ÁÑ¥½¹Ìôì(€½¹ÍÐ±¥µ¥Ð€ô5…Ñ ¹µ…à Ä°5…Ñ ¹µ¥¸ ÄÈ°5…Ñ ¹™±½½È¡¼¹±¥µ¥Ð¤¤¤ì(€½¹ÍÐÍ½É•€ô€¼¨}}AUI}|€¨¼¹•Ü5…À ¤ì(€™½È€¡½¹ÍÐm¥¹‘•à°¡¥Ñt½˜¡¥ÑÌ¹•¹ÑÉ¥•Ì ¤¤Í½É•¹Í•Ð¡¡¥Ð¹Á…Ñ °ì¡¥Ð°Í½É”è‰…Í•M½É”¡¡¥Ð°¥¹‘•à¤ô¤ì(€½¹ÍÐÍ••‘M½É”€ô¹•Ü5…À¡¡¥ÑÌ¹Í±¥” À°¼¹Í••‘Ì¤¹µ…À ¡¡¥Ð°¥¹‘•à¤€ôøm¡¥Ð¹Á…Ñ °‰…Í•M½É”¡¡¥Ð°¥¹‘•à¥t¤¤ì(€½¹ÍÐÁ•ÉM••€ô€¼¨}}AUI}|€¨¼¹•Ü5…À ¤ì(€½¹ÍÐ½É‘•É•€ôl¸¸¹¹•¥¡‰½ÉÍt¹Í½ÉÐ (€€€€¡„°ˆ¤€ôøˆ¹‘•É•”€´„¹‘•É•”ñð„¹Á…Ñ ¹±½…±•½µÁ…É”¡ˆ¹Á…Ñ ¤ñð„¹™É½´¹±½…±•½µÁ…É”¡ˆ¹™É½´¤(€€¤ì(€™½È€¡½¹ÍÐ¸½˜½É‘•É•¤ì(€€€½¹ÍÐÁ…É•¹Ð€ôÍ••‘M½É”¹•Ð¡¸¹™É½´¤ì(€€€¥˜€¡Á…É•¹Ð€ôôôÙ½¥€Àñð¸¹Á…Ñ €ôôô¸¹™É½´¤½¹Ñ¥¹Õ”ì(€€€½¹ÍÐÕÍ•€ôÁ•ÉM••¹•Ð¡¸¹™É½´¤ñð€Àì(€€€½¹ÍÐ•á¥ÍÑ¥¹œ€ôÍ½É•¹•Ð¡¸¹Á…Ñ ¤ì(€€€½¹ÍÐ½¹ÑÉ¥‰ÕÑ¥½¸€ôÁ…É•¹Ð€¨¼¹‘•…ä€¬•¹ÑÉ…±¥Ñå	½½ÍÐ¡¸¹‘•É•”°¼¹•¹ÑÉ…±¥Ñå]•¥¡Ð°¼¹•¹ÑÉ…±¥Ñå…À¤ì(€€€¥˜€¡•á¥ÍÑ¥¹œ¤ì(€€€€€¥˜€¡•á¥ÍÑ¥¹œ¹¡¥Ð¹É•ÑÉ¥•Ù…°€„ôô€‰É…Á ˆ¤•á¥ÍÑ¥¹œ¹Í½É”€¬ô½¹ÑÉ¥‰ÕÑ¥½¸€¨€À¸ÈÔì(€€€€€•±Í”ì(€€€€€€€•á¥ÍÑ¥¹œ¹Í½É”€ô5…Ñ ¹µ…à¡•á¥ÍÑ¥¹œ¹Í½É”°½¹ÑÉ¥‰ÕÑ¥½¸¤ì(€€€€€€€½¹ÍÐœ€ô•á¥ÍÑ¥¹œ¹¡¥Ð¹É…Á ì(€€€€€€€¥˜€ …œ¹™É½´¹¥¹±Õ‘•Ì¡¸¹™É½´¤¤œ¹™É½´¹ÁÕÍ ¡¸¹™É½´¤ì(€€€€€ô(€€€€€½¹Ñ¥¹Õ”ì(€€€ô(€€€¥˜€¡ÕÍ•€øô¼¹µ…á9•¥¡‰½ÉÍA•ÉM••¤½¹Ñ¥¹Õ”ì(€€€Á•ÉM••¹Í•Ð¡¸¹™É½´°ÕÍ•€¬€Ä¤ì(€€€Í½É•¹Í•Ð¡¸¹Á…Ñ °ì(€€€€€¡¥Ðèì(€€€€€€€Á…Ñ è¸¹Á…Ñ °(€€€€€€€Ñ¥Ñ±”è¸¹Ñ¥Ñ±”°(€€€€€€€­¥¹è¸¹­¥¹°(€€€€€€€€¸¸¹¸¹¡…Í €üì¡…Í è¸¹¡…Í ô€èíô°(€€€€€€€É•ÑÉ¥•Ù…°è€‰É…Á ˆ°(€€€€€€€É…Á èì™É½´èm¸¹™É½µt°‘¥É•Ñ¥½¸è¸¹‘¥É•Ñ¥½¸°€¸¸¹¸¹½¹Ñ•áÐ€üì½¹Ñ•áÐè¸¹½¹Ñ•áÐô€èíôô(€€€€€ô°(€€€€€Í½É”è½¹ÑÉ¥‰ÕÑ¥½¸(€€€ô¤ì(€ô(€É•ÑÕÉ¸l¸¸¹Í½É•¹Ù…±Õ•Ì ¥t¹Í½ÉÐ ¡„°ˆ¤€ôøˆ¹Í½É”€´„¹Í½É”ñð„¹¡¥Ð¹Á…Ñ ¹±½…±•½µÁ…É”¡ˆ¹¡¥Ð¹Á…Ñ ¤¤¹Í±¥” À°±¥µ¥Ð¤¹µ…À ¡ì¡¥Ð°Í½É”ô¤€ôø€¡ì€¸¸¹¡¥Ð°™ÕÍ¥½¹M½É”èÍ½É”ô¤¤ì)ô((¼¼Á…­…•Ì½­¹½Ý±•‘”½ÍÉŒ½Í•ÉÙ¥”¹ÑÌ)¥¹¥Ñ}ÉÕ¹Ñ¥µ•}¡½ÍÐ ¤ì)¥¹¥Ñ}ÉÕ¹Ñ¥µ•}¡½ÍÐ ¤ì)¥¹¥Ñ}ÉÕ¹Ñ¥µ•}¡½ÍÐ ¤ì)¥¹¥Ñ}½¹™¥œ ¤ì)¥¹¥Ñ}™¥±•Ì ¤ì)¥¹¥Ñ}É•Ù¥•Ý}Á½±¥ä ¤ì)¥µÁ½ÉÐìÉ•…Ñ•!…Í …ÌÉ•…Ñ•!…Í ä°É…¹‘½µUU%…ÌÉ…¹‘½µUU%Üô™É½´€‰¹½‘”éÉåÁÑ¼ˆì)¥µÁ½ÉÐì©½¥¸…Ì©½¥¸ÄÄ°É•±…Ñ¥Ù”…ÌÉ•±…Ñ¥Ù”à°É•Í½±Ù”…ÌÉ•Í½±Ù”ÄÄ°Í•À…ÌÍ•Ààô™É½´€‰¹½‘”éÁ…Ñ ˆì((¼¼Á…­…•Ì½­¹½Ý±•‘”½ÍÉŒ½Í•µ…¹Ñ¥ŒµÁÉ½Ù¥‘•È¹ÑÌ)¥µÁ½ÉÐìUI0…ÌUI0Èô™É½´€‰¹½‘”éÕÉ°ˆì)Ù…È5a}	Q €ô€ÌÈì)Ù…È5a}!IL€ô€ÄÉ”Ðì)Ù…È5a}IMA=9M€ô€à€¨€ÄÀÈÐ€¨€ÄÀÈÐì)Ù…È9Y}95€ô€½ymµi}umµhÀ´å}uìÀ°ÄÈÝô¼ì)Ù…È5a}YQ=I}=5A=99P€ô€Å”Øì)Ù…È5a}YQ=I}9=I4€ô€Å”äì)Ù…È=9%}-eL€ô€¼¨}}AUI}|€¨¼¹•ÜM•Ð¡l(€€‰•¹…‰±•ˆ°(€€‰ÁÉ½Ù¥‘•Èˆ°(€€‰‰…Í•UÉ°ˆ°(€€‰µ½‘•°ˆ°(€€‰É•‘•¹Ñ¥…±¹Øˆ°(€€‰É•µ½Ñ•½¹Í•¹Ðˆ°(€€‰Ñ¥µ•½ÕÑ5Ìˆ°(€€‰¡Õ¹­¡…ÉÌˆ°(€€‰µ¥¹M¥µ¥±…É¥Ñäˆ)t¤ì)™Õ¹Ñ¥½¸±½½Á‰…¬¡¡½ÍÑ¹…µ”¤ì(€É•ÑÕÉ¸¡½ÍÑ¹…µ”€ôôô€‰±½…±¡½ÍÐˆñð¡½ÍÑ¹…µ”€ôôô€ˆÄÈÜ¸À¸À¸Äˆñð¡½ÍÑ¹…µ”€ôôô€ˆèèÄˆñð¡½ÍÑ¹…µ”€ôôô€‰lèèÅtˆì)ô)™Õ¹Ñ¥½¸Ù…±¥‘…Ñ•M•µ…¹Ñ¥½¹™¥œ¡¥¹ÁÕÐ€ôíô¤ì(€¥˜€ …¥¹ÁÕÐñðÑåÁ•½˜¥¹ÁÕÐ€„ôô€‰½‰©•ÐˆñðÉÉ…ä¹¥ÍÉÉ…ä¡¥¹ÁÕÐ¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÍ•ÑÑ¥¹ÌµÕÍÐ‰”…¸½‰©•Ðˆ¤ì(€™½È€¡½¹ÍÐ­•ä½˜=‰©•Ð¹­•åÌ¡¥¹ÁÕÐ¤¤(€€€¥˜€ …=9%}-eL¹¡…Ì¡­•ä¤¤Ñ¡É½Ü¹•ÜÉÉ½È¡U¹­¹½Ý¸Í•µ…¹Ñ¥ŒÍ•ÑÑ¥¹œè€‘í­•åõ€¤ì(€¥˜€¡¥¹ÁÕÐ¹•¹…‰±•€„ôôÙ½¥€À€˜˜ÑåÁ•½˜¥¹ÁÕÐ¹•¹…‰±•€„ôô€‰‰½½±•…¸ˆ¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰•¹…‰±•µÕÍÐ‰”‰½½±•…¸ˆ¤ì(€¥˜€¡¥¹ÁÕÐ¹ÁÉ½Ù¥‘•È€„ôôÙ½¥€À€˜˜ÑåÁ•½˜¥¹ÁÕÐ¹ÁÉ½Ù¥‘•È€„ôô€‰ÍÑÉ¥¹œˆ¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰ÁÉ½Ù¥‘•ÈµÕÍÐ‰”„ÍÑÉ¥¹œˆ¤ì(€½¹ÍÐÁÉ½Ù¥‘•È€ô¥¹ÁÕÐ¹ÁÉ½Ù¥‘•È€üü€‰¹½¹”ˆì(€¥˜€ …l‰¹½¹”ˆ°€‰½±±…µ„ˆ°€‰½Á•¹…¤µ½µÁ…Ñ¥‰±”‰t¹¥¹±Õ‘•Ì¡ÁÉ½Ù¥‘•È¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰U¹­¹½Ý¸Í•µ…¹Ñ¥ŒÁÉ½Ù¥‘•Èˆ¤ì(€¥˜€¡¥¹ÁÕÐ¹É•µ½Ñ•½¹Í•¹Ð€„ôôÙ½¥€À€˜˜ÑåÁ•½˜¥¹ÁÕÐ¹É•µ½Ñ•½¹Í•¹Ð€„ôô€‰‰½½±•…¸ˆ¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰É•µ½Ñ•½¹Í•¹ÐµÕÍÐ‰”‰½½±•…¸ˆ¤ì(€¥˜€¡¥¹ÁÕÐ¹Ñ¥µ•½ÕÑ5Ì€„ôôÙ½¥€À€˜˜€ …9Õµ‰•È¹¥Í%¹Ñ••È¡¥¹ÁÕÐ¹Ñ¥µ•½ÕÑ5Ì¤ñð¥¹ÁÕÐ¹Ñ¥µ•½ÕÑ5Ì€ð€ÔÀÀñð¥¹ÁÕÐ¹Ñ¥µ•½ÕÑ5Ì€ø€Í”Ð¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰Ñ¥µ•½ÕÑ5ÌµÕÍÐ‰”…¸¥¹Ñ••È‰•ÑÝ••¸€ÔÀÀ…¹€ÌÀÀÀÀˆ¤ì(€¥˜€¡¥¹ÁÕÐ¹¡Õ¹­¡…ÉÌ€„ôôÙ½¥€À€˜˜€ …9Õµ‰•È¹¥Í%¹Ñ••È¡¥¹ÁÕÐ¹¡Õ¹­¡…ÉÌ¤ñð¥¹ÁÕÐ¹¡Õ¹­¡…ÉÌ€ð€ÈÔØñð¥¹ÁÕÐ¹¡Õ¹­¡…ÉÌ€ø€á”Ì¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰¡Õ¹­¡…ÉÌµÕÍÐ‰”…¸¥¹Ñ••È‰•ÑÝ••¸€ÈÔØ…¹€àÀÀÀˆ¤ì(€¥˜€¡¥¹ÁÕÐ¹µ¥¹M¥µ¥±…É¥Ñä€„ôôÙ½¥€À€˜˜€¡ÑåÁ•½˜¥¹ÁÕÐ¹µ¥¹M¥µ¥±…É¥Ñä€„ôô€‰¹Õµ‰•Èˆñð€…9Õµ‰•È¹¥Í¥¹¥Ñ”¡¥¹ÁÕÐ¹µ¥¹M¥µ¥±…É¥Ñä¤ñð¥¹ÁÕÐ¹µ¥¹M¥µ¥±…É¥Ñä€ð€Àñð¥¹ÁÕÐ¹µ¥¹M¥µ¥±…É¥Ñä€ø€Ä¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰µ¥¹M¥µ¥±…É¥ÑäµÕÍÐ‰”„™¥¹¥Ñ”¹Õµ‰•È‰•ÑÝ••¸€À…¹€Äˆ¤ì(€½¹ÍÐ•¹…‰±•€ô¥¹ÁÕÐ¹•¹…‰±•€üüÁÉ½Ù¥‘•È€„ôô€‰¹½¹”ˆì(€½¹ÍÐ‰…Í•UÉ°€ô¥¹ÁÕÐ¹‰…Í•UÉ°€ôôôÙ½¥€À€ü€ˆˆ€è¥¹ÁÕÐ¹‰…Í•UÉ°ì(€½¹ÍÐµ½‘•°€ô¥¹ÁÕÐ¹µ½‘•°€ôôôÙ½¥€À€ü€ˆˆ€è¥¹ÁÕÐ¹µ½‘•°ì(€½¹ÍÐÉ•‘•¹Ñ¥…±¹Ø€ô¥¹ÁÕÐ¹É•‘•¹Ñ¥…±¹Ø€ôôôÙ½¥€Àñð¥¹ÁÕÐ¹É•‘•¹Ñ¥…±¹Ø€ôôô¹Õ±°€ü€ˆˆ€è¥¹ÁÕÐ¹É•‘•¹Ñ¥…±¹Øì(€¥˜€¡ÑåÁ•½˜‰…Í•UÉ°€„ôô€‰ÍÑÉ¥¹œˆñðÑåÁ•½˜µ½‘•°€„ôô€‰ÍÑÉ¥¹œˆñðÑåÁ•½˜É•‘•¹Ñ¥…±¹Ø€„ôô€‰ÍÑÉ¥¹œˆ¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÁÉ½Ù¥‘•È™¥•±‘ÌµÕÍÐ‰”ÍÑÉ¥¹Ìˆ¤ì(€½¹ÍÐÑÉ¥µµ•‘	…Í”€ô‰…Í•UÉ°¹ÑÉ¥´ ¤ì(€½¹ÍÐÑÉ¥µµ•‘5½‘•°€ôµ½‘•°¹ÑÉ¥´ ¤ì(€½¹ÍÐÑÉ¥µµ•‘É•‘•¹Ñ¥…°€ôÉ•‘•¹Ñ¥…±¹Ø¹ÑÉ¥´ ¤ì(€¥˜€¡ÁÉ½Ù¥‘•È€ôôô€‰¹½¹”ˆ¤ì(€€€¥˜€¡•¹…‰±•¤Ñ¡É½Ü¹•ÜÉÉ½È ‰Q¡”¹½¹”ÁÉ½Ù¥‘•È…¹¹½Ð‰”•¹…‰±•ˆ¤ì(€€€¥˜€¡¥¹ÁÕÐ¹É•µ½Ñ•½¹Í•¹Ð€ôôôÑÉÕ”¤Ñ¡É½Ü¹•ÜÉÉ½È ‰É•µ½Ñ•½¹Í•¹Ð¥Ì¹½ÐÙ…±¥™½ÈÑ¡”¹½¹”ÁÉ½Ù¥‘•Èˆ¤ì(€€€É•ÑÕÉ¸ì(€€€€€•¹…‰±•è™…±Í”°(€€€€€ÁÉ½Ù¥‘•Èè€‰¹½¹”ˆ°(€€€€€‰…Í•UÉ°è€ˆˆ°(€€€€€µ½‘•°è€ˆˆ°(€€€€€É•‘•¹Ñ¥…±¹Øè€ˆˆ°(€€€€€É•µ½Ñ•½¹Í•¹Ðè™…±Í”(€€€ôì(€ô(€¥˜€ …•¹…‰±•€˜˜€…ÑÉ¥µµ•‘	…Í”€˜˜€…ÑÉ¥µµ•‘5½‘•°¤(€€€É•ÑÕÉ¸ì(€€€€€•¹…‰±•è™…±Í”°(€€€€€ÁÉ½Ù¥‘•È°(€€€€€‰…Í•UÉ°è€ˆˆ°(€€€€€µ½‘•°è€ˆˆ°(€€€€€É•‘•¹Ñ¥…±¹ØèÑÉ¥µµ•‘É•‘•¹Ñ¥…°°(€€€€€É•µ½Ñ•½¹Í•¹Ðè¥¹ÁÕÐ¹É•µ½Ñ•½¹Í•¹Ð€ôôôÑÉÕ”°(€€€€€Ñ¥µ•½ÕÑ5Ìè¥¹ÁÕÐ¹Ñ¥µ•½ÕÑ5Ì€üü€Å”Ð°(€€€€€¡Õ¹­¡…ÉÌè¥¹ÁÕÐ¹¡Õ¹­¡…ÉÌ€üü€ÄÈÀÀ°(€€€€€µ¥¹M¥µ¥±…É¥Ñäè¥¹ÁÕÐ¹µ¥¹M¥µ¥±…É¥Ñä€üü€À¸ÐÔ(€€€ôì(€¥˜€ …ÑÉ¥µµ•‘	…Í”ñðÑÉ¥µµ•‘	…Í”¹±•¹Ñ €ø€ÔÀÀñð€…ÑÉ¥µµ•‘5½‘•°ñðÑÉ¥µµ•‘5½‘•°¹±•¹Ñ €ø€ÈÀÀ¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÁÉ½Ù¥‘•È‰…Í”UI0…¹µ½‘•°…É”É•ÅÕ¥É•ˆ¤ì(€¥˜€¡ÑÉ¥µµ•‘É•‘•¹Ñ¥…°€˜˜€…9Y}95¹Ñ•ÍÐ¡ÑÉ¥µµ•‘É•‘•¹Ñ¥…°¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰É•‘•¹Ñ¥…±¹ØµÕÍÐ‰”„Ù…±¥•¹Ù¥É½¹µ•¹ÐÙ…É¥…‰±”¹…µ”ˆ¤ì(€±•ÐÕÉ°ì(€ÑÉäì(€€€ÕÉ°€ô¹•ÜUI0È¡ÑÉ¥µµ•‘	…Í”¤ì(€ô…Ñ ì(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÁÉ½Ù¥‘•È‰…Í”UI0¥Ì¥¹Ù…±¥ˆ¤ì(€ô(€¥˜€ …l‰¡ÑÑÀèˆ°€‰¡ÑÑÁÌè‰t¹¥¹±Õ‘•Ì¡ÕÉ°¹ÁÉ½Ñ½½°¤ñðÕÉ°¹ÕÍ•É¹…µ”ñðÕÉ°¹Á…ÍÍÝ½ÉñðÕÉ°¹Í•…É ñðÕÉ°¹¡…Í ¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÁÉ½Ù¥‘•ÈUI0µÕÍÐ‰”Á±…¥¸¡ÑÑÀ¡Ì¤Ý¥Ñ¡½ÕÐÉ•‘•¹Ñ¥…±Ì°ÅÕ•Éä°½È™É…µ•¹Ðˆ¤ì(€½¹ÍÐÉ•µ½Ñ”€ô€…±½½Á‰…¬¡ÕÉ°¹¡½ÍÑ¹…µ”¤ì(€¥˜€¡É•µ½Ñ”€˜˜ÕÉ°¹ÁÉ½Ñ½½°€ôôô€‰¡ÑÑÀèˆ¤Ñ¡É½Ü¹•ÜÉÉ½È ‰I•µ½Ñ”Í•µ…¹Ñ¥ŒÁÉ½Ù¥‘•ÉÌÉ•ÅÕ¥É”!QQALˆ¤ì(€¥˜€¡É•µ½Ñ”€˜˜¥¹ÁÕÐ¹É•µ½Ñ•½¹Í•¹Ð€„ôôÑÉÕ”¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰I•µ½Ñ”Í•µ…¹Ñ¥ŒÁÉ½Ù¥‘•ÈÉ•ÅÕ¥É•Ì•áÁ±¥¥ÐÉ•µ½Ñ•½¹Í•¹Ðˆ¤ì(€¥˜€¡É•µ½Ñ”€˜˜€…ÑÉ¥µµ•‘É•‘•¹Ñ¥…°¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰I•µ½Ñ”Í•µ…¹Ñ¥ŒÁÉ½Ù¥‘•ÉÌÉ•ÅÕ¥É”„É•‘•¹Ñ¥…°•¹Ù¥É½¹µ•¹ÐÙ…É¥…‰±”ˆ¤ì(€É•ÑÕÉ¸ì(€€€•¹…‰±•°(€€€ÁÉ½Ù¥‘•È°(€€€‰…Í•UÉ°èÕÉ°¹Ñ½MÑÉ¥¹œ ¤¹É•Á±…” ½p¼¬¼°€ˆˆ¤°(€€€µ½‘•°èÑÉ¥µµ•‘5½‘•°°(€€€É•‘•¹Ñ¥…±¹ØèÑÉ¥µµ•‘É•‘•¹Ñ¥…°°(€€€É•µ½Ñ•½¹Í•¹Ðè¥¹ÁÕÐ¹É•µ½Ñ•½¹Í•¹Ð€ôôôÑÉÕ”°(€€€Ñ¥µ•½ÕÑ5Ìè¥¹ÁÕÐ¹Ñ¥µ•½ÕÑ5Ì€üü€Å”Ð°(€€€¡Õ¹­¡…ÉÌè¥¹ÁÕÐ¹¡Õ¹­¡…ÉÌ€üü€ÄÈÀÀ°(€€€µ¥¹M¥µ¥±…É¥Ñäè¥¹ÁÕÐ¹µ¥¹M¥µ¥±…É¥Ñä€üü€À¸ÐÔ(€ôì)ô)™Õ¹Ñ¥½¸•¹‘Á½¥¹Ð¡½¹™¥œ¤ì(€½¹ÍÐÍÕ™™¥à€ô½¹™¥œ¹ÁÉ½Ù¥‘•È€ôôô€‰½±±…µ„ˆ€ül‰…Á¤½•µ‰•ˆ°€‰…Á¤‰t€èl‰ØÄ½•µ‰•‘‘¥¹Ìˆ°€‰ØÄ‰tì(€½¹ÍÐ‰…Í”€ô½¹™¥œ¹‰…Í•UÉ°¹É•Á±…” ½p¼¬¼°€ˆˆ¤ì(€¥˜€¡‰…Í”¹•¹‘Í]¥Ñ ¡€¼‘íÍÕ™™¥álÁuõ€¤¤É•ÑÕÉ¸‰…Í”ì(€¥˜€¡‰…Í”¹•¹‘Í]¥Ñ ¡€¼‘íÍÕ™™¥álÅuõ€¤¤É•ÑÕÉ¸€‘í‰…Í•ô¼‘íÍÕ™™¥álÁt¹ÍÁ±¥Ð ˆ¼ˆ¤¹…Ð ´Ä¥õ€ì(€É•ÑÕÉ¸€‘í‰…Í•ô¼‘íÍÕ™™¥álÁuõ€ì)ô)…Íå¹Œ™Õ¹Ñ¥½¸É•…‘	½Õ¹‘•¡É•ÍÁ½¹Í”¤ì(€½¹ÍÐ±•¹Ñ €ô9Õµ‰•È¡É•ÍÁ½¹Í”¹¡•…‘•ÉÌ¹•Ð ‰½¹Ñ•¹Ðµ±•¹Ñ ˆ¤¤ì(€¥˜€¡9Õµ‰•È¹¥Í¥¹¥Ñ”¡±•¹Ñ ¤€˜˜±•¹Ñ €ø5a}IMA=9M¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÁÉ½Ù¥‘•ÈÉ•ÍÁ½¹Í”¥ÌÑ½¼±…É”ˆ¤ì(€½¹ÍÐÉ•…‘•È€ôÉ•ÍÁ½¹Í”¹‰½‘äü¹•ÑI•…‘•È ¤ì(€¥˜€ …É•…‘•È¤ì(€€€½¹ÍÐÑ•áÐÌ€ô…Ý…¥ÐÉ•ÍÁ½¹Í”¹Ñ•áÐ ¤ì(€€€¥˜€¡	Õ™™•È¹‰åÑ•1•¹Ñ ¡Ñ•áÐÌ¤€ø5a}IMA=9M¤Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÁÉ½Ù¥‘•ÈÉ•ÍÁ½¹Í”¥ÌÑ½¼±…É”ˆ¤ì(€€€É•ÑÕÉ¸Ñ•áÐÌì(€ô(€½¹ÍÐ¡Õ¹­Ì€ômtì(€±•ÐÑ½Ñ…°€ô€Àì(€™½È€ ì€ì€¤ì(€€€½¹ÍÐì‘½¹”°Ù…±Õ”ô€ô…Ý…¥ÐÉ•…‘•È¹É•… ¤ì(€€€¥˜€¡‘½¹”¤‰É•…¬ì(€€€Ñ½Ñ…°€¬ôÙ…±Õ”¹‰åÑ•1•¹Ñ ì(€€€¥˜€¡Ñ½Ñ…°€ø5a}IMA=9M¤ì(€€€€€…Ý…¥ÐÉ•…‘•È¹…¹•° ¤ì(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÁÉ½Ù¥‘•ÈÉ•ÍÁ½¹Í”¥ÌÑ½¼±…É”ˆ¤ì(€€€ô(€€€¡Õ¹­Ì¹ÁÕÍ ¡Ù…±Õ”¤ì(€ô(€É•ÑÕÉ¸	Õ™™•È¹½¹…Ð¡¡Õ¹­Ì¤¹Ñ½MÑÉ¥¹œ ‰ÕÑ˜àˆ¤ì)ô)™Õ¹Ñ¥½¸Ù•Ñ½ÉÌ¡Ù…±Õ”°•áÁ•Ñ•¤ì(€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡Ù…±Õ”¤ñðÙ…±Õ”¹±•¹Ñ €„ôô•áÁ•Ñ•¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÁÉ½Ù¥‘•ÈÉ•ÑÕÉ¹•…¸¥¹Ù…±¥Ù•Ñ½È½Õ¹Ðˆ¤ì(€±•Ð‘¥µ•¹Í¥½¸€ô€Àì(€½¹ÍÐ½ÕÐ€ôÙ…±Õ”¹µ…À ¡¥Ñ•´¤€ôøì(€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡¥Ñ•´¤ñð€…¥Ñ•´¹±•¹Ñ ñð¥Ñ•´¹±•¹Ñ €ø€ÄØÌàÐ¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÁÉ½Ù¥‘•ÈÉ•ÑÕÉ¹•…¸¥¹Ù…±¥Ù•Ñ½Èˆ¤ì(€€€¥˜€ …‘¥µ•¹Í¥½¸¤‘¥µ•¹Í¥½¸€ô¥Ñ•´¹±•¹Ñ ì(€€€¥˜€¡¥Ñ•´¹±•¹Ñ €„ôô‘¥µ•¹Í¥½¸¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÁÉ½Ù¥‘•ÈÉ•ÑÕÉ¹•¥¹½¹Í¥ÍÑ•¹ÐÙ•Ñ½È‘¥µ•¹Í¥½¹Ìˆ¤ì(€€€½¹ÍÐÙ•Ñ½È€ô¥Ñ•´¹µ…À ¡¸¤€ôø¸¤ì(€€€¥˜€¡Ù•Ñ½È¹Í½µ” ¡¸¤€ôøÑåÁ•½˜¸€„ôô€‰¹Õµ‰•Èˆñð€…9Õµ‰•È¹¥Í¥¹¥Ñ”¡¸¤ñð5…Ñ ¹…‰Ì¡¸¤€ø5a}YQ=I}=5A=99P¤¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÁÉ½Ù¥‘•ÈÉ•ÑÕÉ¹•9…8½È¥¹™¥¹¥Ñ”Ù•Ñ½ÈÙ…±Õ•Ìˆ¤ì(€€€±•ÐÍÕ´€ô€Àì(€€€™½È€¡½¹ÍÐ¸½˜Ù•Ñ½È¤ì(€€€€€ÍÕ´€¬ô¸€¨¸ì(€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡ÍÕ´¤ñðÍÕ´€ø5a}YQ=I}9=I4€¨¨€È¤(€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÁÉ½Ù¥‘•ÈÉ•ÑÕÉ¹•…¸½Ù•ÉÍ¥é•Ù•Ñ½È¹½É´ˆ¤ì(€€€ô(€€€¥˜€ „¡ÍÕ´€ø€À¤¤Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÁÉ½Ù¥‘•ÈÉ•ÑÕÉ¹•„é•É¼µ¹½É´Ù•Ñ½Èˆ¤ì(€€€É•ÑÕÉ¸Ù•Ñ½Èì(€ô¤ì(€É•ÑÕÉ¸ìÙ•Ñ½ÉÌè½ÕÐ°‘¥µ•¹Í¥½¸ôì)ô)…Íå¹Œ™Õ¹Ñ¥½¸•µ‰•‘Q•áÑÌ¡É…Ý½¹™¥œ°Ñ•áÑÌ°ìÍ¥¹…°ô€ôíô¤ì(€½¹ÍÐ½¹™¥œ€ôÙ…±¥‘…Ñ•M•µ…¹Ñ¥½¹™¥œ¡É…Ý½¹™¥œ¤ì(€¥˜€ …½¹™¥œ¹•¹…‰±•¤Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥Œ•µ‰•‘‘¥¹Ì…É”‘¥Í…‰±•ˆ¤ì(€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡Ñ•áÑÌ¤ñð€…Ñ•áÑÌ¹±•¹Ñ ñðÑ•áÑÌ¹±•¹Ñ €ø5a}	Q ñðÑ•áÑÌ¹Í½µ” ¡Ñ•áÐÌ¤€ôøÑåÁ•½˜Ñ•áÐÌ€„ôô€‰ÍÑÉ¥¹œˆñð€…Ñ•áÐÌ¹±•¹Ñ ñðÑ•áÐÌ¹±•¹Ñ €ø€ÄÙ”Ì¤ñðÑ•áÑÌ¹©½¥¸ ‰q¸ˆ¤¹±•¹Ñ €ø5a}!IL¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥Œ•µ‰•‘‘¥¹œ‰…Ñ ¥Ì½ÕÑÍ¥‘”‰½Õ¹‘•±¥µ¥ÑÌˆ¤ì(€½¹ÍÐ¡•…‘•ÉÌ€ôì€‰½¹Ñ•¹ÐµÑåÁ”ˆè€‰…ÁÁ±¥…Ñ¥½¸½©Í½¸ˆ°…•ÁÐè€‰…ÁÁ±¥…Ñ¥½¸½©Í½¸ˆôì(€¥˜€¡½¹™¥œ¹É•‘•¹Ñ¥…±¹Ø¤ì(€€€½¹ÍÐÑ½­•¸€ôÁÉ½•ÍÌ¹•¹Ùm½¹™¥œ¹É•‘•¹Ñ¥…±¹Ùtì(€€€¥˜€ …Ñ½­•¸¤Ñ¡É½Ü¹•ÜÉÉ½È¡É•‘•¹Ñ¥…°•¹Ù¥É½¹µ•¹ÐÙ…É¥…‰±”€‘í½¹™¥œ¹É•‘•¹Ñ¥…±¹Ùô¥Ì¹½ÐÍ•Ñ€¤ì(€€€¡•…‘•ÉÌ¹…ÕÑ¡½É¥é…Ñ¥½¸€ô	•…É•È€‘íÑ½­•¹õ€ì(€ô(€½¹ÍÐ‰½‘ä€ô½¹™¥œ¹ÁÉ½Ù¥‘•È€ôôô€‰½±±…µ„ˆ€üìµ½‘•°è½¹™¥œ¹µ½‘•°°¥¹ÁÕÐèÑ•áÑÌ°ÑÉÕ¹…Ñ”è™…±Í”ô€èìµ½‘•°è½¹™¥œ¹µ½‘•°°¥¹ÁÕÐèÑ•áÑÌ°•¹½‘¥¹}™½Éµ…Ðè€‰™±½…Ðˆôì(€½¹ÍÐ½¹ÑÉ½±±•È€ô¹•Ü‰½ÉÑ½¹ÑÉ½±±•È ¤ì(€½¹ÍÐÑ¥µ•È€ôÍ•ÑQ¥µ•½ÕÐ  ¤€ôø½¹ÑÉ½±±•È¹…‰½ÉÐ¡¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÁÉ½Ù¥‘•ÈÑ¥µ•½ÕÐˆ¤¤°½¹™¥œ¹Ñ¥µ•½ÕÑ5Ì¤ì(€½¹ÍÐ½¹‰½ÉÐ€ô€ ¤€ôø½¹ÑÉ½±±•È¹…‰½ÉÐ¡Í¥¹…°¹É•…Í½¸¤ì(€¥˜€¡Í¥¹…°¤ì(€€€¥˜€¡Í¥¹…°¹…‰½ÉÑ•¤½¹ÑÉ½±±•È¹…‰½ÉÐ¡Í¥¹…°¹É•…Í½¸¤ì(€€€•±Í”Í¥¹…°¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰…‰½ÉÐˆ°½¹‰½ÉÐ°ì½¹”èÑÉÕ”ô¤ì(€ô(€ÑÉäì(€€€½¹ÍÐÉ•ÍÁ½¹Í”€ô…Ý…¥Ð™•Ñ ¡•¹‘Á½¥¹Ð¡½¹™¥œ¤°ì(€€€€€µ•Ñ¡½è€‰A=MPˆ°(€€€€€¡•…‘•ÉÌ°(€€€€€‰½‘äè)M=8¹ÍÑÉ¥¹¥™ä¡‰½‘ä¤°(€€€€€É•‘¥É•Ðè€‰•ÉÉ½Èˆ°(€€€€€Í¥¹…°è½¹ÑÉ½±±•È¹Í¥¹…°(€€€ô¤ì(€€€±•ÐÉ…Üì(€€€ÑÉäì(€€€€€É…Ü€ô…Ý…¥ÐÉ•…‘	½Õ¹‘•¡É•ÍÁ½¹Í”¤ì(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€ÑÉäì(€€€€€€€…Ý…¥ÐÉ•ÍÁ½¹Í”¹‰½‘äü¹…¹•° ¤ì(€€€€€ô…Ñ ì(€€€€€ô(€€€€€Ñ¡É½Ü•ÉÉ½Èì(€€€ô(€€€±•ÐÁ…å±½…ì(€€€ÑÉäì(€€€€€Á…å±½…€ô)M=8¹Á…ÉÍ”¡É…Ü¤ì(€€€ô…Ñ ì(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È¡M•µ…¹Ñ¥ŒÁÉ½Ù¥‘•ÈÉ•ÑÕÉ¹•!QQ@€‘íÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÍõ€¤ì(€€€ô(€€€¥˜€ …É•ÍÁ½¹Í”¹½¬¤Ñ¡É½Ü¹•ÜÉÉ½È¡M•µ…¹Ñ¥ŒÁÉ½Ù¥‘•ÈÉ•ÑÕÉ¹•!QQ@€‘íÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÍõ€¤ì(€€€¥˜€¡Á…å±½…ü¹µ½‘•°€„ôôÙ½¥€À€˜˜Á…å±½…¹µ½‘•°€„ôô½¹™¥œ¹µ½‘•°¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÁÉ½Ù¥‘•ÈÉ•ÑÕÉ¹•…¸Õ¹•áÁ•Ñ•µ½‘•°ˆ¤ì(€€€½¹ÍÐ•µ‰•‘‘¥¹Ì€ô½¹™¥œ¹ÁÉ½Ù¥‘•È€ôôô€‰½±±…µ„ˆ€üÁ…å±½…ü¹•µ‰•‘‘¥¹Ì€èÉÉ…ä¹¥ÍÉÉ…ä¡Á…å±½…ü¹‘…Ñ„¤€˜˜Á…å±½…¹‘…Ñ„¹±•¹Ñ €ôôôÑ•áÑÌ¹±•¹Ñ €ül¸¸¹Á…å±½…¹‘…Ñ…t¹Í½ÉÐ ¡„°ˆ¤€ôø€¡„ü¹¥¹‘•à€üü€À¤€´€¡ˆü¹¥¹‘•à€üü€À¤¤¹µ…À ¡¥Ñ•´°¥¹‘•à¤€ôøì(€€€€€¥˜€ …9Õµ‰•È¹¥Í%¹Ñ••È¡¥Ñ•´ü¹¥¹‘•à¤ñð¥Ñ•´¹¥¹‘•à€„ôô¥¹‘•àñð€…=‰©•Ð¹¡…Í=Ý¸¡¥Ñ•´°€‰•µ‰•‘‘¥¹œˆ¤¤(€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÁÉ½Ù¥‘•ÈÉ•ÑÕÉ¹•¥¹Ù…±¥•µ‰•‘‘¥¹œ¥¹‘•á•Ìˆ¤ì(€€€€€É•ÑÕÉ¸¥Ñ•´¹•µ‰•‘‘¥¹œì(€€€ô¤€è¹Õ±°ì(€€€É•ÑÕÉ¸ì€¸¸¹Ù•Ñ½ÉÌ¡•µ‰•‘‘¥¹Ì°Ñ•áÑÌ¹±•¹Ñ ¤°ÁÉ½Ù¥‘•Èè½¹™¥œ¹ÁÉ½Ù¥‘•È°µ½‘•°è½¹™¥œ¹µ½‘•°ôì(€ô™¥¹…±±äì(€€€±•…ÉQ¥µ•½ÕÐ¡Ñ¥µ•È¤ì(€€€¥˜€¡Í¥¹…°¤Í¥¹…°¹É•µ½Ù•Ù•¹Ñ1¥ÍÑ•¹•È ‰…‰½ÉÐˆ°½¹‰½ÉÐ¤ì(€ô)ô)Ù…ÈÍ•µ…¹Ñ¥1¥µ¥ÑÌ€ô=‰©•Ð¹™É••é”¡ì5a}	Q °5a}!IL°5a}IMA=9Mô¤ì((¼¼Á…­…•Ì½­¹½Ý±•‘”½ÍÉŒ½Í•µ…¹Ñ¥ŒµÍ•ÑÑ¥¹Ì¹ÑÌ)¥¹¥Ñ}½¹™¥œ ¤ì)¥µÁ½ÉÐìÉ…¹‘½µUU%…ÌÉ…¹‘½µUU%Øô™É½´€‰¹½‘”éÉåÁÑ¼ˆì)¥µÁ½ÉÐì±ÍÑ…Ð…Ì±ÍÑ…ÐÈ°µ­‘¥È…Ìµ­‘¥ÈÔ°É•…‘‘¥È…ÌÉ•…‘‘¥ÈÈ°É•…‘¥±”…ÌÉ•…‘¥±”à°É•¹…µ”…ÌÉ•¹…µ”Ø°Õ¹±¥¹¬°ÝÉ¥Ñ•¥±”…ÌÝÉ¥Ñ•¥±”Øô™É½´€‰¹½‘”é™Ì½ÁÉ½µ¥Í•Ìˆì)¥µÁ½ÉÐì‘¥É¹…µ”…Ì‘¥É¹…µ”Ô°©½¥¸…Ì©½¥¸ÄÀô™É½´€‰¹½‘”éÁ…Ñ ˆì)Ù…È5a}%1}	eQL€ô€ÈÔØ€¨€ÄÀÈÐì)Ù…È9Y}95È€ô€½ymµi}umµhÀ´å}uìÀ°ÄÈÝô¼ì)Ù…ÈMQQ%9M}-eL€ô€¼¨}}AUI}|€¨¼¹•ÜM•Ð¡l(€€‰Ù•ÉÍ¥½¸ˆ°(€€‰É•Ù¥Í¥½¸ˆ°(€€‰ÕÁ‘…Ñ•‘Ðˆ°(€€‰•¹…‰±•ˆ°(€€‰ÁÉ½Ù¥‘•Èˆ°(€€‰‰…Í•UÉ°ˆ°(€€‰µ½‘•°ˆ°(€€‰É•‘•¹Ñ¥…±¹Øˆ°(€€‰É•µ½Ñ•½¹Í•¹Ðˆ°(€€‰Ñ¥µ•½ÕÑ5Ìˆ°(€€‰¡Õ¹­¡…ÉÌˆ°(€€‰µ¥¹M¥µ¥±…É¥Ñäˆ)t¤ì)Ù…È=9%}-eLÈ€ô€¼¨}}AUI}|€¨¼¹•ÜM•Ð¡l(€€‰•¹…‰±•ˆ°(€€‰ÁÉ½Ù¥‘•Èˆ°(€€‰‰…Í•UÉ°ˆ°(€€‰µ½‘•°ˆ°(€€‰É•‘•¹Ñ¥…±¹Øˆ°(€€‰É•µ½Ñ•½¹Í•¹Ðˆ°(€€‰Ñ¥µ•½ÕÑ5Ìˆ°(€€‰¡Õ¹­¡…ÉÌˆ°(€€‰µ¥¹M¥µ¥±…É¥Ñäˆ)t¤ì)™Õ¹Ñ¥½¸±½½Á‰…¬È¡¡½ÍÑ¹…µ”¤ì(€É•ÑÕÉ¸l‰±½…±¡½ÍÐˆ°€ˆÄÈÜ¸À¸À¸Äˆ°€ˆèèÄˆ°€‰lèèÅt‰t¹¥¹±Õ‘•Ì¡¡½ÍÑ¹…µ”¤ì)ô)™Õ¹Ñ¥½¸Ù…±¥‘…Ñ•M•µ…¹Ñ¥½¹™¥œÈ¡¥¹ÁÕÐ€ôíô¤ì(€¥˜€ …¥¹ÁÕÐñðÑåÁ•½˜¥¹ÁÕÐ€„ôô€‰½‰©•ÐˆñðÉÉ…ä¹¥ÍÉÉ…ä¡¥¹ÁÕÐ¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÍ•ÑÑ¥¹ÌµÕÍÐ‰”…¸½‰©•Ðˆ¤ì(€™½È€¡½¹ÍÐ­•ä½˜=‰©•Ð¹­•åÌ¡¥¹ÁÕÐ¤¤(€€€¥˜€ …=9%}-eLÈ¹¡…Ì¡­•ä¤¤Ñ¡É½Ü¹•ÜÉÉ½È¡U¹­¹½Ý¸Í•µ…¹Ñ¥ŒÍ•ÑÑ¥¹œè€‘í­•åõ€¤ì(€¥˜€¡¥¹ÁÕÐ¹•¹…‰±•€„ôôÙ½¥€À€˜˜ÑåÁ•½˜¥¹ÁÕÐ¹•¹…‰±•€„ôô€‰‰½½±•…¸ˆ¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰•¹…‰±•µÕÍÐ‰”‰½½±•…¸ˆ¤ì(€¥˜€¡¥¹ÁÕÐ¹ÁÉ½Ù¥‘•È€„ôôÙ½¥€À€˜˜ÑåÁ•½˜¥¹ÁÕÐ¹ÁÉ½Ù¥‘•È€„ôô€‰ÍÑÉ¥¹œˆ¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰ÁÉ½Ù¥‘•ÈµÕÍÐ‰”„ÍÑÉ¥¹œˆ¤ì(€½¹ÍÐÁÉ½Ù¥‘•È€ô¥¹ÁÕÐ¹ÁÉ½Ù¥‘•È€üü€‰¹½¹”ˆì(€¥˜€ …l‰¹½¹”ˆ°€‰½±±…µ„ˆ°€‰½Á•¹…¤µ½µÁ…Ñ¥‰±”‰t¹¥¹±Õ‘•Ì¡ÁÉ½Ù¥‘•È¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰U¹­¹½Ý¸Í•µ…¹Ñ¥ŒÁÉ½Ù¥‘•Èˆ¤ì(€¥˜€¡¥¹ÁÕÐ¹É•µ½Ñ•½¹Í•¹Ð€„ôôÙ½¥€À€˜˜ÑåÁ•½˜¥¹ÁÕÐ¹É•µ½Ñ•½¹Í•¹Ð€„ôô€‰‰½½±•…¸ˆ¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰É•µ½Ñ•½¹Í•¹ÐµÕÍÐ‰”‰½½±•…¸ˆ¤ì(€¥˜€¡¥¹ÁÕÐ¹Ñ¥µ•½ÕÑ5Ì€„ôôÙ½¥€À€˜˜€ …9Õµ‰•È¹¥Í%¹Ñ••È¡¥¹ÁÕÐ¹Ñ¥µ•½ÕÑ5Ì¤ñð¥¹ÁÕÐ¹Ñ¥µ•½ÕÑ5Ì€ð€ÔÀÀñð¥¹ÁÕÐ¹Ñ¥µ•½ÕÑ5Ì€ø€Í”Ð¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰Ñ¥µ•½ÕÑ5ÌµÕÍÐ‰”…¸¥¹Ñ••È‰•ÑÝ••¸€ÔÀÀ…¹€ÌÀÀÀÀˆ¤ì(€¥˜€¡¥¹ÁÕÐ¹¡Õ¹­¡…ÉÌ€„ôôÙ½¥€À€˜˜€ …9Õµ‰•È¹¥Í%¹Ñ••È¡¥¹ÁÕÐ¹¡Õ¹­¡…ÉÌ¤ñð¥¹ÁÕÐ¹¡Õ¹­¡…ÉÌ€ð€ÈÔØñð¥¹ÁÕÐ¹¡Õ¹­¡…ÉÌ€ø€á”Ì¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰¡Õ¹­¡…ÉÌµÕÍÐ‰”…¸¥¹Ñ••È‰•ÑÝ••¸€ÈÔØ…¹€àÀÀÀˆ¤ì(€¥˜€¡¥¹ÁÕÐ¹µ¥¹M¥µ¥±…É¥Ñä€„ôôÙ½¥€À€˜˜€¡ÑåÁ•½˜¥¹ÁÕÐ¹µ¥¹M¥µ¥±…É¥Ñä€„ôô€‰¹Õµ‰•Èˆñð€…9Õµ‰•È¹¥Í¥¹¥Ñ”¡¥¹ÁÕÐ¹µ¥¹M¥µ¥±…É¥Ñä¤ñð¥¹ÁÕÐ¹µ¥¹M¥µ¥±…É¥Ñä€ð€Àñð¥¹ÁÕÐ¹µ¥¹M¥µ¥±…É¥Ñä€ø€Ä¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰µ¥¹M¥µ¥±…É¥ÑäµÕÍÐ‰”„™¥¹¥Ñ”¹Õµ‰•È‰•ÑÝ••¸€À…¹€Äˆ¤ì(€½¹ÍÐ•¹…‰±•€ô¥¹ÁÕÐ¹•¹…‰±•€üüÁÉ½Ù¥‘•È€„ôô€‰¹½¹”ˆì(€½¹ÍÐ‰…Í•UÉ°€ô¥¹ÁÕÐ¹‰…Í•UÉ°€ôôôÙ½¥€À€ü€ˆˆ€è¥¹ÁÕÐ¹‰…Í•UÉ°ì(€½¹ÍÐµ½‘•°€ô¥¹ÁÕÐ¹µ½‘•°€ôôôÙ½¥€À€ü€ˆˆ€è¥¹ÁÕÐ¹µ½‘•°ì(€½¹ÍÐÉ•‘•¹Ñ¥…±¹Ø€ô¥¹ÁÕÐ¹É•‘•¹Ñ¥…±¹Ø€ôôôÙ½¥€Àñð¥¹ÁÕÐ¹É•‘•¹Ñ¥…±¹Ø€ôôô¹Õ±°€ü€ˆˆ€è¥¹ÁÕÐ¹É•‘•¹Ñ¥…±¹Øì(€¥˜€¡ÑåÁ•½˜‰…Í•UÉ°€„ôô€‰ÍÑÉ¥¹œˆñðÑåÁ•½˜µ½‘•°€„ôô€‰ÍÑÉ¥¹œˆñðÑåÁ•½˜É•‘•¹Ñ¥…±¹Ø€„ôô€‰ÍÑÉ¥¹œˆ¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÁÉ½Ù¥‘•È™¥•±‘ÌµÕÍÐ‰”ÍÑÉ¥¹Ìˆ¤ì(€½¹ÍÐÑÉ¥µµ•‘	…Í”€ô‰…Í•UÉ°¹ÑÉ¥´ ¤ì(€½¹ÍÐÑÉ¥µµ•‘5½‘•°€ôµ½‘•°¹ÑÉ¥´ ¤ì(€½¹ÍÐÑÉ¥µµ•‘É•‘•¹Ñ¥…°€ôÉ•‘•¹Ñ¥…±¹Ø¹ÑÉ¥´ ¤ì(€¥˜€¡ÁÉ½Ù¥‘•È€ôôô€‰¹½¹”ˆ¤ì(€€€¥˜€¡•¹…‰±•¤Ñ¡É½Ü¹•ÜÉÉ½È ‰Q¡”¹½¹”ÁÉ½Ù¥‘•È…¹¹½Ð‰”•¹…‰±•ˆ¤ì(€€€¥˜€¡¥¹ÁÕÐ¹É•µ½Ñ•½¹Í•¹Ð€ôôôÑÉÕ”¤Ñ¡É½Ü¹•ÜÉÉ½È ‰É•µ½Ñ•½¹Í•¹Ð¥Ì¹½ÐÙ…±¥™½ÈÑ¡”¹½¹”ÁÉ½Ù¥‘•Èˆ¤ì(€€€É•ÑÕÉ¸ì(€€€€€•¹…‰±•è™…±Í”°(€€€€€ÁÉ½Ù¥‘•Èè€‰¹½¹”ˆ°(€€€€€‰…Í•UÉ°è€ˆˆ°(€€€€€µ½‘•°è€ˆˆ°(€€€€€É•‘•¹Ñ¥…±¹Øè€ˆˆ°(€€€€€É•µ½Ñ•½¹Í•¹Ðè™…±Í”(€€€ôì(€ô(€¥˜€ …•¹…‰±•€˜˜€…ÑÉ¥µµ•‘	…Í”€˜˜€…ÑÉ¥µµ•‘5½‘•°¤(€€€É•ÑÕÉ¸ì(€€€€€•¹…‰±•è™…±Í”°(€€€€€ÁÉ½Ù¥‘•È°(€€€€€‰…Í•UÉ°è€ˆˆ°(€€€€€µ½‘•°è€ˆˆ°(€€€€€É•‘•¹Ñ¥…±¹ØèÑÉ¥µµ•‘É•‘•¹Ñ¥…°°(€€€€€É•µ½Ñ•½¹Í•¹Ðè¥¹ÁÕÐ¹É•µ½Ñ•½¹Í•¹Ð€ôôôÑÉÕ”°(€€€€€Ñ¥µ•½ÕÑ5Ìè¥¹ÁÕÐ¹Ñ¥µ•½ÕÑ5Ì€üü€Å”Ð°(€€€€€¡Õ¹­¡…ÉÌè¥¹ÁÕÐ¹¡Õ¹­¡…ÉÌ€üü€ÄÈÀÀ°(€€€€€µ¥¹M¥µ¥±…É¥Ñäè¥¹ÁÕÐ¹µ¥¹M¥µ¥±…É¥Ñä€üü€À¸ÐÔ(€€€ôì(€¥˜€ …ÑÉ¥µµ•‘	…Í”ñðÑÉ¥µµ•‘	…Í”¹±•¹Ñ €ø€ÔÀÀñð€…ÑÉ¥µµ•‘5½‘•°ñðÑÉ¥µµ•‘5½‘•°¹±•¹Ñ €ø€ÈÀÀ¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÁÉ½Ù¥‘•È‰…Í”UI0…¹µ½‘•°…É”É•ÅÕ¥É•ˆ¤ì(€¥˜€¡ÑÉ¥µµ•‘É•‘•¹Ñ¥…°€˜˜€…9Y}95È¹Ñ•ÍÐ¡ÑÉ¥µµ•‘É•‘•¹Ñ¥…°¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰É•‘•¹Ñ¥…±¹ØµÕÍÐ‰”„Ù…±¥•¹Ù¥É½¹µ•¹ÐÙ…É¥…‰±”¹…µ”ˆ¤ì(€±•ÐÕÉ°ì(€ÑÉäì(€€€ÕÉ°€ô¹•ÜUI0¡ÑÉ¥µµ•‘	…Í”¤ì(€ô…Ñ ì(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÁÉ½Ù¥‘•È‰…Í”UI0¥Ì¥¹Ù…±¥ˆ¤ì(€ô(€¥˜€ …l‰¡ÑÑÀèˆ°€‰¡ÑÑÁÌè‰t¹¥¹±Õ‘•Ì¡ÕÉ°¹ÁÉ½Ñ½½°¤ñðÕÉ°¹ÕÍ•É¹…µ”ñðÕÉ°¹Á…ÍÍÝ½ÉñðÕÉ°¹Í•…É ñðÕÉ°¹¡…Í ¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÁÉ½Ù¥‘•ÈUI0µÕÍÐ‰”Á±…¥¸¡ÑÑÀ¡Ì¤Ý¥Ñ¡½ÕÐÉ•‘•¹Ñ¥…±Ì°ÅÕ•Éä°½È™É…µ•¹Ðˆ¤ì(€½¹ÍÐÉ•µ½Ñ”€ô€…±½½Á‰…¬È¡ÕÉ°¹¡½ÍÑ¹…µ”¤ì(€¥˜€¡É•µ½Ñ”€˜˜ÕÉ°¹ÁÉ½Ñ½½°€ôôô€‰¡ÑÑÀèˆ¤Ñ¡É½Ü¹•ÜÉÉ½È ‰I•µ½Ñ”Í•µ…¹Ñ¥ŒÁÉ½Ù¥‘•ÉÌÉ•ÅÕ¥É”!QQALˆ¤ì(€¥˜€¡É•µ½Ñ”€˜˜¥¹ÁÕÐ¹É•µ½Ñ•½¹Í•¹Ð€„ôôÑÉÕ”¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰I•µ½Ñ”Í•µ…¹Ñ¥ŒÁÉ½Ù¥‘•ÈÉ•ÅÕ¥É•Ì•áÁ±¥¥ÐÉ•µ½Ñ•½¹Í•¹Ðˆ¤ì(€¥˜€¡É•µ½Ñ”€˜˜€…ÑÉ¥µµ•‘É•‘•¹Ñ¥…°¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰I•µ½Ñ”Í•µ…¹Ñ¥ŒÁÉ½Ù¥‘•ÉÌÉ•ÅÕ¥É”„É•‘•¹Ñ¥…°•¹Ù¥É½¹µ•¹ÐÙ…É¥…‰±”ˆ¤ì(€É•ÑÕÉ¸ì(€€€•¹…‰±•°(€€€ÁÉ½Ù¥‘•È°(€€€‰…Í•UÉ°èÕÉ°¹Ñ½MÑÉ¥¹œ ¤¹É•Á±…” ½p¼¬¼°€ˆˆ¤°(€€€µ½‘•°èÑÉ¥µµ•‘5½‘•°°(€€€É•‘•¹Ñ¥…±¹ØèÑÉ¥µµ•‘É•‘•¹Ñ¥…°°(€€€É•µ½Ñ•½¹Í•¹Ðè¥¹ÁÕÐ¹É•µ½Ñ•½¹Í•¹Ð€ôôôÑÉÕ”°(€€€Ñ¥µ•½ÕÑ5Ìè¥¹ÁÕÐ¹Ñ¥µ•½ÕÑ5Ì€üü€Å”Ð°(€€€¡Õ¹­¡…ÉÌè¥¹ÁÕÐ¹¡Õ¹­¡…ÉÌ€üü€ÄÈÀÀ°(€€€µ¥¹M¥µ¥±…É¥Ñäè¥¹ÁÕÐ¹µ¥¹M¥µ¥±…É¥Ñä€üü€À¸ÐÔ(€ôì)ô)™Õ¹Ñ¥½¸É•…Ñ•M•µ…¹Ñ¥M•ÑÑ¥¹ÍMÑ…Ñ” ¤ì(€É•ÑÕÉ¸ì‘•™…Õ±ÑUÁ‘…Ñ•‘Ðè€¼¨}}AUI}|€¨¼¹•Ü5…À ¤ôì)ô)™Õ¹Ñ¥½¸Á…Ñ¡½È¡Ù…Õ±Ñ%¤ì(€¥˜€ „½ym„µ˜À´åuìÈÑô¼¹Ñ•ÍÐ¡Ù…Õ±Ñ%ñð€ˆˆ¤¤Ñ¡É½Ü¹•ÜÉÉ½È ‰%¹Ù…±¥Y…Õ±Ð‰¥¹‘¥¹œˆ¤ì(€½¹ÍÐ‘¥É•Ñ½Éä€ô­¹½Ý±•‘•¥É•Ñ½Éä ¤ì(€¥˜€ …‘¥É•Ñ½Éä¤Ñ¡É½Ü¹•ÜÉÉ½È ‰ÁÁ±¥…Ñ¥½¸­¹½Ý±•‘”‘¥É•Ñ½Éä¥Ì¹½Ð½¹™¥ÕÉ•ˆ¤ì(€É•ÑÕÉ¸©½¥¸ÄÀ¡‘¥É•Ñ½Éä°Ù…Õ±Ñ%°€‰Í•µ…¹Ñ¥Œ¹©Í½¸ˆ¤ì)ô)…Íå¹Œ™Õ¹Ñ¥½¸…ÍÍ•ÉÑ¥É•Ñ½Éä¡Á…Ñ ¤ì(€ÑÉäì(€€€½¹ÍÐÍÑ…ÐÔ€ô…Ý…¥Ð±ÍÑ…ÐÈ¡Á…Ñ ¤ì(€€€¥˜€ …ÍÑ…ÐÔ¹¥Í¥É•Ñ½Éä ¤ñðÍÑ…ÐÔ¹¥ÍMåµ‰½±¥1¥¹¬ ¤¤Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÍ•ÑÑ¥¹ÌÁ…Ñ ¥ÌÕ¹Í…™”ˆ¤ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€¥˜€¡•ÉÉ½È¹½‘”€„ôô€‰9=9Pˆ¤Ñ¡É½Ü•ÉÉ½Èì(€€€…Ý…¥Ðµ­‘¥ÈÔ¡Á…Ñ °ìÉ•ÕÉÍ¥Ù”èÑÉÕ”°µ½‘”è€ÐÐàô¤ì(€€€½¹ÍÐÍÑ…ÐÔ€ô…Ý…¥Ð±ÍÑ…ÐÈ¡Á…Ñ ¤ì(€€€¥˜€ …ÍÑ…ÐÔ¹¥Í¥É•Ñ½Éä ¤ñðÍÑ…ÐÔ¹¥ÍMåµ‰½±¥1¥¹¬ ¤¤Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÍ•ÑÑ¥¹ÌÁ…Ñ ¥ÌÕ¹Í…™”ˆ¤ì(€ô(€±•Ð…¹•ÍÑ½È€ôÁ…Ñ ì(€™½È€¡±•Ð‘•ÁÑ €ô€Àì‘•ÁÑ €ð€à€˜˜…¹•ÍÑ½È€„ôô‘¥É¹…µ”Ô¡…¹•ÍÑ½È¤ì‘•ÁÑ ¬¬¤ì(€€€ÑÉäì(€€€€€¥˜€ ¡…Ý…¥Ð±ÍÑ…ÐÈ¡…¹•ÍÑ½È¤¤¹¥ÍMåµ‰½±¥1¥¹¬ ¤¤Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÍ•ÑÑ¥¹Ì…¹•ÍÑ½È¥ÌÕ¹Í…™”ˆ¤ì(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€¥˜€¡•ÉÉ½È¹½‘”€„ôô€‰9=9Pˆ¤Ñ¡É½Ü•ÉÉ½Èì(€€€ô(€€€…¹•ÍÑ½È€ô‘¥É¹…µ”Ô¡…¹•ÍÑ½È¤ì(€ô)ô)…Íå¹Œ™Õ¹Ñ¥½¸…ÍÍ•ÉÑ¥±”¡Á…Ñ ¤ì(€ÑÉäì(€€€½¹ÍÐÍÑ…ÐÔ€ô…Ý…¥Ð±ÍÑ…ÐÈ¡Á…Ñ ¤ì(€€€¥˜€ …ÍÑ…ÐÔ¹¥Í¥±” ¤ñðÍÑ…ÐÔ¹¥ÍMåµ‰½±¥1¥¹¬ ¤ñðÍÑ…ÐÔ¹Í¥é”€ø5a}%1}	eQL¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÍ•ÑÑ¥¹Ì™¥±”¥ÌÕ¹Í…™”½ÈÑ½¼±…É”ˆ¤ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€¥˜€¡•ÉÉ½È¹½‘”€„ôô€‰9=9Pˆ¤Ñ¡É½Ü•ÉÉ½Èì(€ô)ô)™Õ¹Ñ¥½¸¹½Éµ…±¥é”¡Ù…±Õ”°É•Ù¥Í¥½¸°ÕÁ‘…Ñ•‘Ð€ô¹Õ±°¤ì(€¥˜€ …Ù…±Õ”ñðÑåÁ•½˜Ù…±Õ”€„ôô€‰½‰©•ÐˆñðÉÉ…ä¹¥ÍÉÉ…ä¡Ù…±Õ”¤ñðÙ…±Õ”¹Ù•ÉÍ¥½¸€„ôô€Ä¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰%¹Ù…±¥½È™ÕÑÕÉ”Í•µ…¹Ñ¥ŒÍ•ÑÑ¥¹ÌÍ¡•µ„ˆ¤ì(€™½È€¡½¹ÍÐ­•ä½˜=‰©•Ð¹­•åÌ¡Ù…±Õ”¤¤(€€€¥˜€ …MQQ%9M}-eL¹¡…Ì¡­•ä¤¤Ñ¡É½Ü¹•ÜÉÉ½È¡U¹­¹½Ý¸Í•µ…¹Ñ¥ŒÍ•ÑÑ¥¹œè€‘í­•åõ€¤ì(€¥˜€ …9Õµ‰•È¹¥ÍM…™•%¹Ñ••È¡É•Ù¥Í¥½¸¤ñð9Õµ‰•È¡É•Ù¥Í¥½¸¤€ð€À¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰%¹Ù…±¥Í•µ…¹Ñ¥ŒÍ•ÑÑ¥¹ÌÉ•Ù¥Í¥½¸ˆ¤ì(€½¹ÍÐÉ…Ü€ôÙ…±Õ”ì(€½¹ÍÐ½¹™¥œ€ôÙ…±¥‘…Ñ•M•µ…¹Ñ¥½¹™¥œÈ¡ì(€€€•¹…‰±•èÉ…Ü¹•¹…‰±•°(€€€ÁÉ½Ù¥‘•ÈèÉ…Ü¹ÁÉ½Ù¥‘•È°(€€€‰…Í•UÉ°èÉ…Ü¹‰…Í•UÉ°°(€€€µ½‘•°èÉ…Ü¹µ½‘•°°(€€€É•‘•¹Ñ¥…±¹ØèÉ…Ü¹É•‘•¹Ñ¥…±¹Ø°(€€€É•µ½Ñ•½¹Í•¹ÐèÉ…Ü¹É•µ½Ñ•½¹Í•¹Ð°(€€€Ñ¥µ•½ÕÑ5ÌèÉ…Ü¹Ñ¥µ•½ÕÑ5Ì°(€€€¡Õ¹­¡…ÉÌèÉ…Ü¹¡Õ¹­¡…ÉÌ°(€€€µ¥¹M¥µ¥±…É¥ÑäèÉ…Ü¹µ¥¹M¥µ¥±…É¥Ñä(€ô¤ì(€¥˜€¡ÕÁ‘…Ñ•‘Ð€„ôô¹Õ±°€˜˜€¡ÑåÁ•½˜ÕÁ‘…Ñ•‘Ð€„ôô€‰ÍÑÉ¥¹œˆñð9Õµ‰•È¹¥Í9…8¡…Ñ”¹Á…ÉÍ”¡ÕÁ‘…Ñ•‘Ð¤¤¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰%¹Ù…±¥Í•µ…¹Ñ¥ŒÍ•ÑÑ¥¹ÌÕÁ‘…Ñ•‘Ðˆ¤ì(€É•ÑÕÉ¸ì(€€€Ù•ÉÍ¥½¸è€Ä°(€€€É•Ù¥Í¥½¸è9Õµ‰•È¡É•Ù¥Í¥½¸¤°(€€€€¸¸¹½¹™¥œ°(€€€ÕÁ‘…Ñ•‘ÐèÕÁ‘…Ñ•‘Ð€üü€ ¼¨}}AUI}|€¨¼¹•Ü…Ñ” ¤¤¹Ñ½%M=MÑÉ¥¹œ ¤(€ôì)ô)™Õ¹Ñ¥½¸‘•™…Õ±ÑM•ÑÑ¥¹Ì¡ÍÑ…Ñ”Ì°Á…Ñ ¤ì(€½¹ÍÐÕÁ‘…Ñ•‘Ð€ôÍÑ…Ñ”Ì¹‘•™…Õ±ÑUÁ‘…Ñ•‘Ð¹•Ð¡Á…Ñ ¤ñð€ ¼¨}}AUI}|€¨¼¹•Ü…Ñ” ¤¤¹Ñ½%M=MÑÉ¥¹œ ¤ì(€ÍÑ…Ñ”Ì¹‘•™…Õ±ÑUÁ‘…Ñ•‘Ð¹Í•Ð¡Á…Ñ °ÕÁ‘…Ñ•‘Ð¤ì(€É•ÑÕÉ¸ìÙ•ÉÍ¥½¸è€Ä°É•Ù¥Í¥½¸è€À°€¸¸¹Ù…±¥‘…Ñ•M•µ…¹Ñ¥½¹™¥œÈ¡íô¤°ÕÁ‘…Ñ•‘Ðôì)ô)…Íå¹Œ™Õ¹Ñ¥½¸É•…‘U¹±½­•¡ÍÑ…Ñ”Ì°Á…Ñ ¤ì(€…Ý…¥Ð…ÍÍ•ÉÑ¥É•Ñ½Éä¡‘¥É¹…µ”Ô¡Á…Ñ ¤¤ì(€…Ý…¥Ð…ÍÍ•ÉÑ¥±”¡Á…Ñ ¤ì(€ÑÉäì(€€€½¹ÍÐÉ…Ü€ô…Ý…¥ÐÉ•…‘¥±”à¡Á…Ñ °ì•¹½‘¥¹œè€‰ÕÑ˜àˆ°™±…œè€‰Èˆô¤ì(€€€¥˜€¡	Õ™™•È¹‰åÑ•1•¹Ñ ¡É…Ü¤€ø5a}%1}	eQL¤Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÍ•ÑÑ¥¹Ì™¥±”¥ÌÑ½¼±…É”ˆ¤ì(€€€½¹ÍÐÙ…±Õ”€ô)M=8¹Á…ÉÍ”¡É…Ü¤ì(€€€É•ÑÕÉ¸¹½Éµ…±¥é”¡Ù…±Õ”°Ù…±Õ”¹É•Ù¥Í¥½¸°Ù…±Õ”¹ÕÁ‘…Ñ•‘Ð¤ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€¥˜€¡•ÉÉ½È¹½‘”€ôôô€‰9=9Pˆ¤É•ÑÕÉ¸‘•™…Õ±ÑM•ÑÑ¥¹Ì¡ÍÑ…Ñ”Ì°Á…Ñ ¤ì(€€€¥˜€¡•ÉÉ½È¥¹ÍÑ…¹•½˜Må¹Ñ…áÉÉ½È¤Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÍ•ÑÑ¥¹Ì…¹¹½Ð‰”É•…è¥¹Ù…±¥)M=8ˆ¤ì(€€€Ñ¡É½Ü¹•ÜÉÉ½È (€€€€€M•µ…¹Ñ¥ŒÍ•ÑÑ¥¹Ì…¹¹½Ð‰”É•…è€‘í•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€ü•ÉÉ½È¹µ•ÍÍ…”€èMÑÉ¥¹œ¡•ÉÉ½È¥õ€(€€€€¤ì(€ô)ô)™Õ¹Ñ¥½¸É•…Ñ•M•µ…¹Ñ¥M•ÑÑ¥¹ÍÁ¤¡ÍÑ…Ñ”Ì€ôÉ•…Ñ•M•µ…¹Ñ¥M•ÑÑ¥¹ÍMÑ…Ñ” ¤¤ì(€É•ÑÕÉ¸ì(€€€É•…‘M•µ…¹Ñ¥M•ÑÑ¥¹Ìè…Íå¹Œ€¡Ù…Õ±Ñ%¤€ôøÉ•…‘U¹±½­•¡ÍÑ…Ñ”Ì°Á…Ñ¡½È¡Ù…Õ±Ñ%¤¤°(€€€Í…Ù•M•µ…¹Ñ¥M•ÑÑ¥¹Ìè…Íå¹Œ€¡Ù…Õ±Ñ%°¥¹ÁÕÐ°•áÁ•Ñ•‘I•Ù¥Í¥½¸¤€ôøì(€€€€€½¹ÍÐÁ…Ñ €ôÁ…Ñ¡½È¡Ù…Õ±Ñ%¤ì(€€€€€½¹ÍÐÕÉÉ•¹Ð€ô…Ý…¥ÐÉ•…‘U¹±½­•¡ÍÑ…Ñ”Ì°Á…Ñ ¤ì(€€€€€¥˜€ …9Õµ‰•È¹¥ÍM…™•%¹Ñ••È¡•áÁ•Ñ•‘I•Ù¥Í¥½¸¤ñð•áÁ•Ñ•‘I•Ù¥Í¥½¸€„ôôÕÉÉ•¹Ð¹É•Ù¥Í¥½¸¤(€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÍ•ÑÑ¥¹ÌÉ•Ù¥Í¥½¸¥ÌÍÑ…±”ˆ¤ì(€€€€€½¹ÍÐÙ…±Õ”€ô¹½Éµ…±¥é”¡ìÙ•ÉÍ¥½¸è€Ä°€¸¸¹¥¹ÁÕÐô°ÕÉÉ•¹Ð¹É•Ù¥Í¥½¸€¬€Ä¤ì(€€€€€½¹ÍÐ‘¥È€ô‘¥É¹…µ”Ô¡Á…Ñ ¤ì(€€€€€…Ý…¥Ð…ÍÍ•ÉÑ¥É•Ñ½Éä¡‘¥È¤ì(€€€€€™½È€¡½¹ÍÐ•¹ÑÉä½˜…Ý…¥ÐÉ•…‘‘¥ÈÈ¡‘¥È¤¤(€€€€€€€¥˜€ ½yÍ•µ…¹Ñ¥p¹m„µ˜À´äµt­p¹ÑµÀ¼¹Ñ•ÍÐ¡•¹ÑÉä¤¤…Ý…¥ÐÕ¹±¥¹¬¡©½¥¸ÄÀ¡‘¥È°•¹ÑÉä¤¤¹…Ñ   ¤€ôøì(€€€€€€€ô¤ì(€€€€€½¹ÍÐÑ•µÀ€ô©½¥¸ÄÀ¡‘¥È°Í•µ…¹Ñ¥Œ¸‘íÉ…¹‘½µUU%Ø ¥ô¹ÑµÁ€¤ì(€€€€€ÑÉäì(€€€€€€€…Ý…¥ÐÝÉ¥Ñ•¥±”Ø¡Ñ•µÀ°€‘í)M=8¹ÍÑÉ¥¹¥™ä¡Ù…±Õ”°¹Õ±°°€È¥ô)€°ìµ½‘”è€ÌàÐ°™±…œè€‰Ýàˆô¤ì(€€€€€€€…Ý…¥ÐÉ•¹…µ”Ø¡Ñ•µÀ°Á…Ñ ¤ì(€€€€€ô™¥¹…±±äì(€€€€€€€…Ý…¥ÐÕ¹±¥¹¬¡Ñ•µÀ¤¹…Ñ   ¤€ôøì(€€€€€€€ô¤ì(€€€€€ô(€€€€€É•ÑÕÉ¸Ù…±Õ”ì(€€€ô(€ôì)ô)Ù…È‘•™…Õ±ÑÁ¤€ôÉ•…Ñ•M•µ…¹Ñ¥M•ÑÑ¥¹ÍÁ¤ ¤ì)Ù…ÈÉ•…‘M•µ…¹Ñ¥M•ÑÑ¥¹Ì€ô€¡Ù…Õ±Ñ%¤€ôø‘•™…Õ±ÑÁ¤¹É•…‘M•µ…¹Ñ¥M•ÑÑ¥¹Ì¡Ù…Õ±Ñ%¤ì)Ù…ÈÍ…Ù•M•µ…¹Ñ¥M•ÑÑ¥¹Ì€ô€¡Ù…Õ±Ñ%°¥¹ÁÕÐ°•áÁ•Ñ•‘I•Ù¥Í¥½¸¤€ôø‘•™…Õ±ÑÁ¤¹Í…Ù•M•µ…¹Ñ¥M•ÑÑ¥¹Ì¡Ù…Õ±Ñ%°¥¹ÁÕÐ°•áÁ•Ñ•‘I•Ù¥Í¥½¸¤ì((¼¼Á…­…•Ì½­¹½Ý±•‘”½ÍÉŒ½Í•ÉÙ¥”¹ÑÌ)¥¹¥Ñ}Õ¥}ÍÑ…Ñ” ¤ì)Ù…ÈÁ½½°€ôÉÕ¹Ñ¥µ•M±½ÐÈ ‰­¹½Ý±•‘”ˆ°€‰Ý½É­•ÉA½½°ˆ°€ ¤€ôøì(€½¹ÍÐÍ•ÉÙ¥•Ì€ô€¼¨}}AUI}|€¨¼¹•Ü5…À ¤ì(€É•ÑÕÉ¸=‰©•Ð¹…ÍÍ¥¸¡Í•ÉÙ¥•Ì°ì(€€€…Íå¹Œ‘¥ÍÁ½Í” ¤ì(€€€€€½¹ÍÐ…±±½…Ñ•€ôl¸¸¹Í•ÉÙ¥•Ì¹Ù…±Õ•Ì ¥tì(€€€€€Í•ÉÙ¥•Ì¹±•…È ¤ì(€€€€€…Ý…¥ÐAÉ½µ¥Í”¹…±±M•ÑÑ±•¡…±±½…Ñ•¹µ…À ¡Í•ÉÙ¥”¤€ôøÍ•ÉÙ¥”¹±½Í” ¤¤¤ì(€€€ô(€ô¤ì)ô¤ì)Ù…ÈMIY%}Y9P€ô€‰‘É½¹”é­¹½Ý±•‘”µÍ•ÉÙ¥”½ØÄˆì)Ù…ÈÍ•ÉÙ¥•5½‘Õ±”€ôíôì)ÁÉ½•ÍÌ¹½¸¡MIY%}Y9P°€¡Á…å±½…¤€ôøì(€¥˜€ …Á…å±½…ñðÁ…å±½…¹½É¥¥¸€ôôôÍ•ÉÙ¥•5½‘Õ±”ñðÑåÁ•½˜Á…å±½…¹­•ä€„ôô€‰ÍÑÉ¥¹œˆ¤É•ÑÕÉ¸ì(€¥˜€ ¡Á…å±½…¹…Ñ¥½¸€ôôô€‰É•¥ÍÑ•ÈˆñðÁ…å±½…¹…Ñ¥½¸€ôôô€‰É•ÍÁ½¹Í”ˆ¤€˜˜Á…å±½…¹Í•ÉÙ¥”¤ì(€€€Á½½°¹Í•Ð¡Á…å±½…¹­•ä°Á…å±½…¹Í•ÉÙ¥”¤ì(€€€É•ÑÕÉ¸ì(€ô(€¥˜€¡Á…å±½…¹…Ñ¥½¸€ôôô€‰É•ÅÕ•ÍÐˆ¤ì(€€€½¹ÍÐÍ•ÉÙ¥”€ôÁ½½°¹•Ð¡Á…å±½…¹­•ä¤ì(€€€¥˜€¡Í•ÉÙ¥”€˜˜€…Í•ÉÙ¥”¹±½Í•¤(€€€€€•µ¥ÑAÉ½•ÍÍÙ•¹ÐÈ¡MIY%}Y9P°ì(€€€€€€€…Ñ¥½¸è€‰É•ÍÁ½¹Í”ˆ°(€€€€€€€­•äèÁ…å±½…¹­•ä°(€€€€€€€Í•ÉÙ¥”°(€€€€€€€½É¥¥¸èÍ•ÉÙ¥•5½‘Õ±”(€€€€€ô¤ì(€ô)ô¤ì)Ù…È5a}Q%-QL€ô€ÄÈàì)™Õ¹Ñ¥½¸ÅÕ•Õ•M•µ…¹Ñ¥Œ¡­•ä°Ñ…Í¬È¤ì(€É•ÑÕÉ¸ÉÕ¹IÕ¹Ñ¥µ•á±ÕÍ¥Ù”È ‰Í•µ…¹Ñ¥Œµ±½¬ˆ°­•ä°Ñ…Í¬È¤ì)ô)™Õ¹Ñ¥½¸ÁÉ½Ù¥‘•É½¹™¥œ¡Í•ÑÑ¥¹ÌÈ¤ì(€É•ÑÕÉ¸ì(€€€•¹…‰±•èÍ•ÑÑ¥¹ÌÈ¹•¹…‰±•°(€€€ÁÉ½Ù¥‘•ÈèÍ•ÑÑ¥¹ÌÈ¹ÁÉ½Ù¥‘•È°(€€€‰…Í•UÉ°èÍ•ÑÑ¥¹ÌÈ¹‰…Í•UÉ°°(€€€µ½‘•°èÍ•ÑÑ¥¹ÌÈ¹µ½‘•°°(€€€É•‘•¹Ñ¥…±¹ØèÍ•ÑÑ¥¹ÌÈ¹É•‘•¹Ñ¥…±¹Ø°(€€€É•µ½Ñ•½¹Í•¹ÐèÍ•ÑÑ¥¹ÌÈ¹É•µ½Ñ•½¹Í•¹Ð°(€€€Ñ¥µ•½ÕÑ5ÌèÍ•ÑÑ¥¹ÌÈ¹Ñ¥µ•½ÕÑ5Ì°(€€€¡Õ¹­¡…ÉÌèÍ•ÑÑ¥¹ÌÈ¹¡Õ¹­¡…ÉÌ°(€€€µ¥¹M¥µ¥±…É¥ÑäèÍ•ÑÑ¥¹ÌÈ¹µ¥¹M¥µ¥±…É¥Ñä(€ôì)ô)™Õ¹Ñ¥½¸™¥¹•ÉÁÉ¥¹Ñ½È¡Í•ÑÑ¥¹ÌÈ¤ì(€É•ÑÕÉ¸É•…Ñ•!…Í ä ‰Í¡„ÈÔØˆ¤¹ÕÁ‘…Ñ”¡€‘íÍ•ÑÑ¥¹ÌÈ¹ÁÉ½Ù¥‘•ÉõpÀ‘íÍ•ÑÑ¥¹ÌÈ¹‰…Í•UÉ±õpÀ‘íÍ•ÑÑ¥¹ÌÈ¹µ½‘•±õpÀ‘íÍ•ÑÑ¥¹ÌÈ¹¡Õ¹­¡…ÉÌñð€ÄÈÀÁõ€¤¹‘¥•ÍÐ ‰¡•àˆ¤ì)ô)™Õ¹Ñ¥½¸…Ý…¥ÑM•µ…¹Ñ¥•…‘±¥¹”¡½Á•É…Ñ¥½¸°½¹ÑÉ½±±•È¤ì(€±•Ð½¹‰½ÉÐì(€½¹ÍÐ…‰½ÉÑ•€ô¹•ÜAÉ½µ¥Í” ¡|°É•©•Ð¤€ôøì(€€€½¹‰½ÉÐ€ô€ ¤€ôøÉ•©•Ð¡¹•ÜÉÉ½È ‰Í•µ…¹Ñ¥Œ…¹‘¥‘…Ñ”ÁÉ½Ù¥‘•ÈÑ¥µ•½ÕÐˆ¤¤ì(€€€½¹ÑÉ½±±•È¹Í¥¹…°¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰…‰½ÉÐˆ°½¹‰½ÉÐ°ì½¹”èÑÉÕ”ô¤ì(€ô¤ì(€É•ÑÕÉ¸AÉ½µ¥Í”¹É…”¡mAÉ½µ¥Í”¹É•Í½±Ù”¡½Á•É…Ñ¥½¸¤°…‰½ÉÑ•‘t¤¹™¥¹…±±ä (€€€€ ¤€ôø½¹ÑÉ½±±•È¹Í¥¹…°¹É•µ½Ù•Ù•¹Ñ1¥ÍÑ•¹•È ‰…‰½ÉÐˆ°½¹‰½ÉÐ¤(€€¤ì)ô)…Íå¹Œ™Õ¹Ñ¥½¸…ÍÍ•ÉÑ	¥¹‘¥¹œ¡‰¥¹‘¥¹œ¤ì(€½¹ÍÐÕÉÉ•¹Ð€ô…Ý…¥ÐÉ•…‘-¹½Ý±•‘•	¥¹‘¥¹œ¡ì™É•Í èÑÉÕ”ô¤ì(€¥˜€ …ÕÉÉ•¹ÐñðÕÉÉ•¹Ð¹Ù…Õ±Ñ%€„ôô‰¥¹‘¥¹œ¹Ù…Õ±Ñ%ñðÕÉÉ•¹Ð¹É•Ù¥Í¥½¸€„ôô‰¥¹‘¥¹œ¹É•Ù¥Í¥½¸¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰-¹½Ý±•‘”‰¥¹‘¥¹œ¡…¹•ìÍÑ…ÉÐ„¹•ÜÑÕÉ¸‰•™½É”É•…‘¥¹œ½ÈÝÉ¥Ñ¥¹œˆ¤ì)ô)Ù…È-¹½Ý±•‘•M•ÉÙ¥”€ô±…ÍÌì(€½¹ÍÑÉÕÑ½È¡‰¥¹‘¥¹œ°‘¥É•Ñ½Éä€ô­¹½Ý±•‘•¥É•Ñ½Éä ¤°½ÁÑ¥½¹Ì€ôíô¤ì(€€€Ñ¡¥Ì¹‰¥¹‘¥¹œ€ô‰¥¹‘¥¹œì(€€€Ñ¡¥Ì¹Í•µ…¹Ñ¥…¹‘¥‘…Ñ•AÉ½Ù¥‘•È€ôÑåÁ•½˜½ÁÑ¥½¹Ì¹Í•µ…¹Ñ¥…¹‘¥‘…Ñ•AÉ½Ù¥‘•È€ôôô€‰™Õ¹Ñ¥½¸ˆ€ü½ÁÑ¥½¹Ì¹Í•µ…¹Ñ¥…¹‘¥‘…Ñ•AÉ½Ù¥‘•È€è¹Õ±°ì(€€€Ñ¡¥Ì¹Ñ¥­•ÑÌ€ô€¼¨}}AUI}|€¨¼¹•Ü5…À ¤ì(€€€Ñ¡¥Ì¹Á•¹‘¥¹œ€ô€¼¨}}AUI}|€¨¼¹•Ü5…À ¤ì(€€€Ñ¡¥Ì¹¹•áÐ€ô€Àì(€€€Ñ¡¥Ì¹±½Í•€ô™…±Í”ì(€€€Ñ¡¥Ì¹±½Í¥¹œ€ô™…±Í”ì(€€€Ñ¡¥Ì¹±½Í•AÉ½µ¥Í”€ô¹Õ±°ì(€€€Ñ¡¥Ì¹Ý½É­•È€ôÉ•…Ñ•-¹½Ý±•‘•]½É­•È¡¹•ÜUI0 ˆ¸½Ý½É­•È¹µ©Ìˆ°¥µÁ½ÉÐ¹µ•Ñ„¹ÕÉ°¤°ì(€€€€€Ý½É­•É…Ñ„èìÙ…Õ±Ðè‰¥¹‘¥¹œ¹Ù…Õ±Ð°‘…Ñ…‰…Í”è©½¥¸ÄÄ¡‘¥É•Ñ½Éä°‰¥¹‘¥¹œ¹Ù…Õ±Ñ%°€‰¥¹‘•à¹ÍÅ±¥Ñ”ˆ¤ô°(€€€€€•á•ÉØèÁÉ½•ÍÌ¹•á•ÉØ¹™¥±Ñ•È (€€€€€€€€¡…Éœ¤€ôø€……Éœ¹ÍÑ…ÉÑÍ]¥Ñ  ˆ´µ¥¹ÁÕÐµÑåÁ”ˆ¤€˜˜€……Éœ¹ÍÑ…ÉÑÍ]¥Ñ  ˆ´µÑ•ÍÐˆ¤(€€€€€€¤(€€€ô¤ì(€€€½¹ÍÐ™…¥°€ô€¡•ÉÉ½È¤€ôøì(€€€€€Ñ¡¥Ì¹±½Í•€ôÑÉÕ”ì(€€€€€™½È€¡½¹ÍÐ¥Ñ•´½˜Ñ¡¥Ì¹Á•¹‘¥¹œ¹Ù…±Õ•Ì ¤¤ì(€€€€€€€±•…ÉQ¥µ•½ÕÐ¡¥Ñ•´¹Ñ¥µ•È¤ì(€€€€€€€¥Ñ•´¹É•©•Ð¡•ÉÉ½È¤ì(€€€€€ô(€€€€€Ñ¡¥Ì¹Á•¹‘¥¹œ¹±•…È ¤ì(€€€€€Ñ¡¥Ì¹Ý½É­•È¹Õ¹É•˜ ¤ì(€€€ôì(€€€Ñ¡¥Ì¹Ý½É­•È¹½¸ ‰µ•ÍÍ…”ˆ°€¡µ•ÍÍ…”¤€ôøì(€€€€€¥˜€¡µ•ÍÍ…”¹É•…‘ä¤É•ÑÕÉ¸ì(€€€€€¥˜€¡µ•ÍÍ…”¹Õ¥¡…¹•¤ì(€€€€€€€¥¹Ù…±¥‘…Ñ•-¹½Ý±•‘•U¤ ¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€ô(€€€€€½¹ÍÐ¥Ñ•´€ôÑ¡¥Ì¹Á•¹‘¥¹œ¹•Ð¡µ•ÍÍ…”¹¥¤ì(€€€€€¥˜€ …¥Ñ•´¤É•ÑÕÉ¸ì(€€€€€±•…ÉQ¥µ•½ÕÐ¡¥Ñ•´¹Ñ¥µ•È¤ì(€€€€€Ñ¡¥Ì¹Á•¹‘¥¹œ¹‘•±•Ñ”¡µ•ÍÍ…”¹¥¤ì(€€€€€¥˜€ …Ñ¡¥Ì¹Á•¹‘¥¹œ¹Í¥é”¤Ñ¡¥Ì¹Ý½É­•È¹Õ¹É•˜ ¤ì(€€€€€¥˜€¡µ•ÍÍ…”¹•ÉÉ½È¤¥Ñ•´¹É•©•Ð¡¹•ÜÉÉ½È¡µ•ÍÍ…”¹•ÉÉ½È¤¤ì(€€€€€•±Í”¥Ñ•´¹É•Í½±Ù”¡µ•ÍÍ…”¹É•ÍÕ±Ð¤ì(€€€ô¤ì(€€€Ñ¡¥Ì¹Ý½É­•È¹½¸ ‰•ÉÉ½Èˆ°™…¥°¤ì(€€€Ñ¡¥Ì¹Ý½É­•È¹½¸ ‰•á¥Ðˆ°€¡½‘”¤€ôøì(€€€€€¥˜€ …Ñ¡¥Ì¹±½Í•¤™…¥°¡¹•ÜÉÉ½È¡-¹½Ý±•‘”Ý½É­•È•á¥Ñ•€ ‘í½‘•ô¥€¤¤ì(€€€ô¤ì(€€€Ñ¡¥Ì¹Ý½É­•È¹Õ¹É•˜ ¤ì(€ô(€É•ÅÕ•ÍÐ¡½À°…ÉÌ€ôíô¤ì(€€€¥˜€¡Ñ¡¥Ì¹±½Í•ñðÑ¡¥Ì¹±½Í¥¹œ€˜˜½À€„ôô€‰±½Í”ˆ¤(€€€€€É•ÑÕÉ¸AÉ½µ¥Í”¹É•©•Ð¡¹•ÜÉÉ½È ‰-¹½Ý±•‘”Í•ÉÙ¥”¥Ì±½Í•ˆ¤¤ì(€€€½¹ÍÐ¥€ô€¬­Ñ¡¥Ì¹¹•áÐì(€€€Ñ¡¥Ì¹Ý½É­•È¹É•˜ ¤ì(€€€É•ÑÕÉ¸¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù•AÉ½µ¥Í”°É•©•Ð¤€ôøì(€€€€€½¹ÍÐÑ¥µ•È€ôÍ•ÑQ¥µ•½ÕÐ (€€€€€€€€ ¤€ôøì(€€€€€€€€€Ñ¡¥Ì¹Á•¹‘¥¹œ¹‘•±•Ñ”¡¥¤ì(€€€€€€€€€¥˜€ …Ñ¡¥Ì¹Á•¹‘¥¹œ¹Í¥é”¤Ñ¡¥Ì¹Ý½É­•È¹Õ¹É•˜ ¤ì(€€€€€€€€€É•©•Ð¡¹•ÜÉÉ½È¡-¹½Ý±•‘”€‘í½ÁôÑ¥µ•½ÕÐì¥ÐÝ…Ì¹½ÐÉ•Á½ÉÑ•…Ì„ÍÕ•ÍÍ™Õ°•µÁÑäÉ•ÍÕ±Ñ€¤¤ì(€€€€€€€ô°(€€€€€€€½À€ôôô€‰É•½¹¥±”ˆ€ü€ÄÉ”Ð€è€É”Ð(€€€€€€¤ì(€€€€€Ñ¡¥Ì¹Á•¹‘¥¹œ¹Í•Ð¡¥°ìÉ•Í½±Ù”èÉ•Í½±Ù•AÉ½µ¥Í”°É•©•Ð°Ñ¥µ•Èô¤ì(€€€€€Ñ¡¥Ì¹Ý½É­•È¹Á½ÍÑ5•ÍÍ…”¡ì¥°½À°…ÉÌô¤ì(€€€ô¤ì(€ô(€…Íå¹ŒÁÉ•Á…É”¡ìÝ°ÁÉ½©•Ð°ÅÕ•Éä€ô€ˆˆô¤ì(€€€É•ÑÕÉ¸Ý¥Ñ¡-¹½Ý±•‘•	¥¹‘¥¹œ¡Ñ¡¥Ì¹‰¥¹‘¥¹œ°…Íå¹Œ€ ¤€ôøì(€€€€€½¹ÍÐÁ…Ñ¡Ì€ôl‰!½µ”¹µˆ°€‰]¥­¤½%¹‘•à¹µ‰tì(€€€€€¥˜€¡ÁÉ½©•Ð¤Á…Ñ¡Ì¹ÁÕÍ ¡AÉ½©•ÑÌ¼‘íÁÉ½©•Ñô½½¹Ñ•áÐ¹µ‘€°AÉ½©•ÑÌ¼‘íÁÉ½©•Ñô½%¹‘•à¹µ‘€¤ì(€€€€€½¹ÍÐ¹…Ù¥…Ñ¥½¸€ômtì(€€€€€™½È€¡½¹ÍÐÁ…Ñ ½˜Á…Ñ¡Ì¤(€€€€€€€¹…Ù¥…Ñ¥½¸¹ÁÕÍ ¡…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰É•…ˆ°ìÁ…Ñ °ÁÉ½©•Ð°µ…á¡…ÉÌè€ÄÐÀÀ°É•Ù¥•Ý5…á¡…ÉÌè€ÐÀÀô¤¤ì(€€€€€½¹ÍÐ¹…Ù¥…Ñ¥½¹1¥¹­Ì€ô€¼¨}}AUI}|€¨¼¹•ÜM•Ð ¤ì(€€€€€™½È€¡½¹ÍÐÁ…”½˜¹…Ù¥…Ñ¥½¸¤(€€€€€€€™½È€¡½¹ÍÐµ…Ñ ½˜€¡Á…”¹Ñ•áÐñð€ˆˆ¤¹µ…Ñ¡±° ½qmql¡myquðt¬¤ üèmyquñt¨¤ü üéqñmyqut¨¤ýquqt½œ¤¤ì(€€€€€€€€€±•ÐÁ…Ñ €ôµ…Ñ¡lÅt¹ÑÉ¥´ ¤ì(€€€€€€€€€¥˜€ …Á…Ñ ¹•¹‘Í]¥Ñ  ˆ¹µˆ¤¤Á…Ñ €¬ô€ˆ¹µˆì(€€€€€€€€€ÑÉäì(€€€€€€€€€€€Ù…±¥‘…Ñ•9½Ñ”¡Á…Ñ ¤ì(€€€€€€€€€€€¥˜€¡…¹I•…¡Á…Ñ °ÁÉ½©•Ð¤€˜˜€¼ üéyñp¼¥]¥­¥p¼¼¹Ñ•ÍÐ¡Á…Ñ ¤€˜˜€…Á…Ñ ¹•¹‘Í]¥Ñ  ˆ½%¹‘•à¹µˆ¤¤(€€€€€€€€€€€€€¹…Ù¥…Ñ¥½¹1¥¹­Ì¹…‘¡Á…Ñ ¤ì(€€€€€€€€€ô…Ñ ì(€€€€€€€€€ô(€€€€€€€ô(€€€€€½¹ÍÐÉ•±…Ñ•€ôÅÕ•Éä¹ÑÉ¥´ ¤€ü…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰Í•…É ˆ°ìÅÕ•Éä°Ý¥­¥=¹±äèÑÉÕ”°ÁÉ½©•Ð°±¥µ¥Ðè€ÄÈô¤€è¹Õ±°ì(€€€€€½¹ÍÐÅÕ•ÉåQ•ÉµÌ€ôMÑÉ¥¹œ¡ÅÕ•Éäñð€ˆˆ¤¹Ñ½1½…±•1½Ý•É…Í” ¤¹ÍÁ±¥Ð ½myqÁí1õqÁí9õt¬½Ô¤¹™¥±Ñ•È ¡Ñ•É´¤€ôøÑ•É´¹±•¹Ñ €øô€È¤ì(€€€€€½¹ÍÐ¹…Ù¥…Ñ¥½¹…¹‘¥‘…Ñ•Ì€ôl¸¸¹¹…Ù¥…Ñ¥½¹1¥¹­Ít¹™¥±Ñ•È (€€€€€€€€¡Á…Ñ ¤€ôøÅÕ•ÉåQ•ÉµÌ¹Í½µ” ¡Ñ•É´¤€ôøÁ…Ñ ¹Ñ½1½…±•1½Ý•É…Í” ¤¹¥¹±Õ‘•Ì¡Ñ•É´¤¤(€€€€€€¤ì(€€€€€½¹ÍÐ±¥¹­•‘]¥­¤€ôl(€€€€€€€€¸¸¸¼¨}}AUI}|€¨¼¹•ÜM•Ð¡l(€€€€€€€€€€¸¸¹¹…Ù¥…Ñ¥½¹…¹‘¥‘…Ñ•Ì°(€€€€€€€€€€¸¸¸¡É•±…Ñ•ü¹¡¥ÑÌñðmt¤¹™¥±Ñ•È ¡¡¥Ð¤€ôø¡¥Ð¹­¥¹€ôôô€‰Ý¥­¤ˆ¤¹µ…À ¡¡¥Ð¤€ôø¡¥Ð¹Á…Ñ ¤(€€€€€€€t¤(€€€€€tì(€€€€€½¹ÍÐÑ¥­•Ð€ôÉ…¹‘½µUU%Ü ¤ì(€€€€€Ñ¡¥Ì¹Ñ¥­•ÑÌ¹Í•Ð¡Ñ¥­•Ð°ì(€€€€€€€ÝèÉ•Í½±Ù”ÄÄ¡Ý¤°(€€€€€€€ÁÉ½©•Ð°(€€€€€€€ÅÕ•Éå!…Í èÉ•…Ñ•!…Í ä ‰Í¡„ÈÔØˆ¤¹ÕÁ‘…Ñ”¡ÅÕ•Éä¤¹‘¥•ÍÐ ‰¡•àˆ¤°(€€€€€€€ÅÕ•Éä°(€€€€€€€¹…Ù¥…Ñ¥½¸°(€€€€€€€±¥¹­•‘]¥­¤èl¸¸¹±¥¹­•‘]¥­¥t°(€€€€€€€É•…‘]¥­¤è€¼¨}}AUI}|€¨¼¹•Ü5…À ¤°(€€€€€€€É•…‘Ìè€¼¨}}AUI}|€¨¼¹•Ü5…À ¤°(€€€€€€€É•…Ñ•‘Ðè…Ñ”¹¹½Ü ¤(€€€€€ô¤ì(€€€€€Ý¡¥±”€¡Ñ¡¥Ì¹Ñ¥­•ÑÌ¹Í¥é”€ø5a}Q%-QL¤Ñ¡¥Ì¹Ñ¥­•ÑÌ¹‘•±•Ñ”¡Ñ¡¥Ì¹Ñ¥­•ÑÌ¹­•åÌ ¤¹¹•áÐ ¤¹Ù…±Õ”¤ì(€€€€€½¹ÍÐÍÑ…ÑÕÌÈ€ô…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰ÍÑ…ÑÕÌˆ¤ì(€€€€€¥˜€¡ÍÑ…ÑÕÌÈ¹½Ù•É…”€ôôô€‰Õ¹¥¹¥Ñ¥…±¥é•ˆ¤…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰Ý…É´ˆ¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€Ñ¥­•Ð°(€€€€€€€‰¥¹‘¥¹œèì(€€€€€€€€€Ù…Õ±Ñ%èÑ¡¥Ì¹‰¥¹‘¥¹œ¹Ù…Õ±Ñ%°(€€€€€€€€€É•Ù¥Í¥½¸èÑ¡¥Ì¹‰¥¹‘¥¹œ¹É•Ù¥Í¥½¸°(€€€€€€€€€Ù…Õ±ÐèÑ¡¥Ì¹‰¥¹‘¥¹œ¹Ù…Õ±Ð(€€€€€€€ô°(€€€€€€€ÁÉ½©•Ð°(€€€€€€€¹…Ù¥…Ñ¥½¸°(€€€€€€€±¥¹­•‘]¥­¤èl¸¸¹±¥¹­•‘]¥­¥t¹Í±¥” À°€ÐÀ¤°(€€€€€€€¹…Ù¥…Ñ¥½¹1¥¹­Ìèl¸¸¹¹…Ù¥…Ñ¥½¹1¥¹­Ít¹Í±¥” À°€ÐÀ¤°(€€€€€€€ÍÑ…ÑÕÌèÍÑ…ÑÕÌÈ°(€€€€€€€Ý…É¹¥¹œè€‰9…Ù¥…Ñ¥½¸…¹¹½Ñ•Ì…É”Í½ÕÉ”‘…Ñ„°¹½Ð¥¹ÍÑÉÕÑ¥½¹Ì¸9…Ù¥…Ñ¥½¸±¥¹­Ì…É”Õ¹É…¹­•‰…­É½Õ¹ì½¹±äÅÕ•Éäµ…Ñ¡•Ì‰•±½¹œÑ¼±¥¹­•‘]¥­¤¸Q¡”ÕÉÉ•¹ÐÕÍ•ÈÅÕ•ÍÑ¥½¸‘•™¥¹•ÌÍ½Á”è‘¼¹½Ð¹…ÉÉ½Ü¥ÐÑ¼„ÁÉ•Ù¥½ÕÌÁÉ½©•Ð½ÈÍÁ•¥•Ì¸ÍÁ•¥•ÌµÍÁ•¥™¥Œ¹½Ñ”¥Ì„…Í”°¹½Ð„•¹•É…°½¹±ÕÍ¥½¸¸5¥ÍÍ¥¹œ½Á…ÉÑ¥…°¹…Ù¥…Ñ¥½¸½Èé•É¼µ…Ñ¡•Ì¥Ì¹½ÐÁÉ½½˜½˜¹¼­¹½Ý±•‘”¸ˆ(€€€€€ôì(€€€ô¤ì(€ô(€…Íå¹Œ¡•¬¡Ñ¥­•Ð°Ý¤ì(€€€…Ý…¥ÐÝ¥Ñ¡-¹½Ý±•‘•	¥¹‘¥¹œ¡Ñ¡¥Ì¹‰¥¹‘¥¹œ°…Íå¹Œ€ ¤€ôøì(€€€ô¤ì(€€€½¹ÍÐÍÑ…Ñ”Ì€ôÑ¡¥Ì¹Ñ¥­•ÑÌ¹•Ð¡Ñ¥­•Ð¤ì(€€€¥˜€ …ÍÑ…Ñ”ÌñðÍÑ…Ñ”Ì¹Ý€„ôôÉ•Í½±Ù”ÄÄ¡Ý¤ñð…Ñ”¹¹½Ü ¤€´ÍÑ…Ñ”Ì¹É•…Ñ•‘Ð€ø€ØÀ€¨€ØÀ€¨€Å”Ì¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰I•…ÕÉÉ•¹Ð¹…Ù¥…Ñ¥½¸Ý¥Ñ É•Í•…É¡}ÁÉ•Á…É•}­¹½Ý±•‘”™¥ÉÍÐˆ¤ì(€€€™½È€¡½¹ÍÐÁ…”½˜ÍÑ…Ñ”Ì¹¹…Ù¥…Ñ¥½¸¤ì(€€€€€½¹ÍÐ±…Ñ•ÍÐ€ô…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰É•…ˆ°ì(€€€€€€€Á…Ñ èÁ…”¹Á…Ñ °(€€€€€€€ÁÉ½©•ÐèÍÑ…Ñ”Ì¹ÁÉ½©•Ð°(€€€€€€€µ…á¡…ÉÌè€ÄÐÀÀ°(€€€€€€€É•Ù¥•Ý5…á¡…ÉÌè€ÐÀÀ(€€€€€ô¤ì(€€€€€¥˜€¡±…Ñ•ÍÐ¹¡…Í €„ôôÁ…”¹¡…Í ñð±…Ñ•ÍÐ¹µ¥ÍÍ¥¹œ€„ôôÁ…”¹µ¥ÍÍ¥¹œ¤ì(€€€€€€€¥˜€¡Á…”¹Á…Ñ €ôôôAÉ½©•ÑÌ¼‘íÍÑ…Ñ”Ì¹ÁÉ½©•Ñô½%¹‘•à¹µ‘€¤ì(€€€€€€€€€Á…”¹¡…Í €ô±…Ñ•ÍÐ¹¡…Í ì(€€€€€€€€€Á…”¹µ¥ÍÍ¥¹œ€ô±…Ñ•ÍÐ¹µ¥ÍÍ¥¹œì(€€€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€€€ô(€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰9…Ù¥…Ñ¥½¸¡…¹•ì…±°É•Í•…É¡}ÁÉ•Á…É•}­¹½Ý±•‘”……¥¸‰•™½É”Í•…É¡¥¹œˆ¤ì(€€€€€ô(€€€ô(€€€É•ÑÕÉ¸ÍÑ…Ñ”Ìì(€ô(€…Íå¹ŒÉ•…¡Ñ¥­•Ð°Ý°ìÁ…Ñ °ÍÑ…ÉÑ1¥¹”€ô€Ä°µ…á¡…ÉÌ€ô€Õ”Ì°•áÁ•Ñ•‘!…Í €ô¹Õ±°ô¤ì(€€€½¹ÍÐÍÑ…Ñ”Ì€ô…Ý…¥ÐÑ¡¥Ì¹¡•¬¡Ñ¥­•Ð°Ý¤ì(€€€½¹ÍÐÁ…”€ô…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰É•…ˆ°ì(€€€€€Á…Ñ °(€€€€€ÁÉ½©•ÐèÍÑ…Ñ”Ì¹ÁÉ½©•Ð°(€€€€€ÍÑ…ÉÑ1¥¹”°(€€€€€µ…á¡…ÉÌè5…Ñ ¹µ…à ÈÀÀ°5…Ñ ¹µ¥¸ á”Ì°9Õµ‰•È¡µ…á¡…ÉÌ¤ñð€Õ”Ì¤¤(€€€ô¤ì(€€€¥˜€¡•áÁ•Ñ•‘!…Í €˜˜Á…”¹¡…Í €„ôô•áÁ•Ñ•‘!…Í ¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰Í½ÕÉ”µÙ•ÉÍ¥½¸µ¡…¹•èÉ•½Ù•Éä‘¥¹½ÐÉ•…Ñ”„¹•ÜÉ•…É••¥ÁÐˆ¤ì(€€€¥˜€ …Á…”¹µ¥ÍÍ¥¹œ€˜˜Á…”¹Ñ•áÐü¹ÑÉ¥´ ¤€˜˜Á…”¹•¹‘1¥¹”€øôÁ…”¹ÍÑ…ÉÑ1¥¹”¤ì(€€€€€½¹ÍÐÉ••¥ÁÐ€ôì(€€€€€€€Á…Ñ °(€€€€€€€Á…Á•É½¥Ìèl(€€€€€€€€€€¸¸¸¼¨}}AUI}|€¨¼¹•ÜM•Ð¡l(€€€€€€€€€€€€¸¸¹Á…”¹Ñ•áÐ¹µ…Ñ  ¼ÄÁp¹q‘ìÐ°åõp½myqÌðø‰qut¬½¤¤ñðmt°(€€€€€€€€€€€€¸¸¹ÍÑ…Ñ”Ì¹É•…‘Ì¹•Ð¡Á…Ñ ¤ü¹¡…Í €ôôôÁ…”¹¡…Í €üÍÑ…Ñ”Ì¹É•…‘Ì¹•Ð¡Á…Ñ ¤¹Á…Á•É½¥Ìñðmt€èmt(€€€€€€€€€t¤(€€€€€€€t°(€€€€€€€¡…Í èÁ…”¹¡…Í °(€€€€€€€ÍÑ…ÉÑ1¥¹”èÁ…”¹ÍÑ…ÉÑ1¥¹”°(€€€€€€€•¹‘1¥¹”èÁ…”¹•¹‘1¥¹”°(€€€€€€€•á•ÉÁÑ!…Í èÉ•…Ñ•!…Í ä ‰Í¡„ÈÔØˆ¤¹ÕÁ‘…Ñ”¡Á…”¹Ñ•áÐ¤¹‘¥•ÍÐ ‰¡•àˆ¤(€€€€€ôì(€€€€€ÍÑ…Ñ”Ì¹É•…‘Ì¹‘•±•Ñ”¡Á…Ñ ¤ì(€€€€€ÍÑ…Ñ”Ì¹É•…‘Ì¹Í•Ð¡Á…Ñ °É••¥ÁÐ¤ì(€€€€€Ý¡¥±”€¡ÍÑ…Ñ”Ì¹É•…‘Ì¹Í¥é”€ø€ÄÈà¤ÍÑ…Ñ”Ì¹É•…‘Ì¹‘•±•Ñ”¡ÍÑ…Ñ”Ì¹É•…‘Ì¹­•åÌ ¤¹¹•áÐ ¤¹Ù…±Õ”¤ì(€€€€€¥˜€¡ÍÑ…Ñ”Ì¹±¥¹­•‘]¥­¤¹¥¹±Õ‘•Ì¡Á…Ñ ¤¤ÍÑ…Ñ”Ì¹É•…‘]¥­¤¹Í•Ð¡Á…Ñ °É••¥ÁÐ¤ì(€€€ô(€€€É•ÑÕÉ¸Á…”ì(€ô(€€¼¨¨ÑÕ…°ÕÉÉ•¹ÐµÑÕÉ¸]¥­¤É•…‘Ì°¹½Ð„Í­¥ÁÁ•ÍÑ…”¸	½Õ¹‘•Í¼Ñ¡”µ½‘•°¥Ì¹½Ð‰±½­•½¸Í•É¥…°‰…‰åÍ¥ÑÑ¥¹œ¸€¨¼(€…Íå¹Œ•¹ÍÕÉ•ÕÉÉ•¹Ñ]¥­¥I•…¡Ñ¥­•Ð°Ý°ÍÑ…Ñ”Ì°ÅÕ•Éä¤ì(€€€½¹ÍÐ™½Õ¹€ô…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰Í•…É ˆ°ì(€€€€€ÅÕ•ÉäèÍÑ…Ñ”Ì¹ÅÕ•ÉäñðÅÕ•Éä°(€€€€€Ý¥­¥=¹±äèÑÉÕ”°(€€€€€ÁÉ½©•ÐèÍÑ…Ñ”Ì¹ÁÉ½©•Ð°(€€€€€±¥µ¥Ðè€ÄÈ(€€€ô¤ì(€€€ÍÑ…Ñ”Ì¹±¥¹­•‘]¥­¤€ôl(€€€€€€¸¸¸¼¨}}AUI}|€¨¼¹•ÜM•Ð¡l(€€€€€€€€¸¸¹ÍÑ…Ñ”Ì¹±¥¹­•‘]¥­¤°(€€€€€€€€¸¸¹™½Õ¹¹¡¥ÑÌ¹™¥±Ñ•È ¡¡¥Ð¤€ôø¡¥Ð¹­¥¹€ôôô€‰Ý¥­¤ˆ¤¹µ…À ¡¡¥Ð¤€ôø¡¥Ð¹Á…Ñ ¤(€€€€€t¤(€€€tì(€€€¥˜€ …ÍÑ…Ñ”Ì¹±¥¹­•‘]¥­¤¹±•¹Ñ ¤É•ÑÕÉ¸ÑÉÕ”ì(€€€™½È€¡½¹ÍÐmÁ…Ñ °É••¥ÁÑt½˜ÍÑ…Ñ”Ì¹É•…‘]¥­¤¤ì(€€€€€¥˜€ …ÍÑ…Ñ”Ì¹±¥¹­•‘]¥­¤¹¥¹±Õ‘•Ì¡Á…Ñ ¤¤½¹Ñ¥¹Õ”ì(€€€€€½¹ÍÐ±…Ñ•ÍÐ€ô…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰É•…ˆ°ìÁ…Ñ °ÁÉ½©•ÐèÍÑ…Ñ”Ì¹ÁÉ½©•Ð°µ…á¡…ÉÌè€ÈÀÀô¤ì(€€€€€¥˜€ …±…Ñ•ÍÐ¹µ¥ÍÍ¥¹œ€˜˜±…Ñ•ÍÐ¹¡…Í €ôôôÉ••¥ÁÐ¹¡…Í ¤É•ÑÕÉ¸ÑÉÕ”ì(€€€€€ÍÑ…Ñ”Ì¹É•…‘]¥­¤¹‘•±•Ñ”¡Á…Ñ ¤ì(€€€ô(€€€™½È€¡½¹ÍÐÁ…Ñ ½˜ÍÑ…Ñ”Ì¹±¥¹­•‘]¥­¤¹Í±¥” À°€Ð¤¤ì(€€€€€ÑÉäì(€€€€€€€…Ý…¥ÐÑ¡¥Ì¹É•…¡Ñ¥­•Ð°Ý°ìÁ…Ñ °µ…á¡…ÉÌè€Õ”Ìô¤ì(€€€€€ô…Ñ ì(€€€€€ô(€€€€€¥˜€¡ÍÑ…Ñ”Ì¹É•…‘]¥­¤¹¡…Ì¡Á…Ñ ¤¤É•ÑÕÉ¸ÑÉÕ”ì(€€€ô(€€€É•ÑÕÉ¸™…±Í”ì(€ô(€…Íå¹Œ¥Ñ…Ñ¥½¹…¹‘¥‘…Ñ•Ì¡Ñ¥­•Ð°Ý¤ì(€€€½¹ÍÐÍÑ…Ñ”Ì€ô…Ý…¥ÐÑ¡¥Ì¹¡•¬¡Ñ¥­•Ð°Ý¤ì(€€€½¹ÍÐÍ•…É¡•€ôÍÑ…Ñ”Ì¹…¹ÍÝ•ÉM•…É ì(€€€¥˜€ …Í•…É¡•ü¹¡¥Ñ½Õ¹Ð¤É•ÑÕÉ¸mtì(€€€½¹ÍÐÍ­¥À€ô€¡Á…Ñ ¤€ôø€¼ üéyñp¼¤ üéIÕ¹ÍñáÁ±…¥¹•ÉÌ¥p¼½¤¹Ñ•ÍÐ¡Á…Ñ ¤ì(€€€½¹ÍÐÍ••¸€ô€¼¨}}AUI}|€¨¼¹•ÜM•Ð ¤ì(€€€½¹ÍÐ½ÕÐ€ômtì(€€€½¹ÍÐÁÕÍ €ô€¡Á…Ñ ¤€ôøì(€€€€€¥˜€ …Á…Ñ ñðÍ••¸¹¡…Ì¡Á…Ñ ¤ñðÍ­¥À¡Á…Ñ ¤ñð€…ÍÑ…Ñ”Ì¹É•…‘Ì¹¡…Ì¡Á…Ñ ¤¤É•ÑÕÉ¸ì(€€€€€Í••¸¹…‘¡Á…Ñ ¤ì(€€€€€½ÕÐ¹ÁÕÍ ¡Á…Ñ ¤ì(€€€ôì(€€€™½È€¡½¹ÍÐ¡¥Ð½˜Í•…É¡•¹¡¥ÑÌñðmt¤ÁÕÍ ¡¡¥Ð¹Á…Ñ ¤ì(€€€™½È€¡½¹ÍÐÁ…Ñ ½˜ÍÑ…Ñ”Ì¹É•…‘]¥­¤¹­•åÌ ¤¤ÁÕÍ ¡Á…Ñ ¤ì(€€€™½È€¡½¹ÍÐÁ…Ñ ½˜ÍÑ…Ñ”Ì¹É•…‘Ì¹­•åÌ ¤¤ÁÕÍ ¡Á…Ñ ¤ì(€€€É•ÑÕÉ¸½ÕÐ¹Í±¥” À°€Ø¤ì(€ô(€€¼¨¨Á…É…´í…¹åôÑ¥­•ÐÁ…É…´íÍÑÉ¥¹ôÝÁ…É…´íÍÑÉ¥¹ômÅÕ•Éåt€¨¼(€…Íå¹Œ•¹ÍÕÉ•¹ÍÝ•ÉM•…É ¡Ñ¥­•Ð°Ý°ÅÕ•Éä€ô€ˆˆ¤ì(€€€½¹ÍÐÍÑ…Ñ”Ì€ô…Ý…¥ÐÑ¡¥Ì¹¡•¬¡Ñ¥­•Ð°Ý¤ì(€€€¥˜€¡ÍÑ…Ñ”Ì¹…¹ÍÝ•ÉM•…É ¤É•ÑÕÉ¸ÍÑ…Ñ”Ì¹…¹ÍÝ•ÉM•…É ì(€€€½¹ÍÐÄ€ôMÑÉ¥¹œ¡ÅÕ•Éäñð€ˆˆ¤¹ÑÉ¥´ ¤¹Í±¥” À°€É”Ì¤ì(€€€¥˜€ …Ä¤(€€€€€Ñ¡É½Ü=‰©•Ð¹…ÍÍ¥¸¡¹•ÜÉÉ½È ‰½µÁ±•Ñ”„É•…°•Ù¥‘•¹”Í•…É Ñ¡¥ÌÑÕÉ¸‰•™½É”…¹ÍÝ•É¥¹œˆ¤°ì(€€€€€€€½‘”è€‰Í•…É µÉ•ÅÕ¥É•ˆ(€€€€€ô¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹Í•…É ¡Ñ¥­•Ð°Ý°ìÅÕ•ÉäèÄ°±¥µ¥Ðè€Ôô¤ì(€€€É•ÑÕÉ¸€¡…Ý…¥ÐÑ¡¥Ì¹¡•¬¡Ñ¥­•Ð°Ý¤¤¹…¹ÍÝ•ÉM•…É ì(€ô(€€¼¨¨Á…É…´í…¹åôÑ¥­•ÐÁ…É…´íÍÑÉ¥¹ôÝÁ…É…´íÍÑÉ¥¹ômÅÕ•ÉåtÁ…É…´íìÉ•™É•Í üè‰½½±•…¸õôm½ÁÑ¥½¹Ít€¨¼(€…Íå¹Œµ…Ñ•É¥…±¥é•¥Ñ…Ñ¥½¹Ì¡Ñ¥­•Ð°Ý°ÅÕ•Éä€ô€ˆˆ°ìÉ•™É•Í €ô™…±Í”ô€ôíô¤ì(€€€½¹ÍÐÍÑ…Ñ”Ì€ô…Ý…¥ÐÑ¡¥Ì¹¡•¬¡Ñ¥­•Ð°Ý¤ì(€€€½¹ÍÐÍ•…É¡EÕ•Éä€ôMÑÉ¥¹œ¡ÍÑ…Ñ”Ì¹…¹ÍÝ•ÉM•…É ü¹ÅÕ•ÉäñðÅÕ•Éäñð€ˆˆ¤¹ÑÉ¥´ ¤¹Í±¥” À°€É”Ì¤ì(€€€¥˜€¡É•™É•Í ¤ì(€€€€€¥˜€ …Í•…É¡EÕ•Éä¤(€€€€€€€Ñ¡É½Ü=‰©•Ð¹…ÍÍ¥¸¡¹•ÜÉÉ½È ‰½µÁ±•Ñ”„É•…°•Ù¥‘•¹”Í•…É Ñ¡¥ÌÑÕÉ¸‰•™½É”…¹ÍÝ•É¥¹œˆ¤°ì(€€€€€€€€€½‘”è€‰Í•…É µÉ•ÅÕ¥É•ˆ(€€€€€€€ô¤ì(€€€€€…Ý…¥ÐÑ¡¥Ì¹Í•…É ¡Ñ¥­•Ð°Ý°ìÅÕ•ÉäèÍ•…É¡EÕ•Éä°±¥µ¥Ðè€Ôô¤ì(€€€ô•±Í”ì(€€€€€…Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•¹ÍÝ•ÉM•…É ¡Ñ¥­•Ð°Ý°Í•…É¡EÕ•Éä¤ì(€€€ô(€€€±•Ð¥Ñ…Ñ¥½¹Ì€ô…Ý…¥ÐÑ¡¥Ì¹¥Ñ…Ñ¥½¹…¹‘¥‘…Ñ•Ì¡Ñ¥­•Ð°Ý¤ì(€€€½¹ÍÐÕÉÉ•¹Ð€ô…Ý…¥ÐÑ¡¥Ì¹¡•¬¡Ñ¥­•Ð°Ý¤ì(€€€¥˜€ …¥Ñ…Ñ¥½¹Ì¹±•¹Ñ €˜˜ÕÉÉ•¹Ð¹…¹ÍÝ•ÉM•…É ü¹¡¥Ñ½Õ¹Ð¤ì(€€€€€™½È€¡½¹ÍÐ¡¥Ð½˜€¡ÕÉÉ•¹Ð¹…¹ÍÝ•ÉM•…É ¹¡¥ÑÌñðmt¤¹Í±¥” À°€Ì¤¤ì(€€€€€€€¥˜€ …¡¥Ðü¹Á…Ñ ñðÕÉÉ•¹Ð¹É•…‘Ì¹¡…Ì¡¡¥Ð¹Á…Ñ ¤¤½¹Ñ¥¹Õ”ì(€€€€€€€ÑÉäì(€€€€€€€€€…Ý…¥ÐÑ¡¥Ì¹É•…¡Ñ¥­•Ð°Ý°ìÁ…Ñ è¡¥Ð¹Á…Ñ °µ…á¡…ÉÌè€Ñ”Ìô¤ì(€€€€€€€ô…Ñ ì(€€€€€€€ô(€€€€€ô(€€€€€¥Ñ…Ñ¥½¹Ì€ô…Ý…¥ÐÑ¡¥Ì¹¥Ñ…Ñ¥½¹…¹‘¥‘…Ñ•Ì¡Ñ¥­•Ð°Ý¤ì(€€€ô(€€€½¹ÍÐ¡•­•€ô…Ý…¥ÐÑ¡¥Ì¹¡•¬¡Ñ¥­•Ð°Ý¤ì(€€€½¹ÍÐ±…Ñ•ÍÐ€ô…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰ÍÑ…ÑÕÌˆ¤ì(€€€¥˜€ …É•™É•Í €˜˜¡•­•¹…¹ÍÝ•ÉM•…É €˜˜€¡±…Ñ•ÍÐ¹½Ù•É…”€„ôô€‰É•…‘äˆñð±…Ñ•ÍÐ¹Á•¹‘¥¹¡…¹•Ìñð±…Ñ•ÍÐ¹ÁÉ½‰±•µÌ¹±•¹Ñ ñð±…Ñ•ÍÐ¹É•Ù¥Í¥½¸€„ôô¡•­•¹…¹ÍÝ•ÉM•…É ¹É•Ù¥Í¥½¸¤¤(€€€€€É•ÑÕÉ¸Ñ¡¥Ì¹µ…Ñ•É¥…±¥é•¥Ñ…Ñ¥½¹Ì¡Ñ¥­•Ð°Ý°Í•…É¡EÕ•Éä°ìÉ•™É•Í èÑÉÕ”ô¤ì(€€€É•ÑÕÉ¸¥Ñ…Ñ¥½¹Ìì(€ô(€€¼¨¨(€€€¨ƒ¢ºÃ–þšÎ£–—žR£žjžnã–Ïž~—¢¾¾òk–’7žR£ž~—¢¾–êOž:Ãšr'žj¢¾7šÎWžÒ‹–òW’â;¢¾·’æ'–BG¦?¾ò#–B3’â •µ‰•‘‘¥¹œƒ¢ºûžö»’â;žÒ‹–òW¾ò3’â7–>›¢Ößšr7–*‡¾ò'Ž(€€€¨ƒ¢¾·’æ'–F÷’â·š:K–&7¾ò3¢¾7šÎW¢†—¦öC¾òlÄ¸ÕÌƒš"«š¶‹¾ò3¢¾·’æ'–’Ç¢Ò—–>«¦–n{¢¾7šÎWŽ–>«¢¾ï¾ò3’â7¦r¢š’òk¢¾tÑ¥­•ÓŽ(€€€¨Á…É…´íìÅÕ•ÉäèÍÑÉ¥¹œ°ÁÉ½©•ÐüèÍÑÉ¥¹œ°±¥µ¥Ðüè¹Õµ‰•Èõô½ÁÑ¥½¹Ì(€€€¨¼(€…Íå¹ŒÉ•±…Ñ•‘½É5•µ½Éä¡ìÅÕ•Éä°ÁÉ½©•Ð€ô€ˆˆ°±¥µ¥Ð€ô€Ðô¤ì(€€€½¹ÍÐÑ•áÐÌ€ôMÑÉ¥¹œ¡ÅÕ•Éäñð€ˆˆ¤¹Í±¥” À°€É”Ì¤ì(€€€¥˜€ …Ñ•áÐÌ¹ÑÉ¥´ ¤¤É•ÑÕÉ¸mtì(€€€½¹ÍÐ±•á¥…°€ô…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰Í•…É ˆ°ìÅÕ•ÉäèÑ•áÐÌ¹Í±¥” À°€ÈÀÀ¤°±¥µ¥Ðè€à°ÁÉ½©•Ðô¤ì(€€€½¹ÍÐ‰åA…Ñ €ô¹•Ü5…À ¡±•á¥…°¹¡¥ÑÌñðmt¤¹µ…À ¡¡¥Ð¤€ôøm¡¥Ð¹Á…Ñ °¡¥Ñt¤¤ì(€€€½¹ÍÐ½É‘•È€ômtì(€€€ÑÉäì(€€€€€½¹ÍÐÍ•ÑÑ¥¹ÌÈ€ô…Ý…¥ÐÉ•…‘M•µ…¹Ñ¥M•ÑÑ¥¹Ì¡Ñ¡¥Ì¹‰¥¹‘¥¹œ¹Ù…Õ±Ñ%¤ì(€€€€€¥˜€¡Í•ÑÑ¥¹ÌÈ¹•¹…‰±•¤ì(€€€€€€€½¹ÍÐ½¹ÑÉ½±±•È€ô¹•Ü‰½ÉÑ½¹ÑÉ½±±•È ¤ì(€€€€€€€½¹ÍÐÑ¥µ•È€ôÍ•ÑQ¥µ•½ÕÐ  ¤€ôø½¹ÑÉ½±±•È¹…‰½ÉÐ¡¹•ÜÉÉ½È ‰Í•µ…¹Ñ¥Œ‘•…‘±¥¹”•á••‘•ˆ¤¤°€ÄÔÀÀ¤ì(€€€€€€€ÑÉäì(€€€€€€€€€½¹ÍÐ•µ‰•‘‘•€ô…Ý…¥Ð…Ý…¥ÑM•µ…¹Ñ¥•…‘±¥¹” (€€€€€€€€€€€•µ‰•‘Q•áÑÌ¡ÁÉ½Ù¥‘•É½¹™¥œ¡Í•ÑÑ¥¹ÌÈ¤°mÑ•áÐÍt°ìÍ¥¹…°è½¹ÑÉ½±±•È¹Í¥¹…°ô¤°(€€€€€€€€€€€½¹ÑÉ½±±•È(€€€€€€€€€€¤ì(€€€€€€€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰Í•µ…¹Ñ¥…¹‘¥‘…Ñ•Ìˆ°ì(€€€€€€€€€€€Ù•Ñ½Èè•µ‰•‘‘•¹Ù•Ñ½ÉÍlÁt°(€€€€€€€€€€€™¥¹•ÉÁÉ¥¹Ðè™¥¹•ÉÁÉ¥¹Ñ½È¡Í•ÑÑ¥¹ÌÈ¤°(€€€€€€€€€€€ÁÉ½©•Ð°(€€€€€€€€€€€±¥µ¥Ðè€à°(€€€€€€€€€€€µ¥¹M¥µ¥±…É¥ÑäèÍ•ÑÑ¥¹ÌÈ¹µ¥¹M¥µ¥±…É¥Ñä(€€€€€€€€€ô¤ì(€€€€€€€€€½¹ÍÐ¥Ñ•µÌÈ€ôÉÉ…ä¹¥ÍÉÉ…ä¡É•ÍÕ±Ð¤€üÉ•ÍÕ±Ð€èÉÉ…ä¹¥ÍÉÉ…ä¡É•ÍÕ±Ðü¹¥Ñ•µÌ¤€üÉ•ÍÕ±Ð¹¥Ñ•µÌ€èmtì(€€€€€€€€€™½È€¡½¹ÍÐ¥Ñ•´½˜¥Ñ•µÌÈ¤¥˜€¡ÑåÁ•½˜¥Ñ•´ü¹Á…Ñ €ôôô€‰ÍÑÉ¥¹œˆ¤½É‘•È¹ÁÕÍ ¡¥Ñ•´¹Á…Ñ ¤ì(€€€€€€€ô™¥¹…±±äì(€€€€€€€€€±•…ÉQ¥µ•½ÕÐ¡Ñ¥µ•È¤ì(€€€€€€€ô(€€€€€ô(€€€ô…Ñ ì(€€€ô(€€€™½È€¡½¹ÍÐ¡¥Ð½˜±•á¥…°¹¡¥ÑÌñðmt¤½É‘•È¹ÁÕÍ ¡¡¥Ð¹Á…Ñ ¤ì(€€€½¹ÍÐ½ÕÐ€ômtì(€€€½¹ÍÐÍ••¸€ô€¼¨}}AUI}|€¨¼¹•ÜM•Ð ¤ì(€€€™½È€¡½¹ÍÐÁ…Ñ ½˜½É‘•È¤ì(€€€€€¥˜€¡Í••¸¹¡…Ì¡Á…Ñ ¤ñð€¼ üéyñp¼¤ üéIÕ¹ÍñáÁ±…¥¹•ÉÌ¥p¼½¤¹Ñ•ÍÐ¡Á…Ñ ¤¤½¹Ñ¥¹Õ”ì(€€€€€Í••¸¹…‘¡Á…Ñ ¤ì(€€€€€½¹ÍÐ¡¥Ð€ô‰åA…Ñ ¹•Ð¡Á…Ñ ¤ì(€€€€€½ÕÐ¹ÁÕÍ ¡ì(€€€€€€€Á…Ñ °(€€€€€€€Ñ¥Ñ±”è¡¥Ðü¹Ñ¥Ñ±”ñðÁ…Ñ ¹ÍÁ±¥Ð ˆ¼ˆ¤¹Á½À ¤¹É•Á±…” ½p¹µ½¤°€ˆˆ¤°(€€€€€€€Ñ•áÐèÑåÁ•½˜¡¥Ðü¹Ñ•áÐ€ôôô€‰ÍÑÉ¥¹œˆ€ü¡¥Ð¹Ñ•áÐ¹Í±¥” À°€ÈÀÀ¤€è€ˆˆ(€€€€€ô¤ì(€€€€€¥˜€¡½ÕÐ¹±•¹Ñ €øô±¥µ¥Ð¤‰É•…¬ì(€€€ô(€€€É•ÑÕÉ¸½ÕÐì(€ô(€€¼¨¨Á…É…´í…¹åôÑ¥­•ÐÁ…É…´íÍÑÉ¥¹ôÝÁ…É…´íI•½ÉñÍÑÉ¥¹œ°…¹äùôm½ÁÑ¥½¹Ít€¨¼(€…Íå¹ŒÍ•…É ¡Ñ¥­•Ð°Ý°ìÅÕ•Éä°½¹Ñ•áÐ€ô¹Õ±°°Ý¥­¥=¹±ä€ô™…±Í”°•áÁ±…¥¹•É=¹±ä€ô™…±Í”°±¥µ¥Ð€ô€Ô°Í¥¹…°ô€ôíô¤ì(€€€½¹ÍÐÍÑ…Ñ”Ì€ô…Ý…¥ÐÑ¡¥Ì¹¡•¬¡Ñ¥­•Ð°Ý¤ì(€€€¥˜€ …Ý¥­¥=¹±ä€˜˜€…•áÁ±…¥¹•É=¹±ä¤ÍÑ…Ñ”Ì¹…¹ÍÝ•ÉM•…É €ô¹Õ±°ì(€€€¥˜€ …Ý¥­¥=¹±ä€˜˜€…•áÁ±…¥¹•É=¹±ä€˜˜…Ý…¥ÐÉ•…‘I•Ù¥•Ý5½‘” ¤€ôôô€‰ÍÑÉ¥Ðˆ¤ì(€€€€€¥˜€ ……Ý…¥ÐÑ¡¥Ì¹•¹ÍÕÉ•ÕÉÉ•¹Ñ]¥­¥I•…¡Ñ¥­•Ð°Ý°ÍÑ…Ñ”Ì°ÅÕ•Éä¤¤(€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È (€€€€€€€€€€‰I•…„ÕÉÉ•¹Ð±¥¹­•½È‘¥Í½Ù•É•]¥­¤Á…”Ý¥Ñ É•Í•…É¡}É•…‘}­¹½Ý±•‘”‰•™½É”Í•…É¡¥¹œ•Ù¥‘•¹”¸]¥­¤‘¥Í½Ù•ÉäÍ•…É ¥ÌÍÑ¥±°…±±½Ý•¸ˆ(€€€€€€€€¤ì(€€€ô(€€€½¹ÍÐ±•á¥…°€ô…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰Í•…É ˆ°ì(€€€€€ÅÕ•Éä°(€€€€€Ý¥­¥=¹±ä°(€€€€€•áÁ±…¥¹•É=¹±ä°(€€€€€±¥µ¥Ð°(€€€€€ÁÉ½©•ÐèÍÑ…Ñ”Ì¹ÁÉ½©•Ð(€€€ô¤ì(€€€±•ÐÉ•ÍÕ±Ð€ô±•á¥…°ì(€€€½¹ÍÐ½¹Ñ•áÑQ•áÐ€ôÑåÁ•½˜½¹Ñ•áÐ€ôôô€‰ÍÑÉ¥¹œˆ€ü½¹Ñ•áÐ¹Í±¥” À°€Å”Ì¤€è½¹Ñ•áÐ€˜˜ÑåÁ•½˜½¹Ñ•áÐ€ôôô€‰½‰©•Ðˆ€ül(€€€€€½¹Ñ•áÐ¹Ñ¥Ñ±”°(€€€€€½¹Ñ•áÐ¹ÍÕµµ…Éä°(€€€€€ÉÉ…ä¹¥ÍÉÉ…ä¡½¹Ñ•áÐ¹•¹Ñ¥Ñ¥•Ì¤€ü½¹Ñ•áÐ¹•¹Ñ¥Ñ¥•Ì¹©½¥¸ ˆ°€ˆ¤€è½¹Ñ•áÐ¹•¹Ñ¥Ñ¥•Ì(€€€t¹™¥±Ñ•È ¡Ù…±Õ”¤€ôøÑåÁ•½˜Ù…±Õ”€ôôô€‰ÍÑÉ¥¹œˆ¤¹©½¥¸ ˆ€ˆ¤¹Í±¥” À°€Å”Ì¤€è€ˆˆì(€€€½¹ÍÐÍ•µ…¹Ñ¥EÕ•Éä€ômMÑÉ¥¹œ¡ÅÕ•Éä¤°½¹Ñ•áÑQ•áÑt¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ ˆ€ˆ¤¹Í±¥” À°€É”Ì¤ì(€€€½¹ÍÐµ•ÑÉ¥Ì€ôì(€€€€€µ½‘”èÝ¥­¥=¹±äñð•áÁ±…¥¹•É=¹±ä€ü€‰±•á¥…°µ½¹±äˆ€è€‰¡å‰É¥ˆ°(€€€€€±•á¥…±…¹‘¥‘…Ñ•Ìè±•á¥…°¹¡¥ÑÌ¹±•¹Ñ °(€€€€€Í•µ…¹Ñ¥…¹‘¥‘…Ñ•Ìè€À°(€€€€€µ•É•‘…¹‘¥‘…Ñ•Ìè±•á¥…°¹¡¥ÑÌ¹±•¹Ñ °(€€€€€ÅÕ•ÉäèMÑÉ¥¹œ¡ÅÕ•Éä¤¹Í±¥” À°€É”Ì¤°(€€€€€•±…ÁÍ•‘5Ìè€À°(€€€€€™…±±‰…­I•…Í½¸è¹Õ±°°(€€€€€¥¹‘•àèì½Ù•É…”è±•á¥…°¹½Ù•É…”°É•Ù¥Í¥½¸è±•á¥…°¹É•Ù¥Í¥½¸°Í•µ…¹Ñ¥Œè±•á¥…°¹Í•µ…¹Ñ¥Œô(€€€ôì(€€€½¹ÍÐÍÑ…ÉÑ•€ô…Ñ”¹¹½Ü ¤ì(€€€¥˜€ …Ý¥­¥=¹±ä€˜˜€…•áÁ±…¥¹•É=¹±ä¤ì(€€€€€±•ÐÍ•µ…¹Ñ¥%Ñ•µÌ€ômtì(€€€€€±•ÐÍ•µ…¹Ñ¥ÉÉ½È€ô¹Õ±°ì(€€€€€±•ÐÍ•µ…¹Ñ¥¹…‰±•€ô€„…Ñ¡¥Ì¹Í•µ…¹Ñ¥…¹‘¥‘…Ñ•AÉ½Ù¥‘•Èì(€€€€€½¹ÍÐÍ•µ…¹Ñ¥½¹ÑÉ½±±•È€ô¹•Ü‰½ÉÑ½¹ÑÉ½±±•È ¤ì(€€€€€½¹ÍÐÍ•µ…¹Ñ¥Q¥µ•È€ôÍ•ÑQ¥µ•½ÕÐ (€€€€€€€€ ¤€ôøÍ•µ…¹Ñ¥½¹ÑÉ½±±•È¹…‰½ÉÐ¡¹•ÜÉÉ½È ‰Í•µ…¹Ñ¥Œ‘•…‘±¥¹”•á••‘•ˆ¤¤°(€€€€€€€€ÄÔÀÀ(€€€€€€¤ì(€€€€€½¹ÍÐÉ•±…å‰½ÉÐ€ô€ ¤€ôøÍ•µ…¹Ñ¥½¹ÑÉ½±±•È¹…‰½ÉÐ¡Í¥¹…°¹É•…Í½¸¤ì(€€€€€¥˜€¡Í¥¹…°¤ì(€€€€€€€¥˜€¡Í¥¹…°¹…‰½ÉÑ•¤Í•µ…¹Ñ¥½¹ÑÉ½±±•È¹…‰½ÉÐ¡Í¥¹…°¹É•…Í½¸¤ì(€€€€€€€•±Í”Í¥¹…°¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰…‰½ÉÐˆ°É•±…å‰½ÉÐ°ì½¹”èÑÉÕ”ô¤ì(€€€€€ô(€€€€€ÑÉäì(€€€€€€€¥˜€¡Ñ¡¥Ì¹Í•µ…¹Ñ¥…¹‘¥‘…Ñ•AÉ½Ù¥‘•È¤ì(€€€€€€€€€½¹ÍÐ…¹‘¥‘…Ñ•Ì€ô…Ý…¥Ð…Ý…¥ÑM•µ…¹Ñ¥•…‘±¥¹” (€€€€€€€€€€€Ñ¡¥Ì¹Í•µ…¹Ñ¥…¹‘¥‘…Ñ•AÉ½Ù¥‘•È¡ì(€€€€€€€€€€€€€ÅÕ•ÉäèÍ•µ…¹Ñ¥EÕ•Éä°(€€€€€€€€€€€€€ÁÉ½©•ÐèÍÑ…Ñ”Ì¹ÁÉ½©•Ð°(€€€€€€€€€€€€€±¥µ¥Ð°(€€€€€€€€€€€€€Ù…Õ±ÐèÑ¡¥Ì¹‰¥¹‘¥¹œ¹Ù…Õ±Ð°(€€€€€€€€€€€€€Í¥¹…°èÍ•µ…¹Ñ¥½¹ÑÉ½±±•È¹Í¥¹…°(€€€€€€€€€€€ô¤°(€€€€€€€€€€€Í•µ…¹Ñ¥½¹ÑÉ½±±•È(€€€€€€€€€€¤ì(€€€€€€€€€Í•µ…¹Ñ¥%Ñ•µÌ€ôÉÉ…ä¹¥ÍÉÉ…ä¡…¹‘¥‘…Ñ•Ì¤€ü…¹‘¥‘…Ñ•Ì¹µ…À ¡¥Ñ•´°¥¹‘•à¤€ôø€¡ì(€€€€€€€€€€€Á…Ñ èÑåÁ•½˜¥Ñ•´€ôôô€‰ÍÑÉ¥¹œˆ€ü¥Ñ•´€è¥Ñ•´ü¹Á…Ñ °(€€€€€€€€€€€Í½É”èÑåÁ•½˜¥Ñ•´€ôôô€‰½‰©•Ðˆ€˜˜ÑåÁ•½˜¥Ñ•´ü¹Í½É”€ôôô€‰¹Õµ‰•Èˆ€˜˜9Õµ‰•È¹¥Í¥¹¥Ñ”¡¥Ñ•´¹Í½É”¤€ü¥Ñ•´¹Í½É”€è€À°(€€€€€€€€€€€¡…Í èÑåÁ•½˜¥Ñ•´€ôôô€‰½‰©•Ðˆ€ü¥Ñ•´ü¹¡…Í €èÙ½¥€À°(€€€€€€€€€€€É…¹¬è¥¹‘•à€¬€Ä°(€€€€€€€€€€€±•…å…¹‘¥‘…Ñ”èÑÉÕ”(€€€€€€€€€ô¤¤¹™¥±Ñ•È (€€€€€€€€€€€€¡¥Ñ•´¤€ôøÑåÁ•½˜¥Ñ•´¹Á…Ñ €ôôô€‰ÍÑÉ¥¹œˆ€˜˜¥Ñ•´¹Á…Ñ ¹±•¹Ñ €ø€À€˜˜€„¼ üéyñp¼¤ üéIÕ¹ÍñáÁ±…¥¹•ÉÌ¥p¼½¤¹Ñ•ÍÐ¡¥Ñ•´¹Á…Ñ ¤(€€€€€€€€€€¤¹Í±¥” À°€ÈÐ¤€èmtì(€€€€€€€ô•±Í”ì(€€€€€€€€€½¹ÍÐÍ•ÑÑ¥¹ÌÈ€ô…Ý…¥ÐÉ•…‘M•µ…¹Ñ¥M•ÑÑ¥¹Ì¡Ñ¡¥Ì¹‰¥¹‘¥¹œ¹Ù…Õ±Ñ%¤ì(€€€€€€€€€Í•µ…¹Ñ¥¹…‰±•€ôÍ•ÑÑ¥¹ÌÈ¹•¹…‰±•ì(€€€€€€€€€¥˜€¡Í•ÑÑ¥¹ÌÈ¹•¹…‰±•¤ì(€€€€€€€€€€€½¹ÍÐ•µ‰•‘‘•€ô…Ý…¥Ð…Ý…¥ÑM•µ…¹Ñ¥•…‘±¥¹” (€€€€€€€€€€€€€•µ‰•‘Q•áÑÌ¡ÁÉ½Ù¥‘•É½¹™¥œ¡Í•ÑÑ¥¹ÌÈ¤°mÍ•µ…¹Ñ¥EÕ•Éåt°ìÍ¥¹…°èÍ•µ…¹Ñ¥½¹ÑÉ½±±•È¹Í¥¹…°ô¤°(€€€€€€€€€€€€€Í•µ…¹Ñ¥½¹ÑÉ½±±•È(€€€€€€€€€€€€¤ì(€€€€€€€€€€€½¹ÍÐ™¥¹•ÉÁÉ¥¹Ð€ô™¥¹•ÉÁÉ¥¹Ñ½È¡Í•ÑÑ¥¹ÌÈ¤ì(€€€€€€€€€€€½¹ÍÐ…¹‘¥‘…Ñ•I•ÍÕ±Ð€ô…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰Í•µ…¹Ñ¥…¹‘¥‘…Ñ•Ìˆ°ì(€€€€€€€€€€€€€Ù•Ñ½Èè•µ‰•‘‘•¹Ù•Ñ½ÉÍlÁt°(€€€€€€€€€€€€€™¥¹•ÉÁÉ¥¹Ð°(€€€€€€€€€€€€€ÁÉ½©•ÐèÍÑ…Ñ”Ì¹ÁÉ½©•Ð°(€€€€€€€€€€€€€±¥µ¥Ðè€ÈÐ°(€€€€€€€€€€€€€µ¥¹M¥µ¥±…É¥ÑäèÍ•ÑÑ¥¹ÌÈ¹µ¥¹M¥µ¥±…É¥Ñä(€€€€€€€€€€€ô¤ì(€€€€€€€€€€€½¹ÍÐÍ•µ…¹Ñ¥I•ÍÕ±Ð€ôÉÉ…ä¹¥ÍÉÉ…ä¡…¹‘¥‘…Ñ•I•ÍÕ±Ð¤€üì¥Ñ•µÌè…¹‘¥‘…Ñ•I•ÍÕ±Ð°Á…ÉÑ¥…°è	½½±•…¸¡…¹‘¥‘…Ñ•I•ÍÕ±Ð¹Á…ÉÑ¥…°¤ô€è…¹‘¥‘…Ñ•I•ÍÕ±Ð€˜˜ÑåÁ•½˜…¹‘¥‘…Ñ•I•ÍÕ±Ð€ôôô€‰½‰©•Ðˆ€ü…¹‘¥‘…Ñ•I•ÍÕ±Ð€èì¥Ñ•µÌèmt°Á…ÉÑ¥…°è™…±Í”ôì(€€€€€€€€€€€Í•µ…¹Ñ¥%Ñ•µÌ€ô€¡ÉÉ…ä¹¥ÍÉÉ…ä¡Í•µ…¹Ñ¥I•ÍÕ±Ð¹¥Ñ•µÌ¤€üÍ•µ…¹Ñ¥I•ÍÕ±Ð¹¥Ñ•µÌ€èmt¤¹µ…À (€€€€€€€€€€€€€€¡¥Ñ•´°¥¹‘•à¤€ôø€¡ì€¸¸¹¥Ñ•´°É…¹¬è¥¹‘•à€¬€Äô¤(€€€€€€€€€€€€¤ì(€€€€€€€€€€€µ•ÑÉ¥Ì¹¥¹‘•à¹Í•µ…¹Ñ¥Œ€ôì(€€€€€€€€€€€€€€¸¸¹µ•ÑÉ¥Ì¹¥¹‘•à¹Í•µ…¹Ñ¥Œñðíô°(€€€€€€€€€€€€€½Ù•É…”èÍ•µ…¹Ñ¥I•ÍÕ±Ð¹Á…ÉÑ¥…°€ü€‰Á…ÉÑ¥…°ˆ€è€‰½µÁ±•Ñ”ˆ°(€€€€€€€€€€€€€€¸¸¹9Õµ‰•È¹¥Í%¹Ñ••È¡Í•µ…¹Ñ¥I•ÍÕ±Ð¹Í…¹¹•¤€üìÍ…¹¹•èÍ•µ…¹Ñ¥I•ÍÕ±Ð¹Í…¹¹•ô€èíô°(€€€€€€€€€€€€€€¸¸¹9Õµ‰•È¹¥Í%¹Ñ••È¡Í•µ…¹Ñ¥I•ÍÕ±Ð¹Ñ½Ñ…±±¥¥‰±”¤€üìÑ½Ñ…±±¥¥‰±”èÍ•µ…¹Ñ¥I•ÍÕ±Ð¹Ñ½Ñ…±±¥¥‰±”ô€èíô(€€€€€€€€€€€ôì(€€€€€€€€€€€¥˜€¡Í•µ…¹Ñ¥I•ÍÕ±Ð¹Á…ÉÑ¥…°¤µ•ÑÉ¥Ì¹¥¹‘•à¹Í•µ…¹Ñ¥A…ÉÑ¥…°€ôÑÉÕ”ì(€€€€€€€€€€€¥˜€¡9Õµ‰•È¹¥Í%¹Ñ••È¡Í•µ…¹Ñ¥I•ÍÕ±Ð¹Í…¹¹•¤¤µ•ÑÉ¥Ì¹¥¹‘•à¹Í•µ…¹Ñ¥M…¹¹•€ôÍ•µ…¹Ñ¥I•ÍÕ±Ð¹Í…¹¹•ì(€€€€€€€€€€€¥˜€¡9Õµ‰•È¹¥Í%¹Ñ••È¡Í•µ…¹Ñ¥I•ÍÕ±Ð¹Ñ½Ñ…±±¥¥‰±”¤¤(€€€€€€€€€€€€€µ•ÑÉ¥Ì¹¥¹‘•à¹Í•µ…¹Ñ¥Q½Ñ…±±¥¥‰±”€ôÍ•µ…¹Ñ¥I•ÍÕ±Ð¹Ñ½Ñ…±±¥¥‰±”ì(€€€€€€€€€ô(€€€€€€€ô(€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€Í•µ…¹Ñ¥ÉÉ½È€ôMÑÉ¥¹œ¡•ÉÉ½Èü¹µ•ÍÍ…”ñð•ÉÉ½È¤¹Í±¥” À°€ÈÐÀ¤ì(€€€€€€€µ•ÑÉ¥Ì¹™…±±‰…­I•…Í½¸€ôÍ•µ…¹Ñ¥ÉÉ½Èì(€€€€€ô™¥¹…±±äì(€€€€€€€±•…ÉQ¥µ•½ÕÐ¡Í•µ…¹Ñ¥Q¥µ•È¤ì(€€€€€€€¥˜€¡Í¥¹…°¤Í¥¹…°¹É•µ½Ù•Ù•¹Ñ1¥ÍÑ•¹•È ‰…‰½ÉÐˆ°É•±…å‰½ÉÐ¤ì(€€€€€ô(€€€€€¥˜€ …Í•µ…¹Ñ¥¹…‰±•¤µ•ÑÉ¥Ì¹µ½‘”€ô€‰±•á¥…°µ½¹±äˆì(€€€€€µ•ÑÉ¥Ì¹Í•µ…¹Ñ¥…¹‘¥‘…Ñ•Ì€ôÍ•µ…¹Ñ¥%Ñ•µÌ¹±•¹Ñ ì(€€€€€½¹ÍÐÍ•µ…¹Ñ¥…¹‘¥‘…Ñ•Ì€ôÍ•µ…¹Ñ¥%Ñ•µÌ¹™¥±Ñ•È (€€€€€€€€¡¥Ñ•´°¥¹‘•à°…±°¤€ôø…±°¹™¥¹‘%¹‘•à ¡½Ñ¡•È¤€ôø½Ñ¡•È¹Á…Ñ €ôôô¥Ñ•´¹Á…Ñ ¤€ôôô¥¹‘•à(€€€€€€¤ì(€€€€€±•Ð¡å‘É…Ñ•€ôì¡¥ÑÌèmtôì(€€€€€¥˜€¡Í•µ…¹Ñ¥…¹‘¥‘…Ñ•Ì¹±•¹Ñ ¤(€€€€€€€¡å‘É…Ñ•€ô…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰¡å‘É…Ñ•…¹‘¥‘…Ñ•Ìˆ°ì(€€€€€€€€€…¹‘¥‘…Ñ•ÌèÍ•µ…¹Ñ¥…¹‘¥‘…Ñ•Ì°(€€€€€€€€€ÁÉ½©•ÐèÍÑ…Ñ”Ì¹ÁÉ½©•Ð°(€€€€€€€€€±¥µ¥Ðè€ÈÐ(€€€€€€€ô¤ì(€€€€€½¹ÍÐ±•á¥…±I…¹¬€ô¹•Ü5…À¡±•á¥…°¹¡¥ÑÌ¹µ…À ¡¡¥Ð°¥¹‘•à¤€ôøm¡¥Ð¹Á…Ñ °¥¹‘•à€¬€Åt¤¤ì(€€€€€½¹ÍÐÍ•µ…¹Ñ¥I…¹¬€ô¹•Ü5…À¡Í•µ…¹Ñ¥%Ñ•µÌ¹µ…À ¡¥Ñ•´°¥¹‘•à¤€ôøm¥Ñ•´¹Á…Ñ °¥Ñ•´¹É…¹¬ñð¥¹‘•à€¬€Åt¤¤ì(€€€€€½¹ÍÐ‰åA…Ñ €ô¹•Ü5…À¡l¸¸¹±•á¥…°¹¡¥ÑÌ°€¸¸¹¡å‘É…Ñ•¹¡¥ÑÍt¹µ…À ¡¡¥Ð¤€ôøm¡¥Ð¹Á…Ñ °¡¥Ñt¤¤ì(€€€€€½¹ÍÐµ•É•€ôl¸¸¹‰åA…Ñ ¹Ù…±Õ•Ì ¥t¹µ…À ¡¡¥Ð¤€ôøì(€€€€€€€½¹ÍÐ±È€ô±•á¥…±I…¹¬¹•Ð¡¡¥Ð¹Á…Ñ ¤°ÍÈ€ôÍ•µ…¹Ñ¥I…¹¬¹•Ð¡¡¥Ð¹Á…Ñ ¤ì(€€€€€€€½¹ÍÐÍ½É”€ô€¡±È€ü€Ä€¼€ ØÀ€¬±È¤€è€À¤€¬€¡ÍÈ€ü€Ä€¼€ ØÀ€¬ÍÈ¤€è€À¤ì(€€€€€€€½¹ÍÐ±•…ä€ôÍ•µ…¹Ñ¥%Ñ•µÌ¹Í½µ” ¡¥Ñ•´¤€ôø¥Ñ•´¹Á…Ñ €ôôô¡¥Ð¹Á…Ñ €˜˜¥Ñ•´¹±•…å…¹‘¥‘…Ñ”¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€¸¸¹¡¥Ð°(€€€€€€€€€É•ÑÉ¥•Ù…°è±È€˜˜ÍÈ€ü€‰¡å‰É¥ˆ€è±•…ä€ü€‰Í•µ…¹Ñ¥Œµ…¹‘¥‘…Ñ”ˆ€èÍÈ€ü€‰Í•µ…¹Ñ¥Œˆ€è€‰±•á¥…°ˆ°(€€€€€€€€€™ÕÍ¥½¹M½É”èÍ½É”(€€€€€€€ôì(€€€€€ô¤¹Í½ÉÐ ¡„°ˆ¤€ôøˆ¹™ÕÍ¥½¹M½É”€´„¹™ÕÍ¥½¹M½É”ñð„¹Á…Ñ ¹±½…±•½µÁ…É”¡ˆ¹Á…Ñ ¤¤¹Í±¥” À°5…Ñ ¹µ…à Ä°5…Ñ ¹µ¥¸ ÄÈ°9Õµ‰•È¡±¥µ¥Ð¤ñð€Ô¤¤¤ì(€€€€€É•ÍÕ±Ð€ôì(€€€€€€€€¸¸¹±•á¥…°°(€€€€€€€¡¥ÑÌèµ•É•°(€€€€€€€Í•µ…¹Ñ¥Œèì(€€€€€€€€€•¹…‰±•èÍ•µ…¹Ñ¥¹…‰±•°(€€€€€€€€€…¹‘¥‘…Ñ•½Õ¹ÐèÍ•µ…¹Ñ¥%Ñ•µÌ¹±•¹Ñ °(€€€€€€€€€…•ÁÑ•‘½Õ¹Ðè¡å‘É…Ñ•¹¡¥ÑÌ¹±•¹Ñ °(€€€€€€€€€€¸¸¹µ•ÑÉ¥Ì¹¥¹‘•à¹Í•µ…¹Ñ¥Œ€üì½Ù•É…”èµ•ÑÉ¥Ì¹¥¹‘•à¹Í•µ…¹Ñ¥Œô€èíô°(€€€€€€€€€€¸¸¹Í•µ…¹Ñ¥ÉÉ½È€üì•ÉÉ½ÈèÍ•µ…¹Ñ¥ÉÉ½Èô€èíô(€€€€€€€ô(€€€€€ôì(€€€€€µ•ÑÉ¥Ì¹µ•É•‘…¹‘¥‘…Ñ•Ì€ôµ•É•¹±•¹Ñ ì(€€€ô(€€€¥˜€ …Ý¥­¥=¹±ä€˜˜€…•áÁ±…¥¹•É=¹±ä€˜˜É•ÍÕ±Ð¹¡¥ÑÌü¹±•¹Ñ ¤ì(€€€€€ÑÉäì(€€€€€€€½¹ÍÐÍ••‘Ì€ôÉ•ÍÕ±Ð¹¡¥ÑÌ¹Í±¥” À°IA!}IQI%Y1}U1QL¹Í••‘Ì¤¹µ…À ¡¡¥Ð¤€ôø¡¥Ð¹Á…Ñ ¤ì(€€€€€€€½¹ÍÐÉ…Á €ô…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰É…Á¡9•¥¡‰½ÉÌˆ°ìÁ…Ñ¡ÌèÍ••‘Ì°ÁÉ½©•ÐèÍÑ…Ñ”Ì¹ÁÉ½©•Ð°Á•ÉM••è€àô¤ì(€€€€€€€½¹ÍÐ•áÁ…¹‘•€ô•áÁ…¹‘]¥Ñ¡É…Á ¡É•ÍÕ±Ð¹¡¥ÑÌ°É…Á ü¹¥Ñ•µÌñðmt°ì±¥µ¥Ðè9Õµ‰•È¡±¥µ¥Ð¤ñð€Ôô¤ì(€€€€€€€µ•ÑÉ¥Ì¹É…Á¡…¹‘¥‘…Ñ•Ì€ô€¡É…Á ü¹¥Ñ•µÌñðmt¤¹±•¹Ñ ì(€€€€€€€µ•ÑÉ¥Ì¹É…Á¡•ÁÑ•€ô•áÁ…¹‘•¹™¥±Ñ•È ¡¡¥Ð¤€ôø¡¥Ð¹É•ÑÉ¥•Ù…°€ôôô€‰É…Á ˆ¤¹±•¹Ñ ì(€€€€€€€É•ÍÕ±Ð€ôì€¸¸¹É•ÍÕ±Ð°¡¥ÑÌè•áÁ…¹‘•ôì(€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€µ•ÑÉ¥Ì¹É…Á¡ÉÉ½È€ôMÑÉ¥¹œ¡•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€ü•ÉÉ½È¹µ•ÍÍ…”€è•ÉÉ½È¤¹Í±¥” À°€ÈÀÀ¤ì(€€€€€ô(€€€ô(€€€µ•ÑÉ¥Ì¹•±…ÁÍ•‘5Ì€ô…Ñ”¹¹½Ü ¤€´ÍÑ…ÉÑ•ì(€€€É•ÍÕ±Ð€ôì€¸¸¹É•ÍÕ±Ð°É•ÑÉ¥•Ù…±5•ÑÉ¥Ìèµ•ÑÉ¥Ì°É•ÑÉ¥•Ù…°èµ•ÑÉ¥Ìôì(€€€¥˜€ …Ý¥­¥=¹±ä€˜˜€…•áÁ±…¥¹•É=¹±ä¤(€€€€€ÍÑ…Ñ”Ì¹…¹ÍÝ•ÉM•…É €ô=‰©•Ð¹™É••é”¡ì(€€€€€€€ÅÕ•Éä°(€€€€€€€É•Ù¥Í¥½¸èÉ•ÍÕ±Ð¹É•Ù¥Í¥½¸°(€€€€€€€½µÁ±•Ñ”èÉ•ÍÕ±Ð¹½µÁ±•Ñ”€ôôôÑÉÕ”°(€€€€€€€¡¥Ñ½Õ¹ÐèÉ•ÍÕ±Ð¹¡¥ÑÌ¹±•¹Ñ °(€€€€€€€¡¥ÑÌèÉ•ÍÕ±Ð¹¡¥ÑÌ¹µ…À ¡¡¥Ð¤€ôø€¡ìÁ…Ñ è¡¥Ð¹Á…Ñ °¡…Í è¡¥Ð¹¡…Í ô¤¤°(€€€€€€€…Ðè…Ñ”¹¹½Ü ¤(€€€€€ô¤ì(€€€¥˜€¡Ý¥­¥=¹±ä¤ì(€€€€€™½È€¡½¹ÍÐ¡¥Ð½˜É•ÍÕ±Ð¹¡¥ÑÌñðmt¤ì(€€€€€€€¥˜€¡¡¥Ð¹­¥¹€ôôô€‰Ý¥­¤ˆ€˜˜€…ÍÑ…Ñ”Ì¹±¥¹­•‘]¥­¤¹¥¹±Õ‘•Ì¡¡¥Ð¹Á…Ñ ¤€˜˜ÍÑ…Ñ”Ì¹±¥¹­•‘]¥­¤¹±•¹Ñ €ð€ÄÈà¤(€€€€€€€€€ÍÑ…Ñ”Ì¹±¥¹­•‘]¥­¤¹ÁÕÍ ¡¡¥Ð¹Á…Ñ ¤ì(€€€€€€€½¹ÍÐÉ••¥ÁÐ€ôÍÑ…Ñ”Ì¹É•…‘Ì¹•Ð¡¡¥Ð¹Á…Ñ ¤ì(€€€€€€€¥˜€¡É••¥ÁÐü¹¡…Í €ôôô¡¥Ð¹¡…Í €˜˜ÍÑ…Ñ”Ì¹±¥¹­•‘]¥­¤¹¥¹±Õ‘•Ì¡¡¥Ð¹Á…Ñ ¤¤(€€€€€€€€€ÍÑ…Ñ”Ì¹É•…‘]¥­¤¹Í•Ð¡¡¥Ð¹Á…Ñ °É••¥ÁÐ¤ì(€€€€€ô(€€€ô(€€€É•ÑÕÉ¸É•ÍÕ±Ðì(€ô(€…Íå¹ŒÍ•µ…¹Ñ¥MÑ…ÑÕÌ¡ìÁÉ½©•Ð€ô¹Õ±°ô€ôíô¤ì(€€€…Ý…¥ÐÝ¥Ñ¡-¹½Ý±•‘•	¥¹‘¥¹œ¡Ñ¡¥Ì¹‰¥¹‘¥¹œ°…Íå¹Œ€ ¤€ôøì(€€€ô¤ì(€€€½¹ÍÐÍ•ÑÑ¥¹ÌÈ€ô…Ý…¥ÐÉ•…‘M•µ…¹Ñ¥M•ÑÑ¥¹Ì¡Ñ¡¥Ì¹‰¥¹‘¥¹œ¹Ù…Õ±Ñ%¤ì(€€€½¹ÍÐ¥¹‘•à€ô…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰ÍÑ…ÑÕÌˆ°ì(€€€€€™¥¹•ÉÁÉ¥¹ÐèÍ•ÑÑ¥¹ÌÈ¹•¹…‰±•€ü™¥¹•ÉÁÉ¥¹Ñ½È¡Í•ÑÑ¥¹ÌÈ¤€è¹Õ±°°(€€€€€ÁÉ½©•Ð(€€€ô¤ì(€€€½¹ÍÐ…Ñ¥Ù•M•µ…¹Ñ¥Œ€ôÍ•ÑÑ¥¹ÌÈ¹•¹…‰±•€ü¥¹‘•à¹Í•µ…¹Ñ¥M½Á•€üüìÙ•Ñ½ÉÌè€À°Á…Ñ¡Ìè€À°½Ù•É…”è€‰Õ¹½¹™¥ÕÉ•ˆô€èì€¸¸¹¥¹‘•à¹Í•µ…¹Ñ¥Œ°½Ù•É…”è€‰‘¥Í…‰±•ˆôì(€€€É•ÑÕÉ¸ì(€€€€€Í•ÑÑ¥¹ÌèÍ•ÑÑ¥¹ÌÈ°(€€€€€¥¹‘•àèì(€€€€€€€€¸¸¹¥¹‘•à°(€€€€€€€Í•µ…¹Ñ¥±°è¥¹‘•à¹Í•µ…¹Ñ¥Œ°(€€€€€€€Í•µ…¹Ñ¥Œè…Ñ¥Ù•M•µ…¹Ñ¥Œ(€€€€€ô(€€€ôì(€ô(€…Íå¹Œ•ÑM•µ…¹Ñ¥M•ÑÑ¥¹Ì ¤ì(€€€…Ý…¥ÐÝ¥Ñ¡-¹½Ý±•‘•	¥¹‘¥¹œ¡Ñ¡¥Ì¹‰¥¹‘¥¹œ°…Íå¹Œ€ ¤€ôøì(€€€ô¤ì(€€€É•ÑÕÉ¸É•…‘M•µ…¹Ñ¥M•ÑÑ¥¹Ì¡Ñ¡¥Ì¹‰¥¹‘¥¹œ¹Ù…Õ±Ñ%¤ì(€ô(€…Íå¹ŒÍ…Ù•M•µ…¹Ñ¥M•ÑÑ¥¹Ì¡¥¹ÁÕÐ°•áÁ•Ñ•‘	¥¹‘¥¹I•Ù¥Í¥½¸°•áÁ•Ñ•‘M•ÑÑ¥¹ÍI•Ù¥Í¥½¸¤ì(€€€É•ÑÕÉ¸ÅÕ•Õ•M•µ…¹Ñ¥Œ¡Ñ¡¥Ì¹‰¥¹‘¥¹œ¹Ù…Õ±Ñ%°…Íå¹Œ€ ¤€ôøì(€€€€€…Ý…¥Ð…ÍÍ•ÉÑ	¥¹‘¥¹œ¡Ñ¡¥Ì¹‰¥¹‘¥¹œ¤ì(€€€€€¥˜€¡•áÁ•Ñ•‘	¥¹‘¥¹I•Ù¥Í¥½¸€„ôôÑ¡¥Ì¹‰¥¹‘¥¹œ¹É•Ù¥Í¥½¸¤(€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÍ•ÑÑ¥¹Ì‰¥¹‘¥¹œÉ•Ù¥Í¥½¸¥ÌÍÑ…±”ˆ¤ì(€€€€€Ù…±¥‘…Ñ•M•µ…¹Ñ¥½¹™¥œ¡¥¹ÁÕÐ¤ì(€€€€€½¹ÍÐÙ…±Õ”€ô…Ý…¥ÐÍ…Ù•M•µ…¹Ñ¥M•ÑÑ¥¹Ì¡Ñ¡¥Ì¹‰¥¹‘¥¹œ¹Ù…Õ±Ñ%°¥¹ÁÕÐ°•áÁ•Ñ•‘M•ÑÑ¥¹ÍI•Ù¥Í¥½¸¤ì(€€€€€…Ý…¥Ð…ÍÍ•ÉÑ	¥¹‘¥¹œ¡Ñ¡¥Ì¹‰¥¹‘¥¹œ¤ì(€€€€€É•ÑÕÉ¸ì€¸¸¹Ù…±Õ”°É•‘•¹Ñ¥…±¹ØèÙ…±Õ”¹É•‘•¹Ñ¥…±¹Øôì(€€€ô¤ì(€ô(€…Íå¹ŒÑ•ÍÑM•µ…¹Ñ¥AÉ½Ù¥‘•È¡¥¹ÁÕÐ°•áÁ•Ñ•‘	¥¹‘¥¹I•Ù¥Í¥½¸°½ÁÑ¥½¹Ì€ôíô¤ì(€€€…Ý…¥Ð…ÍÍ•ÉÑ	¥¹‘¥¹œ¡Ñ¡¥Ì¹‰¥¹‘¥¹œ¤ì(€€€¥˜€¡•áÁ•Ñ•‘	¥¹‘¥¹I•Ù¥Í¥½¸€„ôôÑ¡¥Ì¹‰¥¹‘¥¹œ¹É•Ù¥Í¥½¸¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÁÉ½Ù¥‘•È‰¥¹‘¥¹œÉ•Ù¥Í¥½¸¥ÌÍÑ…±”ˆ¤ì(€€€½¹ÍÐ½¹™¥œ€ôÙ…±¥‘…Ñ•M•µ…¹Ñ¥½¹™¥œ¡¥¹ÁÕÐ¤ì(€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥Ð•µ‰•‘Q•áÑÌ¡½¹™¥œ°l‰‘É½¹”Í•µ…¹Ñ¥ŒÁÉ½Ù¥‘•ÈÑ•ÍÐ‰t°½ÁÑ¥½¹Ì¤ì(€€€…Ý…¥Ð…ÍÍ•ÉÑ	¥¹‘¥¹œ¡Ñ¡¥Ì¹‰¥¹‘¥¹œ¤ì(€€€É•ÑÕÉ¸ì½¬èÑÉÕ”°ÁÉ½Ù¥‘•ÈèÉ•ÍÕ±Ð¹ÁÉ½Ù¥‘•È°µ½‘•°èÉ•ÍÕ±Ð¹µ½‘•°°‘¥µ•¹Í¥½¸èÉ•ÍÕ±Ð¹‘¥µ•¹Í¥½¸ôì(€ô(€€¼¨¨Á…É…´íI•½ÉñÍÑÉ¥¹œ°…¹äùôm½ÁÑ¥½¹Ít€¨¼(€…Íå¹ŒÉ•‰Õ¥±‘M•µ…¹Ñ¥%¹‘•à¡ì±¥µ¥Ð€ô€à°ÁÉ½©•Ð€ô¹Õ±°°Í¥¹…°ô€ôíô¤ì(€€€…Ý…¥Ð…ÍÍ•ÉÑ	¥¹‘¥¹œ¡Ñ¡¥Ì¹‰¥¹‘¥¹œ¤ì(€€€½¹ÍÐÍ•ÑÑ¥¹ÌÈ€ô…Ý…¥ÐÉ•…‘M•µ…¹Ñ¥M•ÑÑ¥¹Ì¡Ñ¡¥Ì¹‰¥¹‘¥¹œ¹Ù…Õ±Ñ%¤ì(€€€¥˜€ …Í•ÑÑ¥¹ÌÈ¹•¹…‰±•¤É•ÑÕÉ¸ì•¹…‰±•è™…±Í”°ÍÑ…ÑÕÌè…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰ÍÑ…ÑÕÌˆ¤ôì(€€€½¹ÍÐ™¥¹•ÉÁÉ¥¹Ð€ô™¥¹•ÉÁÉ¥¹Ñ½È¡Í•ÑÑ¥¹ÌÈ¤ì(€€€½¹ÍÐ‰…Ñ €ô…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰Í•µ…¹Ñ¥	…Ñ ˆ°ì(€€€€€™¥¹•ÉÁÉ¥¹Ð°(€€€€€ÁÉ½©•Ð°(€€€€€±¥µ¥Ð°(€€€€€¡Õ¹­¡…ÉÌèÍ•ÑÑ¥¹ÌÈ¹¡Õ¹­¡…ÉÌ(€€€ô¤ì(€€€¥˜€ …‰…Ñ ¹¥Ñ•µÌ¹±•¹Ñ ¤(€€€€€É•ÑÕÉ¸ì•¹…‰±•èÑÉÕ”°ÁÉ½•ÍÍ•è€À°Á…ÉÑ¥…°è‰…Ñ ¹Á…ÉÑ¥…°°ÍÑ…ÑÕÌè…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰ÍÑ…ÑÕÌˆ¤ôì(€€€½¹ÍÐ•µ‰•‘‘•€ô…Ý…¥Ð•µ‰•‘Q•áÑÌ (€€€€€ÁÉ½Ù¥‘•É½¹™¥œ¡Í•ÑÑ¥¹ÌÈ¤°(€€€€€‰…Ñ ¹¥Ñ•µÌ¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹Ñ•áÐ¤°(€€€€€ìÍ¥¹…°ô(€€€€¤ì(€€€…Ý…¥Ð…ÍÍ•ÉÑ	¥¹‘¥¹œ¡Ñ¡¥Ì¹‰¥¹‘¥¹œ¤ì(€€€½¹ÍÐ±…Ñ•ÍÐ€ô…Ý…¥ÐÉ•…‘M•µ…¹Ñ¥M•ÑÑ¥¹Ì¡Ñ¡¥Ì¹‰¥¹‘¥¹œ¹Ù…Õ±Ñ%¤ì(€€€¥˜€ …±…Ñ•ÍÐ¹•¹…‰±•ñð™¥¹•ÉÁÉ¥¹Ñ½È¡±…Ñ•ÍÐ¤€„ôô™¥¹•ÉÁÉ¥¹Ð¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M•µ…¹Ñ¥ŒÍ•ÑÑ¥¹Ì¡…¹•‘ÕÉ¥¹œ¥¹‘•á¥¹œˆ¤ì(€€€…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰Í•µ…¹Ñ¥MÑ½É”ˆ°ì(€€€€€™¥¹•ÉÁÉ¥¹Ð°(€€€€€¥Ñ•µÌè‰…Ñ ¹¥Ñ•µÌ¹µ…À ¡¥Ñ•´°¥¹‘•à¤€ôø€¡ì€¸¸¹¥Ñ•´°Ù•Ñ½Èè•µ‰•‘‘•¹Ù•Ñ½ÉÍm¥¹‘•átô¤¤(€€€ô¤ì(€€€É•ÑÕÉ¸ì(€€€€€•¹…‰±•èÑÉÕ”°(€€€€€ÁÉ½•ÍÍ•è‰…Ñ ¹¥Ñ•µÌ¹±•¹Ñ °(€€€€€Á…ÉÑ¥…°è‰…Ñ ¹Á…ÉÑ¥…°°(€€€€€‘¥µ•¹Í¥½¸è•µ‰•‘‘•¹‘¥µ•¹Í¥½¸°(€€€€€ÍÑ…ÑÕÌè…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰ÍÑ…ÑÕÌˆ¤(€€€ôì(€ô(€…Íå¹Œ•Ù¥‘•¹•I••¥ÁÑÌ¡Ñ¥­•Ð°Ý°Á…Ñ¡Ì¤ì(€€€½¹ÍÐÍÑ…Ñ”Ì€ô…Ý…¥ÐÑ¡¥Ì¹¡•¬¡Ñ¥­•Ð°Ý¤ì(€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡Á…Ñ¡Ì¤ñð€…Á…Ñ¡Ì¹±•¹Ñ ñðÁ…Ñ¡Ì¹±•¹Ñ €ø€ÄÈñð¹•ÜM•Ð¡Á…Ñ¡Ì¤¹Í¥é”€„ôôÁ…Ñ¡Ì¹±•¹Ñ ¤ì(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰MÕÁÁ±ä€ÅqÔÈÀÄÌÄÈ‘¥ÍÑ¥¹ÐÍ½ÕÉ”Á…Ñ¡ÌÑ¡…ÐÝ•É”…ÑÕ…±±äÉ•…Ñ¡¥ÌÑÕÉ¸ˆ¤ì(€€€ô(€€€½¹ÍÐÍ½ÕÉ•Ì€ômtì(€€€™½È€¡½¹ÍÐÁ…Ñ ½˜Á…Ñ¡Ì¤ì(€€€€€Ù…±¥‘…Ñ•9½Ñ”¡Á…Ñ ¤ì(€€€€€¥˜€¡Á…Ñ ¹ÍÑ…ÉÑÍ]¥Ñ  ‰1¥‰É…Éä½áÁ±…¥¹•ÉÌ¼ˆ¤¤(€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È¡áÁ±…¥¹•È¥ÌÁÉ•Í•¹Ñ…Ñ¥½¸µ½¹±ä…¹…¹¹½Ð‰”ÕÍ•…Ì•Ù¥‘•¹”è€‘íÁ…Ñ¡õ€¤ì(€€€€€½¹ÍÐÉ••¥ÁÐ€ôÍÑ…Ñ”Ì¹É•…‘Ì¹•Ð¡Á…Ñ ¤ì(€€€€€¥˜€ …É••¥ÁÐ¤Ñ¡É½Ü¹•ÜÉÉ½È¡M½ÕÉ”Ý…Ì¹½ÐÉ•…Ñ¡¥ÌÑÕÉ¸è€‘íÁ…Ñ¡õ€¤ì(€€€€€½¹ÍÐ±…Ñ•ÍÐ€ô…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰É•…ˆ°ìÁ…Ñ °ÁÉ½©•ÐèÍÑ…Ñ”Ì¹ÁÉ½©•Ð°µ…á¡…ÉÌè€ÈÀÀô¤ì(€€€€€¥˜€¡±…Ñ•ÍÐ¹µ¥ÍÍ¥¹œñð±…Ñ•ÍÐ¹¡…Í €„ôôÉ••¥ÁÐ¹¡…Í ¤(€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È¡M½ÕÉ”¡…¹•ìÉ•…¥ÑÌ¹•ÜÙ•ÉÍ¥½¸è€‘íÁ…Ñ¡õ€¤ì(€€€€€Í½ÕÉ•Ì¹ÁÕÍ ¡ì€¸¸¹É••¥ÁÐô¤ì(€€€ô(€€€É•ÑÕÉ¸ìÁÉ½©•ÐèÍÑ…Ñ”Ì¹ÁÉ½©•Ð°Í½ÕÉ•Ìôì(€ô(€…Íå¹ŒÕÉÉ•¹ÑI•…‘Ù¥‘•¹”¡Ñ¥­•Ð°Ý°ì±¥µ¥Ð€ô€ÄÈô€ôíô¤ì(€€€…Ý…¥ÐÝ¥Ñ¡-¹½Ý±•‘•	¥¹‘¥¹œ¡Ñ¡¥Ì¹‰¥¹‘¥¹œ°…Íå¹Œ€ ¤€ôøì(€€€ô¤ì(€€€½¹ÍÐÍÑ…Ñ”Ì€ôÑ¡¥Ì¹Ñ¥­•ÑÌ¹•Ð¡Ñ¥­•Ð¤ì(€€€¥˜€ …ÍÑ…Ñ”ÌñðÍÑ…Ñ”Ì¹Ý€„ôôÉ•Í½±Ù”ÄÄ¡Ý¤ñð…Ñ”¹¹½Ü ¤€´ÍÑ…Ñ”Ì¹É•…Ñ•‘Ð€ø€ØÀ€¨€ØÀ€¨€Å”Ì¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰I•…ÕÉÉ•¹Ð¹…Ù¥…Ñ¥½¸Ý¥Ñ É•Í•…É¡}ÁÉ•Á…É•}­¹½Ý±•‘”™¥ÉÍÐˆ¤ì(€€€½¹ÍÐ…À€ô5…Ñ ¹µ…à Ä°5…Ñ ¹µ¥¸ ÄÈ°9Õµ‰•È¡±¥µ¥Ð¤ñð€ÄÈ¤¤ì(€€€½¹ÍÐÍ½ÕÉ•Ì€ômtì(€€€™½È€¡½¹ÍÐmÁ…Ñ °É••¥ÁÑt½˜l¸¸¹ÍÑ…Ñ”Ì¹É•…‘Ít¹É•Ù•ÉÍ” ¤¤ì(€€€€€¥˜€ ¼ üéyñp¼¤ üéáÁ±…¥¹•ÉÍñIÕ¹Ì¥p¼½¤¹Ñ•ÍÐ¡Á…Ñ ¤ñð€¼ üéyñp¼¥]¥­¥p¼¼¹Ñ•ÍÐ¡Á…Ñ ¤ñð€¼ üéyñp¼¤ üé!½µ•ñ%¹‘•áñ½¹Ñ•áÐ¥p¹µ¼¹Ñ•ÍÐ¡Á…Ñ ¤¤(€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€½¹ÍÐ±…Ñ•ÍÐ€ô…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰É•…ˆ°ìÁ…Ñ °ÁÉ½©•ÐèÍÑ…Ñ”Ì¹ÁÉ½©•Ð°µ…á¡…ÉÌè€ÈÀÀô¤ì(€€€€€¥˜€¡±…Ñ•ÍÐ¹µ¥ÍÍ¥¹œñð±…Ñ•ÍÐ¹¡…Í €„ôôÉ••¥ÁÐ¹¡…Í ¤½¹Ñ¥¹Õ”ì(€€€€€Í½ÕÉ•Ì¹ÁÕÍ ¡ì€¸¸¹É••¥ÁÐô¤ì(€€€€€¥˜€¡Í½ÕÉ•Ì¹±•¹Ñ €øô…À¤‰É•…¬ì(€€€ô(€€€É•ÑÕÉ¸ìÁÉ½©•ÐèÍÑ…Ñ”Ì¹ÁÉ½©•Ð°Í½ÕÉ•Ìôì(€ô(€€¼¨¨‘•±¥Ù•ÉäÉ••¥ÁÐ½¹™¥ÉµÌ„•¹•É…Ñ•±¥¹¬°¹½ÐÑ¡…Ð¥ÑÌÑ•áÐ¥Ì•Ù¥‘•¹”¸!½ÍÐµ½¹±äA$¸€¨¼(€…Íå¹Œ‘•±¥Ù•ÉåI••¥ÁÐ¡Ñ¥­•Ð°Ý°…‰Í½±ÕÑ•A…Ñ ¤ì(€€€½¹ÍÐÍÑ…Ñ”Ì€ô…Ý…¥ÐÑ¡¥Ì¹¡•¬¡Ñ¥­•Ð°Ý¤ì(€€€½¹ÍÐÁ…Ñ €ôÉ•±…Ñ¥Ù”à¡Ñ¡¥Ì¹‰¥¹‘¥¹œ¹Ù…Õ±Ð°É•Í½±Ù”ÄÄ¡…‰Í½±ÕÑ•A…Ñ ¤¤¹ÍÁ±¥Ð¡Í•Àà¤¹©½¥¸ ˆ¼ˆ¤ì(€€€Ù…±¥‘…Ñ•9½Ñ”¡Á…Ñ ¤ì(€€€¥˜€ ……¹I•…¡Á…Ñ °ÍÑ…Ñ”Ì¹ÁÉ½©•Ð¤ñð€„¡Á…Ñ ¹ÍÑ…ÉÑÍ]¥Ñ  ‰1¥‰É…Éä½áÁ±…¥¹•ÉÌ¼ˆ¤ñðÁ…Ñ ¹ÍÑ…ÉÑÍ]¥Ñ ¡AÉ½©•ÑÌ¼‘íÍÑ…Ñ”Ì¹ÁÉ½©•Ñô½IÕ¹Ì½€¤¤¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰9½Ð…¸…±±½Ý•ÁÉ•Í•¹Ñ…Ñ¥½¸½ÉÕ¸‘•±¥Ù•Éäˆ¤ì(€€€½¹ÍÐ™¥±”€ô…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰É•…ˆ°ìÁ…Ñ °ÁÉ½©•ÐèÍÑ…Ñ”Ì¹ÁÉ½©•Ð°µ…á¡…ÉÌè€ÈÀÀô¤ì(€€€¥˜€¡™¥±”¹µ¥ÍÍ¥¹œñð€…™¥±”¹¡…Í ¤Ñ¡É½Ü¹•ÜÉÉ½È ‰•±¥Ù•É•¹½Ñ”¥ÌÕ¹…Ù…¥±…‰±”ˆ¤ì(€€€É•ÑÕÉ¸ì(€€€€€Á…Ñ °(€€€€€¡…Í è™¥±”¹¡…Í °(€€€€€Ù…Õ±Ñ%èÑ¡¥Ì¹‰¥¹‘¥¹œ¹Ù…Õ±Ñ%°(€€€€€‰¥¹‘¥¹I•Ù¥Í¥½¸èÑ¡¥Ì¹‰¥¹‘¥¹œ¹É•Ù¥Í¥½¸°(€€€€€É½±”è€‰‘•±¥Ù•Éäµ½¹±äˆ(€€€ôì(€ô(€…Íå¹ŒÙ…±¥‘…Ñ•¹ÍÝ•È¡Ñ¥­•Ð°Ý°Ñ•áÐÌ°ì‘•±¥Ù•É¥•Ì€ômtô€ôíô¤ì(€€€½¹ÍÐÍÑ…Ñ”Ì€ô…Ý…¥ÐÑ¡¥Ì¹¡•¬¡Ñ¥­•Ð°Ý¤ì(€€€½¹ÍÐÍ•…É¡•€ôÍÑ…Ñ”Ì¹…¹ÍÝ•ÉM•…É ì(€€€½¹ÍÐ¥Ñ…Ñ¥½¹1¥µ¥Ð€ô€ÄÈì(€€€½¹ÍÐÙ•É¥™¥•‘M½ÕÉ•Ì€ômt°Ù•É¥™¥•‘=ÕÑÁÕÑÌ€ômtì(€€€½¹ÍÐ¥Ñ•‘A…Ñ¡Ì€ôl(€€€€€€¸¸¹¹•ÜM•Ð (€€€€€€€ÉÉ…ä¹™É½´¡MÑÉ¥¹œ¡Ñ•áÐÌ¤¹µ…Ñ¡±° ½qmql¡myquðt¬¤ üèmyquñt¨¤ü üéqñmyqut¨¤ýquqt½œ¤°€¡µ…Ñ ¤€ôøì(€€€€€€€€€½¹ÍÐÁ…Ñ €ôµ…Ñ¡lÅt¹ÑÉ¥´ ¤ì(€€€€€€€€€É•ÑÕÉ¸Á…Ñ ¹•¹‘Í]¥Ñ  ˆ¹µˆ¤€üÁ…Ñ €è€‘íÁ…Ñ¡ô¹µ‘€ì(€€€€€€€ô¤(€€€€€€¤(€€€tì(€€€½¹ÍÐÙ•É¥™¥•‘A…Ñ¡Ì€ô€¼¨}}AUI}|€¨¼¹•ÜM•Ð ¤ì(€€€½¹ÍÐÍ¹…ÁÍ¡½Ð€ô€ ¤€ôø€¡ì(€€€€€Ù…Õ±Ñ%èÑ¡¥Ì¹‰¥¹‘¥¹œ¹Ù…Õ±Ñ%°(€€€€€‰¥¹‘¥¹I•Ù¥Í¥½¸èÑ¡¥Ì¹‰¥¹‘¥¹œ¹É•Ù¥Í¥½¸°(€€€€€ÅÕ•Éå!…Í èÍÑ…Ñ”Ì¹ÅÕ•Éå!…Í °(€€€€€€¸¸¹Í•…É¡•€üìÍ•…É¡EÕ•ÉäèÍ•…É¡•¹ÅÕ•Éä°¥¹‘•áI•Ù¥Í¥½¸èÍ•…É¡•¹É•Ù¥Í¥½¸ô€èíô°(€€€€€Í½ÕÉ•Ìèl¸¸¹Ù•É¥™¥•‘M½ÕÉ•Ít°(€€€€€‘•±¥Ù•É¥•Ìèl¸¸¹Ù•É¥™¥•‘=ÕÑÁÕÑÍt°(€€€€€¥Ñ…Ñ¥½¹½Õ¹Ðè¥Ñ•‘A…Ñ¡Ì¹±•¹Ñ °(€€€€€¥Ñ…Ñ¥½¹1¥µ¥Ð°(€€€€€Õ¹Ù•É¥™¥•‘¥Ñ…Ñ¥½¹½Õ¹Ðè¥Ñ•‘A…Ñ¡Ì¹±•¹Ñ €´Ù•É¥™¥•‘A…Ñ¡Ì¹Í¥é”°(€€€€€Õ¹Ù•É¥™¥•‘¥Ñ…Ñ¥½¹Ìè¥Ñ•‘A…Ñ¡Ì¹™¥±Ñ•È ¡Á…Ñ ¤€ôø€…Ù•É¥™¥•‘A…Ñ¡Ì¹¡…Ì¡Á…Ñ ¤¤°(€€€€€Í¥•¹Ñ¥™¥…±±åY•É¥™¥•è™…±Í”(€€€ô¤ì(€€€±•Ð™¥ÉÍÑ…¥±ÕÉ”ì(€€€½¹ÍÐÉ•½É‘…¥±ÕÉ”È€ô€¡½‘”°µ•ÍÍ…”°Á…Ñ¡Ì€ômt¤€ôøì(€€€€€™¥ÉÍÑ…¥±ÕÉ”€üüô=‰©•Ð¹…ÍÍ¥¸¡¹•ÜÉÉ½È¡µ•ÍÍ…”¤°ì½‘”°Á…Ñ¡Ìô¤ì(€€€ôì(€€€¥˜€ …Í•…É¡•¤(€€€€€É•½É‘…¥±ÕÉ”È ‰Í•…É µÉ•ÅÕ¥É•ˆ°€‰½µÁ±•Ñ”„É•…°•Ù¥‘•¹”Í•…É Ñ¡¥ÌÑÕÉ¸‰•™½É”…¹ÍÝ•É¥¹œˆ¤ì(€€€•±Í”¥˜€ …Í•…É¡•¹½µÁ±•Ñ”¤(€€€€€É•½É‘…¥±ÕÉ”È ‰½Ù•É…”µ¥¹½µÁ±•Ñ”ˆ°€‰Q¡”±…ÍÐÍ•…É ‘¥¹½Ð¡…Ù”½µÁ±•Ñ”¥¹‘•à½Ù•É…”ˆ¤ì(€€€¥˜€¡ÍÑ…Ñ”Ì¹±¥¹­•‘]¥­¤¹±•¹Ñ €˜˜É•…‘I•Ù¥•Ý5½‘” ¤€ôôô€‰ÍÑÉ¥Ðˆ¤ì(€€€€€±•ÐÙ…±¥€ô™…±Í”ì(€€€€€™½È€¡½¹ÍÐmÁ…Ñ °É••¥ÁÑt½˜ÍÑ…Ñ”Ì¹É•…‘]¥­¤¤ì(€€€€€€€½¹ÍÐ±…Ñ•ÍÐÈ€ô…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰É•…ˆ°ìÁ…Ñ °ÁÉ½©•ÐèÍÑ…Ñ”Ì¹ÁÉ½©•Ð°µ…á¡…ÉÌè€ÈÀÀô¤ì(€€€€€€€¥˜€ …±…Ñ•ÍÐÈ¹µ¥ÍÍ¥¹œ€˜˜±…Ñ•ÍÐÈ¹¡…Í €ôôôÉ••¥ÁÐ¹¡…Í ¤ì(€€€€€€€€€Ù…±¥€ôÑÉÕ”ì(€€€€€€€€€‰É•…¬ì(€€€€€€€ô(€€€€€ô(€€€€€¥˜€ …Ù…±¥¤É•½É‘…¥±ÕÉ”È ‰Ý¥­¤µ¡…¹•ˆ°€‰Q¡”]¥­¤É•…¡…¹•ìÉ•……¹Í•…É ……¥¸ˆ¤ì(€€€ô(€€€½¹ÍÐ¥¹Ù…±¥‘A…Ñ¡Ì€ô€¼¨}}AUI}|€¨¼¹•ÜM•Ð ¤ì(€€€™½È€¡½¹ÍÐÁ…Ñ ½˜¥Ñ•‘A…Ñ¡Ì¤ì(€€€€€ÑÉäì(€€€€€€€Ù…±¥‘…Ñ•9½Ñ”¡Á…Ñ ¤ì(€€€€€ô…Ñ ì(€€€€€€€¥¹Ù…±¥‘A…Ñ¡Ì¹…‘¡Á…Ñ ¤ì(€€€€€€€É•½É‘…¥±ÕÉ”È ‰¥Ñ…Ñ¥½¸µ¥¹Ù…±¥ˆ°€‰%¹Ù…±¥Y…Õ±Ð¥Ñ…Ñ¥½¸ˆ°mÁ…Ñ¡t¤ì(€€€€€ô(€€€ô(€€€¥˜€¡¥Ñ•‘A…Ñ¡Ì¹±•¹Ñ €ø¥Ñ…Ñ¥½¹1¥µ¥Ð¤(€€€€€É•½É‘…¥±ÕÉ”È ‰¥Ñ…Ñ¥½¸µ‰Õ‘•Ðˆ°€‰1¥µ¥Ð½¹”¡•­•…¹ÍÝ•ÈÑ¼€ÄÈ‘¥ÍÑ¥¹Ð¥Ñ…Ñ¥½¹Ìˆ¤ì(€€€¥˜€¡Í•…É¡•ü¹¡¥Ñ½Õ¹Ð€˜˜€…¥Ñ•‘A…Ñ¡Ì¹±•¹Ñ ¤(€€€€€É•½É‘…¥±ÕÉ”È (€€€€€€€€‰¥Ñ…Ñ¥½¸µÉ•ÅÕ¥É•ˆ°(€€€€€€€€‰¥Ñ…Ñ¥½¸Ñ¼„É•…Í½ÕÉ”ÕÍ¥¹œmmY…Õ±Ð½É•±…Ñ¥Ù”½Á…Ñ¡ut¥ÌÉ•ÅÕ¥É•…™Ñ•ÈÍ•…É ¡¥ÑÌˆ(€€€€€€¤ì(€€€½¹ÍÐÍ½ÕÉ•Ì€ôÙ•É¥™¥•‘M½ÕÉ•Ì°½ÕÑÁÕÑÌ€ôÙ•É¥™¥•‘=ÕÑÁÕÑÌì(€€€™½È€¡½¹ÍÐÁ…Ñ ½˜¥Ñ•‘A…Ñ¡Ì¹Í±¥” À°¥Ñ…Ñ¥½¹1¥µ¥Ð¤¤ì(€€€€€¥˜€¡¥¹Ù…±¥‘A…Ñ¡Ì¹¡…Ì¡Á…Ñ ¤¤½¹Ñ¥¹Õ”ì(€€€€€½¹ÍÐ½ÕÑÁÕÐ€ô‘•±¥Ù•É¥•Ì¹™¥¹ (€€€€€€€€¡¥Ñ•´¤€ôø¥Ñ•´¹Á…Ñ €ôôôÁ…Ñ €˜˜¥Ñ•´¹É½±”€ôôô€‰‘•±¥Ù•Éäµ½¹±äˆ€˜˜¥Ñ•´¹Ù…Õ±Ñ%€ôôôÑ¡¥Ì¹‰¥¹‘¥¹œ¹Ù…Õ±Ñ%€˜˜¥Ñ•´¹‰¥¹‘¥¹I•Ù¥Í¥½¸€ôôôÑ¡¥Ì¹‰¥¹‘¥¹œ¹É•Ù¥Í¥½¸(€€€€€€¤ì(€€€€€¥˜€¡½ÕÑÁÕÐ¤ì(€€€€€€€½¹ÍÐ™¥±”€ô…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰É•…ˆ°ìÁ…Ñ °ÁÉ½©•ÐèÍÑ…Ñ”Ì¹ÁÉ½©•Ð°µ…á¡…ÉÌè€ÈÀÀô¤ì(€€€€€€€¥˜€¡™¥±”¹µ¥ÍÍ¥¹œñð™¥±”¹¡…Í €„ôô½ÕÑÁÕÐ¹¡…Í ¤ì(€€€€€€€€€É•½É‘…¥±ÕÉ”È ‰‘•±¥Ù•Éäµ¡…¹•ˆ°€‰•¹•É…Ñ•½ÕÑÁÕÐ¡…¹•…™Ñ•È¥ÐÝ…ÌÍ…Ù•ˆ°mÁ…Ñ¡t¤ì(€€€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€€€ô(€€€€€€€½ÕÑÁÕÑÌ¹ÁÕÍ ¡½ÕÑÁÕÐ¤ì(€€€€€€€Ù•É¥™¥•‘A…Ñ¡Ì¹…‘¡Á…Ñ ¤ì(€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€ô(€€€€€½¹ÍÐÉ••¥ÁÐ€ôÍÑ…Ñ”Ì¹É•…‘Ì¹•Ð¡Á…Ñ ¤ì(€€€€€¥˜€ …É••¥ÁÐ¤ì(€€€€€€€É•½É‘…¥±ÕÉ”È ‰Í½ÕÉ”µÕ¹É•…ˆ°¥Ñ•Í½ÕÉ”Ý…Ì¹½ÐÉ•…Ñ¡¥ÌÑÕÉ¸è€‘íÁ…Ñ¡õ€°mÁ…Ñ¡t¤ì(€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€ô(€€€€€½¹ÍÐ±…Ñ•ÍÐÈ€ô…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰É•…ˆ°ìÁ…Ñ °ÁÉ½©•ÐèÍÑ…Ñ”Ì¹ÁÉ½©•Ð°µ…á¡…ÉÌè€ÈÀÀô¤ì(€€€€€¥˜€¡±…Ñ•ÍÐÈ¹µ¥ÍÍ¥¹œñð±…Ñ•ÍÐÈ¹¡…Í €„ôôÉ••¥ÁÐ¹¡…Í ¤ì(€€€€€€€É•½É‘…¥±ÕÉ”È ‰Í½ÕÉ”µ¡…¹•ˆ°€‰¥Ñ•Í½ÕÉ”¡…¹•Í¥¹”¥ÑÌ…ÑÕ…°É•…ˆ°mÁ…Ñ¡t¤ì(€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€ô(€€€€€Í½ÕÉ•Ì¹ÁÕÍ ¡ì€¸¸¹É••¥ÁÐô¤ì(€€€€€Ù•É¥™¥•‘A…Ñ¡Ì¹…‘¡Á…Ñ ¤ì(€€€ô(€€€¥˜€¡Í•…É¡•ü¹¡¥Ñ½Õ¹Ð€˜˜€…Í½ÕÉ•Ì¹±•¹Ñ ¤(€€€€€É•½É‘…¥±ÕÉ”È (€€€€€€€€‰¥Ñ…Ñ¥½¸µÉ•ÅÕ¥É•ˆ°(€€€€€€€€‰•¹•É…Ñ•½ÕÑÁÕÐ±¥¹­Ì…É”¹½ÐÍ¥•¹Ñ¥™¥Œ•Ù¥‘•¹”ì¥Ñ”„Í½ÕÉ”É•…Ñ¡¥ÌÑÕÉ¸ˆ(€€€€€€¤ì(€€€¥˜€¡É•ÅÕ¥É•ÍA…Á•ÉÙ¥‘•¹”¡ÍÑ…Ñ”Ì¹ÅÕ•Éä¤€˜˜€…¡…ÍA…Á•É¥Ñ…Ñ¥½¸¡Í½ÕÉ•Ì¤¤(€€€€€É•½É‘…¥±ÕÉ”È (€€€€€€€€‰Á…Á•Èµ¥Ñ…Ñ¥½¸µÉ•ÅÕ¥É•ˆ°(€€€€€€€€‰Q¡¥ÌÉ•Í•…É É•ÅÕ•ÍÐ¹••‘ÌÍÁ•¥™¥Œ½É¥¥¹…°µÁ…Á•È•Ù¥‘•¹”ì]¥­¤…¹•¹•É…Ñ•É•Á½ÉÑÌ…±½¹”…É”¥¹ÍÕ™™¥¥•¹Ðˆ(€€€€€€¤ì(€€€½¹ÍÐ±…Ñ•ÍÐ€ô…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰ÍÑ…ÑÕÌˆ°ì™±ÕÍ¡A•¹‘¥¹œèÑÉÕ”ô¤ì(€€€¥˜€¡Í•…É¡•€˜˜±…Ñ•ÍÐ¹É•Ù¥Í¥½¸€„ôôÍ•…É¡•¹É•Ù¥Í¥½¸¤(€€€€€É•½É‘…¥±ÕÉ”È ‰Í•…É µÍÑ…±”ˆ°€‰%¹‘•àÉ•Ù¥Í¥½¸¡…¹•…™Ñ•ÈÑ¡”Í•…É ìÍ•…É ……¥¸ˆ¤ì(€€€¥˜€¡±…Ñ•ÍÐ¹½Ù•É…”€„ôô€‰É•…‘äˆñð±…Ñ•ÍÐ¹Á•¹‘¥¹¡…¹•Ìñð±…Ñ•ÍÐ¹ÁÉ½‰±•µÌ¹±•¹Ñ ¤(€€€€€É•½É‘…¥±ÕÉ”È ‰½Ù•É…”µ¥¹½µÁ±•Ñ”ˆ°€‰%¹‘•à½Ù•É…”¥Ì¹½Ð½µÁ±•Ñ”…ÐÁÕ‰±¥…Ñ¥½¸ˆ¤ì(€€€…Ý…¥ÐÝ¥Ñ¡-¹½Ý±•‘•	¥¹‘¥¹œ¡Ñ¡¥Ì¹‰¥¹‘¥¹œ°…Íå¹Œ€ ¤€ôøì(€€€ô¤ì(€€€¥˜€¡™¥ÉÍÑ…¥±ÕÉ”¤Ñ¡É½Ü=‰©•Ð¹…ÍÍ¥¸¡™¥ÉÍÑ…¥±ÕÉ”°ìÙ•É¥™¥•èÍ¹…ÁÍ¡½Ð ¤ô¤ì(€€€É•ÑÕÉ¸ì(€€€€€ÍÑ…ÑÕÌèÍ•…É¡•¹¡¥Ñ½Õ¹Ð€ü€‰É•…‘äˆ€è€‰¹¼µ¡¥ÑÌˆ°(€€€€€€¸¸¹Í¹…ÁÍ¡½Ð ¤(€€€ôì(€ô(€±½Í” ¤ì(€€€¥˜€¡Ñ¡¥Ì¹±½Í•AÉ½µ¥Í”¤É•ÑÕÉ¸Ñ¡¥Ì¹±½Í•AÉ½µ¥Í”ì(€€€Ñ¡¥Ì¹±½Í¥¹œ€ôÑÉÕ”ì(€€€Ñ¡¥Ì¹±½Í•AÉ½µ¥Í”€ô€¡…Íå¹Œ€ ¤€ôøì(€€€€€½¹ÍÐ•á¥Ñ•€ô¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”ÄÔ¤€ôøì(€€€€€€€¥˜€¡Ñ¡¥Ì¹Ý½É­•È¹Ñ¡É•…‘%€ôôô€´Ä¤É•Í½±Ù”ÄÔ ¤ì(€€€€€€€•±Í”Ñ¡¥Ì¹Ý½É­•È¹½¹” ‰•á¥Ðˆ°É•Í½±Ù”ÄÔ¤ì(€€€€€ô¤ì(€€€€€ÑÉäì(€€€€€€€¥˜€ …Ñ¡¥Ì¹±½Í•¤…Ý…¥ÐÑ¡¥Ì¹É•ÅÕ•ÍÐ ‰±½Í”ˆ¤ì(€€€€€ô…Ñ ì(€€€€€€€…Ý…¥ÐÑ¡¥Ì¹Ý½É­•È¹Ñ•Éµ¥¹…Ñ” ¤ì(€€€€€ô™¥¹…±±äì(€€€€€€€Ñ¡¥Ì¹±½Í•€ôÑÉÕ”ì(€€€€€€€™½È€¡½¹ÍÐ¥Ñ•´½˜Ñ¡¥Ì¹Á•¹‘¥¹œ¹Ù…±Õ•Ì ¤¤ì(€€€€€€€€€±•…ÉQ¥µ•½ÕÐ¡¥Ñ•´¹Ñ¥µ•È¤ì(€€€€€€€€€¥Ñ•´¹É•©•Ð¡¹•ÜÉÉ½È ‰-¹½Ý±•‘”Í•ÉÙ¥”±½Í•ˆ¤¤ì(€€€€€€€ô(€€€€€€€Ñ¡¥Ì¹Á•¹‘¥¹œ¹±•…È ¤ì(€€€€€€€Ñ¡¥Ì¹Ñ¥­•ÑÌ¹±•…È ¤ì(€€€€€€€Ñ¡¥Ì¹Ý½É­•È¹É•˜ ¤ì(€€€€€€€½¹ÍÐ™…±±‰…¬€ôÍ•ÑQ¥µ•½ÕÐ  ¤€ôøì(€€€€€€€€€Ù½¥Ñ¡¥Ì¹Ý½É­•È¹Ñ•Éµ¥¹…Ñ” ¤ì(€€€€€€€ô°€Õ”Ì¤ì(€€€€€€€ÑÉäì(€€€€€€€€€…Ý…¥Ð•á¥Ñ•ì(€€€€€€€ô™¥¹…±±äì(€€€€€€€€€±•…ÉQ¥µ•½ÕÐ¡™…±±‰…¬¤ì(€€€€€€€ô(€€€€€ô(€€€ô¤ ¤ì(€€€É•ÑÕÉ¸Ñ¡¥Ì¹±½Í•AÉ½µ¥Í”ì(€ô)ôì)…Íå¹Œ™Õ¹Ñ¥½¸•Ñ-¹½Ý±•‘•M•ÉÙ¥”¡‰¥¹‘¥¹œ€ô¹Õ±°¤ì(€‰¥¹‘¥¹œñðô…Ý…¥ÐÉ•…‘-¹½Ý±•‘•	¥¹‘¥¹œ ¤ì(€½¹ÍÐ‘¥É•Ñ½Éä€ô­¹½Ý±•‘•¥É•Ñ½Éä ¤ì(€¥˜€ …‰¥¹‘¥¹œñð€…‘¥É•Ñ½Éä¤Ñ¡É½Ü¹•ÜÉÉ½È ‰9¼…ÁÁ±¥…Ñ¥½¸­¹½Ý±•‘”Y…Õ±Ð¥Ì‰½Õ¹ˆ¤ì(€½¹ÍÐ­•ä€ô©½¥¸ÄÄ¡‘¥É•Ñ½Éä°‰¥¹‘¥¹œ¹Ù…Õ±Ñ%°€‰¥¹‘•à¹ÍÅ±¥Ñ”ˆ¤ì(€±•ÐÍ•ÉÙ¥”€ôÁ½½°¹•Ð¡­•ä¤ì(€¥˜€¡Í•ÉÙ¥”€˜˜€…Í•ÉÙ¥”¹±½Í•€˜˜Í•ÉÙ¥”¹‰¥¹‘¥¹œü¹É•Ù¥Í¥½¸€„ôô‰¥¹‘¥¹œ¹É•Ù¥Í¥½¸¤ì(€€€Á½½°¹‘•±•Ñ”¡­•ä¤ì(€€€…Ý…¥ÐÍ•ÉÙ¥”¹±½Í” ¤ì(€€€Í•ÉÙ¥”€ô¹Õ±°ì(€ô(€¥˜€ …Í•ÉÙ¥”ñðÍ•ÉÙ¥”¹±½Í•¤ì(€€€•µ¥ÑAÉ½•ÍÍÙ•¹ÐÈ¡MIY%}Y9P°ì…Ñ¥½¸è€‰É•ÅÕ•ÍÐˆ°­•ä°½É¥¥¸èÍ•ÉÙ¥•5½‘Õ±”ô¤ì(€€€Í•ÉÙ¥”€ôÁ½½°¹•Ð¡­•ä¤ì(€ô(€¥˜€ …Í•ÉÙ¥”ñðÍ•ÉÙ¥”¹±½Í•¤ì(€€€Í•ÉÙ¥”€ô¹•Ü-¹½Ý±•‘•M•ÉÙ¥”¡‰¥¹‘¥¹œ°‘¥É•Ñ½Éä¤ì(€€€Á½½°¹Í•Ð¡­•ä°Í•ÉÙ¥”¤ì(€€€•µ¥ÑAÉ½•ÍÍÙ•¹ÐÈ¡MIY%}Y9P°ì…Ñ¥½¸è€‰É•¥ÍÑ•Èˆ°­•ä°Í•ÉÙ¥”°½É¥¥¸èÍ•ÉÙ¥•5½‘Õ±”ô¤ì(€€€½¹ÍÐ¥‘±”€ôl¸¸¹Á½½±t¹™¥±Ñ•È ¡m½Ñ¡•È°Ù…±Õ•t¤€ôø½Ñ¡•È€„ôô­•ä€˜˜Ù…±Õ”¹Á•¹‘¥¹œ¹Í¥é”€ôôô€À¤ì(€€€Ý¡¥±”€¡Á½½°¹Í¥é”€ø€Ì€˜˜¥‘±”¹±•¹Ñ ¤ì(€€€€€½¹ÍÐm½Ñ¡•È°Ù…±Õ•t€ô¥‘±”¹Í¡¥™Ð ¤ì(€€€€€Á½½°¹‘•±•Ñ”¡½Ñ¡•È¤ì(€€€€€…Ý…¥ÐÙ…±Õ”¹±½Í” ¤ì(€€€ô(€ô(€É•ÑÕÉ¸Í•ÉÙ¥”ì)ô)…Íå¹Œ™Õ¹Ñ¥½¸¹½Ñ¥™å-¹½Ý±•‘•¡…¹”¡Á…Ñ ¤ì(€½¹ÍÐ‰¥¹‘¥¹œ€ô…Ý…¥ÐÉ•…‘-¹½Ý±•‘•	¥¹‘¥¹œ ¤ì(€¥˜€ …‰¥¹‘¥¹œñð€…­¹½Ý±•‘•¥É•Ñ½Éä ¤¤É•ÑÕÉ¸ì¥¹‘•á•è™…±Í”°É•…Í½¸è€‰±•…äµµ½‘”ˆôì(€½¹ÍÐ¹½Ñ”€ôÉ•±…Ñ¥Ù”à¡‰¥¹‘¥¹œ¹Ù…Õ±Ð°Á…Ñ ¤¹ÍÁ±¥Ð¡Í•Àà¤¹©½¥¸ ˆ¼ˆ¤ì(€ÑÉäì(€€€Ù…±¥‘…Ñ•9½Ñ”¡¹½Ñ”¤ì(€€€½¹ÍÐÍ•ÉÙ¥”€ô…Ý…¥Ð•Ñ-¹½Ý±•‘•M•ÉÙ¥”¡‰¥¹‘¥¹œ¤ì(€€€½¹ÍÐÍÑ…ÑÕÌÈ€ô…Ý…¥ÐÍ•ÉÙ¥”¹É•ÅÕ•ÍÐ ‰¡…¹•ˆ°ìÁ…Ñ¡Ìèm¹½Ñ•tô¤ì(€€€É•ÑÕÉ¸ì¥¹‘•á•èÑÉÕ”°É•Ù¥Í¥½¸èÍÑ…ÑÕÌÈ¹É•Ù¥Í¥½¸°µ…¥¹Ñ•¹…¹”è€‰ÅÕ•Õ•ˆôì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€É•ÑÕÉ¸ì¥¹‘•á•è™…±Í”°Í…Ù•èÑÉÕ”°•ÉÉ½Èè•ÉÉ½È¹µ•ÍÍ…”°µ…¥¹Ñ•¹…¹”è€‰É•½¹¥±”µÉ•ÅÕ¥É•ˆôì(€ô)ô((¼¼Á…­…•Ì½­¹½Ý±•‘”½ÍÉŒ½Í½ÕÉ”µ±¥¹­Ì¹ÑÌ)™Õ¹Ñ¥½¸±…‰•°¡Ñ•áÐÌ¤ì(€É•ÑÕÉ¸l¸¸¹MÑÉ¥¹œ¡Ñ•áÐÌ¥t¹µ…À (€€€€¡¡…È¤€ôø€‰mtðøˆ¹¥¹±Õ‘•Ì¡¡…È¤ñð¡…È¹¡…É½‘•Ð À¤€ôôô€ÄÀñð¡…È¹¡…É½‘•Ð À¤€ôôô€ÄÌ€ü€ˆ€ˆ€è¡…È(€€¤¹©½¥¸ ˆˆ¤¹Í±¥” À°€ÈÈÀ¤ì)ô)™Õ¹Ñ¥½¸½¹±¥¹•M½ÕÉ•1¥¹¬¡Ù…±Õ”°Ñ¥Ñ±”€ô€‰=¹±¥¹”Í½ÕÉ”ˆ¤ì(€½¹ÍÐÕÉ°€ô¹•ÜUI0¡Ù…±Õ”¤ì(€¥˜€ …l‰¡ÑÑÀèˆ°€‰¡ÑÑÁÌè‰t¹¥¹±Õ‘•Ì¡ÕÉ°¹ÁÉ½Ñ½½°¤ñðÕÉ°¹ÕÍ•É¹…µ”ñðÕÉ°¹Á…ÍÍÝ½É¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰áÁ•Ñ•„É•‘•¹Ñ¥…°µ™É•”!QQ@¡L¤Í½ÕÉ”UI0ˆ¤ì(€É•ÑÕÉ¸l‘í±…‰•°¡Ñ¥Ñ±”¥õt ð‘íÕÉ°¹¡É•™ôø¥€ì)ô((¼¼Á…­…•Ì½­¹½Ý±•‘”½ÍÉŒ½Õ¤µÍ•ÉÙ¥”¹ÑÌ)¥¹¥Ñ}ÍÁ•¥…±¥ÍÑ}¡½ÍÐ ¤ì)¥¹¥Ñ}Õ¥}ÍÑ…Ñ” ¤ì)¥¹¥Ñ}Ý¥­¥}É•Ù¥•Ü ¤ì)Ù…ÈÉÕ¹Ñ¥µ•MÑ…Ñ”€ôÉÕ¹Ñ¥µ•M±½ÐÈ ‰­¹½Ý±•‘”ˆ°€‰Õ¥M•ÉÙ¥”ˆ°€ ¤€ôø€¡ì(€ÁÉ•Ù¥•ÝÌè€¼¨}}AUI}|€¨¼¹•Ü5…À ¤°(€µ…¥¹Ñ•¹…¹”è€¼¨}}AUI}|€¨¼¹•ÜM•Ð ¤°(€Í•µ…¹Ñ¥)½‰Ìè€¼¨}}AUI}|€¨¼¹•Ü5…À ¤°(€‘¥ÍÁ½Í” ¤ì(€€€Ñ¡¥Ì¹ÁÉ•Ù¥•ÝÌ¹±•…È ¤ì(€€€Ñ¡¥Ì¹µ…¥¹Ñ•¹…¹”¹±•…È ¤ì(€€€Ñ¡¥Ì¹Í•µ…¹Ñ¥)½‰Ì¹±•…È ¤ì(€ô)ô¤¤ì)™Õ¹Ñ¥½¸Á…Ñ¡Ý¡Ý¤ì(€¥˜€¡Ý€„ôô¹Õ±°€˜˜Ý€„ôôÙ½¥€À€˜˜€¡ÑåÁ•½˜Ý€„ôô€‰ÍÑÉ¥¹œˆñð€…¥Í‰Í½±ÕÑ”ÄÀ¡Ý¤¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰]½É­ÍÁ…”µÕÍÐ‰”…¸…‰Í½±ÕÑ”Á…Ñ ˆ¤ì(€É•ÑÕÉ¸Ý€üÉ•Í½±Ù”ÄÈ¡Ý¤€è¹Õ±°ì)ô)™Õ¹Ñ¥½¸½¹ÍÕµ•-¹½Ý±•‘•I•Ù¥•ÝAÉ•Ù¥•Ü¡Ý°Ñ½­•¸¤ì(€½¹ÍÐ•¹ÑÉä€ôÉÕ¹Ñ¥µ•MÑ…Ñ”¹ÁÉ•Ù¥•ÝÌ¹•Ð¡Ñ½­•¸¤ì(€¥˜€ …•¹ÑÉäñð•¹ÑÉä¹Ý€„ôôÁ…Ñ¡Ý¡Ý¤ñð•¹ÑÉä¹•áÁ¥É•Ì€ð…Ñ”¹¹½Ü ¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰I•Ù¥•Ü•áÁ¥É•ì½Á•¸Ñ¡”•á…ÐÁÉ•Ù¥•Ü……¥¸ˆ¤ì(€ÉÕ¹Ñ¥µ•MÑ…Ñ”¹ÁÉ•Ù¥•ÝÌ¹‘•±•Ñ”¡Ñ½­•¸¤ì(€É•ÑÕÉ¸•¹ÑÉäì)ô((¼¼Á…­…•Ì½•áÑ•¹Í¥½¹Ì½ÍÉŒ½¥¹Ñ•É¹…°½½‰Í¥‘¥…¸µÝ½É­‰•¹ ¹ÑÌ)¥¹¥Ñ}½¹™¥œ ¤ì((¼¼Á…­…•Ì½•áÑ•¹Í¥½¹Ì½ÍÉŒ½¥¹Ñ•É¹…°½Ù…Õ±ÐµÁÉ½™¥±•Ì¹ÑÌ)Ù…ÈYU1Q}AI=%1LÈ€ôì(€ÁÉ½©•Ðèì(€€€¥è€‰ÁÉ½©•Ðˆ°(€€€±…‰•°è€‰qÔÜåÅqÔÜàÄÑqÔäàÜåqÔÜÙqÔÔÜáˆ°(€€€‘•ÍÉ¥ÁÑ¥½¸è€‰qÔÔÙÑqÔÝÕqÔÔÌÔÕqÔÑÉqÔÜàÄÑqÔÝÜÙqÔäàÜåqÔÜÙqÔÝÑqÔÝÝqÔäÕqÔäàäáqÔÌÀÀÅqÔá	ÅqÔØÌÙqÔÌÀÀÅqÔÝÍqÔá		qÔÌÀÀÅqÔáÁqÔààÑqÔá	ÁqÔÕÔÕqÔÔÐáqÔÑÝqÔÜÈØåqÕÅ	qÔÔÄÜÅqÔÑ	qÔØÔàÝqÔÜÌÉqÔÕäÍqÔÑqÔØÌÀÅqÔÝ	qÔÝàÁqÔÌÀÀÈˆ°(€€€ÁÉ½©•ÑQåÁ•Ìèl(€€€€€€‰EÕ•ÍÑ¥½¹Ìˆ°(€€€€€€‰½¹•ÁÑÌˆ°(€€€€€€‰¹Ñ¥Ñ¥•Ìˆ°(€€€€€€‰A…Á•ÉÌˆ°(€€€€€€‰M½ÕÉ•Ìˆ°(€€€€€€‰Ù¥‘•¹”ˆ°(€€€€€€‰±…¥µÌˆ°(€€€€€€‰•¥Í¥½¹Ìˆ°(€€€€€€‰IÕ¹Ìˆ°(€€€€€€‰ÉÑ¥™…ÑÌˆ°(€€€€€€‰]¥­¤ˆ(€€€t°(€€€±¥‰É…ÉåQåÁ•Ìèl‰A…Á•ÉÌˆ°€‰5•Ñ¡½‘Ìˆ°€‰M½™ÑÝ…É”ˆ°€‰%‘•…Ìˆ°€‰…Ñ…Í•ÑÌˆ°€‰áÁ±…¥¹•ÉÌ‰t°(€€€‘•Á½Í¥Ñ¥½¸èì(€€€€€ÉÕ¹MÕµµ…É¥•ÌèÑÉÕ”°(€€€€€Ù•É¥™¥•‘M½ÕÉ•ÌèÑÉÕ”°(€€€€€Ù…±¥‘…Ñ•‘±…¥µÌèÑÉÕ”°(€€€€€É•ÕÍ…‰±•½¹•ÁÑÌè™…±Í”°(€€€€€‘•¥Í¥½¹ÌèÑÉÕ”°(€€€€€Ý¥­¤èÑÉÕ”(€€€ô(€ô°(€±¥Ñ•É…ÑÕÉ”èì(€€€¥è€‰±¥Ñ•É…ÑÕÉ”ˆ°(€€€±…‰•°è€‰qÔØÔàÝqÔÜÌÉqÔÜÝÕqÔá	ÙqÔÕäÍqÔÔÜáˆ°(€€€‘•ÍÉ¥ÁÑ¥½¸è€‰qÔÕÍqÔáÀÍqÔááqÔäàÜåqÔÜÙqÔÔäÁqÔÜÔÈáqÔÜØàÑqÔá		qÔØÔàÝqÔÌÀÀÅqÔØÕåqÔÙÕqÔÌÀÀÅqÔØäàÉqÔÕÕqÔÌÀÀÅqÔÕåqÔÑÔÍqÔÑÁqÔáÙqÔÑÙqÔÜÝÕqÔá	ÙqÕÁqÔÔÐÁqÔØÕÙqÔÑqÔÜÔÔåqÔáÝ	qÔäÅqÔäàÜåqÔÜÙqÔÕÐÉqÔÌÀÀÈˆ°(€€€ÁÉ½©•ÑQåÁ•Ìèl‰EÕ•ÍÑ¥½¹Ìˆ°€‰A…Á•ÉÌˆ°€‰Ù¥‘•¹”ˆ°€‰±…¥µÌˆ°€‰IÕ¹Ìˆ°€‰]¥­¤‰t°(€€€±¥‰É…ÉåQåÁ•Ìèl‰A…Á•ÉÌˆ°€‰5•Ñ¡½‘Ìˆ°€‰½¹•ÁÑÌˆ°€‰M½™ÑÝ…É”ˆ°€‰¹Ñ¥Ñ¥•Ìˆ°€‰%‘•…Ìˆ°€‰…Ñ…Í•ÑÌˆ°€‰áÁ±…¥¹•ÉÌ‰t°(€€€‘•Á½Í¥Ñ¥½¸èì(€€€€€ÉÕ¹MÕµµ…É¥•ÌèÑÉÕ”°(€€€€€Ù•É¥™¥•‘M½ÕÉ•ÌèÑÉÕ”°(€€€€€Ù…±¥‘…Ñ•‘±…¥µÌèÑÉÕ”°(€€€€€É•ÕÍ…‰±•½¹•ÁÑÌèÑÉÕ”°(€€€€€‘•¥Í¥½¹Ìè™…±Í”°(€€€€€Ý¥­¤èÑÉÕ”(€€€ô(€ô°(€¡å‰É¥èì(€€€¥è€‰¡å‰É¥ˆ°(€€€±…‰•°è€‰qÔÙÝqÔÔÐÀáqÔÔÜá	qÕÀáqÔØÍáqÔàÌÔÁqÕÀäˆ°(€€€‘•ÍÉ¥ÁÑ¥½¸è€‰qÔäàÜåqÔÜÙqÔÕÐÉqÔÑqÔÕÔáqÔÜàÄÑqÔÝÜÙqÔÑÁqÔÑÁ	qÔØÔàÝqÔÑÁqÔá	ÅqÔØÌÙqÔäÑqÕÁqÔÔÄÜÅqÔÑ1¥‰É…ÉäqÔÑqÔÕÔáqÔÔÍqÔÔäÁqÔÜÔÈáqÔÜÝÕqÔá	ÙqÕÅ	qÔäÀÀÉqÔÔÐÀài½Ñ•É¼€¬=‰Í¥‘¥…¸€¬]¥­¥1½½ÁqÔÌÀÀÈˆ°(€€€ÁÉ½©•ÑQåÁ•Ìèl(€€€€€€‰EÕ•ÍÑ¥½¹Ìˆ°(€€€€€€‰½¹•ÁÑÌˆ°(€€€€€€‰¹Ñ¥Ñ¥•Ìˆ°(€€€€€€‰A…Á•ÉÌˆ°(€€€€€€‰M½ÕÉ•Ìˆ°(€€€€€€‰Ù¥‘•¹”ˆ°(€€€€€€‰±…¥µÌˆ°(€€€€€€‰•¥Í¥½¹Ìˆ°(€€€€€€‰IÕ¹Ìˆ°(€€€€€€‰ÉÑ¥™…ÑÌˆ°(€€€€€€‰]¥­¤ˆ(€€€t°(€€€±¥‰É…ÉåQåÁ•Ìèl‰A…Á•ÉÌˆ°€‰5•Ñ¡½‘Ìˆ°€‰½¹•ÁÑÌˆ°€‰M½™ÑÝ…É”ˆ°€‰¹Ñ¥Ñ¥•Ìˆ°€‰%‘•…Ìˆ°€‰…Ñ…Í•ÑÌˆ°€‰áÁ±…¥¹•ÉÌ‰t°(€€€‘•Á½Í¥Ñ¥½¸èì(€€€€€ÉÕ¹MÕµµ…É¥•ÌèÑÉÕ”°(€€€€€Ù•É¥™¥•‘M½ÕÉ•ÌèÑÉÕ”°(€€€€€Ù…±¥‘…Ñ•‘±…¥µÌèÑÉÕ”°(€€€€€É•ÕÍ…‰±•½¹•ÁÑÌèÑÉÕ”°(€€€€€‘•¥Í¥½¹ÌèÑÉÕ”°(€€€€€Ý¥­¤èÑÉÕ”(€€€ô(€ô)ôì)Ù…ÈU1Q}YU1Q}AI=%1È€ô€‰¡å‰É¥ˆì)™Õ¹Ñ¥½¸•ÑY…Õ±ÑAÉ½™¥±”È¡¥€ôU1Q}YU1Q}AI=%1È¤ì(€½¹ÍÐÁÉ½™¥±”€ôYU1Q}AI=%1LÉm¥‘tì(€¥˜€ …ÁÉ½™¥±”¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È¡U¹­¹½Ý¸­¹½Ý±•‘”ÁÉ½™¥±”è€‘í¥‘õ€¤ì(€É•ÑÕÉ¸ÁÉ½™¥±”ì)ô)™Õ¹Ñ¥½¸±¥ÍÑY…Õ±ÑAÉ½™¥±•Ì ¤ì(€É•ÑÕÉ¸=‰©•Ð¹Ù…±Õ•Ì¡YU1Q}AI=%1LÈ¤¹µ…À ¡ÁÉ½™¥±”¤€ôø€¡ì(€€€€¸¸¹ÁÉ½™¥±”°(€€€‘•Á½Í¥Ñ¥½¸èì€¸¸¹ÁÉ½™¥±”¹‘•Á½Í¥Ñ¥½¸ô(€ô¤¤ì)ô((¼¼Á…­…•Ì½•áÑ•¹Í¥½¹Ì½ÍÉŒ½¥¹Ñ•É¹…°½Ù…Õ±Ðµ±…å½ÕÐ¹ÑÌ)Ù…È1e=UPÈ€ôì(€€‰Ù•ÉÍ¥½¸ˆè€Ì°(€€‰ÁÉ½©•ÑQåÁ•Ìˆèl(€€€€‰EÕ•ÍÑ¥½¹Ìˆ°(€€€€‰½¹•ÁÑÌˆ°(€€€€‰¹Ñ¥Ñ¥•Ìˆ°(€€€€‰A…Á•ÉÌˆ°(€€€€‰M½ÕÉ•Ìˆ°(€€€€‰Ù¥‘•¹”ˆ°(€€€€‰±…¥µÌˆ°(€€€€‰•¥Í¥½¹Ìˆ°(€€€€‰IÕ¹Ìˆ°(€€€€‰ÉÑ¥™…ÑÌˆ°(€€€€‰]¥­¤ˆ(€t°(€€‰±¥‰É…ÉåQåÁ•Ìˆèl(€€€€‰A…Á•ÉÌˆ°(€€€€‰5•Ñ¡½‘Ìˆ°(€€€€‰½¹•ÁÑÌˆ°(€€€€‰M½™ÑÝ…É”ˆ°(€€€€‰¹Ñ¥Ñ¥•Ìˆ°(€€€€‰%‘•…Ìˆ°(€€€€‰…Ñ…Í•ÑÌˆ°(€€€€‰áÁ±…¥¹•ÉÌˆ(€t°(€€‰Ñ•µÁ±…Ñ•Ìˆèì(€€€€‰AÉ½©•Ðˆè€‰ÁÉ½©•Ðˆ°(€€€€‰EÕ•ÍÑ¥½¸ˆè€‰ÅÕ•ÍÑ¥½¸ˆ°(€€€€‰M½ÕÉ”ˆè€‰Í½ÕÉ”ˆ°(€€€€‰±…¥´ˆè€‰±…¥´ˆ°(€€€€‰Ù¥‘•¹”ˆè€‰•Ù¥‘•¹”ˆ°(€€€€‰IÕ¸ˆè€‰ÉÕ¸ˆ(€ô°(€€‰¹½Ñ•Q•µÁ±…Ñ”ˆè€œ´´µq¹¥è€‰Á¤µííÕÕ¥‘õô‰q¹ÑåÁ”èííÑåÁ•õõq¹ÁÉ½©•Ðè€‰ííÁÉ½©•Ñ}Í±Õõô‰q¹ÍÑ…ÑÕÌè‘É…™Ñq¹É•…Ñ•è€‰íí‘…Ñ•õô‰q¹ÕÁ‘…Ñ•è€‰íí‘…Ñ•õô‰q¹Ñ…Ìèmuq¸´´µq¹q¸ŒííÑ¥Ñ±•õõq¹q¸ð„´´Á¤µ…•¹Ðéµ…¹…•éÍÑ…ÉÐ€´´ùq¹ííÁÉ½©•Ñ}½¹Ñ•¹Ñõõq¸ð„´´Á¤µ…•¹Ðéµ…¹…•é•¹€´´ùq¹q¸ŒŒ!Õµ…¸É•Ù¥•Ýq¸œ)ôì((¼¼Á…­…•Ì½•áÑ•¹Í¥½¹Ì½ÍÉŒ½¥¹Ñ•É¹…°½½‰Í¥‘¥…¸µÝ½É­‰•¹ ¹ÑÌ)Ù…È59}MQIP€ô€ˆð„´´Á¤µ…•¹Ðéµ…¹…•éÍÑ…ÉÐ€´´øˆì)Ù…È59}9€ô€ˆð„´´Á¤µ…•¹Ðéµ…¹…•é•¹€´´øˆì)Ù…ÈAI=)Q}Q5A1Q€ô€´´´)ÑåÁ”èÁÉ½©•Ð)ÁÉ½©•Ðè€‰ííÁÉ½©•Ñ}Í±Õõôˆ)Ñ¥Ñ±”èííÁÉ½©•Ñ}Ñ¥Ñ±•}å…µ±õô)É•…Ñ•‘}…Ðè€‰ííÉ•…Ñ•‘}…Ñõôˆ(´´´((ŒííÁÉ½©•Ñ}Ñ¥Ñ±•õô()mm!½µ•utðmmAÉ½©•ÑÌ½%¹‘•áutðmm1¥‰É…Éä½%¹‘•áut((ŒŒI•Í•…É ÅÕ•ÍÑ¥½¸((ŒŒ½…±Ì((ŒŒ9•áÐÍÑ•ÁÌ((‘í59}MQIQô)ííÁÉ½©•Ñ}½¹Ñ•¹Ñõô(‘í59}9ô((ŒŒ!Õµ…¸É•Ù¥•Ü()€ì)Ù…ÈÉÕ¹Ñ¥µ•MÑ…Ñ”È€ôÉÕ¹Ñ¥µ•M±½Ð ‰­¹½Ý±•‘”ˆ°€‰½‰Í¥‘¥…¹]½É­‰•¹ ˆ°€ ¤€ôø€¡ì(€Ù…Õ±ÑUÁ‘…Ñ•Ìè€¼¨}}AUI}|€¨¼¹•Ü5…À ¤°(€‘¥ÍÁ½Í” ¤ì(€€€Ñ¡¥Ì¹Ù…Õ±ÑUÁ‘…Ñ•Ì¹±•…È ¤ì(€ô)ô¤¤ì)½¹™¥ÕÉ•-¹½Ý±•‘•áÑ•¹Í¥½¹IÕ¹Ñ¥µ” ¤ì)½¹™¥ÕÉ•-¹½Ý±•‘•!½ÍÐ¡ì(€±½…‘]½É­ÍÁ…•½¹™¥œ°(€½¹ÍÕµ•-¹½Ý±•‘•I•Ù¥•ÝAÉ•Ù¥•Ü°(€ÁÕ‰±¥Í¡áÁ±…¥¹•È°(€ÍÁ•¥…±¥ÍÑM•ÑÑ¥¹Ìè…Íå¹Œ€ ¤€ôø€¡…Ý…¥ÐAÉ½µ¥Í”¹É•Í½±Ù” ¤¹Ñ¡•¸  ¤€ôø€¡¥¹¥Ñ}ÍÁ•¥…±¥ÍÑ}¡½ÍÐ ¤°ÍÁ•¥…±¥ÍÑ}¡½ÍÑ}•áÁ½ÉÑÌ¤¤¤¹ÍÁ•¥…±¥ÍÑM•ÑÑ¥¹Ì ¤)ô¤ì)½¹™¥ÕÉ•-¹½Ý±•‘•M•ÑÕÀ¡ì(€±…å½ÕÐè1e=UPÈ°(€¥¹ÍÁ•Ñ=‰Í¥‘¥…¹M•ÑÕÀ°(€¥¹ÍÁ•ÑM•ÑÕÁ¥É•Ñ½Éä°(€É•Í½±Ù•M•ÑÕÁY…Õ±Ð°(€É•Í•…É¡M•ÑÕÁ=ÁÑ¥½¹ÌèÉ•Í•…É¡M•ÑÕÁ=ÁÑ¥½¹ÌÈ)ô¤ì)™Õ¹Ñ¥½¸Ù…±¥‘…Ñ•AÉ½©•Ð¡ÁÉ½©•Ð¤ì(€¥˜€¡ÑåÁ•½˜ÁÉ½©•Ð€„ôô€‰ÍÑÉ¥¹œˆñð€„½ym„µèÀ´åt¬ üèµm„µèÀ´åt¬¤¨¼¹Ñ•ÍÐ¡ÁÉ½©•Ð¤ñð€½x¡½¹ñÁÉ¹ñ…Õáñ¹Õ±ñ½µlÄ´åuñ±ÁÑlÄ´åt¤¼¹Ñ•ÍÐ¡ÁÉ½©•Ð¤¤ì(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰ÁÉ½©•ÐµÕÍÐ‰”„¹½¸µÉ•Í•ÉÙ•±½Ý•É…Í”­•‰…ˆµ…Í”Í±Õœˆ¤ì(€ô(€É•ÑÕÉ¸ÁÉ½©•Ðì)ô)…Íå¹Œ™Õ¹Ñ¥½¸½¹™¥ÕÉ•‘Y…Õ±Ð¡Ý¤ì(€½¹ÍÐì½‰Í¥‘¥…¹Y…Õ±Ðô€ô…Ý…¥Ð±½…‘]½É­ÍÁ…•½¹™¥œ¡Ý¤ì(€¥˜€ …½‰Í¥‘¥…¹Y…Õ±Ð¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰=‰Í¥‘¥…¸Ù…Õ±ÐµÕÍÐ‰”½¹™¥ÕÉ•™¥ÉÍÐˆ¤ì(€¥˜€ …­¹½Ý±•‘•¥É•Ñ½Éä ¤¤(€€€…Ý…¥Ðµ­‘¥ÈÜ¡½‰Í¥‘¥…¹Y…Õ±Ð°ìÉ•ÕÉÍ¥Ù”èÑÉÕ”ô¤ì(€É•ÑÕÉ¸…¹½¹¥…°¡½‰Í¥‘¥…¹Y…Õ±Ð¤ì)ô)…Íå¹Œ™Õ¹Ñ¥½¸Ù…Õ±ÑA…Ñ ¡Ù…Õ±Ð°€¸¸¹Á…ÉÑÌ¤ì(€½¹ÍÐ™¥±”€ô©½¥¸ÄÐ¡Ù…Õ±Ð°€¸¸¹Á…ÉÑÌ¤ì(€¥˜€ …½¹Ñ…¥¹Ì¡Ù…Õ±Ð°…Ý…¥Ð…¹½¹¥…°¡™¥±”¤¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰AÉ½©•ÐÁ…Ñ µÕÍÐÍÑ…ä¥¹Í¥‘”Ñ¡”½¹™¥ÕÉ•Ù…Õ±Ðˆ¤ì(€É•ÑÕÉ¸™¥±”ì)ô)…Íå¹Œ™Õ¹Ñ¥½¸ÕÁ‘…Ñ•Y…Õ±Ð¡Ý°½Á•É…Ñ¥½¸¤ì(€½¹ÍÐÙ…Õ±Ð€ô…Ý…¥Ð½¹™¥ÕÉ•‘Y…Õ±Ð¡Ý¤ì(€½¹ÍÐÁÉ•Ù¥½ÕÌ€ôÉÕ¹Ñ¥µ•MÑ…Ñ”È¹Ù…Õ±ÑUÁ‘…Ñ•Ì¹•Ð¡Ù…Õ±Ð¤ñðAÉ½µ¥Í”¹É•Í½±Ù” ¤ì(€½¹ÍÐ¹•áÐ€ôÁÉ•Ù¥½ÕÌ¹…Ñ   ¤€ôøì(€ô¤¹Ñ¡•¸  ¤€ôø½Á•É…Ñ¥½¸¡Ù…Õ±Ð¤¤ì(€ÉÕ¹Ñ¥µ•MÑ…Ñ”È¹Ù…Õ±ÑUÁ‘…Ñ•Ì¹Í•Ð¡Ù…Õ±Ð°¹•áÐ¤ì(€ÑÉäì(€€€É•ÑÕÉ¸…Ý…¥Ð¹•áÐì(€ô™¥¹…±±äì(€€€¥˜€¡ÉÕ¹Ñ¥µ•MÑ…Ñ”È¹Ù…Õ±ÑUÁ‘…Ñ•Ì¹•Ð¡Ù…Õ±Ð¤€ôôô¹•áÐ¤(€€€€€ÉÕ¹Ñ¥µ•MÑ…Ñ”È¹Ù…Õ±ÑUÁ‘…Ñ•Ì¹‘•±•Ñ”¡Ù…Õ±Ð¤ì(€ô)ô)…Íå¹Œ™Õ¹Ñ¥½¸É•…‘Q•áÐ¡™¥±”¤ì(€ÑÉäì(€€€É•ÑÕÉ¸…Ý…¥ÐÉ•…‘¥±”ÄÀ¡™¥±”°€‰ÕÑ˜àˆ¤ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€¥˜€¡•ÉÉ½È¹½‘”€ôôô€‰9=9Pˆ¤(€€€€€É•ÑÕÉ¸¹Õ±°ì(€€€Ñ¡É½Ü•ÉÉ½Èì(€ô)ô)…Íå¹Œ™Õ¹Ñ¥½¸ÝÉ¥Ñ•5…¹…•‘%¹‘•à¡™¥±”°¡•…‘¥¹œ°‰½‘ä¤ì(€½¹ÍÐ½É¥¥¹…°€ô…Ý…¥ÐÉ•…‘Q•áÐ¡™¥±”¤€üü€‘í¡•…‘¥¹ô((ŒŒ!Õµ…¸É•Ù¥•Ü()€ì(€½¹ÍÐÍÑ…ÉÐ€ô½É¥¥¹…°¹¥¹‘•á=˜¡59}MQIP¤ì(€½¹ÍÐ•¹€ô½É¥¥¹…°¹¥¹‘•á=˜¡59}9¤ì(€½¹ÍÐ‰±½¬€ô€‘í59}MQIQô(‘í‰½‘ä¹ÑÉ¥´ ¥ô(‘í59}9õ€ì(€±•ÐÕÁ‘…Ñ•ì(€¥˜€¡ÍÑ…ÉÐ€„ôô€´Äñð•¹€„ôô€´Ä¤ì(€€€¥˜€¡ÍÑ…ÉÐ€ôôô€´Äñð•¹€ðÍÑ…ÉÐñð½É¥¥¹…°¹¥¹‘•á=˜¡59}MQIP°ÍÑ…ÉÐ€¬€Ä¤€„ôô€´Äñð½É¥¥¹…°¹¥¹‘•á=˜¡59}9°•¹€¬€Ä¤€„ôô€´Ä¤ì(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È¡%¹Ù…±¥µ…¹…•¥¹‘•àµ…É­•ÉÌè€‘í™¥±•õ€¤ì(€€€ô(€€€ÕÁ‘…Ñ•€ô½É¥¥¹…°¹Í±¥” À°ÍÑ…ÉÐ¤€¬‰±½¬€¬½É¥¥¹…°¹Í±¥”¡•¹€¬59}9¹±•¹Ñ ¤ì(€ô•±Í”ì(€€€½¹ÍÐÉ•Ù¥•Ü€ô½É¥¥¹…°¹Í•…É  ½xŒŒ!Õµ…¸É•Ù¥•ÝqÌ¨½´¤ì(€€€ÕÁ‘…Ñ•€ôÉ•Ù¥•Ü€ð€À€ü€‘í½É¥¥¹…±ô‘í½É¥¥¹…°¹•¹‘Í]¥Ñ  ‰q¸ˆ¤€ü€‰q¸ˆ€è€‰q¹q¸‰ô‘í‰±½­ô)€€è€‘í½É¥¥¹…°¹Í±¥” À°É•Ù¥•Ü¥ô‘í‰±½­ô((‘í½É¥¥¹…°¹Í±¥”¡É•Ù¥•Ü¥õ€ì(€ô(€¥˜€¡ÕÁ‘…Ñ•€ôôô½É¥¥¹…°¤(€€€É•ÑÕÉ¸ì(€…Ý…¥Ðµ­‘¥ÈÜ¡‘¥É¹…µ”Ü¡™¥±”¤°ìÉ•ÕÉÍ¥Ù”èÑÉÕ”ô¤ì(€½¹ÍÐÑ•µÁ½É…Éä€ô€‘í™¥±•ô¸‘íÉ…¹‘½µUU%ä ¥ô¹ÑµÁ€ì(€…Ý…¥ÐÝÉ¥Ñ•¥±”à¡Ñ•µÁ½É…Éä°ÕÁ‘…Ñ•°€‰ÕÑ˜àˆ¤ì(€…Ý…¥ÐÉ•¹…µ”à¡Ñ•µÁ½É…Éä°™¥±”¤ì(€¥˜€¡­¹½Ý±•‘•¥É•Ñ½Éä ¤¤(€€€…Ý…¥Ð¹½Ñ¥™å-¹½Ý±•‘•¡…¹”¡™¥±”¤ì)ô)…Íå¹Œ™Õ¹Ñ¥½¸¡¥±‘¹ÑÉ¥•Ì¡‘¥É•Ñ½Éä¤ì(€ÑÉäì(€€€É•ÑÕÉ¸…Ý…¥ÐÉ•…‘‘¥ÈÌ¡‘¥É•Ñ½Éä°ìÝ¥Ñ¡¥±•QåÁ•ÌèÑÉÕ”ô¤ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€¥˜€¡•ÉÉ½È¹½‘”€ôôô€‰9=9Pˆ¤(€€€€€É•ÑÕÉ¸mtì(€€€Ñ¡É½Ü•ÉÉ½Èì(€ô)ô)…Íå¹Œ™Õ¹Ñ¥½¸¹½Ñ•1¥¹­Ì¡Ù…Õ±Ð°‘¥É•Ñ½Éä¤ì(€½¹ÍÐ±¥¹­Ì€ômtì(€™½È€¡½¹ÍÐ•¹ÑÉä½˜…Ý…¥Ð¡¥±‘¹ÑÉ¥•Ì¡‘¥É•Ñ½Éä¤¤ì(€€€½¹ÍÐ™¥±”€ô©½¥¸ÄÐ¡‘¥É•Ñ½Éä°•¹ÑÉä¹¹…µ”¤ì(€€€¥˜€¡•¹ÑÉä¹¥Í¥É•Ñ½Éä ¤¤(€€€€€±¥¹­Ì¹ÁÕÍ  ¸¸¹…Ý…¥Ð¹½Ñ•1¥¹­Ì¡Ù…Õ±Ð°™¥±”¤¤ì(€€€•±Í”¥˜€¡•¹ÑÉä¹¥Í¥±” ¤€˜˜•¹ÑÉä¹¹…µ”¹•¹‘Í]¥Ñ  ˆ¹µˆ¤¤ì(€€€€€½¹ÍÐÑ…É•Ð€ôÉ•±…Ñ¥Ù”ÄÀ¡Ù…Õ±Ð°™¥±”¤¹É•Á±…•±°¡Í•Àä°€ˆ¼ˆ¤¹Í±¥” À°€´Ì¤ì(€€€€€¥˜€ „½mmquðqÉq¹t¼¹Ñ•ÍÐ¡Ñ…É•Ð¤¤(€€€€€€€±¥¹­Ì¹ÁÕÍ ¡€´ml‘íÑ…É•Ñõuu€¤ì(€€€ô(€ô(€É•ÑÕÉ¸±¥¹­Ì¹Í½ÉÐ ¡„°ˆ¤€ôø„¹±½…±•½µÁ…É”¡ˆ¤¤ì)ô)…Íå¹Œ™Õ¹Ñ¥½¸…Ñ•½É¥é•‘1¥¹­Ì¡Ù…Õ±Ð°É½½Ð°ÑåÁ•Ì¤ì(€½¹ÍÐÍ•Ñ¥½¹Ì€ômtì(€™½È€¡½¹ÍÐÑåÁ”½˜ÑåÁ•Ì¤ì(€€€½¹ÍÐ‘¥É•Ñ½Éä€ô…Ý…¥ÐÙ…Õ±ÑA…Ñ ¡Ù…Õ±Ð°É½½Ð°ÑåÁ”¤ì(€€€½¹ÍÐ±¥¹­Ì€ô…Ý…¥Ð¹½Ñ•1¥¹­Ì¡Ù…Õ±Ð°‘¥É•Ñ½Éä¤ì(€€€Í•Ñ¥½¹Ì¹ÁÕÍ ¡€ŒŒ€‘íÑåÁ•ô((‘í±¥¹­Ì¹©½¥¸ ‰q¸ˆ¥õ€¹ÑÉ¥µ¹ ¤¤ì(€ô(€É•ÑÕÉ¸Í•Ñ¥½¹Ì¹©½¥¸ ‰q¹q¸ˆ¤ì)ô)…Íå¹Œ™Õ¹Ñ¥½¸É•™É•Í¡%¹‘•á•Ì¡Ù…Õ±Ð°ÁÉ½©•Ð€ô¹Õ±°°É•™É•Í¡±°€ô™…±Í”°ÁÉ½™¥±•%€ô€‰¡å‰É¥ˆ¤ì(€¥˜€¡­¹½Ý±•‘•¥É•Ñ½Éä ¤¤ì(€€€½¹ÍÐ‰¥¹‘¥¹œ€ô…Ý…¥ÐÉ•…‘-¹½Ý±•‘•	¥¹‘¥¹œ ¤ì(€€€¥˜€¡‰¥¹‘¥¹œü¹Ù…Õ±Ð€ôôôÙ…Õ±Ð¤ì(€€€€€½¹ÍÐÍ•ÉÙ¥”€ô…Ý…¥Ð•Ñ-¹½Ý±•‘•M•ÉÙ¥”¡‰¥¹‘¥¹œ¤ì(€€€€€½¹ÍÐ¥¹‘•à€ô…Ý…¥ÐÍ•ÉÙ¥”¹É•ÅÕ•ÍÐ ‰•¹ÅÕ•Õ•9…Ù¥…Ñ¥½¸ˆ°ìÁÉ½©•Ðô¤ì(€€€€€É•ÑÕÉ¸ìµ…¥¹Ñ•¹…¹”è€‰ÅÕ•Õ•ˆ°Í½Á”è€‰…ÁÁ±¥…Ñ¥½¸ˆ°¥¹‘•àôì(€€€ô(€ô(€½¹ÍÐÁÉ½™¥±”€ô•ÑY…Õ±ÑAÉ½™¥±”È¡ÁÉ½™¥±•%¤ì(€½¹ÍÐÁÉ½©•ÑQåÁ•Ì€ôÁÉ½™¥±”¹ÁÉ½©•ÑQåÁ•Ìì(€½¹ÍÐ±¥‰É…ÉåQåÁ•Ì€ôÁÉ½™¥±”¹±¥‰É…ÉåQåÁ•Ìì(€½¹ÍÐÁÉ½©•ÑI½½Ð€ô…Ý…¥ÐÙ…Õ±ÑA…Ñ ¡Ù…Õ±Ð°€‰AÉ½©•ÑÌˆ¤ì(€½¹ÍÐÁÉ½©•ÑÌ€ô€¡…Ý…¥Ð¡¥±‘¹ÑÉ¥•Ì¡ÁÉ½©•ÑI½½Ð¤¤¹™¥±Ñ•È ¡•¹ÑÉä¤€ôø•¹ÑÉä¹¥Í¥É•Ñ½Éä ¤€˜˜€½ym„µèÀ´åt¬ üèµm„µèÀ´åt¬¤¨¼¹Ñ•ÍÐ¡•¹ÑÉä¹¹…µ”¤¤¹µ…À ¡•¹ÑÉä¤€ôø•¹ÑÉä¹¹…µ”¤¹Í½ÉÐ ¤ì(€½¹ÍÐÁÉ½©•Ñ%¹‘•á•Ì€ômtì(€™½È€¡½¹ÍÐÍ±Õœ½˜ÁÉ½©•ÑÌ¤ì(€€€½¹ÍÐ¥¹‘•à€ô…Ý…¥ÐÙ…Õ±ÑA…Ñ ¡Ù…Õ±Ð°€‰AÉ½©•ÑÌˆ°Í±Õœ°€‰%¹‘•à¹µˆ¤ì(€€€¥˜€¡É•™É•Í¡±°ñðÁÉ½©•Ð€ôôôÍ±Õœñð…Ý…¥ÐÉ•…‘Q•áÐ¡¥¹‘•à¤€ôôô¹Õ±°¤ì(€€€€€½¹ÍÐ‰½‘ä€ô…Ý…¥Ð…Ñ•½É¥é•‘1¥¹­Ì¡Ù…Õ±Ð°AÉ½©•ÑÌ¼‘íÍ±Õõ€°ÁÉ½©•ÑQåÁ•Ì¤ì(€€€€€…Ý…¥ÐÝÉ¥Ñ•5…¹…•‘%¹‘•à¡¥¹‘•à°€´´´)ÑåÁ”èÁÉ½©•Ð)ÁÉ½©•Ðè€‘í)M=8¹ÍÑÉ¥¹¥™ä¡Í±Õœ¥ô(´´´((Œ€‘íÍ±Õô()mm!½µ•utðmmAÉ½©•ÑÌ½%¹‘•áutðmm1¥‰É…Éä½%¹‘•áuu€°‰½‘ä¤ì(€€€ô(€€€ÁÉ½©•Ñ%¹‘•á•Ì¹ÁÕÍ ¡¥¹‘•à¤ì(€ô(€½¹ÍÐ±¥¹­Ì€ôÁÉ½©•ÑÌ¹µ…À ¡Í±Õœ¤€ôø€´mmAÉ½©•ÑÌ¼‘íÍ±Õô½%¹‘•áuu€¤¹©½¥¸ ‰q¸ˆ¤ì(€½¹ÍÐÁÉ½©•ÑÍ%¹‘•à€ô…Ý…¥ÐÙ…Õ±ÑA…Ñ ¡Ù…Õ±Ð°€‰AÉ½©•ÑÌˆ°€‰%¹‘•à¹µˆ¤ì(€½¹ÍÐ±•…å%¹‘•à€ô…Ý…¥ÐÙ…Õ±ÑA…Ñ ¡Ù…Õ±Ð°€‰%¹‘•á•Ìˆ°€‰AÉ½©•ÑÌ¹µˆ¤ì(€½¹ÍÐ±¥‰É…Éå%¹‘•à€ô…Ý…¥ÐÙ…Õ±ÑA…Ñ ¡Ù…Õ±Ð°€‰1¥‰É…Éäˆ°€‰%¹‘•à¹µˆ¤ì(€…Ý…¥ÐÝÉ¥Ñ•5…¹…•‘%¹‘•à¡ÁÉ½©•ÑÍ%¹‘•à°€ˆŒAÉ½©•ÑÍq¹q¹mm!½µ•utˆ°±¥¹­Ì¤ì(€…Ý…¥ÐÝÉ¥Ñ•5…¹…•‘%¹‘•à¡±•…å%¹‘•à°€ˆŒAÉ½©•ÑÌˆ°±¥¹­Ì¤ì(€…Ý…¥ÐÝÉ¥Ñ•5…¹…•‘%¹‘•à¡±¥‰É…Éå%¹‘•à°€ˆŒ1¥‰É…Éåq¹q¹mm!½µ•utˆ°…Ý…¥Ð…Ñ•½É¥é•‘1¥¹­Ì¡Ù…Õ±Ð°€‰1¥‰É…Éäˆ°±¥‰É…ÉåQåÁ•Ì¤¤ì(€½¹ÍÐ­¹½Ý±•‘•%¹‘•à€ô…Ý…¥ÐÙ…Õ±ÑA…Ñ ¡Ù…Õ±Ð°€‰%¹‘•á•Ìˆ°€‰-¹½Ý±•‘”¹µˆ¤ì(€…Ý…¥ÐÝÉ¥Ñ•5…¹…•‘%¹‘•à¡­¹½Ý±•‘•%¹‘•à°€ˆŒ-¹½Ý±•‘”ˆ°m±¥¹­Ì°€‰mm1¥‰É…Éä½%¹‘•áut‰t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ ‰q¹q¸ˆ¤¤ì(€É•ÑÕÉ¸ìÁÉ½©•ÑÍ%¹‘•à°±•…å%¹‘•à°±¥‰É…Éå%¹‘•à°­¹½Ý±•‘•%¹‘•à°ÁÉ½©•Ñ%¹‘•á•Ìôì)ô)…Íå¹Œ™Õ¹Ñ¥½¸ÁÕ‰±¥Í¡M½ÕÉ•9½Ñ”¡ìÝ€ôÁÉ½•ÍÌ¹Ý ¤°ÉÕ¹¥È°•¹ÑÉäô¤ì(€½¹ÍÐ½¹™¥œ€ô…Ý…¥Ð±½…‘]½É­ÍÁ…•½¹™¥œ¡Ý¤ì(€¥˜€ …½¹™¥œ¹½‰Í¥‘¥…¹Y…Õ±Ð¤(€€€É•ÑÕÉ¸ì½‰Í¥‘¥…¹}¹½Ñ”è¹Õ±°°­¹½Ý±•‘•}ÍÑ…ÑÕÌè€‰¹½Ðµ½¹™¥ÕÉ•ˆôì(€¥˜€¡½¹™¥œ¹­¹½Ý±•‘••Á½Í¥Ñ5½‘”€ôôô€‰ÉÕ¸µ½¹±äˆ¤(€€€É•ÑÕÉ¸ì½‰Í¥‘¥…¹}¹½Ñ”è¹Õ±°°­¹½Ý±•‘•}ÍÑ…ÑÕÌè€‰‘¥Í…‰±•µÉÕ¸µ½¹±äˆôì(€¥˜€¡•¹ÑÉä¹ÍÑ…ÑÕÌ€„ôô€‰‘½Ý¹±½…‘•ˆñð€„½ym„µ˜À´åuìØÑô¼¹Ñ•ÍÐ¡•¹ÑÉä¹Í¡„ÈÔØ¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰=¹±äÙ•É¥™¥•‘½Ý¹±½…‘Ì…¸‰”¥¹‘•á•ˆ¤ì(€¥˜€ …½¹Ñ…¥¹Ì¡…Ý…¥Ð…¹½¹¥…°¡½¹™¥œ¹É•ÍÕ±ÑÍI½½Ð¤°…Ý…¥Ð…¹½¹¥…°¡ÉÕ¹¥È¤¤ñð€…½¹Ñ…¥¹Ì¡…Ý…¥Ð…¹½¹¥…°¡ÉÕ¹¥È¤°…Ý…¥Ð…¹½¹¥…°¡•¹ÑÉä¹Á…Ñ ¤¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M½ÕÉ”µÕÍÐÉ•µ…¥¸¥¹Í¥‘”¥ÑÌÉ•Í•…É ÉÕ¸ˆ¤ì(€¥˜€¡É•…Ñ•!…Í ÄÀ ‰Í¡„ÈÔØˆ¤¹ÕÁ‘…Ñ”¡…Ý…¥ÐÉ•…‘¥±”ÄÀ¡•¹ÑÉä¹Á…Ñ ¤¤¹‘¥•ÍÐ ‰¡•àˆ¤€„ôô•¹ÑÉä¹Í¡„ÈÔØ¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M½ÕÉ”¡…Í ¡…¹•‰•™½É”¥¹‘•á¥¹œˆ¤ì(€½¹ÍÐµ•Ñ…‘…Ñ„€ô…Ý…¥ÐÉ•…‘)Í½¸È¡©½¥¸ÄÐ¡ÉÕ¹¥È°€‰µ•Ñ…‘…Ñ„¹©Í½¸ˆ¤¤ì(€½¹ÍÐÁÉ½©•Ð€ôÙ…±¥‘…Ñ•AÉ½©•Ð¡ÉÕ¹AÉ½©•Ð¡µ•Ñ…‘…Ñ„¹ÁÉ½©•Ð°…Ý…¥ÐÉ•Í½±Ù•]½É­ÍÁ…•AÉ½©•Ð¡ìÝô¤¤¤ì(€½¹ÍÐ…Ñ•½Éä€ôl‰Á…Á•ÉÌˆ°€‰ÍÕÁÁ±•µ•¹Ñ…Éä‰t¹¥¹±Õ‘•Ì¡•¹ÑÉä¹…Ñ•½Éä¤€ü€‰A…Á•ÉÌˆ€è€‰M½™ÑÝ…É”ˆì(€½¹ÍÐÑ¥Ñ±”€ôMÑÉ¥¹œ¡•¹ÑÉä¹µ•Ñ…‘…Ñ„ü¹Ñ¥Ñ±”ñð‰…Í•¹…µ”Ô¡•¹ÑÉä¹Á…Ñ ¤¤¹É•Á±…” ½lðùqÉq¹t½œ°€ˆ€ˆ¤¹ÑÉ¥´ ¤¹Í±¥” À°€ÈÀÀ¤ì(€½¹ÍÐÍ±Õœ€ô€¡Ñ¥Ñ±”¹Ñ½1½Ý•É…Í” ¤¹É•Á±…” ½my„µèÀ´åt¬½œ°€ˆ´ˆ¤¹É•Á±…” ½xµð´½œ°€ˆˆ¤¹Í±¥” À°€ØÐ¤ñð•¹ÑÉä¹…Ñ•½Éä¤€¬€ˆ´ˆ€¬•¹ÑÉä¹Í¡„ÈÔØ¹Í±¥” À°€ÄØ¤ì(€É•ÑÕÉ¸ÕÁ‘…Ñ•Y…Õ±Ð¡Ý°…Íå¹Œ€¡Ù…Õ±Ð¤€ôøì(€€€½¹ÍÐ¹½Ñ”€ô…Ý…¥ÐÙ…Õ±ÑA…Ñ ¡Ù…Õ±Ð°€‰1¥‰É…Éäˆ°…Ñ•½Éä°€‘íÍ±Õô¹µ‘€¤ì(€€€½¹ÍÐÁÉ½©•Ñ9½Ñ”€ô…Ý…¥ÐÙ…Õ±ÑA…Ñ ¡Ù…Õ±Ð°€‰AÉ½©•ÑÌˆ°ÁÉ½©•Ð°…Ñ•½Éä°€‘íÍ±Õô¹µ‘€¤ì(€€€½¹ÍÐÁÉ½Ù•¹…¹”€ô)M=8¹ÍÑÉ¥¹¥™ä¡ì(€€€€€¥‘•µÁ½Ñ•¹å}­•äè•¹ÑÉä¹¥‘•µÁ½Ñ•¹å}­•äñð¹Õ±°°(€€€€€ÕÉ°è•¹ÑÉä¹ÕÉ°°(€€€€€™¥¹…±}ÕÉ°è•¹ÑÉä¹™¥¹…±}ÕÉ°°(€€€€€‘½Ý¹±½…‘•‘}…Ðè•¹ÑÉä¹‘½Ý¹±½…‘•‘}…Ð°(€€€€€Í¡„ÈÔØè•¹ÑÉä¹Í¡„ÈÔØ°(€€€€€Í¥é•}‰åÑ•Ìè•¹ÑÉä¹Í¥é•}‰åÑ•Ì°(€€€€€µ•Ñ…‘…Ñ„è•¹ÑÉä¹µ•Ñ…‘…Ñ„(€€€ô°¹Õ±°°€È¤¹É•Á±…•±° ˆðˆ°€‰qqÔÀÀÍŒˆ¤ì(€€€½¹ÍÐ½¹±¥¹”€ô½¹±¥¹•M½ÕÉ•1¥¹¬¡•¹ÑÉä¹™¥¹…±}ÕÉ°ñð•¹ÑÉä¹ÕÉ°°€‰qÔÕäáqÔØÕä½qÔÔÌåqÔÔå	qÔØÜØÕqÔÙäÀˆ¤ì(€€€½¹ÍÐ‘½¤€ô•¹ÑÉä¹µ•Ñ…‘…Ñ„ü¹‘½¤€ü½¹±¥¹•M½ÕÉ•1¥¹¬¡¡ÑÑÁÌè¼½‘½¤¹½Éœ¼‘í•¹ÑÉä¹µ•Ñ…‘…Ñ„¹‘½¥õ€°€‰=$ˆ¤€è€ˆˆì(€€€½¹ÍÐ¡…ÁÑ•ÉÌ€ô€¡•¹ÑÉä¹µ…¹Õ…±½Ù•É…”ü¹…¹‘¥‘…Ñ•Ìñðmt¤¹µ…À ¡Œ¤€ôø€´€‘í½¹±¥¹•M½ÕÉ•1¥¹¬¡Œ¹ÕÉ°°Œ¹Ñ¥Ñ±”ñðŒ¹ÕÉ°¥õ€¤¹©½¥¸ ‰q¸ˆ¤ì(€€€½¹ÍÐ‰½‘ä€ômmAÉ½©•ÑÌ¼‘íÁÉ½©•Ñô½%¹‘•áutðmm1¥‰É…Éä½%¹‘•áut((‘í½¹±¥¹•ô‘í‘½¤€ü€ð€‘í‘½¥õ€€è€ˆ‰ô()m=É¥¥¹…°™¥±•t ‘íÁ…Ñ¡Q½¥±•UI0È¡•¹ÑÉä¹Á…Ñ ¤¹¡É•™ô¤((ŒŒAÉ½Ù•¹…¹”()qqq©Í½¸(‘íÁÉ½Ù•¹…¹•ô)qqq€((ŒŒÙ¥‘•¹”ÍÑ…ÑÕÌ()É¡¥Ù•Í½ÕÉ”½¹±äìÍ¥•¹Ñ¥™¥Œ±…¥µÌ¡…Ù”¹½Ð‰••¸¥¹‘•Á•¹‘•¹Ñ±äÙ•É¥™¥•¸Q¡¥Ì¹½Ñ”¥Ì„Í½ÕÉ”É•½É°¹½Ð„½µÁ±•Ñ•Á…Á•È•áÁ±…¹…Ñ¥½¸½È½µµ…¹É•™•É•¹”¸((‘í•¹ÑÉä¹µ…¹Õ…±½Ù•É…”€ü5…¹Õ…°½Ù•É…”è€‘í•¹ÑÉä¹µ…¹Õ…±½Ù•É…”¹ÍÑ…ÑÕÍô¸½µµ…¹‘Ì…¹Á…É…µ•Ñ•ÉÌÉ•ÅÕ¥É”É•…‘¥¹œÑ¡”…ÁÁÉ½ÁÉ¥…Ñ”É•™•É•¹”¡…ÁÑ•ÉÌì„±…¹‘¥¹œÁ…”¥Ì¹½Ð„½µÁ±•Ñ”µ…¹Õ…°¹€€è€ˆ‰ô‘í¡…ÁÑ•ÉÌ€ü€((ŒŒI•™•É•¹”¡…ÁÑ•ÉÌ€¡¹½Ðå•Ð…É¡¥Ù•¤((‘í¡…ÁÑ•ÉÍõ€€è€ˆ‰õ€ì(€€€…Ý…¥ÐÝÉ¥Ñ•5…¹…•‘%¹‘•à¡¹½Ñ”°€´´´)¥èÁ¤´‘íÉ…¹‘½µUU%ä ¥ô)ÑåÁ”è€‘í…Ñ•½Éä€ôôô€‰A…Á•ÉÌˆ€ü€‰Á…Á•Èˆ€è€‰Í½™ÑÝ…É”‰ô)Í½ÕÉ•}Í¡„ÈÔØè€‘í•¹ÑÉä¹Í¡„ÈÔÙô)Í½ÕÉ•}¥‘•µÁ½Ñ•¹å}­•äè€‘í•¹ÑÉä¹¥‘•µÁ½Ñ•¹å}­•äñð€‰Õ¹­¹½Ý¸‰ô(´´´((Œ€‘íÑ¥Ñ±•õ€°‰½‘ä¤ì(€€€…Ý…¥ÐÝÉ¥Ñ•5…¹…•‘%¹‘•à¡ÁÉ½©•Ñ9½Ñ”°€Œ€‘íÑ¥Ñ±•õ€°mm1¥‰É…Éä¼‘í…Ñ•½Éåô¼‘íÍ±Õõut()mIÕ¸™¥±•Ít ‘íÁ…Ñ¡Q½¥±•UI0È¡ÉÕ¹¥È¤¹¡É•™ô¥€¤ì(€€€É•ÑÕÉ¸ì(€€€€€½‰Í¥‘¥…¹}¹½Ñ”è¹½Ñ”°(€€€€€ÁÉ½©•Ñ}¹½Ñ”èÁÉ½©•Ñ9½Ñ”°(€€€€€­¹½Ý±•‘•}ÍÑ…ÑÕÌè€‰ÝÉ¥ÑÑ•¸ˆ°(€€€€€¥¹‘•á•Ìè…Ý…¥ÐÉ•™É•Í¡%¹‘•á•Ì¡Ù…Õ±Ð°ÁÉ½©•Ð¤(€€€ôì(€ô¤ì)ô)…Íå¹Œ™Õ¹Ñ¥½¸ÁÕ‰±¥Í¡áÁ±…¥¹•È¡ìÝ€ôÁÉ½•ÍÌ¹Ý ¤°ÁÉ½©•Ð°Ñ½Á¥%°Ñ¥Ñ±”°…ÉÑ¥™…ÑA…Ñ °ÍÕµµ…Éä€ô€ˆˆ°Í½ÕÉ•Ì€ômtô€ôíô¤ì(€½¹ÍÐ½¹™¥œ€ô…Ý…¥Ð±½…‘]½É­ÍÁ…•½¹™¥œ¡Ý¤ì(€¥˜€ …½¹™¥œ¹½‰Í¥‘¥…¹Y…Õ±Ð¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰=‰Í¥‘¥…¸Ù…Õ±ÐµÕÍÐ‰”½¹™¥ÕÉ•™¥ÉÍÐˆ¤ì(€¥˜€¡½¹™¥œ¹­¹½Ý±•‘••Á½Í¥Ñ5½‘”€ôôô€‰ÉÕ¸µ½¹±äˆ¤(€€€É•ÑÕÉ¸ì­¹½Ý±•‘•}ÍÑ…ÑÕÌè€‰‘¥Í…‰±•µÉÕ¸µ½¹±äˆ°Í¥•¹Ñ¥™¥…±±åY•É¥™¥•è™…±Í”ôì(€ÁÉ½©•Ð€ôÙ…±¥‘…Ñ•AÉ½©•Ð¡ÁÉ½©•Ðñð€¡…Ý…¥ÐÉ•Í½±Ù•]½É­ÍÁ…•AÉ½©•Ð¡ìÝô¤¤¹ÁÉ½©•Ð¤ì(€Ñ½Á¥%€ôMÑÉ¥¹œ¡Ñ½Á¥%ñð€ˆˆ¤¹¹½Éµ…±¥é” ‰9-ˆ¤¹Ñ½1½Ý•É…Í” ¤¹É•Á±…” ½my„µèÀ´åt¬½œ°€ˆ´ˆ¤¹É•Á±…” ½xµð´½œ°€ˆˆ¤¹Í±¥” À°€äØ¤ì(€¥˜€ …Ñ½Á¥%¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰áÁ±…¥¹•ÈÑ½Á¥}¥µÕÍÐÉ•Í½±Ù”Ñ¼„¹½¸µ•µÁÑä­•‰…ˆµ…Í”¥ˆ¤ì(€Ñ¥Ñ±”€ôl¸¸¹MÑÉ¥¹œ¡Ñ¥Ñ±”ñð€ˆˆ¥t¹µ…À ¡¡…È¤€ôø¡…È¹¡…É½‘•Ð À¤€ð€ÌÈñð€ˆðøˆ¹¥¹±Õ‘•Ì¡¡…È¤€ü€ˆ€ˆ€è¡…È¤¹©½¥¸ ˆˆ¤¹ÑÉ¥´ ¤¹Í±¥” À°€ÈÀÀ¤ì(€¥˜€ …Ñ¥Ñ±”¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰áÁ±…¥¹•ÈÑ¥Ñ±”¥ÌÉ•ÅÕ¥É•ˆ¤ì(€¥˜€¡ÑåÁ•½˜…ÉÑ¥™…ÑA…Ñ €„ôô€‰ÍÑÉ¥¹œˆñð€……ÉÑ¥™…ÑA…Ñ ¹ÑÉ¥´ ¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰áÁ±…¥¹•ÈÉ•ÍÕ±Ñ}™¥±”¥ÌÉ•ÅÕ¥É•ˆ¤ì(€½¹ÍÐÉ½½Ð€ô…Ý…¥Ð…¹½¹¥…°¡½¹™¥œ¹É•ÍÕ±ÑÍI½½Ð¤°…ÉÑ¥™…Ð€ô…Ý…¥ÐÉ•…±Á…Ñ à¡É•Í½±Ù”ÄÌ¡Ý°…ÉÑ¥™…ÑA…Ñ ¤¤ì(€¥˜€ …½¹Ñ…¥¹Ì¡É½½Ð°…ÉÑ¥™…Ð¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰áÁ±…¥¹•È™¥±”µÕÍÐÍÑ…ä¥¹Í¥‘”Ñ¡”½¹™¥ÕÉ•É•ÍÕ±ÑÌÉ½½Ðˆ¤ì(€½¹ÍÐ¥¹™¼€ô…Ý…¥ÐÍÑ…ÐÐ¡…ÉÑ¥™…Ð¤ì(€¥˜€ …¥¹™¼¹¥Í¥±” ¤ñð¥¹™¼¹Í¥é”€ð€Äñð¥¹™¼¹Í¥é”€ø€Ð€¨€ÄÀÈÐ€¨€ÄÀÈÐ¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰áÁ±…¥¹•ÈµÕÍÐ‰”„É•Õ±…È™¥±”‰•ÑÝ••¸€Ä‰åÑ”…¹€Ð5¥ˆ¤ì(€½¹ÍÐ•áÐ€ô€½p¹µ½¤¹Ñ•ÍÐ¡…ÉÑ¥™…Ð¤€ü€ˆ¹µˆ€è€½p¹¡Ñµ°ü½¤¹Ñ•ÍÐ¡…ÉÑ¥™…Ð¤€ü€ˆ¹¡Ñµ°ˆ€è¹Õ±°ì(€¥˜€ …•áÐ¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰áÁ±…¥¹•ÈµÕÍÐ‰”!Q50½È5…É­‘½Ý¸ˆ¤ì(€½¹ÍÐ‰åÑ•Ì€ô…Ý…¥ÐÉ•…‘¥±”ÄÀ¡…ÉÑ¥™…Ð¤°‘¥•ÍÐ€ôÉ•…Ñ•!…Í ÄÀ ‰Í¡„ÈÔØˆ¤¹ÕÁ‘…Ñ”¡‰åÑ•Ì¤¹‘¥•ÍÐ ‰¡•àˆ¤ì(€½¹ÍÐÍÑ…µÀ€ô€ ¼¨}}AUI}|€¨¼¹•Ü…Ñ” ¤¤¹Ñ½%M=MÑÉ¥¹œ ¤¹É•Á±…” ½l´è¹Qit½œ°€ˆˆ¤¹Í±¥” À°€ÄÐ¤ì(€É•ÑÕÉ¸ÕÁ‘…Ñ•Y…Õ±Ð¡Ý°…Íå¹Œ€¡Ù…Õ±Ð¤€ôøì(€€€½¹ÍÐ…ÑÑ…¡µ•¹ÑI•°€ôÑÑ…¡µ•¹ÑÌ½áÁ±…¥¹•ÉÌ¼‘íÑ½Á¥%‘ô¼‘íÍÑ…µÁô´‘í‘¥•ÍÐ¹Í±¥” À°€ÄÈ¥ô‘í•áÑõ€ì(€€€½¹ÍÐ…ÑÑ…¡µ•¹Ð€ô…Ý…¥ÐÙ…Õ±ÑA…Ñ ¡Ù…Õ±Ð°€¸¸¹…ÑÑ…¡µ•¹ÑI•°¹ÍÁ±¥Ð ˆ¼ˆ¤¤ì(€€€…Ý…¥Ðµ­‘¥ÈÜ¡‘¥É¹…µ”Ü¡…ÑÑ…¡µ•¹Ð¤°ìÉ•ÕÉÍ¥Ù”èÑÉÕ”ô¤ì(€€€ÑÉäì(€€€€€…Ý…¥ÐÝÉ¥Ñ•¥±”à¡…ÑÑ…¡µ•¹Ð°‰åÑ•Ì°ì™±…œè€‰Ýàˆô¤ì(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€¥˜€¡•ÉÉ½È¹½‘”€„ôô€‰a%MPˆ¤(€€€€€€€Ñ¡É½Ü•ÉÉ½Èì(€€€ô(€€€½¹ÍÐ¹½Ñ”€ô…Ý…¥ÐÙ…Õ±ÑA…Ñ ¡Ù…Õ±Ð°€‰1¥‰É…Éäˆ°€‰áÁ±…¥¹•ÉÌˆ°€‘íÑ½Á¥%‘ô¹µ‘€¤ì(€€€½¹ÍÐÁÉ•Ù¥½ÕÌ€ô…Ý…¥ÐÉ•…‘Q•áÐ¡¹½Ñ”¤ñð€ˆˆì(€€€½¹ÍÐ½±‘Y•ÉÍ¥½¹Ì€ô€¡ÁÉ•Ù¥½ÕÌ¹µ…Ñ  ½x´€¸¨ýqoš&O–ò¢ºË¢žqup¡myq¹t­p¥myq¹t¨½´¤ñðmt¤¹Í±¥” ´Ää¤ì(€€€½¹ÍÐÉ•±1¥¹¬€ô€¸¸¼¸¸¼‘í…ÑÑ…¡µ•¹ÑI•±õ€ì(€€€½¹ÍÐÍ½ÕÉ•1¥¹•Ì€ôÍ½ÕÉ•Ì¹Í±¥” À°€ÄÈ¤¹µ…À ¡Í½ÕÉ”¤€ôø€´ml‘íMÑÉ¥¹œ¡Í½ÕÉ”¹Á…Ñ ¤¹É•Á±…” ½p¹µ¼°€ˆˆ¥õutqáÜ±¥¹•Ì€‘íÍ½ÕÉ”¹ÍÑ…ÉÑ1¥¹•õqÔÈÀÄÌ‘íÍ½ÕÉ”¹•¹‘1¥¹•ôqáÜÍ¡„ÈÔØ€‘íÍ½ÕÉ”¹¡…Í¡õ€¤¹©½¥¸ ‰q¸ˆ¤ì(€€€½¹ÍÐÙ•ÉÍ¥½¹1¥¹”€ô€´€‘ì ¼¨}}AUI}|€¨¼¹•Ü…Ñ” ¤¤¹Ñ½%M=MÑÉ¥¹œ ¥ôqáÜmqÔØÈÔÍqÔÕÀÁqÔá	ÉqÔàåÍt ‘íÉ•±1¥¹­ô¤qáÜÍ¡„ÈÔØ€‘í‘¥•ÍÑõ€ì(€€€½¹ÍÐ‰½‘ä€ôl(€€€€€€ˆøl…Ý…É¹¥¹tqÔÕÔÕqÔÜäÍqÔÕÐÉqÕÁqÔÑÁqÔØØÉqÔÜåÅqÔÕØÙqÔá	ÅqÔØÌÙq¸øqÔÙØÑqÔäàÜÕqÔäÜØÉqÔÜÔÌÄM¡½Ü5”€¼qÔÙÈÅqÔÔÜá	qÔØàÌåqÔØÌÙqÔÕÉqÔá		qÔØÜØÕqÔÙäÁqÔÜÔÅqÔØÈÄÁqÕÁqÔÜÔÈáqÔÑáqÔàåÍqÔäÅqÔÑÁqÔÕ	qÔàÈÉqÔÌÀÀÉqÔÑÁqÔàÁqÔÑÕqÔÑÍ]¥­¤qÔØÍÁqÔØàÐáqÔØÈÄÙqÔÜåÅqÔÜàÄÑqÔÝÍqÔá		qÔÜØàÑqÔá	ÅqÔØÌÙqÔØÜØÕqÔÙäÁqÔÌÀÀÈˆ°(€€€€€€ŒŒqÔØÜÀÁqÔØÕÁqÔá	ÉqÔàåÌ()mqÔØÈÔÍqÔÕÀÀM¡½Ü5”qÔäàÜÕqÔäÜØÉt ‘íÉ•±1¥¹­ô¤((‘íMÑÉ¥¹œ¡ÍÕµµ…Éäñð€ˆˆ¤¹ÑÉ¥´ ¤¹Í±¥” À°€Ñ”Ì¥õ€°(€€€€€Í½ÕÉ•1¥¹•Ì€ü€ŒŒqÔØÜÉqÔáÙqÔÑåqÔØÌÙ((‘íÍ½ÕÉ•1¥¹•Íõ€€è€ˆˆ°(€€€€€€ŒŒY•ÉÍ¥½¹Ì((‘íl¸¸¹½±‘Y•ÉÍ¥½¹Ì°Ù•ÉÍ¥½¹1¥¹•t¹©½¥¸ ‰q¸ˆ¥õ€(€€€t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ ‰q¹q¸ˆ¤ì(€€€½¹ÍÐ¡•…‘¥¹œ€ô€´´´)¥èÁ¤´‘íÉ…¹‘½µUU%ä ¥ô)ÑåÁ”è•áÁ±…¥¹•È)Ñ½Á¥}¥è€‘í)M=8¹ÍÑÉ¥¹¥™ä¡Ñ½Á¥%¥ô)ÁÉ½©•Ðè€‘í)M=8¹ÍÑÉ¥¹¥™ä¡ÁÉ½©•Ð¥ô)ÍÑ…ÑÕÌè•¹•É…Ñ•)•Ù¥‘•¹•}É½±”èÁÉ•Í•¹Ñ…Ñ¥½¸µ½¹±ä)ÕÁ‘…Ñ•è€‘í)M=8¹ÍÑÉ¥¹¥™ä  ¼¨}}AUI}|€¨¼¹•Ü…Ñ” ¤¤¹Ñ½%M=MÑÉ¥¹œ ¤¥ô(´´´((Œ€‘íÑ¥Ñ±•õ€ì(€€€…Ý…¥ÐÝÉ¥Ñ•5…¹…•‘%¹‘•à¡¹½Ñ”°¡•…‘¥¹œ°‰½‘ä¤ì(€€€½¹ÍÐ¥¹‘•á•Ì€ô…Ý…¥ÐÉ•™É•Í¡%¹‘•á•Ì¡Ù…Õ±Ð°ÁÉ½©•Ð°™…±Í”°½¹™¥œ¹­¹½Ý±•‘•AÉ½™¥±”¤ì(€€€É•ÑÕÉ¸ì(€€€€€¹½Ñ”°(€€€€€…ÑÑ…¡µ•¹Ð°(€€€€€…ÑÑ…¡µ•¹Ñ}É•±…Ñ¥Ù”è…ÑÑ…¡µ•¹ÑI•°°(€€€€€Ñ½Á¥%°(€€€€€ÁÉ½©•Ð°(€€€€€Í¡„ÈÔØè‘¥•ÍÐ°(€€€€€‰åÑ•Ìè¥¹™¼¹Í¥é”°(€€€€€Í½ÕÉ•½Õ¹ÐèÍ½ÕÉ•Ì¹±•¹Ñ °(€€€€€­¹½Ý±•‘•}ÍÑ…ÑÕÌè€‰ÝÉ¥ÑÑ•¸ˆ°(€€€€€•Ù¥‘•¹•I½±”è€‰ÁÉ•Í•¹Ñ…Ñ¥½¸µ½¹±äˆ°(€€€€€Í¥•¹Ñ¥™¥…±±åY•É¥™¥•è™…±Í”°(€€€€€¥¹‘•á•Ì(€€€ôì(€ô¤ì)ô)…Íå¹Œ™Õ¹Ñ¥½¸É•…‘)Í½¸È¡™¥±”¤ì(€ÑÉäì(€€€½¹ÍÐ‘…Ñ„€ô)M=8¹Á…ÉÍ” ¡…Ý…¥ÐÉ•…‘¥±”ÄÀ¡™¥±”°€‰ÕÑ˜àˆ¤¤¹É•Á±…” ½yqÕ¼°€ˆˆ¤¤ì(€€€¥˜€ …‘…Ñ„ñðÑåÁ•½˜‘…Ñ„€„ôô€‰½‰©•ÐˆñðÉÉ…ä¹¥ÍÉÉ…ä¡‘…Ñ„¤¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È¡%¹Ù…±¥)M=8½‰©•Ðè€‘í™¥±•õ€¤ì(€€€É•ÑÕÉ¸‘…Ñ„ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€¥˜€¡•ÉÉ½È¹½‘”€ôôô€‰9=9Pˆ¤(€€€€€É•ÑÕÉ¸íôì(€€€Ñ¡É½Ü•ÉÉ½Èì(€ô)ô)…Íå¹Œ™Õ¹Ñ¥½¸…¹½¹¥…°¡™¥±”¤ì(€ÑÉäì(€€€É•ÑÕÉ¸…Ý…¥ÐÉ•…±Á…Ñ à¡™¥±”¤ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€¥˜€¡•ÉÉ½È¹½‘”€„ôô€‰9=9Pˆñð‘¥É¹…µ”Ü¡™¥±”¤€ôôô™¥±”¤(€€€€€Ñ¡É½Ü•ÉÉ½Èì(€€€É•ÑÕÉ¸©½¥¸ÄÐ¡…Ý…¥Ð…¹½¹¥…°¡‘¥É¹…µ”Ü¡™¥±”¤¤°‰…Í•¹…µ”Ô¡™¥±”¤¤ì(€ô)ô)™Õ¹Ñ¥½¸½¹Ñ…¥¹Ì¡É½½Ð°¡¥±¤ì(€½¹ÍÐÉ•°€ôÉ•±…Ñ¥Ù”ÄÀ¡É½½Ð°¡¥±¤ì(€É•ÑÕÉ¸€…É•°ñð€…¥Í‰Í½±ÕÑ”ÄÄ¡É•°¤€˜˜É•°€„ôô€ˆ¸¸ˆ€˜˜€…É•°¹ÍÑ…ÉÑÍ]¥Ñ ¡€¸¸‘íÍ•Àåõ€¤ì)ô)™Õ¹Ñ¥½¸É•Í•…É¡M•ÑÕÁ=ÁÑ¥½¹ÌÈ ¤ì(€É•ÑÕÉ¸ì(€€€ÁÉ½™¥±•Ìè±¥ÍÑY…Õ±ÑAÉ½™¥±•Ì ¤°(€€€‘•Á½Í¥Ñ5½‘•Ìèl(€€€€€ì¥è€‰ÉÕ¸µ½¹±äˆ°±…‰•°è€‰qÔÑÕqÔáÁqÔààÑqÔØÐÔáqÔàäàÄˆ°‘•ÍÉ¥ÁÑ¥½¸è€‰qÔÔÍqÔÙàåqÔÙÁqÔÕáqÔØÈÄÁqÔÜØàÐÉÕ¸ÍÕµµ…ÉåqÕÁqÔØÜÀÁqÔÑqÔÕàáqÔÌÀÀÈˆô°(€€€€€ì(€€€€€€€¥è€‰Ù•É¥™¥•ˆ°(€€€€€€€±…‰•°è€‰qÔÕÉqÔåáqÔá	ÅqÔá	ÅqÔØÌÙqÕÀáqÔØÍáqÔàÌÔÁqÕÀäˆ°(€€€€€€€‘•ÍÉ¥ÁÑ¥½¸è€‰qÔÙàåqÔÙÁqÔáÁqÔààÑqÔØÐÔáqÔàäàÅqÔÌÀÀÅqÔÕÉqÔÕÔÉqÔØàØÍqÔØÜØÕqÔÙäÁqÔÌÀÀÅqÔá	ÅqÔØÌÙqÔÌÀÀÅqÔØÔÉqÔØÌÀÅqÔØÀÈÜ±…¥´qÔÑÁqÔÜàÄÑqÔÝÜÙqÔÔÅÍqÔÝÔÙqÔÌÀÀÈˆ(€€€€€ô°(€€€€€ì(€€€€€€€¥è€‰É¥ ˆ°(€€€€€€€±…‰•°è€‰qÔÑÌÁqÔÕ	qÔÜÝÕqÔá	ÙqÔÙàåqÔÙÀˆ°(€€€€€€€‘•ÍÉ¥ÁÑ¥½¸è€‰qÔÔÜÈàÙ•É¥™¥•qÔÔÝqÔÜàÐÁqÔÑÁqÕÁqÔÑÕqÔÙàåqÔÙÁqÔÔÍqÔááqÔäàÜåqÔÜÙqÔÔäÁqÔÜÔÈáqÔÜØàÑqÔØäàÉqÔÕÔ½qÔÕåqÔÑÔÍqÔÌÀÀÈˆ(€€€€€ô(€€€t°(€€€ÍÕ‰…•¹Ñ5ÁA½±¥¥•Ìèl(€€€€€ì¥è€‰¹½¹”ˆ°±…‰•°è€‰qÔÜäàÅqÔÜÔÈàˆ°‘•ÍÉ¥ÁÑ¥½¸è€‰qÔÕÔÁqÔØØÝqÔàÁqÔÑÔÍqÔÑÁqÔá		qÔäÕ=‰Í¥‘¥…¸5AqÔÌÀÀÈˆô°(€€€€€ì(€€€€€€€¥è€‰É•…µ±½…°ˆ°(€€€€€€€±…‰•°è€‰qÔÔÍqÔá		qÔØÜÉqÔÔÜÌÁqÔÜÝÕqÔá	ÙqÔÕäÍqÕÀáqÔØÍáqÔàÌÔÁqÕÀäˆ°(€€€€€€€‘•ÍÉ¥ÁÑ¥½¸è€‰qÔÕÔÁqÔØØÝqÔàÁqÔÑÔÍqÔÔÍqÔØÐÅqÔÝÈÈ½qÔá		qÔÔÍØ=‰Í¥‘¥…¹qÕÁqÔÑÐÙqÔØÕÁqÔÙÕqÔÔÄäåqÔÔÄØÕqÔÌÀÀÅqÔÜå	qÔÔÉáqÔØÈÄÙqÔÔÈÈÁqÔäØØÑqÔÝÄÑqÔá	ÁqÔÌÀÀÈˆ(€€€€€ô(€€€t(€ôì)ô((¼¼Á…­…•Ì½•áÑ•¹Í¥½¹Ì½ÍÉŒ½¥¹ÍÑ¥ÑÕÑ¥½¹…°µ…•ÍÌ¹ÑÌ)¥µÁ½ÉÐìÉ•…Ñ•I•ÅÕ¥É”ô™É½´€‰¹½‘”éµ½‘Õ±”ˆì((¼¼Á…­…•Ì½É•Í•…É ½ÍÉŒ½¥¹ÍÑ¥ÑÕÑ¥½¹…°µ…•ÍÌ¹ÑÌ)¥µÁ½ÉÐìµ­‘¥È…Ìµ­‘¥Èà°É•…‘¥±”…ÌÉ•…‘¥±”ÄÄ°ÝÉ¥Ñ•¥±”…ÌÝÉ¥Ñ•¥±”äô™É½´€‰¹½‘”é™Ì½ÁÉ½µ¥Í•Ìˆì)¥µÁ½ÉÐì¡½µ•‘¥È…Ì¡½µ•‘¥ÈÌô™É½´€‰¹½‘”é½Ìˆì)¥µÁ½ÉÐì‘¥É¹…µ”…Ì‘¥É¹…µ”à°©½¥¸…Ì©½¥¸ÄÔô™É½´€‰¹½‘”éÁ…Ñ ˆì((¼¼Á…­…•Ì½É•Í•…É ½ÍÉŒ½¥¹ÍÑ¥ÑÕÑ¥½¹…°µÁÉ½áä¹ÑÌ)™Õ¹Ñ¥½¸‰Õ¥±‘AÉ½á¥•‘UÉ°¡½É¥¥¹…±UÉ°°Ñ•µÁ±…Ñ”¤ì(€¥˜€ …Ñ•µÁ±…Ñ”¤É•ÑÕÉ¸¹Õ±°ì(€½¹ÍÐÑÉ¥µµ•€ôÑ•µÁ±…Ñ”¹ÑÉ¥´ ¤ì(€¥˜€ …ÑÉ¥µµ•¤É•ÑÕÉ¸¹Õ±°ì(€ÑÉäì(€€€¥˜€¡ÑÉ¥µµ•¹¥¹±Õ‘•Ì ˆ•Ìˆ¤¤É•ÑÕÉ¸ÑÉ¥µµ•¹É•Á±…•±° ˆ•Ìˆ°•¹½‘•UI%½µÁ½¹•¹Ð¡½É¥¥¹…±UÉ°¤¤ì(€€€½¹ÍÐÕÉ±=‰¨€ô¹•ÜUI0¡½É¥¥¹…±UÉ°¤ì(€€€¥˜€¡ÑÉ¥µµ•¹¥¹±Õ‘•Ì¡ÕÉ±=‰¨¹¡½ÍÐ¤¤É•ÑÕÉ¸¹Õ±°ì(€€€¥˜€ ½lü˜õt¼¹Ñ•ÍÐ¡ÑÉ¥µµ•¤ñðÑÉ¥µµ•¹•¹‘Í]¥Ñ  ‰ÕÉ°ôˆ¤ñðÑÉ¥µµ•¹•¹‘Í]¥Ñ  ‰ÕÉ°ˆ¤¤ì(€€€€€½¹ÍÐÍ•Á…É…Ñ½È€ôÑÉ¥µµ•¹¥¹±Õ‘•Ì ˆüˆ¤€üÑÉ¥µµ•¹•¹‘Í]¥Ñ  ˆüˆ¤ñðÑÉ¥µµ•¹•¹‘Í]¥Ñ  ˆ˜ˆ¤ñðÑÉ¥µµ•¹•¹‘Í]¥Ñ  ˆôˆ¤€ü€ˆˆ€è€ˆ˜ˆ€è€ˆüˆì(€€€€€¥˜€¡ÑÉ¥µµ•¹•¹‘Í]¥Ñ  ˆôˆ¤¤É•ÑÕÉ¸€‘íÑÉ¥µµ•‘ô‘í•¹½‘•UI%½µÁ½¹•¹Ð¡½É¥¥¹…±UÉ°¥õ€ì(€€€€€É•ÑÕÉ¸€‘íÑÉ¥µµ•‘ô‘íÍ•Á…É…Ñ½ÉõÕÉ°ô‘í•¹½‘•UI%½µÁ½¹•¹Ð¡½É¥¥¹…±UÉ°¥õ€ì(€€€ô(€€€¥˜€¡ÑÉ¥µµ•¹¥¹±Õ‘•Ì ‰•éÁÉ½áäˆ¤ñðÑÉ¥µµ•¹¥¹±Õ‘•Ì ‰±½¥¸ˆ¤¤ì(€€€€€½¹ÍÐ¡…ÍEÕ•Éä€ôÑÉ¥µµ•¹¥¹±Õ‘•Ì ˆüˆ¤ì(€€€€€¥˜€¡¡…ÍEÕ•Éä¤ì(€€€€€€€¥˜€¡ÑÉ¥µµ•¹•¹‘Í]¥Ñ  ˆüˆ¤ñðÑÉ¥µµ•¹•¹‘Í]¥Ñ  ˆ˜ˆ¤¤(€€€€€€€€€É•ÑÕÉ¸€‘íÑÉ¥µµ•‘ô‘í•¹½‘•UI%½µÁ½¹•¹Ð¡½É¥¥¹…±UÉ°¥õ€ì(€€€€€€€¥˜€¡ÑÉ¥µµ•¹¥¹±Õ‘•Ì ‰ÕÉ°ôˆ¤¤ì(€€€€€€€€€¥˜€ ½ÕÉ°ô¼¹Ñ•ÍÐ¡ÑÉ¥µµ•¤¤É•ÑÕÉ¸€‘íÑÉ¥µµ•‘ô‘í•¹½‘•UI%½µÁ½¹•¹Ð¡½É¥¥¹…±UÉ°¥õ€ì(€€€€€€€€€É•ÑÕÉ¸€‘íÑÉ¥µµ•‘ô™ÕÉ°ô‘í•¹½‘•UI%½µÁ½¹•¹Ð¡½É¥¥¹…±UÉ°¥õ€ì(€€€€€€€ô(€€€€€€€É•ÑÕÉ¸€‘íÑÉ¥µµ•‘ô™ÕÉ°ô‘í•¹½‘•UI%½µÁ½¹•¹Ð¡½É¥¥¹…±UÉ°¥õ€ì(€€€€€ô(€€€€€É•ÑÕÉ¸€‘íÑÉ¥µµ•‘ôýÕÉ°ô‘í•¹½‘•UI%½µÁ½¹•¹Ð¡½É¥¥¹…±UÉ°¥õ€ì(€€€ô(€€€É•ÑÕÉ¸€‘íÑÉ¥µµ•‘ô‘í•¹½‘•UI%½µÁ½¹•¹Ð¡½É¥¥¹…±UÉ°¥õ€ì(€ô…Ñ ì(€€€É•ÑÕÉ¸¹Õ±°ì(€ô)ô((¼¼Á…­…•Ì½É•Í•…É ½ÍÉŒ½¥¹ÍÑ¥ÑÕÑ¥½¹…°µ…•ÍÌ¹ÑÌ)Ù…È%9MQ%QUQ%=91}=9%}95€ô€‰¥¹ÍÑ¥ÑÕÑ¥½¹…°¹©Í½¸ˆì)Ù…È%9MQ%QUQ%=91}9Q}%H€ô©½¥¸ÄÔ¡¡½µ•‘¥ÈÌ ¤°€ˆ¹Á¤ˆ°€‰…•¹Ðˆ¤ì)Ù…È%9MQ%QUQ%=91}=9%}AQ €ô©½¥¸ÄÔ¡%9MQ%QUQ%=91}9Q}%H°%9MQ%QUQ%=91}=9%}95¤ì)™Õ¹Ñ¥½¸•µÁÑå%¹ÍÑ¥ÑÕÑ¥½¹…±½¹™¥œ ¤ì(€É•ÑÕÉ¸ìÙ•ÉÍ¥½¸è€Ä°…ÕÑ½½Ý¹±½…‘¹…‰±•èÑÉÕ”°Á•ÉQ…Í­1¥µ¥Ðè€ÈÀôì)ô)™Õ¹Ñ¥½¸¹½Éµ…±¥é•UÉ°¡Ù…±Õ”¤ì(€¥˜€¡Ù…±Õ”€ôô¹Õ±°¤É•ÑÕÉ¸Ù½¥€Àì(€½¹ÍÐÑÉ¥µµ•€ôMÑÉ¥¹œ¡Ù…±Õ”¤¹ÑÉ¥´ ¤ì(€¥˜€ …ÑÉ¥µµ•ñðÑÉ¥µµ•¹±•¹Ñ €ø€ÈÀÐàñð€„½y¡ÑÑÁÌüép½p¼½¤¹Ñ•ÍÐ¡ÑÉ¥µµ•¤¤É•ÑÕÉ¸Ù½¥€Àì(€É•ÑÕÉ¸ÑÉ¥µµ•ì)ô)™Õ¹Ñ¥½¸¹½Éµ…±¥é•%¹ÍÑ¥ÑÕÑ¥½¹…±½¹™¥œ¡É…Ü¤ì(€½¹ÍÐ‰…Í”€ô•µÁÑå%¹ÍÑ¥ÑÕÑ¥½¹…±½¹™¥œ ¤ì(€¥˜€ …É…ÜñðÑåÁ•½˜É…Ü€„ôô€‰½‰©•ÐˆñðÉÉ…ä¹¥ÍÉÉ…ä¡É…Ü¤¤É•ÑÕÉ¸‰…Í”ì(€½¹ÍÐÙ…±Õ”€ôÉ…Üì(€½¹ÍÐ•éÁÉ½áåQ•µÁ±…Ñ”€ô¹½Éµ…±¥é•UÉ°¡Ù…±Õ”¹•éÁÉ½áåQ•µÁ±…Ñ”¤ì(€½¹ÍÐ½Á•¹UÉ±I•Í½±Ù•È€ô¹½Éµ…±¥é•UÉ°¡Ù…±Õ”¹½Á•¹UÉ±I•Í½±Ù•È¤ì(€½¹ÍÐ¥¹ÍÑ¥ÑÕÑ¥½¹9…µ”€ôÑåÁ•½˜Ù…±Õ”¹¥¹ÍÑ¥ÑÕÑ¥½¹9…µ”€ôôô€‰ÍÑÉ¥¹œˆ€üÙ…±Õ”¹¥¹ÍÑ¥ÑÕÑ¥½¹9…µ”¹ÑÉ¥´ ¤¹Í±¥” À°€ÄÈÀ¤ñðÙ½¥€À€èÙ½¥€Àì(€½¹ÍÐ…ÕÑ½½Ý¹±½…‘¹…‰±•€ôÑåÁ•½˜Ù…±Õ”¹…ÕÑ½½Ý¹±½…‘¹…‰±•€ôôô€‰‰½½±•…¸ˆ€üÙ…±Õ”¹…ÕÑ½½Ý¹±½…‘¹…‰±•€è‰…Í”¹…ÕÑ½½Ý¹±½…‘¹…‰±•ì(€½¹ÍÐÁ•ÉQ…Í­1¥µ¥Ð€ôÑåÁ•½˜Ù…±Õ”¹Á•ÉQ…Í­1¥µ¥Ð€ôôô€‰¹Õµ‰•Èˆ€˜˜9Õµ‰•È¹¥Í%¹Ñ••È¡Ù…±Õ”¹Á•ÉQ…Í­1¥µ¥Ð¤€ü5…Ñ ¹µ¥¸ ÄÀÀ°5…Ñ ¹µ…à Ä°Ù…±Õ”¹Á•ÉQ…Í­1¥µ¥Ð¤¤€è‰…Í”¹Á•ÉQ…Í­1¥µ¥Ðì(€½¹ÍÐ±…ÍÑ1½¥¹Ð€ôÑåÁ•½˜Ù…±Õ”¹±…ÍÑ1½¥¹Ð€ôôô€‰ÍÑÉ¥¹œˆ€üÙ…±Õ”¹±…ÍÑ1½¥¹Ð€èÙ½¥€Àì(€½¹ÍÐ±…ÍÑ1½¥¹UÉ°€ô¹½Éµ…±¥é•UÉ°¡Ù…±Õ”¹±…ÍÑ1½¥¹UÉ°¤ì(€É•ÑÕÉ¸ì(€€€Ù•ÉÍ¥½¸è€Ä°(€€€•éÁÉ½áåQ•µÁ±…Ñ”°(€€€¥¹ÍÑ¥ÑÕÑ¥½¹9…µ”°(€€€½Á•¹UÉ±I•Í½±Ù•È°(€€€…ÕÑ½½Ý¹±½…‘¹…‰±•°(€€€Á•ÉQ…Í­1¥µ¥Ð°(€€€±…ÍÑ1½¥¹Ð°(€€€±…ÍÑ1½¥¹UÉ°°(€€€½¹™¥ÕÉ•è	½½±•…¸¡•éÁÉ½áåQ•µÁ±…Ñ”ñð½Á•¹UÉ±I•Í½±Ù•Èñð¥¹ÍÑ¥ÑÕÑ¥½¹9…µ”ñð±…ÍÑ1½¥¹Ð¤(€ôì)ô)…Íå¹Œ™Õ¹Ñ¥½¸±½…‘%¹ÍÑ¥ÑÕÑ¥½¹…±½¹™¥œ¡Á…Ñ €ô%9MQ%QUQ%=91}=9%}AQ °¥¼€ôìÉ•…‘¥±”è€¡™¥±”¤€ôøÉ•…‘¥±”ÄÄ¡™¥±”°€‰ÕÑ˜àˆ¤ô¤ì(€ÑÉäì(€€€É•ÑÕÉ¸¹½Éµ…±¥é•%¹ÍÑ¥ÑÕÑ¥½¹…±½¹™¥œ¡)M=8¹Á…ÉÍ”¡…Ý…¥Ð¥¼¹É•…‘¥±”¡Á…Ñ ¤¤¤ì(€ô…Ñ ì(€€€É•ÑÕÉ¸•µÁÑå%¹ÍÑ¥ÑÕÑ¥½¹…±½¹™¥œ ¤ì(€ô)ô((¼¼Á…­…•Ì½•áÑ•¹Í¥½¹Ì½ÍÉŒ½¥¹ÍÑ¥ÑÕÑ¥½¹…°µ…•ÍÌ¹ÑÌ)Ù…ÈÉ•ÅÕ¥É”È€ôÉ•…Ñ•I•ÅÕ¥É”¡¥µÁ½ÉÐ¹µ•Ñ„¹ÕÉ°¤ì)Ù…ÈAIQ%Q%=8€ô€‰Á•ÉÍ¥ÍÐé‘É½¹”µ¥¹ÍÑ¥ÑÕÑ¥½¹…°ˆì)™Õ¹Ñ¥½¸•±•ÑÉ½¸ ¤ì(€ÑÉäì(€€€É•ÑÕÉ¸É•ÅÕ¥É”È ‰•±•ÑÉ½¸ˆ¤ì(€ô…Ñ ì(€€€É•ÑÕÉ¸¹Õ±°ì(€ô)ô)™Õ¹Ñ¥½¸Í•ÍÍ¥½¸ ¤ì(€½¹ÍÐ±½…‘•€ô•±•ÑÉ½¸ ¤ì(€ÑÉäì(€€€É•ÑÕÉ¸±½…‘•ü¹Í•ÍÍ¥½¸ü¹™É½µA…ÉÑ¥Ñ¥½¸¡AIQ%Q%=8¤ñð¹Õ±°ì(€ô…Ñ ì(€€€É•ÑÕÉ¸¹Õ±°ì(€ô)ô)™Õ¹Ñ¥½¸¥Í±•ÑÉ½¹Ù…¥±…‰±” ¤ì(€É•ÑÕÉ¸	½½±•…¸¡•±•ÑÉ½¸ ¤¤ì)ô)…Íå¹Œ™Õ¹Ñ¥½¸¥¹ÍÑ¥ÑÕÑ¥½¹…±•Ñ ¡ÕÉ°°½ÁÑ¥½¹Ì€ôíô¤ì(€½¹ÍÐ±½…‘•€ô•±•ÑÉ½¸ ¤ì(€¥˜€ …±½…‘•¤Ñ¡É½Ü¹•ÜÉÉ½È ‰±•ÑÉ½¸Í•ÍÍ¥½¸Õ¹…Ù…¥±…‰±”ˆ¤ì(€½¹ÍÐÍ•ÍÌ€ôÍ•ÍÍ¥½¸ ¤ì(€½¹ÍÐÑ¥µ•½ÕÑ5Ì€ô½ÁÑ¥½¹Ì¹Ñ¥µ•½ÕÑ5Ì€üü€Í”Ðì(€½¹ÍÐ™•Ñ¡¸€ô±½…‘•¹¹•Ðü¹™•Ñ ñð±½‰…±Q¡¥Ì¹™•Ñ ì(€¥˜€¡ÑåÁ•½˜™•Ñ¡¸€„ôô€‰™Õ¹Ñ¥½¸ˆ¤Ñ¡É½Ü¹•ÜÉÉ½È ‰™•Ñ Õ¹…Ù…¥±…‰±”ˆ¤ì(€½¹ÍÐ½¹ÑÉ½±±•È€ô¹•Ü‰½ÉÑ½¹ÑÉ½±±•È ¤ì(€½¹ÍÐÑ¥µ•È€ôÍ•ÑQ¥µ•½ÕÐ  ¤€ôø½¹ÑÉ½±±•È¹…‰½ÉÐ ¤°Ñ¥µ•½ÕÑ5Ì¤ì(€ÑÉäì(€€€½¹ÍÐÉ•ÍÁ½¹Í”€ô…Ý…¥Ð™•Ñ¡¸¡ÕÉ°°ì(€€€€€µ•Ñ¡½è€‰Pˆ°(€€€€€¡•…‘•ÉÌè½ÁÑ¥½¹Ì¹¡•…‘•ÉÌ°(€€€€€Í¥¹…°è½¹ÑÉ½±±•È¹Í¥¹…°°(€€€€€Í•ÍÍ¥½¸èÍ•ÍÌ(€€€ô¤ì(€€€½¹ÍÐ¡•…‘•ÉÌ€ôíôì(€€€É•ÍÁ½¹Í”¹¡•…‘•ÉÌ¹™½É…  ¡Ù…±Õ”°­•ä¤€ôøì(€€€€€¡•…‘•ÉÍm­•ä¹Ñ½1½Ý•É…Í” ¥t€ôÙ…±Õ”ì(€€€ô¤ì(€€€É•ÑÕÉ¸ì(€€€€€ÍÑ…ÑÕÌèÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÌ°(€€€€€¡•…‘•ÉÌ°(€€€€€‰½‘äè¹•ÜU¥¹ÐáÉÉ…ä¡…Ý…¥ÐÉ•ÍÁ½¹Í”¹…ÉÉ…å	Õ™™•È ¤¤°(€€€€€™¥¹…±UÉ°èÉ•ÍÁ½¹Í”¹ÕÉ°ñðÕÉ°°(€€€€€É•ÍÁ½¹Í”(€€€ôì(€ô™¥¹…±±äì(€€€±•…ÉQ¥µ•½ÕÐ¡Ñ¥µ•È¤ì(€ô)ô((¼¼Á…­…•Ì½•áÑ•¹Í¥½¹Ì½ÍÉŒ½¥¹Ñ•É¹…°½É•Í•…É µ¡½ÍÐ¹ÑÌ)Ù…È•á±ÕÍ¥Ù•Q…¥±Ì€ô€¼¨}}AUI}|€¨¼¹•Ü5…À ¤ì)™Õ¹Ñ¥½¸•á±ÕÍ¥Ù”¡­•ä°Ý½É¬¤ì(€½¹ÍÐÁÉ•Ù¥½ÕÌ€ô•á±ÕÍ¥Ù•Q…¥±Ì¹•Ð¡­•ä¤€üüAÉ½µ¥Í”¹É•Í½±Ù” ¤ì(€½¹ÍÐÕÉÉ•¹Ð€ôÁÉ•Ù¥½ÕÌ¹…Ñ   ¤€ôøì(€ô¤¹Ñ¡•¸¡Ý½É¬¤ì(€•á±ÕÍ¥Ù•Q…¥±Ì¹Í•Ð¡­•ä°ÕÉÉ•¹Ð¤ì(€É•ÑÕÉ¸ÕÉÉ•¹Ð¹™¥¹…±±ä  ¤€ôøì(€€€¥˜€¡•á±ÕÍ¥Ù•Q…¥±Ì¹•Ð¡­•ä¤€ôôôÕÉÉ•¹Ð¤•á±ÕÍ¥Ù•Q…¥±Ì¹‘•±•Ñ”¡­•ä¤ì(€ô¤ì)ô)Ù…È…É¡¥Ù•A½ÉÑÌ€ôì(€Ý½É­ÍÁ…”è…Íå¹Œ€¡Ý¤€ôø…Ý…¥Ð±½…‘]½É­ÍÁ…•½¹™¥œ¡Ý¤°(€ÁÕ‰±¥Í¡M½ÕÉ•9½Ñ”°(€•á±ÕÍ¥Ù”°(€±½…‘%¹ÍÑ¥ÑÕÑ¥½¹…±½¹™¥œ°(€¥Í±•ÑÉ½¹Ù…¥±…‰±”°(€¥¹ÍÑ¥ÑÕÑ¥½¹…±•Ñ °(€‰Õ¥±‘AÉ½á¥•‘UÉ°)ôì)Ù…È½¹Ñ…¥¹•€ô€¡É½½Ð°Ñ…É•Ð¤€ôøì(€½¹ÍÐÉ•°€ôÉ•±…Ñ¥Ù”ÄÄ¡É½½Ð°Ñ…É•Ð¤ì(€É•ÑÕÉ¸É•°€„ôô€ˆ¸¸ˆ€˜˜€…É•°¹ÍÑ…ÉÑÍ]¥Ñ ¡€¸¸‘íÍ•ÀÄÁõ€¤€˜˜€…¥Í‰Í½±ÕÑ”ÄÈ¡É•°¤ì)ôì)…Íå¹Œ™Õ¹Ñ¥½¸É•Í½±Ù•IÕ¹)½ÕÉ¹…°¡Ý°ÉÕ¹¥È¤ì(€½¹ÍÐ½¹™¥œ€ô…Ý…¥Ð±½…‘]½É­ÍÁ…•½¹™¥œ¡Ý¤ì(€½¹ÍÐÉ½½Ð€ô…Ý…¥ÐÉ•…±Á…Ñ ä¡½¹™¥œ¹É•ÍÕ±ÑÍI½½Ð¤ì(€½¹ÍÐÉÕ¸€ô…Ý…¥ÐÉ•…±Á…Ñ ä¡É•Í½±Ù”ÄÐ¡Ý°ÉÕ¹¥Èñð€ˆˆ¤¤ì(€½¹ÍÐÁ…ÉÑÌ€ôÉ•±…Ñ¥Ù”ÄÄ¡É½½Ð°ÉÕ¸¤¹ÍÁ±¥Ð¡Í•ÀÄÀ¤ì(€¥˜€ …½¹Ñ…¥¹•¡É½½Ð°ÉÕ¸¤ñðÁ…ÉÑÌ¹±•¹Ñ €„ôô€Èñð€…Á…ÉÑÍlÅt¹ÍÑ…ÉÑÍ]¥Ñ  ‰ÉÕ¸´ˆ¤¤(€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰=Á•É…Ñ¥½¸±½œµÕÍÐ‰”¥¹Í¥‘”„É•Í•…É ÉÕ¸ˆ¤ì(€…Ý…¥ÐÉ•…‘¥±”ÄÈ¡©½¥¸ÄØ¡ÉÕ¸°€‰µ•Ñ…‘…Ñ„¹©Í½¸ˆ¤°€‰ÕÑ˜àˆ¤ì(€É•ÑÕÉ¸ì(€€€™¥±”è©½¥¸ÄØ¡ÉÕ¸°€‰±¥Ñ•É…ÑÕÉ”µ½Á•É…Ñ¥½¹Ì¹©Í½¸ˆ¤°(€€€Ù…Õ±Ðè½¹™¥œ¹½‰Í¥‘¥…¹Y…Õ±Ð€ü…Ý…¥ÐÉ•…±Á…Ñ ä¡½¹™¥œ¹½‰Í¥‘¥…¹Y…Õ±Ð¤€è¹Õ±°°(€€€É•Ù¥Í¥½¸è9Õµ‰•È¡½¹™¥œ¹­¹½Ý±•‘•	¥¹‘¥¹I•Ù¥Í¥½¸ñð€À¤(€ôì)ô)…Íå¹Œ™Õ¹Ñ¥½¸É•…‘)½ÕÉ¹…°¡™¥±”¤ì(€ÑÉäì(€€€½¹ÍÐÙ…±Õ”€ô)M=8¹Á…ÉÍ”¡…Ý…¥ÐÉ•…‘¥±”ÄÈ¡™¥±”°€‰ÕÑ˜àˆ¤¤ì(€€€¥˜€¡Ù…±Õ”ü¹Ù•ÉÍ¥½¸€„ôô€Äñð€…Ù…±Õ”¹½Á•É…Ñ¥½¹ÌñðÑåÁ•½˜Ù…±Õ”¹½Á•É…Ñ¥½¹Ì€„ôô€‰½‰©•Ðˆ¤(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰%¹Ù…±¥½Á•É…Ñ¥½¸±½œˆ¤ì(€€€É•ÑÕÉ¸Ù…±Õ”ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€¥˜€¡•ÉÉ½Èü¹½‘”€„ôô€‰9=9Pˆ¤Ñ¡É½Ü•ÉÉ½Èì(€€€É•ÑÕÉ¸ìÙ•ÉÍ¥½¸è€Ä°½Á•É…Ñ¥½¹Ìèíôôì(€ô)ô)…Íå¹Œ™Õ¹Ñ¥½¸ÝÉ¥Ñ•)½ÕÉ¹…°¡™¥±”°©½ÕÉ¹…°¤ì(€½¹ÍÐÑ•µÁ½É…Éä€ô€‘í™¥±•ô¸‘íÉ…¹‘½µUU%ÄÀ ¥ô¹ÑµÁ€ì(€…Ý…¥ÐÝÉ¥Ñ•¥±”ÄÀ¡Ñ•µÁ½É…Éä°€‘í)M=8¹ÍÑÉ¥¹¥™ä¡©½ÕÉ¹…°°¹Õ±°°€È¥ô)€¤ì(€…Ý…¥ÐÉ•¹…µ”ä¡Ñ•µÁ½É…Éä°™¥±”¤ì)ô)Ù…È½Á•É…Ñ¥½¹Ì€ôÉ•…Ñ•1¥Ñ•É…ÑÕÉ•=Á•É…Ñ¥½¹Ì¡ì(€É•Í½±Ù•IÕ¹)½ÕÉ¹…°°(€É•…‘)½ÕÉ¹…°°(€ÝÉ¥Ñ•)½ÕÉ¹…°°(€•á±ÕÍ¥Ù”è€¡™¥±”°Ý½É¬¤€ôø•á±ÕÍ¥Ù”¡™¥±”°Ý½É¬¤°(€Ù•É¥™äèÙ•É¥™å1¥Ñ•É…ÑÕÉ•I••¥ÁÐ)ô¤ì)Ù…ÈÉ•½¹¥±•1¥Ñ•É…ÑÕÉ•=Á•É…Ñ¥½¸€ô½Á•É…Ñ¥½¹Ì¹É•½¹¥±•1¥Ñ•É…ÑÕÉ•=Á•É…Ñ¥½¸ì)Ù…ÈÉ•½É‘i½Ñ•É½]É¥Ñ”€ô½Á•É…Ñ¥½¹Ì¹É•½É‘i½Ñ•É½]É¥Ñ”ì)Ù…È±½½À€ôÉ•…Ñ•I•Í•…É¡1½½À¡ì(€Ý½É­ÍÁ…”è…Íå¹Œ€¡Ý¤€ôø…Ý…¥Ð±½…‘]½É­ÍÁ…•½¹™¥œ¡Ý¤°(€Ù•É¥™å1¥Ñ•É…ÑÕÉ•I••¥ÁÐè€¡¥¹ÁÕÐ¤€ôøÙ•É¥™å1¥Ñ•É…ÑÕÉ•I••¥ÁÐ¡¥¹ÁÕÐ¤°(€•á±ÕÍ¥Ù”°(€Í½ÕÉ•MÑ…ÑÕÌè…Íå¹Œ€¡ìÝ°ÉÕ¹}‘¥È°Ù•É¥™äô¤€ôøÍ½ÕÉ•MÑ…ÑÕÌ¡ìÝ°ÉÕ¹}‘¥È°Ù•É¥™äô°…É¡¥Ù•A½ÉÑÌ¤)ô¤ì((¼¼Á…­…•Ì½•áÑ•¹Í¥½¹Ì½ÍÉŒ½¥¹Ñ•É¹…°½ÉÕ¹Ñ¥µ”¹ÑÌ)¥µÁ½ÉÐìÍå¹1½…±MÑ½É…”…ÌÍå¹1½…±MÑ½É…”Ìô™É½´€‰¹½‘”é…Íå¹}¡½½­Ìˆì)Ù…ÈYIM%=8€ô€Äì)Ù…ÈIU9Q%5}Y9P€ô€‰‘É½¹”éÉÕ¹Ñ¥µ”½ØÄˆì)Ù…ÈIU9Q%5}IEUMQ}Y9P€ô€‰‘É½¹”éÉÕ¹Ñ¥µ”½É•ÅÕ•ÍÐ½ØÄˆì)Ù…È½¹Ñ•áÑÌÈ€ô¹•ÜÍå¹1½…±MÑ½É…”Ì ¤ì)Ù…È¡½ÍÑIÕ¹Ñ¥µ•ÌÈ€ô€¼¨}}AUI}|€¨¼¹•Ü]•…­5…À ¤ì)Ù…È¡½ÍÑ±•…¹ÕÁÌ€ô€¼¨}}AUI}|€¨¼¹•Ü]•…­5…À ¤ì)Ù…ÈÁÉ½•ÍÍIÕ¹Ñ¥µ”ì)Ù…È-•å•‘M¡•‘Õ±•ÈÈ€ô±…ÍÌì(€Ñ…¥±Ì€ô€¼¨}}AUI}|€¨¼¹•Ü5…À ¤ì(€‘¥ÍÁ½Í•€ô™…±Í”ì(€…Íå¹ŒÉÕ¸¡­•ä°Ñ…Í¬È¤ì(€€€¥˜€¡Ñ¡¥Ì¹‘¥ÍÁ½Í•¤Ñ¡É½Ü¹•ÜÉÉ½È ‰áÑ•¹Í¥½¸ÉÕ¹Ñ¥µ”Í¡•‘Õ±•È¡…Ì‰••¸‘¥ÍÁ½Í•ˆ¤ì(€€€½¹ÍÐÁÉ•Ù¥½ÕÌ€ôÑ¡¥Ì¹Ñ…¥±Ì¹•Ð¡­•ä¤€üüAÉ½µ¥Í”¹É•Í½±Ù” ¤ì(€€€±•ÐÕ¹±½¬ì(€€€½¹ÍÐ…Ñ”€ô¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”ÄÔ¤€ôøì(€€€€€Õ¹±½¬€ôÉ•Í½±Ù”ÄÔì(€€€ô¤ì(€€€½¹ÍÐÑ…¥°€ôÁÉ•Ù¥½ÕÌ¹Ñ¡•¸  ¤€ôø…Ñ”¤ì(€€€Ñ¡¥Ì¹Ñ…¥±Ì¹Í•Ð¡­•ä°Ñ…¥°¤ì(€€€…Ý…¥ÐÁÉ•Ù¥½ÕÌì(€€€ÑÉäì(€€€€€É•ÑÕÉ¸…Ý…¥ÐÑ…Í¬È ¤ì(€€€ô™¥¹…±±äì(€€€€€Õ¹±½¬ ¤ì(€€€€€¥˜€¡Ñ¡¥Ì¹Ñ…¥±Ì¹•Ð¡­•ä¤€ôôôÑ…¥°¤Ñ¡¥Ì¹Ñ…¥±Ì¹‘•±•Ñ”¡­•ä¤ì(€€€ô(€ô(€‘¥ÍÁ½Í” ¤ì(€€€Ñ¡¥Ì¹‘¥ÍÁ½Í•€ôÑÉÕ”ì(€€€Ñ¡¥Ì¹Ñ…¥±Ì¹±•…È ¤ì(€ô)ôì)™Õ¹Ñ¥½¸É•…Ñ•MÑ…¹‘…±½¹•IÕ¹Ñ¥µ”È ¤ì(€½¹ÍÐÍ¡•‘Õ±•È€ô¹•Ü-•å•‘M¡•‘Õ±•ÈÈ ¤ì(€±•Ð‘¥ÍÁ½Í•€ô™…±Í”ì(€É•ÑÕÉ¸ì(€€€­¹½Ý±•‘”èíô°(€€€Ñ…Í­Ìèíô°(€€€Ñ½½±Ìèíô°(€€€Í¡•‘Õ±•È°(€€€É•¥ÍÑ•É¥ÍÁ½Í…‰±”¡É•Í½ÕÉ”¤ì(€€€€€¥˜€¡‘¥ÍÁ½Í•¤Ù½¥€¡É•Í½ÕÉ”¹‘¥ÍÁ½Í”ü¸ ¤€üüÉ•Í½ÕÉ”¹±½Í”ü¸ ¤¤ì(€€€€€É•ÑÕÉ¸€ ¤€ôøì(€€€€€ôì(€€€ô°(€€€‘¥ÍÁ½Í” ¤ì(€€€€€¥˜€¡‘¥ÍÁ½Í•¤É•ÑÕÉ¸ì(€€€€€‘¥ÍÁ½Í•€ôÑÉÕ”ì(€€€€€Í¡•‘Õ±•È¹‘¥ÍÁ½Í” ¤ì(€€€ô(€ôì)ô)™Õ¹Ñ¥½¸Ù…±¥‘IÕ¹Ñ¥µ”¡Ù…±Õ”¤ì(€É•ÑÕÉ¸	½½±•…¸ (€€€Ù…±Õ”€˜˜ÑåÁ•½˜Ù…±Õ”€ôôô€‰½‰©•Ðˆ€˜˜ÑåÁ•½˜Ù…±Õ”¹Í¡•‘Õ±•Èü¹ÉÕ¸€ôôô€‰™Õ¹Ñ¥½¸ˆ(€€¤ì)ô)™Õ¹Ñ¥½¸‰¥¹‘áÑ•¹Í¥½¹IÕ¹Ñ¥µ”¡Á¤¤ì(€¥˜€ …Á¤ñðÑåÁ•½˜Á¤€„ôô€‰½‰©•Ðˆ€˜˜ÑåÁ•½˜Á¤€„ôô€‰™Õ¹Ñ¥½¸ˆ¤É•ÑÕÉ¸ÍÑ…¹‘…±½¹•IÕ¹Ñ¥µ”È ¤ì(€½¹ÍÐ•á¥ÍÑ¥¹œ€ô¡½ÍÑIÕ¹Ñ¥µ•ÌÈ¹•Ð¡Á¤¤ì(€¥˜€¡•á¥ÍÑ¥¹œ¤É•ÑÕÉ¸•á¥ÍÑ¥¹œì(€±•ÐÉÕ¹Ñ¥µ”€ôÉ•…Ñ•MÑ…¹‘…±½¹•IÕ¹Ñ¥µ”È ¤ì(€¡½ÍÑIÕ¹Ñ¥µ•ÌÈ¹Í•Ð¡Á¤°ÉÕ¹Ñ¥µ”¤ì(€½¹ÍÐ•Ù•¹ÑÌ€ôÁ¤¹•Ù•¹ÑÌì(€¥˜€ …•Ù•¹ÑÌü¹½¸ñð€…•Ù•¹ÑÌ¹•µ¥Ð¤É•ÑÕÉ¸ÉÕ¹Ñ¥µ”ì(€½¹ÍÐÉ••¥Ù”€ô€¡Á…å±½…¤€ôøì(€€€¥˜€ …Á…å±½…ñðÑåÁ•½˜Á…å±½…€„ôô€‰½‰©•Ðˆ¤É•ÑÕÉ¸ì(€€€½¹ÍÐÙ…±Õ”€ôÁ…å±½…¹ÉÕ¹Ñ¥µ”ì(€€€¥˜€¡Á…å±½…¹Ù•ÉÍ¥½¸€„ôôYIM%=8ñð€…Ù…±¥‘IÕ¹Ñ¥µ”¡Ù…±Õ”¤¤É•ÑÕÉ¸ì(€€€½¹ÍÐÁÉ•Ù¥½ÕÌ€ôÉÕ¹Ñ¥µ”ì(€€€ÉÕ¹Ñ¥µ”€ôÙ…±Õ”ì(€€€¡½ÍÑIÕ¹Ñ¥µ•ÌÈ¹Í•Ð¡Á¤°ÉÕ¹Ñ¥µ”¤ì(€€€¥˜€¡ÁÉ•Ù¥½ÕÌ€„ôôÉÕ¹Ñ¥µ”€˜˜ÑåÁ•½˜ÁÉ•Ù¥½ÕÌ¹‘¥ÍÁ½Í”€ôôô€‰™Õ¹Ñ¥½¸ˆ¤Ù½¥ÁÉ•Ù¥½ÕÌ¹‘¥ÍÁ½Í” ¤ì(€ôì(€½¹ÍÐµ…å‰•±•…¹ÕÀ€ô•Ù•¹ÑÌ¹½¸¡IU9Q%5}Y9P°É••¥Ù”¤ì(€¡½ÍÑ±•…¹ÕÁÌ¹Í•Ð¡Á¤°€ ¤€ôøì(€€€¥˜€¡ÑåÁ•½˜µ…å‰•±•…¹ÕÀ€ôôô€‰™Õ¹Ñ¥½¸ˆ¤µ…å‰•±•…¹ÕÀ ¤ì(€€€¥˜€¡¡½ÍÑIÕ¹Ñ¥µ•ÌÈ¹•Ð¡Á¤¤€ôôôÉÕ¹Ñ¥µ”¤¡½ÍÑIÕ¹Ñ¥µ•ÌÈ¹‘•±•Ñ”¡Á¤¤ì(€€€¥˜€¡ÑåÁ•½˜ÉÕ¹Ñ¥µ”¹‘¥ÍÁ½Í”€ôôô€‰™Õ¹Ñ¥½¸ˆ¤Ù½¥ÉÕ¹Ñ¥µ”¹‘¥ÍÁ½Í” ¤ì(€€€¡½ÍÑ±•…¹ÕÁÌ¹‘•±•Ñ”¡Á¤¤ì(€ô¤ì(€Ù½¥•Ù•¹ÑÌ¹•µ¥Ð¡IU9Q%5}IEUMQ}Y9P°ìÙ•ÉÍ¥½¸èYIM%=8ô¤ì(€É•ÑÕÉ¸ÉÕ¹Ñ¥µ”ì)ô)™Õ¹Ñ¥½¸Ý¥Ñ¡áÑ•¹Í¥½¹IÕ¹Ñ¥µ”¡Á¤°½Á•É…Ñ¥½¸¤ì(€½¹ÍÐÉÕ¹Ñ¥µ”€ô¡½ÍÑIÕ¹Ñ¥µ•ÌÈ¹•Ð¡Á¤¤€üü‰¥¹‘áÑ•¹Í¥½¹IÕ¹Ñ¥µ”¡Á¤¤ì(€É•ÑÕÉ¸½¹Ñ•áÑÌÈ¹ÉÕ¸¡ÉÕ¹Ñ¥µ”°½Á•É…Ñ¥½¸¤ì)ô)™Õ¹Ñ¥½¸ÉÕ¹áÑ•¹Í¥½¹á±ÕÍ¥Ù”¡Á¤°­•ä°Ñ…Í¬È¤ì(€É•ÑÕÉ¸AÉ½µ¥Í”¹É•Í½±Ù” (€€€Ý¥Ñ¡áÑ•¹Í¥½¹IÕ¹Ñ¥µ”¡Á¤°€ ¤€ôøì(€€€€€½¹ÍÐÉÕ¹Ñ¥µ”€ô½¹Ñ•áÑÌÈ¹•ÑMÑ½É” ¤€üüÍÑ…¹‘…±½¹•IÕ¹Ñ¥µ”È ¤ì(€€€€€É•ÑÕÉ¸ÉÕ¹Ñ¥µ”¹Í¡•‘Õ±•È¹ÉÕ¸¡­•ä°Ñ…Í¬È¤ì(€€€ô¤(€€¤ì)ô)™Õ¹Ñ¥½¸ÍÑ…¹‘…±½¹•IÕ¹Ñ¥µ”È ¤ì(€¥˜€ …ÁÉ½•ÍÍIÕ¹Ñ¥µ”¤ÁÉ½•ÍÍIÕ¹Ñ¥µ”€ôÉ•…Ñ•MÑ…¹‘…±½¹•IÕ¹Ñ¥µ”È ¤ì(€É•ÑÕÉ¸ÁÉ½•ÍÍIÕ¹Ñ¥µ”ì)ô((¼¼Á…­…•Ì½•áÑ•¹Í¥½¹Ì½ÍÉŒ½Í½ÕÉ”µ…É¡¥Ù”¹ÑÌ)™Õ¹Ñ¥½¸…É¡¥Ù•…É¡•Ù•¹Ð¤ì(€½¹ÍÐ€ô•Ù•¹Ð¹É•ÍÕ±Ðü¹‘•Ñ…¥±Ìñðíôì(€É•ÑÕÉ¸™±½Ý…É¡ì(€€€­•äè¹Á…Ñ ñð¹ÕÉ°ñð•Ù•¹Ð¹Ñ½½±…±±%°(€€€­¥¹è€‰Í½ÕÉ”ˆ°(€€€Ñ¥Ñ±”è¹µ•Ñ…‘…Ñ„ü¹Ñ¥Ñ±”ñð¹…Ñ•½Éäñð•Ù•¹Ð¹Ñ½½±9…µ”°(€€€ÍÑ…ÑÕÌè¹ÍÑ…ÑÕÌ°(€€€Á…Ñ è¹Á…Ñ °(€€€‘•Ñ…¥°è¹­¹½Ý±•‘•}ÍÑ…ÑÕÌ€ôôô€‰ÝÉ¥ÑÑ•¸ˆ€ü€‰M½ÕÉ”¹½Ñ”Í…Ù•ì¹½Ð„™Õ±°µ…¹Õ…°½ÈÉ•Ù¥•Ý•Íå¹Ñ¡•Í¥Ì¸ˆ€è¹É•…Í½¸ñð¹½‰Í¥‘¥…¹}•ÉÉ½Èñð¹­¹½Ý±•‘•}ÍÑ…ÑÕÌ°(€€€±¥¹­Ìèm¹Á…Ñ €ü…É‘1¥¹¬ ‰Á…Ñ ˆ°¹Á…Ñ °€‰qÔØÈÔÍqÔÕÀÀˆ°€‰™±½Ü¹±¥¹¬¹½Á•¸ˆ¤€è¹Õ±±t°(€€€Í½ÕÉ”è•Ù•¹Ð¹Ñ½½±9…µ”(€ô¤ì)ô)™Õ¹Ñ¥½¸Í½ÕÉ•MÑ…ÑÕÍ…É‘Ì¡•Ù•¹Ð¤ì(€½¹ÍÐ€ô•Ù•¹Ð¹É•ÍÕ±Ðü¹‘•Ñ…¥±Ìñðíôì(€É•ÑÕÉ¸l(€€€€¸¸¸¡¹µ…¹¥™•ÍÐü¹¥Ñ•µÌñðmt¤¹Í±¥” ´ÈÀ¤¹µ…À (€€€€€€¡¥Ñ•´¤€ôø™±½Ý…É¡ì(€€€€€€€­•äè¥Ñ•´¹Á…Ñ ñð¥Ñ•´¹¥°(€€€€€€€­¥¹è€‰Í½ÕÉ”ˆ°(€€€€€€€Ñ¥Ñ±”è¥Ñ•´¹µ•Ñ…‘…Ñ„ü¹Ñ¥Ñ±”ñð¥Ñ•´¹…Ñ•½Éä°(€€€€€€€ÍÑ…ÑÕÌè¥Ñ•´¹ÍÑ…ÑÕÌ°(€€€€€€€Á…Ñ è¥Ñ•´¹Á…Ñ °(€€€€€€€‘•Ñ…¥°è€‰M½ÕÉ”…É¡¥Ù•ì¥¹Ñ•ÉÁÉ•Ñ…Ñ¥½¸…¹µ…¹Õ…°½Ù•É…”…É”Í•Á…É…Ñ”¸ˆ°(€€€€€€€±¥¹­Ìèm¥Ñ•´¹Á…Ñ €ü…É‘1¥¹¬ ‰Á…Ñ ˆ°¥Ñ•´¹Á…Ñ °€‰qÔØÈÔÍqÔÕÀÀˆ°€‰™±½Ü¹±¥¹¬¹½Á•¸ˆ¤€è¹Õ±±t°(€€€€€€€Í½ÕÉ”è•Ù•¹Ð¹Ñ½½±9…µ”(€€€€€ô¤(€€€€¤°(€€€€¸¸¸¡¹µ…¹¥™•ÍÐü¹™…¥±ÕÉ•Ìñðmt¤¹Í±¥” ´Ø¤¹µ…À (€€€€€€¡¥Ñ•´¤€ôø™±½Ý…É¡ì(€€€€€€€­•äè¥Ñ•´¹ÕÉ°°(€€€€€€€­¥¹è€‰Í½ÕÉ”ˆ°(€€€€€€€Ñ¥Ñ±”è¥Ñ•´¹ÕÉ°°(€€€€€€€ÍÑ…ÑÕÌè€‰™…¥±•ˆ°(€€€€€€€‘•Ñ…¥°è¥Ñ•´¹É•…Í½¸°(€€€€€€€Í½ÕÉ”è•Ù•¹Ð¹Ñ½½±9…µ”(€€€€€ô¤(€€€€¤(€tì)ô)™Õ¹Ñ¥½¸Í½ÕÉ•É¡¥Ù”¡Á¤¤ì(€¥˜€¡ÁÉ½•ÍÌ¹•¹Ø¹A%}MU	9Q}!%1€ôôô€ˆÄˆ¤É•ÑÕÉ¸ì(€‰¥¹‘áÑ•¹Í¥½¹IÕ¹Ñ¥µ”¡Á¤¤ì(€½¹ÍÐÉÕ¸€ô€¡½Á•É…Ñ¥½¸¤€ôøÉÕ¹áÑ•¹Í¥½¹á±ÕÍ¥Ù”¡Á¤°€‰Í½ÕÉ”µ…É¡¥Ù”ˆ°½Á•É…Ñ¥½¸¤ì(€É•¥ÍÑ•ÉQ½½°¡Á¤°ì(€€€¹…µ”è€‰É•Í•…É¡}…É¡¥Ù•}Í½ÕÉ”ˆ°(€€€±…‰•°è€‰É¡¥Ù”É•Í•…É Í½ÕÉ”ˆ°(€€€‘É½¹”èì(€€€€€…Á…‰¥±¥Ñ¥•Ìèl‰É•Í•…É ‰t°(€€€€€©½ÕÉ¹…°èÑÉÕ”°(€€€€€ÍÕ‰…•¹Ðè€‰•á±Õ‘”ˆ°(€€€€€…Ñ¥Ù¥ÑäèìÑ•áÐè€‰qÔÙØÍqÔÔÜÈáqÔÕÔÉqÔØàØÍqÔÜàÄÑqÔÝÜÙqÔá	ÅqÔØÌÙqÔÈÀÈØˆ°Á¡…Í”è€‰…É¡¥Ù”ˆô°(€€€€€™±½Üè€‰Í½ÕÉ”ˆ°(€€€€€™±½Ý…É‘Ìè…É¡¥Ù•…É(€€€ô°(€€€‘•ÍÉ¥ÁÑ¥½¸è€‰½Ý¹±½…„±¥Ñ•É…ÑÕÉ”½ÈÍ½™ÑÝ…É”Í½ÕÉ”¥¹Ñ¼Ñ¡”ÕÉÉ•¹ÐÉÕ¸ÌÍ½ÕÉ•Ì‘¥É•Ñ½ÉäÝ¥Ñ ÁÉ½Ù•¹…¹”…¹M!´ÈÔØ¸½ÈÁ…Á•ÉÌ°¥Ù”Ñ¡”=$€¡½ÈA5%½A5%¤…¹½µ¥ÐÕÉ°èÑ¡”¡½ÍÐÉ•Í½±Ù•Ì„±•¥Ñ¥µ…Ñ”½Á•¸µ…•ÍÌAÑ¡É½Õ ÕÉ½Á”A5°Ñ¡”A5=ÍÕ‰Í•Ð°U¹Á…åÝ…±°°=Á•¹±•à°M•µ…¹Ñ¥ŒM¡½±…È…¹É½ÍÍÉ•˜°ÑÉ¥•ÌÑ¡”…¹‘¥‘…Ñ•Ì¥¸½É‘•È…¹É•½É‘ÌÝ¡…ÐÝ…ÌÅÕ•É¥•¸%˜=™…¥±Ì…¹¥¹ÍÑ¥ÑÕÑ¥½¹…°…•ÍÌ¥Ì½¹™¥ÕÉ•€¡M•ÑÑ¥¹ÌqÔÈÄäÈi½Ñ•É¼qÔÈÄäÈ%¹ÍÑ¥ÑÕÑ¥½¹…°•ÍÌèiÁÉ½áäÑ•µÁ±…Ñ”€¬½¹”µÑ¥µ”±½¥¸¤°Ñ¡”¡½ÍÐÑÉ¥•ÌÑ¡”¥¹ÍÑ¥ÑÕÑ¥½¹…°Í•ÍÍ¥½¸€¡Á•ÉÍ¥ÍÐé‘É½¹”µ¥¹ÍÑ¥ÑÕÑ¥½¹…°¤Ý¥Ñ Ñ¡”iÁÉ½áäÑ•µÁ±…Ñ”°É•ÍÁ•Ñ¥¹œ„Á•ÈµÑ…Í¬±¥µ¥Ð€¡‘•™…Õ±Ð€ÈÀ¤¸ÍÑ…ÑÕÌõ¹½}½Á•¹}…•ÍÌµ•…¹Ì¹¼±…Ý™Õ°=½Áä•á¥ÍÑÌìÍÑ…ÑÕÌõ¥¹ÍÑ¥ÑÕÑ¥½¹…±}…ÕÑ¡}É•ÅÕ¥É•µ•…¹Ì¥¹ÍÑ¥ÑÕÑ¥½¹…°±½¥¸•áÁ¥É•½…ÁÑ¡„qÔÈÀÄÌ…Í¬Ñ¡”ÕÍ•ÈÑ¼É”µ±½¥¸Ù¥„Ñ¡”¥¹ÍÑ¥ÑÕÑ¥½¹…°‰É½ÝÍ•ÈìÍÑ…ÑÕÌõ¥¹ÍÑ¥ÑÕÑ¥½¹…±}±¥µ¥Ñ}É•…¡•µ•…¹ÌÁ•ÈµÑ…Í¬…À¡¥Ð¸½È¹½}½Á•¹}…•ÍÌ°É•Á½ÉÐ…‰ÍÑÉ…Ðµ½¹±ä½È…Í¬Ñ¡”ÕÍ•ÈÑ¼‘½Ý¹±½…Ý¥Ñ Ñ¡•¥È½Ý¸…•ÍÌ€¡Ñ…Í­}Ý…¥Ð­¥¹õ‘½Ý¹±½…°Ñ¡•¸±½…±}™¥±”€¬¡Õµ…¹}Ù•É¥™¥•õÑÉÕ”¤ì¹•Ù•È™•Ñ ™É½´Á¥É…Ñ”µ¥ÉÉ½ÉÌ¸	É½ÝÍ•ÈµÉ•ÅÕ¥É•É•ÍÁ½¹Í•Ì…É”¡…¹‘•½™˜™½Èµ…¹Õ…°Ù•É¥™¥…Ñ¥½¸ì‘½Ý¹±½…‘•™¥±•Ì…É”¹•Ù•È•á•ÕÑ•¸ˆ°(€€€Á…É…µ•Ñ•ÉÌèì(€€€€€ÑåÁ”è€‰½‰©•Ðˆ°(€€€€€ÁÉ½Á•ÉÑ¥•Ìèì(€€€€€€€ÉÕ¹}‘¥ÈèìÑåÁ”è€‰ÍÑÉ¥¹œˆô°(€€€€€€€ÕÉ°èìÑåÁ”è€‰ÍÑÉ¥¹œˆ°‘•ÍÉ¥ÁÑ¥½¸è€‰=ÁÑ¥½¹…°™½ÈÁ…Á•ÉÌÝ¡•¸‘½¤½Áµ¥½Áµ¥¥Ì¥Ù•¸ˆô°(€€€€€€€‘½¤èìÑåÁ”è€‰ÍÑÉ¥¹œˆô°(€€€€€€€Áµ¥èìÑåÁ”è€‰ÍÑÉ¥¹œˆô°(€€€€€€€Áµ¥èìÑåÁ”è€‰ÍÑÉ¥¹œˆô°(€€€€€€€É•Í½±Ù•}½Á•¹}…•ÍÌèì(€€€€€€€€€ÑåÁ”è€‰‰½½±•…¸ˆ°(€€€€€€€€€‘•ÍÉ¥ÁÑ¥½¸è€‰•™…Õ±ÐÑÉÕ”™½ÈÁ…Á•ÉÌÝ¥Ñ …¸¥‘•¹Ñ¥™¥•Èì™…±Í”€ô½¹±ä™•Ñ Ñ¡”¥Ù•¸ÕÉ°ˆ(€€€€€€€ô°(€€€€€€€µ…á}…¹‘¥‘…Ñ•ÌèìÑåÁ”è€‰¥¹Ñ••Èˆ°µ¥¹¥µÕ´è€Ä°µ…á¥µÕ´è€à°‘•™…Õ±Ðè€Øô°(€€€€€€€…Ñ•½ÉäèìÑåÁ”è€‰ÍÑÉ¥¹œˆ°•¹Õ´èM=UI}Q=I%Lô°(€€€€€€€™¥±•¹…µ”èìÑåÁ”è€‰ÍÑÉ¥¹œˆô°(€€€€€€€µ•Ñ…‘…Ñ„èìÑåÁ”è€‰½‰©•Ðˆô°(€€€€€€€±½…±}™¥±”èì(€€€€€€€€€ÑåÁ”è€‰ÍÑÉ¥¹œˆ°(€€€€€€€€€‘•ÍÉ¥ÁÑ¥½¸è€‰=ÁÑ¥½¹…°™¥±”¥µÁ½ÉÑ•™É½´€¹Á¤½‰É½ÝÍ•Èµ‘½Ý¹±½…‘Ì…™Ñ•Èµ…¹Õ…°‰É½ÝÍ•ÈÙ•É¥™¥…Ñ¥½¸ˆ(€€€€€€€ô°(€€€€€€€¡Õµ…¹}Ù•É¥™¥•èìÑåÁ”è€‰‰½½±•…¸ˆ°‘•ÍÉ¥ÁÑ¥½¸è€‰5ÕÍÐ‰”ÑÉÕ”•áÁ±¥¥Ñ±äÝ¡•¸¥µÁ½ÉÑ¥¹œ±½…±}™¥±”ˆô°(€€€€€€€½¹Ñ•¹Ñ}ÑåÁ”èìÑåÁ”è€‰ÍÑÉ¥¹œˆô°(€€€€€€€µ…á}‰åÑ•ÌèìÑåÁ”è€‰¥¹Ñ••Èˆ°µ¥¹¥µÕ´è€Ä°µ…á¥µÕ´è€ÔÈÐÈàá”Ì°‘•™…Õ±ÐèU1Q}5a}	eQLô°(€€€€€€€Ñ¥µ•½ÕÑ}µÌèìÑåÁ”è€‰¥¹Ñ••Èˆ°µ¥¹¥µÕ´è€ÄÀÀ°µ…á¥µÕ´è€Ù”Ô°‘•™…Õ±ÐèU1Q}Q%5=UQ}5Lô(€€€€€ô°(€€€€€É•ÅÕ¥É•èl‰ÉÕ¹}‘¥Èˆ°€‰…Ñ•½Éä‰t(€€€ô°(€€€…Íå¹Œ•á•ÕÑ”¡}¥°Á…É…µÌ°Í¥¹…°°}ÕÁ‘…Ñ”°Ñà¤ì(€€€€€É•ÑÕÉ¸ÉÕ¸¡…Íå¹Œ€ ¤€ôøì(€€€€€€€½¹ÍÐ…Í­±½Õ‘™±…É”€ôÑà¹Õ¤ü¹Í•±•Ð€ü…Íå¹Œ€¡ÕÉ°°…Í­M¥¹…°¤€ôøì(€€€€€€€€€½¹ÍÐ½Áä€ô±½Õ‘™±…É•Í­½Áä ¤ì(€€€€€€€€€½¹ÍÐ¡½¥”€ô…Ý…¥ÐÑà¹Õ¤¹Í•±•Ð (€€€€€€€€€€€€‘í½Áä¹Ñ¥Ñ±•ô((‘í½Áä¹‰½‘åô(‘íÕÉ±õ€°(€€€€€€€€€€€m½Áä¹½¹Ñ¥¹Õ•1…‰•°°½Áä¹Í­¥Á1…‰•±t°(€€€€€€€€€€€ìÍ¥¹…°è…Í­M¥¹…°€üüÍ¥¹…°ô(€€€€€€€€€€¤ì(€€€€€€€€€É•ÑÕÉ¸¡½¥”€ôôô½Áä¹½¹Ñ¥¹Õ•1…‰•°€ü€‰½¹Ñ¥¹Õ”ˆ€è€‰Í­¥Àˆì(€€€€€€€ô€èÙ½¥€Àì(€€€€€€€½¹ÍÐÁ½ÉÑÌ€ô…Í­±½Õ‘™±…É”€üì€¸¸¹…É¡¥Ù•A½ÉÑÌ°…Í­±½Õ‘™±…É”ô€è…É¡¥Ù•A½ÉÑÌì(€€€€€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥Ð…É¡¥Ù•M½ÕÉ”¡ì€¸¸¹Á…É…µÌ°ÝèÑà¹Ý°Í¥¹…°ô°Á½ÉÑÌ¤ì(€€€€€€€É•ÑÕÉ¸ì½¹Ñ•¹ÐèmìÑåÁ”è€‰Ñ•áÐˆ°Ñ•áÐè)M=8¹ÍÑÉ¥¹¥™ä¡É•ÍÕ±Ð°¹Õ±°°€È¤õt°‘•Ñ…¥±ÌèÉ•ÍÕ±Ðôì(€€€€€ô¤ì(€€€ô(€ô¤ì(€É•¥ÍÑ•ÉQ½½°¡Á¤°ì(€€€¹…µ”è€‰É•Í•…É¡}Í½ÕÉ•}ÍÑ…ÑÕÌˆ°(€€€±…‰•°è€‰I•Í•…É Í½ÕÉ”ÍÑ…ÑÕÌˆ°(€€€‘É½¹”èì(€€€€€É•…‘=¹±äèÑÉÕ”°(€€€€€É•½Ù•ÉåM…™”èÑÉÕ”°(€€€€€…Á…‰¥±¥Ñ¥•Ìèl‰É•Í•…É ‰t°(€€€€€…Ñ¥Ù¥ÑäèìÑ•áÐè€‰qÔÙØÍqÔÔÜÈáqÔØáÁqÔØÝÕqÔÕÔÉqÔØàØÍqÔØÜØÕqÔÙäÁqÔÈÀÈØˆ°Á¡…Í”è€‰…É¡¥Ù”ˆô°(€€€€€™±½Üè€‰Í½ÕÉ”ˆ°(€€€€€™±½Ý…É‘ÌèÍ½ÕÉ•MÑ…ÑÕÍ…É‘Ì(€€€ô°(€€€‘•ÍÉ¥ÁÑ¥½¸è€‰M¡½Ü…É¡¥Ù•Í½ÕÉ”µ…¹¥™•ÍÐ…¹‰É½ÝÍ•ÈµÉ•ÅÕ¥É•½È™…¥±•‘½Ý¹±½…‘Ì™½È„É•Í•…É ÉÕ¸¸ˆ°(€€€Á…É…µ•Ñ•ÉÌèìÑåÁ”è€‰½‰©•Ðˆ°ÁÉ½Á•ÉÑ¥•ÌèìÉÕ¹}‘¥ÈèìÑåÁ”è€‰ÍÑÉ¥¹œˆôôô°(€€€…Íå¹Œ•á•ÕÑ”¡}¥°Á…É…µÌ°}Í¥¹…°°}ÕÁ‘…Ñ”°Ñà¤ì(€€€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥ÐÍ½ÕÉ•MÑ…ÑÕÌ¡ìÝèÑà¹Ý°ÉÕ¹}‘¥ÈèÁ…É…µÌ¹ÉÕ¹}‘¥Èô°…É¡¥Ù•A½ÉÑÌ¤ì(€€€€€É•ÑÕÉ¸ì½¹Ñ•¹ÐèmìÑåÁ”è€‰Ñ•áÐˆ°Ñ•áÐè)M=8¹ÍÑÉ¥¹¥™ä¡É•ÍÕ±Ð°¹Õ±°°€È¤õt°‘•Ñ…¥±ÌèÉ•ÍÕ±Ðôì(€€€ô(€ô¤ì(€É•¥ÍÑ•ÉQ½½°¡Á¤°ì(€€€¹…µ”è€‰É•Í•…É¡}Ù•É¥™å}±¥Ñ•É…ÑÕÉ”ˆ°(€€€±…‰•°è€‰Y•É¥™äi½Ñ•É¼…¹=‰Í¥‘¥…¸Á…Á•È¥‘•¹Ñ¥Ñäˆ°(€€€‘É½¹”èì(€€€€€É•…‘=¹±äèÑÉÕ”°(€€€€€É•½Ù•ÉåM…™”èÑÉÕ”°(€€€€€…Á…‰¥±¥Ñ¥•Ìèl‰É•Í•…É ‰t°(€€€€€©½ÕÉ¹…°èÑÉÕ”°(€€€€€…Ñ¥Ù¥ÑäèìÑ•áÐè€‰qÔÙØÍqÔÔÜÈáqÔØàÌáqÔÕ	åqÔØÔàÝqÔÜÌÉqÔÔÍqÔÕäÍqÔá	qÔÑqÔÈÀÈØˆ°Á¡…Í”è€‰Ù•É¥™¥…Ñ¥½¸ˆô°(€€€€€™±½Üè€‰±¥Ñ•É…ÑÕÉ”ˆ°(€€€€€™±½Ý…É‘Ìè€¡•Ù•¹Ð¤€ôø±¥Ñ•É…ÑÕÉ•…É¡•Ù•¹Ð¤(€€€ô°(€€€‘•ÍÉ¥ÁÑ¥½¸è€‰I•…µ½¹±ä‘Õ…°µ±¥‰É…Éä¡•¬……¥¹ÍÐÑ¡”ÕÉÉ•¹Ð±½…°i½Ñ•É¼Á•ÉÍ½¹…°±¥‰É…Éä…¹‰½Õ¹Y…Õ±Ð¸½¹™¥ÉµÌ•á…Ð=$½­•ä½¹½Ñ”¥‘•¹Ñ¥Ñä°¹½ÐÍ¥•¹Ñ¥™¥ŒÑÉÕÑ °½É¥¥¹…°µÍ½ÕÉ”É•…‘¥¹œ°A‰åÑ•Ì°½±±•Ñ¥½¸Á±…•µ•¹Ð°½È±½ÕÍå¹Œ¸UÍ”…™Ñ•È…ÕÑ¡½É¥é•¥µÁ½ÉÐ½ÈÉ•ÕÍ”ìÕ¹…Ù…¥±…‰±”¥Ì¹½Ð…‰Í•¹Ð¸ˆ°(€€€Á…É…µ•Ñ•ÉÌèì(€€€€€ÑåÁ”è€‰½‰©•Ðˆ°(€€€€€ÁÉ½Á•ÉÑ¥•Ìèì‘½¤èìÑåÁ”è€‰ÍÑÉ¥¹œˆô°é½Ñ•É½}­•äèìÑåÁ”è€‰ÍÑÉ¥¹œˆô°¹½Ñ•}Á…Ñ èìÑåÁ”è€‰ÍÑÉ¥¹œˆôô°(€€€€€É•ÅÕ¥É•èl‰‘½¤ˆ°€‰é½Ñ•É½}­•äˆ°€‰¹½Ñ•}Á…Ñ ‰t(€€€ô°(€€€…Íå¹Œ•á•ÕÑ”¡}¥°Á…É…µÌ°Í¥¹…°°}ÕÁ‘…Ñ”°Ñà¤ì(€€€€€½¹ÍÐ½¹™¥œ€ô…Ý…¥Ð±½…‘]½É­ÍÁ…•½¹™¥œ¡Ñà¹Ý¤ì(€€€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥ÐÙ•É¥™å1¥Ñ•É…ÑÕÉ•I••¥ÁÐ¡ì€¸¸¹Á…É…µÌ°Ù…Õ±Ðè½¹™¥œ¹½‰Í¥‘¥…¹Y…Õ±Ð°Í¥¹…°ô¤ì(€€€€€É•ÑÕÉ¸ì½¹Ñ•¹ÐèmìÑåÁ”è€‰Ñ•áÐˆ°Ñ•áÐè)M=8¹ÍÑÉ¥¹¥™ä¡É•ÍÕ±Ð°¹Õ±°°€È¤õt°‘•Ñ…¥±ÌèÉ•ÍÕ±Ðôì(€€€ô(€ô¤ì(€É•¥ÍÑ•ÉQ½½°¡Á¤°ì(€€€¹…µ”è€‰É•Í•…É¡}É•½¹¥±•}±¥Ñ•É…ÑÕÉ”ˆ°(€€€±…‰•°è€‰I•½¹¥±”‘Õ…°µ±¥‰É…Éä½Á•É…Ñ¥½¸ˆ°(€€€‘É½¹”èì(€€€€€É•…‘=¹±äèÑÉÕ”°(€€€€€É•½Ù•ÉåM…™”èÑÉÕ”°(€€€€€…Á…‰¥±¥Ñ¥•Ìèl‰É•Í•…É ‰t°(€€€€€©½ÕÉ¹…°èÑÉÕ”°(€€€€€…Ñ¥Ù¥ÑäèìÑ•áÐè€‰qÔÙØÍqÔÔÜÈáqÔá		qÔÔÙqÔÔÍqÔÕäÍqÔØÔàÝqÔÜÌÉqÔá	ÁqÔÕÔÕqÔÈÀÈØˆ°Á¡…Í”è€‰Ù•É¥™¥…Ñ¥½¸ˆô°(€€€€€™±½Üè€‰±¥Ñ•É…ÑÕÉ”ˆ°(€€€€€™±½Ý…É‘Ìè€¡•Ù•¹Ð¤€ôø±¥Ñ•É…ÑÕÉ•…É¡•Ù•¹Ð¤(€€€ô°(€€€‘•ÍÉ¥ÁÑ¥½¸è€‰I•…‰…¬‰½Ñ ‘•ÍÑ¥¹…Ñ¥½¹Ì…¹Á•ÉÍ¥ÍÐ„É•ÍÕµ…‰±”Á•Èµ=$½Á•É…Ñ¥½¸±½œ¥¹Í¥‘”Ñ¡”ÉÕ¸¸9•Ù•È¥µÁ½ÉÑÌ½‘½Ý¹±½…‘Ì½ÈÝÉ¥Ñ•ÌY…Õ±Ð¹½Ñ•Ì¸Ù•É¥™¥•‘•ÍÑ¥¹…Ñ¥½¸µÕÍÐ‰”É•ÕÍ•ìÕ¹…Ù…¥±…‰±”¥Ì¹½Ð…‰Í•¹Ð¸I•ÑÕÉ¹ÌÑ¡”µ¥ÍÍ¥¹œ½½¹™±¥Ñ¥¹œ‘•ÍÑ¥¹…Ñ¥½¸…¹Í…™”¹•áÐ…Ñ¥½¸ì…ÕÑ¡½É¥é…Ñ¥½¸™½ÈÝÉ¥Ñ•Ì¥ÌÍ•Á…É…Ñ”¸ˆ°(€€€Á…É…µ•Ñ•ÉÌèì(€€€€€ÑåÁ”è€‰½‰©•Ðˆ°(€€€€€ÁÉ½Á•ÉÑ¥•Ìèì(€€€€€€€ÉÕ¹}‘¥ÈèìÑåÁ”è€‰ÍÑÉ¥¹œˆô°(€€€€€€€‘½¤èìÑåÁ”è€‰ÍÑÉ¥¹œˆô°(€€€€€€€é½Ñ•É½}­•äèìÑåÁ”è€‰ÍÑÉ¥¹œˆô°(€€€€€€€¹½Ñ•}Á…Ñ èìÑåÁ”è€‰ÍÑÉ¥¹œˆô(€€€€€ô°(€€€€€É•ÅÕ¥É•èl‰ÉÕ¹}‘¥Èˆ°€‰‘½¤ˆ°€‰é½Ñ•É½}­•äˆ°€‰¹½Ñ•}Á…Ñ ‰t(€€€ô°(€€€…Íå¹Œ•á•ÕÑ”¡}¥°À°}Í¥¹…°°}ÕÁ‘…Ñ”°Ñà¤ì(€€€€€É•ÑÕÉ¸ÉÕ¸¡…Íå¹Œ€ ¤€ôøì(€€€€€€€½¹ÍÐÙ…±Õ”€ô…Ý…¥ÐÉ•½¹¥±•1¥Ñ•É…ÑÕÉ•=Á•É…Ñ¥½¸¡ì(€€€€€€€€€ÝèÑà¹Ý°(€€€€€€€€€ÉÕ¹¥ÈèÀ¹ÉÕ¹}‘¥È°(€€€€€€€€€‘½¤èÀ¹‘½¤°(€€€€€€€€€é½Ñ•É½-•äèÀ¹é½Ñ•É½}­•ä°(€€€€€€€€€¹½Ñ•A…Ñ èÀ¹¹½Ñ•}Á…Ñ (€€€€€€€ô¤ì(€€€€€€€É•ÑÕÉ¸ì½¹Ñ•¹ÐèmìÑåÁ”è€‰Ñ•áÐˆ°Ñ•áÐè)M=8¹ÍÑÉ¥¹¥™ä¡Ù…±Õ”°¹Õ±°°€È¤õt°‘•Ñ…¥±ÌèÙ…±Õ”ôì(€€€€€ô¤ì(€€€ô(€ô¤ì(€É•¥ÍÑ•ÉQ½½°¡Á¤°ì(€€€¹…µ”è€‰É•Í•…É¡}É•½É‘}ÉÕ¹}µ…¹¥™•ÍÐˆ°(€€€±…‰•°è€‰I•½ÉÉ•ÁÉ½‘Õ¥‰¥±¥Ñäµ…¹¥™•ÍÐˆ°(€€€‘É½¹”èì…Á…‰¥±¥Ñ¥•Ìèl‰É•Í•…É ‰t°ÍÕ‰…•¹Ðè€‰•á±Õ‘”ˆô°(€€€‘•ÍÉ¥ÁÑ¥½¸è€‰I•½ÉÕÉÉ•¹Ð¡…Í¡•Ì½˜•áÁ±¥¥Ñ±äÍ•±•Ñ•ÁÉ½©•Ð™¥±•Ì…¹¡½ÍÐµ½‰Í•ÉÙ•½µµ…¹É•™•É•¹•Ì¥¸…¸•á¥ÍÑ¥¹œÉÕ¸¸½•Ì¹½Ð•á•ÕÑ”…¹…±åÍ•Ì½ÈÉ•…™¥±”½¹Ñ•¹ÑÌÑ¼Ñ¡”µ½‘•°¸¥±”¡…Í¡•Ì…É”ÕÉÉ•¹Ð½Á½ÍÐµ¡½ŒÍ¹…ÁÍ¡½ÑÌì‘•±…É…Ñ¥½¹Ì½˜Ù•ÉÍ¥½¹Ì°Á…É…µ•Ñ•ÉÌ°Í••‘Ì…¹E…É”¹½Ð¥¹‘•Á•¹‘•¹Ñ±äÙ•É¥™¥•¸9¼±¥‰É…ÉäÝÉ¥Ñ•Ì¸ˆ°(€€€Á…É…µ•Ñ•ÉÌèì(€€€€€ÑåÁ”è€‰½‰©•Ðˆ°(€€€€€ÁÉ½Á•ÉÑ¥•Ìèì(€€€€€€€ÉÕ¹}‘¥ÈèìÑåÁ”è€‰ÍÑÉ¥¹œˆô°(€€€€€€€™¥±•Ìèì(€€€€€€€€€ÑåÁ”è€‰…ÉÉ…äˆ°(€€€€€€€€€µ…á%Ñ•µÌè€ØÐ°(€€€€€€€€€¥Ñ•µÌèì(€€€€€€€€€€€ÑåÁ”è€‰½‰©•Ðˆ°(€€€€€€€€€€€ÁÉ½Á•ÉÑ¥•Ìèì(€€€€€€€€€€€€€Á…Ñ èìÑåÁ”è€‰ÍÑÉ¥¹œˆô°(€€€€€€€€€€€€€É½±”èìÑåÁ”è€‰ÍÑÉ¥¹œˆ°•¹Õ´èl‰¥¹ÁÕÐˆ°€‰½ÕÑÁÕÐˆ°€‰ÍÉ¥ÁÐˆ°€‰±½œ‰tô(€€€€€€€€€€€ô°(€€€€€€€€€€€É•ÅÕ¥É•èl‰Á…Ñ ˆ°€‰É½±”‰t(€€€€€€€€€ô(€€€€€€€ô°(€€€€€€€‘•±…É…Ñ¥½¹ÌèìÑåÁ”è€‰½‰©•Ðˆô(€€€€€ô°(€€€€€É•ÅÕ¥É•èl‰ÉÕ¹}‘¥È‰t(€€€ô°(€€€…Íå¹Œ•á•ÕÑ”¡}¥°À°}Í¥¹…°°}ÕÁ‘…Ñ”°Ñà¤ì(€€€€€½¹ÍÐÙ…±Õ”€ô…Ý…¥ÐÉ•½É‘IÕ¹AÉ½Ù•¹…¹”¡ì(€€€€€€€ÝèÑà¹Ý°(€€€€€€€ÉÕ¹¥ÈèÀ¹ÉÕ¹}‘¥È°(€€€€€€€±½…‘]½É­ÍÁ…•½¹™¥œ°(€€€€€€€™¥±•ÌèÀ¹™¥±•Ìñðmt°(€€€€€€€‘•±…É…Ñ¥½¹ÌèÀ¹‘•±…É…Ñ¥½¹Ìñðíô(€€€€€ô¤ì(€€€€€É•ÑÕÉ¸ì½¹Ñ•¹ÐèmìÑåÁ”è€‰Ñ•áÐˆ°Ñ•áÐè)M=8¹ÍÑÉ¥¹¥™ä¡Ù…±Õ”°¹Õ±°°€È¤õt°‘•Ñ…¥±ÌèÙ…±Õ”ôì(€€€ô(€ô¤ì(€É•¥ÍÑ•ÉQ½½°¡Á¤°ì(€€€¹…µ”è€‰É•Í•…É¡}µ•Ñ¡½‘Ìˆ°(€€€±…‰•°è€‰5•Ñ¡½‘ÌÍ•Ñ¥½¸ˆ°(€€€‘É½¹”èì…Á…‰¥±¥Ñ¥•Ìèl‰É•Í•…É ‰t°ÍÕ‰…•¹Ðè€‰•á±Õ‘”ˆô°(€€€‘•ÍÉ¥ÁÑ¥½¸è€‰É…™Ð„Á…Á•È5•Ñ¡½‘ÌÁ…É…É…Á ™É½´„ÉÕ¸ÌÉ•½É‘Ì¸…Ñ¥½¸õ™…ÑÌÉ•ÑÕÉ¹ÌÝ¡…ÐÑ¡”ÉÕ¸…ÑÕ…±±äÉ•½É‘•€¡¥¹ÁÕÑÌ½½ÕÑÁÕÑÌ½ÍÉ¥ÁÑÌÝ¥Ñ ¡…Í¡•Ì°‘•±…É•Í½™ÑÝ…É”Ù•ÉÍ¥½¹Ì°Á…É…µ•Ñ•ÉÌ…¹½µÁÕÑ”µ½‘Õ±•Ì°•á•ÕÑ•µ½µµ…¹½Õ¹ÑÌ°…ÁÌ¤¸]É¥Ñ”Ñ¡”Á…É…É…Á ½¹±ä™É½´Ñ¡½Í”™…ÑÌqÔÈÀÄÐ¹•Ù•È¥¹Ù•¹ÐÙ•ÉÍ¥½¹Ì°Á…É…µ•Ñ•ÉÌ½ÈÑ¡É•Í¡½±‘Ìì¹…µ”µ¥ÍÍ¥¹œ½¹•Ì…Ì…ÁÌ½È…Í¬Ñ¡”ÕÍ•È¸…Ñ¥½¸õÍ…Ù”Í¡½ÝÌÑ¡”‘É…™ÐÑ¼Ñ¡”ÕÍ•È…¹ÝÉ¥Ñ•Ì5Q!=L¹µ¥¸Ñ¡”ÉÕ¸½¹±ä¥˜Ñ¡•ä…ÁÁÉ½Ù”¸ˆ°(€€€Á…É…µ•Ñ•ÉÌèì(€€€€€ÑåÁ”è€‰½‰©•Ðˆ°(€€€€€ÁÉ½Á•ÉÑ¥•Ìèì(€€€€€€€ÉÕ¹}‘¥ÈèìÑåÁ”è€‰ÍÑÉ¥¹œˆ°‘•ÍÉ¥ÁÑ¥½¸è€‰á¥ÍÑ¥¹œÉÕ¸‘¥É•Ñ½Éä¥¹Í¥‘”Ñ¡”É•ÍÕ±ÑÌÉ½½Ðˆô°(€€€€€€€…Ñ¥½¸èìÑåÁ”è€‰ÍÑÉ¥¹œˆ°•¹Õ´èl‰™…ÑÌˆ°€‰Í…Ù”‰tô°(€€€€€€€Ñ•áÐèì(€€€€€€€€€ÑåÁ”è€‰ÍÑÉ¥¹œˆ°(€€€€€€€€€µ…á1•¹Ñ è€É”Ð°(€€€€€€€€€‘•ÍÉ¥ÁÑ¥½¸è€‰Í…Ù”èÑ¡”5•Ñ¡½‘ÌÁ…É…É…Á ¡Ì¤Ñ¼Í¡½ÜÑ¡”ÕÍ•Èˆ(€€€€€€€ô(€€€€€ô°(€€€€€É•ÅÕ¥É•èl‰ÉÕ¹}‘¥Èˆ°€‰…Ñ¥½¸‰t(€€€ô°(€€€…Íå¹Œ•á•ÕÑ”¡}¥°À°Í¥¹…°°}ÕÁ‘…Ñ”°Ñà¤ì(€€€€€¥˜€¡À¹…Ñ¥½¸€ôôô€‰™…ÑÌˆ¤ì(€€€€€€€½¹ÍÐ™…ÑÌ€ô…Ý…¥ÐÉ•…‘5•Ñ¡½‘Í…ÑÌ¡ìÝèÑà¹Ý°ÉÕ¹¥ÈèÀ¹ÉÕ¹}‘¥È°±½…‘]½É­ÍÁ…•½¹™¥œô¤ì(€€€€€€€É•ÑÕÉ¸ì½¹Ñ•¹ÐèmìÑåÁ”è€‰Ñ•áÐˆ°Ñ•áÐè)M=8¹ÍÑÉ¥¹¥™ä¡™…ÑÌ°¹Õ±°°€È¤õt°‘•Ñ…¥±Ìè™…ÑÌôì(€€€€€ô(€€€€€½¹ÍÐ‘É…™Ð€ôMÑÉ¥¹œ¡À¹Ñ•áÐñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€€€¥˜€ …‘É…™Ð¤Ñ¡É½Ü¹•ÜÉÉ½È ‰Í…Ù”¹••‘ÌÑ¡”5•Ñ¡½‘ÌÑ•áÐˆ¤ì(€€€€€¥˜€ …Ñà¹¡…ÍU$ñð€…Ñà¹Õ¤ü¹Í•±•Ð¤(€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰M…Ù¥¹œ„5•Ñ¡½‘ÌÍ•Ñ¥½¸¹••‘ÌÑ¡”ÕÍ•ÈÌ½¹™¥Éµ…Ñ¥½¸¥¸Ñ¡”‘•Í­Ñ½À…ÁÀˆ¤ì(€€€€€½¹ÍÐ…ÁÁÉ½Ù”€ô€‰qÔÑqÔÕÔáqÔÔÈÌÁqÔáÁqÔààÑqÔÜÙqÔÕÔÕqÕÀá5Q!=L¹µ‘qÕÀäˆì(€€€€€½¹ÍÐ¡½¥”€ô…Ý…¥ÐÑà¹Õ¤¹Í•±•Ð (€€€€€€€qÔÜàÙqÔá	Ð5•Ñ¡½‘ÌqÔÙ	Ô((‘í‘É…™Ð¹Í±¥” À°€Ù”Ì¥ô‘í‘É…™Ð¹±•¹Ñ €ø€Ù”Ì€ü€‰q¹qÔÈÀÈØˆ€è€ˆ‰ô()qÔÜÈÐáqÔØÜÉqÔÑÁqÔÔÍÉqÔØÔÜÁqÔØÜØÕqÔàÅqÔáÁqÔààÑqÔá	ÁqÔÕÔÕqÔÑÉqÔÜØàÑqÔÔáÁqÔØØÁqÕÁqÔØÜÉqÔÝqÔÜÉqÔÝ	qÔåáqÔá	ÅqÔÌÀÀÉqÔäÜÀÁqÔàäàÅqÔÑqÔØÔÌåqÔá	ÝqÔäÀÀåqÔÌÀÁqÔÔÄÐáqÔÑÁqÔÑqÔÕÔáqÔÌÀÁqÔÕÜÙqÔÔÜÈáqÔÕ	åqÔá	qÔäÅqÔá	ÑqÔØØÁqÔÌÀÀÉ€°(€€€€€€€m…ÁÁÉ½Ù”°€‰qÔÔÄÐáqÔÑÁqÔÑqÔÕÔà‰t°(€€€€€€€ìÍ¥¹…°ô(€€€€€€¤ì(€€€€€¥˜€¡¡½¥”€„ôô…ÁÁÉ½Ù”¤ì(€€€€€€€½¹ÍÐÙ…±Õ”È€ôìÍ…Ù•è™…±Í”°É•…Í½¸è€‰ÕÍ•È‘¥¹½Ð…ÁÁÉ½Ù”ˆôì(€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€½¹Ñ•¹Ðèl(€€€€€€€€€€€ì(€€€€€€€€€€€€€ÑåÁ”è€‰Ñ•áÐˆ°(€€€€€€€€€€€€€Ñ•áÐè€‰Q¡”ÕÍ•È‘¥¹½Ð…ÁÁÉ½Ù”Ñ¡¥Ì5•Ñ¡½‘Ì‘É…™Ðì¹½Ñ¡¥¹œÝ…ÌÝÉ¥ÑÑ•¸¸Í¬Ý¡…ÐÑ¼¡…¹”¸ˆ(€€€€€€€€€€€ô(€€€€€€€€€t°(€€€€€€€€€‘•Ñ…¥±ÌèÙ…±Õ”È(€€€€€€€ôì(€€€€€ô(€€€€€½¹ÍÐÙ…±Õ”€ôì(€€€€€€€Í…Ù•èÑÉÕ”°(€€€€€€€€¸¸¹…Ý…¥ÐÍ…Ù•5•Ñ¡½‘ÍM•Ñ¥½¸¡ìÝèÑà¹Ý°ÉÕ¹¥ÈèÀ¹ÉÕ¹}‘¥È°Ñ•áÐè‘É…™Ð°±½…‘]½É­ÍÁ…•½¹™¥œô¤(€€€€€ôì(€€€€€É•ÑÕÉ¸ì(€€€€€€€½¹Ñ•¹ÐèmìÑåÁ”è€‰Ñ•áÐˆ°Ñ•áÐèM…Ù•Ñ¡”…ÁÁÉ½Ù•5•Ñ¡½‘ÌÍ•Ñ¥½¸Ñ¼€‘íÙ…±Õ”¹Á…Ñ¡ô¹€õt°(€€€€€€€‘•Ñ…¥±ÌèÙ…±Õ”(€€€€€ôì(€€€ô(€ô¤ì(€Á¤¹½¸ ‰‰•™½É•}…•¹Ñ}ÍÑ…ÉÐˆ°…Íå¹Œ€¡•Ù•¹Ð¤€ôø€¡ì(€€€ÍåÍÑ•µAÉ½µÁÐè€‘í•Ù•¹Ð¹ÍåÍÑ•µAÉ½µÁÑô()É¡¥Ù”Á…Á•ÉÌ°µ…¹Õ…±Ì…¹Í½™ÑÝ…É”Ý¥Ñ É•Í•…É¡}…É¡¥Ù•}Í½ÕÉ”¥¹Ñ¼Ñ¡”…Ñ¥Ù”ÉÕ¸¸½ÈÁ…Á•ÉÌÁ…ÍÌÑ¡”=$…¹±•ÐÑ¡”¡½ÍÐÉ•Í½±Ù”„±•¥Ñ¥µ…Ñ”½Á•¸µ…•ÍÌAì¹½}½Á•¹}…•ÍÌµ•…¹Ì…‰ÍÑÉ…Ðµ½¹±äÕ¹±•ÍÌÑ¡”ÕÍ•ÈÍÕÁÁ±¥•ÌÑ¡”™¥±”Ñ¡É½Õ Ñ¡•¥È½Ý¸…•ÍÌ¸¼¹½Ð¥¹Ù•¹Ð¥Ñ…Ñ¥½¹Ì½ÈÑÉ•…Ð‰É½ÝÍ•É}É•ÅÕ¥É•½™…¥±•½¹½}½Á•¹}…•ÍÌ‘½Ý¹±½…‘Ì…Ì•Ù¥‘•¹”¸€‘íUMI}EUMQ%=9}=UMõ€(€ô¤¤ì)ô)•áÁ½ÉÐì(€Í½ÕÉ•É¡¥Ù”…Ì‘•™…Õ±Ð)ôì(