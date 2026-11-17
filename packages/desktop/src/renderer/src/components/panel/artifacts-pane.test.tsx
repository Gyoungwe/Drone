// @vitest-environment jsdom
import type { InquiryArtifactProvenance, InquiryArtifactRecord } from "@drone/shared";
import type { ArtifactContributionProps } from "@gyoungwe/plugin-api/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiPluginRegistry } from "../../plugins/registry";
import { UI_REGIONS } from "../../plugins/slots";
import { useUiPluginsStore } from "../../stores/ui-plugins";

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
	selectTranscript: () => ({ messages: [], todos: [], reviewerFindings: [] }),
	useTranscriptStore: (selector: (state: object) => unknown) => selector({}),
}));
vi.mock("../../stores/ui", () => ({ useUiStore: () => ({ openResourcePreview: vi.fn() }) }));
vi.mock("../../api", () => ({
	getPi: () => ({
		listArtifacts: async () => [record, { ...record, id: "artifact-2", path: "results/second.tsv" }],
		onRerunUpdated: () => vi.fn(),
		getEvidenceOverview: async () => ({
			analyses: [
				{ id: "overview-analysis", question: "fixture", assay: "fixture", stage: "design", artifactCount: 0 },
			],
			capabilities: [],
			checkpoints: [],
			branches: [],
			replays: [],
		}),
	}),
}));
vi.mock("../knowledge/KnowledgeFlowCard", () => ({ KnowledgeFlowCard: () => null }));
vi.mock("./FlowCards", () => ({ FlowCards: () => null }));
vi.mock("./ContextUsageMeter", () => ({ ContextUsageMeter: () => null }));
vi.mock("../chat/Markdown", () => ({ Markdown: () => null }));
vi.mock("./SessionOverviewSections", () => ({
	SessionOverviewSections: () => null,
	DecisionsSection: () => null,
}));

vi.stubGlobal("React", React);

import { ArtifactProvenanceCard, ArtifactsPane } from "./ArtifactsPane";
import { OverviewPane } from "./OverviewPane";

afterEach(cleanup);
beforeEach(() => {
	useUiPluginRegistry.setState({ contributions: {}, loadNonces: {}, crashCounts: {} });
	useUiPluginsStore.setState({ config: { enabled: true, plugins: {}, assignments: {} } });
});

it("mounts each Artifacts contribution once with its surface and host IDs", async () => {
	const Panel = vi.fn((props: ArtifactContributionProps) => (
		<p data-testid="artifact-contribution">{`${props.surface}:${props.artifactId}`}</p>
	));
	useUiPluginRegistry.getState().applyPlugin(
		{
			name: "artifact-fixture",
			droneUi: 1,
			main: "src/index.tsx",
			contributions: [{ id: "artifact", region: UI_REGIONS.ArtifactContribution, export: "Panel" }],
		},
		{ Panel },
		[],
	);
	render(<ArtifactsPane sessionId="host-session" />);
	const section = await screen.findByTestId("inquiry-artifacts");
	expect(section.querySelectorAll('[data-testid="artifact-provenance-card"]')).toHaveLength(2);
	expect(screen.getByText(record.path)).toBeTruthy();
	expect(screen.getByTestId("evidence-panel")).toBeTruthy();
	expect(screen.getAllByTestId("artifact-contribution").map((element) => element.textContent)).toEqual([
		"artifacts.card:artifact-1",
		"artifacts.card:artifact-2",
		"evidence.pane:null",
	]);
	expect(
		Panel.mock.calls.map(([props]) => props).filter((props) => props.surface === "artifacts.card"),
	).toEqual(
		["artifact-1", "artifact-2"].map((artifactId) => ({
			surface: "artifacts.card",
			artifactId,
			analysisId: null,
			capabilityId: null,
			sessionId: "host-session",
			workspaceId: null,
			renderDefault: expect.any(Function),
		})),
	);
	const evidenceProps = {
		surface: "evidence.pane",
		artifactId: null,
		analysisId: null,
		capabilityId: null,
		sessionId: "host-session",
		workspaceId: null,
		renderDefault: expect.any(Function),
	};
	expect(Panel.mock.calls.find(([props]) => props.surface === "evidence.pane")?.[0]).toEqual(evidenceProps);
	fireEvent.change(screen.getByPlaceholderText("panel.evidence.analysisId"), {
		target: { value: "draft-analysis" },
	});
	expect(Panel.mock.lastCall?.[0]).toEqual(evidenceProps);
});

it("mounts the Overview contribution exactly once on evidence.overview", async () => {
	const Panel = vi.fn((props: ArtifactContributionProps) => (
		<p data-testid="artifact-contribution">{props.surface}</p>
	));
	useUiPluginRegistry.getState().applyPlugin(
		{
			name: "overview-fixture",
			droneUi: 1,
			main: "src/index.tsx",
			contributions: [{ id: "evidence", region: UI_REGIONS.ArtifactContribution, export: "Panel" }],
		},
		{ Panel },
		[],
	);
	render(<OverviewPane sessionId="overview-session" />);
	expect(await screen.findByTestId("evidence-panel")).toBeTruthy();
	expect(screen.getAllByTestId("artifact-contribution")).toHaveLength(1);
	expect(screen.getByTestId("artifact-contribution").textContent).toBe("evidence.overview");
	const expected = {
		surface: "evidence.overview",
		artifactId: null,
		analysisId: null,
		capabilityId: null,
		sessionId: "overview-session",
		workspaceId: null,
		renderDefault: expect.any(Function),
	};
	for (const [props] of Panel.mock.calls) expect(props).toEqual(expected);
});

const record: InquiryArtifactRecord = {
	id: "artifact-1",
	schemaVersion: 1,
	projectId: "project-1",
	location: "remote",
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
		const local = renderToStaticMarkup(
			createElement(ArtifactProvenanceCard, {
				record: { ...record, location: "local" },
				provenance: provenance("reproducible"),
				expanded: true,
				onToggle: () => {},
				onRerun: () => {},
			}),
		);
		expect(local).not.toContain("panel.artifactProvenance.rerun");
	});

	it("renders persisted submitted, running, reproduced, inconsistent, and failed states", () => {
		for (const status of ["submitted", "running", "reproduced", "superseded", "failed"] as const) {
			const html = renderToStaticMarkup(
				createElement(ArtifactProvenanceCard, {
					record,
					provenance: {
						...provenance("reproducible"),
						rerun: {
							id: "rerun-1",
							schemaVersion: 1,
							projectId: "project-1",
							sourceArtifactId: record.id,
							jobId: "job-1",
							status,
							previousSha256: record.sha256,
							submittedAt: "2026-01-01T00:00:00.000Z",
							updatedAt: "2026-01-01T00:00:00.000Z",
						},
					},
					expanded: true,
					onToggle: () => {},
					onRerun: () => {},
				}),
			);
			expect(html).toContain(`panel.artifactProvenance.${status}`);
		}
	});
});
