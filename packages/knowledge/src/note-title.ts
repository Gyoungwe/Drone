import { parseFrontmatter } from "./ingest-frontmatter";

const clean = (value: unknown) =>
	typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 200) : "";

/** A title that is really a file name ("PMC7022188.1.pdf", "lora-2106-09685") says nothing about the content. */
export function looksLikeFileName(title: string): boolean {
	const value = String(title || "").trim();
	if (!value) return true;
	if (/\.(?:pdf|html?|md|txt|docx?|xlsx?|csv|json|zip|tar|gz)$/i.test(value)) return true;
	if (/^(?:PMC|PMID)?\d[\d.]*$/i.test(value)) return true;
	return /^[a-z0-9]+(?:[-_][a-z0-9]+){2,}$/.test(value) && /\d{4,}|[a-f0-9]{12,}/.test(value);
}

/**
 * Node/display title for a Vault note: an explicit `topic` written at ingestion wins,
 * then frontmatter `title`, then the first H1, then the file name.
 */
export function noteDisplayTitle(text: string, path: string): string {
	let data: Record<string, unknown> | null = null;
	try {
		data = parseFrontmatter(text).data as Record<string, unknown> | null;
	} catch {
		data = null;
	}
	const topic = clean(data?.topic);
	if (topic) return topic;
	const title = clean(data?.title);
	const heading = clean(text.match(/^#\s+(.+)$/m)?.[1]);
	if (title && (!heading || looksLikeFileName(heading))) return title;
	return heading || title || path.split("/").at(-1)?.replace(/\.md$/i, "") || path;
}
