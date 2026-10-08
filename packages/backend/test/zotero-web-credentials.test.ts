import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	applyStoredZoteroWebCredentials,
	clearZoteroWebCredentials,
	getZoteroWebApiStatus,
	saveZoteroWebCredentials,
} from "../src/zotero/web-credentials";

const KEY = "AbCdEfGhIjKlMnOpQrStUvWx";
const keyFetch = (write: boolean) =>
	(async () =>
		new Response(
			JSON.stringify({ userID: 4242, username: "lab", access: { user: { library: true, write } } }),
			{
				status: 200,
			},
		)) as unknown as typeof fetch;

let dir: string;
const previous = process.env.PI_CODING_AGENT_DIR;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "drone-zotero-web-"));
	process.env.PI_CODING_AGENT_DIR = dir;
});
afterEach(async () => {
	if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previous;
	await rm(dir, { recursive: true, force: true });
});

describe("zotero web api credentials", () => {
	it("saves only write-scoped keys, injects them into the env and never returns the key", async () => {
		const env: NodeJS.ProcessEnv = {};
		await expect(
			saveZoteroWebCredentials({ apiKey: KEY }, { env, fetchImpl: keyFetch(false) }),
		).rejects.toThrow(/no write access/);
		const status = await saveZoteroWebCredentials({ apiKey: KEY }, { env, fetchImpl: keyFetch(true) });
		expect(status).toMatchObject({
			configured: true,
			source: "settings",
			libraryId: "4242",
			username: "lab",
			keyHint: "UvWx",
		});
		expect(JSON.stringify(status)).not.toContain(KEY);
		expect(env).toMatchObject({
			ZOTERO_API_KEY: KEY,
			ZOTERO_LIBRARY_ID: "4242",
			// pyzotero / zotero-mcp spelling: "users" would build /userss/<id> in MCP children.
			ZOTERO_LIBRARY_TYPE: "user",
		});
		if (process.platform !== "win32")
			expect((await stat(join(dir, "zotero-web.json"))).mode & 0o777).toBe(0o600);

		const restarted: NodeJS.ProcessEnv = {};
		await applyStoredZoteroWebCredentials(restarted);
		expect(restarted.ZOTERO_API_KEY).toBe(KEY);

		const cleared = await clearZoteroWebCredentials(env);
		expect(cleared.configured).toBe(false);
		expect(env.ZOTERO_API_KEY).toBeUndefined();
		expect(await readFile(join(dir, "zotero-web.json"), "utf8")).toBe("null\n");
	});

	it("leaves a user-set ZOTERO_API_KEY alone", async () => {
		const env: NodeJS.ProcessEnv = { ZOTERO_API_KEY: "fromenvironment1234", ZOTERO_LIBRARY_ID: "7" };
		expect(await getZoteroWebApiStatus(env)).toMatchObject({
			source: "env",
			libraryId: "7",
			keyHint: "1234",
		});
		await expect(
			saveZoteroWebCredentials({ apiKey: KEY }, { env, fetchImpl: keyFetch(true) }),
		).rejects.toThrow(/environment/);
		await applyStoredZoteroWebCredentials(env);
		expect(env.ZOTERO_API_KEY).toBe("fromenvironment1234");
	});

	it("injects the singular group spelling and reads either spelling from a user-set env", async () => {
		const env: NodeJS.ProcessEnv = {};
		const groupFetch = (async () =>
			new Response(
				JSON.stringify({
					userID: 4242,
					username: "lab",
					access: { groups: { "99": { library: true, write: true } } },
				}),
				{ status: 200 },
			)) as unknown as typeof fetch;
		const status = await saveZoteroWebCredentials(
			{ apiKey: KEY, libraryType: "groups", libraryId: "99" },
			{ env, fetchImpl: groupFetch },
		);
		expect(status).toMatchObject({ libraryType: "groups", libraryId: "99" });
		expect(env.ZOTERO_LIBRARY_TYPE).toBe("group");
		for (const spelling of ["group", "groups", "GROUP"]) {
			expect(
				await getZoteroWebApiStatus({
					ZOTERO_API_KEY: "fromenvironment1234",
					ZOTERO_LIBRARY_ID: "99",
					ZOTERO_LIBRARY_TYPE: spelling,
				}),
			).toMatchObject({ source: "env", libraryType: "groups" });
		}
	});
});
