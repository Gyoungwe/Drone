var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};

// packages/knowledge/src/claim-conflicts.ts
var init_claim_conflicts = __esm({
  "packages/knowledge/src/claim-conflicts.ts"() {
    "use strict";
  }
});

// packages/knowledge/src/config.ts
import { AsyncLocalStorage } from "node:async_hooks";
import { basename, isAbsolute, join, resolve } from "node:path";
function createKnowledgeConfigState() {
  return { local: new AsyncLocalStorage(), queues: /* @__PURE__ */ new Map() };
}
function knowledgeDirectory() {
  const value = process.env.DRONE_KNOWLEDGE_DIR;
  if (!value) return null;
  if (!isAbsolute(value)) throw new Error("DRONE_KNOWLEDGE_DIR must be absolute");
  return resolve(value);
}
var defaultState;
var init_config = __esm({
  "packages/knowledge/src/config.ts"() {
    "use strict";
    defaultState = createKnowledgeConfigState();
  }
});

// packages/knowledge/src/files.ts
import { isAbsolute as isAbsolute2, join as join2, relative, sep } from "node:path";
function allowedSegment(name) {
  return !!name && !name.startsWith(".") && !OMIT.has(name) && !/^(?:secrets?|credentials?|id_rsa|id_ed25519)(?:[.\-_]|$)/i.test(name);
}
function validateNote(path) {
  if (typeof path !== "string" || isAbsolute2(path) || path.includes("\\") || !path.endsWith(".md") || !path.split("/").every(allowedSegment))
    throw new Error("Expected an allowed Vault-relative Markdown path");
  const first = path.split("/")[0] ?? "";
  if (RESERVED.some((name) => name.toLowerCase() === first.toLowerCase() && name !== first))
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
var MAX_NOTE_BYTES, OMIT, RESERVED;
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
    RESERVED = ["Projects", "Library", "Wiki", "Attachments", "Templates", "Indexes", "Inbox"];
  }
});

// packages/knowledge/src/flow-cards.ts
var init_flow_cards = __esm({
  "packages/knowledge/src/flow-cards.ts"() {
    "use strict";
  }
});

// packages/knowledge/src/review-policy.ts
var init_review_policy = __esm({
  "packages/knowledge/src/review-policy.ts"() {
    "use strict";
    init_config();
  }
});

// packages/knowledge/src/runtime-host.ts
function runtimeSlot(domain, key, factory) {
  let hostProxy;
  let provider;
  const resolve3 = () => {
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
      const state5 = resolve3();
      const value = Reflect.get(state5, property);
      return typeof value === "function" ? value.bind(state5) : value;
    },
    set: (_target, property, value) => Reflect.set(resolve3(), property, value),
    ownKeys: () => Reflect.ownKeys(resolve3()),
    getOwnPropertyDescriptor: (_target, property) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(resolve3(), property);
      return descriptor ? { ...descriptor, configurable: true } : void 0;
    }
  });
}
function diagnosticText(value, limit = 4096) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).slice(0, 8192).replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
    try {
      const url = new URL(raw);
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return "[URL omitted]";
    }
  }).replace(/(?:bearer\s+)[^\s,;"']+/gi, "Bearer [redacted]").replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|authorization|cookie)["']?\s*[=:]\s*)(?:"[^"]*(?:"|$)|'[^']*(?:'|$)|[^\s,;]+)/gi, "$1[redacted]").replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{8,}/g, "[redacted]").replace(/[\u0000-\u001f\u007f<>]/g, " ").slice(0, Math.max(0, limit));
}
var processEvent, hostSlotProvider, emitProcessEvent, slots, layoutDefinition, LAYOUT;
var init_runtime_host = __esm({
  "packages/knowledge/src/runtime-host.ts"() {
    "use strict";
    processEvent = () => void 0;
    emitProcessEvent = (event, payload) => processEvent(event, payload);
    slots = /* @__PURE__ */ new Map();
    layoutDefinition = { templates: {}, noteTemplate: "" };
    LAYOUT = new Proxy({}, {
      get: (_target, key) => layoutDefinition[key]
    });
  }
});

