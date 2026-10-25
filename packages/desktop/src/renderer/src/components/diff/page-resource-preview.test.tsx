// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useUiStore } from "../../stores/ui";
import { PageResourcePreview } from "./PageResourcePreview";

vi.stubGlobal("React", React);
vi.mock("./ResourceSidebar", () => ({
	ResourceSidebar: ({ target }: { target: { href: string; fragment?: string } }) => (
		<div>{`${target.href}#${target.fragment}`}</div>
	),
}));

afterEach(() => {
	cleanup();
	useUiStore.setState({ view: "chat", resourcePreview: null, panelOpen: true });
});

it("opens a cited resource beside a knowledge page, closes, reopens and returns", () => {
	useUiStore.setState({ view: "knowledge", resourcePreview: null, panelOpen: false });
	render(<PageResourcePreview />);
	expect(screen.queryByTestId("page-resource-preview")).toBeNull();
	const target = { href: "/project/paper.pdf", fragment: "page=3", cwd: "/project" };
	act(() => useUiStore.getState().openResourcePreview(target));
	expect(screen.getByText("/project/paper.pdf#page=3")).toBeTruthy();
	expect(useUiStore.getState().view).toBe("knowledge");
	act(() => useUiStore.getState().setPanelOpen(false));
	expect(screen.queryByTestId("page-resource-preview")).toBeNull();
	act(() => useUiStore.getState().openResourcePreview(target));
	expect(screen.getByTestId("page-resource-preview")).toBeTruthy();
	act(() => useUiStore.getState().showDiffSidebar());
	expect(screen.queryByTestId("page-resource-preview")).toBeNull();
});

it("leaves chat previews to the existing context panel", () => {
	useUiStore.setState({ view: "chat" });
	useUiStore.getState().openResourcePreview({ href: "/project/paper.pdf" });
	render(<PageResourcePreview />);
	expect(screen.queryByTestId("page-resource-preview")).toBeNull();
});
