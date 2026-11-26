// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { getCustomNodeComponents, removeCustomComponents, setCustomComponents } from "markstream-react";
import React, { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { translate } from "../../i18n";

vi.stubGlobal("React", React);
vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn() }));
const { ResourceMarkdown } = await import("./ResourceMarkdown");

const tooComplex = translate("en", "resource.viewer.markdownTooComplex");

afterEach(cleanup);

it("renders headings, inline formatting, GFM tables, and read-only task lists", () => {
	const text = [
		"# Resource **Report**",
		"",
		"**bold** _italic_ ~~deleted~~ `inline`",
		"",
		"| Column | Other |",
		"| --- | --- |",
		"| **Cell** | value |",
		"",
		"- [x] done",
		"- [ ] pending",
	].join("\n");
	const { container } = render(<ResourceMarkdown text={text} onNavigate={vi.fn()} />);
	expect(screen.getByRole("heading", { name: "Resource Report", level: 1 }).id).toBe(
		"resource-heading-resource-report",
	);
	expect(container.querySelector("p strong")?.textContent).toBe("bold");
	expect(container.querySelector("p em")?.textContent).toBe("italic");
	expect(container.querySelector("p del")?.textContent).toBe("deleted");
	expect(container.querySelector("p code")?.textContent).toBe("inline");
	expect(container.querySelector(".resource-table-scroll table tbody tr strong")?.textContent).toBe("Cell");
	const tasks = screen.getAllByRole("listitem").map((item) => item.textContent?.replace(/\s+/g, " "));
	expect(tasks).toEqual(["☑ done", "☐ pending"]);
	expect(container.querySelector("input")).toBeNull();
});

it.each(["python", "mermaid", "infographic", "d2", "d2lang", "html", "table", "constructor"])(
	"routes %s fences through ResourceCode",
	(language) => {
		const { container } = render(
			<ResourceMarkdown text={`\`\`\`${language} title\nexample source\n\`\`\``} onNavigate={vi.fn()} />,
		);
		expect(screen.getByTestId("resource-code").querySelector("pre")?.textContent).toContain("example source");
		expect(screen.getByTestId("resource-code").textContent).toContain(language);
		expect(container.querySelector("svg, iframe, [class*='monaco-']")).toBeNull();
	},
);

it("keeps a long fenced code sample intact within the source limit", () => {
	const text = `${"**data** ".repeat(1_000)}\n\nLast line`;
	render(<ResourceMarkdown text={`\`\`\`\n${text}\n\`\`\``} onNavigate={vi.fn()} />);
	expect(screen.getByTestId("resource-code").querySelector("pre")?.textContent).toContain("Last line");
	expect(screen.queryByText(tooComplex)).toBeNull();
});

it("renders HTML literally and makes Markdown images navigation buttons", () => {
	const image = "https://example.invalid/report.png";
	const script = "<script>void 0</script>";
	const inline = `<img src="${image}" onerror="void 0">`;
	const onNavigate = vi.fn();
	const { container } = render(
		<ResourceMarkdown
			text={`${script}\n\nInline ${inline}.\n\n![Report plot](${image})`}
			onNavigate={onNavigate}
		/>,
	);
	expect(
		Array.from(container.querySelectorAll(".resource-html-literal"), (element) => element.textContent),
	).toEqual([script, inline]);
	expect(container.querySelector("img, script")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: /Report plot/ }));
	expect(onNavigate).toHaveBeenCalledWith(image, "Report plot");
});

it("renders inline and block math as source", () => {
	const { container } = render(<ResourceMarkdown text={"$x^2$\n\n$$\ny^2\n$$"} onNavigate={vi.fn()} />);
	expect(container.querySelector("p code")?.textContent).toBe("$x^2$");
	expect(container.querySelector(".katex, math")).toBeNull();
	expect(screen.getByText(/\$\$\s*y\^2\s*\$\$/)).toBeDefined();
});

it("intercepts rejected and relative links and passes the original destinations to the viewer", () => {
	const onNavigate = vi.fn();
	const unsafe = "javascript:alert(1)";
	const local = "./data%20table.csv";
	render(<ResourceMarkdown text={`[unsafe](${unsafe}) [relative](${local})`} onNavigate={onNavigate} />);
	const rejected = screen.getByRole("link", { name: "unsafe" });
	const allowed = screen.getByRole("link", { name: "relative" });
	expect(rejected.getAttribute("href")).toBe("#");
	expect(allowed.getAttribute("href")).toBe(local);
	expect(fireEvent.click(rejected)).toBe(false);
	expect(fireEvent.click(allowed)).toBe(false);
	expect(onNavigate.mock.calls).toEqual([
		[unsafe, "unsafe"],
		[local, "relative"],
	]);
});

