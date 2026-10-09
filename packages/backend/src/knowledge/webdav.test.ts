import { describe, expect, it } from "vitest";
import { KnowledgeWebDavService } from "./webdav";

function response(status: number, body = "", headers: Record<string, string> = {}): Response {
	return new Response(body, { status, headers });
}
const collection = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/Drone-Knowledge/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;

describe("KnowledgeWebDavService", () => {
	it("does not attempt network access without the injected password", async () => {
		let requests = 0;
		const service = new KnowledgeWebDavService({
			password: () => undefined,
			fetch: async () => {
				requests++;
				return response(500);
			},
		});
		const status = await service.probe();
		expect(requests).toBe(0);
		expect(status.mode).toBe("disabled");
		expect(status.configured).toBe(false);
		expect(status.message).toContain("DRONE_WEBDAV_PASSWORD");
	});

	it("probes an existing folder and keeps credentials out of the status", async () => {
		const urls: string[] = [];
		const service = new KnowledgeWebDavService({
			password: () => "x".repeat(8),
			fetch: async (url, init) => {
				urls.push(String(url));
				return init?.method === "OPTIONS"
					? response(200, "", { allow: "OPTIONS, PROPFIND, GET, PUT" })
					: response(207, collection);
			},
		});
		const status = await service.probe();
		expect(status.mode).toBe("ready");
		expect(status.initialized).toBe(true);
		expect(status.endpoint).toBe("http://10.126.126.1:8080");
		expect(status.folder).toBe("Drone-Knowledge");
		expect(JSON.stringify(status)).not.toContain("x".repeat(8));
		expect(urls[0]).toBe("http://10.126.126.1:8080/Drone-Knowledge/");
	});

	it("negotiates Digest authentication without exposing the password", async () => {
		const authorizations: string[] = [];
		let calls = 0;
		const service = new KnowledgeWebDavService({
			password: () => "x".repeat(8),
			fetch: async (_url, init) => {
				calls++;
				authorizations.push(String((init?.headers as Record<string, string>)?.Authorization));
				return calls === 1
					? response(401, "", {
							"www-authenticate": 'Digest realm="WebDAV", nonce="nonce-1", algorithm=MD5, qop="auth"',
						})
					: response(207, collection);
			},
		});
		const status = await service.probe();
		expect(status.mode).toBe("ready");
		expect(calls).toBe(2);
		expect(authorizations[0]).toMatch(/^Basic /);
		expect(authorizations[1]).toMatch(/^Digest username="gaoyangwei"/);
		expect(authorizations[1]).toContain("qop=auth");
		expect(authorizations[1]).toContain("nc=00000001");
		expect(authorizations[1]).not.toContain("xxxxxxxx");
	});

	it("creates a missing folder without replacing an existing one", async () => {
		const methods: string[] = [];
		let first = true;
		let created = false;
		const service = new KnowledgeWebDavService({
			password: () => "x".repeat(8),
			fetch: async (url, init) => {
				methods.push(init?.method ?? "GET");
				if (first && init?.method === "PROPFIND") {
					first = false;
					return response(404);
				}
				if (init?.method === "MKCOL") {
					created = true;
					return response(201);
				}
				if (init?.method === "PROPFIND") {
					if (String(url).endsWith("/Drone-Knowledge/") && !created) return response(404);
					return response(
						207,
						String(url).endsWith("/Drone-Knowledge/")
							? collection
							: collection.replace("/Drone-Knowledge/", "/"),
					);
				}
				return response(200, "", { allow: "PROPFIND, GET, PUT, MKCOL" });
			},
		});
		const status = await service.initialize();
		expect(status.initialized).toBe(true);
		expect(methods).toEqual(["PROPFIND", "PROPFIND", "PROPFIND", "MKCOL", "PROPFIND"]);
	});

	it("uses conditional writes and reports conflicts without overwriting", async () => {
		let captured: HeadersInit | undefined;
		const service = new KnowledgeWebDavService({
			password: () => "x".repeat(8),
			fetch: async (_url, init) => {
				captured = init?.headers;
				if (init?.method === "PROPFIND") return response(207, collection);
				return response(412);
			},
		});
		const result = await service.write({ path: "Home.md", text: "# draft", expectedVersion: '"etag-1"' });
		expect(result.status).toBe("conflict");
		expect((captured as Record<string, string>)["If-Match"]).toBe('"etag-1"');
	});

	it("reads bounded Markdown and derives a stable hash when ETag is absent", async () => {
		const service = new KnowledgeWebDavService({
			password: () => "x".repeat(8),
			fetch: async () => response(200, "# note\n", { "last-modified": "yesterday" }),
		});
		const note = await service.read("Wiki/note.md");
		expect(note.text).toBe("# note\n");
		expect(note.hash).toHaveLength(64);
		expect(note.version).toBe(null);
	});
});
