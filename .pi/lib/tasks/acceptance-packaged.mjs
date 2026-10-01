// @ts-nocheck
/** Compatibility artifact generated from packages/tasks/src/runtime/acceptance.ts; packaged resources share the .pi runtime bridge. */
const CORE_ACCEPTANCE_KINDS = Object.freeze(["file", "human_review"]);
const CORE_FIELDS = Object.freeze(["kind", "path", "sha256"]);
const KIND = /^[a-z][a-z0-9_]{1,40}$/;
const FIELD = /^[a-zA-Z][a-zA-Z0-9]{0,40}$/;
const stringField = { type: "string", minLength: 1, maxLength: 512 };
import { runtimeSlot, withRuntime } from "../runtime-bridge.mjs";
const ACCEPTANCE_VERIFIER_EVENT = "drone:acceptance-verifier/v1";
const ACCEPTANCE_VERIFIER_REQUEST_EVENT = "drone:acceptance-verifier/request/v1";
const eventBridges = runtimeSlot("tasks", "acceptanceEventBridges", () => /* @__PURE__ */ new WeakSet());
const createRegistry = () => {
  const kinds = [...CORE_ACCEPTANCE_KINDS];
  return {
    verifiers: /* @__PURE__ */ new Map(),
    kinds,
    properties: { kind: { type: "string", enum: kinds }, path: stringField, sha256: stringField }
  };
};
const registry = runtimeSlot("tasks", "acceptance", createRegistry);
function ensureRegistryShape() {
  registry.verifiers ??= /* @__PURE__ */ new Map();
  registry.kinds ??= [...CORE_ACCEPTANCE_KINDS];
  registry.properties ??= {};
  registry.properties.kind ??= { type: "string", enum: registry.kinds };
  registry.properties.path ??= stringField;
  registry.properties.sha256 ??= stringField;
}
ensureRegistryShape();
function definitionOf(verifier) {
  const definition = {
    fields: [...verifier.fields || []],
    evidenceKind: verifier.evidenceKind,
    operationVerifier: verifier.operationVerifier
  };
  for (const key of ["label", "verify", "observe", "resolve", "identify", "consent", "pending"])
    if (typeof verifier[key] === "function") definition[key] = verifier[key];
  if (verifier.acknowledgeError) definition.acknowledgeError = verifier.acknowledgeError;
  return definition;
}
function registrationOf(verifier) {
  return {
    version: 1,
    kind: verifier.kind,
    definition: definitionOf(verifier)
  };
}
function bindAcceptanceVerifierEvents(pi) {
  if (!pi?.events?.on || eventBridges.has(pi)) return () => {
  };
  eventBridges.add(pi);
  const publish = (verifier) => {
    void pi.events.emit?.(ACCEPTANCE_VERIFIER_EVENT, registrationOf(verifier));
  };
  const replay = () => {
    for (const verifier of acceptanceVerifiers()) publish(verifier);
  };
  const onRequest = (payload) => {
    if (payload?.version === 1) replay();
  };
  const onRuntime = (payload) => {
    if (payload?.version !== 1 || !payload.runtime || typeof payload.runtime !== "object") return;
    const verifiers = acceptanceVerifiers().map(registrationOf);
    if (!payload.runtime.scheduler) return;
    withRuntime(payload.runtime, () => {
      for (const registration of verifiers)
        registerAcceptanceVerifier(registration.kind, registration.definition);
    });
    for (const registration of verifiers) void pi.events.emit?.(ACCEPTANCE_VERIFIER_EVENT, registration);
  };
  pi.events.on(ACCEPTANCE_VERIFIER_REQUEST_EVENT, onRequest);
  pi.events.on("drone:runtime/v1", onRuntime);
  void pi.events.emit?.(ACCEPTANCE_VERIFIER_REQUEST_EVENT, { version: 1 });
  return () => {
  };
}
function registerAcceptanceVerifier(kind, definition = {}) {
  ensureRegistryShape();
  if (!KIND.test(kind || "")) throw new Error(`Acceptance kind "${kind}" must match ${KIND}`);
  if (CORE_ACCEPTANCE_KINDS.includes(kind)) throw new Error(`Acceptance kind "${kind}" is owned by the host`);
  for (const fn of ["label", "verify", "observe", "resolve", "identify", "consent", "pending"])
    if (definition[fn] !== void 0 && typeof definition[fn] !== "function")
      throw new Error(`Acceptance verifier ${kind}.${fn} must be a function`);
  const fields = [...new Set(definition.fields || [])];
  for (const field of fields)
    if (!FIELD.test(field) || CORE_FIELDS.includes(field))
      throw new Error(`Acceptance verifier ${kind}: invalid field "${field}"`);
  const verifier = Object.freeze({
    kind,
    fields: Object.freeze(fields),
    evidenceKind: definition.evidenceKind || `${kind}-verified`,
    operationVerifier: definition.operationVerifier || `${kind}-record-not-scientific-proof`,
    label: definition.label || (() => kind),
    verify: definition.verify || null,
    observe: definition.observe || null,
    resolve: definition.resolve || null,
    identify: definition.identify || null,
    consent: definition.consent || null,
    pending: definition.pending || null,
    acknowledgeError: definition.acknowledgeError || null
  });
  registry.verifiers.set(kind, verifier);
  if (!registry.kinds.includes(kind)) registry.kinds.push(kind);
  for (const field of fields) registry.properties[field] ??= stringField;
  return verifier;
}
function resetAcceptanceVerifiers() {
  ensureRegistryShape();
  registry.verifiers.clear();
  registry.kinds.splice(0, registry.kinds.length, ...CORE_ACCEPTANCE_KINDS);
  for (const field of Object.keys(registry.properties))
    if (!CORE_FIELDS.includes(field)) delete registry.properties[field];
}
function acceptanceVerifier(kind) {
  ensureRegistryShape();
  return registry.verifiers.get(kind) || null;
}
function acceptanceVerifiers() {
  ensureRegistryShape();
  return [...registry.verifiers.values()];
}
function acceptanceKinds() {
  ensureRegistryShape();
  return [...registry.kinds];
}
function acceptanceSchema() {
  ensureRegistryShape();
  return {
    type: "object",
    properties: registry.properties,
    required: ["kind"],
    additionalProperties: false
  };
}
function normalizeAcceptance(input, clean, verifiers) {
  ensureRegistryShape();
  const kind = input?.kind;
  const verifier = (verifiers || registry.verifiers).get(kind) || null;
  const acceptance = {
    kind,
    path: clean(input.path, 512),
    sha256: /^[a-f0-9]{64}$/.test(input.sha256 || "") ? input.sha256 : null
  };
  for (const field of verifier?.fields || []) acceptance[field] = clean(input[field]);
  return acceptance;
}
function effectiveAcceptance(milestone) {
  const acceptance = milestone?.acceptance || {};
  const bound = milestone?.bound?.fields;
  return bound && typeof bound === "object" ? { ...acceptance, ...bound } : { ...acceptance };
}
function describeAcceptance(acceptance, verifier = acceptanceVerifier(acceptance?.kind)) {
  if (acceptance?.kind === "file") return `\u751F\u6210\u6587\u4EF6 ${acceptance.path || ""}`.trim();
  if (acceptance?.kind === "human_review") return "\u7531\u4F60\u4EB2\u81EA\u786E\u8BA4\u5B8C\u6210";
  if (verifier) {
    try {
      return String(verifier.label(acceptance) || verifier.kind);
    } catch {
      return verifier.kind;
    }
  }
  return `\u5B8C\u6210 ${acceptance?.kind || "\u672A\u77E5"} \u9A8C\u6536`;
}
export {
  ACCEPTANCE_VERIFIER_EVENT,
  ACCEPTANCE_VERIFIER_REQUEST_EVENT,
  CORE_ACCEPTANCE_KINDS,
  acceptanceKinds,
  acceptanceSchema,
  acceptanceVerifier,
  acceptanceVerifiers,
  bindAcceptanceVerifierEvents,
  describeAcceptance,
  effectiveAcceptance,
  normalizeAcceptance,
  registerAcceptanceVerifier,
  resetAcceptanceVerifiers
};