it("resolves a fragment within its preview and uses that preview's navigation handler", () => {
	const firstNavigate = vi.fn();
	const secondNavigate = vi.fn();
	const text = "# A section\n\n[section](#a%20section) [open](./report.md)";
	const { container: first } = render(<ResourceMarkdown text={text} onNavigate={firstNavigate} />);
	const { container: second } = render(<ResourceMarkdown text={text} onNavigate={secondNavigate} />);
	const firstHeading = within(first).getByRole("heading");
	const secondHeading = within(second).getByRole("heading");
	firstHeading.scrollIntoView = vi.fn();
	secondHeading.scrollIntoView = vi.fn();
	fireEvent.click(within(second).getByRole("link", { name: "section" }));
	fireEvent.click(within(second).getByRole("link", { name: "open" }));
	expect(firstHeading.scrollIntoView).not.toHaveBeenCalled();
	expect(secondHeading.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
	expect(firstNavigate).not.toHaveBeenCalled();
	expect(secondNavigate.mock.calls).toEqual([["./report.md", "open"]]);
});

it("clips the source at 64,000 characters", () => {
	const text = `${Array.from({ length: 16 }, () => "x".repeat(4_096)).join("\n\n")}\n\nbeyond the clip`;
	const { container } = render(<ResourceMarkdown text={text} onNavigate={vi.fn()} />);
	expect(screen.getByText(translate("en", "resource.viewer.markdownClipped"))).toBeDefined();
	expect(screen.queryByText("beyond the clip")).toBeNull();
	const paragraphs = Array.from(container.querySelectorAll("p"), (paragraph) => paragraph.textContent);
	expect(paragraphs.filter((paragraph) => paragraph?.startsWith("x")).join("\n\n")).toBe(
		text.slice(0, 64_000),
	);
});

it("bounds delimiter-heavy complex.md before the parser stalls", () => {
	const text = "**node** ".repeat(3_000);
	const start = performance.now();
	render(<ResourceMarkdown text={text} onNavigate={vi.fn()} />);
	const elapsed = performance.now() - start;
	console.info(`complex.md render took ${elapsed.toFixed(1)} ms`);
	expect(elapsed).toBeLessThan(500);
	expect(screen.getByText(tooComplex)).toBeDefined();
});

it("bounds a long paragraph spanning multiple source lines", () => {
	const text = `${"word ".repeat(100)}\n`.repeat(20);
	render(<ResourceMarkdown text={text} onNavigate={vi.fn()} />);
	expect(screen.getByText(tooComplex)).toBeDefined();
});

it.each([
	{ rows: 2, columns: 61, expectedRows: 2, expectedColumns: 60 },
	{ rows: 201, columns: 2, expectedRows: 200, expectedColumns: 2 },
])("caps a $rows by $columns table", ({ rows, columns, expectedRows, expectedColumns }) => {
	const row = (value: string) => `| ${Array.from({ length: columns }, () => value).join(" | ")} |`;
	const text = [row("head"), row("---"), ...Array.from({ length: rows }, () => row("cell"))].join("\n");
	const { container } = render(<ResourceMarkdown text={text} onNavigate={vi.fn()} />);
	expect(container.querySelectorAll("table th")).toHaveLength(expectedColumns);
	expect(container.querySelectorAll("table tbody tr")).toHaveLength(expectedRows);
	expect(container.querySelectorAll("table tbody tr:first-child td")).toHaveLength(expectedColumns);
	expect(screen.getByText(tooComplex)).toBeDefined();
});

it("clips after 2,500 AST nodes and renders one notice under StrictMode", () => {
	const text = "**bold**\n\n".repeat(1_000);
	const { container } = render(
		<StrictMode>
			<ResourceMarkdown text={text} onNavigate={vi.fn()} />
		</StrictMode>,
	);
	expect(container.querySelectorAll("p strong")).toHaveLength(833);
	expect(screen.getAllByText(tooComplex)).toHaveLength(1);
});

it("stops walking the AST below depth 24", () => {
	const { container } = render(<ResourceMarkdown text={`${"> ".repeat(27)}too deep`} onNavigate={vi.fn()} />);
	expect(container.querySelectorAll("blockquote")).toHaveLength(25);
	expect(screen.queryByText("too deep")).toBeNull();
	expect(screen.getByText(tooComplex)).toBeDefined();
});

it("falls back to source after a renderer error and retries when the document changes", () => {
	const customId = "resource-markdown";
	const components = getCustomNodeComponents(customId);
	try {
		setCustomComponents(customId, {
			...components,
			paragraph: () => {
				throw new Error("Test resource paragraph error");
			},
		});
		const onNavigate = vi.fn();
		const onCaughtError = vi.fn();
		const { rerender } = render(<ResourceMarkdown text="Show the source" onNavigate={onNavigate} />, {
			onCaughtError,
		});
		expect(screen.getByText(translate("en", "resource.viewer.markdownInvalid"))).toBeDefined();
		expect(screen.getByTestId("resource-code").textContent).toContain("Show the source");
		expect(onCaughtError).toHaveBeenCalled();
		rerender(<ResourceMarkdown text="# Next document" onNavigate={onNavigate} />);
		expect(screen.getByRole("heading", { name: "Next document" })).toBeDefined();
		expect(screen.queryByTestId("resource-code")).toBeNull();
	} finally {
		removeCustomComponents(customId);
		setCustomComponents(customId, components);
	}
});
