import {
  knowledgeDirectory
} from "./chunk-CXEKIGAQ.mjs";

// packages/knowledge/src/semantic-settings.ts
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
  return join(directory, vaultId, "semantic.json");
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
function defaultSettings(state, path) {
  const updatedAt = state.defaultUpdatedAt.get(path) || (/* @__PURE__ */ new Date()).toISOString();
  state.defaultUpdatedAt.set(path, updatedAt);
  return { version: 1, revision: 0, ...validateSemanticConfig({}), updatedAt };
}
async function readUnlocked(state, path) {
  await assertDirectory(dirname(path));
  await assertFile(path);
  try {
    const raw = await readFile(path, { encoding: "utf8", flag: "r" });
    if (Buffer.byteLength(raw) > MAX_FILE_BYTES) throw new Error("Semantic settings file is too large");
    const value = JSON.parse(raw);
    return normalize(value, value.revision, value.updatedAt);
  } catch (error) {
    if (error.code === "ENOENT") return defaultSettings(state, path);
    if (error instanceof SyntaxError) throw new Error("Semantic settings cannot be read: invalid JSON");
    throw new Error(
      `Semantic settings cannot be read: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
function createSemanticSettingsApi(state = createSemanticSettingsState()) {
  return {
    readSemanticSettings: async (vaultId) => readUnlocked(state, pathFor(vaultId)),
    saveSemanticSettings: async (vaultId, input, expectedRevision) => {
      const path = pathFor(vaultId);
      const current = await readUnlocked(state, path);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.revision)
        throw new Error("Semantic settings revision is stale");
      const value = normalize({ version: 1, ...input }, current.revision + 1);
      const dir = dirname(path);
      await assertDirectory(dir);
      for (const entry of await readdir(dir))
        if (/^semantic\.[a-f0-9-]+\.tmp$/.test(entry)) await unlink(join(dir, entry)).catch(() => {
        });
      const temp = join(dir, `semantic.${randomUUID()}.tmp`);
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
var readSemanticSettings = (vaultId) => defaultApi.readSemanticSettings(vaultId);
var saveSemanticSettings = (vaultId, input, expectedRevision) => defaultApi.saveSemanticSettings(vaultId, input, expectedRevision);

export {
  validateSemanticConfig,
  createSemanticSettingsState,
  createSemanticSettingsApi,
  readSemanticSettings,
  saveSemanticSettings
};
