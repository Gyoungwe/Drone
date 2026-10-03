/** Structural claim/source provenance checks; this never judges scientific truth. */

export type ClaimRelationship = "direct" | "indirect" | "hypothesis" | "unsupported";

export interface ClaimBindingSource {
	path: string;
	doi?: unknown;
	zotero_key?: unknown;
	hash: string;
	start_line: number;
	end_line: number;
	quote: string;
	original_location?: string;
	reading_basis?: string;
	originalFulltextReadThisTurn?: false;
}

export interface ClaimBinding {
	id: string;
	claim: string;
	relationship: ClaimRelationship;
	limitations: string;
	organism?: string;
	method?: string;
	sources: ClaimBindingSource[];
	supportAssessment: "model-asserted-unreviewed";
	provenanceChecked: true;
	scientificallyVerified: false;
}

export interface ClaimSourceRecord {
	path: string;
	doi?: unknown;
	zotero_key?: unknown;
	hash: string;
}

export interface ClaimReadRecord {
	hash: string;
	startLine: number;
	endLine: number;
	text: string;
}

const RELATIONSHIPS = ["direct", "indirect", "hypothesis", "unsupported"] as const;

function text(value: unknown, label: string, max = 4000): string {
	if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Invalid ${label}`);
	return value.trim();
}

/** Validate bounded claims against source/read receipts from the current scope. */
export function validateClaimBindings(
	bindings: unknown,
	sources: readonly ClaimSourceRecord[],
	reads: ReadonlyMap<string, ClaimReadRecord>,
): ClaimBinding[] {
	if (!Array.isArray(bindings) || bindings.length < 1 || bindings.length > 64)
		throw new Error("Provide 1-64 structured claim_bindings");
	const seen = new Set<string>();
	return bindings.map((raw, index) => {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid claim binding");
		const binding = raw as Record<string, unknown>;
		const claim = text(binding.claim, "claim");
		const limitations = text(binding.limitations, "limitations");
		if (seen.has(claim)) throw new Error("Duplicate claim binding");
		seen.add(claim);
		const relationship = binding.relationship;
		if (!RELATIONSHIPS.includes(relationship as ClaimRelationship))
			throw new Error("Invalid support relationship");
		if (!Array.isArray(binding.sources) || binding.sources.length > 12)
			throw new Error("Invalid claim sources");
		if (["direct", "indirect"].includes(String(relationship)) && binding.sources.length === 0)
			throw new Error("Supported claims require observed source excerpts");
		const refs = binding.sources.map((rawRef): ClaimBindingSource => {
			if (!rawRef || typeof rawRef !== "object" || Array.isArray(rawRef))
				throw new Error("Invalid claim source");
			const ref = rawRef as Record<string, unknown>;
			const path = typeof ref.path === "string" ? ref.path : "";
			const source = sources.find((candidate) => candidate.path === path);
			const read = reads.get(path);
			if (!source || !read || read.hash !== source.hash)
				throw new Error("Claim source was not read and identity-verified in this scope");
			const first = ref.start_line;
			const last = ref.end_line;
			if (
				!Number.isInteger(first) ||
				!Number.isInteger(last) ||
				(first as number) < read.startLine ||
				(last as number) < (first as number) ||
				(last as number) > read.endLine
			)
				throw new Error("Claim source range is outside the observed read");
			const quote = text(ref.quote, "source quote", 6000);
			const excerpt = read.text
				.split(/\r?\n/)
				.slice((first as number) - read.startLine, (last as number) - read.startLine + 1)
				.join("\n");
			if (!excerpt.includes(quote)) throw new Error("Claim quote does not match the observed note range");
			return {
				path: source.path,
				doi: source.doi,
				zotero_key: source.zotero_key,
				hash: source.hash,
				start_line: first as number,
				end_line: last as number,
				quote,
				...(ref.original_location
					? { original_location: text(ref.original_location, "historical original location", 600) }
					: {}),
				reading_basis: "current-scope-literature-note",
				originalFulltextReadThisTurn: false,
			};
		});
		return {
			id: `claim-${index + 1}`,
			claim,
			relationship: relationship as ClaimRelationship,
			limitations,
			...(binding.organism ? { organism: text(binding.organism, "organism", 600) } : {}),
			...(binding.method ? { method: text(binding.method, "method", 1000) } : {}),
			sources: refs,
			supportAssessment: "model-asserted-unreviewed",
			provenanceChecked: true,
			scientificallyVerified: false,
		};
	});
}

export function claimBindingRefs(
	bindings: readonly Pick<ClaimBinding, "claim" | "relationship" | "limitations" | "sources">[],
) {
	return bindings.map(
		(binding) =>
			`${binding.claim} [${binding.relationship}] -> ${binding.sources.map((source) => `${source.path}:${source.start_line}-${source.end_line}`).join(", ") || "no supporting source"}; limitation: ${binding.limitations}`,
	);
}

export const CLAIM_BINDING_SCHEMA = {
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
						original_location: { type: "string" },
					},
					required: ["path", "start_line", "end_line", "quote"],
				},
			},
		},
		required: ["claim", "relationship", "limitations", "sources"],
	},
} as const;
