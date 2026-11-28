// @vitest-environment jsdom
import type { UiPluginInfo } from "@drone/shared";
import type { ArtifactContributionProps } from "@gyoungwe/plugin-api/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useUiPluginRegistry } from "../../plugins/registry";
import { UI_REGIONS } from "../../plugins/slots";
import { useUiPluginsStore } from "../../stores/ui-plugins";

vi.mock("../../i18n", () => ({
	useT: () => (key: string) => key,
	useI18nStore: (selector: (state: { language: "zh" }) => unknown) => selector({ language: "zh" }),
}));
vi.mock("../../stores/sessions", () => ({
	isDraftSessionId: () => false,
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
}));

vi.stubGlobal("React", React);

import { ArtifactsPane } from "./ArtifactsPane";
import { OverviewPane } from "./OverviewPane";

function inquiryPluginFixture(overrides: Partial<UiPluginInfo> = {}): UiPluginInfo {
	return {
		name: "inquiry-fixture",
		slots: {},
		contributions: [{ id: "inquiry", region: "panel.tab", title: "Inquiry", export: "InquiryPanel" }],
		enabled: true,
		trusted: true,
		built: true,
		...overrides,
	};
}

afterEach(cleanup);
beforeEach(() => {
	useUiPluginRegistry.setState({ contributions: {}, loadNonces: {}, crashCounts: {} });
	useUiPluginsStore.setState({ config: { enabled: true, plugins: {}, assignments: {} }, plugins: [] });
});

it("mounts the evidence.pane contribution once with its surface and host IDs", async () => {
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
	expect(await screen.findByTestId("evidence-panel")).toBeTruthy();
	expect(screen.getAllByTestId("artifact-contribution").map((element) => element.textContent)).toEqual([
		"evidence.pane:null",
	]);
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

it("shows the Inquiry plugin available hint when a valid built Inquiry panel.tab plugin is enabled", () => {
	useUiPluginsStore.setState({
		config: { enabled: true, plugins: {}, assignments: {} },
		plugins: [inquiryPluginFixture()],
	});
	render(<ArtifactsPane sessionId="host-session" />);
	const status = screen.getByTestId("inquiry-plugin-status");
	expect(status.getAttribute("data-ready")).toBe("true");
	expect(screen.getByText("panel.inquiryPlugin.available")).toBeTruthy();
	expect(screen.getByText("panel.inquiryPlugin.availableHint")).toBeTruthy();
	expect(status.querySelector("button")).toBeNull();
});

it("shows the Inquiry plugin unavailable hint when disabled, unbuilt, invalid, or globally turned off", () => {
	const cases: Array<{ enabled: boolean; plugins: UiPluginInfo[] }> = [
		{ enabled: true, plugins: [] },
		{ enabled: false, plugins: [inquiryPluginFixture()] },
		{ enabled: true, plugins: [inquiryPluginFixture({ enabled: false })] },
		{ enabled: true, plugins: [inquiryPluginFixture({ built: false })] },
		{ enabled: true, plugins: [inquiryPluginFixture({ buildError: "compile failed" })] },
		{ enabled: true, plugins: [inquiryPluginFixture({ invalidReason: "bad manifest" })] },
	];
	for (const state of cases) {
		useUiPluginsStore.setState({
			config: { enabled: state.enabled, plugins: {}, assignments: {} },
			plugins: state.plugins,
		});
		render(<ArtifactsPane sessionId="host-session" />);
		const status = screen.getByTestId("inquiry-plugin-status");
		expect(status.getAttribute("data-ready")).toBe("false");
		expect(screen.getByText("panel.inquiryPlugin.unavailable")).toBeTruthy();
		expect(screen.getByText("panel.inquiryPlugin.unavailableHint")).toBeTruthy();
		cleanup();
	}
});
