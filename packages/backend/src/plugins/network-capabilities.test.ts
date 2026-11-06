import { describe, expect, it, vi } from "vitest";
import { declaredTarget, networkCapabilityHandlers } from "./network-capabilities";

const declared = ["api.zotero.org", "127.0.0.1:23119", "host-authorized source and institutional endpoints"];
const reads = ["127.0.0.1:23119/connector/ping"];
const context = { signal: new AbortController().signal } as Parameters<
	ReturnType<typeof networkCapabilityHandlers>["network.read"]["execute"]
>[1];
const ok = (body = "{}", init: ResponseInit = {}) => vi.fn(async () => new Response(body, init));

describe("declared network hosts", () => {
	it("admits a declared host and nothing else", () => {
		expect(declaredTarget(new URL("https://api.zotero.org/users/1/items"), declared)).toBe("api.zotero.org");
		expect(declaredTarget(new URL("https://example.com/"), declared)).toBeNull();
	});
	it("never treats a free-text entry as a host", () => {
		expect(declaredTarget(new URL("https://institutional.example/"), declared)).toBeNull();
	});
	it("admits a local service only on its declared port", () => {
		expect(declaredTarget(new URL("http://127.0.0.1:23119/api/users/0/items"), declared)).toBe(
			"127.0.0.1:23119",
		);
		expect(declaredTarget(new URL("http://127.0.0.1:8080/"), declared)).toBeNull();
		expect(declaredTarget(new URL("http://127.0.0.1/"), declared)).toBeNull();
		// A bare host admits its default port only, never every service on it.
		expect(declaredTarget(new URL("http://127.0.0.1/"), ["127.0.0.1"])).toBe("127.0.0.1");
		expect(declaredTarget(new URL("http://127.0.0.1:23119/"), ["127.0.0.1"])).toBeNull();
		expect(declaredTarget(new URL("http://localhost:23119/"), declared)).toBeNull();
	});
	it("matches the exact host only, regardless of case", () => {
		expect(declaredTarget(new URL("https://API.Zotero.org/"), declared)).toBe("api.zotero.org");
		expect(declaredTarget(new URL("https://www.api.zotero.org/"), declared)).toBeNull();
		expect(declaredTarget(new URL("https://zotero.org/"), declared)).toBeNull();
		expect(declaredTarget(new URL("https://api.zotero.org.example.com/"), declared)).toBeNull();
	});
});

describe("network capabilities", () => {
	it("sends to a declared host without following redirects and returns the response bytes", async () => {
		const fetchImpl = ok('{"ok":true}', { status: 201, headers: { "Total-Results": "3" } });
		const handlers = networkCapabilityHandlers({ hosts: declared, reads }, fetchImpl);
		const result = await handlers["network.read"].execute(
			{ method: "GET", url: "https://api.zotero.org/users/1/items", headers: { Accept: "application/json" } },
			context,
		);
		expect(fetchImpl).toHaveBeenCalledWith(
			new URL("https://api.zotero.org/users/1/items"),
			expect.objectContaining({ method: "GET", redirect: "error" }),
		);
		expect(result).toEqual({
			status: 201,
			headers: expect.objectContaining({ "total-results": "3" }),
			base64: Buffer.from('{"ok":true}').toString("base64"),
			bytes: 11,
		});
	});

	it("refuses undeclared hosts, URL credentials and host-owned headers before any request", async () => {
		const fetchImpl = ok();
		const { "network.read": read } = networkCapabilityHandlers({ hosts: declared, reads }, fetchImpl);
		await expect(read.execute({ method: "GET", url: "https://example.com/" }, context)).rejects.toThrow(
			"not declared",
		);
		await expect(
			read.execute({ method: "GET", url: "https://u:p@api.zotero.org/" }, context),
		).rejects.toThrow("credentials");
		await expect(
			read.execute({ method: "GET", url: "https://api.zotero.org/", headers: { Cookie: "a=b" } }, context),
		).rejects.toThrow("reserved");
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("sends a POST as a read only to an endpoint the manifest declares as reading", async () => {
		const fetchImpl = ok();
		const { "network.read": read } = networkCapabilityHandlers({ hosts: declared, reads }, fetchImpl);
		await read.execute(
			{ method: "POST", url: "http://127.0.0.1:23119/connector/ping", bodyBase64: "e30=" },
			context,
		);
		expect(fetchImpl).toHaveBeenCalledOnce();
		await expect(
			read.execute({ method: "POST", url: "http://127.0.0.1:23119/connector/saveItems" }, context),
		).rejects.toThrow("network write");
		// Dot segments are resolved before matching, so they cannot reach a write endpoint.
		await expect(
			read.execute({ method: "POST", url: "http://127.0.0.1:23119/connector/ping/../saveItems" }, context),
		).rejects.toThrow("network write");
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it("shows the plugin's own description of a write, labelled, beside the host's facts", () => {
		const { "network.write": write } = networkCapabilityHandlers({ hosts: declared, reads }, ok());
		expect(write.readCallable).toBe(true);
		const detail = write.approvalDetail?.(
			{ method: "POST", url: "http://127.0.0.1:23119/connector/saveItems", summary: "Save 10.1000/xyz" },
			{} as never,
		);
		expect(detail).toMatch(/POST 127\.0\.0\.1:23119\/connector\/saveItems/);
		expect(detail).toMatch(/Save 10\.1000\/xyz/);
	});

	it("writes ask unless a task grant allowance covers them, with the method and target in the host's dialog", () => {
		const { "network.write": write } = networkCapabilityHandlers({ hosts: declared, reads }, ok());
		expect(write).toMatchObject({ effect: "write", approval: "allowance" });
		expect(
			write.approvalDetail?.(
				{ method: "POST", url: "https://api.zotero.org/users/1/items?x=1" },
				{} as never,
			),
		).toContain("POST api.zotero.org/users/1/items");
	});

	it("fails instead of truncating an oversized response", async () => {
		const big = new Uint8Array(8 * 1024 * 1024 + 1);
		const { "network.read": read } = networkCapabilityHandlers(
			{ hosts: declared, reads },
			ok(big as unknown as string),
		);
		await expect(read.execute({ method: "GET", url: "https://api.zotero.org/" }, context)).rejects.toThrow(
			"exceeds",
		);
	});
});
