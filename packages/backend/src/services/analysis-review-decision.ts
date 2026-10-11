import type { AnalysisReviewDecision } from "./analysis-task-controller";

export function unavailableAnalysisReview(detail: string): AnalysisReviewDecision {
	return {
		approved: false,
		detail,
		reportMarkdown: `Takeaway: Result review paused.\n\n${detail}\n\nDelivery requires a valid review; task limitations remain in force.`,
	};
}

/** A nonempty paragraph is not approval. Malformed or incomplete model decisions fail closed. */
export function parseAnalysisReviewDecision(text: string): AnalysisReviewDecision {
	try {
		const raw: unknown = JSON.parse(
			text
				.trim()
				.replace(/^```(?:json)?\s*\n?/, "")
				.replace(/\n?```$/, ""),
		);
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Not an object");
		const value = raw as Record<string, unknown>;
		if (
			typeof value.approved !== "boolean" ||
			typeof value.detail !== "string" ||
			!value.detail.trim() ||
			typeof value.reportMarkdown !== "string" ||
			!value.reportMarkdown.trim().startsWith("Takeaway:")
		)
			throw new Error("Missing decision fields");
		return { approved: value.approved, detail: value.detail, reportMarkdown: value.reportMarkdown };
	} catch {
		return unavailableAnalysisReview("The model returned an invalid structured review decision");
	}
}
