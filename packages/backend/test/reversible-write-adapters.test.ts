import { describe, expect, it } from "vitest";
import {
	createProtocolsBookmarkWriteAdapter,
	createWebdavWriteAdapter,
	createWebdavWritePort,
} from "../src/services/reversible-write-adapters";

const input = {
	action: "prepare" as const,
	payload: { title: "Temporary acceptance note" },
};

describe("reversible research write adapters", () => {
	it("fails closed without an authorized host port", async () => {
		const adapter = createWebdavWriteAdapter();
		const plan = adapter.prepare({ ...input, adapterId: "webdav-write", targetRef: "/acceptance/note.md" });
		expect(adapter.writeEnabled).toBe(false);
		await expect(adapter.execute(plan, { approved: true })).rejects.toThrow("unavailable");
	});

	it("records a verified create/readback/delete closure for WebDAV", async () => {
		const calls: string[] = [];
		const adapter = createWebdavWriteAdapter({
			write: async ({ targetRef }) => {
				calls.push(targetRef);
				return { externalRef: `webdav:${targetRef}`, readBack: true, deleted: true };
			},
		});
		const plan = adapter.prepare({ ...input, adapterId: "webdav-write", targetRef: "/acceptance/note.md" });
		await expect(adapter.execute(plan, { approved: false })).rejects.toThrow("approval");
		expect(await adapter.execute(plan, { approved: true })).toMatchObject({
			status: "executed",
			readBack: "verified",
			deleted: "verified",
		});
		expect(calls).toEqual(["/acceptance/note.md"]);
	});

	it("rejects a Protocols.io write without deletion verification", async () => {
		const adapter = createProtocolsBookmarkWriteAdapter({
			write: async ({ targetRef }) => ({
				externalRef: `protocols:${targetRef}`,
				readBack: true,
				deleted: false,
			}),
		});
		const plan = adapter.prepare({
			...input,
			adapterId: "protocols-bookmark-write",
			targetRef: "10.1234/protocol-guid",
		});
		await expect(adapter.execute(plan, { approved: true })).rejects.toThrow("closure");
	});

	it("executes the backend WebDAV HTTP contract in order", async () => {
		const requests: Array<{ method: string; headers?: HeadersInit }> = [];
		let gets = 0;
		const fetchImpl = async (request: string | URL, init?: RequestInit) => {
			const method = init?.method ?? "GET";
			requests.push({ method, headers: init?.headers });
			if (method === "PUT") return { ok: true, status: 201, text: async () => "" } as Response;
			if (method === "DELETE") return { ok: true, status: 204, text: async () => "" } as Response;
			gets += 1;
			return gets === 1
				? ({ ok: false, status: 404, text: async () => "" } as Response)
				: gets === 2
					? ({ ok: true, status: 200, text: async () => '{"title":"Temporary acceptance note"}' } as Response)
					: ({ ok: false, status: 404, text: async () => "" } as Response);
		};
		const port = createWebdavWritePort({
			baseUrl: "http://dav.test:8080",
			username: "user",
			password: "password",
			fetchImpl,
		});
		const result = await port.write({
			targetRef: "/acceptance/note.json",
			payload: input.payload,
		});
		expect(result).toEqual({
			externalRef: "http://dav.test:8080/acceptance/note.json",
			readBack: true,
			deleted: true,
		});
		expect(requests.map(({ method }) => method)).toEqual(["GET", "PUT", "GET", "DELETE", "GET"]);
		expect(requests[1]?.headers).toMatchObject({ "If-None-Match": "*" });
	});

	it("cleans up a created object when readback fails", async () => {
		const methods: string[] = [];
		const fetchImpl = async (_request: string | URL, init?: RequestInit) => {
			const method = init?.method ?? "GET";
			methods.push(method);
			if (method === "GET" && methods.length === 1) {
				return { ok: false, status: 404, text: async () => "" } as Response;
			}
			if (method === "PUT") return { ok: true, status: 201, text: async () => "" } as Response;
			if (method === "GET") return { ok: true, status: 200, text: async () => '{"title":"other"}' } as Response;
			return { ok: true, status: 204, text: async () => "" } as Response;
		};
		const port = createWebdavWritePort({
			baseUrl: "http://dav.test:8080",
			username: "user",
			password: "password",
			fetchImpl,
		});
		await expect(port.write({ targetRef: "/acceptance/failure.json", payload: input.payload })).rejects.toThrow(
			"readback failed",
		);
		expect(methods).toEqual(["GET", "PUT", "GET", "DELETE"]);
	});

	it("refuses existing, cross-origin, and traversal targets", async () => {
		const existingFetch = async (_request: string | URL, init?: RequestInit) =>
			(init?.method === "GET"
				? ({ ok: true, status: 200, text: async () => '{"title":"existing"}' } as Response)
				: ({ ok: true, status: 201, text: async () => "" } as Response));
		const existingPort = createWebdavWritePort({
			baseUrl: "http://dav.test:8080/dav/",
			username: "user",
			password: "password",
			fetchImpl: existingFetch,
		});
		await expect(
			existingPort.write({ targetRef: "/dav/existing.json", payload: input.payload }),
		).rejects.toThrow("already exists");
		await expect(
			existingPort.write({ targetRef: "https://other.test/escape.json", payload: input.payload }),
		).rejects.toThrow("configured WebDAV origin");
		await expect(
			existingPort.write({ targetRef: "/../escape.json", payload: input.payload }),
		).rejects.toThrow("traversal");
	});
});
