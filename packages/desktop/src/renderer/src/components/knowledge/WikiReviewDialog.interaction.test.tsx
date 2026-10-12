// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { dialogStack } from "../ui/dialog-stack";
import { WikiReviewDialog } from "./WikiReviewDialog";

vi.stubGlobal("React", React);
afterEach(() => {
	cleanup();
	dialogStack.reset();
});

const preview = {
	id: "r1",
	path: "Wiki/a.md",
	project: "p",
	status: "pending",
	title: "A",
	rationale: "why",
	before: "a\n",
	after: "b\n",
	protectedText: "",
	sources: [],
	expiresAt: Date.now() + 1e6,
	expired: false,
	targetChanged: false,
	canApply: true,
	modelReview: null,
	reviewToken: "t",
	tokenExpiresAt: Date.now() + 1e6,
	vault: "v",
	bindingRevision: 1,
	scientificallyVerified: false,
};

function mockPi(resolvePreview: Promise<unknown>) {
	(window as unknown as { pi: unknown }).pi = {
		getKnowledgeOverview: () => Promise.resolve({ binding: { revision: 1 } }),
		previewKnowledgeReview: () => resolvePreview,
		getKnowledgeReviews: () => Promise.resolve({ items: [] }),
		decideKnowledgeReview: () => new Promise(() => undefined),
	};
}

it("ignores Escape while the preview is still loading (no defer race)", async () => {
	let finish: (v: unknown) => void = () => undefined;
	mockPi(new Promise((resolve) => (finish = resolve)));
	const onLater = vi.fn();
	render(<WikiReviewDialog cwd="/p" id="r1" queued={0} onLater={onLater} />);
	fireEvent.keyDown(document, { key: "Escape" });
	expect(onLater).not.toHaveBeenCalled();
	await act(async () => {
		finish(preview);
	});
	fireEvent.keyDown(document, { key: "Escape" });
	expect(onLater).toHaveBeenCalledTimes(1);
});

it("renders the loaded diff inside a dialog", async () => {
	mockPi(Promise.resolve(preview));
	render(<WikiReviewDialog cwd="/p" id="r1" queued={2} onLater={vi.fn()} />);
	await act(async () => undefined);
	expect(screen.getByRole("dialog")).toBeTruthy();
	expect(screen.getByText("A")).toBeTruthy();
});
