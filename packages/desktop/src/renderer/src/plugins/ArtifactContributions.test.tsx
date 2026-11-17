// @vitest-environment jsdom
import type { ArtifactContributionProps } from "@gyoungwe/plugin-api/ui";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useUiPluginsStore } from "../stores/ui-plugins";
import { ArtifactContributions } from "./ArtifactContributions";
import { useUiPluginRegistry } from "./registry";
import { UI_REGIONS } from "./slots";

vi.stubGlobal("React", React);
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});
beforeEach(() => {
	useUiPluginRegistry.setState({ contributions: {}, loadNonces: {}, crashCounts: {} });
	useUiPluginsStore.setState({ config: { enabled: true, plugins: {}, assignments: {} } });
});

function register(name: string, Panel: (props: ArtifactContributionProps) => ReactNode) {
	expect(
		useUiPluginRegistry.getState().applyPlugin(
			{
				name,
				droneUi: 1,
				main: "src/index.tsx",
				contributions: [{ id: "artifact", region: UI_REGIONS.ArtifactContribution, export: "Panel" }],
			},
			{ Panel },
			[],
		).ok,
	).toBe(true);
}

const hostProps = {
	surface: "artifacts.card",
	artifactId: "host-artifact",
	analysisId: "host-analysis",
	capabilityId: "host-capability",
	sessionId: "host-session",
	workspaceId: null,
	renderDefault: () => <p>host default</p>,
} satisfies ArtifactContributionProps;

it("keeps the default with no contributions and while the master switch is off", () => {
	const { container } = render(<ArtifactContributions {...hostProps} />);
	expect(container.textContent).toBe("host default");
	act(() => register("first", () => <p>first</p>));
	expect(screen.getByText("first")).toBeTruthy();
	act(() => useUiPluginsStore.setState({ config: { enabled: false, plugins: {}, assignments: {} } }));
	expect(container.textContent).toBe("host default");
});

it("renders every contribution in registration order and removes only the disabled plugin", () => {
	register("first", () => <p>first</p>);
	register("second", () => <p>second</p>);
	const { container } = render(<ArtifactContributions {...hostProps} />);
	expect(container.textContent).toBe("host defaultfirstsecond");
	act(() => useUiPluginRegistry.getState().removePlugin("first"));
	expect(container.textContent).toBe("host defaultsecond");
});

it("passes exactly the seven host fields and the default function, without caller authority", () => {
	const Panel = vi.fn((props: ArtifactContributionProps) => <p>{props.surface}</p>);
	register("props", Panel);
	const caller = { ...hostProps, receiptRef: "untrusted", runtime: {}, providerId: "untrusted" };
	render(<ArtifactContributions {...caller} />);
	const received = Panel.mock.calls[0]?.[0];
	expect(received).toEqual(hostProps);
	expect(Reflect.ownKeys(received ?? {})).toHaveLength(7);
	for (const key of ["receiptRef", "runtime", "providerId"]) expect(received).not.toHaveProperty(key);
	expect(received?.renderDefault).toBe(hostProps.renderDefault);
});

it("isolates a crash and recovers on a new load nonce", () => {
	const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
	register("broken", () => {
		throw new Error("fixture crash");
	});
	register("healthy", () => <p>healthy</p>);
	const { container } = render(<ArtifactContributions {...hostProps} />);
	expect(container.textContent).toBe("host defaulthealthy");
	expect(error).toHaveBeenCalledWith(
		expect.stringContaining("region panel.artifact.contribution/artifacts.card"),
		expect.any(Error),
	);
	act(() => {
		useUiPluginRegistry.getState().removePlugin("broken");
		register("broken", () => <p>reloaded</p>);
	});
	expect(container.textContent).toBe("host defaulthealthyreloaded");
});

it("refreshes the host context when the session changes and unmounts the contribution", () => {
	const dispose = vi.fn();
	const Panel = vi.fn((props: ArtifactContributionProps) => {
		React.useEffect(() => dispose, []);
		return <p>{props.sessionId}</p>;
	});
	register("session", Panel);
	const { rerender, unmount } = render(<ArtifactContributions {...hostProps} />);
	const previous = Panel.mock.calls[0]?.[0];
	rerender(<ArtifactContributions {...hostProps} sessionId="next-session" />);
	expect(screen.getByText("next-session")).toBeTruthy();
	expect(Panel.mock.lastCall?.[0]).toEqual({ ...hostProps, sessionId: "next-session" });
	expect(Panel.mock.lastCall?.[0]).not.toBe(previous);
	unmount();
	expect(dispose).toHaveBeenCalledOnce();
});
