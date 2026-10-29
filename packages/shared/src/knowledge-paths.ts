/**
 * Host-side limits and path contract for explicit WebDAV knowledge transfers.
 *
 * The generic knowledge package owns its own Vault implementation; this file is
 * only the public boundary used by the host's WebDAV transport so the host does
 * not load the optional package just to validate a user-supplied path.
 */
export const KNOWLEDGE_MAX_NOTE_BYTES = 1024 * 1024;

const OMIT = new Set([
	"node_modules",
	"dist",
	"build",
	"out",
	"coverage",
	"vendor",
	"venv",
	"__pycache__",
	"Attachments",
	"Templates",
	"_template",
]);

const RESERVED = ["Projects", "Library", "Wiki", "Attachments", "Templates", "Indexes", "Inbox"];

function allowedSegment(name: string): boolean {
	return (
		!!name &&
		!name.startsWith(".") &&
		!OMIT.has(name) &&
		!/^(?:secrets?|credentials?|id_rsa|id_ed25519)(?:[.\-_]|$)/i.test(name)
	);
}

/** Validate a Vault-relative Markdown note path at the host trust boundary. */
export function validateKnowledgeNotePath(path: unknown): string {
	if (
		typeof path !== "string" ||
		path.startsWith("/") ||
		/^[A-Za-z]:[\\/]/.test(path) ||
		path.includes("\\") ||
		!path.endsWith(".md") ||
		!path.split("/").every(allowedSegment)
	)
		throw new Error("Expected an allowed Vault-relative Markdown path");
	const first = path.split("/")[0] ?? "";
	if (RESERVED.some((name) => name.toLowerCase() === first.toLowerCase() && name !== first))
		throw new Error("Reserved Vault directories require canonical casing");
	return path;
}
