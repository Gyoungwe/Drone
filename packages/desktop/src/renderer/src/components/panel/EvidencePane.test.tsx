import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);

vi.mock("../../i18n", () => ({
	useT: () => (key: string) => key,
	useI18nStore: (selector: (state: { language: string }) => unknown) => selector({ language: "en" }),
}));

import { CapabilityEvidenceCardView } from "./EvidencePane";

describe("CapabilityEvidenceCardView", () => {
	it("keeps the evidence gap visible while linking artifacts and receipts", () => {
		const html = renderToStaticMarkup(
			createElement(CapabilityEvidenceCardView, {
				card: {
					id: "analysis-1:analysis",
					analysisId: "analysis-1",
					capabilityId: "analysis",
					versionRef: "assembly@1.0.0",
					evidenceState: "observed",
					claimState: "unsupported",
					capabilityState: "registered",
					reuseLevel: "navigation-only",
					freshness: "fresh",
					scientificallyVerified: false,
					gates: [{ id: "readiness", status: "review", detail: "Needs review" }],
					runRefs: ["analysis-1"],
					artifactRefs: [{ path: "counts.tsv", sha256: "a".repeat(64) }],
					receiptRefs: ["receipt-1"],
				},
			}),
		);
		expect(html).toContain('data-testid="capability-evidence-card"');
		expect(html).toContain('data-evidence-state="observed"');
		expect(html).toContain("panel.evidence.capabilityNoEvidence");
		expect(html).toContain("counts.tsv");
		expect(html).toContain("receipt-1");
	});
});
