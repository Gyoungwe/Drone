// @ts-nocheck
import "./chunks/chunk-VIHIR2BE.mjs";

// packages/knowledge/src/graph-cache.ts
function createRevisionCache() {
  let activeRevision = null;
  const values = /* @__PURE__ */ new Map();
  const align = (revision) => {
    if (activeRevision === revision) return;
    activeRevision = revision;
    values.clear();
  };
  return {
    get(revision, key) {
      align(revision);
      return values.get(key);
    },
    set(revision, key, value) {
      align(revision);
      values.set(key, value);
    },
    clear() {
      activeRevision = null;
      values.clear();
    }
  };
}
export {
  createRevisionCache
};
