// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
	rewrite: vi.fn((text: string) => `rewritten:${text}`),
	parse: vi.fn(() => null),
	overview: vi.fn(),
	open: vi.fn(),
	preview: vi.fn(),
}));
vi.mock("@drone/shared", () => ({
	knowledgeLinksForDisplay: doubles.rewrite,
	parseKnowledgeHref: doubles.parse,
	splitResourceLink: (path: string) => ({ path }),
}));
vi.mock("../../api", () => ({ getPi: () => ({ getKnowledgeOverview: doubles.overview }) }));
vi.mock("../../lib/knowledge-error", () => ({ reportKnowledgeError: vi.fn() }));
vi.mock("../../stores/knowledge", () => ({
	useKnowledgeStore: { getState: () => ({ open: doubles.open }) },
}));
vi.mock("../../stores/sessions", () => ({
	useSessionsStore: Object.assign(
		(select: (value: { cwd: string }) => unknown) => select({ cwd: "/project" }),
		{ getState: () => ({ activeSessionId: "session" }) },
	),
}));
vi.mock("../../stores/theme", () => ({
	useThemeStore: (select: (value: { resolved: string }) => unknown) => select({ resolved: "light" }),
}));
vi.mock("../../stores/ui", () => ({
	useUiStore: (select: (value: { openResourcePreview: typeof doubles.preview }) => unknown) =>
		select({ openResourcePreview: doubles.preview }),
}));
vi.mock("markstream-react", () => ({
	default: ({ content, onClick }: { content: string; onClick: React.MouseEventHandler<HTMLElement> }) => (
		<div>
			<p>{content}</p>
			{[
				"knowledge://Library/Notes/a.md",
				"file:///private/example.md",
				"https://example.test/",
				"#section",
			].map((href) => (
				<a key={href} href={href} onClick={onClick}>
					{href}
				</a>
			))}
		</div>
	),
}));
vi.stubGlobal("React", React);
Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false }) });
const { Markdown } = await import("./Markdown");
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});
it("lets the contribution own every link without rewriting text or invoking host knowledge/navigation", () => {
	const onLink = vi.fn();
	render(<Markdown text="[[Library/Notes/a]]" onLink={onLink} />);
	expect(screen.getByText("[[Library/Notes/a]]")).toBeDefined();
	for (const link of screen.getAllByRole("link")) {
		expect(fireEvent.click(link)).toBe(false);
	}
	expect(onLink.mock.calls.map(([href]) => href)).toEqual([
		"knowledge://Library/Notes/a.md",
		"file:///private/example.md",
		"https://example.test/",
		"#section",
	]);
	expect(doubles.rewrite).not.toHaveBeenCalled();
	expect(doubles.parse).not.toHaveBeenCalled();
	expect(doubles.overview).not.toHaveBeenCalled();
	expect(doubles.open).not.toHaveBeenCalled();
	expect(doubles.preview).not.toHaveBeenCalled();
});
it("retains default rendering and resource routing for existing consumers", () => {
	render(<Markdown text="legacy" />);
	expect(screen.getByText("rewritten:legacy")).toBeDefined();
	fireEvent.click(screen.getByRole("link", { name: "https://example.test/" }));
	expect(doubles.preview).toHaveBeenCalledWith({
		path: "https://example.test/",
		label: "https://example.test/",
		cwd: "/project",
	});
});
