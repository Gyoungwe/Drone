// @ts-nocheck
// packages/knowledge/src/semantic-model.ts
var WIDTH = 720;
var HEIGHT = 440;
var INFRASTRUCTURE = /(?:^|\/)(?:Index|Context|Home|Template|Templates)\.md$/i;
var PAPER_PATH = /^(?:Library\/Papers|Projects\/[^/]+\/Papers)\//i;
function isInfrastructureNode(node) {
  return node.kind === "navigation" || INFRASTRUCTURE.test(node.path);
}
function nodeType(node) {
  if (isInfrastructureNode(node)) return "infrastructure";
  if (node.kind === "wiki") return "wiki";
  return "note";
}
function classifyRelation(source, target, type) {
  if (type) return type;
  const sourceDir = source.path.slice(0, source.path.lastIndexOf("/"));
  const targetDir = target.path.slice(0, target.path.lastIndexOf("/"));
  return sourceDir && sourceDir === targetDir ? "directory" : "link";
}
function normalizeIdentity(value) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "");
  return normalized || null;
}
function fallbackIdentity(node) {
  if (node.identity) return normalizeIdentity(node.identity);
  if (!PAPER_PATH.test(node.path)) return null;
  const title = node.title.trim().toLowerCase().replace(/\s+/g, " ");
  return title.length >= 8 ? `title:${title}` : null;
}
function canonicalRank(path) {
  return [path.startsWith("Library/") ? 0 : path.startsWith("Projects/") ? 1 : 2, path];
}
function comparePath(a, b) {
  return a.localeCompare(b);
}
function hash(value, seed = 42) {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}
function assignCommunities(paths, edges, seed = 42) {
  const ordered = [...new Set(paths)].sort(comparePath);
  const adjacency = new Map(ordered.map((path) => [path, /* @__PURE__ */ new Set()]));
  for (const edge of edges) {
    if (edge.type !== "link" || !adjacency.has(edge.source) || !adjacency.has(edge.target)) continue;
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }
  const labels = new Map(ordered.map((path, index) => [path, index]));
  const degree = new Map(ordered.map((path) => [path, adjacency.get(path)?.size ?? 0]));
  const total = [...degree.values()].reduce((sum, value) => sum + value, 0) || 1;
  for (let round = 0; round < 12; round++) {
    let changed = false;
    for (const path of ordered) {
      const neighbours = [...adjacency.get(path) ?? []].sort(comparePath);
      if (!neighbours.length) continue;
      const scores = /* @__PURE__ */ new Map();
      for (const neighbour of neighbours) {
        const label = labels.get(neighbour) ?? 0;
        scores.set(label, (scores.get(label) ?? 0) + 1 - (degree.get(path) ?? 0) * (degree.get(neighbour) ?? 0) / total);
      }
      const current = labels.get(path) ?? 0;
      const best = [...scores.entries()].sort((a, b) => b[1] - a[1] || hash(`${path}:${a[0]}`, seed) - hash(`${path}:${b[0]}`, seed) || a[0] - b[0])[0];
      if (best && best[1] > 0 && best[0] !== current) {
        labels.set(path, best[0]);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const counts = /* @__PURE__ */ new Map();
  for (const label of labels.values()) counts.set(label, (counts.get(label) ?? 0) + 1);
  const rank = new Map([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([label], index) => [label, index]));
  return Object.fromEntries(ordered.map((path) => [path, degree.get(path) ?? 0 ? rank.get(labels.get(path) ?? -1) ?? -1 : -1]));
}
function createSemanticModel(input, options = {}) {
  const view = options.view ?? "semantic";
  const mergeMirrors = options.mergeMirrors ?? true;
  const seed = options.seed ?? 42;
  const sourceNodes = [...input.nodes].sort((a, b) => comparePath(a.path, b.path));
  const visible = sourceNodes.filter((node) => view === "all" || !isInfrastructureNode(node));
  const groups = /* @__PURE__ */ new Map();
  for (const node of visible) {
    const identity = fallbackIdentity(node);
    if (mergeMirrors && identity) {
      const group = groups.get(identity) ?? [];
      group.push(node);
      groups.set(identity, group);
    }
  }
  const canonicalFor = /* @__PURE__ */ new Map();
  const duplicates = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a, b) => {
      const [ar, ap] = canonicalRank(a.path);
      const [br, bp] = canonicalRank(b.path);
      return ar - br || ap.localeCompare(bp);
    });
    const first = ordered[0];
    if (!first) continue;
    const canonical = first.path;
    for (const node of ordered) {
      canonicalFor.set(node.path, canonical);
      if (node.path !== canonical) duplicates.push({ canonical, duplicate: node.path });
    }
  }
  const modelNodes = /* @__PURE__ */ new Map();
  for (const node of visible) {
    const canonical = canonicalFor.get(node.path) ?? node.path;
    if (!modelNodes.has(canonical)) modelNodes.set(canonical, node);
  }
  const relations = [];
  for (const raw of input.edges ?? []) {
    const source = canonicalFor.get(raw.source) ?? raw.source;
    const target = canonicalFor.get(raw.target) ?? raw.target;
    if (source === target || !modelNodes.has(source) || !modelNodes.has(target)) continue;
    const type = classifyRelation({ path: source }, { path: target }, raw.type);
    if (!relations.some((edge) => edge.source === source && edge.target === target && edge.type === type)) relations.push({ source, target, type });
  }
  if (view === "all") {
    const all = [...modelNodes.keys()].sort(comparePath);
    const siblings = /* @__PURE__ */ new Map();
    for (const path of all) {
      const parent = path.slice(0, path.lastIndexOf("/"));
      const group = siblings.get(parent) ?? [];
      group.push(path);
      siblings.set(parent, group);
    }
    for (const group of siblings.values()) {
      for (let i = 1; i < group.length; i++) {
        const source = group[i - 1];
        const target = group[i];
        if (source && target && !relations.some((edge) => edge.source === source && edge.target === target)) relations.push({ source, target, type: "directory" });
      }
    }
  }
  for (const duplicate of duplicates) relations.push({ source: duplicate.canonical, target: duplicate.duplicate, type: "duplicate" });
  const communities = assignCommunities([...modelNodes.keys()], relations, seed);
  const communitySizes = /* @__PURE__ */ new Map();
  for (const community of Object.values(communities)) if (community >= 0) communitySizes.set(community, (communitySizes.get(community) ?? 0) + 1);
  const communityCount = Math.max(1, communitySizes.size);
  const layout = {};
  for (const path of [...modelNodes.keys()].sort(comparePath)) {
    const community = communities[path] ?? -1;
    const centerAngle = community >= 0 ? 2 * Math.PI * community / communityCount : 2 * Math.PI * hash(path, seed);
    const radius = community >= 0 ? 75 + 24 * hash(`${path}:r`, seed) : 150 + 35 * hash(`${path}:r`, seed);
    const jitter = 2 * Math.PI * hash(`${path}:a`, seed);
    layout[path] = { x: WIDTH / 2 + radius * Math.cos(centerAngle) + 18 * Math.cos(jitter), y: HEIGHT / 2 + radius * Math.sin(centerAngle) + 18 * Math.sin(jitter) };
  }
  const linkRelations = relations.filter((edge) => edge.type === "link");
  const degree = /* @__PURE__ */ new Map();
  for (const edge of linkRelations) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  const nodes = [...modelNodes.entries()].sort(([a], [b]) => comparePath(a, b)).map(([path, node]) => {
    const mirrorPaths = [...canonicalFor.entries()].filter(([, canonical]) => canonical === path).map(([mirror]) => mirror).filter((mirror) => mirror !== path).sort(comparePath);
    const type = nodeType(node);
    return { path, title: node.title, kind: node.kind, degree: degree.get(path) ?? 0, nodeType: mirrorPaths.length ? "mirror" : type, isInfrastructure: type === "infrastructure", community: communities[path] ?? -1, ...layout[path] ?? { x: WIDTH / 2, y: HEIGHT / 2 }, ...mirrorPaths.length ? { mirrors: mirrorPaths, warnings: ["mirror"] } : {} };
  });
  return { nodes, edges: linkRelations.map(({ source, target }) => ({ source, target })), relations, duplicates, communities, layout };
}

export {
  isInfrastructureNode,
  nodeType,
  classifyRelation,
  assignCommunities,
  createSemanticModel
};
