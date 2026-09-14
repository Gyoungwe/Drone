// Small deterministic delivery contract. It does not pretend a heuristic establishes completeness.
export function deliveryContract(prompt, { showMeAvailable = false } = {}) {
	const text = String(prompt || "");
	const manual = /说明书|使用手册|命令|参数|manual|command.line|reference/i.test(text);
	const paper = /论文|文章|文献|paper|article|research/i.test(text);
	const software = manual || /软件|程序|software|package/i.test(text);
	const requested =
		manual || (/下载|沉淀|介绍|讲解|解释|download|explain|summariz/i.test(text) && (paper || software));
	if (!requested) return null;
	return {
		kind: software && paper ? "mixed" : software ? "software" : "research",
		showMeAvailable,
		guidance: [
			"Reply to the user's question with what was found, read, archived, and any remaining gaps. Saving files is not the final reply.",
			manual
				? "Manual means version-matched executable/CLI reference: purpose, installation prerequisites, input/output, minimal command example, important options/defaults/constraints, errors, and links to the actual reference chapters. A homepage or TOC is only a starting page. Follow relevant same-site links in a bounded way; do not mirror the entire site."
				: "",
			software
				? "For software explain the principle and applicability, including supported DNA/RNA/protein data types. Do not treat a protein-only paper as direct DNA evidence. Separate author-reported benchmarks from local measurements; report not tested when no actual test was run. Only run authorized, bounded tests; record version, environment, dataset, command, elapsed time and limitations."
				: "",
			paper
				? "For each selected research paper explain its question, main claims, methods, evidence and limitations; do not substitute bibliographic metadata or a download manifest for reading."
				: "",
			showMeAvailable
				? "Use the loaded show-me skill (or the bundled research-show-me fallback) for a focused explainer after reading the sources. Resolve and read its actual SKILL.md from the available skill catalog; save one HTML/Markdown explainer under this task run and link it in the visible final answer. Prefer the authorized knowledge-explainer host worker in automatic mode after summary save; do not launch a recursive model/run or duplicate its output. If handling the explanation directly, after creating it, archive it with research_archive_explainer using the active research run metadata.topic_id when available (reuse it across rounds) and the actual evidence notes read this turn; this produces a searchable Library/Explainers pointer plus a versioned attachment, but it remains presentation-only."
				: "The show-me skill and its bundled research-show-me fallback are not loaded. Report this honestly; deliver the same explanation as Markdown rather than claiming the skill ran.",
			"Cite exact sources and versions. Do not invent defaults, performance, or full-manual coverage. Answer the user's question; do not explain Vault or evidence-gate policy.",
		]
			.filter(Boolean)
			.join("\n"),
	};
}
export function assessManualPage(bytes, contentType, url) {
	if (!/html/i.test(contentType || ""))
		return {
			status: "document-unassessed",
			complete: false,
			candidates: [],
			note: "Content completeness and version still need inspection.",
		};
	const html = Buffer.from(bytes).toString("utf8").slice(0, 250000);
	const text = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ");
	const flags = [...new Set(text.match(/(?:^|\s)-{1,2}[a-zA-Z][a-zA-Z0-9_-]{2,}/g) || [])];
	const candidates = [];
	for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
		try {
			const resolved = new URL(match[1].replace(/&amp;/g, "&"), url),
				base = new URL(url);
			resolved.hash = "";
			const title = match[2]
				.replace(/<[^>]*>/g, " ")
				.replace(/\s+/g, " ")
				.trim()
				.slice(0, 160);
			if (
				resolved.origin !== base.origin ||
				!/^https?:$/.test(resolved.protocol) ||
				resolved.username ||
				resolved.password
			)
				continue;
			if (
				!/manual|option|command|parameter|usage|align|install|reference/i.test(
					`${title} ${resolved.pathname}`,
				) ||
				resolved.href === base.href ||
				candidates.some((c) => c.url === resolved.href)
			)
				continue;
			candidates.push({ url: resolved.href, title });
			if (candidates.length >= 12) break;
		} catch {
			/* untrusted links */
		}
	}
	return {
		status: flags.length >= 5 ? "reference-page-only" : "landing-or-overview-page",
		complete: false,
		optionCount: flags.length,
		candidates,
		note: "Heuristic page classification, not a completeness or scientific verification result.",
	};
}
