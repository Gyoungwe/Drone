// packages/research/src/claim-bindings.ts
var RELATIONSHIPS = ["direct", "indirect", "hypothesis", "unsupported"];
function text(value, label, max = 4e3) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Invalid ${label}`);
  return value.trim();
}
function validateClaimBindings(bindings, sources, reads) {
  if (!Array.isArray(bindings) || bindings.length < 1 || bindings.length > 64)
    throw new Error("Provide 1-64 structured claim_bindings");
  const seen = /* @__PURE__ */ new Set();
  return bindings.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid claim binding");
    const binding = raw;
    const claim = text(binding.claim, "claim");
    const limitations = text(binding.limitations, "limitations");
    if (seen.has(claim)) throw new Error("Duplicate claim binding");
    seen.add(claim);
    const relationship = binding.relationship;
    if (!RELATIONSHIPS.includes(relationship))
      throw new Error("Invalid support relationship");
    if (!Array.isArray(binding.sources) || binding.sources.length > 12)
      throw new Error("Invalid claim sources");
    if (["direct", "indirect"].includes(String(relationship)) && binding.sources.length === 0)
      throw new Error("Supported claims require observed source excerpts");
    const refs = binding.sources.map((rawRef) => {
      if (!rawRef || typeof rawRef !== "object" || Array.isArray(rawRef))
        throw new Error("Invalid claim source");
      const ref = rawRef;
      const path = typeof ref.path === "string" ? ref.path : "";
      const source = sources.find((candidate) => candidate.path === path);
      const read = reads.get(path);
      if (!source || !read || read.hash !== source.hash)
        throw new Error("Claim source was not read and identity-verified in this scope");
      const first = ref.start_line;
      const last = ref.end_line;
      if (!Number.isInteger(first) || !Number.isInteger(last) || first < read.startLine || last < first || last > read.endLine)
        throw new Error("Claim source range is outside the observed read");
      const quote = text(ref.quote, "source quote", 6e3);
      const excerpt = read.text.split(/\r?\n/).slice(first - read.startLine, last - read.startLine + 1).join("\n");
      if (!excerpt.includes(quote)) throw new Error("Claim quote does not match the observed note range");
      return {
        path: source.path,
        doi: source.doi,
        zotero_key: source.zotero_key,
        hash: source.hash,
        start_line: first,
        end_line: last,
        quote,
        ...ref.original_location ? { original_location: text(ref.original_location, "historical original location", 600) } : {},
        reading_basis: "current-scope-literature-note",
        originalFulltextReadThisTurn: false
      };
    });
    return {
      id: `claim-${index + 1}`,
      claim,
      relationship,
      limitations,
      ...binding.organism ? { organism: text(binding.organism, "organism", 600) } : {},
      ...binding.method ? { method: text(binding.method, "method", 1e3) } : {},
      sources: refs,
      supportAssessment: "model-asserted-unreviewed",
      provenanceChecked: true,
      scientificallyVerified: false
    };
  });
}
function claimBindingRefs(bindings) {
  return bindings.map(
    (binding) => `${binding.claim} [${binding.relationship}] -> ${binding.sources.map((source) => `${source.path}:${source.start_line}-${source.end_line}`).join(", ") || "no supporting source"}; limitation: ${binding.limitations}`
  );
}
var CLAIM_BINDING_SCHEMA = {
  type: "array",
  minItems: 1,
  maxItems: 64,
  items: {
    type: "object",
    properties: {
      claim: { type: "string" },
      relationship: { type: "string", enum: [...RELATIONSHIPS] },
      organism: { type: "string" },
      method: { type: "string" },
      limitations: { type: "string" },
      sources: {
        type: "array",
        maxItems: 12,
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            start_line: { type: "integer", minimum: 1 },
            end_line: { type: "integer", minimum: 1 },
            quote: { type: "string" },
            original_location: { type: "string" }
          },
          required: ["path", "start_line", "end_line", "quote"]
        }
      }
    },
    required: ["claim", "relationship", "limitations", "sources"]
  }
};
export {
  CLAIM_BINDING_SCHEMA,
  claimBindingRefs,
  validateClaimBindings
};
