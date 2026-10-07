// @ts-nocheck
// packages/knowledge/src/graph-retrieval.ts
var GRAPH_RETRIEVAL_DEFAULTS = {
  seeds: 3,
  decay: 0.5,
  centralityWeight: 2e-3,
  centralityCap: 4e-3,
  maxNeighborsPerSeed: 4
};
function centralityBoost(degree, weight, cap) {
  if (!(degree > 0)) return 0;
  return Math.min(cap, weight * Math.log2(1 + degree));
}
function baseScore(hit, index) {
  return typeof hit.fusionScore === "number" && Number.isFinite(hit.fusionScore) ? hit.fusionScore : 1 / (60 + index + 1);
}
function expandWithGraph(hits, neighbors, options) {
  const o = { ...GRAPH_RETRIEVAL_DEFAULTS, ...options };
  const limit = Math.max(1, Math.min(12, Math.floor(o.limit)));
  const scored = /* @__PURE__ */ new Map();
  for (const [index, hit] of hits.entries()) scored.set(hit.path, { hit, score: baseScore(hit, index) });
  const seedScore = new Map(hits.slice(0, o.seeds).map((hit, index) => [hit.path, baseScore(hit, index)]));
  const perSeed = /* @__PURE__ */ new Map();
  const ordered = [...neighbors].sort(
    (a, b) => b.degree - a.degree || a.path.localeCompare(b.path) || a.from.localeCompare(b.from)
  );
  for (const n of ordered) {
    const parent = seedScore.get(n.from);
    if (parent === void 0 || n.path === n.from) continue;
    const used = perSeed.get(n.from) || 0;
    const existing = scored.get(n.path);
    const contribution = parent * o.decay + centralityBoost(n.degree, o.centralityWeight, o.centralityCap);
    if (existing) {
      if (existing.hit.retrieval !== "graph") existing.score += contribution * 0.25;
      else {
        existing.score = Math.max(existing.score, contribution);
        const g = existing.hit.graph;
        if (!g.from.includes(n.from)) g.from.push(n.from);
      }
      continue;
    }
    if (used >= o.maxNeighborsPerSeed) continue;
    perSeed.set(n.from, used + 1);
    scored.set(n.path, {
      hit: {
        path: n.path,
        title: n.title,
        kind: n.kind,
        ...n.hash ? { hash: n.hash } : {},
        retrieval: "graph",
        graph: { from: [n.from], direction: n.direction, ...n.context ? { context: n.context } : {} }
      },
      score: contribution
    });
  }
  return [...scored.values()].sort((a, b) => b.score - a.score || a.hit.path.localeCompare(b.hit.path)).slice(0, limit).map(({ hit, score }) => ({ ...hit, fusionScore: score }));
}
function backlinkContext(body, target, max = 240) {
  const bare = target.split("/").at(-1)?.replace(/\.md$/, "") || target;
  const full = target.replace(/\.md$/, "");
  for (const line of String(body || "").split(/\r?\n/)) {
    for (const m of line.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
      const t = (m[1] || "").trim().replace(/\.md$/, "");
      if (t === full || t.toLowerCase() === bare.toLowerCase()) {
        const s = line.trim();
        return s.length > max ? `${s.slice(0, max - 1)}\u2026` : s;
      }
    }
  }
  return void 0;
}

export {
  GRAPH_RETRIEVAL_DEFAULTS,
  centralityBoost,
  expandWithGraph,
  backlinkContext
};
