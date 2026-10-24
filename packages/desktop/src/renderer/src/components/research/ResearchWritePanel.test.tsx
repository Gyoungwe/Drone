// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listWriteAdapters = vi.fn();
const prepareWrite = vi.fn();
const executeWrite = vi.fn();
const revokeWrite = vi.fn();

vi.mock("../../api", () => ({
	getPi: () => ({ listWriteAdapters, prepareWrite, executeWrite, revokeWrite }),
}));
vi.mock("../../i18n", () => ({
	useT: () => (key: string) => key,
}));
vi.stubGlobal("React", React);

import { ResearchWritePanel } from "./ResearchWritePanel";

describe("ResearchWritePanel", () => {
	beforeEach(() => {
		listWriteAdapters.mockResolvedValue({
			adapters: [
				{
					id: "protocols-bookmark-write",
					label: "Protocols.io bookmark (reversible write)",
					writeEnabled: false,
					supportsDelete: true,
				},
			],
		});
		prepareWrite.mockReset();
		prepareWrite.mockResolvedValue({
			id: "research-write-protocols-fixture",
			adapterId: "protocols-bookmark-write",
			targetRef: "protocols:fixture",
			payload: { title: "Fixture protocol" },
			action: "prepare",
			sideEffect: "external-write",
			requiresExplicitApproval: true,
			status: "ready",
			createdAt: new Date().toISOString(),
		});
		executeWrite.mockReset();
		revokeWrite.mockReset();
	});

	it("keeps external execution disabled when Protocols.io has no authorized host port", async () => {
		render(
			React.createElement(ResearchWritePanel, {
				targetRef: "protocols:fixture",
				payload: { title: "Fixture protocol" },
			}),
		);

		await waitFor(() => expect(screen.getByRole("button", { name: "researchWrite.prepare" })).toBeTruthy());
		screen.getByRole("button", { name: "researchWrite.prepare" }).click();
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "researchWrite.dryRunOnly" })).toBeTruthy(),
		);
		const execute = screen.getByRole("button", { name: "researchWrite.dryRunOnly" });
		expect(execute.hasAttribute("disabled")).toBe(true);
		expect(prepareWrite).toHaveBeenCalledTimes(1);
		expect(executeWrite).not.toHaveBeenCalled();
	});
});
