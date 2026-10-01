// Self-contained runtime adapter for packaged CLI/electron builds. Keep this
// file dependency-free; the typed source lives in packages/knowledge.
export function tokenizeKnowledgeText(text) {
	const words =
		String(text)
			.normalize("NFKC")
			.toLowerCase()
			.match(/[a-z0-9][a-z0-9._+-]*|[\p{Script=Han}]+/gu) || [];
	const output = [];
	for (const word of words) {
		if (/\p{Script=Han}/u.test(word)) {
			const characters = [...word];
			for (let index = 0; index < characters.length; index++) {
				output.push(characters[index]);
				if (index + 1 < characters.length) output.push(characters[index] + characters[index + 1]);
			}
		} else output.push(word);
	}
	return output;
}

export function buildKnowledgeSearchExpression(query) {
	if (typeof query !== "string" || !query.trim() || query.length > 2000)
		throw new Error("Query must contain 1–2000 characters");
	const terms = [...new Set(tokenizeKnowledgeText(query))].slice(0, 32);
	if (!terms.length) throw new Error("Query has no searchable terms");
	return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
}

export function splitKnowledgeChunks(text, maxChars = 1200) {
	if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > 8000)
		throw new Error("Semantic chunk size must be an integer between 1 and 8000");
	const chunks = [];
	for (let start = 0; start < text.length && chunks.length < 64; start += maxChars)
		chunks.push(text.slice(start, start + maxChars));
	return chunks;
}
