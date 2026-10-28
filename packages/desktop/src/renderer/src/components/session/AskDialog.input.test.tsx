// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { AskDialog } from "./AskDialog";

vi.mock("../../i18n", () => ({ useT: () => (key: string) => key }));
vi.stubGlobal("React", React);
afterEach(cleanup);
it("submits an untouched optional text input as an empty answer and preserves entered whitespace", async () => {
	const onRespond = vi.fn();
	const request = {
		id: "empty-text",
		sessionId: "actual-session",
		toolCallId: "input",
		title: "Native input",
		questions: [
			{ id: "value", label: "Input", prompt: "Input", type: "text" as const, required: false, options: [] },
		],
	};
	const rendered = render(<AskDialog requests={[request]} onRespond={onRespond} />);
	const submit = screen.getByRole("button", { name: "ask.submit" }) as HTMLButtonElement;
	expect(submit.disabled).toBe(false);
	fireEvent.click(submit);
	await waitFor(() =>
		expect(onRespond).toHaveBeenCalledWith("empty-text", {
			kind: "answer",
			mode: "submit",
			answers: { value: { customText: "" } },
		}),
	);
	rendered.rerender(<AskDialog requests={[{ ...request, id: "spaced-text" }]} onRespond={onRespond} />);
	await waitFor(() =>
		expect((screen.getByRole("button", { name: "ask.submit" }) as HTMLButtonElement).disabled).toBe(false),
	);
	fireEvent.change(screen.getByRole("textbox"), { target: { value: "  preserve whitespace  " } });
	fireEvent.click(screen.getByRole("button", { name: "ask.submit" }));
	await waitFor(() =>
		expect(onRespond).toHaveBeenCalledWith("spaced-text", {
			kind: "answer",
			mode: "submit",
			answers: { value: expect.objectContaining({ customText: "  preserve whitespace  " }) },
		}),
	);
});
