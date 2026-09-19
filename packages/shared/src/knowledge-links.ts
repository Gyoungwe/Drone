/** Display-only conversion: never change saved content or code examples. */
const PREFIX = "#drone-note=";
export function parseKnowledgeHref(href: string): string | null {
	if (!href.startsWith(PREFIX)) return null;
	try {
		const path = decodeURIComponent(href.slice(PREFIX.length));
		return /^(?:Wiki|Library|Projects|Inbox|Indexes)\//.test(path) &&
			!path.split("/").some((p) => p === ".." || p === "." || p.startsWith(".")) &&
			!path.includes("\\") &&
			![...path].some((char) => char.charCodeAt(0) < 32)
			? path
			: null;
	} catch {
		return null;
	}
}
/**
 * Reader-facing label for a Vault path that has no explicit alias.
 * Vault filenames are often slugified titles with a content hash suffix, e.g.
 * "Library/Papers/edger-a-bioconductor-package-...-ec996d3ae6a33ca7.md". Inlining that
 * whole path breaks the reading flow of long answers, so show a short stem and keep the
 * full path in the href. Display only: the underlying citation is never rewritten.
 */
export function knowledgeLinkLabel(path: string): string {
	const bare = path.replace(/\.md$/i, "");
	// Short paths stay fully qualified: the folder tells the reader whether this is a
	// paper, a Wiki page or a project run, and that context is worth the characters.
	if (bare.length <= 48) return bare;
	const stem = bare.split("/").pop() || bare;
	// Drop a trailing content-hash segment (>=12 hex chars) added at import time.
	const withoutHash = stem.replace(/-[0-9a-f]{12,}$/i, "");
	const base = (withoutHash || stem).replace(/[-_]+/g, " ");
	if (base.length <= 40) return base;
	// Cut on a word boundary so a truncated label stays readable.
	const cut = base.slice(0, 40);
	const boundary = cut.lastIndexOf(" ");
	return `${(boundary >= 20 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}
export function knowledgeLinksForDisplay(markdown: string): string {
	// Consume fenced/inline code before recognizing a Vault link.
	return markdown.replace(
		/(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\1[^\n]*|$)|(`+)[\s\S]*?\2|\[\[([^\]\n]+)\]\]/g,
		(whole, _fence, _inline, inner: string | undefined) => {
			if (!inner) return whole;
			const [target, ...labels] = inner.split("|"),
				raw = (target || "").split("#")[0]?.trim() || "";
			if (!/^(?:Wiki|Library|Projects|Inbox|Indexes)\//.test(raw)) return whole;
			const path = raw.endsWith(".md") ? raw : `${raw}.md`,
				href = PREFIX + encodeURIComponent(path);
			if (!parseKnowledgeHref(href)) return whole;
			const label = (labels.join("|") || knowledgeLinkLabel(path)).replace(/[[\]<>]/g, "");
			const title = path.replace(/"/g, '\\"');
			return `[${label}](${href} "${title}")`;
		},
	);
}
