const normalize = (value) =>
	String(value ?? "")
		.normalize("NFKC")
		.toLowerCase()
		// biome-ignore lint/suspicious/noControlCharactersInRegex: strip control bytes from untrusted claim text
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

const tokens = (value) =>
	new Set(
		normalize(value)
			.split(/\s+/)
			.filter((token) => token.length > 1),
	);
const overlap = (left, right) => {
	const a = tokens(left),
		b = tokens(right);
	if (!a.size || !b.size) return 0;
	let common = 0;
	for (const token of a) if (b.has(token)) common++;
	return common / Math.max(a.size, b.size);
};

function polarity(value) {
	const text = normalize(value);
	return /\b(?:not|no|without|does not|do not|fails|decrease|decreased|inhibits|inhibit)\b|不|无|未|抑制|降低/.test(
		text,
	)
		? "negative"
		: "positive";
}

function withoutNegation(value) {
	return normalize(value).replace(
		/\b(?:does not|do not|not|no|without|fails|decreased|decrease|inhibits|inhibit)\b|不|无|未|抑制|降低/g,
		" ",
	);
}

const field = (claim, key) => normalize(claim?.[key]);

/**
 * Compare a newly supplied claim with the prior claim for one topic.
 * Missing or non-comparable conditions stay unresolved; only same-condition
 * opposite observations can block a write.
 */
export function compareClaims(previous, incoming) {
	if (!previous || !incoming) {
		return {
			relation: "unresolved",
			confidence: "low",
			reason: "缺少一方结构化主张，无法比较。",
			blocking: false,
		};
	}
	if (
		field(previous, "subject") !== field(incoming, "subject") ||
		field(previous, "predicate") !== field(incoming, "predicate")
	)
		return {
			relation: "unresolved",
			confidence: "low",
			reason: "主语或谓词不同，不能视为同一命题。",
			blocking: false,
		};
	const conditions = ["organism", "tissue", "stage", "method"];
	const changed = conditions.filter(
		(key) => field(previous, key) && field(incoming, key) && field(previous, key) !== field(incoming, key),
	);
	if (changed.length)
		return {
			relation: "unresolved",
			confidence: "medium",
			reason: `实验条件不同（${changed.join("、")}），需要按条件并列解释。`,
			blocking: false,
		};
	if (field(previous, "relation") !== "observation" || field(incoming, "relation") !== "observation")
		return {
			relation: "unresolved",
			confidence: "medium",
			reason: "解释或假设不能直接推翻观察结果。",
			blocking: false,
		};
	const priorValue = withoutNegation(`${previous.predicate} ${previous.value || previous.claim}`);
	const nextValue = withoutNegation(`${incoming.predicate} ${incoming.value || incoming.claim}`);
	if (overlap(priorValue, nextValue) < 0.5)
		return {
			relation: "unresolved",
			confidence: "low",
			reason: "命题内容相似度不足，交由人工判断。",
			blocking: false,
		};
	if (polarity(previous.value || previous.claim) === polarity(incoming.value || incoming.claim))
		return {
			relation: "supports",
			confidence: "medium",
			reason: "同条件下方向一致，可并列保留。",
			blocking: false,
		};
	return {
		relation: "contradicts",
		confidence: "high",
		reason: "同一对象、同一条件、同一观察命题的方向相反。",
		blocking: true,
	};
}

export function compareClaimSets(previousClaims = [], incomingClaims = []) {
	const comparisons = [];
	for (const incoming of incomingClaims) {
		for (const previous of previousClaims) {
			const result = compareClaims(previous, incoming);
			if (result.relation !== "unresolved") comparisons.push({ previous, incoming, ...result });
		}
	}
	return comparisons;
}
