import { afterEach, describe, expect, it } from "vitest";
import {
	desktopLoaderOptions,
	useUtf8WindowsShell,
	WINDOWS_UTF8_SHELL_PREFIX,
} from "../src/project/trust-loader";
import {
	clearReplyLanguage,
	getReplyLanguage,
	hostText,
	normalizeReplyLanguage,
	replyLanguagePrompt,
	setReplyLanguage,
} from "../src/reply-language";
import { makeStatusTool } from "../src/tools/status";

afterEach(() => clearReplyLanguage());

const integration = { appendSystemPrompt: ["UI plugin rule"] } as never;

describe("reply language", () => {
	it("normalizes locales and mirrors the value into the env for compiled runtimes", () => {
		expect(normalizeReplyLanguage("zh-CN")).toBe("zh");
		expect(normalizeReplyLanguage("EN-us")).toBe("en");
		expect(normalizeReplyLanguage("fr")).toBeUndefined();
		expect(normalizeReplyLanguage(undefined)).toBeUndefined();
		expect(setReplyLanguage("zh-Hans")).toBe("zh");
		expect(process.env.DRONE_REPLY_LANGUAGE).toBe("zh");
		expect(setReplyLanguage("klingon")).toBe("zh");
		expect(getReplyLanguage()).toBe("zh");
	});

	it("hostText defaults to English and switches to Chinese for zh", () => {
		expect(hostText("中文", "English")).toBe("English");
		setReplyLanguage("zh");
		expect(hostText("中文", "English")).toBe("中文");
		setReplyLanguage("en");
		expect(hostText("中文", "English")).toBe("English");
	});

	it("zh rule pins user-visible text to Simplified Chinese but keeps code and names verbatim", () => {
		const zh = replyLanguagePrompt("zh").join("\n");
		expect(zh).toContain("简体中文");
		for (const field of ["set_status", "text/detail/next", "task_plan", "ask_user"])
			expect(zh).toContain(field);
		expect(zh).toMatch(/代码.*文件路径.*命令.*专有名词.*保持原文/);
		expect(replyLanguagePrompt("en").join("\n")).toMatch(/English/);
		expect(replyLanguagePrompt(undefined)).toEqual([]);
	});

	it("is appended to the desktop system prompt on every (re)load", () => {
		expect(desktopLoaderOptions(integration)).toMatchObject({ appendSystemPrompt: ["UI plugin rule"] });
		setReplyLanguage("zh");
		const zh = desktopLoaderOptions(integration) as { appendSystemPrompt: string[] };
		expect(zh.appendSystemPrompt[0]).toBe("UI plugin rule");
		expect(zh.appendSystemPrompt.slice(1)).toEqual(replyLanguagePrompt("zh"));
		setReplyLanguage("en");
		const en = desktopLoaderOptions(integration) as { appendSystemPrompt: string[] };
		expect(en.appendSystemPrompt.join("\n")).not.toContain("简体中文");
		expect(desktopLoaderOptions(undefined)).toEqual({});
	});
});

describe("set_status", () => {
	const run = async (params: Record<string, unknown>) =>
		(await makeStatusTool().execute("id", params as never, undefined, undefined, undefined as never)) as {
			content: Array<{ text: string }>;
			details: { kind?: string; status: string };
		};

	it('accepts kind "progress" as an alias of "update"', async () => {
		expect((await run({ text: "检索文献", kind: "progress" })).details.kind).toBe("update");
		expect((await run({ text: "检索文献", kind: "summary" })).details.kind).toBe("summary");
		expect((await run({ text: "检索文献" })).details).not.toHaveProperty("kind");
	});

	it("asks for the user's language and localizes the host result", async () => {
		const schema = JSON.stringify(makeStatusTool().parameters);
		expect(schema).toContain("user's language");
		expect((await run({ text: "Searching" })).content[0].text).toBe("Status updated: Searching");
		setReplyLanguage("zh");
		expect((await run({ text: "正在检索  文献" })).content[0].text).toBe("状态已更新：正在检索 文献");
	});
});

describe("Windows UTF-8 shell prefix", () => {
	const settings = (prefix?: string) => ({ getShellCommandPrefix: () => prefix });

	it("switches the console code page before bash commands on Windows only", () => {
		expect(useUtf8WindowsShell(settings(), "win32").getShellCommandPrefix()).toBe(WINDOWS_UTF8_SHELL_PREFIX);
		expect(useUtf8WindowsShell(settings("source ~/.env"), "win32").getShellCommandPrefix()).toBe(
			`${WINDOWS_UTF8_SHELL_PREFIX}\nsource ~/.env`,
		);
		expect(useUtf8WindowsShell(settings("source ~/.env"), "linux").getShellCommandPrefix()).toBe(
			"source ~/.env",
		);
		expect(useUtf8WindowsShell(settings(undefined), "darwin").getShellCommandPrefix()).toBeUndefined();
	});

	it("does not stack the prefix when applied twice", () => {
		const twice = useUtf8WindowsShell(useUtf8WindowsShell(settings(), "win32"), "win32");
		expect(twice.getShellCommandPrefix()).toBe(WINDOWS_UTF8_SHELL_PREFIX);
	});
});
