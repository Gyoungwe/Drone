import { filePreviewDirectory } from "@drone/shared";

export function filterResearchPaths(paths: readonly string[], query: string): string[] {
	const needle = query.trim().toLocaleLowerCase();
	return needle ? paths.filter((path) => path.toLocaleLowerCase().includes(needle)) : [...paths];
}

function normalizeAbsolutePath(path: string): string {
	const normalized = path.replaceAll("\\", "/");
	const drive = /^[a-z]:\//i.test(normalized)
		? normalized.slice(0, 3)
		: normalized.startsWith("/")
			? "/"
			: "";
	const body = drive ? normalized.slice(drive.length) : normalized;
	const segments: string[] = [];
	for (const segment of body.split("/")) {
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			if (segments.length) segments.pop();
			continue;
		}
		segments.push(segment);
	}
	return `${drive}${segments.join("/")}` || drive || ".";
}

/** Resolve a document link and return a project-root-relative path when confined. */
export function normalizeProjectLink(
	href: string,
	currentFilePath: string,
	projectRoot: string,
): string | null {
	let decoded = href;
	try {
		decoded = decodeURIComponent(href);
	} catch {
		return null;
	}
	const normalizedHref = decoded.replaceAll("\\", "/");
	if (/^(?:file:|[a-z]:[\\/]|\/)/i.test(normalizedHref)) return null;
	const root = normalizeAbsolutePath(projectRoot).replace(/\/$/, "");
	const current = normalizeAbsolutePath(currentFilePath);
	const base = current === root ? root : filePreviewDirectory(current);
	const target = normalizeAbsolutePath(`${base}/${normalizedHref}`);
	const comparisonRoot = /^[a-z]:/i.test(root) ? root.toLocaleLowerCase() : root;
	const comparisonTarget = /^[a-z]:/i.test(target) ? target.toLocaleLowerCase() : target;
	if (comparisonTarget !== comparisonRoot && !comparisonTarget.startsWith(`${comparisonRoot}/`)) return null;
	const relative = target.slice(root.length).replace(/^\/+/, "");
	return relative || null;
}
