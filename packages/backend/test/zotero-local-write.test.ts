import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	applyStoredZoteroLocalKey,
	authorizeZoteroLocalWrite,
	clearZoteroLocalWrite,
	getZoteroLocalWriteStatus,
} from "../src/zotero/local-write";

const LOCAL_KEY = "LocalKey0123456789";

/** Zotero 10 local API: GET /api/ carries Zotero-Server-ID; POST /api/local/authorize answers the dialog. */
function fakeZotero({
	serverId = "SRV1" as string | null,
	answer = { status: 200, body: { key: LOCAL_KEY, remember: true } as unknown },
} = {}) {
	const calls: { url: string; headers: Record<string, string>; body?: string }[] = [];
	const fetchImpl = (async (input: string, init: RequestInit = {}) => {
		const url = String(input);
		const headers = (init.headers as Record<string, string>) || {};
		calls.push({ url, headers, body: init.body as string | undefined });
		if (url === "http://127.0.0.1:23119/api/")
			return new Response("Nothing to see here.", {
				status: 200,
				headers: serverId ? { "Zotero-Server-ID": serverId } : {},
			});
		if (url === "http://127.0.0.1:23119/api/local/authorize")
			return new Response(JSON.stringify(answer.body), { status: answer.status });
		return new Response("unexpected", { status: 500 });
	}) as unknown as typeof fetch;
	return { fetchImpl, calls };
}
const unreachable = (async () => {
	throw new TypeError("fetch failed");
}) as unknown as typeof fetch;

let dir: string;
const previous = process.env.PI_CODING_AGENT_DIR;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "drone-zotero-local-"));
	process.env.PI_CODING_AGENT_DIR = dir;
});
afterEach(async () => {
	if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previous;
	await rm(dir, { recursive: true, force: true });
});

describe("zotero local write authorization", () => {
	it("saves an “Always Allow” key with its server id, injects it, and never returns the key", async () => {
		const env: NodeJS.ProcessEnv = {};
		const { fetchImpl, calls } = fakeZotero();
		const status = await authorizeZoteroLocalWrite({ env, fetchImpl });
		expect(status).toEqual({
			reachable: true,
			supported: true,
			authorized: true,
			source: "settings",
			staleServer: false,
		});
		expect(JSON.stringify(status)).not.toContain(LOCAL_KEY);
		const request = calls.find((call) => call.url.endsWith("/local/authorize"));
		expect(request?.headers["Zotero-Server-ID"]).toBe("SRV1");
		expect(JSON.parse(request?.body || "{}")).toEqual({ appName: "Drone" });
		expect(env).toMatchObject({ ZOTERO_LOCAL_API_KEY: LOCAL_KEY, ZOTERO_LOCAL_SERVER_ID: "SRV1" });
		const file = join(dir, "zotero-local.json");
		expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ key: LOCAL_KEY, serverId: "SRV1" });
		expect((await stat(file)).mode & 0o777).toBe(0o600);

		const restarted: NodeJS.ProcessEnv = {};
		await applyStoredZoteroLocalKey(restarted);
		expect(restarted.ZOTERO_LOCAL_API_KEY).toBe(LOCAL_KEY);

		const cleared = await clearZoteroLocalWrite({ env, fetchImpl });
		expect(cleared).toMatchObject({ authorized: false, source: null });
		expect(env.ZOTERO_LOCAL_API_KEY).toBeUndefined();
	});

	it("does not save a one-time grant, a denial, or a rate-limited answer", async () => {
		const env: NodeJS.ProcessEnv = {};
		for (const [answer, message] of [
			[{ status: 200, body: { key: LOCAL_KEY, remember: false } }, /Always Allow/],
			[{ status: 403, body: {} }, /denied/],
			[{ status: 429, body: {} }, /rate-limiting/],
		] as const) {
			const { fetchImpl } = fakeZotero({ answer });
			await expect(authorizeZoteroLocalWrite({ env, fetchImpl })).rejects.toThrow(message);
		}
		expect(env.ZOTERO_LOCAL_API_KEY).toBeUndefined();
		expect((await getZoteroLocalWriteStatus({ env, fetchImpl: fakeZotero().fetchImpl })).authorized).toBe(
			false,
		);
	});

	it("explains an unreachable or pre-10 Zotero without opening a dialog", async () => {
		await expect(authorizeZoteroLocalWrite({ env: {}, fetchImpl: unreachable })).rejects.toThrow(
			/not reachable/,
		);
		const old = fakeZotero({ serverId: null });
		await expect(authorizeZoteroLocalWrite({ env: {}, fetchImpl: old.fetchImpl })).rejects.toThrow(
			/Zotero 10/,
		);
		expect(old.calls.some((call) => call.url.endsWith("/local/authorize"))).toBe(false);
		expect(await getZoteroLocalWriteStatus({ env: {}, fetchImpl: unreachable })).toMatchObject({
			reachable: false,
			supported: null,
		});
	});

	it("flags a saved key that belongs to another Zotero database", async () => {
		const env: NodeJS.ProcessEnv = {};
		await authorizeZoteroLocalWrite({ env, fetchImpl: fakeZotero().fetchImpl });
		const status = await getZoteroLocalWriteStatus({
			env,
			fetchImpl: fakeZotero({ serverId: "OTHERDB" }).fetchImpl,
		});
		expect(status).toMatchObject({ authorized: false, staleServer: true, source: "settings" });
	});

	it("leaves a user-set ZOTERO_LOCAL_API_KEY alone", async () => {
		const env: NodeJS.ProcessEnv = { ZOTERO_LOCAL_API_KEY: "FromShell123" };
		await expect(authorizeZoteroLocalWrite({ env, fetchImpl: fakeZotero().fetchImpl })).rejects.toThrow(
			/environment/,
		);
		expect(await getZoteroLocalWriteStatus({ env, fetchImpl: fakeZotero().fetchImpl })).toMatchObject({
			authorized: true,
			source: "env",
		});
		await clearZoteroLocalWrite({ env, fetchImpl: fakeZotero().fetchImpl });
		expect(env.ZOTERO_LOCAL_API_KEY).toBe("FromShell123");
	});
});
