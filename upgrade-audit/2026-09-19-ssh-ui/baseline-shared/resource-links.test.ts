import { describe, expect, it } from "vitest";
import { isLocalResourceTarget, localResourceHref } from "./resource-links";

describe("artifact resource routing", () => {
	it.each(["C:/reports/a.md", "D:\\reports\\a.csv", "/tmp/a.pdf", "results/a.txt", "file:///C:/a.md"])(
		"routes %s to local preview",
		(path) => expect(isLocalResourceTarget(path)).toBe(true),
	);
	it.each([
		"https://example.org/a",
		"zotero://select/items/A",
		"javascript:alert(1)",
		"data:text/html,x",
		"C:relative",
		"a\u0000b",
	])("does not read nonlocal/invalid target %s", (path) => expect(isLocalResourceTarget(path)).toBe(false));
	it("encodes Windows artifacts including CJK, spaces, hashes, literal percent and parentheses", () => {
		expect(localResourceHref("C:\\报告\\output (1)#100%.csv")).toBe(
			"file:///C:/%E6%8A%A5%E5%91%8A/output%20%281%29%23100%25.csv",
		);
	});
	it("encodes POSIX and relative paths without converting paths into a protocol", () => {
		expect(localResourceHref("/tmp/a.md")).toBe("file:///tmp/a.md");
		expect(localResourceHref("results/a b.md")).toBe("./results/a%20b.md");
		expect(localResourceHref("javascript:alert(1)")).toBeUndefined();
	});
});

import { resourceHeadingId, splitResourceLink } from "./resource-links";

it("separates cross-document anchors without corrupting an encoded hash in the filename", () => {
	expect(splitResourceLink("./methods.md#analysis")).toEqual({ href: "./methods.md", fragment: "analysis" });
	expect(splitResourceLink("./methods%23v2.md#%E6%96%B9%E6%B3%95")).toEqual({
		href: "./methods%23v2.md",
		fragment: "方法",
	});
	expect(resourceHeadingId("Data Analysis")).toBe("resource-heading-data-analysis");
	expect(splitResourceLink("./report.md")).toEqual({ href: "./report.md" });
});
