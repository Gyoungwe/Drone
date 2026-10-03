// Host adapter for typed institutional config and proxy policy.
// Electron session effects stay in the Pi host; config normalization/persistence
// lives in @drone/research/institutional-access.
import { createRequire } from "node:module";
import {
  buildProxiedUrl,
  detectAndSaveTemplateFromUrl,
  emptyInstitutionalConfig,
  inferEzproxyTemplateFromUrl,
  loadInstitutionalConfig,
  normalizeInstitutionalConfig,
  saveInstitutionalConfig,
} from "./institutional-access-core.mjs";

export {
  buildProxiedUrl,
  detectAndSaveTemplateFromUrl,
  emptyInstitutionalConfig,
  inferEzproxyTemplateFromUrl,
  loadInstitutionalConfig,
  normalizeInstitutionalConfig,
  saveInstitutionalConfig,
};

const require = createRequire(import.meta.url);
const PARTITION = "persist:drone-institutional";
let electronSession = null;
let electronNet = null;

function tryLoadElectron() {
  if (electronSession && electronNet) return { session: electronSession, net: electronNet };
  try {
    const electron = require("electron");
    if (electron?.session && electron?.net) {
      electronSession = electron.session;
      electronNet = electron.net;
      return { session: electronSession, net: electronNet };
    }
  } catch {}
  return null;
}

export function isElectronAvailable() {
  return Boolean(tryLoadElectron());
}

export function getInstitutionalSession() {
  const loaded = tryLoadElectron();
  if (!loaded) return null;
  try {
    return loaded.session.fromPartition(PARTITION);
  } catch {
    return null;
  }
}

export async function institutionalFetch(url, options = {}) {
  const loaded = tryLoadElectron();
  if (!loaded) throw new Error("Electron session unavailable");
  const sess = loaded.session.fromPartition(PARTITION);
  const timeoutMs = options.timeoutMs ?? 30000;
  const fetchFn = loaded.net?.fetch || globalThis.fetch;
  if (typeof fetchFn !== "function") throw new Error("fetch unavailable");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {
      method: "GET",
      headers: options.headers,
      signal: controller.signal,
      session: sess,
    });
    const finalUrl = response.url || url;
    const headers = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const arrayBuf = await response.arrayBuffer();
    return { status: response.status, headers, body: new Uint8Array(arrayBuf), finalUrl, response };
  } finally {
    clearTimeout(timer);
  }
}
