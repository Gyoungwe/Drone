import type { InquiryArtifactProvenance, InquiryArtifactRecord } from "@drone/shared";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../i18n", () => ({
	useT: () => (key: string) => key,
	useI18nStore: (selector: (state: { language: "zh" }) => unknown) => selector({ language: "zh" }),
}));
vi.mock("../../stores/sessions", () => ({
	useSessionsStore: Object.assign(
		(selector: (state: { cwd: string | null }) => unknown) => selector({ cwd: "/proj" }),
		{
			getState: () => ({ switchSession: vi.fn() }),
		},
	),
}));
vi.mock("../../stores/knowledge", () => ({ useKnowledgeStore: () => ({}) }));
vi.mock("../../stores/transcript", () => ({
	selectTranscript: () => ({ messages: [] }),
	useTranscriptStore: () => ({}),
}));
vi.mock("../../stores/ui", () => ({ useUiStore: () => ({ openResourcePreview: vi.fn() }) }));
vi.mock("../../api", () => ({ getPi: () => ({ listArtifacts: vi.fn(async () => []) }) }));
vi.mock("../knowledge/KnowledgeFlowCard", () => ({ KnowledgeFlowCard: () => null }));
vi.mock("./FlowCards", () => ({ FlowCards: () => null }));

vi.stubGlobal("React", React);

import { ArtifactProvenanceCard } from "./ArtifactsPane";

const record: InquiryArtifactRecord = {
	id: "artifact-1",
	schemaVersion: 1,
	projectId: "project-1",
	location: "local",
	path: "results/report.tsv",
	bytes: 12,
	sha256: "a".repeat(64),
	source: { kind: "run", id: "run-1" },
	purpose: "deliverable",
	status: "valid",
	parentIds: [],
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
};

function provenance(status: InquiryArtifactProvenance["reproducibility"]): InquiryArtifactProvenance {
	return {
		artifact: record,
		parentChain: [],
		parentChainTruncated: false,
		attempts: [
			{
				id: "attempt-1",
				schemaVersion: 1,
				projectId: "project-1",
				hypothesisIds: [],
				parameters: { seed: 1 },
				artifactIds: [record.id],
				outcome: "succeeded",
				enteredReport: false,
				startedAt: "2026-01-01T00:00:00.000Z",
			},
		],
		reproducibility: status,
	};
}

describe("ArtifactProvenanceCard", () => {
	it("renders all three reproducibility badges", () => {
		for (const status of ["reproducible", "partial", "not-reproducible"] as const) {
			const html = renderToStaticMarkup(
				createElement(ArtifactProvenanceCard, {
					record,
					provenance: provenance(status),
					expanded: true,
					onToggle: () => {},
					onRerun: () => {},
				}),
			);
			expect(html).toContain(`data-reproducibility="${status}"`);
			expect(html).toContain(`panel.artifactProvenance.badge.${status}`);
		}
	});

	it("renders an expandable source section and rerun only for reproducible artifacts", () => {
		const reproducible = renderToStaticMarkup(
			createElement(ArtifactProvenanceCard, {
				record,
				provenance: provenance("reproducible"),
				expanded: true,
				onToggle: () => {},
				onRerun: () => {},
			}),
		);
		expect(reproducible).toContain('data-testid="artifact-provenance-details"');
		expect(reproducible).toContain("panel.artifactProvenance.rerun");
		const superseded = renderToStaticMarkup(
			createElement(ArtifactProvenanceCard, {
				record,
				provenance: provenance("reproducible"),
				expanded: true,
				rerunResult: {
					key: "panel.artifactProvenance.superseded",
					difference: "sha256 differs",
					sha256: "b".repeat(64),
				},
				onToggle: () => {},
				onRerun: () => {},
			}),
		);
		expect(superseded).toContain("sha256 differs");
		const partial = renderToStaticMarkup(
			createElement(ArtifactProvenanceCard, {
				record,
				provenance: provenance("partial"),
				expanded: true,
				onToggle: () => {},
				onRerun: () => {},
			}),
		);
		expect(partial).not.toContain("panel.artifactProvenance.rerun");
	});
});
