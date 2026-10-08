import { describe, expect, it } from "vitest";
import { zoteroLibraryEnvValue, zoteroLibraryPath } from "../src/zotero-library";
import { createCompositeZoteroReconciler, createZoteroReconciler } from "../src/zotero-reconcile-runtime";
import { zoteroWebApiConfig } from "../src/zotero-write-runtime";

describe("Zotero library type spellings", () => {
	it("maps singular (pyzotero) and plural (Web API path) spellings to one path segment", () => {
		for (const value of [undefined, null, "", "user", "users", "USER", " users "])
			expect(zoteroLibraryPath(value)).toBe("users");
		for (const value of ["group", "groups", "Groups"]) expect(zoteroLibraryPath(value)).toBe("groups");
		expect(zoteroLibraryPath("userss")).toBeNull();
		expect(zoteroLibraryEnvValue("users")).toBe("user");
		expect(zoteroLibraryEnvValue("groups")).toBe("group");
		expect(zoteroLibraryEnvValue(undefined)).toBe("user");
	});

	it("native Web API channel builds /users and /groups URLs from either spelling, never /userss", () => {
		const base = { ZOTERO_API_KEY: "k".repeat(24), ZOTERO_LIBRARY_ID: "123" };
		expect(zoteroWebApiConfig({ ...base, ZOTERO_LIBRARY_TYPE: "user" })).toMatchObject({
			libraryType: "users",
			configured: true,
		});
		expect(zoteroWebApiConfig({ ...base, ZOTERO_LIBRARY_TYPE: "users" })).toMatchObject({
			libraryType: "users",
			configured: true,
		});
		expect(zoteroWebApiConfig({ ...base, ZOTERO_LIBRARY_TYPE: "group" })).toMatchObject({
			libraryType: "groups",
			configured: true,
		});
		expect(zoteroWebApiConfig({ ...base, ZOTERO_LIBRARY_TYPE: "bogus" }).configured).toBe(false);
	});

	it("read-only reconciler queries /users/<id> for the singular spelling", async () => {
		const paths: string[] = [];
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async (url: string) => {
			paths.push(String(url));
			return new Response("[]", { status: 200, headers: { "Total-Results": "0" } });
		}) as typeof fetch;
		try {
			const reconcile = createZoteroReconciler({ libraryType: "user", libraryId: "123", apiKey: "k" });
			await reconcile({ doi: "10.1000/xyz" });
		} finally {
			globalThis.fetch = realFetch;
		}
		expect(paths.length).toBeGreaterThan(0);
		for (const path of paths) {
			expect(path).toMatch(/^https:\/\/api\.zotero\.org\/users\/123\//);
			expect(path).not.toContain("userss");
		}
	});

	it("composite reconciler treats a singular group library as a group, not the personal library", async () => {
		const realFetch = globalThis.fetch;
		const localCalls = async (type: string) => {
			const urls: string[] = [];
			globalThis.fetch = (async (url: string) => {
				urls.push(String(url));
				return new Response("[]", { status: 200, headers: { "Total-Results": "0" } });
			}) as typeof fetch;
			try {
				const reconcile = createCompositeZoteroReconciler({
					web: async () => ({ state: "unavailable", reason: "web" }),
					env: { ZOTERO_LIBRARY_TYPE: type, ZOTERO_LIBRARY_ID: "99" },
				});
				await reconcile({ doi: "10.1000/xyz", libraryId: "99" });
			} finally {
				globalThis.fetch = realFetch;
			}
			return urls.filter((url) => url.startsWith("http://127.0.0.1:23119")).length;
		};
		// Group library 99 is not reachable through the desktop's personal-library local API.
		expect(await localCalls("group")).toBe(0);
		expect(await localCalls("groups")).toBe(0);
		// Personal library id 99 is.
		expect(await localCalls("user")).toBeGreaterThan(0);
	});
});
