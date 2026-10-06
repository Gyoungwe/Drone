/**
 * /发现 命令的提问：建在知识闭环之上，发散 → 收敛与自我质疑 → 最多 3 条，可一键沉淀为「想法」。
 * 借用 @drone/discovery「独立批评者」的思路：批评由没看过推理过程的子智能体完成（可用时）。
 */
export function discoveryPrompt(topic: string): string {
	const subject = topic.trim() || "the current conversation topic and the user's recent work";
	return [
		`Discovery task on: ${subject}`,
		"",
		"Goal: propose up to 3 ideas the user has probably not considered, each new, grounded and testable.",
		"",
		"1. Ground: search the local Vault first (research_search_knowledge, then read the best notes); use the web only for what local notes lack.",
		"2. Diverge: generate 8–12 candidate ideas from these angles: contradictions between sources; combinations nobody has studied; methods transferable from another field; default assumptions worth challenging; the next implication of an accepted conclusion.",
		"3. Converge and self-critique each candidate on three tests, and drop any that fails one:",
		"   - Novelty: is it already in the local Vault or a quick web search? If yes, drop it or cite where it already exists.",
		"   - Basis: name the specific note or paper (author, year, DOI or Vault path) it rests on.",
		"   - Testability: state the experiment, dataset or analysis that would confirm or refute it.",
		"   If the subagent tool is available, give the surviving candidates to an independent critic subagent that did not see your reasoning, and drop what it shows to be known or unfounded.",
		"4. Present at most 3 ideas, best first. For each: one-sentence idea; label speculative; basis; how to test; why it may have been overlooked. If nothing survives, say so plainly instead of padding.",
		"5. Then call ask_user once (multiple choice) listing the ideas, so the user can pick which to keep. For each picked idea call research_deposit_knowledge with type \"idea\", the idea as title, its basis/test/status in markdown and the cited sources in source_links.",
	].join("\n");
}
