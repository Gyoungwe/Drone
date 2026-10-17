import { describe, expect, it } from "vitest";
import {
	createProtocolsBookmarkWriteAdapter,
	createProtocolsBookmarkWritePort,
	createProtocolsBookmarkWritePortFromEnv,
	createWebdavWriteAdapter,
	createWebdavWritePort,
	createWebdavWritePortFromEnv,
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

	it("rejects WebDAV base URLs with query or fragment", () => {
		expect(() =>
			createWebdavWritePort({
				baseUrl: "https://dav.test/dav/?token=temporary",
				username: "user",
				password: "password",
			}),
		).toThrow("query or fragment");
	});

	it("fails closed on malformed optional WebDAV environment", () => {
		expect(
			createWebdavWritePortFromEnv({
				DRONE_WEBDAV_BASE_URL: "not a URL",
				DRONE_WEBDAV_USERNAME: "user",
				DRONE_WEBDAV_PASSWORD: "password",
			}),
		).toBeUndefined();
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

	it("accepts browser-relative WebDAV and Protocols.io references", () => {
		const webdav = createWebdavWriteAdapter();
		expect(() =>
			webdav.prepare({ ...input, adapterId: "webdav-write", targetRef: "README.md" }),
		).not.toThrow();
		const protocols = createProtocolsBookmarkWriteAdapter();
		expect(() =>
			protocols.prepare({
				...input,
				adapterId: "protocols-bookmark-write",
				targetRef: "protocols:protocol-guid",
			}),
		).not.toThrow();
		expect(() =>
			protocols.prepare({
				...input,
				adapterId: "protocols-bookmark-write",
				targetRef: "crossref:10.1234/protocol-guid",
			}),
		).not.toThrow();
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
		await expect(adapter.execute(plan, { approved: true })).resolves.toMatchObject({
			status: "failed",
			externalRef: "protocols:10.1234/protocol-guid",
			readBack: "verified",
			deleted: "unverified",
		});
	});

	it("executes the backend WebDAV HTTP contract after an auth challenge", async () => {
		const requests: Array<{ method: string; authorization: string | null; ifMatch: string | null }> = [];
		let gets = 0;
		const fetchImpl = async (_request: string | URL, init?: RequestInit) => {
			void _request;
			const method = init?.method ?? "GET";
			const headers = new Headers(init?.headers);
			const authorization = headers.get("authorization");
			const ifMatch = headers.get("if-match");
			requests.push({ method, authorization, ifMatch });
			if (method === "GET") {
				gets += 1;
				if (gets === 1 && !authorization) {
					return new Response("", {
						status: 401,
						headers: { "WWW-Authenticate": 'Basic realm="dav"' },
					});
				}
				if (gets === 2) return new Response("", { status: 404 });
				if (gets === 3) {
					return new Response('{"title":"Temporary acceptance note"}', {
						status: 200,
						headers: { ETag: '"v1"' },
					});
				}
				return new Response("", { status: 404 });
			}
			if (method === "PUT") return new Response("", { status: 201, headers: { ETag: '"v1"' } });
			return new Response(null, { status: 204 });
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
		expect(requests.map(({ method }) => method)).toEqual(["GET", "GET", "PUT", "GET", "DELETE", "GET"]);
		expect(requests[0]?.authorization).toBeNull();
		expect(requests.slice(1).every(({ authorization }) => authorization?.startsWith("Basic "))).toBe(true);
		expect(requests.find(({ method }) => method === "DELETE")?.ifMatch).toBe('"v1"');
	});

	it("propagates cancellation to WebDAV requests", async () => {
		const controller = new AbortController();
		let receivedSignal: AbortSignal | undefined;
		const fetchImpl = async (_request: string | URL, init?: RequestInit) => {
			void _request;
			receivedSignal = init?.signal;
			controller.abort();
			throw new Error("aborted");
		};
		const port = createWebdavWritePort({
			baseUrl: "http://dav.test:8080",
			username: "user",
			password: "password",
			fetchImpl,
		});
		await expect(
			port.write({
				targetRef: "/acceptance/cancel.json",
				payload: input.payload,
				signal: controller.signal,
			}),
		).rejects.toThrow("已取消");
		expect(receivedSignal?.aborted).toBe(true);
	});

	it("reconciles a PUT that fails after the server commits", async () => {
		const methods: string[] = [];
		let deleteIfMatch: string | null = null;
		const fetchImpl = async (_request: string | URL, init?: RequestInit) => {
			void _request;
			const method = init?.method ?? "GET";
			methods.push(method);
			if (method === "GET" && methods.length === 1) return new Response("", { status: 404 });
			if (method === "PUT") throw new Error("response lost after commit");
			if (method === "GET") {
				return new Response(JSON.stringify(input.payload), {
					status: 200,
					headers: { ETag: '"v1"' },
				});
			}
			deleteIfMatch = new Headers(init?.headers).get("if-match");
			return new Response(null, { status: 204 });
		};
		const port = createWebdavWritePort({
			baseUrl: "http://dav.test:8080",
			username: "user",
			password: "password",
			fetchImpl,
		});
		await expect(
			port.write({ targetRef: "/acceptance/uncertain.json", payload: input.payload }),
		).rejects.toThrow("暂时不可达");
		expect(methods).toEqual(["GET", "PUT", "GET", "DELETE"]);
		expect(deleteIfMatch).toBe('"v1"');
	});

	it("does not reconcile a definitive failed PUT", async () => {
		const methods: string[] = [];
		const fetchImpl = async (_request: string | URL, init?: RequestInit) => {
			void _request;
			const method = init?.method ?? "GET";
			methods.push(method);
			if (method === "GET") return new Response("", { status: 404 });
			return new Response("", { status: 412 });
		};
		const port = createWebdavWritePort({
			baseUrl: "http://dav.test:8080",
			username: "user",
			password: "password",
			fetchImpl,
		});
		await expect(
			port.write({ targetRef: "/acceptance/conflict.json", payload: input.payload }),
		).rejects.toThrow("WebDAV PUT failed (412)");
		expect(methods).toEqual(["GET", "PUT"]);
	});

	it("refuses to delete after a readback ETag change", async () => {
		const methods: string[] = [];
		let deleteIfMatch: string | null = null;
		const fetchImpl = async (_request: string | URL, init?: RequestInit) => {
			void _request;
			const method = init?.method ?? "GET";
			methods.push(method);
			if (method === "GET" && methods.length === 1) return new Response("", { status: 404 });
			if (method === "PUT") return new Response("", { status: 201, headers: { ETag: '"v1"' } });
			if (method === "GET") {
				return new Response(JSON.stringify(input.payload), {
					status: 200,
					headers: { ETag: '"v2"' },
				});
			}
			deleteIfMatch = new Headers(init?.headers).get("if-match");
			return new Response("", { status: 412 });
		};
		const port = createWebdavWritePort({
			baseUrl: "http://dav.test:8080",
			username: "user",
			password: "password",
			fetchImpl,
		});
		await expect(
			port.write({ targetRef: "/acceptance/etag-change.json", payload: input.payload }),
		).rejects.toThrow("ETag changed");
		expect(methods).toEqual(["GET", "PUT", "GET", "DELETE"]);
		expect(deleteIfMatch).toBe('"v1"');
	});

	it("cleans up a created object when readback fails", async () => {
		const methods: string[] = [];
		const fetchImpl = async (_request: string | URL, init?: RequestInit) => {
			void _request;
			const method = init?.method ?? "GET";
			methods.push(method);
			if (method === "GET" && methods.length === 1) return new Response("", { status: 404 });
			if (method === "PUT") return new Response("", { status: 201, headers: { ETag: '"v1"' } });
			if (method === "GET") {
				return new Response('{"title":"noteworthy"}', {
					status: 200,
					headers: { ETag: '"v1"' },
				});
			}
			return new Response(null, { status: 204 });
		};
		const port = createWebdavWritePort({
			baseUrl: "http://dav.test:8080",
			username: "user",
			password: "password",
			fetchImpl,
		});
		await expect(
			port.write({ targetRef: "/acceptance/failure.json", payload: input.payload }),
		).rejects.toThrow("readback failed");
		expect(methods).toEqual(["GET", "PUT", "GET", "DELETE"]);
	});

	it("cleans up with the PUT ETag when readback throws", async () => {
		const methods: string[] = [];
		let deleteIfMatch: string | null = null;
		const fetchImpl = async (_request: string | URL, init?: RequestInit) => {
			void _request;
			const method = init?.method ?? "GET";
			methods.push(method);
			if (method === "GET" && methods.length === 1) return new Response("", { status: 404 });
			if (method === "PUT") return new Response("", { status: 201, headers: { ETag: '"v1"' } });
			if (method === "GET") throw new Error("readback transport failed");
			deleteIfMatch = new Headers(init?.headers).get("if-match");
			return new Response(null, { status: 204 });
		};
		const port = createWebdavWritePort({
			baseUrl: "http://dav.test:8080",
			username: "user",
			password: "password",
			fetchImpl,
		});
		await expect(
			port.write({ targetRef: "/acceptance/network.json", payload: input.payload }),
		).rejects.toThrow("暂时不可达");
		expect(methods).toEqual(["GET", "PUT", "GET", "DELETE"]);
		expect(deleteIfMatch).toBe('"v1"');
	});

	it("refuses existing, cross-origin, and traversal targets", async () => {
		const existingRequests: string[] = [];
		const existingFetch = async (request: string | URL, init?: RequestInit) => {
			existingRequests.push(String(request));
			return init?.method === "GET"
				? new Response('{"title":"existing"}', { status: 200 })
				: new Response("", { status: 201 });
		};
		const existingPort = createWebdavWritePort({
			baseUrl: "http://dav.test:8080/dav/",
			username: "user",
			password: "password",
			fetchImpl: existingFetch,
		});
		await expect(
			existingPort.write({ targetRef: "/dav/existing.json", payload: input.payload }),
		).rejects.toThrow("already exists");
		expect(existingRequests[0]).toBe("http://dav.test:8080/dav/existing.json");
		await expect(
			existingPort.write({ targetRef: "https://other.test/escape.json", payload: input.payload }),
		).rejects.toThrow("configured WebDAV origin");
		await expect(
			existingPort.write({ targetRef: "/../escape.json", payload: input.payload }),
		).rejects.toThrow("traversal");
	});

	it("executes the Protocols.io bookmark API closure with bearer auth", async () => {
		const requests: Array<{ method: string; url: string; authorization: string | null }> = [];
		let call = 0;
		const fetchImpl = async (request: string | URL, init?: RequestInit) => {
			const method = init?.method ?? "GET";
			const headers = new Headers(init?.headers);
			requests.push({ method, url: String(request), authorization: headers.get("authorization") });
			call += 1;
			if (call === 1 || call === 3 || call === 5) {
				return new Response(JSON.stringify({ status_code: 0, protocol: { uri: "protocol-guid", title: "Demo" } }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			return new Response(JSON.stringify({ status_code: 0 }), {
				status: call === 2 ? 200 : 200,
				headers: { "content-type": "application/json" },
			});
		};
		const port = createProtocolsBookmarkWritePort({
			apiBaseUrl: "https://protocols.test/api/v3",
			apiToken: "temporary-token",
			fetchImpl,
		});
		await expect(
			port.write({ targetRef: "protocols:protocol-guid", payload: input.payload }),
		).resolves.toEqual({
			externalRef: "https://www.protocols.io/view/protocol-guid",
			readBack: true,
			deleted: true,
		});
		expect(requests.map(({ method }) => method)).toEqual(["GET", "POST", "GET", "DELETE", "GET"]);
		expect(requests.every(({ authorization }) => authorization === "Bearer temporary-token")).toBe(true);
		expect(requests[0]?.url).toBe("https://protocols.test/api/v3/protocols/protocol-guid");
		expect(requests[1]?.url).toBe("https://protocols.test/api/v3/protocols/protocol-guid/bookmarks");
	});

	it("fails closed when Protocols.io environment is absent or malformed", () => {
		expect(createProtocolsBookmarkWritePortFromEnv({})).toBeUndefined();
		expect(
			createProtocolsBookmarkWritePortFromEnv({
				PROTOCOLS_IO_API_TOKEN: "temporary-token",
				PROTOCOLS_IO_API_BASE: "not a URL",
			}),
		).toBeUndefined();
	});

	it("does not delete a Protocols.io bookmark when POST outcome is uncertain", async () => {
		const methods: string[] = [];
		const fetchImpl = async (_request: string | URL, init?: RequestInit) => {
			void _request;
			const method = init?.method ?? "GET";
			methods.push(method);
			if (method === "GET") {
				return new Response(JSON.stringify({ status_code: 0, protocol: { uri: "protocol-guid" } }), {
					status: 200,
				});
			}
			throw new Error("connection closed after commit");
		};
		const port = createProtocolsBookmarkWritePort({
			apiBaseUrl: "https://protocols.test/api/v3",
			apiToken: "temporary-token",
			fetchImpl,
		});
		await expect(
			port.write({ targetRef: "protocol-guid", payload: input.payload }),
		).rejects.toThrow("connection closed after commit");
		expect(methods).toEqual(["GET", "POST"]);
	});

});
