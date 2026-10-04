import type { ProcessLaneId, ProcessNode } from "./types";

export const PROCESS_LANE_LABELS: Record<ProcessLaneId, { zh: string; en: string }> = {
	entry: { zh: "入口", en: "Entry" },
	gate: { zh: "门", en: "Gates" },
	execution: { zh: "执行", en: "Execution" },
	evidence: { zh: "证据", en: "Evidence" },
	deposit: { zh: "沉淀", en: "Deposit" },
	answer: { zh: "回答", en: "Answer" },
};
export const PROCESS_LANE_EMPTY: Record<ProcessLaneId, { zh: string; en: string }> = {
	entry: { zh: "等一句话进来", en: "Waiting for a sentence" },
	gate: { zh: "这一轮没停过", en: "No gate stopped this turn" },
	execution: { zh: "还没开工", en: "Not started" },
	evidence: { zh: "这一轮没查文献", en: "No literature search this turn" },
	deposit: { zh: "没有写入知识库", en: "Nothing deposited" },
	answer: { zh: "还没到回答", en: "No answer yet" },
};
export function processNodeLine(node: ProcessNode, index: 0 | 1 | 2, language: "zh" | "en"): string {
	return node.lines[index][language];
}
