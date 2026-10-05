import type { DecisionRecord } from "@drone/shared";

const EMPTY_DECISIONS: readonly DecisionRecord[] = [];
const EMPTY_CONFIRMED_IDS: ReadonlySet<string> = new Set();

/** Session replacement can briefly clear the workspace; keep empty projections referentially stable. */
export function stableEmptyDecisions(current: readonly DecisionRecord[]): readonly DecisionRecord[] {
	return current.length === 0 ? current : EMPTY_DECISIONS;
}
export function stableEmptyConfirmedIds(current: ReadonlySet<string>): ReadonlySet<string> {
	return current.size === 0 ? current : EMPTY_CONFIRMED_IDS;
}
