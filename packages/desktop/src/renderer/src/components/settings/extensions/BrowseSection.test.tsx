// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useCatalogStore } from "../../../stores/catalog";
import { BrowseSection } from "./BrowseSection";

vi.mock("../../../i18n", () => ({ useT: () => (key: string) => key }));
vi.stubGlobal("React", React);
const initial = useCatalogStore.getState();
afterEach(() => {
	cleanup();
	useCatalogStore.setState(initial, true);
});
it("refreshes installed packages on the first extension-only market visit", async () => {
	const installed = [{ source: "npm:example-extension@1.0.0", scope: "user" as const }];
	useCatalogStore.setState({
		catalogType: "",
		configuredPackages: null,
		setCatalogType: (catalogType) => useCatalogStore.setState({ catalogType }),
		refreshConfiguredPackages: async () => {
			useCatalogStore.setState({ configuredPackages: installed });
		},
	});
	render(<BrowseSection extensionsOnly />);
	await waitFor(() => expect(useCatalogStore.getState().configuredPackages).toEqual(installed));
	expect(useCatalogStore.getState().catalogType).toBe("extension");
});
