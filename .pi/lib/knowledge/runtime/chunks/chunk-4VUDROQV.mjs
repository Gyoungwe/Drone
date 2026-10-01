// packages/knowledge/src/runtime-host.ts
var locks = /* @__PURE__ */ new Map();
var defaultRunRuntimeExclusive = async (_namespace, key, work) => {
  const previous = locks.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
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
var runtimeExclusive = defaultRunRuntimeExclusive;
var processEvent = () => void 0;
var metadataLookup = () => null;
var cardBuilderLookup = () => null;
var deliveryLookup = () => null;
var hostSlotProvider;
function configureKnowledgeRuntime(host = {}) {
  if (host.runRuntimeExclusive) runtimeExclusive = host.runRuntimeExclusive;
  if (host.emitProcessEvent) processEvent = host.emitProcessEvent;
  if (host.toolMeta) metadataLookup = host.toolMeta;
  if (host.flowCardBuilder) cardBuilderLookup = host.flowCardBuilder;
  if (host.deliveryContract) deliveryLookup = host.deliveryContract;
  if (host.runtimeSlot) hostSlotProvider = host.runtimeSlot;
}
var runRuntimeExclusive = (namespace, key, work) => runtimeExclusive(namespace, key, work);
var emitProcessEvent = (event, payload) => processEvent(event, payload);
var slots = /* @__PURE__ */ new Map();
function runtimeSlot(domain, key, factory) {
  let hostProxy;
  let provider;
  const resolve = () => {
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
      const state = resolve();
      const value = Reflect.get(state, property);
      return typeof value === "function" ? value.bind(state) : value;
    },
    set: (_target, property, value) => Reflect.set(resolve(), property, value),
    ownKeys: () => Reflect.ownKeys(resolve()),
    getOwnPropertyDescriptor: (_target, property) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(resolve(), property);
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
function toolMeta(_toolName) {
  return metadataLookup(_toolName);
}
function flowCardBuilder(_toolName) {
  return cardBuilderLookup(_toolName);
}
var workerFactory = (url, options) => {
  throw new Error(`Knowledge worker host is not configured for ${url.href}`);
};
function configureKnowledgeWorker(factory) {
  workerFactory = factory;
}
function createKnowledgeWorker(url, options) {
  return workerFactory(url, options);
}
function configureKnowledgeEvidence(host) {
  if (host.requiresPaperEvidence) requiresPaperEvidence = host.requiresPaperEvidence;
  if (host.hasPaperCitation) hasPaperCitation = host.hasPaperCitation;
}
var requiresPaperEvidence = (query) => /paper|literature|article|文献|论文/i.test(query);
var hasPaperCitation = (sources) => Array.isArray(sources) && sources.some((source) => /(?:^|\/)Library\/Papers\//.test(String(source?.path ?? "")));
var deliveryContract = (prompt, options) => deliveryLookup(prompt, options);
var workspaceConfigLoader = async () => {
  throw new Error("Workspace config host is not configured");
};
var explainerPublisher = async () => {
  throw new Error("Explainer publisher host is not configured");
};
var reviewPreviewConsumer = () => null;
var specialistSettingsReader = async () => ({ mode: "strict" });
function configureKnowledgeHost(host = {}) {
  if (host.loadWorkspaceConfig) workspaceConfigLoader = host.loadWorkspaceConfig;
  if (host.publishExplainer) explainerPublisher = host.publishExplainer;
  if (host.consumeKnowledgeReviewPreview) reviewPreviewConsumer = host.consumeKnowledgeReviewPreview;
  if (host.specialistSettings) specialistSettingsReader = host.specialistSettings;
}
var loadWorkspaceConfig = (cwd) => workspaceConfigLoader(cwd);
var publishExplainer = (input) => explainerPublisher(input);
var consumeKnowledgeReviewPreview = (cwd, token) => reviewPreviewConsumer(cwd, token);
var specialistSettings = () => specialistSettingsReader();
var layoutDefinition = { templates: {}, noteTemplate: "" };
var obsidianSetupInspector = async () => null;
var setupDirectoryInspector = async () => null;
var setupVaultResolver = (supplied) => supplied;
var setupOptionsReader = () => [];
function configureKnowledgeSetup(host = {}) {
  if (host.layout) layoutDefinition = host.layout;
  if (host.inspectObsidianSetup) obsidianSetupInspector = host.inspectObsidianSetup;
  if (host.inspectSetupDirectory) setupDirectoryInspector = host.inspectSetupDirectory;
  if (host.resolveSetupVault) setupVaultResolver = host.resolveSetupVault;
  if (host.researchSetupOptions) setupOptionsReader = host.researchSetupOptions;
}
var LAYOUT = new Proxy({}, {
  get: (_target, key) => layoutDefinition[key]
});
var inspectObsidianSetup = (input) => obsidianSetupInspector(input);
var inspectSetupDirectory = (vault) => setupDirectoryInspector(vault);
var resolveSetupVault = (supplied, workspace) => setupVaultResolver(supplied, workspace);
var researchSetupOptions = () => setupOptionsReader();

export {
  configureKnowledgeRuntime,
  runRuntimeExclusive,
  emitProcessEvent,
  runtimeSlot,
  diagnosticText,
  toolMeta,
  flowCardBuilder,
  configureKnowledgeWorker,
  createKnowledgeWorker,
  configureKnowledgeEvidence,
  requiresPaperEvidence,
  hasPaperCitation,
  deliveryContract,
  configureKnowledgeHost,
  loadWorkspaceConfig,
  publishExplainer,
  consumeKnowledgeReviewPreview,
  specialistSettings,
  configureKnowledgeSetup,
  LAYOUT,
  inspectObsidianSetup,
  inspectSetupDirectory,
  resolveSetupVault,
  researchSetupOptions
};
