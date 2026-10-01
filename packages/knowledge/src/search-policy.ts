/**
 * Pure lexical/semantic indexing policy shared by knowledge hosts.
 *
 * The worker runtime keeps a self-contained JavaScript adapter for packaged
 * CLI/electron builds, while this module is the typed source of truth for
 * tests and backend callers.
 */

/** Tokenize English/Unicode text for the SQLite FTS index. */
export function tokenizeKnowledgeText(text: string): string[] {
	const words =
		String(text)
			.normalize("NFKC")
			.toLowerCase()
			.match(/[a-z0-9][a-z0-9._+-]*|[\p{Script=Han}]+/gu) || [];
	const output: string[] = [];
	for (const word of words) {
		if (/\p{Script=Han}/u.test(word)) {
			// Include one-character and adjacent two-character Chinese terms so
			// short Chinese queries remain searchable without an external tokenizer.
			const characters = [...word];
			for (let index = 0; index < characters.length; index++) {
				const character = characters[index];
				if (!character) continue;
				output.push(character);
				const next = characters[index + 1];
				if (next) output.push(character + next);
			}
		} else output.push(word);
	}
	return output;
}

/** Build a bounded, quoted FTS5 expression from an end-user query. */
export function buildKnowledgeSearchExpression(query: string): string {
	if (typeof query !== "string" || !query.trim() || query.length > 2000)
		throw new Error("Query must contain 1–2000 characters");
	const terms = [...new Set(tokenizeKnowledgeText(query))].slice(0, 32);
	if (!terms.length) throw new Error("Query has no searchable terms");
	return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
}

/** Split note text into bounded chunks for optional semantic indexing. */
export function splitKnowledgeChunks(text: string, maxChars = 1200): string[] {
	if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > 8_000)
		throw new Error("Semantic chunk size must be an integer between 1 and 8000");
	const chunks: string[] = [];
	for (let start = 0; start < text.length && chunks.length < 64; start += maxChars)
		chunks.push(text.slice(start, start + maxChars));
	return chunks;
}
