// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import MarkdownRender, { setCustomComponents } from "markstream-react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatCodeBlock } from "./ChatCodeBlock";

vi.stubGlobal("React", React);

const theme = vi.hoisted(() => ({ resolved: "light" as "light" | "dark" }));
vi.mock("../../stores/theme", () => ({
	useThemeStore: (select: (value: { resolved: string }) => unknown) => select({ resolved: theme.resolved }),
}));

const clipboard = vi.hoisted(() => ({
	writeText: vi.fn(async () => undefined),
}));
vi.stubGlobal("navigator", {
	...navigator,
	clipboard: { writeText: clipboard.writeText },
});

/** 未登记的语言返回 null（与真实实现一致：调用方回退到纯文本）。 */
const KNOWN_LANGUAGES = new Set(["ts", "typescript", "python", "bash", "json", "sql"]);
vi.mock("../../lib/shiki-highlighter", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../lib/shiki-highlighter")>();
	return {
		...actual,
		highlightCode: vi.fn(async (code: string, language: string) => {
			if (!KNOWN_LANGUAGES.has(language)) return null;
			return {
				language,
				lines: code.split("\n").map((line) => [{ content: line, color: "#ff0000" }]),
			};
		}),
	};
});

const CHAT_MARKDOWN_ID = "chat-markdown-test";
setCustomComponents(CHAT_MARKDOWN_ID, { code_block: ChatCodeBlock });

function renderMarkdown(content: string, streaming = false) {
	return render(
		React.createElement(MarkdownRender, {
			customId: CHAT_MARKDOWN_ID,
			content,
			final: !streaming,
			fade: false,
			smoothStreaming: false,
		}),
	);
}

beforeEach(() => {
	theme.resolved = "light";
	clipboard.writeText.mockClear();
	clipboard.writeText.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("chat code block rendering", () => {
	it("renders highlighted code without any monaco editor", async () => {
		renderMarkdown("```ts\nconst a = 1;\n```");
		await waitFor(() => expect(screen.getByTestId("chat-code-block")).toBeDefined());
		expect(document.querySelector("[class*='monaco-']")).toBeNull();
		expect(screen.getByTestId("chat-code-block").getAttribute("data-language")).toBe("ts");
		await waitFor(() => expect(document.querySelector(".chat-code-highlighted")).not.toBeNull());
		expect(document.querySelector(".chat-code-plain")).toBeNull();
	});

	it("falls back to plain monospace text for unknown languages", async () => {
		renderMarkdown("```not-a-real-language\nsome text\n```");
		await waitFor(() => expect(screen.getByTestId("chat-code-block")).toBeDefined());
		await waitFor(() => expect(document.querySelector(".chat-code-plain")).not.toBeNull());
		expect(document.querySelector(".chat-code-highlighted")).toBeNull();
		expect(screen.getByTestId("chat-code-block").textContent).toContain("some text");
	});

	it("switches the highlighting theme with the resolved theme", async () => {
		const { highlightCode } = await import("../../lib/shiki-highlighter");
		renderMarkdown("```ts\nconst a = 1;\n```");
		await waitFor(() => expect(screen.getByTestId("chat-code-block")).toBeDefined());
		await waitFor(() => expect(highlightCode).toHaveBeenCalled());
		expect((highlightCode as ReturnType<typeof vi.fn>).mock.calls[0]?.[2]).toBe("vitesse-light");
	});
});

describe("chat code block copy action", () => {
	it("copies the code and confirms it", async () => {
		renderMarkdown("```ts\nconst a = 1;\n```");
		await waitFor(() => expect(screen.getByTestId("chat-code-block")).toBeDefined());
		const button = screen.getByRole("button");
		fireEvent.click(button);
		await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith("const a = 1;\n"));
		await waitFor(() => expect(button.textContent).toBe("Copied"));
	});

	it("reports a clipboard failure instead of claiming success", async () => {
		clipboard.writeText.mockRejectedValueOnce(new Error("denied"));
		renderMarkdown("```ts\nconst a = 1;\n```");
		await waitFor(() => expect(screen.getByTestId("chat-code-block")).toBeDefined());
		fireEvent.click(screen.getByRole("button"));
		await waitFor(() => expect(screen.getByRole("status")).not.toBeNull());
		expect(screen.getByRole("status").textContent).toContain("Copy failed");
	});
});

describe("chat code block diff view", () => {
	it("renders diff blocks with add and delete line styling", async () => {
		renderMarkdown("```diff\n- const oldValue = 1;\n+ const newValue = 2;\n```");
		await waitFor(() => expect(screen.getByTestId("chat-code-block")).toBeDefined());
		await waitFor(() => expect(document.querySelector(".chat-code-diff")).not.toBeNull());
		const add = document.querySelector(".chat-code-diff-line.is-add");
		const del = document.querySelector(".chat-code-diff-line.is-del");
		expect(add?.textContent).toContain("const newValue = 2;");
		expect(del?.textContent).toContain("const oldValue = 1;");
	});
});

describe("chat code block overflow handling", () => {
	it("shows the full code and copies the full code when an unknown-language block exceeds the limit", async () => {
		const long = "x".repeat(200_001);
		renderMarkdown(`\`\`\`not-a-real-language\n${long}\n\`\`\``);
		await waitFor(() => expect(screen.getByTestId("chat-code-block")).toBeDefined());
		await waitFor(() => expect(document.querySelector(".chat-code-plain")).not.toBeNull());
		// 显示的是全文（高亮上限只限制高亮成本，不静默截断显示）。
		expect(document.querySelector(".chat-code-plain")?.textContent).toContain(long);
		fireEvent.click(screen.getByRole("button"));
		await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(`${long}\n`));
	});

	it("skips highlighting for an oversized known-language block while showing and copying the full code", async () => {
		const { highlightCode } = await import("../../lib/shiki-highlighter");
		const mocked = highlightCode as ReturnType<typeof vi.fn>;
		mocked.mockClear();
		const long = "x".repeat(200_001);
		renderMarkdown(`\`\`\`ts\n${long}\n\`\`\``);
		await waitFor(() => expect(screen.getByTestId("chat-code-block")).toBeDefined());
		await waitFor(() => expect(document.querySelector(".chat-code-plain")).not.toBeNull());
		expect(mocked).not.toHaveBeenCalled();
		expect(document.querySelector(".chat-code-plain")?.textContent).toContain(long);
		fireEvent.click(screen.getByRole("button"));
		await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(`${long}\n`));
	});
});

