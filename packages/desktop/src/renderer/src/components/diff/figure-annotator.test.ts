import { describe, expect, it, vi } from "vitest";

vi.mock("../../api", () => ({ getPi: () => ({}) }));
vi.mock("../../i18n", () => ({ useT: () => (key: string) => key }));
vi.mock("../../stores/drafts", () => ({
	COMPOSER_FOCUS_EVENT: "focus",
	NEW_SESSION_DRAFT_KEY: "__new__",
	useDraftStore: { getState: () => ({ updateDraft: vi.fn() }) },
}));
vi.mock("../../stores/sessions", () => ({ useSessionsStore: () => null }));

import { annotationsMessage, relativePoint } from "./FigureAnnotator";

describe("figure annotator helpers", () => {
	it("turns notes into a numbered message, keeping figure numbering and skipping empty notes", () => {
		const message = annotationsMessage("Header", [
			{ id: "1", x: 0.1, y: 0.2, text: " enlarge legend ", createdAt: "" },
			{ id: "2", x: 0.5, y: 0.5, text: "", createdAt: "" },
			{ id: "3", x: 0.904, y: 0.333, text: "use log scale", createdAt: "" },
		]);
		expect(message).toBe("Header\n1. (x 10%, y 20%) enlarge legend\n3. (x 90%, y 33%) use log scale");
	});

	it("maps a click to clamped relative coordinates", () => {
		const rect = { left: 100, top: 50, width: 200, height: 100 };
		expect(relativePoint(150, 75, rect)).toEqual({ x: 0.25, y: 0.25 });
		expect(relativePoint(400, 10, rect)).toEqual({ x: 1, y: 0 });
		expect(relativePoint(0, 0, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
	});
});
