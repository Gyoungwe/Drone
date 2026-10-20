const FRONTMATTER = /^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/u;

/**
 * Text shown in the knowledge note viewer: metadata is not content, so hide the top frontmatter and the
 * agent-managed marker comments, and skip a header that an older writer duplicated inside the managed
 * block (its own frontmatter and the same `# Title` right under the page title).
 */
export function noteDisplayText(raw: string): string {
	let text = raw.replace(/^﻿/u, "").replace(FRONTMATTER, "").replace(/^\s+/u, "");
	text = text.replace(/^<!-- pi-agent:managed:(?:start|end) -->[ \t]*\n?/gmu, "");
	const title = text.match(/^#[ \t]+([^\n]+)\n/u);
	if (!title?.[1]) return text;
	const head = title[0];
	let rest = text.slice(head.length).replace(/^\s+/u, "").replace(FRONTMATTER, "").replace(/^\s+/u, "");
	const repeated = rest.match(/^#[ \t]+([^\n]+)(?:\n|$)/u);
	if (repeated?.[1]) {
		const a = title[1].trim();
		const b = repeated[1].trim();
		if (a === b || a.startsWith(b) || b.startsWith(a))
			rest = rest.slice(repeated[0].length).replace(/^\s+/u, "");
	}
	return `${head}\n${rest}`;
}
