// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);

import { useUiStore } from "../../stores/ui";
import { DeliveryCards } from "./DeliveryCards";

describe("DeliveryCards (P17)", () => {
	it("renders cards and opens the file in the right panel", () => {
		const open = vi.fn();
		useUiStore.setState({ openResourcePreview: open } as never);
		render(
			<DeliveryCards
				sessionId={null}
				files={[
					{ path: "/p/out/report.pdf", title: "分析报告", description: "差异表达汇总" },
					{ path: "/p/out/volcano.png", title: "volcano.png" },
				]}
			/>,
		);
		expect(screen.getByText("分析报告")).toBeTruthy();
		expect(screen.getByText("PDF")).toBeTruthy();
		expect(screen.getByText("IMG")).toBeTruthy();
		fireEvent.click(screen.getByText("分析报告"));
		expect(open).toHaveBeenCalledWith(expect.objectContaining({ label: "分析报告" }));
	});
});
