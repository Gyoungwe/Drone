import { resolve } from "node:path";

/** First-party tools whose host observations are always recorded in a research receipt. */
export const CORE_RESEARCH_RECEIPT_TOOLS = [
	"bash",
	"powershell",
	"webfetch",
	"fetch_content",
	"web_search",
	"research_read_knowledge",
	"research_search_knowledge",
	"research_verify_literature",
	"research_reconcile_literature",
	"research_archive_source",
] as const;

export type CoreResearchReceiptTool = (typeof CORE_RESEARCH_RECEIPT_TOOLS)[number];

export interface ResearchReceiptEvent {
	toolName?: unknown;
	isError?: unknown;
	toolCallId?: unknown;
	args?: Record<string, unknown>;
	details?: Record<string, unknown>;
}

/**
 * Apply the host-observation admission rule without importing a Pi runtime module.
 * Failed shell commands remain useful evidence; other failed tools are omitted.
 */
export function shouldRecordResearchReceipt(
	event: ResearchReceiptEvent,
	isJournalTool: (toolName: string) => boolean = () => false,
): boolean {
	const toolName = typeof event.toolName === "string" ? event.toolName : "";
	if (event.isError && toolName !== "bash" && toolName !== "powershell") return false;
	return (CORE_RESEARCH_RECEIPT_TOOLS as readonly string[]).includes(toolName) || isJournalTool(toolName);
}

export interface ReceiptJournalSnapshot {
	scope: "current-session-current-turn";
	buffered: number;
	evicted: number;
}

export interface ReceiptJournalBufferOptions {
	capacity?: number;
}

/**
 * Bounded, deduplicating receipt storage for one host session and turn.
 * It deliberately stores opaque values so host-specific persistence stays outside the package.
 */
export class ReceiptJournalBuffer<T extends { toolCallId?: unknown }> {
	private readonly capacity: number;
	private readonly entries: T[] = [];
	private readonly seen = new Set<string>();
	private evictedCount = 0;

	constructor({ capacity = 256 }: ReceiptJournalBufferOptions = {}) {
		if (!Number.isInteger(capacity) || capacity < 1)
			throw new Error("Receipt journal capacity must be a positive integer");
		this.capacity = capacity;
	}

	/** Adds a receipt and returns false for a duplicate tool call id. */
	add(receipt: T): boolean {
		const toolCallId = typeof receipt.toolCallId === "string" ? receipt.toolCallId : null;
		if (toolCallId && this.seen.has(toolCallId)) return false;
		if (toolCallId) this.seen.add(toolCallId);
		if (this.entries.length >= this.capacity) {
			this.entries.shift();
			// Keep the id in `seen` after eviction so a replayed host event cannot
			// re-enter the journal later in the same session.
			this.evictedCount += 1;
		}
		this.entries.push(receipt);
		return true;
	}

	values(): readonly T[] {
		return this.entries.slice();
	}

	get evicted(): number {
		return this.evictedCount;
	}

	snapshot(): ReceiptJournalSnapshot {
		return {
			scope: "current-session-current-turn",
			buffered: this.entries.length,
			evicted: this.evictedCount,
		};
	}

	clear(): void {
		this.entries.length = 0;
		this.seen.clear();
		this.evictedCount = 0;
	}
}

/** Checks whether a receipt with an optional run_dir belongs to the attached run. */
export function receiptBelongsToRun(
	receipt: Pick<ResearchReceiptEvent, "args" | "details">,
	cwd: string,
	runDir: string,
): boolean {
	const ownedRun = receipt.args?.run_dir || receipt.details?.run_dir;
	return !ownedRun || resolve(cwd, String(ownedRun)) === resolve(cwd, runDir);
}
