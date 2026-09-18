/** File navigation only: never an authorization or a claim that a file exists. */
export function isLocalResourceTarget(href: string): boolean {
	if (!href || Array.from(href).some((c) => c.charCodeAt(0) < 32)) return false;
	// Markdown producers sometimes percent-encode Windows separators before the
	// link reaches the renderer (C:%5CUsers%5C...). Decode only for routing
	// classification; resolveResourcePath performs the same decode before I/O.
	let candidate = href;
	try {
		candidate = decodeURIComponent(href);
	} catch {
		// Keep the original candidate so malformed URLs remain subject to the
		// protocol check below instead of being treated as local files.
	}
	return (
		/^[a-z]:[\\/]/i.test(candidate) ||
		/^file:\/\//i.test(candidate) ||
		!/^([a-z][a-z0-9+.-]*):/i.test(candidate)
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
	try {
		fragment = decodeURIComponent(raw);
	} catch {
		/* preserve malformed literal fragment */
	}
	return { href: href.slice(0, at), fragment };
}
export function resourceHeadingId(fragment: string): string {
	return `resource-heading-${fragment
		.toLowerCase()
		.replace(/[^\p{L}\p{N}_-]+/gu, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 120)}`;
}
