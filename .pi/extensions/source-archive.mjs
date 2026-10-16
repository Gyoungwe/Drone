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
    requiresPaperEvidence = (query) => /paper|literature|article|文献|论文/i.test(query);
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
    if (!callback(value[index], 