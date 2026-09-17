/** File navigation only: never an authorization or a claim that a file exists. */
export function isLocalResourceTarget(href: string): boolean {
	return (
		!!href &&
		!Array.from(href).some((c) => c.charCodeAt(0) < 32) &&
		(/^[a-z]:[\\/]/i.test(href) || /^file:\/\//i.test(href) || !/^[a-z][a-z0-9+.-]*:/i.test(href))
	);
}
export function localResourceHref(path: string): string | undefined {
	if (!isLocalResourceTarget(path) || /^file:/i.test(path) || /^(?:\\\\|\/\/)/.test(path)) return;
	const normalized = path.replaceAll("\\", "/");
	const encoded = normalized
		.split("/")
		.map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`))
		.join("/");
	if (/^[a-z]:\//i.test(normalized)) return `file:///${normalized.slice(0, 2)}${encoded.slice(4)}`;
	return normalized.startsWith("/") ? `file://${encoded}` : `./${encoded}`;
}

/** Split a Markdown link before decoding: %23 is a filename character, # starts a fragment. */
export function splitResourceLink(href: string): { href: string; fragment?: string } {
 const at = href.indexOf("#");
 if (at < 0) return { href };
 const raw = href.slice(at + 1);
 let fragment = raw;
 try { fragment = decodeURIComponent(raw); } catch { /* preserve malformed literal fragment */ }
 return { href: href.slice(0, at), fragment };
}
export function resourceHeadingId(fragment: string): string {
 return `resource-heading-${fragment.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-|-$/g, "").slice(0, 120)}`;
}