// packages/knowledge/src/topic-memory.ts
import { createHash, randomUUID as randomUUID2 } from "node:crypto";
import { dirname as dirname2, isAbsolute as isAbsolute3, join as join4, relative as relative2, resolve as resolve2, sep as sep2 } from "node:path";
function validateSource(source, project = null) {
  if (!source || typeof source !== "object" || typeof source.path !== "string" || isAbsolute3(source.path) || source.path.includes("\\") || source.path.split("/").includes("..") || !/^[^\0]+\.md$/.test(source.path) || source.path.length > 240 || /(?:^|\/)(?:Runs|Explainers)\//i.test(source.path) || !/^[a-f0-9]{64}$/.test(source.hash || ""))
    return null;
  try {
    validateNote(source.path);
  } catch {
    return null;
  }
  if (project && !canRead(source.path, project)) return null;
  return { path: source.path, hash: source.hash };
}
function topicRunHash(summary, sources = []) {
  return digest(
    JSON.stringify({
      summary: text(summary, TOPIC_MEMORY_LIMITS.maxSummaryChars),
      sources: sources.map(validateSource).filter(Boolean).sort((a, b) => a.path.localeCompare(b.path) || a.hash.localeCompare(b.hash))
    })
  );
}
var TOPIC_MEMORY_LIMITS, digest, text;
var init_topic_memory = __esm({
  "packages/knowledge/src/topic-memory.ts"() {
    "use strict";
    init_runtime_host();
    init_claim_conflicts();
    init_config();
    init_files();
    TOPIC_MEMORY_LIMITS = Object.freeze({
      maxTopics: 64,
      maxSummaryChars: 4e3,
      maxContextChars: 2400,
      maxEntities: 24,
      maxQuestions: 16,
      maxSources: 24,
      maxArtifacts: 12,
      maxHistory: 8,
      maxRecentRuns: 12,
      maxClaims: 64,
      maxConflicts: 32,
      maxFileBytes: 512 * 1024
    });
    digest = (value) => createHash("sha256").update(String(value)).digest("hex");
    text = (value, limit) => String(value ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit);
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
var state, UI_EVENT, uiModule, MAX_SESSIONS;
var init_ui_state = __esm({
  "packages/knowledge/src/ui-state.ts"() {
    "use strict";
    init_runtime_host();
    init_runtime_host();
    init_runtime_host();
    init_flow_cards();
    state = runtimeSlot("knowledge", "ui", () => ({ listeners: /* @__PURE__ */ new Set(), flows: /* @__PURE__ */ new Map(), seq: 0 }));
    UI_EVENT = "drone:knowledge-ui/v1";
    uiModule = {};
    process.on(UI_EVENT, (payload) => {
      if (!payload || payload.origin === uiModule || !payload.event) return;
      deliverKnowledgeUi(payload.event);
    });
    MAX_SESSIONS = 64;
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

// packages/knowledge/src/specialist-host.ts
var state3, HOST_EVENT, hostModule, SPECIALIST_LIMITS;
var init_specialist_host = __esm({
  "packages/knowledge/src/specialist-host.ts"() {
    "use strict";
    init_runtime_host();
    init_runtime_host();
    init_config();
    init_ui_state();
    state3 = runtimeSlot("knowledge", "specialists", () => ({
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
        state3.hosts.set(payload.id, payload.run);
      if (payload.action === "unregister" && state3.hosts.get(payload.id) === payload.run)
        state3.hosts.delete(payload.id);
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
  }
});

// packages/knowledge/src/wiki-model-review.ts
var state4;
var init_wiki_model_review = __esm({
  "packages/knowledge/src/wiki-model-review.ts"() {
    "use strict";
    init_runtime_host();
    init_config();
    init_files();
    init_specialist_host();
    init_runtime_host();
    init_wiki_review();
    state4 = runtimeSlot("knowledge", "wikiModelReview", () => ({ active: /* @__PURE__ */ new Set() }));
  }
});

// packages/research/src/run-summary.ts
import { createHash as createHash3 } from "node:crypto";

// packages/knowledge/src/index.ts
init_claim_conflicts();
init_config();

// packages/knowledge/src/extension-helpers.ts
init_config();

// packages/knowledge/src/index.ts
init_files();
init_flow_cards();

// packages/knowledge/src/layout.ts
init_files();

// packages/knowledge/src/publication-policy.ts
var publicationNotices = {
  "paper-citation-required": "\u672C\u6B21\u7814\u7A76\u56DE\u7B54\u7F3A\u5C11\u5177\u4F53\u8BBA\u6587\u4F9D\u636E\uFF1BWiki \u6216\u62A5\u544A\u94FE\u63A5\u4E0D\u80FD\u66FF\u4EE3\u672C\u8F6E\u8BFB\u8FC7\u7684\u6587\u732E\u7B14\u8BB0\u3002\u8BF7\u6807\u660E\u8BC1\u636E\u7F3A\u53E3\uFF0C\u4E0D\u8981\u53CD\u590D\u68C0\u7D22\u53EA\u4E3A\u6D88\u9664\u63D0\u9192\u3002",
  "search-required": "\u672C\u8F6E\u5C1A\u672A\u5B8C\u6210\u77E5\u8BC6\u5E93\u68C0\u7D22\u3002\u8BF7\u5148\u68C0\u7D22\uFF0C\u518D\u9605\u8BFB\u9700\u8981\u5F15\u7528\u7684\u5185\u5BB9\u3002",
  "coverage-incomplete": "\u77E5\u8BC6\u7D22\u5F15\u5C1A\u672A\u5B8C\u6574\u53EF\u7528\u3002\u8BF7\u68C0\u67E5\u7D22\u5F15\u72B6\u6001\u6216\u6545\u969C\uFF0C\u4E0D\u80FD\u5C06\u6B64\u60C5\u51B5\u5F53\u4F5C\u65E0\u547D\u4E2D\u3002",
  "citation-required": "\u68C0\u7D22\u6709\u547D\u4E2D\uFF0C\u4F46\u56DE\u7B54\u6CA1\u6709\u5F15\u7528\u672C\u8F6E\u8BFB\u8FC7\u7684\u77E5\u8BC6\u6761\u76EE\u3002",
  "citation-invalid": "\u56DE\u7B54\u4E2D\u7684\u77E5\u8BC6\u5E93\u5F15\u7528\u683C\u5F0F\u4E0D\u5408\u6CD5\u3002",
  "citation-budget": "\u672C\u6B21\u56DE\u7B54\u7684\u5F15\u7528\u8D85\u8FC7\u68C0\u67E5\u4E0A\u9650\uFF0C\u8BF7\u62C6\u5206\u4E3A\u66F4\u5C0F\u7684\u56DE\u7B54\u3002",
  "source-unread": "\u56DE\u7B54\u5F15\u7528\u4E86\u672C\u8F6E\u6CA1\u6709\u5B9E\u9645\u9605\u8BFB\u7684\u6761\u76EE\u3002",
  "delivery-changed": "\u672C\u8F6E\u751F\u6210\u7684\u4EA7\u7269\u5728\u4FDD\u5B58\u540E\u53D1\u751F\u53D8\u5316\uFF0C\u4E0D\u80FD\u6CBF\u7528\u65E7\u7684\u4EA7\u7269\u56DE\u6267\u3002",
  "source-changed": "\u5F15\u7528\u5185\u5BB9\u5728\u9605\u8BFB\u540E\u53D1\u751F\u4E86\u53D8\u5316\uFF0C\u8BF7\u8BFB\u53D6\u65B0\u7248\u672C\u5E76\u91CD\u65B0\u68C0\u7D22\u3002",
  "wiki-changed": "\u76F8\u5173 Wiki \u5DF2\u53D8\u5316\uFF0C\u8BF7\u8BFB\u53D6\u5F53\u524D\u7248\u672C\u540E\u91CD\u65B0\u68C0\u7D22\u3002",
  "search-stale": "\u68C0\u7D22\u540E\u7D22\u5F15\u7248\u672C\u53D1\u751F\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u68C0\u7D22\u5F53\u524D\u5185\u5BB9\u3002",
  "binding-changed": "\u5F53\u524D\u77E5\u8BC6\u5E93\u7ED1\u5B9A\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u8BFB\u53D6\u5BFC\u822A\uFF0C\u4E0D\u6CBF\u7528\u65E7\u77E5\u8BC6\u5E93\u7684\u8BC1\u636E\u3002",
  "navigation-changed": "\u672C\u8F6E\u5BFC\u822A\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u8BFB\u53D6\u5BFC\u822A\u5E76\u5B8C\u6210\u68C0\u7D22\u3002",
  "not-prepared": "\u77E5\u8BC6\u5E93\u51C6\u5907\u6B65\u9AA4\u5C1A\u672A\u5B8C\u6210\uFF0C\u56DE\u7B54\u6CA1\u6709\u53D1\u5E03\u3002",
  interrupted: "\u672C\u6B21\u8BF7\u6C42\u5DF2\u4E2D\u65AD\uFF0C\u672A\u5B8C\u6210\u7684\u56DE\u7B54\u6CA1\u6709\u53D1\u5E03\u3002",
  "model-error": "\u6A21\u578B\u8BF7\u6C42\u5931\u8D25\uFF0C\u672A\u5B8C\u6210\u7684\u56DE\u7B54\u6CA1\u6709\u53D1\u5E03\u3002",
  "check-timeout": "\u56DE\u7B54\u524D\u68C0\u67E5\u8D85\u65F6\uFF0C\u8349\u7A3F\u6CA1\u6709\u53D1\u5E03\u3002",
  "check-failed": "\u56DE\u7B54\u524D\u68C0\u67E5\u53D1\u751F\u9519\u8BEF\uFF0C\u8349\u7A3F\u6CA1\u6709\u53D1\u5E03\u3002",
  "empty-answer": "\u4EFB\u52A1\u5DF2\u7ED3\u675F\uFF0C\u4F46\u6A21\u578B\u6CA1\u6709\u751F\u6210\u53EF\u663E\u793A\u7684\u56DE\u590D\u3002\u8BF7\u67E5\u770B\u672C\u8F6E\u4EA7\u7269\u6216\u8981\u6C42\u7EE7\u7EED\u4EA4\u4ED8\u8BF4\u660E\u3002",
  "answer-too-large": "\u672C\u6B21\u56DE\u7B54\u8D85\u51FA\u5355\u6B21\u68C0\u67E5\u7684\u5927\u5C0F\u4E0A\u9650\uFF0C\u8BF7\u5206\u6BB5\u5B8C\u6210\u3002",
  "protocol-budget": "\u672C\u8F6E\u5DE5\u5177\u4E0A\u4E0B\u6587\u8D85\u8FC7\u5B89\u5168\u7F13\u5B58\u4E0A\u9650\uFF0C\u8BF7\u5F00\u542F\u65B0\u4E00\u8F6E\u4EFB\u52A1\u3002",
  "tool-loop-stopped": "\u3010\u4EFB\u52A1\u9636\u6BB5\u5DF2\u6682\u505C\u3011\u672C\u9636\u6BB5\u8FBE\u5230\u5DE5\u5177\u6216\u4E0A\u4E0B\u6587\u5B89\u5168\u9884\u7B97\u3002\u5DF2\u4FDD\u5B58\u7684\u7ED3\u679C\u4E0D\u4F1A\u56E0\u6B64\u5220\u9664\uFF1B\u67E5\u770B\u4EFB\u52A1\u6267\u884C\u8BB0\u5F55\u540E\u53EF\u7EE7\u7EED\uFF0C\u65E0\u9700\u65B0\u5EFA\u5BF9\u8BDD\u3002\u7EE7\u7EED\u524D\u5148\u6838\u5BF9\u7ED3\u679C\u672A\u77E5\u7684\u64CD\u4F5C\uFF0C\u4E0D\u8981\u91CD\u590D\u5B89\u88C5\u3001\u5BFC\u5165\u6216\u4E0A\u4F20\u3002",
  "metacognitive-inconsistency": "\u62A5\u544A\u3001\u65B9\u6CD5\u3001\u8BC1\u636E\u6807\u7B7E\u6216\u8BCA\u65AD\u4E0E\u5BBF\u4E3B\u89C2\u5BDF\u4E0D\u4E00\u81F4\uFF1B\u8349\u7A3F\u6CA1\u6709\u53D1\u5E03\u3002\u8BF7\u6309\u4E0B\u9762\u7684\u5DEE\u5F02\u4FEE\u6B63\u62A5\u544A\u6216\u91CD\u65B0\u8FD0\u884C\u5F53\u524D\u5DE5\u4F5C\u6D41\u3002",
  "artifact-pending-review": "\u5F15\u7528\u7684\u4EA7\u7269\u6B63\u5728\u7B49\u5F85\u590D\u6838\uFF1B\u8349\u7A3F\u6CA1\u6709\u53D1\u5E03\u3002\u8BF7\u91CD\u65B0\u751F\u6210\u53D7\u5F71\u54CD\u4EA7\u7269\u6216\u5B8C\u6210\u73B0\u6709\u5BA1\u6838\u3002"
};

// packages/knowledge/src/index.ts
init_review_policy();

// packages/knowledge/src/semantic-provider.ts
var MAX_BATCH = 32;
var MAX_CHARS = 12e4;
var MAX_RESPONSE = 8 * 1024 * 1024;
var semanticLimits = Object.freeze({ MAX_BATCH, MAX_CHARS, MAX_RESPONSE });

// packages/knowledge/src/semantic-settings.ts
init_config();
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join as join3 } from "node:path";
var MAX_FILE_BYTES = 256 * 1024;
var ENV_NAME = /^[A-Z_][A-Z0-9_]{0,127}$/;
var SETTINGS_KEYS = /* @__PURE__ */ new Set([
  "version",
  "revision",
  "updatedAt",
  "enabled",
  "provider",
  "baseUrl",
  "model",
  "credentialEnv",
  "remoteConsent",
  "timeoutMs",
  "chunkChars",
  "minSimilarity"
]);
var CONFIG_KEYS = /* @__PURE__ */ new Set([
  "enabled",
  "provider",
  "baseUrl",
  "model",
  "credentialEnv",
  "remoteConsent",
  "timeoutMs",
  "chunkChars",
  "minSimilarity"
]);
function loopback(hostname) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
}
function validateSemanticConfig(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Semantic settings must be an object");
  for (const key of Object.keys(input))
    if (!CONFIG_KEYS.has(key)) throw new Error(`Unknown semantic setting: ${key}`);
  if (input.enabled !== void 0 && typeof input.enabled !== "boolean")
    throw new Error("enabled must be boolean");
  if (input.provider !== void 0 && typeof input.provider !== "string")
    throw new Error("provider must be a string");
  const provider = input.provider ?? "none";
  if (!["none", "ollama", "openai-compatible"].includes(provider))
    throw new Error("Unknown semantic provider");
  if (input.remoteConsent !== void 0 && typeof input.remoteConsent !== "boolean")
    throw new Error("remoteConsent must be boolean");
  if (input.timeoutMs !== void 0 && (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 500 || input.timeoutMs > 3e4))
    throw new Error("timeoutMs must be an integer between 500 and 30000");
  if (input.chunkChars !== void 0 && (!Number.isInteger(input.chunkChars) || input.chunkChars < 256 || input.chunkChars > 8e3))
    throw new Error("chunkChars must be an integer between 256 and 8000");
  if (input.minSimilarity !== void 0 && (typeof input.minSimilarity !== "number" || !Number.isFinite(input.minSimilarity) || input.minSimilarity < 0 || input.minSimilarity > 1))
    throw new Error("minSimilarity must be a finite number between 0 and 1");
  const enabled = input.enabled ?? provider !== "none";
  const baseUrl = input.baseUrl === void 0 ? "" : input.baseUrl;
  const model = input.model === void 0 ? "" : input.model;
  const credentialEnv = input.credentialEnv === void 0 || input.credentialEnv === null ? "" : input.credentialEnv;
  if (typeof baseUrl !== "string" || typeof model !== "string" || typeof credentialEnv !== "string")
    throw new Error("Semantic provider fields must be strings");
  const trimmedBase = baseUrl.trim();
  const trimmedModel = model.trim();
  const trimmedCredential = credentialEnv.trim();
  if (provider === "none") {
    if (enabled) throw new Error("The none provider cannot be enabled");
    if (input.remoteConsent === true) throw new Error("remoteConsent is not valid for the none provider");
    return {
      enabled: false,
      provider: "none",
      baseUrl: "",
      model: "",
      credentialEnv: "",
      remoteConsent: false
    };
  }
  if (!enabled && !trimmedBase && !trimmedModel)
    return {
      enabled: false,
      provider,
      baseUrl: "",
      model: "",
      credentialEnv: trimmedCredential,
      remoteConsent: input.remoteConsent === true,
      timeoutMs: input.timeoutMs ?? 1e4,
      chunkChars: input.chunkChars ?? 1200,
      minSimilarity: input.minSimilarity ?? 0.45
    };
  if (!trimmedBase || trimmedBase.length > 500 || !trimmedModel || trimmedModel.length > 200)
    throw new Error("Semantic provider base URL and model are required");
  if (trimmedCredential && !ENV_NAME.test(trimmedCredential))
    throw new Error("credentialEnv must be a valid environment variable name");
  let url;
  try {
    url = new URL(trimmedBase);
  } catch {
    throw new Error("Semantic provider base URL is invalid");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error("Semantic provider URL must be plain http(s) without credentials, query, or fragment");
  const remote = !loopback(url.hostname);
  if (remote && url.protocol === "http:") throw new Error("Remote semantic providers require HTTPS");
  if (remote && input.remoteConsent !== true)
    throw new Error("Remote semantic provider requires explicit remoteConsent");
  if (remote && !trimmedCredential)
    throw new Error("Remote semantic providers require a credential environment variable");
  return {
    enabled,
    provider,
    baseUrl: url.toString().replace(/\/+$/, ""),
    model: trimmedModel,
    credentialEnv: trimmedCredential,
    remoteConsent: input.remoteConsent === true,
    timeoutMs: input.timeoutMs ?? 1e4,
    chunkChars: input.chunkChars ?? 1200,
    minSimilarity: input.minSimilarity ?? 0.45
  };
}
function createSemanticSettingsState() {
  return { defaultUpdatedAt: /* @__PURE__ */ new Map() };
}
function pathFor(vaultId) {
  if (!/^[a-f0-9]{24}$/.test(vaultId || "")) throw new Error("Invalid Vault binding");
  const directory = knowledgeDirectory();
  if (!directory) throw new Error("Application knowledge directory is not configured");
  return join3(directory, vaultId, "semantic.json");
}
async function assertDirectory(path) {
  try {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Semantic settings path is unsafe");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await mkdir(path, { recursive: true, mode: 448 });
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Semantic settings path is unsafe");
  }
  let ancestor = path;
  for (let depth = 0; depth < 8 && ancestor !== dirname(ancestor); depth++) {
    try {
      if ((await lstat(ancestor)).isSymbolicLink()) throw new Error("Semantic settings ancestor is unsafe");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    ancestor = dirname(ancestor);
  }
}
async function assertFile(path) {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES)
      throw new Error("Semantic settings file is unsafe or too large");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
function normalize(value, revision, updatedAt = null) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1)
    throw new Error("Invalid or future semantic settings schema");
  for (const key of Object.keys(value))
    if (!SETTINGS_KEYS.has(key)) throw new Error(`Unknown semantic setting: ${key}`);
  if (!Number.isSafeInteger(revision) || Number(revision) < 0)
    throw new Error("Invalid semantic settings revision");
  const raw = value;
  const config = validateSemanticConfig({
    enabled: raw.enabled,
    provider: raw.provider,
    baseUrl: raw.baseUrl,
    model: raw.model,
    credentialEnv: raw.credentialEnv,
    remoteConsent: raw.remoteConsent,
    timeoutMs: raw.timeoutMs,
    chunkChars: raw.chunkChars,
    minSimilarity: raw.minSimilarity
  });
  if (updatedAt !== null && (typeof updatedAt !== "string" || Number.isNaN(Date.parse(updatedAt))))
    throw new Error("Invalid semantic settings updatedAt");
  return {
    version: 1,
    revision: Number(revision),
    ...config,
    updatedAt: updatedAt ?? (/* @__PURE__ */ new Date()).toISOString()
  };
}
function defaultSettings(state5, path) {
  const updatedAt = state5.defaultUpdatedAt.get(path) || (/* @__PURE__ */ new Date()).toISOString();
  state5.defaultUpdatedAt.set(path, updatedAt);
  return { version: 1, revision: 0, ...validateSemanticConfig({}), updatedAt };
}
async function readUnlocked(state5, path) {
  await assertDirectory(dirname(path));
  await assertFile(path);
  try {
    const raw = await readFile(path, { encoding: "utf8", flag: "r" });
    if (Buffer.byteLength(raw) > MAX_FILE_BYTES) throw new Error("Semantic settings file is too large");
    const value = JSON.parse(raw);
    return normalize(value, value.revision, value.updatedAt);
  } catch (error) {
    if (error.code === "ENOENT") return defaultSettings(state5, path);
    if (error instanceof SyntaxError) throw new Error("Semantic settings cannot be read: invalid JSON");
    throw new Error(
      `Semantic settings cannot be read: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
function createSemanticSettingsApi(state5 = createSemanticSettingsState()) {
  return {
    readSemanticSettings: async (vaultId) => readUnlocked(state5, pathFor(vaultId)),
    saveSemanticSettings: async (vaultId, input, expectedRevision) => {
      const path = pathFor(vaultId);
      const current = await readUnlocked(state5, path);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.revision)
        throw new Error("Semantic settings revision is stale");
      const value = normalize({ version: 1, ...input }, current.revision + 1);
      const dir = dirname(path);
      await assertDirectory(dir);
      for (const entry of await readdir(dir))
        if (/^semantic\.[a-f0-9-]+\.tmp$/.test(entry)) await unlink(join3(dir, entry)).catch(() => {
        });
      const temp = join3(dir, `semantic.${randomUUID()}.tmp`);
      try {
        await writeFile(temp, `${JSON.stringify(value, null, 2)}
`, { mode: 384, flag: "wx" });
        await rename(temp, path);
      } finally {
        await unlink(temp).catch(() => {
        });
      }
      return value;
    }
  };
}
var defaultApi = createSemanticSettingsApi();

// packages/knowledge/src/topic-candidate.ts
function titleFromSummary(summary, query, resultSlug) {
  const heading = summary.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const fallback = (String(query || "").split(/[\n。]/)[0] ?? "").trim();
  const slug2 = String(resultSlug || "research-topic").replace(/[-_]20\d{6,14}$/, "").replace(/[-_]+/g, " ").trim();
  return (heading || fallback || slug2 || "Research topic").slice(0, 180);
}
function fileStem(resultSlug, title) {
  let value = String(resultSlug || "").replace(/[-_]20\d{6,14}$/, "").trim();
  if (!value || value === "research-question") value = String(title || "research-topic");
  value = [...value.normalize("NFKC")].map((char) => char.charCodeAt(0) < 32 || '\\/[]#|<>:"*?'.includes(char) ? "-" : char).join("").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^[.\- ]+|[.\- ]+$/g, "").slice(0, 120);
  return value || "research-topic";
}
function autoTopicCandidate({
  summary,
  query,
  resultSlug,
  sourcePaths = []
} = {}) {
  const markdown = String(summary || "").trim();
  if (markdown.length < 160) return { eligible: false, reason: "summary-too-short" };
  if (markdown.length > 24e3) return { eligible: false, reason: "summary-too-large" };
  if (!Array.isArray(sourcePaths) || sourcePaths.length < 1)
    return { eligible: false, reason: "no-current-read-evidence" };
  const title = titleFromSummary(markdown, query, resultSlug);
  return {
    eligible: true,
    input: {
      path: `Wiki/${fileStem(resultSlug, title)}.md`,
      title,
      markdown,
      rationale: "Automatically staged from a completed, evidence-gated research run. Review scope, claims and applicability before publishing.",
      source_paths: sourcePaths.slice(0, 12)
    }
  };
}

// packages/knowledge/src/index.ts
init_topic_memory();

// packages/knowledge/src/maintenance.ts
init_files();

// packages/knowledge/src/index.ts
init_runtime_host();
init_ui_state();

// packages/knowledge/src/publication.ts
init_runtime_host();
init_runtime_host();
import { createHash as createHash2, randomUUID as randomUUID3 } from "node:crypto";
init_review_policy();
init_ui_state();
var state2 = runtimeSlot(
  "knowledge",
  "publication",
  /** @returns {any} */
  () => ({
    proofs: /* @__PURE__ */ new WeakSet(),
    projectEvent: projectKnowledgeEvent,
    projectSnapshot: projectKnowledgeSnapshot
  })
);
var FIELD = "knowledgePublication";
var hash = (content) => createHash2("sha256").update(JSON.stringify(content ?? [])).digest("hex");
function sanitizeError(text2) {
  return diagnosticText(text2, 4096).trim();
}
function isUserAbortError(message) {
  return /was aborted|request aborted/i.test(String(message?.errorMessage || ""));
}
function base(message, content) {
  const errorMessage = message.stopReason === "error" && typeof message.errorMessage === "string" ? sanitizeError(message.errorMessage) : "";
  return {
    role: "assistant",
    content,
    api: message.api,
    provider: message.provider,
    model: message.model,
    usage: message.usage,
    timestamp: message.timestamp,
    stopReason: message.stopReason,
    ...message.responseId ? { responseId: message.responseId } : {},
    ...errorMessage ? { errorMessage } : {}
  };
}
function seal(message, content, detail) {
  const proof = { version: 1, id: randomUUID3(), ...detail, contentHash: hash(content) };
  state2.proofs.add(proof);
  return { ...base(message, content), [FIELD]: proof };
}
function blocked(message, code = "check-failed", turnId = null, operational = null, paths = [], extra = null) {
  return seal(
    message,
    [
      {
        type: "text",
        text: operational || (code === "interrupted" ? publicationNotices.interrupted : `\u3010\u77E5\u8BC6\u5E93\u68C0\u67E5\u672A\u901A\u8FC7\u3011${publicationNotices[code] || publicationNotices["check-failed"]}`)
      }
    ],
    {
      status: "blocked",
      reason: code,
      turnId,
      ...paths.length ? { paths } : {},
      ...extra && typeof extra === "object" ? extra : {},
      scientificallyVerified: false
    }
  );
}
function isSealed(message, restore = false) {
  const proof = message?.[FIELD];
  return proof?.version === 1 && (state2.proofs.has(proof) || restore) && [
    "released",
    "no-hits",
    "blocked",
    "tool-only",
    "unconfigured",
    "evidence-only",
    "setup-complete",
    "operational"
  ].includes(proof.status) && proof.contentHash === hash(message.content);
}
function inplace(target, source) {
  for (const name of Object.keys(target)) delete target[name];
  Object.assign(target, source);
  return target;
}
function projectUnsealed(message) {
  if (message.stopReason === "error" && !isUserAbortError(message))
    return seal(message, [], { status: "blocked", reason: "model-error", scientificallyVerified: false });
  if (["aborted", "length", "pending"].includes(message.stopReason) || isUserAbortError(message))
    return blocked(message, "interrupted");
  return blocked(message);
}
function projectKnowledgeEvent(event) {
  if (!process.env.DRONE_KNOWLEDGE_DIR) return event;
  if (event.type === "message_update") return null;
  if (event.type === "message_start" && event.message?.role === "assistant")
    return { ...event, message: base(event.message, []) };
  if (event.type === "message_end" && event.message?.role === "assistant") {
    if (!isSealed(event.message)) inplace(event.message, projectUnsealed(event.message));
    return event;
  }
  if (event.type === "turn_end" && event.message?.role === "assistant")
    return { ...event, message: isSealed(event.message) ? event.message : projectUnsealed(event.message) };
  if (event.type === "agent_end")
    return {
      ...event,
      messages: event.messages.map((m) => m.role === "assistant" && !isSealed(m) ? projectUnsealed(m) : m)
    };
  return event;
}
function projectKnowledgeSnapshot(messages, persisted = []) {
  if (!process.env.DRONE_KNOWLEDGE_DIR) return messages;
  const known = new Set(
    persisted.filter((m) => m.role === "assistant").map((m) => `${m.timestamp}:${hash(m.content)}`)
  );
  return messages.map((m) => {
    if (m.role !== "assistant" || isSealed(m)) return m;
    const saved = known.has(`${m.timestamp}:${hash(m.content)}`);
    if (saved && (!m[FIELD] || isSealed(m, true))) return m;
    return projectUnsealed(m);
  });
}

// packages/knowledge/src/service.ts
init_runtime_host();
init_runtime_host();
init_runtime_host();
init_config();
init_files();
init_review_policy();
init_ui_state();
var pool = runtimeSlot("knowledge", "workerPool", () => {
  const services = /* @__PURE__ */ new Map();
  return Object.assign(services, {
    async dispose() {
      const allocated = [...services.values()];
      services.clear();
      await Promise.allSettled(allocated.map((service) => service.close()));
    }
  });
});
var SERVICE_EVENT = "drone:knowledge-service/v1";
var serviceModule = {};
process.on(SERVICE_EVENT, (payload) => {
  if (!payload || payload.origin === serviceModule || typeof payload.key !== "string") return;
  if ((payload.action === "register" || payload.action === "response") && payload.service) {
    pool.set(payload.key, payload.service);
    return;
  }
  if (payload.action === "request") {
    const service = pool.get(payload.key);
    if (service && !service.closed)
      emitProcessEvent(SERVICE_EVENT, {
        action: "response",
        key: payload.key,
        service,
        origin: serviceModule
      });
  }
});

// packages/knowledge/src/index.ts
init_wiki_review();
init_specialist_host();

// packages/knowledge/src/specialists.ts
init_runtime_host();
init_config();
init_files();
init_specialist_host();
init_ui_state();

// packages/knowledge/src/specialist-delivery.ts
init_runtime_host();
init_runtime_host();
init_config();

// packages/knowledge/src/index.ts
init_wiki_model_review();

// packages/knowledge/src/ui-service.ts
init_runtime_host();
init_runtime_host();
init_runtime_host();
init_runtime_host();
init_runtime_host();
init_config();

// packages/knowledge/src/daily-discovery.ts
var DAILY_DISCOVERY_LIMITS = {
  maxScannedFiles: 4e3,
  maxNoteBytes: 256 * 1024,
  maxNewNotes: 8,
  maxRelatedNotes: 10,
  maxNoteChars: 2400,
  maxIdeas: 3
};

// packages/knowledge/src/ui-service.ts
init_files();
init_review_policy();
init_specialist_host();
init_ui_state();
init_wiki_review();
var runtimeState = runtimeSlot("knowledge", "uiService", () => ({
  previews: /* @__PURE__ */ new Map(),
  maintenance: /* @__PURE__ */ new Set(),
  semanticJobs: /* @__PURE__ */ new Map(),
  dispose() {
    this.previews.clear();
    this.maintenance.clear();
    this.semanticJobs.clear();
  }
}));

// packages/knowledge/src/experience-store.ts
init_config();
init_runtime_host();
var EXPERIENCE_LIMITS = Object.freeze({
  maxRecords: 128,
  maxFileBytes: 512 * 1024,
  maxSummaryChars: 1200,
  maxReasonChars: 600,
  maxTags: 16,
  maxArtifacts: 16,
  maxSources: 16,
  maxObservationIds: 8,
  maxJobIds: 8,
  maxWorkflowSpecDiffs: 16,
  maxQcMetrics: 24,
  maxQcValues: 128,
  maxModelSummaryChars: 500,
  maxSearchResults: 24,
  maxHostIdChars: 64,
  maxProjectChars: 96,
  maxWorkflowChars: 180,
  maxSchedulerChars: 32,
  maxRevisionChars: 180,
  maxSchedulerJobIdChars: 180,
  maxQueryChars: 200
});

// packages/research/src/run-summary.ts
var RESEARCH_SUMMARY_VERSION = 1;
var RESEARCH_SUMMARY_LIMITS = Object.freeze({
  findings: 24,
  citationsPerFinding: 12,
  sources: 24,
  summaryChars: 12e3,
  findingChars: 1600,
  queryChars: 1e3,
  readReceipts: 64
});
var clean = (value, limit) => String(value ?? "").normalize("NFKC").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim().slice(0, limit);
function slug(value, label) {
  const output = clean(value, 120);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(output)) throw new Error(`${label} must be lowercase kebab-case`);
  return output;
}
function sourcePath(value) {
  const path = clean(value, 480).replaceAll("\\", "/");
  if (!path || path.startsWith("/") || path.split("/").some((part) => !part || part === "." || part === ".." || part.startsWith(".")) || !path.endsWith(".md") || /(?:^|\/)Runs\//i.test(path))
    throw new Error("Citation path must be a Vault-relative Markdown source note");
  return path;
}
function sha256(value) {
  return createHash3("sha256").update(value).digest("hex");
}
function normalizeCitation(input, receipts) {
  const path = sourcePath(input.path ?? input.sourcePath);
  const hash2 = clean(input.hash ?? input.sourceHash, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash2)) throw new Error(`Citation ${path} must include a SHA-256 source hash`);
  const receipt = receipts.get(path);
  if (!receipt || clean(receipt.hash, 64).toLowerCase() !== hash2)
    throw new Error(`Citation ${path} is missing a matching current-turn read receipt`);
  const receiptRef = clean(input.receiptRef ?? receipt.receiptRef, 180);
  if (!receiptRef) throw new Error(`Citation ${path} must include a read receipt reference`);
  const locator = clean(input.locator, 160);
  const label = clean(input.label, 180);
  return {
    path,
    hash: hash2,
    receiptRef,
    ...locator ? { locator } : {},
    ...label ? { label } : {}
  };
}
function canonical(value) {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
  });
}
function formatFinding(finding) {
  const refs = finding.citations.map((citation) => `[[${citation.path}]]`).join(" ");
  return `${finding.text}${refs ? ` ${refs}` : ""}`.trim();
}
function normalizeResearchRunSummary(input) {
  const project = slug(input.project, "project");
  const resultSlug = slug(input.resultSlug, "resultSlug");
  const runId = clean(input.runId, 180);
  if (!/^run-[A-Za-z0-9][A-Za-z0-9_-]{1,180}$/.test(runId)) throw new Error("Invalid research run id");
  const query = clean(input.query, RESEARCH_SUMMARY_LIMITS.queryChars);
  const summary = clean(input.summary, RESEARCH_SUMMARY_LIMITS.summaryChars);
  if (!query || !summary) throw new Error("Research summary requires a query and non-empty summary");
  if (!Array.isArray(input.findings) || input.findings.length < 1 || input.findings.length > RESEARCH_SUMMARY_LIMITS.findings)
    throw new Error("Research summary requires 1\u201324 findings");
  const gate = input.evidenceGate;
  if (gate?.status === "failed" || gate?.answerable !== true || gate?.stage !== "answerable")
    throw new Error("Only an answerable, evidence-gated research run can produce a proposal summary");
  const receipts = /* @__PURE__ */ new Map();
  if (!Array.isArray(input.readReceipts) || input.readReceipts.length > RESEARCH_SUMMARY_LIMITS.readReceipts)
    throw new Error("Current-turn read receipts are required");
  for (const item of input.readReceipts) {
    const path = sourcePath(item.path);
    const hash2 = clean(item.hash, 64).toLowerCase();
    const receiptRef = clean(item.receiptRef, 180);
    if (!/^[a-f0-9]{64}$/.test(hash2) || !receiptRef) throw new Error(`Invalid read receipt for ${path}`);
    if (receipts.has(path) && receipts.get(path)?.hash !== hash2)
      throw new Error(`Conflicting read receipts for ${path}`);
    receipts.set(path, { ...item, path, hash: hash2, receiptRef });
  }
  const findings = input.findings.map((item, index) => {
    const text2 = clean(item.text ?? item.claim, RESEARCH_SUMMARY_LIMITS.findingChars);
    if (!text2) throw new Error(`Finding ${index + 1} is empty`);
    if (!Array.isArray(item.citations) || item.citations.length < 1 || item.citations.length > RESEARCH_SUMMARY_LIMITS.citationsPerFinding)
      throw new Error(`Finding ${index + 1} must carry at least one citation`);
    return {
      text: text2,
      citations: item.citations.map(
        (citation) => normalizeCitation(citation, receipts)
      )
    };
  });
  const sources = [
    ...new Map(
      findings.flatMap((item) => item.citations).map((item) => [item.path, item])
    ).values()
  ];
  if (sources.length > RESEARCH_SUMMARY_LIMITS.sources)
    throw new Error("Research summary has too many source notes");
  const claimRefs = (Array.isArray(gate.claimRefs) ? gate.claimRefs : []).map((ref) => clean(ref, 240)).filter(Boolean).slice(0, 64);
  const artifactPaths = (Array.isArray(input.artifactPaths) ? input.artifactPaths : []).map((path) => clean(path, 480).replaceAll("\\", "/")).filter((path) => path && !path.startsWith("/") && !path.split("/").includes("..")).slice(0, 12);
  const topicId = clean(input.topicId, 120) || resultSlug.replace(/-20\d{6,14}$/, "") || resultSlug;
  if (!/^[a-z0-9][a-z0-9_-]{0,95}$/i.test(topicId)) throw new Error("Invalid topic id");
  const proposalId = clean(input.proposalId, 120) || null;
  const base2 = {
    version: 1,
    project,
    resultSlug,
    query,
    runId,
    topicId,
    summary,
    findings,
    sources,
    readReceiptRefs: [...new Set(sources.map((item) => item.receiptRef))],
    claimRefs,
    artifactPaths,
    proposalId,
    answerable: true,
    navigationOnly: true
  };
  return { ...base2, runHash: sha256(canonical(base2)) };
}
var createResearchRunSummary = normalizeResearchRunSummary;
var researchRunSummary = normalizeResearchRunSummary;
function buildKnowledgeDeposit(summary) {
  const keyFindings = summary.findings.map(formatFinding);
  const topicSummary = [summary.summary, ...keyFindings].join("\n\n").slice(0, 12e3);
  const topic = {
    topicId: summary.topicId,
    title: summary.query.slice(0, 180),
    summary: topicSummary,
    sources: summary.sources.map(({ path, hash: hash2 }) => ({ path, hash: hash2 })),
    keyFindings,
    proposalIds: summary.proposalId ? [summary.proposalId] : [],
    artifacts: summary.artifactPaths,
    runHash: topicRunHash(topicSummary, summary.sources.map(({ path, hash: hash2 }) => ({ path, hash: hash2 })))
  };
  const wikiSummary = `# ${summary.query.slice(0, 180)}

${topicSummary}`;
  const wikiCandidate = autoTopicCandidate({
    summary: wikiSummary,
    query: summary.query,
    resultSlug: summary.resultSlug,
    sourcePaths: summary.sources.map((item) => item.path)
  });
  return { summary, topic, wikiCandidate };
}
var researchKnowledgeDeposit = buildKnowledgeDeposit;
async function depositResearchKnowledge(port, summary, expectedRevision) {
  const deposit = buildKnowledgeDeposit(summary);
  return port.record(deposit.topic, expectedRevision);
}
export {
  RESEARCH_SUMMARY_LIMITS,
  RESEARCH_SUMMARY_VERSION,
  buildKnowledgeDeposit,
  createResearchRunSummary,
  depositResearchKnowledge,
  normalizeResearchRunSummary,
  researchKnowledgeDeposit,
  researchRunSummary
};
