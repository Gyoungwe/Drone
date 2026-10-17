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
		const requests: string[] = [];
		let reads = 0;
		const fetchImpl = async (input: string | URL, init?: RequestInit) => {
			const method = init?.method ?? "GET";
			requests.push(`${method} ${String(input)}`);
			if (method === "PUT") return { ok: true, status: 201, text: async () => "" } as Response;
			if (method === "DELETE") return { ok: true, status: 204, text: async () => "" } as Response;
			reads += 1;
			return reads === 1
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
		expect(requests.map((request) => request.split(" ")[0])).toEqual(["PUT", "GET", "DELETE", "GET"]);
	});
});
