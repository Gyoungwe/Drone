// @ts-nocheck
// packages/knowledge/src/deliverable-review.ts
import { createHash } from "node:crypto";
var SHA256 = /^[a-f0-9]{64}$/i;
var DEFAULT_TIMEOUT_MS = 2e4;
var DEFAULT_MAX_PER_SESSION = 32;
var NUMBER = /(?<![\w])[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[-+]?\d+)?%?/gi;
var CITATION = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
function bounded(value, max = 300) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").slice(0, max);
}
function normalizePath(path) {
  const normalized = path.trim().replaceAll("\\", "/");
  return normalized.endsWith(".md") ? normalized : `${normalized}.md`;
}
function numericValue(token) {
  const parsed = Number(token.replace(/%$/, ""));
  return Number.isFinite(parsed) ? parsed : null;
}
function numberMatches(token, value) {
  const parsed = numericValue(token);
  if (parsed == null) return false;
  const candidate = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(candidate)) return false;
  const tolerance = Math.max(1e-9, Math.abs(candidate) * 1e-6);
  return Math.abs(parsed - candidate) <= tolerance;
}
function numberIsTraceable(token, artifacts, receipts) {
  for (const artifact of artifacts) {
    if (artifact.numbers?.some((item) => numberMatches(token, item.value))) return true;
    if (typeof artifact.text === "string" && artifact.text.match(NUMBER)?.some((value) => numberMatches(token, value))) return true;
  }
  for (const receipt of receipts) {
    if (!receipt.receiptRef && !receipt.hash) continue;
    if (receipt.numbers?.some((item) => numberMatches(token, item.value))) return true;
    if (typeof receipt.text === "string" && receipt.text.match(NUMBER)?.some((value) => numberMatches(token, value))) return true;
  }
  return false;
}
function locationFor(body, offset, path) {
  const before = body.slice(0, offset);
  return {
    kind: "body",
    paragraph: before.split(/\n\s*\n/u).length,
    line: before.split("\n").length,
    ...path ? { path } : {}
  };
}
function findingId(code, location, subject) {
  return createHash("sha256").update(`${code}\0${location.line ?? ""}\0${location.paragraph ?? ""}\0${location.artifactId ?? ""}\0${subject}`).digest("hex").slice(0, 24);
}
function citationPaths(body, explicit, findings) {
  const paths = new Set(explicit ?? []);
  for (const match of body.matchAll(CITATION)) paths.add(normalizePath(match[1] ?? ""));
  for (const finding of findings ?? [])
    for (const path of finding.citationPaths ?? []) paths.add(normalizePath(path));
  return [...paths].filter(Boolean);
}
function latestAttemptFor(deliverable, attempts) {
  const related = attempts.filter(
    (attempt) => deliverable.attemptId && attempt.id === deliverable.attemptId || attempt.artifactIds?.includes(deliverable.id)
  );
  return [...related].sort((left, right) => {
    const leftTime = left.finishedAt ?? left.startedAt ?? "";
    const rightTime = right.finishedAt ?? right.startedAt ?? "";
    return leftTime.localeCompare(rightTime);
  })[related.length - 1];
}
function attemptHash(attempt, artifactId) {
  const output = attempt?.outputs?.find((item) => item.artifactId === artifactId)?.sha256;
  return output ?? attempt?.artifactSha256?.[artifactId];
}
function isFigure(deliverable) {
  return /^(figure|image|plot)$/i.test(deliverable.kind ?? "") || /\.(?:png|jpe?g|gif|svg|tiff?|webp)$/i.test(deliverable.path ?? "");
}
function reviewRules(snapshot) {
  if (snapshot.enabled === false) return [];
  const body = snapshot.body ?? snapshot.answer ?? "";
  const artifacts = Array.isArray(snapshot.artifacts) ? snapshot.artifacts : [];
  const receipts = Array.isArray(snapshot.readReceipts) ? snapshot.readReceipts : [];
  const findings = [];
  const add = (finding, subject) => findings.push({ ...finding, id: findingId(finding.code, finding.location, subject), handled: false });
  for (const match of body.matchAll(NUMBER)) {
    const token = match[0];
    const offset = match.index ?? 0;
    if (numberIsTraceable(token, artifacts, receipts)) continue;
    add(
      {
        code: "untraceable-number",
        severity: "high",
        location: locationFor(body, offset),
        detail: `\u6B63\u6587\u6570\u5B57 ${bounded(token, 80)} \u627E\u4E0D\u5230\u4EA4\u4ED8\u7269\u6570\u503C\u6216\u5E26\u8BFB\u56DE\u6267\u7684\u6765\u6E90\u3002`,
        suggestion: "\u8865\u5145\u5BF9\u5E94\u4EA7\u7269\u6570\u503C\u6216\u5B9E\u9645\u8BFB\u53D6\u6765\u6E90\u7684\u56DE\u6267\uFF0C\u518D\u4FDD\u7559\u8BE5\u6570\u5B57\u3002"
      },
      token
    );
  }
  for (const deliverable of Array.isArray(snapshot.deliverables) ? snapshot.deliverables : []) {
    if (!isFigure(deliverable)) continue;
    const location = {
      kind: "artifact",
      artifactId: deliverable.id,
      ...deliverable.path ? { path: deliverable.path } : {}
    };
    const attempt = latestAttemptFor(deliverable, Array.isArray(snapshot.attempts) ? snapshot.attempts : []);
    if (!attempt) {
      add(
        {
          code: "figure-code-mismatch",
          severity: "high",
          location,
          detail: `\u56FE\u7247\u4EA7\u7269 ${bounded(deliverable.id)} \u6CA1\u6709\u5173\u8054 AttemptRecord\u3002`,
          suggestion: "\u628A\u56FE\u7247\u7ED1\u5B9A\u5230\u6700\u8FD1\u4E00\u6B21\u4EA7\u751F\u5B83\u7684 AttemptRecord\uFF0C\u5E76\u4FDD\u7559\u4EA7\u51FA\u54C8\u5E0C\u3002"
        },
        deliverable.id
      );
      continue;
    }
    const outputHash = attemptHash(attempt, deliverable.id);
    if (!SHA256.test(String(deliverable.sha256 ?? "")) || !SHA256.test(String(outputHash ?? "")) || deliverable.sha256?.toLowerCase() !== outputHash?.toLowerCase())
      add(
        {
          code: "figure-code-mismatch",
          severity: "high",
          location,
          detail: `\u56FE\u7247\u4EA7\u7269 ${bounded(deliverable.id)} \u7684 sha256 \u4E0E\u6700\u8FD1\u4E00\u6B21 AttemptRecord \u4EA7\u51FA\u4E0D\u4E00\u81F4\u3002`,
          suggestion: "\u91CD\u65B0\u6838\u5BF9\u56FE\u7247\u548C\u4EE3\u7801\u4EA7\u51FA\u7684\u54C8\u5E0C\uFF0C\u6216\u91CD\u65B0\u751F\u6210\u5E76\u7ED1\u5B9A\u540C\u4E00\u6B21\u5C1D\u8BD5\u3002"
        },
        deliverable.id
      );
  }
  const receiptByPath = new Map(receipts.map((receipt) => [normalizePath(receipt.path), receipt]));
  for (const path of citationPaths(body, snapshot.citations, snapshot.findings)) {
    const receipt = receiptByPath.get(path);
    if (receipt?.receiptRef || receipt?.hash) continue;
    const artifact = artifacts.find((item) => normalizePath(item.path) === path && item.receiptId);
    if (artifact) continue;
    const offset = body.indexOf(path.replace(/\.md$/i, ""));
    add(
      {
        code: "citation-without-receipt",
        severity: "medium",
        location: locationFor(body, offset >= 0 ? offset : 0, path),
        detail: `\u5F15\u7528 ${bounded(path, 240)} \u6CA1\u6709\u5BF9\u5E94\u7684\u8BFB\u56DE\u6267\u3002`,
        suggestion: "\u5148\u8BFB\u53D6\u6765\u6E90\u5E76\u4FDD\u7559\u5F53\u524D\u5185\u5BB9\u54C8\u5E0C\u4E0E\u56DE\u6267\uFF0C\u518D\u5F15\u7528\u8BE5\u6765\u6E90\u3002"
      },
      path
    );
  }
  return findings;
}
function reviewDeliverable(snapshot) {
  const contentHash = reviewContentHash(snapshot);
  return { contentHash, findings: reviewRules(snapshot) };
}
function reviewContentHash(snapshot) {
  const stable = (value) => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
    return value;
  };
  return createHash("sha256").update(JSON.stringify(stable(snapshot ?? null))).digest("hex");
}
function selectReviewerProvider(mainProvider, providers) {
  const configured = providers.filter((item) => typeof item.provider === "string" && item.provider.trim());
  if (!configured.length) return null;
  const independent = mainProvider ? configured.find((item) => item.provider !== mainProvider) : void 0;
  if (independent) return { provider: independent.provider, independent: true };
  const fallback = configured[0];
  return {
    provider: fallback?.provider ?? "",
    independent: false,
    nonIndependentReason: "\u975E\u72EC\u7ACB\u5BA1\u7A3F\uFF1A\u6CA1\u6709\u914D\u7F6E\u5176\u4ED6 provider\u3002"
  };
}
var BackgroundReviewer = class {
  timeoutMs;
  maxPerSession;
  review;
  modelReview;
  mainProvider;
  providers;
  onResult;
  now;
  cache = /* @__PURE__ */ new Map();
  results = /* @__PURE__ */ new Map();
  counts = /* @__PURE__ */ new Map();
  emitted = /* @__PURE__ */ new Map();
  latest = /* @__PURE__ */ new Map();
  disposed = false;
  constructor(options = {}) {
    this.timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.maxPerSession = Math.max(1, options.maxPerSession ?? DEFAULT_MAX_PER_SESSION);
    this.review = options.review ?? ((snapshot) => reviewRules(snapshot));
    this.modelReview = options.modelReview;
    this.mainProvider = options.mainProvider;
    this.providers = options.providers ?? [];
    this.onResult = options.onResult;
    this.now = options.now ?? Date.now;
  }
  timeoutFinding(code) {
    return {
      id: `${code}-${this.now()}`,
      code,
      severity: "medium",
      location: { kind: "body" },
      detail: code === "review-timeout" ? "\u540E\u53F0\u5BA1\u7A3F\u8D85\u8FC7\u5355\u6B21\u65F6\u95F4\u4E0A\u9650\u3002" : "\u672C\u4F1A\u8BDD\u540E\u53F0\u5BA1\u7A3F\u9884\u7B97\u5DF2\u7528\u5C3D\u3002",
      suggestion: "\u4FDD\u7559\u4EA4\u4ED8\u7269\uFF0C\u7A0D\u540E\u91CD\u65B0\u89E6\u53D1\u5BA1\u7A3F\u6216\u7531\u4EBA\u5DE5\u6838\u5BF9\u3002",
      handled: false
    };
  }
  async reviewOnce(request) {
    const contentHash = reviewContentHash(request.snapshot);
    const sessionCache = this.cache.get(request.sessionId) ?? /* @__PURE__ */ new Map();
    this.cache.set(request.sessionId, sessionCache);
    const cached = sessionCache.get(contentHash);
    if (cached) return cached;
    if ((this.counts.get(request.sessionId) ?? 0) >= this.maxPerSession) {
      const result = { contentHash, findings: [this.timeoutFinding("review-budget-exhausted")] };
      const promise2 = Promise.resolve(result);
      sessionCache.set(contentHash, promise2);
      const resultCache = this.results.get(request.sessionId) ?? /* @__PURE__ */ new Map();
      resultCache.set(contentHash, result);
      this.results.set(request.sessionId, resultCache);
      return promise2;
    }
    this.counts.set(request.sessionId, (this.counts.get(request.sessionId) ?? 0) + 1);
    const promise = (async () => {
      let timer;
      try {
        const findings = await Promise.race([
          Promise.resolve().then(async () => {
            const ruleFindings = await this.review(request.snapshot);
            if (!this.modelReview) return ruleFindings;
            const selection = selectReviewerProvider(this.mainProvider, this.providers);
            if (!selection) return ruleFindings;
            const modelFindings = await this.modelReview(request.snapshot, selection);
            return selection.independent ? [...ruleFindings, ...modelFindings] : [
              ...ruleFindings,
              ...modelFindings.map((finding) => ({
                ...finding,
                independent: false,
                nonIndependentReason: selection.nonIndependentReason
              }))
            ];
          }),
          new Promise((resolve) => {
            timer = setTimeout(() => resolve([this.timeoutFinding("review-timeout")]), this.timeoutMs);
          })
        ]);
        return { contentHash, findings };
      } catch {
        return { contentHash, findings: [this.timeoutFinding("review-timeout")] };
      } finally {
        if (timer) clearTimeout(timer);
      }
    })();
    sessionCache.set(contentHash, promise);
    void promise.then((result) => {
      if (this.disposed || this.cache.get(request.sessionId) !== sessionCache) return;
      const resultCache = this.results.get(request.sessionId) ?? /* @__PURE__ */ new Map();
      resultCache.set(contentHash, result);
      this.results.set(request.sessionId, resultCache);
      const latest = this.latest.get(request.sessionId) ?? /* @__PURE__ */ new Map();
      const targets = request.snapshot.deliverables?.map((item) => item.id) ?? [];
      for (const target of targets.length ? targets : ["body"]) latest.set(target, result.findings);
      this.latest.set(request.sessionId, latest);
    });
    return promise;
  }
  getCached(sessionId, snapshot) {
    const contentHash = reviewContentHash(snapshot);
    return this.results.get(sessionId)?.get(contentHash);
  }
  schedule(request) {
    setTimeout(() => {
      if (this.disposed) return;
      void this.reviewOnce(request).then((result) => {
        if (this.disposed) return;
        const emitted = this.emitted.get(request.sessionId) ?? /* @__PURE__ */ new Set();
        const key = result.findings[0]?.code === "review-budget-exhausted" ? "budget" : result.contentHash;
        if (emitted.has(key)) return;
        emitted.add(key);
        this.emitted.set(request.sessionId, emitted);
        return this.onResult?.(request.sessionId, result, request.trigger);
      }).catch(() => {
      });
    }, 0);
  }
  getFindings(sessionId) {
    return [...new Map([...this.latest.get(sessionId)?.values() ?? []].flat().map((finding) => [finding.id, finding])).values()];
  }
  clearSession(sessionId) {
    this.cache.delete(sessionId);
    this.results.delete(sessionId);
    this.counts.delete(sessionId);
    this.emitted.delete(sessionId);
    this.latest.delete(sessionId);
  }
  dispose() {
    this.disposed = true;
    this.cache.clear();
    this.results.clear();
    this.counts.clear();
    this.emitted.clear();
    this.latest.clear();
  }
};

export {
  reviewDeliverable,
  selectReviewerProvider,
  BackgroundReviewer
};
