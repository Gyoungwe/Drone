import { describe, expect, it } from "vitest";
import { zoteroLibraryEnvValue, zoteroLibraryPath } from "./zotero";

describe("Zotero library type normalization", () => {
	it("normalizes personal and group path spellings", () => {
		expect(zoteroLibraryPath(undefined)).toBe("users");
		expect(zoteroLibraryPath("user")).toBe("users");
		expect(zoteroLibraryPath("GROUPS")).toBe("groups");
		expect(zoteroLibraryPath("unknown")).toBeNull();
	});

	it("returns the singular MCP environment value", () => {
		expect(zoteroLibraryEnvValue("users")).toBe("user");
		expect(zoteroLibraryEnvValue("groups")).toBe("group");
		expect(zoteroLibraryEnvValue(null)).toBe("user");
	});
});
