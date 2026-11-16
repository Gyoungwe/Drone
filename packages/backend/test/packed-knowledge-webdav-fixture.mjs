/** Synthetic authenticated DAV fixture and isolated packed-package setup. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { format, promisify } from "node:util";
import { expect, onTestFinished, vi } from "vitest";
import { discoverInstalledPackages } from "../../desktop/src/main/ui-plugins/installed-package-sources";

export const endpoint = "http://10.126.126.1:8080";
export const username = "gaoyangwei";
export const secrets = {
	saved: "TEST_ONLY_W2D_SAVED_MARKER",
	env: "TEST_ONLY_W2D_ENV_MARKER",
	wrongEnv: "TEST_ONLY_W2D_WRONG_MARKER",
};
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const md5 = (value) => createHash("md5").update(value).digest("hex");
const run = promisify(execFile);

function passwordUsed(request) {
	const header = request.headers.authorization;
	if (!header) return "none";
	if (header.startsWith("Basic ")) {
		const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
		return Object.entries(secrets).find(([, secret]) => decoded === `${username}:${secret}`)?.[0] ?? "other";
	}
	const fields = Object.fromEntries(
		[...header.matchAll(/(\w+)=(?:"([^"]*)"|([^, ]+))/g)].map(([, key, quoted, bare]) => [
			key,
			quoted ?? bare,
		]),
	);
	if (
		!header.startsWith("Digest ") ||
		fields.username !== username ||
		fields.uri !== request.url ||
		fields.realm !== "fixture" ||
		fields.nonce !== "fixture-nonce" ||
		fields.qop !== "auth" ||
		!/^[a-f0-9]{8}$/i.test(fields.nc) ||
		!fields.cnonce
	)
		return "other";
	return (
		Object.entries(secrets).find(([, secret]) => {
			const ha1 = md5(`${username}:fixture:${secret}`);
			const ha2 = md5(`${request.method}:${request.url}`);
			return fields.response === md5(`${ha1}:fixture-nonce:${fields.nc}:${fields.cnonce}:auth:${ha2}`);
		})?.[0] ?? "other"
	);
}

export function seedNote(t, path, text) {
	const note = { text, etag: `"${sha256(text)}"` };
	t.notes.set(`/Drone-Knowledge/${path}`, note);
}

function serveRead(t, request, response) {
	if (request.method === "PROPFIND") {
		if (request.headers.depth !== "0") return response.writeHead(400).end();
		if (!t.collections.has(request.url)) return response.writeHead(404).end();
		response.writeHead(207, { "Content-Type": "application/xml" });
		return response.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response>
<d:href>${request.url}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype>
</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`);
	}
	const note = t.notes.get(request.url);
	if (!note) return response.writeHead(404).end();
	response.writeHead(200, { ETag: note.etag, "Content-Type": "text/markdown; charset=utf-8" });
	response.end(note.text);
}

async function serveWrite(t, request, response) {
	if (request.method === "MKCOL") {
		const existed = t.collections.has(request.url);
		t.collections.add(request.url);
		return response.writeHead(existed ? 405 : 201).end();
	}
	if (request.method !== "PUT") return response.writeHead(405).end();
	const previous = t.notes.get(request.url);
	if (
		(request.headers["if-none-match"] === "*" && previous) ||
		(request.headers["if-match"] !== undefined && request.headers["if-match"] !== previous?.etag)
	)
		return response.writeHead(412).end();
	const chunks = [];
	for await (const chunk of request) chunks.push(chunk);
	const text = Buffer.concat(chunks).toString("utf8");
	const note = { text, etag: `"${sha256(text)}"` };
	t.notes.set(request.url, note);
	response.writeHead(previous ? 204 : 201, { ETag: note.etag });
	response.end();
}

async function startDav(t) {
	t.server = createServer((request, response) => {
		const selected = passwordUsed(request);
		t.requests.push({
			method: request.method,
			path: request.url,
			depth: request.headers.depth,
			passwordUsed: selected,
		});
		if (request.headers.authorization) t.authorizationValues.add(request.headers.authorization);
		response.setHeader("Set-Cookie", secrets.saved);
		response.setHeader("X-Private", secrets.env);
		const matchesMode = request.headers.authorization?.startsWith(t.auth === "digest" ? "Digest " : "Basic ");
		if (!matchesMode || selected !== t.accepted) {
			request.resume();
			response.writeHead(401, {
				"WWW-Authenticate":
					t.auth === "digest"
						? 'Digest realm="fixture", nonce="fixture-nonce", qop="auth", algorithm=MD5'
						: 'Basic realm="fixture"',
			});
			response.end(secrets.wrongEnv);
			return;
		}
		if (["GET", "PROPFIND"].includes(request.method)) {
			request.resume();
			serveRead(t, request, response);
		} else {
			void serveWrite(t, request, response).catch((error) => {
				t.serverErrors.push(error.message);
				response.destroy(error);
			});
		}
	});
	t.server.listen(0, "127.0.0.1");
	await once(t.server, "listening");
	t.origin = `http://127.0.0.1:${t.server.address().port}`;
}

function interceptFetch(t) {
	const original = globalThis.fetch;
	vi.stubGlobal("fetch", (input, init) => {
		const url = new URL(input);
		if (url.origin !== endpoint) {
			t.unexpectedOrigins.push(url.origin);
			throw new Error("Packed WebDAV requested an unexpected origin");
		}
		const rewritten = new URL(`${url.pathname}${url.search}`, t.origin);
		t.fetchCalls.push({ from: url.href, to: rewritten.href, method: init.method });
		return original(rewritten, init);
	});
}

export function assertNoLeaks(t) {
	const visible = JSON.stringify([t.results, t.errors, t.approvals, t.console, t.serverErrors]);
	const forbidden = [...Object.values(secrets), ...t.authorizationValues];
	expect(
		forbidden.some(
			(value) => visible.includes(value) || visible.includes(JSON.stringify(value).slice(1, -1)),
		),
		"credential or Authorization value leaked",
	).toBe(false);
	expect(t.serverErrors).toEqual([]);
}

export function assertFetchConfined(t) {
	expect(t.unexpectedOrigins).toEqual([]);
	for (const call of t.fetchCalls) {
		const original = new URL(call.from);
		const rewritten = new URL(call.to);
		expect(original.origin).toBe(endpoint);
		expect(rewritten.origin).toBe(t.origin);
		expect(rewritten.pathname.startsWith("/")).toBe(true);
		expect(`${rewritten.pathname}${rewritten.search}`).toBe(`${original.pathname}${original.search}`);
	}
}

export async function closeHost(t) {
	try {
		await t.bridge?.close();
	} finally {
		await t.backend?.dispose();
	}
}

function registerCleanup(t) {
	onTestFinished(async () => {
		try {
			const outcomes = await Promise.allSettled([
				closeHost(t),
				new Promise((resolve, reject) => {
					if (!t.server?.listening) return resolve();
					t.server.close((error) => (error ? reject(error) : resolve()));
					t.server.closeAllConnections();
				}),
			]);
			const failures = outcomes.filter((result) => result.status === "rejected");
			t.errors.push(...failures.map((result) => String(result.reason)));
			assertNoLeaks(t);
			assertFetchConfined(t);
			if (failures.length)
				throw new AggregateError(
					failures.map((result) => result.reason),
					"Packed WebDAV cleanup failed",
				);
		} finally {
			vi.restoreAllMocks();
			vi.unstubAllGlobals();
			vi.unstubAllEnvs();
			await rm(t.root, { recursive: true, force: true });
		}
	});
}

export async function installPackedKnowledge(t, tarball) {
	const artifact = await realpath(tarball);
	await run(
		"npm",
		[
			"install",
			"--prefix",
			t.prefix,
			"--ignore-scripts",
			"--omit=peer",
			"--no-audit",
			"--no-fund",
			"--registry=https://registry.npmjs.org",
			artifact,
			...(process.env.DRONE_PLUGIN_API_TARBALL ? [await realpath(process.env.DRONE_PLUGIN_API_TARBALL)] : []),
		],
		{ maxBuffer: 8 * 1024 * 1024 },
	);
	const lock = JSON.parse(await readFile(join(t.prefix, "package-lock.json"), "utf8"));
	const installed = Object.entries(lock.packages).find(
		([path, entry]) => path.endsWith("/@gyoungwe/pi-knowledge") && entry.resolved?.startsWith("file:"),
	);
	expect(installed, "installed local tarball lock receipt").toBeDefined();
	t.packageRoot = await realpath(join(t.prefix, installed[0]));
	const catalog = await discoverInstalledPackages(join(t.prefix, "node_modules"));
	const selected = catalog.find(
		(item) => !("error" in item) && item.packageName === "@gyoungwe/pi-knowledge",
	);
	expect(selected?.runtime, "manifest-derived installed knowledge runtime").toBeDefined();
	t.source = selected.runtime;
	expect(t.source.packageRoot).toBe(t.packageRoot);
	expect(JSON.parse(await readFile(join(t.packageRoot, "package.json"), "utf8"))).toMatchObject({
		version: "0.3.0",
	});
	expect(t.source.credentials).toEqual([
		expect.objectContaining({
			slot: "webdav",
			hosts: ["10.126.126.1:8080"],
			authentication: "http-basic-digest",
		}),
	]);
}

export async function packedFixture() {
	const t = {
		root: await realpath(await mkdtemp(join(tmpdir(), "drone-packed-webdav-"))),
		notes: new Map(),
		collections: new Set(["/"]),
		requests: [],
		fetchCalls: [],
		unexpectedOrigins: [],
		authorizationValues: new Set(),
		results: [],
		errors: [],
		approvals: [],
		console: [],
		serverErrors: [],
		auth: "digest",
		accepted: "saved",
		approveNetwork: true,
		writable: true,
	};
	registerCleanup(t);
	for (const name of ["prefix", "state", "vault", "workspace", "cache", "leases", "agentDir"]) {
		t[name] = join(t.root, name);
		await mkdir(t[name]);
	}
	t.knowledgeBinding = {
		version: 1,
		vault: t.vault,
		vaultId: sha256(t.vault).slice(0, 24),
		revision: 1,
		profile: "hybrid",
		depositMode: "verified",
		subagentPolicy: "read-local",
		updatedAt: new Date().toISOString(),
	};
	await writeFile(join(t.state, "binding.json"), JSON.stringify(t.knowledgeBinding));
	vi.stubEnv("PI_CODING_AGENT_DIR", t.agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	vi.stubEnv("DRONE_WEBDAV_PASSWORD", undefined);
	vi.stubEnv("DRONE_REPLY_LANGUAGE", "en");
	for (const method of ["log", "info", "warn", "error", "debug", "trace", "dir", "dirxml", "table", "assert"])
		vi.spyOn(console, method).mockImplementation((...args) => t.console.push(format(...args)));
	await startDav(t);
	interceptFetch(t);
	return t;
}
