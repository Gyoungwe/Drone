// @vitest-environment jsdom
import type { TrustRequest } from "@drone/shared";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ActionSurface } from "./ActionSurface";
import { dialogStack } from "./dialog-stack";

vi.mock("../../i18n", () => ({
	useT: () => (key: string) => key,
}));
vi.stubGlobal("React", React);

afterEach(() => {
	cleanup();
	dialogStack.reset();
});

function Surface({ name, onEscape }: { name: string; onEscape?: () => void }) {
	return (
		<ActionSurface ariaLabel={name} testId={name} onEscape={onEscape}>
			<button type="button">{`${name}-a`}</button>
			<button type="button">{`${name}-b`}</button>
		</ActionSurface>
	);
}

it("shows only the top surface and hides lower ones from AT", () => {
	render(
		<>
			<Surface name="ask" />
			<Surface name="example" />
		</>,
	);
	expect(screen.getByTestId("ask-backdrop").hidden).toBe(true);
	expect(screen.getByTestId("example-backdrop").hidden).toBe(false);
	expect(screen.getByRole("dialog", { name: "example" })).toBeTruthy();
});

it("Escape closes the top layer only, then the next one becomes active", () => {
	const closeAsk = vi.fn();
	function Harness() {
		const [example, setExample] = useState(true);
		return (
			<>
				<Surface name="ask" onEscape={closeAsk} />
				{example ? <Surface name="example" onEscape={() => setExample(false)} /> : null}
			</>
		);
	}
	render(<Harness />);
	act(() => {
		fireEvent.keyDown(document, { key: "Escape" });
	});
	expect(screen.queryByTestId("example")).toBeNull();
	expect(closeAsk).not.toHaveBeenCalled();
	expect(screen.getByTestId("ask-backdrop").hidden).toBe(false);
	act(() => {
		fireEvent.keyDown(document, { key: "Escape" });
	});
	expect(closeAsk).toHaveBeenCalledTimes(1);
});

it("a surface without onEscape swallows Escape so layers below stay open", () => {
	const below = vi.fn();
	render(
		<>
			<Surface name="ask" onEscape={below} />
			<Surface name="trust" />
		</>,
	);
	fireEvent.keyDown(document, { key: "Escape" });
	expect(below).not.toHaveBeenCalled();
});

it("traps Tab inside the panel and focuses the first control on open", () => {
	render(<Surface name="ask" />);
	const a = screen.getByText("ask-a");
	const b = screen.getByText("ask-b");
	expect(document.activeElement).toBe(a);
	b.focus();
	fireEvent.keyDown(b, { key: "Tab" });
	expect(document.activeElement).toBe(a);
	fireEvent.keyDown(a, { key: "Tab", shiftKey: true });
	expect(document.activeElement).toBe(b);
});

it("restores focus to the opener when the surface closes", () => {
	function Harness() {
		const [open, setOpen] = useState(false);
		return (
			<>
				<button type="button" onClick={() => setOpen(true)}>
					opener
				</button>
				{open ? <Surface name="ask" onEscape={() => setOpen(false)} /> : null}
			</>
		);
	}
	render(<Harness />);
	const opener = screen.getByText("opener");
	opener.focus();
	fireEvent.click(opener);
	expect(document.activeElement).toBe(screen.getByText("ask-a"));
	act(() => {
		fireEvent.keyDown(document, { key: "Escape" });
	});
	expect(document.activeElement).toBe(opener);
});

it("backdrop clicks close only when they land on the backdrop itself", () => {
	const close = vi.fn();
	render(
		<ActionSurface ariaLabel="x" testId="x" onBackdropMouseDown={close}>
			<button type="button">inside</button>
		</ActionSurface>,
	);
	fireEvent.mouseDown(screen.getByText("inside"));
	expect(close).not.toHaveBeenCalled();
	fireEvent.mouseDown(screen.getByTestId("x-backdrop"));
	expect(close).toHaveBeenCalledTimes(1);
});

it("TrustDialog answers by option index and lands focus on the safe choice", async () => {
	const { TrustDialog } = await import("../session/TrustDialog");
	const onRespond = vi.fn();
	const request: TrustRequest = { id: "t", cwd: "C:\\p", options: [{ key: "trust" }, { key: "deny" }] };
	render(<TrustDialog requests={[request]} onRespond={onRespond} />);
	expect(document.activeElement?.textContent).toBe("trust.deny");
	fireEvent.click(screen.getByText("trust.trust"));
	expect(onRespond).toHaveBeenCalledWith("t", 0);
});
