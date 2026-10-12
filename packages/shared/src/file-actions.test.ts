import { describe, expect, it } from "vitest";
import { FILE_MENU, relativeToCwd, TAB_MENU, tabsToClose, validateNewFileName } from "./file-actions";

describe("context menu model (P7)", () => {
	it("has 12 file items and 8 tab items, no duplicates", () => {
		const file = FILE_MENU.flat();
		const tab = TAB_MENU.flat();
		expect(file).toHaveLength(12);
		expect(new Set(file).size).toBe(12);
		expect(tab).toHaveLength(8);
		expect(new Set(tab).size).toBe(8);
	});
	it("computes relative paths on posix and windows", () => {
		expect(relativeToCwd("/p/a/b.txt", "/p")).toBe("a/b.txt");
		expect(relativeToCwd("/q/b.txt", "/p")).toBe("/q/b.txt");
		expect(relativeToCwd("C:\\Proj\\data\\x.csv", "c:\\proj")).toBe("data/x.csv");
		expect(relativeToCwd("/p2/x", "/p")).toBe("/p2/x");
		expect(relativeToCwd("/p/x", undefined)).toBe("/p/x");
	});
	it("validates new file names", () => {
		expect(validateNewFileName("ok.txt")).toBeNull();
		expect(validateNewFileName(" ")).toBe("empty");
		expect(validateNewFileName("..")).toBe("empty");
		expect(validateNewFileName("a/b")).toBe("separator");
		expect(validateNewFileName("a\\b")).toBe("separator");
		expect(validateNewFileName("CON.txt")).toBe("reserved");
		expect(validateNewFileName("a?.txt")).toBe("reserved");
	});
	it("computes tabs to close", () => {
		const ids = ["a", "b", "c", "d"];
		expect(tabsToClose(ids, "b", "close")).toEqual(["b"]);
		expect(tabsToClose(ids, "b", "closeOthers")).toEqual(["a", "c", "d"]);
		expect(tabsToClose(ids, "b", "closeRight")).toEqual(["c", "d"]);
		expect(tabsToClose(ids, "b", "closeAll")).toEqual(ids);
		expect(tabsToClose(ids, "zz", "closeRight")).toEqual([]);
	});
});
