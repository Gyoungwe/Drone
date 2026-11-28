// @vitest-environment jsdom
import type { LoadedResources, SessionPackageVersion, UiPluginsEventPayload } from "@drone/shared";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useSessionEventBridge } from "../../hooks/use-session-event-bridge";
import { useI18nStore } from "../../i18n";
import { useSessionsStore } from "../../stores/sessions";
import { useSettingsStore } from "../../stores/settings";
import { OverviewPane } from "./OverviewPane";

vi.mock("./ContextUsageMeter", () => ({ ContextUsageMeter: () => null }));
vi.mock("./EvidencePane", () => ({ EvidencePane: () => null }));
vi.mock("../chat/DeliveryCards", () => ({ DeliveryCards: () => null }));
vi.mock("./ProcessPane", () => ({ ProcessPane: () => null }));
vi.mock("./SubagentsPane", () => ({ SubagentsPane: () => null }));
vi.mock("./ReviewerCard", () => ({ ReviewerCard: () => null }));
vi.mock("./SessionOverviewSections", () => ({
	SessionOverviewSections: () => null,
}));

const emptyResources: LoadedResources = {
	skills: [],
	skillDiagnostics: [],
	extensions: [],
	extensionErrors: [],
};
const onTrustRequest = () => undefined;

function Overview({ sessionId }: { sessionId: string }) {
	useSessionEventBridge({ onTrustRequest });
	return <OverviewPane sessionId={sessionId} />;
}

function resources(
	versions: Pick<SessionPackageVersion, "currentVersion" | "nextSessionVersion">,
): LoadedResources {
	return { ...emptyResources, packageVersions: [{ packageName: "fixture", scope: "user", ...versions }] };
}

function setup() {
	vi.stubGlobal("React", React);
	useI18nStore.setState({ language: "en" });
	useSessionsStore.setState({ activeSessionId: "first" });
	const listeners = new Set<(event: UiPluginsEventPayload) => void>();
	const getLoadedResources = vi.fn<(id: string) => Promise<LoadedResources>>();
	vi.stubGlobal("pi", {
		getLoadedResources,
		listConfiguredPackages: vi.fn(async () => []),
		onEvent: () => vi.fn(),
		onPermissionRequest: () => vi.fn(),
		onPermissionResolved: () => vi.fn(),
		onTrustRequest: () => vi.fn(),
		onUiPluginsEvent: (listener: (event: UiPluginsEventPayload) => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	});
	return {
		getLoadedResources,
		dispatch: (event: UiPluginsEventPayload) => {
			for (const listener of listeners) listener(event);
		},
	};
}

afterEach(() => {
	cleanup();
	useSessionsStore.setState({ activeSessionId: null });
	useSettingsStore.setState(useSettingsStore.getInitialState());
	vi.unstubAllGlobals();
});

it("renders English and Chinese versions and clears a rolled-back candidate on readback", async () => {
	const bridge = setup();
	bridge.getLoadedResources.mockResolvedValueOnce(
		resources({ currentVersion: "1.0.0", nextSessionVersion: "2.0.0" }),
	);
	render(<Overview sessionId="first" />);
	await screen.findByText("Current session 1.0.0");
	expect(screen.getByText("Next session 2.0.0")).toBeTruthy();
	act(() => useI18nStore.setState({ language: "zh" }));
	expect(screen.getByText("当前会话 1.0.0")).toBeTruthy();
	expect(screen.getByText("下一会话 2.0.0")).toBeTruthy();
	bridge.getLoadedResources.mockResolvedValueOnce(resources({ currentVersion: "1.0.0" }));
	await act(async () =>
		bridge.dispatch({
			kind: "config",
			receipt: {
				operation: "update",
				packageName: "fixture",
				source: "npm:fixture",
				scope: "user",
				status: "failed",
				effect: "current-session",
				events: [
					{ type: "failed", at: 1 },
					{ type: "rolled_back", at: 2 },
				],
			},
		}),
	);
	expect(screen.queryByText("下一会话 2.0.0")).toBeNull();
});

it("ignores late responses from the previous tab after a new session loads the version", async () => {
	const bridge = setup();
	let finishOld: (value: LoadedResources) => void = () => {
		throw new Error("Request did not start");
	};
	bridge.getLoadedResources.mockReturnValueOnce(
		new Promise((resolve) => {
			finishOld = resolve;
		}),
	);
	bridge.getLoadedResources.mockResolvedValueOnce(resources({ currentVersion: "2.0.0" }));
	const view = render(<Overview sessionId="first" />);
	act(() => useSessionsStore.setState({ activeSessionId: "second" }));
	view.rerender(<Overview sessionId="second" />);
	await screen.findByText("Current session 2.0.0");
	await act(async () => finishOld(resources({ currentVersion: "1.0.0", nextSessionVersion: "2.0.0" })));
	expect(screen.queryByText("Current session 1.0.0")).toBeNull();
	expect(screen.queryByText("Next session 2.0.0")).toBeNull();
	expect(screen.getByText("Current session 2.0.0")).toBeTruthy();
});
