import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgeWebDavService } from "./webdav";
import type { WebDavCredentialStore } from "./webdav-credentials";

function memoryCredentials(initial: string | null = null): WebDavCredentialStore & { value: string | null } {
	const store = {
		value: initial,
		load: async () => store.value,
		save: async (password: string) => {
			store.value = password;
		},
		clear: async () => {
			store.value = null;
		},
	};
	return store;
}

function response(status: number, body = "", headers: Record<string, string> = {}): Response {
	return new Response(body, { status, headers });
}
const collection = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/Drone-Knowledge/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;

afterEach(() => vi.unstubAllEnvs());

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
		expect(authorizations[0]).toBe("undefined");
		expect(authorizations.some((value) => value.startsWith("Basic "))).toBe(false);
		expect(authorizations[1]).toMatch(/^Digest username="gaoyangwei"/);
		expect(authorizations[1]).toContain("qop=auth");
		expect(authorizations[1]).toContain("nc=00000001");
		expect(authorizations[1]).not.toContain("xxxxxxxx");
	});

	it("sends Basic credentials only after the server asks for Basic, then reuses it", async () => {
		const authorizations: Array<string | undefined> = [];
		const service = new KnowledgeWebDavService({
			password: () => "x".repeat(8),
			fetch: async (_url, init) => {
				const authorization = (init?.headers as Record<string, string>)?.Authorization;
				authorizations.push(authorization);
				return authorization
					? response(207, collection)
					: response(401, "", { "www-authenticate": 'Basic realm="WebDAV"' });
			},
		});
		expect((await service.probe()).mode).toBe("ready");
		expect(authorizations[0]).toBeUndefined();
		expect(authorizations[1]).toMatch(/^Basic /);
		await service.probe();
		expect(authorizations[2]).toMatch(/^Basic /);
	});

	it("prefers Digest when the server offers both schemes", async () => {
		const authorizations: Array<string | undefined> = [];
		const service = new KnowledgeWebDavService({
			password: () => "x".repeat(8),
			fetch: async (_url, init) => {
				const authorization = (init?.headers as Record<string, string>)?.Authorization;
				authorizations.push(authorization);
				return authorization
					? response(207, collection)
					: response(401, "", {
							"www-authenticate": 'Basic realm="WebDAV", Digest realm="WebDAV", nonce="n1", qop="auth"',
						});
			},
		});
		expect((await service.probe()).mode).toBe("ready");
		expect(authorizations[1]).toMatch(/^Digest /);
		expect(authorizations.some((value) => value?.startsWith("Basic "))).toBe(false);
	});

	it("uses a password saved from the settings page without exposing it", async () => {
		vi.stubEnv("DRONE_WEBDAV_PASSWORD", "");
		const credentials = memoryCredentials();
		let requests = 0;
		const service = new KnowledgeWebDavService({
			credentials,
			fetch: async () => {
				requests++;
				return response(207, collection);
			},
		});
		expect((await service.getStatus()).passwordSource).toBeNull();
		const saved = await service.setPassword("s3cret-pass");
		expect(saved.configured).toBe(true);
		expect(saved.passwordSource).toBe("saved");
		expect(requests).toBe(0);
		expect(JSON.stringify(saved)).not.toContain("s3cret-pass");
		expect(credentials.value).toBe("s3cret-pass");
		expect((await service.probe()).mode).toBe("ready");
		const cleared = await service.setPassword(null);
		expect(cleared.configured).toBe(false);
		expect(credentials.value).toBeNull();
	});

	it("loads a previously saved password and lets the environment variable take precedence", async () => {
		vi.stubEnv("DRONE_WEBDAV_PASSWORD", "");
		const service = new KnowledgeWebDavService({ credentials: memoryCredentials("stored-pass") });
		expect((await service.getStatus()).passwordSource).toBe("saved");
		vi.stubEnv("DRONE_WEBDAV_PASSWORD", "from-env-1");
		const status = await service.getStatus();
		expect(status.passwordSource).toBe("env");
		expect(status.warnings.join("\n")).toContain("优先于界面中保存的密码");
	});

	it("rejects empty or control-character passwords before saving", async () => {
		const credentials = memoryCredentials();
		const service = new KnowledgeWebDavService({ credentials });
		await expect(service.setPassword("")).rejects.toThrow();
		await expect(service.setPassword("bad\npass")).rejects.toThrow();
		expect(credentials.value).toBeNull();
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
