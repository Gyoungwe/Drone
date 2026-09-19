// Small deterministic delivery contract. It does not pretend a heuristic establishes completeness.
export function requiresPaperEvidence(prompt) {
	return /文献|论文|比较基因组|研究设计|研究方案|literature|research (?:design|plan)|comparative genomics|paper/i.test(
		String(prompt || ""),
	);
}
export function hasPaperCitation(sources) {
	return sources.some(
		(source) => /^Library\/Papers\/[^\r\n]+\.md$/.test(source.path || "") && source.paperDois?.length > 0,
	);
}
export const RESEARCH_ANSWER_GUIDANCE =
	"Write the visible answer as a scientist-facing research memo, not an internal execution log. Start the visible answer with the scientific conclusion or best current interpretation in 3–5 lines, then state the evidence level and one default recommendation with the reason it is the best next move. Explicitly separate what the current evidence supports, what it cannot establish, and which primary evidence would most improve the decision. If the user asks for a plan, give a usable research design before discussing retrieval or storage. Ask the user only about choices that materially change the scientific design; when several follow-up actions are possible, choose and explain a recommended default instead of asking the user to pick an internal task. Do not expose internal workflow terms such as claims binding, evidence gate, Vault, host, archive, Wiki, deposition, receipts, or note paths anywhere in the visible answer. Translate source status into research language such as ‘目前结论主要来自综述和整理材料’ or ‘该机制尚缺少原始论文直接核验’. Keep file writes, indexing, and knowledge-base maintenance invisible unless the user explicitly asks for them; if they must be mentioned, use one human-facing sentence after the scientific answer and never turn them into the main next step. Keep limitations decision-relevant and say what can proceed now, what should remain provisional, and what evidence should be added next.";
export const PAPER_EVIDENCE_GUIDANCE =
	"For research design, give a short provisional plan first, then a bounded evidence pass. Support each key scientific claim with a specific original paper: author/year, DOI, exact section/figure/page actually read, organism, method, result and limitations. Cite the corresponding source beside the claim; keep long storage paths out of the main prose when a short title/year citation is available. Wiki is orientation, not a substitute for original papers. Separate reported findings from your proposed design and cross-species hypotheses. Distinguish signaling ligands (Wg, Dpp, Hh), DNA-binding transcription factors and cofactors; do not scan ligand or cofactor motifs as if they were DNA-binding TFs. For motif analysis use supported downstream DNA-binding factors (e.g. Sd, Pan/TCF, Mad, Ci), verify the relevant motif model, and do not treat a motif hit as occupancy or causality. When dual-library deposition is authorized, reuse exact DOI matches, import metadata and only legally open fulltext to Zotero, and deposit an interpreted linked source note to the bound knowledge base. Verify both destinations with research_verify_literature; a run download or source manifest is NOT Zotero import. Report metadata-only, missing fulltext, unavailable, and partial destinations as evidence limitations, not as the main result. Do not retry a write after an uncertain response until reading back the DOI. Never call storage or bibliographic checks scientific verification.";
export function deliveryContract(prompt, { showMeAvailable = false, researchContinuation = false } = {}) {
	const text = String(prompt || "");
	const readOnly = /只读|read[- ]only/i.test(text);
	const wantsExplainer =
		!readOnly &&
		/说明书|使用手册|介绍|讲解|解释|图解|可视化|演示|show.?me|explainer|explain|summariz/i.test(text);
	const manual = /说明书|使用手册|命令|参数|manual|command.line|reference/i.test(text);
	const paper = researchContinuation || requiresPaperEvidence(text) || /文章|article|research/i.test(text);
	const software = manual || /软件|程序|software|package/i.test(text);
	const requested =
		manual ||
		researchContinuation ||
		requiresPaperEvidence(text) ||
		(/下载|沉淀|介绍|讲解|解释|download|explain|summariz/i.test(text) && (paper || software));
	if (!requested) return null;
	return {
		kind: software && paper ? "mixed" : software ? "software" : "research",
		showMeAvailable,
		guidance: [
			paper ? PAPER_EVIDENCE_GUIDANCE : "",
			paper ? RESEARCH_ANSWER_GUIDANCE : "",
			"Answer the scientific question first. If a record of sources or operational follow-up is relevant, keep it to one short human-facing note after the conclusion; operational delivery is not the scientific answer.",
			manual
				? "Manual means version-matched executable/CLI reference: purpose, installation prerequisites, input/output, minimal command example, important options/defaults/constraints, errors, and links to the actual reference chapters. A homepage or TOC is only a starting page. Follow relevant same-site links in a bounded way; do not mirror the entire site."
				: "",
			software
				? "For software explain the principle and applicability, including supported DNA/RNA/protein data types. Do not treat a protein-only paper as direct DNA evidence. Separate author-reported benchmarks from local measurements; report not tested when no actual test was run. Only run authorized, bounded tests; record version, environment, dataset, command, elapsed time and limitations."
				: "",
			paper
				? "For each selected research paper explain its question, main claims, methods, evidence and limitations; do not substitute bibliographic metadata or a download manifest for reading."
				: "",
			!wantsExplainer
				? "No explainer artifact is requested in this scope. Deliver the evidence-grounded answer inline; do not load show-me, create files, deposit an explainer, or add a human-review milestone just to answer a read-only research question."
				: showMeAvailable
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
