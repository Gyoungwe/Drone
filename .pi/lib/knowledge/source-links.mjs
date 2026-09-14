import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canRead, validateNote } from "./files.mjs";

const inside = (root, path) => {
	const r = relative(root, path);
	return !r || (!isAbsolute(r) && r !== ".." && !r.startsWith(`..${sep}`));
};
const hasControl = (text) => [...String(text)].some((char) => char.charCodeAt(0) < 32);
const label = (text) =>
	String(text)
		.replace(/[[\]<>\r\n]/g, " ")
		.slice(0, 220);
export function onlineSourceLink(value, title = "Online source") {
	const url = new URL(value);
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
		throw new Error("Expected a credential-free HTTP(S) source URL");
	return `[${label(title)}](<${url.href}>)`;
}
export async function normalizeSourceLinks(values, { cwd, vault, resultsRoot, project }) {
	if (!Array.isArray(values) || values.length > 40) throw new Error("Use at most 40 source references");
	const links = [],
		unresolved = [];
	for (const value of values) {
		let raw = String(value).trim();
		if (!raw || raw.length > 4096 || hasControl(raw)) throw new Error("Invalid source reference");
		const md = raw.match(/^\[([^\]]+)\]\(<?([^>]+?)>?\)$/);
		const title = md?.[1];
		if (md) raw = md[2];
		if (/^10\.\d{4,9}\//.test(raw)) raw = `https://doi.org/${raw}`;
		if (/^doi:/i.test(raw)) raw = `https://doi.org/${raw.slice(4).trim()}`;
		if (/^https?:/i.test(raw)) {
			links.push(onlineSourceLink(raw, title || raw));
			continue;
		}
		const zotero = raw.match(/^zotero:([A-Za-z0-9]{8})$/i);
		if (zotero) {
			links.push(`[Zotero ${zotero[1]}](zotero://select/library/items/${zotero[1]})`);
			continue;
		}
		const wiki = raw.match(/^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]$/);
		const notePath = `${(wiki?.[1] || raw).replace(/\.md$/, "")}.md`;
		if (/^(?:Wiki|Library|Projects|Inbox|Indexes)\//.test(notePath)) {
			validateNote(notePath);
			if (!canRead(notePath, project)) throw new Error("Source note is outside project scope");
			const full = resolve(vault, notePath);
			try {
				if (!inside(await realpath(vault), await realpath(full)) || !(await stat(full)).isFile())
					throw new Error("not a regular note");
				links.push(`[[${notePath.slice(0, -3)}${wiki?.[2] ? `|${label(wiki[2])}` : ""}]]`);
				continue;
			} catch {
				/* retain unresolved identifiers explicitly */
			}
		} else if (!/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("file:")) {
			try {
				const full = raw.startsWith("file:") ? fileURLToPath(raw) : resolve(cwd, raw),
					actual = await realpath(full);
				const roots = await Promise.all(
					[vault, resultsRoot].filter(Boolean).map((p) => realpath(p).catch(() => null)),
				);
				if (!roots.some((root) => root && inside(root, actual)) || !(await stat(actual)).isFile())
					throw new Error("Source file is outside Vault/results");
				links.push(`[${label(title || raw)}](<${pathToFileURL(actual).href}>)`);
				continue;
			} catch {
				/* unresolved or unsafe paths never become clickable */
			}
		}
		unresolved.push(raw);
		links.push(`\`${raw.replace(/`/g, "")}\` — unresolved reference`);
	}
	return { links, unresolved };
}
