/** Structural provenance validation, NOT a judgment that a scientific claim is true. */
export function validateClaimBindings(bindings, sources, reads) {
	if (!Array.isArray(bindings) || bindings.length < 1 || bindings.length > 64)
		throw new Error("Provide 1-64 structured claim_bindings");
	const seen = new Set();
	const text = (value, label, max = 4000) => {
		if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Invalid ${label}`);
		return value.trim();
	};
	return bindings.map((b, i) => {
		if (!b || typeof b !== "object") throw new Error("Invalid claim binding");
		const claim = text(b.claim, "claim"),
			limitations = text(b.limitations, "limitations");
		if (seen.has(claim)) throw new Error("Duplicate claim binding");
		seen.add(claim);
		if (!["direct", "indirect", "hypothesis", "unsupported"].includes(b.relationship))
			throw new Error("Invalid support relationship");
		if (!Array.isArray(b.sources) || b.sources.length > 12) throw new Error("Invalid claim sources");
		if (["direct", "indirect"].includes(b.relationship) && !b.sources.length)
			throw new Error("Supported claims require observed source excerpts");
		const refs = b.sources.map((ref) => {
			const source = sources.find((s) => s.path === ref.path),
				read = reads.get(ref.path);
			if (!source || !read || read.hash !== source.hash)
				throw new Error("Claim source was not read and identity-verified in this scope");
			const first = ref.start_line,
				last = ref.end_line;
			if (
				!Number.isInteger(first) ||
				!Number.isInteger(last) ||
				first < read.startLine ||
				last < first ||
				last > read.endLine
			)
				throw new Error("Claim source range is outside the observed read");
			const quote = text(ref.quote, "source quote", 6000);
			const excerpt = read.text
				.split(/\r?\n/)
				.slice(first - read.startLine, last - read.startLine + 1)
				.join("\n");
			if (!excerpt.includes(quote)) throw new Error("Claim quote does not match the observed note range");
			return {
				path: source.path,
				doi: source.doi,
				zotero_key: source.zotero_key,
				hash: source.hash,
				start_line: first,
				end_line: last,
				quote,
				...(ref.original_location
					? { original_location: text(ref.original_location, "historical original location", 600) }
					: {}),
				reading_basis: "current-scope-literature-note",
				originalFulltextReadThisTurn: false,
			};
		});
		return {
			id: `claim-${i + 1}`,
			claim,
			relationship: b.relationship,
			limitations,
			...(b.organism ? { organism: text(b.organism, "organism", 600) } : {}),
			...(b.method ? { method: text(b.method, "method", 1000) } : {}),
			sources: refs,
			supportAssessment: "model-asserted-unreviewed",
			provenanceChecked: true,
			scientificallyVerified: false,
		};
	});
}
export const claimBindingRefs = (bindings) =>
	bindings.map(
		(b) =>
			`${b.claim} [${b.relationship}] -> ${b.sources.map((s) => `${s.path}:${s.start_line}-${s.end_line}`).join(", ") || "no supporting source"}; limitation: ${b.limitations}`,
	);
export const CLAIM_BINDING_SCHEMA = {
	type: "array",
	minItems: 1,
	maxItems: 64,
	items: {
		type: "object",
		properties: {
			claim: { type: "string" },
			relationship: { type: "string", enum: ["direct", "indirect", "hypothesis", "unsupported"] },
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
						original_location: { type: "string" },
					},
					required: ["path", "start_line", "end_line", "quote"],
				},
			},
		},
		required: ["claim", "relationship", "limitations", "sources"],
	},
};