describe("chat code block streaming", () => {
	it("keeps a growing unclosed fence mounted while streaming", async () => {
		const { rerender } = renderMarkdown("```ts\nconst a = 1;\n", true);
		await waitFor(() => expect(screen.getByTestId("chat-code-block")).toBeDefined());
		const first = screen.getByTestId("chat-code-block");
		rerender(
			React.createElement(MarkdownRender, {
				customId: CHAT_MARKDOWN_ID,
				content: "```ts\nconst a = 1;\nconst b = 2;\n",
				final: false,
				fade: false,
				smoothStreaming: false,
			}),
		);
		const second = screen.getByTestId("chat-code-block");
		expect(second).toBe(first);
		expect(second.textContent).toContain("const b = 2;");
	});

	it("debounces highlighting of a growing fence instead of re-tokenizing every append", async () => {
		const { highlightCode } = await import("../../lib/shiki-highlighter");
		const mocked = highlightCode as ReturnType<typeof vi.fn>;
		mocked.mockClear();
		const { rerender } = renderMarkdown("```ts\nconst a = 1;\n", true);
		await waitFor(() => expect(screen.getByTestId("chat-code-block")).toBeDefined());
		// 未闭合围栏：内容变化期间先显示纯文本，不逐次重算整段。
		await waitFor(() => expect(document.querySelector(".chat-code-plain")).not.toBeNull());
		for (let index = 2; index <= 6; index += 1) {
			rerender(
				React.createElement(MarkdownRender, {
					customId: CHAT_MARKDOWN_ID,
					content: `\`\`\`ts\n${"const v = 1;\n".repeat(index)}`,
					final: false,
					fade: false,
					smoothStreaming: false,
				}),
			);
		}
		expect(mocked).not.toHaveBeenCalled();
		// 内容稳定后只高亮一次（去抖窗口内合并所有追加）。
		await waitFor(() => expect(mocked).toHaveBeenCalledTimes(1));
	});
});
